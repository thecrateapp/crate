"""Add durable storage for external feed sources and normalized items."""

from collections.abc import Sequence

from alembic import op


revision = "090"
down_revision = "089"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS external_feed_sources (
            id BIGSERIAL PRIMARY KEY,
            source_kind TEXT NOT NULL
                CHECK (source_kind IN (
                    'bandcamp_rss', 'artist_site', 'label', 'newsletter',
                    'blog', 'event_page'
                )),
            source_url TEXT NOT NULL UNIQUE,
            canonical_url TEXT,
            artist_id BIGINT REFERENCES library_artists(id) ON DELETE CASCADE,
            association_method TEXT,
            state TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('active', 'degraded', 'disabled', 'not_found')),
            parser_version TEXT NOT NULL,
            refresh_interval_seconds INTEGER NOT NULL DEFAULT 21600
                CHECK (refresh_interval_seconds BETWEEN 300 AND 604800),
            etag TEXT,
            last_modified TEXT,
            last_checked_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            last_error_at TIMESTAMPTZ,
            last_error TEXT,
            consecutive_failures INTEGER NOT NULL DEFAULT 0
                CHECK (consecutive_failures >= 0),
            next_fetch_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS external_feed_items (
            id BIGSERIAL PRIMARY KEY,
            source_id BIGINT NOT NULL REFERENCES
                external_feed_sources(id) ON DELETE CASCADE,
            artist_id BIGINT REFERENCES library_artists(id) ON DELETE SET NULL,
            item_kind TEXT NOT NULL
                CHECK (item_kind IN ('news', 'announcement', 'release', 'other')),
            state TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('active', 'duplicate', 'rejected', 'stale')),
            external_guid TEXT,
            source_url TEXT NOT NULL,
            canonical_url TEXT,
            title TEXT NOT NULL,
            author TEXT,
            excerpt TEXT,
            published_at TIMESTAMPTZ,
            discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            content_hash TEXT NOT NULL,
            duplicate_of_id BIGINT REFERENCES
                external_feed_items(id) ON DELETE SET NULL,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            parser_version TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_external_feed_item_source_guid
        ON external_feed_items (source_id, external_guid)
        WHERE external_guid IS NOT NULL AND external_guid <> ''
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_external_feed_item_source_url
        ON external_feed_items (source_id, canonical_url)
        WHERE canonical_url IS NOT NULL AND canonical_url <> ''
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_sources_due
        ON external_feed_sources (state, next_fetch_at, id)
        WHERE state IN ('active', 'degraded')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_sources_artist
        ON external_feed_sources (artist_id, state)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_items_source_date
        ON external_feed_items (source_id, published_at DESC NULLS LAST, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_items_artist_date
        ON external_feed_items (artist_id, published_at DESC NULLS LAST, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_external_feed_items_hash
        ON external_feed_items (content_hash)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_external_feed_items_hash")
    op.execute("DROP INDEX IF EXISTS idx_external_feed_items_artist_date")
    op.execute("DROP INDEX IF EXISTS idx_external_feed_items_source_date")
    op.execute("DROP INDEX IF EXISTS idx_external_feed_sources_artist")
    op.execute("DROP INDEX IF EXISTS idx_external_feed_sources_due")
    op.execute("DROP INDEX IF EXISTS uq_external_feed_item_source_url")
    op.execute("DROP INDEX IF EXISTS uq_external_feed_item_source_guid")
    op.execute("DROP TABLE IF EXISTS external_feed_items")
    op.execute("DROP TABLE IF EXISTS external_feed_sources")
