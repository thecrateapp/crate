"""Add Listen i18n review storage.

Revision ID: 049
Revises: 048
Create Date: 2026-07-04
"""

from collections.abc import Sequence

from alembic import op

revision = "049"
down_revision = "048"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS i18n_bundles (
          id UUID PRIMARY KEY,
          app TEXT NOT NULL,
          locale TEXT NOT NULL,
          source_locale TEXT NOT NULL DEFAULT 'en',
          source_version TEXT NOT NULL,
          bundle_version TEXT NOT NULL,
          status TEXT NOT NULL,
          messages_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          published_at TIMESTAMPTZ NULL,
          UNIQUE (app, locale, source_version, bundle_version)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_i18n_bundles_published
          ON i18n_bundles (app, locale, source_version, published_at DESC)
          WHERE status = 'published'
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS i18n_translation_requests (
          id UUID PRIMARY KEY,
          app TEXT NOT NULL,
          locale TEXT NOT NULL,
          source_version TEXT NOT NULL,
          client TEXT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          task_id UUID NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (app, locale, source_version)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS i18n_translation_requests")
    op.execute("DROP INDEX IF EXISTS idx_i18n_bundles_published")
    op.execute("DROP TABLE IF EXISTS i18n_bundles")
