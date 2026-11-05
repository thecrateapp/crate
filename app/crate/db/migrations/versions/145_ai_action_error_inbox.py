"""Admit the `ops.error.triage` and `ops.error.investigate` AI actions."""

from alembic import op

from crate.db.schema_sections.ai_action_error_inbox_v145 import (
    create_ai_action_error_inbox_v145_schema,
    drop_ai_action_error_inbox_v145_schema,
)

revision = "145"
down_revision = "144"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_ai_action_error_inbox_v145_schema(op)


def downgrade() -> None:
    # Deletes the two actions' bindings; their invocation history and usage stay.
    drop_ai_action_error_inbox_v145_schema(op)
