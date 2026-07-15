"""Add durable federation catalog changes and resumable sync state.

Revision ID: 066
Revises: 065
"""

from collections.abc import Sequence

from alembic import op


revision = "066"
down_revision = "065"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE federation_catalog_changes (
            sequence BIGSERIAL PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_uid TEXT NOT NULL,
            operation TEXT NOT NULL
                CHECK (operation IN ('upsert', 'delete', 'hide', 'restore')),
            payload_revision TEXT NOT NULL,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            retention_until TIMESTAMPTZ NOT NULL,
            UNIQUE (entity_type, entity_uid, payload_revision, operation)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_catalog_changes_entity
        ON federation_catalog_changes (entity_type, entity_uid, sequence DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_catalog_changes_retention
        ON federation_catalog_changes (retention_until, sequence)
        """
    )
    op.execute(
        """
        ALTER TABLE federation_catalog_cursors
            ADD COLUMN last_applied_cursor BIGINT,
            ADD COLUMN snapshot_cursor BIGINT,
            ADD COLUMN sync_session_uid UUID,
            ADD COLUMN last_full_verified_at TIMESTAMPTZ,
            ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN retry_after TIMESTAMPTZ,
            ADD COLUMN failure_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )
    op.execute(
        """
        ALTER TABLE federation_catalog_items
            ADD COLUMN last_seen_sync_session_uid UUID
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_catalog_items_sync_session
        ON federation_catalog_items (node_uid, last_seen_sync_session_uid)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_catalog_items_sync_session")
    op.execute(
        "ALTER TABLE federation_catalog_items "
        "DROP COLUMN IF EXISTS last_seen_sync_session_uid"
    )
    op.execute(
        """
        ALTER TABLE federation_catalog_cursors
            DROP COLUMN IF EXISTS failure_metadata,
            DROP COLUMN IF EXISTS retry_after,
            DROP COLUMN IF EXISTS consecutive_failures,
            DROP COLUMN IF EXISTS last_full_verified_at,
            DROP COLUMN IF EXISTS sync_session_uid,
            DROP COLUMN IF EXISTS snapshot_cursor,
            DROP COLUMN IF EXISTS last_applied_cursor
        """
    )
    op.execute("DROP INDEX IF EXISTS idx_federation_catalog_changes_retention")
    op.execute("DROP INDEX IF EXISTS idx_federation_catalog_changes_entity")
    op.execute("DROP TABLE IF EXISTS federation_catalog_changes")
