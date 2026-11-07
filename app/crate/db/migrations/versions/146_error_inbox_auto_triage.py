"""Remember the digest automatic triage last queued for each error issue."""

from alembic import op

from crate.db.schema_sections.error_inbox_auto_triage_v146 import (
    create_error_inbox_auto_triage_v146_schema,
    drop_error_inbox_auto_triage_v146_schema,
)

revision = "146"
down_revision = "145"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_error_inbox_auto_triage_v146_schema(op)


def downgrade() -> None:
    drop_error_inbox_auto_triage_v146_schema(op)
