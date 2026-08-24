"""Seed the initial editorial RSS catalog and persist source languages."""

from collections.abc import Sequence

from alembic import op


revision = "096"
down_revision = "095"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE external_feed_sources
            ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            DROP CONSTRAINT IF EXISTS external_feed_sources_language_check,
            ADD CONSTRAINT external_feed_sources_language_check
            CHECK (language ~ '^[a-z]{2,3}$')
        """
    )
    op.execute(
        """
        INSERT INTO external_feed_sources (
            source_kind, source_url, canonical_url, association_method,
            parser_version, refresh_interval_seconds, source_scope,
            display_name, publisher_name, category, language, ai_policy
        ) VALUES
            (
                'publisher_rss', 'https://metalstorm.net/rss/news.xml',
                'https://metalstorm.net/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Metal Storm', 'Metal Storm', 'metal_punk_hardcore', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://lambgoat.com/rss.xml',
                'https://lambgoat.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Lambgoat', 'Lambgoat', 'metal_punk_hardcore', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://idioteq.com/feed/',
                'https://idioteq.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'IDIOTEQ', 'IDIOTEQ', 'metal_punk_hardcore', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://dyingscene.com/feed/',
                'https://dyingscene.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Dying Scene', 'Dying Scene', 'metal_punk_hardcore', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://www.punktastic.com/feed/',
                'https://www.punktastic.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Punktastic', 'Punktastic', 'metal_punk_hardcore', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://www.scienceofnoise.net/feed/',
                'https://www.scienceofnoise.net/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Science of Noise', 'Science of Noise',
                'metal_punk_hardcore', 'es', 'enabled'
            ),
            (
                'publisher_rss', 'https://ughhblog.com/feed/',
                'https://ughhblog.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Underground Hip Hop Blog', 'Underground Hip Hop Blog',
                'hip_hop', 'en', 'enabled'
            ),
            (
                'publisher_rss', 'https://thewordisbond.com/feed/',
                'https://thewordisbond.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'The Word Is Bond', 'The Word Is Bond', 'hip_hop', 'en',
                'enabled'
            ),
            (
                'publisher_rss', 'https://hiphopdx.com/rss',
                'https://hiphopdx.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'HipHopDX', 'HipHopDX', 'hip_hop', 'en', 'enabled'
            ),
            (
                'publisher_rss', 'https://cvltnation.com/feed/',
                'https://cvltnation.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'CVLT Nation', 'CVLT Nation', 'alternative_underground',
                'en', 'enabled'
            ),
            (
                'publisher_rss', 'https://www.brooklynvegan.com/feed/',
                'https://www.brooklynvegan.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'BrooklynVegan', 'BrooklynVegan', 'alternative_underground',
                'en', 'enabled'
            ),
            (
                'publisher_rss', 'https://scenepointblank.com/blog/rss',
                'https://scenepointblank.com/', 'admin_allowlist',
                'editorial-feed-v1', 86400, 'publisher',
                'Scene Point Blank', 'Scene Point Blank',
                'alternative_underground', 'en', 'enabled'
            )
        ON CONFLICT (source_url) DO UPDATE SET
            source_kind = EXCLUDED.source_kind,
            canonical_url = COALESCE(
                EXCLUDED.canonical_url, external_feed_sources.canonical_url
            ),
            association_method = COALESCE(
                EXCLUDED.association_method,
                external_feed_sources.association_method
            ),
            parser_version = EXCLUDED.parser_version,
            refresh_interval_seconds = EXCLUDED.refresh_interval_seconds,
            source_scope = EXCLUDED.source_scope,
            display_name = COALESCE(
                EXCLUDED.display_name, external_feed_sources.display_name
            ),
            publisher_name = COALESCE(
                EXCLUDED.publisher_name, external_feed_sources.publisher_name
            ),
            category = COALESCE(
                EXCLUDED.category, external_feed_sources.category
            ),
            language = EXCLUDED.language,
            ai_policy = EXCLUDED.ai_policy,
            updated_at = NOW()
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM external_feed_sources
        WHERE source_kind = 'publisher_rss'
          AND source_url IN (
              'https://metalstorm.net/rss/news.xml',
              'https://lambgoat.com/rss.xml',
              'https://idioteq.com/feed/',
              'https://dyingscene.com/feed/',
              'https://www.punktastic.com/feed/',
              'https://www.scienceofnoise.net/feed/',
              'https://ughhblog.com/feed/',
              'https://thewordisbond.com/feed/',
              'https://hiphopdx.com/rss',
              'https://cvltnation.com/feed/',
              'https://www.brooklynvegan.com/feed/',
              'https://scenepointblank.com/blog/rss'
          )
        """
    )
    op.execute(
        """
        ALTER TABLE external_feed_sources
            DROP CONSTRAINT IF EXISTS external_feed_sources_language_check,
            DROP COLUMN IF EXISTS language
        """
    )
