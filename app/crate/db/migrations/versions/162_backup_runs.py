"""Backup runs: the jobs of the backups engine (admin backups, BK1).

Follows 161 (Smart Mix meter signals, PR #409).
"""

from alembic import op

from crate.db.schema_sections.backup_runs_v162 import (
    create_backup_runs_v162_schema,
    drop_backup_runs_v162_schema,
)

revision = "162"
down_revision = "161"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_backup_runs_v162_schema(op)


def downgrade() -> None:
    drop_backup_runs_v162_schema(op)
