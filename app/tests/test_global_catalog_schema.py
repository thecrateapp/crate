import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_global_catalog_tables_and_indexes_exist_after_init_db(pg_db):
    from crate.db.tx import read_scope

    expected_tables = {
        "global_catalog_artists",
        "global_catalog_albums",
        "global_catalog_tracks",
        "global_catalog_sources",
        "global_catalog_match_decisions",
        "global_catalog_reconciliation_runs",
        "global_catalog_state",
        "global_catalog_dirty_sources",
        "global_catalog_genre_assertions",
        "global_catalog_entity_genres",
    }
    expected_indexes = {
        "idx_global_artists_mbid_unique",
        "idx_global_artists_normalized_name",
        "idx_global_artists_search_fts",
        "idx_global_artists_name_trgm",
        "idx_global_albums_artist_uid",
        "idx_global_albums_release_mbid_unique",
        "idx_global_albums_search_fts",
        "idx_global_albums_name_trgm",
        "idx_global_tracks_album_uid",
        "idx_global_tracks_recording_mbid_unique",
        "idx_global_tracks_search_fts",
        "idx_global_tracks_title_trgm",
        "idx_global_sources_local_entity_unique",
        "idx_global_sources_remote_entity_unique",
        "idx_global_sources_entity",
        "idx_global_reconciliation_runs_status",
        "idx_global_catalog_dirty_sources_pending",
        "idx_global_catalog_genre_assertions_active",
        "idx_global_catalog_entity_genres_genre",
    }

    with read_scope() as session:
        tables = {
            row["tablename"]
            for row in session.execute(
                text(
                    """
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'public'
                      AND tablename = ANY(:tables)
                    """
                ),
                {"tables": list(expected_tables)},
            )
            .mappings()
            .all()
        }
        indexes = {
            row["indexname"]
            for row in session.execute(
                text(
                    """
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND tablename = ANY(:tables)
                    """
                ),
                {"tables": list(expected_tables)},
            )
            .mappings()
            .all()
        }

    assert expected_tables <= tables
    assert expected_indexes <= indexes
