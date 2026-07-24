"""Federated catalog index — local index of remote catalog rows.

Revision ID: 052
Revises: 051
"""

from collections.abc import Sequence

from alembic import op


revision = "052"
down_revision = "051"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_catalog_items (
            id BIGSERIAL PRIMARY KEY,
            node_uid UUID NOT NULL,
            remote_entity_uid TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            year TEXT,
            release_date TEXT,
            duration_seconds INTEGER,
            disc_number INTEGER,
            track_number INTEGER,
            track_count INTEGER,
            musicbrainz_artist_mbid TEXT,
            musicbrainz_release_group_mbid TEXT,
            musicbrainz_release_mbid TEXT,
            musicbrainz_recording_mbid TEXT,
            isrc TEXT,
            upc TEXT,
            quality_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            artwork_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            availability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            remote_revision TEXT,
            deleted_at TIMESTAMPTZ,
            tombstone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            search_vector TSVECTOR,
            indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,
            UNIQUE (node_uid, entity_type, remote_entity_uid)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_type_title
        ON federation_catalog_items(entity_type, title)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_node_type
        ON federation_catalog_items(node_uid, entity_type)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_album_lookup
        ON federation_catalog_items(entity_type, artist, title, year)
        WHERE entity_type = 'album' AND deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_search_fts
        ON federation_catalog_items USING gin(search_vector)
        WHERE deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_title_trgm
        ON federation_catalog_items USING gin(title gin_trgm_ops)
        WHERE deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_artist_trgm
        ON federation_catalog_items USING gin(artist gin_trgm_ops)
        WHERE artist IS NOT NULL AND deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_album_trgm
        ON federation_catalog_items USING gin(album gin_trgm_ops)
        WHERE album IS NOT NULL AND deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_catalog_deleted
        ON federation_catalog_items(node_uid, deleted_at)
        WHERE deleted_at IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_catalog_cursors (
            node_uid UUID PRIMARY KEY,
            cursor TEXT,
            full_sync_completed_at TIMESTAMPTZ,
            last_delta_at TIMESTAMPTZ,
            last_error TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS federation_catalog_cursors")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_deleted")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_album_trgm")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_artist_trgm")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_title_trgm")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_search_fts")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_album_lookup")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_node_type")
    op.execute("DROP INDEX IF EXISTS idx_fed_catalog_type_title")
    op.execute("DROP TABLE IF EXISTS federation_catalog_items")
