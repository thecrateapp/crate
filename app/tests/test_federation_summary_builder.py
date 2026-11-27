"""FED2: owner-side per-scope catalog summary builder."""

from __future__ import annotations

from uuid import uuid4

import pytest

from crate.db.queries.federation_catalog_summaries import (
    get_catalog_summary,
    list_catalog_summary_heads,
)
from crate.federation import summary_builder
from crate.federation.catalog_scope import catalog_scope_digest
from crate.federation.summary_bloom import (
    BloomFilter,
    artist_key,
    name_tokens,
    query_probe_terms,
)


def _seed(pg_db, artist: str, albums: list[str], *, album_uid: str | None = None):
    pg_db.upsert_artist({"name": artist})
    uids = []
    for index, album in enumerate(albums):
        uid = album_uid if (album_uid and index == 0) else str(uuid4())
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
                "track_count": 1,
                "entity_uid": uid,
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": "t.flac",
                "title": f"Song of {album}",
                "path": f"/music/{artist}/{album}/t.flac",
                "duration": 100.0,
                "format": "flac",
            }
        )
        uids.append(uid)
    return uids


class _World:
    """Controls the approved peers, their policies and the high-water mark."""

    def __init__(self, monkeypatch):
        self.peers: dict[str, dict | None] = {}
        self.hwm = 10
        self.disabled: set[str] = set()
        monkeypatch.setattr(
            summary_builder.repo,
            "list_peers",
            lambda trust_state=None: [
                {"node_uid": uid, "disabled_at": "x" if uid in self.disabled else None}
                for uid in self.peers
            ],
        )
        monkeypatch.setattr(
            summary_builder,
            "peer_search_policy",
            lambda peer: self.peers[peer["node_uid"]],
        )
        monkeypatch.setattr(
            summary_builder, "catalog_high_water_mark", lambda: self.hwm
        )


@pytest.fixture
def world(monkeypatch):
    return _World(monkeypatch)


def _digest(policy: dict) -> str:
    return catalog_scope_digest(policy)


def _bloom(digest: str) -> BloomFilter:
    row = get_catalog_summary(digest)
    assert row is not None
    return BloomFilter.from_bytes(
        row["bloom"], m=row["params"]["m"], k=row["params"]["k"]
    )


def _has(bloom: BloomFilter, text: str) -> bool:
    probes = query_probe_terms(text)
    assert probes
    return all(p in bloom for p in probes)


OPEN = {}


def DENY(uid):
    return {"catalog_filter": {"deny_entity_uids": [uid]}}


def test_summary_has_no_false_negatives_on_catalog(pg_db, world):
    _seed(pg_db, "Nightwish Collective", ["Wishmaster Dreams", "Oceanborn Echo"])
    _seed(pg_db, "Zeta Reticuli", ["Grey Visitors"])
    world.peers["p1"] = OPEN

    result = summary_builder.refresh_catalog_summaries()

    assert result == {"scopes": 1, "built": 1, "skipped": 0, "deleted": 0}
    bloom = _bloom(_digest(OPEN))
    for text in (
        "Nightwish Collective",
        "Wishmaster Dreams",
        "Oceanborn Echo",
        "Zeta Reticuli",
        "Grey Visitors",
        "Song of Wishmaster Dreams",
    ):
        tokens = name_tokens(text)
        for token in tokens:
            for end in range(3, len(token) + 1):
                assert token[:end] in bloom, (text, token[:end])
        assert _has(bloom, text)


def test_scope_isolation_and_shared_row(pg_db, world):
    from sqlalchemy import text

    from crate.db.tx import read_scope

    [album_x] = _seed(pg_db, "Isolation Band", ["zyxqvalbum"])
    with read_scope() as session:
        track_uids = [
            str(uid)
            for uid in session.execute(
                text("SELECT entity_uid FROM library_tracks WHERE album = 'zyxqvalbum'")
            ).scalars()
        ]
    denied = {"catalog_filter": {"deny_entity_uids": [album_x, *track_uids]}}
    world.peers["p1"] = OPEN
    world.peers["p2"] = denied
    world.peers["p3"] = dict(denied)

    result = summary_builder.refresh_catalog_summaries()

    assert result["scopes"] == 2 and result["built"] == 2
    assert len(list_catalog_summary_heads()) == 2
    assert "zyxqvalbum" in _bloom(_digest(OPEN))
    assert "zyxqvalbum" not in _bloom(_digest(denied))


def test_counts_albums_per_artist(pg_db, world):
    _seed(pg_db, "Triple Threat", ["One Alpha", "Two Beta", "Three Gamma"])
    world.peers["p1"] = OPEN

    summary_builder.refresh_catalog_summaries()

    counts = get_catalog_summary(_digest(OPEN))["artist_album_counts"]
    assert counts[artist_key("Triple Threat")] == 3


