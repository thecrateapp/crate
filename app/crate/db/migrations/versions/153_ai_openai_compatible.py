"""Admit openai_compatible AI provider connections (SM3-D7)."""

from alembic import op

from crate.db.schema_sections.ai_openai_compatible_v153 import (
    create_ai_openai_compatible_v153_schema,
    drop_ai_openai_compatible_v153_schema,
)

revision = "153"
down_revision = "152"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_ai_openai_compatible_v153_schema(op)


def downgrade() -> None:
    # Deletes unused openai_compatible connections and their stored keys; stops
    # if one has profiles or usage history, which revision 152 cannot read.
    drop_ai_openai_compatible_v153_schema(op)
