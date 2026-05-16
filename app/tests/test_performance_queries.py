"""Performance regression tests for browse and critical query paths.

These tests encode stable performance invariants: required hot-path indexes
and query-count guards. They intentionally avoid asserting ``Seq Scan`` absence
on tiny fixtures because PostgreSQL can correctly prefer a sequential scan
even when the right index exists.
"""

import pytest
from sqlalchemy import event, text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _index_definitions(session) -> dict[str, str]:
    rows = session.execute(
        text(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            """
        )
    ).mappings()
    return {str(row["indexname"]): str(row["indexdef"]) for row in rows}


def _assert_indexes_exist(indexes: dict[str, str], names: set[str]) -> None:
    missing = sorted(names - indexes.keys())
    assert not missing, f"missing expected performance indexes: {missing}"


def test_perf_browse_artist_tracks_required_indexes_exist(pg_db):
    """Artist track browse must keep its filtering and ordering indexes."""
    from crate.db.tx import read_scope

    with read_scope() as session:
        indexes = _index_definitions(session)
        _assert_indexes_exist(
            indexes,
            {
                "idx_lib_tracks_artist",
                "idx_lib_tracks_lower_artist_lower_title",
                "idx_lib_tracks_lastfm_playcount",
                "idx_lib_tracks_album",
            },
        )


def test_perf_browse_media_search_required_indexes_exist(pg_db):
    """Search tracks must keep trigram and join indexes used by ILIKE search."""
    from crate.db.tx import read_scope

    with read_scope() as session:
        indexes = _index_definitions(session)
        _assert_indexes_exist(
            indexes,
            {
                "idx_tracks_title_trgm",
                "idx_albums_name_trgm",
                "idx_lib_tracks_album",
                "idx_lib_albums_lower_artist_lower_name",
            },
        )


def test_perf_browse_album_join_required_indexes_exist(pg_db):
    """Album-to-track browse joins must keep indexes on both sides."""
    from crate.db.tx import read_scope

    with read_scope() as session:
        indexes = _index_definitions(session)
        _assert_indexes_exist(
            indexes,
            {
                "idx_lib_albums_artist",
                "idx_lib_albums_lower_artist_id",
                "idx_lib_tracks_album",
            },
        )


# ── N+1 query detection ───────────────────────────────────────────────


def test_perf_browse_media_search_not_n_plus_one(pg_db):
    """A browse search call must not execute per-row subqueries.

    This test uses SA engine event listeners to count the total number
    of statement executions during a search call. If the query path is
    doing N+1, the count will spike with each additional track inserted.
    """

    artist_name = "N1Artist"
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "N1Album",
            "path": f"/music/{artist_name}/N1Album",
            "track_count": 5,
            "total_size": 5120,
            "total_duration": 900.0,
            "formats": ["flac"],
        }
    )

    for i in range(5):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": "N1Album",
                "filename": f"{i:02d}-n1.flac",
                "title": f"N1 Track {i}",
                "path": f"/music/{artist_name}/N1Album/{i:02d}-n1.flac",
                "duration": 180.0,
                "size": 1024,
                "format": "flac",
            }
        )

    from crate.db import engine as db_engine

    sa_engine = db_engine.get_engine()
    counts = []

    @event.listens_for(sa_engine, "before_cursor_execute")
    def _count(conn, cursor, statement, parameters, context, executemany):
        counts.append(1)

    try:
        from crate.db.queries.browse_media_search import search_tracks

        search_tracks("%n1%", limit=5)

        # With 5 tracks seeded, a non-N+1 search should stay under ~10
        # statement executions (main search + maybe a count or ctid join).
        # N+1 would produce 1 + 5*N executions.
        query_count = len(counts)
        assert query_count < 10, (
            f"search_tracks executed {query_count} statements; "
            "possible N+1 pattern detected"
        )
    finally:
        event.remove(sa_engine, "before_cursor_execute", _count)


def test_perf_browse_related_albums_not_n_plus_one(pg_db):
    """get_related_albums must not execute per-album subqueries."""

    from crate.db.queries.browse import get_related_albums
    from crate.db import engine as db_engine

    artist_name = "N1RelatedArtist"
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "N1RelatedAlbum",
            "path": f"/music/{artist_name}/N1RelatedAlbum",
            "track_count": 1,
            "total_size": 1024,
            "total_duration": 180.0,
            "formats": ["flac"],
        }
    )

    sa_engine = db_engine.get_engine()
    counts = []

    @event.listens_for(sa_engine, "before_cursor_execute")
    def _count(conn, cursor, statement, parameters, context, executemany):
        counts.append(1)

    try:
        get_related_albums(album_id, artist_name, "2020", [])
        query_count = len(counts)
        assert query_count < 10, (
            f"get_related_albums executed {query_count} statements; "
            "possible N+1 pattern detected"
        )
    finally:
        event.remove(sa_engine, "before_cursor_execute", _count)
