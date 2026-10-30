from unittest.mock import MagicMock

import pytest
from sqlalchemy import text

from crate.db.queries.paths_bliss_candidate_queries import find_anchor_track_row
from crate.db.queries.paths_endpoint_queries import (
    fetch_bliss_vectors_for_endpoint,
    resolve_endpoint_label,
)
from crate.db.tx import read_scope, transaction_scope

_VECTOR = [0.2] * 20
_TRACK_ID = 1201
_TRACK_UID = "abcdef12-3456-4789-abcd-0123456789ab"


@pytest.fixture
def indexed_track_catalog(pg_db):
    pg_db.upsert_artist({"name": "Reference Album Owner"})
    pg_db.upsert_artist({"name": "Reference Performer"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Reference Album Owner",
            "name": "Reference Compilation",
            "path": "/music/indexed-refs",
        }
    )
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO library_tracks (
                    id, entity_uid, album_id, artist, album, filename, title,
                    path, duration, format, bliss_vector, bpm, energy
                ) VALUES (
                    :id, CAST(:uid AS uuid), :album_id, 'Reference Performer',
                    'Reference Compilation', :filename, :title, :path, 180,
                    'flac', CAST(:vector AS double precision[]), 120, 0.7
                )
            """),
            [
                {
                    "id": track_id,
                    "uid": uid,
                    "album_id": album_id,
                    "filename": f"{track_id}.flac",
                    "title": f"Reference Song {track_id}",
                    "path": f"/music/indexed-refs/{'.hidden/' if hidden else ''}{track_id}.flac",
                    "vector": vector,
                }
                for track_id, uid, vector, hidden in (
                    (_TRACK_ID, _TRACK_UID, _VECTOR, False),
                    (0, None, _VECTOR, False),
                    (-17, None, _VECTOR, False),
                    (1202, None, None, False),
                    (1203, None, _VECTOR, True),
                )
            ],
        )
        session.execute(
            text("""
                INSERT INTO library_tracks (
                    id, entity_uid, album_id, artist, album, filename,
                    title, path, bliss_vector
                )
                SELECT n, md5('indexed-path-ref-' || n)::uuid, :album_id,
                       'Reference Performer', 'Reference Compilation',
                       n || '.flac', 'Filler ' || n,
                       '/music/indexed-refs/filler-' || n || '.flac',
                       CAST(:vector AS double precision[])
                FROM generate_series(3000, 4023) n
            """),
            {"album_id": album_id, "vector": _VECTOR},
        )
        session.execute(text("ANALYZE library_tracks"))
    return album_id


def _read(kind, ref, *, session=None, excluded=None, song_keys=None):
    if kind == "label":
        return resolve_endpoint_label("track", ref, session=session)
    if kind == "vector":
        return fetch_bliss_vectors_for_endpoint("track", ref, session=session)
    return find_anchor_track_row(
        "track",
        ref,
        _VECTOR,
        excluded or set(),
        session=session,
        exclude_song_keys=song_keys,
    )


def _plan_nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from _plan_nodes(child)


@pytest.mark.parametrize("kind", ["label", "vector", "anchor"])
@pytest.mark.parametrize("ref", [str(_TRACK_ID), _TRACK_UID], ids=["id", "uid"])
def test_track_reference_uses_native_lookup_index(indexed_track_catalog, kind, ref):
    with read_scope() as session:
        # This checks whether the predicate can use its existing index; it is
        # deliberately not a latency benchmark or a production planner setting.
        session.execute(text("SET LOCAL enable_seqscan = off"))
        recorded = MagicMock(wraps=session)
        assert _read(kind, ref, session=recorded)
        statement = next(
            call
            for call in recorded.execute.call_args_list
            if str(call.args[0]).lstrip().upper().startswith("SELECT")
        )
        plan = session.execute(
            text("EXPLAIN (FORMAT JSON) " + str(statement.args[0])), statement.args[1]
        ).scalar_one()[0]["Plan"]

    nodes = list(_plan_nodes(plan))
    expected_index = (
        "library_tracks_pkey" if ref == str(_TRACK_ID) else "idx_lib_tracks_entity_uid"
    )
    assert any(
        node.get("Index Name") == expected_index and node.get("Index Cond")
        for node in nodes
    ), plan
    assert not any(
        node.get("Relation Name") == "library_tracks"
        and node["Node Type"] == "Seq Scan"
        for node in nodes
    ), plan


def test_canonical_references_keep_values_and_compilation_identity(
    indexed_track_catalog,
):
    for ref in (str(_TRACK_ID), _TRACK_UID):
        assert _read("label", ref) == "Reference Song 1201 — Reference Performer"
        assert _read("vector", ref) == [_VECTOR]
        anchor = _read("anchor", ref)
        assert anchor["id"] == _TRACK_ID
        assert anchor["entity_uid"] == _TRACK_UID
        assert anchor["artist"] == "Reference Performer"
        assert anchor["album_artist"] == "Reference Album Owner"
        assert anchor["album_id"] == indexed_track_catalog
        assert anchor["bliss_vector"] == _VECTOR
        assert anchor["distance"] == 0.0
        assert anchor["bpm"] == 120
        assert anchor["energy"] == pytest.approx(0.7)


def test_canonical_zero_and_negative_ids_remain_addressable(indexed_track_catalog):
    for track_id in (0, -17):
        ref = str(track_id)
        assert _read("label", ref) == f"Reference Song {track_id} — Reference Performer"
        assert _read("vector", ref) == [_VECTOR]
        assert _read("anchor", ref)["id"] == track_id


def test_reference_parsing_does_not_add_aliases_or_raise_for_unknowns(
    indexed_track_catalog,
):
    refs = (
        "01201",
        "+1201",
        " 1201",
        "1201 ",
        "١٢٠١",
        "-0",
        "-017",
        _TRACK_UID.upper(),
        "{" + _TRACK_UID + "}",
        _TRACK_UID.replace("-", ""),
        "urn:uuid:" + _TRACK_UID,
        "not-a-reference",
        "",
        str(2**63 - 1),
        str(-(2**63)),
        str(2**63),
        str(-(2**63) - 1),
        "9" * 100,
    )
    for ref in refs:
        assert _read("label", ref) == ref
        assert _read("vector", ref) == []
        assert _read("anchor", ref) is None


def test_anchor_eligibility_and_endpoint_reads_keep_distinct_filters(
    indexed_track_catalog,
):
    assert _read("anchor", str(_TRACK_ID), excluded={_TRACK_ID}) is None
    assert (
        _read(
            "anchor",
            _TRACK_UID,
            song_keys={("reference performer", "reference song 1201")},
        )
        is None
    )
    assert _read("label", "1202") == "Reference Song 1202 — Reference Performer"
    assert _read("vector", "1202") == []
    assert _read("anchor", "1202") is None
    assert _read("label", "1203") == "Reference Song 1203 — Reference Performer"
    assert _read("vector", "1203") == [_VECTOR]
    assert _read("anchor", "1203") is None


def test_external_session_sees_uncommitted_track_without_finishing_owner_transaction(
    indexed_track_catalog,
):
    with read_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET title = 'Uncommitted Song' WHERE id = :id"),
            {"id": _TRACK_ID},
        )
        recorded = MagicMock(wraps=session)
        assert _read("label", _TRACK_UID, session=recorded) == (
            "Uncommitted Song — Reference Performer"
        )
        assert _read("vector", _TRACK_UID, session=recorded) == [_VECTOR]
        assert _read("anchor", _TRACK_UID, session=recorded)["title"] == (
            "Uncommitted Song"
        )
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        recorded.close.assert_not_called()
        assert session.in_transaction()

    assert _read("label", _TRACK_UID) == "Reference Song 1201 — Reference Performer"
    assert _read("vector", _TRACK_UID) == [_VECTOR]
    assert _read("anchor", _TRACK_UID)["title"] == "Reference Song 1201"
