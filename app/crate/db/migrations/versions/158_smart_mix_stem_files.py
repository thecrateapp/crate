"""Add the stem files the server keeps for Crate Decks (Smart Mix Stems)."""

from alembic import op

from crate.db.schema_sections.smart_mix_stem_files_v158 import (
    create_smart_mix_stem_files_v158_schema,
    drop_smart_mix_stem_files_v158_schema,
)

revision = "158"
down_revision = "157"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_stem_files_v158_schema(op)


def downgrade() -> None:
    drop_smart_mix_stem_files_v158_schema(op)
