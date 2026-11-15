"""Backup policies and their destinations; runs linked to both (admin backups, BK3)."""

from alembic import op

from crate.db.schema_sections.backup_policies_v164 import (
    create_backup_policies_v164_schema,
    drop_backup_policies_v164_schema,
)

revision = "164"
down_revision = "163"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_backup_policies_v164_schema(op)


def downgrade() -> None:
    drop_backup_policies_v164_schema(op)
