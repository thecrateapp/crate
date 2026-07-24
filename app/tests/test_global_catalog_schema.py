import pytest
from sqlalchemy import text
from uuid import UUID

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
        "idx_global_artists_public_slug",
        "idx_global_albums_artist_uid",
        "idx_global_albums_public_route",
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

    with read_scope() as session:
        columns = {
            (row["table_name"], row["column_name"])
            for row in session.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND (
                        (table_name = 'global_catalog_artists' AND column_name = 'public_slug')
                        OR (table_name = 'global_catalog_albums' AND column_name IN ('artist_slug', 'public_slug'))
                      )
                    """
                )
            )
            .mappings()
            .all()
        }

    assert columns == {
        ("global_catalog_artists", "public_slug"),
        ("global_catalog_albums", "artist_slug"),
        ("global_catalog_albums", "public_slug"),
    }


def test_legacy_overlay_taxonomy_insert_receives_global_identity_defaults(pg_db):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_nodes (slug, name, description)
                    VALUES (
                        'legacy-overlay-regression',
                        'Legacy Overlay Regression',
                        'Created through the pre-federation insert contract.'
                    )
                    RETURNING global_genre_uid::text, taxonomy_id, origin
                    """
                )
            )
            .mappings()
            .one()
        )

    assert str(UUID(row["global_genre_uid"])) == row["global_genre_uid"]
    assert row["taxonomy_id"] == "crate-core"
    assert row["origin"] == "overlay"
