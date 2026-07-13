"""Federation import requests — explicit import approval workflow.

Revision ID: 053
Revises: 052
"""

from collections.abc import Sequence

from alembic import op


revision = "053"
down_revision = "052"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS federation_import_requests (
            id BIGSERIAL PRIMARY KEY,
            request_id UUID NOT NULL UNIQUE,
            node_uid UUID NOT NULL,
            remote_entity_uid TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT 'album',
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_approval',
            requested_by_user_id INTEGER,
            approved_by_user_id INTEGER,
            approved_at TIMESTAMPTZ,
            denied_at TIMESTAMPTZ,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fed_import_requests_node
        ON federation_import_requests(node_uid, status)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_fed_import_requests_node")
    op.execute("DROP TABLE IF EXISTS federation_import_requests")
