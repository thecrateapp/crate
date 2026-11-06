"""Admit openai_compatible AI provider connections (SM3-D7)."""

from alembic import op

from crate.db.schema_sections.ai_openai_compatible_v147 import (
    create_ai_openai_compatible_v147_schema,
    drop_ai_openai_compatible_v147_schema,
)

revision = "147"
down_revision = "146"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_ai_openai_compatible_v147_schema(op)


def downgrade() -> None:
    # Deletes unused openai_compatible connections and their stored keys; stops
    # if one has profiles or usage history, which revision 146 cannot read.
    drop_ai_openai_compatible_v147_schema(op)
