"""The last snapshot listing of each backup destination (admin backups, BK4)."""

from alembic import op

from crate.db.schema_sections.backup_destination_snapshots_v165 import (
    create_backup_destination_snapshots_v165_schema,
    drop_backup_destination_snapshots_v165_schema,
)

revision = "165"
down_revision = "164"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_backup_destination_snapshots_v165_schema(op)


def downgrade() -> None:
    drop_backup_destination_snapshots_v165_schema(op)
