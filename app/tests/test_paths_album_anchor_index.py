from unittest.mock import MagicMock

import pytest
from sqlalchemy import text

from crate.db.queries.paths_bliss_candidate_queries import find_anchor_track_row
from crate.db.tx import read_scope, transaction_scope

_TARGET = [1.0, 0.0] + [0.01] * 18
_ALBUM_UID = "abcdef12-3456-4789-abcd-0123456789ab"
_FALLBACK_UID = "abcdef12-3456-4789-abcd-0123456789ac"
_FAMILY_ONE = ("album scope performer", "anchor one")
_ELIGIBLE = {1001, 1002, 1003, 1004}
_ALBUM_INDEXES = {"idx_tracks_album_id", "idx_lib_tracks_album"}
_HNSW_INDEX = "idx_library_tracks_bliss_embedding_cosine_hnsw"


@pytest.fixture
def album_anchor_catalog(pg_db):
    pg_db.upsert_artist({"name": "Album Scope Owner"})
    pg_db.upsert_artist({"name": "Album Scope Performer"})
    albums = [
        pg_db.upsert_album(
            {
                "artist": "Album Scope Owner",
                "name": name,
                "path": f"/music/album-anchor/{index}",
            }
        )
        for index, name in enumerate(("Small Scope", "Outside Scope", "Array Only"))
    ]
    with transaction_scope() as session:
        # Distribute the same neighbors across normal-size albums: a catalog
        # dominated by one huge album gives UID scopes misleading estimates.
        session.execute(
            text("""
                INSERT INTO library_albums (artist, name, path)
                SELECT 'Album Scope Owner', 'Outside Scope ' || n,
                       '/music/album-anchor/outside/' || n
                FROM generate_series(1, 99) n
            """)
        )
        session.execute(
            text(
                "UPDATE library_albums SET entity_uid = CAST(:uid AS uuid) WHERE id = :id"
            ),
            [
                {"id": albums[0], "uid": _ALBUM_UID},
                {"id": albums[2], "uid": _FALLBACK_UID},
            ],
        )
        session.execute(
            text("""
                INSERT INTO library_tracks (
                    id, album_id, artist, album, filename, title, path,
                    bliss_vector, bliss_embedding, bpm, energy
                ) VALUES (
                    :id, :album_id, 'Album Scope Performer', :album,
                    :filename, :title, :path,
                    CAST(:vector AS double precision[]),
                    CAST(:embedding AS vector(20)), 120, 0.7
                )
            """),
            [
                {
                    "id": track_id,
                    "album_id": albums[scope],
                    "album": "Small Scope" if scope == 0 else "Array Only",
                    "filename": f"{track_id}.flac",
                    "title": title,
                    "path": f"/music/album-anchor/{scope}/{'.hidden/' if hidden else ''}{track_id}.flac",
                    "vector": None if offset is None else [1.0, offset] + [0.01] * 18,
                    "embedding": (
                        None
                        if offset is None or scope == 2
                        else str([1.0, offset] + [0.01] * 18)
                    ),
                }
                for track_id, scope, title, offset, hidden in (
                    (1001, 0, "Anchor One", 0.4, False),
                    (1002, 0, "Anchor Two", 0.45, False),
                    (1003, 0, "Anchor Three", 0.9, False),
                    (1004, 0, "Anchor One (Live)", 0.41, False),
                    (1005, 0, "Hidden", 0.0, True),
                    (1006, 0, "No Vector", None, False),
                    (8001, 2, "Array One", 0.2, False),
                    (8002, 2, "Array Two", 0.7, False),
                    (8003, 2, "Hidden Array", 0.0, True),
                )
            ],
        )
        session.execute(
            text("""
                INSERT INTO library_tracks (
                    id, album_id, artist, album, filename, title, path,
                    bliss_vector, bliss_embedding
                )
                SELECT n, a.id, 'Album Scope Performer', a.name,
                       n || '.flac', 'Outside ' || n,
                       '/music/album-anchor/outside/' || n || '.flac',
                       vector_data, CAST(vector_data AS vector(20))
                FROM (
                    SELECT n, ARRAY[1.0, n::double precision / 1000000]
                           || array_fill(0.01::double precision, ARRAY[18]) AS vector_data
                    FROM generate_series(3000, 4999) n
                ) vectors
                JOIN library_albums a
                  ON a.artist = 'Album Scope Owner'
                 AND a.name = CASE WHEN (n - 3000) / 20 = 0 THEN 'Outside Scope'
                                   ELSE 'Outside Scope ' || ((n - 3000) / 20) END
            """)
        )
        session.execute(text("ANALYZE library_albums"))
        session.execute(text("ANALYZE library_tracks"))
    return {"album_id": albums[0], "fallback_id": albums[2]}


def _anchor(ref, *, session=None, **kwargs):
    return find_anchor_track_row(
        "album", ref, _TARGET, kwargs.pop("exclude", set()), session=session, **kwargs
    )


def _plan_nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from _plan_nodes(child)


