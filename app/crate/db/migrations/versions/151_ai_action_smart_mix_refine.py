"""Admit the `smart_mix.transition.refine` AI action."""

from alembic import op

from crate.db.schema_sections.ai_action_smart_mix_refine_v151 import (
    create_ai_action_smart_mix_refine_v151_schema,
    drop_ai_action_smart_mix_refine_v151_schema,
)

revision = "151"
down_revision = "150"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_ai_action_smart_mix_refine_v151_schema(op)


def downgrade() -> None:
    # Deletes the action's bindings; its invocation history and usage stay.
    drop_ai_action_smart_mix_refine_v151_schema(op)
