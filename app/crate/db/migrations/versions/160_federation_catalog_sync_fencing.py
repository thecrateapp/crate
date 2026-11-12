"""Fence stale federation catalog sync sessions with per-peer generations."""

from alembic import op
from crate.db.schema_sections.federation_catalog_sync_fencing_v160 import (
    create_federation_catalog_sync_fencing_v160_schema,
    drop_federation_catalog_sync_fencing_v160_schema,
)

revision = "160"
down_revision = "159"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_federation_catalog_sync_fencing_v160_schema(op)


def downgrade() -> None:
    drop_federation_catalog_sync_fencing_v160_schema(op)
