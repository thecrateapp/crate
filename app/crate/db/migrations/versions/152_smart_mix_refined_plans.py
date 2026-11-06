"""Store Smart Mix refinements (`smart_mix_refined_plans`)."""

from alembic import op

from crate.db.schema_sections.smart_mix_refined_plans_v152 import (
    create_smart_mix_refined_plans_v152_schema,
    drop_smart_mix_refined_plans_v152_schema,
)

revision = "152"
down_revision = "151"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_refined_plans_v152_schema(op)


def downgrade() -> None:
    # Drops the stored refinements; transitions would be refined (and paid) again.
    drop_smart_mix_refined_plans_v152_schema(op)