def _assert_album_index_plan(session, call):
    plan = session.execute(
        text("EXPLAIN (FORMAT JSON) " + str(call.args[0])), call.args[1]
    ).scalar_one()[0]["Plan"]
    nodes = list(_plan_nodes(plan))
    assert any(
        node.get("Index Name") in _ALBUM_INDEXES and node.get("Index Cond")
        for node in nodes
    ), plan
    assert not any(node.get("Index Name") == _HNSW_INDEX for node in nodes), plan


@pytest.mark.parametrize("by_uid", [False, True], ids=["id", "uid"])
@pytest.mark.parametrize("broad", [False, True], ids=["nearest", "seeded-pool"])
def test_small_album_uses_its_track_index_before_cosine_sort(
    album_anchor_catalog, by_uid, broad
):
    ref = _ALBUM_UID if by_uid else str(album_anchor_catalog["album_id"])
    options = {"selection_seed": "album-pool"} if broad else {}
    with read_scope() as session:
        recorded = MagicMock(wraps=session)
        anchor = _anchor(ref, session=recorded, **options)
        assert anchor["id"] in _ELIGIBLE
        ann_call = next(
            call
            for call in recorded.execute.call_args_list
            if "ORDER BY t.bliss_embedding" in str(call.args[0])
        )
        _assert_album_index_plan(session, ann_call)
        rows = session.execute(ann_call.args[0], ann_call.args[1]).mappings().all()

    assert {row["id"] for row in rows} == (_ELIGIBLE if broad else {1001})
    distances = [row["distance"] for row in rows]
    assert distances == sorted(distances)


def test_album_ids_and_uids_keep_performer_and_scope(album_anchor_catalog):
    for ref in (str(album_anchor_catalog["album_id"]), _ALBUM_UID):
        anchor = _anchor(ref)
        assert anchor["id"] == 1001
        assert anchor["album_id"] == album_anchor_catalog["album_id"]
        assert anchor["album_entity_uid"] == _ALBUM_UID
        assert anchor["artist"] == "Album Scope Performer"
        assert anchor["album_artist"] == "Album Scope Owner"
        assert anchor["bliss_vector"] == [1.0, 0.4] + [0.01] * 18
        assert anchor["bpm"] == 120
        assert anchor["energy"] == pytest.approx(0.7)


def test_album_references_do_not_gain_noncanonical_aliases(album_anchor_catalog):
    local_id = str(album_anchor_catalog["album_id"])
    for ref in (
        "0" + local_id,
        "+" + local_id,
        " " + local_id,
        local_id + " ",
        _ALBUM_UID.upper(),
        "{" + _ALBUM_UID + "}",
        _ALBUM_UID.replace("-", ""),
        "unknown-album",
        "9" * 100,
    ):
        assert _anchor(ref, selection_seed="invalid-scope") is None


def test_album_anchor_preserves_exclusions_family_rotation_and_seed(
    album_anchor_catalog,
):
    ref = _ALBUM_UID
    assert _anchor(ref, exclude={1001, 1004})["id"] == 1002
    assert _anchor(ref, exclude_song_keys={_FAMILY_ONE})["id"] == 1002
    assert _anchor(ref, exclude={1001, 1002, 1004})["id"] == 1003
    assert _anchor(ref, exclude=_ELIGIBLE) is None
    for options in (
        {"recent_song_keys": {_FAMILY_ONE}},
        {"previous_song_keys": {_FAMILY_ONE}},
        {"previous_track_ids": {1001, 1004}},
    ):
        assert _anchor(ref, selection_seed="rotation", **options)["id"] == 1002
    first = _anchor(ref, selection_seed="repeatable-seed")
    second = _anchor(ref, selection_seed="repeatable-seed")
    assert first == second
    assert first["id"] in {1001, 1002, 1004}


@pytest.mark.parametrize("by_uid", [False, True], ids=["id", "uid"])
def test_array_fallback_uses_the_same_indexed_album_scope(album_anchor_catalog, by_uid):
    ref = _FALLBACK_UID if by_uid else str(album_anchor_catalog["fallback_id"])
    with read_scope() as session:
        recorded = MagicMock(wraps=session)
        anchor = _anchor(ref, session=recorded)
        assert anchor["id"] == 8001
        assert anchor["album_id"] == album_anchor_catalog["fallback_id"]
        calls = [
            call
            for call in recorded.execute.call_args_list
            if "FROM library_tracks t" in str(call.args[0])
        ]
        assert len(calls) == 2
        for call in calls:
            _assert_album_index_plan(session, call)


def test_album_scope_reuses_uncommitted_session_and_restores_hnsw_settings(
    album_anchor_catalog,
):
    with read_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET title = 'Pending Album Anchor' WHERE id = 1001"
            )
        )
        session.execute(text("SET LOCAL hnsw.ef_search = 73"))
        session.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        recorded = MagicMock(wraps=session)
        anchor = _anchor(_ALBUM_UID, session=recorded)
        assert anchor["id"] == 1001
        assert anchor["title"] == "Pending Album Anchor"
        assert session.execute(text("SHOW hnsw.ef_search")).scalar_one() == "73"
        assert session.execute(text("SHOW hnsw.iterative_scan")).scalar_one() == (
            "relaxed_order"
        )
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        recorded.close.assert_not_called()
        assert session.in_transaction()

    assert _anchor(_ALBUM_UID)["title"] == "Anchor One"
