"""Harden remote import state, idempotency and storage accounting.

Revision ID: 067
Revises: 066
"""

from collections.abc import Sequence

from alembic import op


revision = "067"
down_revision = "066"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE federation_import_requests
            ADD COLUMN idempotency_key TEXT,
            ADD COLUMN global_album_uid UUID,
            ADD COLUMN expected_bytes BIGINT,
            ADD COLUMN reserved_bytes BIGINT NOT NULL DEFAULT 0,
            ADD COLUMN received_bytes BIGINT NOT NULL DEFAULT 0,
            ADD COLUMN manifest_digest TEXT,
            ADD COLUMN approval_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN staging_relative_path TEXT,
            ADD COLUMN cleanup_deadline TIMESTAMPTZ,
            ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN completed_at TIMESTAMPTZ,
            ADD COLUMN failure_reason TEXT
        """
    )
    op.execute(
        """
        UPDATE federation_import_requests
        SET status = CASE status
            WHEN 'pending_approval' THEN 'awaiting_approval'
            WHEN 'queued' THEN 'approved'
            WHEN 'denied' THEN 'cancelled'
            ELSE status
        END,
        idempotency_key = encode(sha256(convert_to(
            COALESCE(requested_by_user_id::text, 'system') || ':' ||
            node_uid::text || ':' || remote_entity_uid,
            'UTF8'
        )), 'hex'),
        cleanup_deadline = COALESCE(cleanup_deadline, created_at + INTERVAL '24 hours')
        """
    )
    op.execute(
        """
        ALTER TABLE federation_import_requests
            ALTER COLUMN status SET DEFAULT 'awaiting_approval',
            ALTER COLUMN idempotency_key SET NOT NULL,
            ADD CONSTRAINT uq_federation_import_idempotency
                UNIQUE (idempotency_key),
            ADD CONSTRAINT ck_federation_import_status CHECK (status IN (
                'requested', 'awaiting_approval', 'approved', 'reserving',
                'downloading', 'verifying', 'importing', 'completed',
                'cancelled', 'failed', 'cleaned'
            )),
            ADD CONSTRAINT ck_federation_import_bytes CHECK (
                COALESCE(expected_bytes, 0) >= 0 AND
                reserved_bytes >= 0 AND received_bytes >= 0
            ),
            ADD CONSTRAINT ck_federation_import_staging_relative CHECK (
                staging_relative_path IS NULL OR (
                    staging_relative_path !~ '^/' AND
                    staging_relative_path !~ '(^|/)\\.\\.(/|$)'
                )
            )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_federation_import_cleanup
        ON federation_import_requests (cleanup_deadline, status)
        WHERE status NOT IN ('completed', 'cleaned')
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_federation_import_cleanup")
    op.execute(
        "ALTER TABLE federation_import_requests "
        "DROP CONSTRAINT IF EXISTS ck_federation_import_status"
    )
    op.execute(
        """
        UPDATE federation_import_requests
        SET status = CASE status
            WHEN 'awaiting_approval' THEN 'pending_approval'
            WHEN 'requested' THEN 'pending_approval'
            WHEN 'reserving' THEN 'approved'
            WHEN 'downloading' THEN 'importing'
            WHEN 'verifying' THEN 'importing'
            WHEN 'cancelled' THEN 'denied'
            WHEN 'cleaned' THEN 'failed'
            ELSE status
        END
        """
    )
    op.execute(
        """
        ALTER TABLE federation_import_requests
            DROP CONSTRAINT IF EXISTS ck_federation_import_staging_relative,
            DROP CONSTRAINT IF EXISTS ck_federation_import_bytes,
            DROP CONSTRAINT IF EXISTS uq_federation_import_idempotency,
            DROP COLUMN IF EXISTS failure_reason,
            DROP COLUMN IF EXISTS completed_at,
            DROP COLUMN IF EXISTS updated_at,
            DROP COLUMN IF EXISTS cleanup_deadline,
            DROP COLUMN IF EXISTS staging_relative_path,
            DROP COLUMN IF EXISTS approval_metadata,
            DROP COLUMN IF EXISTS manifest_digest,
            DROP COLUMN IF EXISTS received_bytes,
            DROP COLUMN IF EXISTS reserved_bytes,
            DROP COLUMN IF EXISTS expected_bytes,
            DROP COLUMN IF EXISTS global_album_uid,
            DROP COLUMN IF EXISTS idempotency_key
        """
    )
