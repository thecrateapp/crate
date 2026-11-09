"""Error fix runs: track each Launch fix attempt and its pull request."""

from alembic import op

from crate.db.schema_sections.error_fix_runs_v154 import (
    create_error_fix_runs_v154_schema,
    drop_error_fix_runs_v154_schema,
)

revision = "154"
down_revision = "153"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_error_fix_runs_v154_schema(op)


def downgrade() -> None:
    drop_error_fix_runs_v154_schema(op)
