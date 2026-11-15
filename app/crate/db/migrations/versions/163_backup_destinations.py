"""Backup destinations: the restic repositories of the backups engine (admin backups, BK2)."""

from alembic import op

from crate.db.schema_sections.backup_destinations_v163 import (
    create_backup_destinations_v163_schema,
    drop_backup_destinations_v163_schema,
)

revision = "163"
down_revision = "162"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_backup_destinations_v163_schema(op)


def downgrade() -> None:
    drop_backup_destinations_v163_schema(op)