def test_second_run_skips(pg_db, world):
    _seed(pg_db, "Skipper", ["Skip Album"])
    world.peers["p1"] = OPEN
    summary_builder.refresh_catalog_summaries()

    result = summary_builder.refresh_catalog_summaries()

    assert result == {"scopes": 1, "built": 0, "skipped": 1, "deleted": 0}


def test_catalog_change_rebuilds(pg_db, world):
    _seed(pg_db, "Changer", ["Old Album"])
    world.peers["p1"] = OPEN
    summary_builder.refresh_catalog_summaries()
    assert not _has(_bloom(_digest(OPEN)), "Freshlyadded")

    _seed(pg_db, "Changer", ["Freshlyadded"])
    world.hwm += 1
    result = summary_builder.refresh_catalog_summaries()

    assert result["built"] == 1
    assert _has(_bloom(_digest(OPEN)), "Freshlyadded")
    assert get_catalog_summary(_digest(OPEN))["source_sequence"] == world.hwm


def test_unchanged_content_keeps_etag(pg_db, world):
    _seed(pg_db, "Stable", ["Stable Album"])
    world.peers["p1"] = OPEN
    summary_builder.refresh_catalog_summaries()
    before = get_catalog_summary(_digest(OPEN))

    world.hwm += 5
    result = summary_builder.refresh_catalog_summaries()
    after = get_catalog_summary(_digest(OPEN))

    assert result["built"] == 1
    assert after["etag"] == before["etag"]
    assert after["source_sequence"] == world.hwm


def test_dropped_scope_is_deleted(pg_db, world):
    [album_x] = _seed(pg_db, "Dropper", ["Drop Album"])
    world.peers["p1"] = OPEN
    world.peers["p2"] = DENY(album_x)
    summary_builder.refresh_catalog_summaries()

    del world.peers["p2"]
    result = summary_builder.refresh_catalog_summaries()

    assert result["deleted"] == 1 and result["scopes"] == 1
    assert [h["scope_digest"] for h in list_catalog_summary_heads()] == [_digest(OPEN)]


def test_denied_and_disabled_peers_get_no_scope(pg_db, world):
    _seed(pg_db, "Nobody", ["Nothing Here"])
    world.peers["denied"] = None
    world.peers["off"] = OPEN
    world.disabled.add("off")

    result = summary_builder.refresh_catalog_summaries()

    assert result == {"scopes": 0, "built": 0, "skipped": 0, "deleted": 0}
    assert list_catalog_summary_heads() == []


def test_should_stop_halts_between_scopes(pg_db, world):
    [album_x] = _seed(pg_db, "Stopper", ["Stop Album"])
    world.peers["p1"] = OPEN
    world.peers["p2"] = DENY(album_x)

    result = summary_builder.refresh_catalog_summaries(should_stop=lambda: True)

    assert result["built"] == 0
    assert list_catalog_summary_heads() == []


def test_handler_reports_and_cancels(monkeypatch):
    from crate.worker_handlers import federation as handlers

    monkeypatch.setattr(
        summary_builder,
        "refresh_catalog_summaries",
        lambda should_stop=None: {
            "scopes": 1,
            "built": 1,
            "skipped": 0,
            "deleted": 0,
            "stopped": bool(should_stop and should_stop()),
        },
    )
    monkeypatch.setattr(handlers, "is_cancelled", lambda _id: True)
    out = handlers._handle_federation_build_catalog_summaries("t1", {}, {})
    assert out["built"] == 1 and out["stopped"] is True
    assert "federation_build_catalog_summaries" in handlers.FEDERATION_TASK_HANDLERS


@pytest.mark.parametrize(
    "field,stale",
    [("tokenizer", "fts-simple-v1"), ("hash", "blake2b-64-km"), ("min_prefix", 2)],
)
def test_out_of_date_format_rebuilds(pg_db, world, field, stale):
    import json

    from sqlalchemy import text

    from crate.db.tx import transaction_scope
    from crate.federation.summary_bloom import MIN_PREFIX, SUMMARY_HASH, TOKENIZER

    _seed(pg_db, "Formatter", ["Format Album"])
    world.peers["p1"] = OPEN
    summary_builder.refresh_catalog_summaries()
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE federation_catalog_summaries "
                "SET params_json = params_json || CAST(:patch AS jsonb)"
            ),
            {"patch": json.dumps({field: stale})},
        )
    assert get_catalog_summary(_digest(OPEN))["source_sequence"] == world.hwm

    result = summary_builder.refresh_catalog_summaries()

    assert result["built"] == 1 and result["skipped"] == 0
    params = get_catalog_summary(_digest(OPEN))["params"]
    assert params["tokenizer"] == TOKENIZER == "fts-simple-v2"
    assert params["hash"] == SUMMARY_HASH
    assert params["min_prefix"] == MIN_PREFIX
