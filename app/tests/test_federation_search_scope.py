"""The owner's /search honours the grant and the node catalog scope (FED2)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from crate.federation.results_envelope import RESULTS_CONTRACT

OWNER_UID = "00000000-0000-0000-0000-00000000000b"
REQUESTER_UID = "00000000-0000-0000-0000-00000000000a"


def _rows():
    return {
        "artists": [{"entity_uid": "artist-1", "name": "Joy Division"}],
        "albums": [
            {"entity_uid": "album-a", "name": "A", "artist": "Joy Division"},
            {"entity_uid": "album-b", "name": "B", "artist": "Joy Division"},
        ],
        "tracks": [{"entity_uid": "track-1", "title": "Disorder"}],
    }


def _constraints(types=(), uids=()):
    return SimpleNamespace(
        allowed_entity_types=frozenset(types),
        allowed_entity_uids=frozenset(uids),
        max_results=None,
    )


@pytest.fixture
def owner(monkeypatch):
    from crate.api import federation as federation_api

    state = {
        "constraints": None,
        "policy": {},
        "rows": _rows(),
        "excluded": set(),
        "exclusion_calls": [],
    }
    peer = {"node_uid": REQUESTER_UID, "display_name": "Home"}

    async def signed(_request, body_bytes=None):
        del body_bytes
        return peer

    monkeypatch.setattr(federation_api, "_require_signed_node_request", signed)
    monkeypatch.setattr(
        federation_api, "_require_user_assertion", lambda *a: {"sub": "subject-hash"}
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *a, **k: SimpleNamespace(constraints=state["constraints"]),
    )
    monkeypatch.setattr(federation_api, "_require_search_quota", lambda *a: None)
    monkeypatch.setattr(federation_api, "catalog_share_policy", lambda: state["policy"])
    monkeypatch.setattr(
        federation_api, "handle_remote_search", lambda **kw: state["rows"]
    )

    def excluded(album_uids, artist_uids, track_uids):
        state["exclusion_calls"].append(
            (list(album_uids), list(artist_uids), list(track_uids))
        )
        return set(state["excluded"])

    monkeypatch.setattr(federation_api, "federation_search_excluded_uids", excluded)
    monkeypatch.setattr(
        federation_api.repo,
        "get_local_node",
        lambda: {"node_uid": OWNER_UID, "display_name": "Les Pedants"},
    )
    federation_api.state = state
    return federation_api


def _search(federation_api, **body):
    payload = federation_api.SearchBody(**{"q": "joy", "limit": 20, **body})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(redis=None)))
    return asyncio.run(federation_api.federated_search(payload, request))


def test_search_drops_entities_outside_grant_uids(owner):
    owner.state["constraints"] = _constraints(uids=["album-a"])

    result = _search(owner)

    assert [a["entity_uid"] for a in result["albums"]] == ["album-a"]


def test_search_drops_denied_entities(owner):
    owner.state["policy"] = {"catalog_filter": {"deny_entity_uids": ["album-b"]}}

    plain = _search(owner)
    envelope = _search(owner, contracts=[RESULTS_CONTRACT])

    assert [a["entity_uid"] for a in plain["albums"]] == ["album-a"]
    uids = [item["remote_entity_uid"] for item in envelope["items"]]
    assert "album-b" not in uids
    assert "album-a" in uids


def test_search_drops_disallowed_entity_types(owner):
    owner.state["constraints"] = _constraints(types=["track"])

    result = _search(owner)

    assert result["artists"] == []
    assert result["albums"] == []
    assert [t["entity_uid"] for t in result["tracks"]] == ["track-1"]


def test_truncated_stays_true_when_scope_drops_rows_of_a_capped_search(owner):
    owner.state["policy"] = {"catalog_filter": {"deny_entity_uids": ["album-b"]}}

    result = _search(owner, contracts=[RESULTS_CONTRACT], limit=2)

    assert "album-b" not in [i["remote_entity_uid"] for i in result["items"]]
    assert result["coverage"]["truncated"] is True


def test_truncated_is_false_when_nothing_was_capped_or_dropped(owner):
    result = _search(owner, contracts=[RESULTS_CONTRACT], limit=20)

    assert result["coverage"]["truncated"] is False


# --- the search scope matches the manifest scope (I6) ----------------------


def test_search_asks_for_manifest_exclusions_once(owner):
    _search(owner)

    assert owner.state["exclusion_calls"] == [
        (["album-a", "album-b"], ["artist-1"], ["track-1"])
    ]


def test_search_drops_a_quarantined_album(owner):
    owner.state["excluded"] = {"album-b"}

    result = _search(owner)

    assert [a["entity_uid"] for a in result["albums"]] == ["album-a"]


def test_search_drops_a_hidden_artist(owner):
    owner.state["excluded"] = {"artist-1"}

    result = _search(owner)

    assert result["artists"] == []
    assert len(result["albums"]) == 2


@pytest.mark.parametrize("with_allow_list", [False, True])
def test_search_drops_items_without_entity_uid(owner, with_allow_list):
    owner.state["rows"] = {
        "artists": [{"name": "No Uid"}, {"entity_uid": "artist-1", "name": "JD"}],
        "albums": [{"entity_uid": None, "name": "Ghost"}],
        "tracks": [{"entity_uid": "", "title": "Blank"}],
    }
    if with_allow_list:
        owner.state["policy"] = {"catalog_filter": {"artist_entity_uids": ["artist-1"]}}

    result = _search(owner)

    assert [a["entity_uid"] for a in result["artists"]] == ["artist-1"]
    assert result["albums"] == []
    assert result["tracks"] == []


def test_search_drops_artists_and_tracks_outside_grant_uids(owner):
    owner.state["rows"] = {
        "artists": [
            {"entity_uid": "artist-1", "name": "Joy Division"},
            {"entity_uid": "artist-2", "name": "New Order"},
        ],
        "albums": [],
        "tracks": [
            {"entity_uid": "track-1", "title": "Disorder"},
            {"entity_uid": "track-2", "title": "Ceremony"},
        ],
    }
    owner.state["constraints"] = _constraints(uids=["artist-2", "track-1"])

    result = _search(owner)

    assert [a["entity_uid"] for a in result["artists"]] == ["artist-2"]
    assert [t["entity_uid"] for t in result["tracks"]] == ["track-1"]


def test_excluded_uids_mirror_the_manifest_predicates(pg_db):
    import uuid

    from crate.db.queries.federation_manifest import (
        federation_search_excluded_uids,
        list_federation_manifest_rows,
    )
    from crate.db.repositories.library_quarantine import quarantine_album

    def artist(name, folder=None):
        pg_db.upsert_artist({"name": name, "folder_name": folder or name})
        from sqlalchemy import text

        from crate.db.tx import read_scope

        with read_scope() as session:
            return str(
                session.execute(
                    text("SELECT entity_uid FROM library_artists WHERE name = :n"),
                    {"n": name},
                ).scalar_one()
            )

    def album(artist_name, name):
        uid = str(uuid.uuid4())
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": name,
                "path": f"/music/{artist_name}/{name}",
                "track_count": 1,
                "entity_uid": uid,
            }
        )
        return uid, album_id

    visible_artist = artist("Visible")
    dot_name = artist(".Hidden")
    dot_folder = artist("Folder Hidden", ".folder-hidden")
    kept_uid, _ = album("Visible", "Kept")
    quarantined_uid, quarantined_id = album("Visible", "Quarantined")
    quarantine_album(quarantined_id, "test-task")
    unknown = str(uuid.uuid4())

    excluded = federation_search_excluded_uids(
        [kept_uid, quarantined_uid, unknown, "not-a-uuid"],
        [visible_artist, dot_name, dot_folder],
        [str(uuid.uuid4())],
    )

    assert excluded == {quarantined_uid, dot_name, dot_folder}
    assert federation_search_excluded_uids([], [], []) == set()

    open_scope = {
        "share_allowed": True,
        "allowed_entity_uids": [],
        "allowed_artist_uids": [],
        "allowed_album_uids": [],
        "allowed_track_uids": [],
        "denied_entity_uids": [],
    }
    manifest = {
        row["remote_entity_uid"]
        for row in list_federation_manifest_rows(
            after_entity_type="",
            after_entity_uid="",
            limit=1000,
            policy_params=open_scope,
        )
    }
    candidates = {kept_uid, quarantined_uid, visible_artist, dot_name, dot_folder}
    assert candidates - manifest == excluded
