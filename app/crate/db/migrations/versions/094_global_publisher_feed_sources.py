"""Add admin-managed global publisher RSS sources."""

from collections.abc import Sequence

from alembic import op


revision = "094"
down_revision = "093"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_sources
            DROP CONSTRAINT IF EXISTS external_feed_sources_source_kind_check
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD CONSTRAINT external_feed_sources_source_kind_check
            CHECK (source_kind IN (
                'bandcamp_rss', 'publisher_rss', 'artist_site', 'label',
                'newsletter', 'blog', 'event_page'
            ))
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD COLUMN IF NOT EXISTS source_scope TEXT NOT NULL DEFAULT 'artist',
            ADD COLUMN IF NOT EXISTS display_name TEXT,
            ADD COLUMN IF NOT EXISTS publisher_name TEXT,
            ADD COLUMN IF NOT EXISTS category TEXT,
            ADD COLUMN IF NOT EXISTS logo_url TEXT,
            ADD COLUMN IF NOT EXISTS terms_url TEXT,
            ADD COLUMN IF NOT EXISTS ai_policy TEXT NOT NULL DEFAULT 'enabled'
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD CONSTRAINT external_feed_sources_scope_check
            CHECK (source_scope IN ('artist', 'label', 'publisher'))
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD CONSTRAINT external_feed_sources_ai_policy_check
            CHECK (ai_policy IN ('enabled', 'manual', 'disabled'))
        """
    )
    op.execute(
        """
        INSERT INTO external_feed_sources (
            source_kind, source_url, canonical_url, association_method,
            parser_version, refresh_interval_seconds, source_scope,
            display_name, publisher_name, category, ai_policy
        ) VALUES
            (
                'publisher_rss',
                'https://pitchfork.com/feed/rss',
                'https://pitchfork.com/',
                'admin_allowlist',
                'editorial-feed-v1',
                86400,
                'publisher',
                'Pitchfork',
                'Pitchfork',
                'music_news',
                'enabled'
            ),
            (
                'publisher_rss',
                'https://daily.bandcamp.com/feed',
                'https://daily.bandcamp.com/',
                'admin_allowlist',
                'editorial-feed-v1',
                86400,
                'publisher',
                'Bandcamp Daily',
                'Bandcamp Daily',
                'music_news',
                'enabled'
            )
        ON CONFLICT (source_url) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM external_feed_sources
        WHERE source_kind = 'publisher_rss'
          AND source_url IN (
              'https://pitchfork.com/feed/rss',
              'https://daily.bandcamp.com/feed'
          )
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            DROP CONSTRAINT IF EXISTS external_feed_sources_ai_policy_check,
            DROP CONSTRAINT IF EXISTS external_feed_sources_scope_check,
            DROP COLUMN IF EXISTS ai_policy,
            DROP COLUMN IF EXISTS terms_url,
            DROP COLUMN IF EXISTS logo_url,
            DROP COLUMN IF EXISTS category,
            DROP COLUMN IF EXISTS publisher_name,
            DROP COLUMN IF EXISTS display_name,
            DROP COLUMN IF EXISTS source_scope
        """
    )
    op.execute(
        """
        UPDATE external_feed_sources
        SET source_kind = 'blog'
        WHERE source_kind = 'publisher_rss'
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            DROP CONSTRAINT IF EXISTS external_feed_sources_source_kind_check
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD CONSTRAINT external_feed_sources_source_kind_check
            CHECK (source_kind IN (
                'bandcamp_rss', 'artist_site', 'label', 'newsletter',
                'blog', 'event_page'
            ))
        """
    )
