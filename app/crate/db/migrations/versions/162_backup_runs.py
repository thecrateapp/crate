"""Backup runs: the jobs of the backups engine (admin backups, BK1).

Numbered 162 because PR #409 (Smart Mix analyzer v10) takes 161. It follows 160,
the head of main, until #409 merges; then its down revision becomes 161.
"""

from alembic import op

from crate.db.schema_sections.backup_runs_v162 import (
    create_backup_runs_v162_schema,
    drop_backup_runs_v162_schema,
)

revision = "162"
down_revision = "160"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_backup_runs_v162_schema(op)


def downgrade() -> None:
    drop_backup_runs_v162_schema(op)
