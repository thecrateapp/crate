"""Crate Decks cues and corrections per user and track (S7, F8.S-PR1)."""

from alembic import op

from crate.db.schema_sections.decks_cues_v166 import (
    create_decks_cues_v166_schema,
    drop_decks_cues_v166_schema,
)

revision = "166"
down_revision = "165"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_decks_cues_v166_schema(op)


def downgrade() -> None:
    # Drops every user's synchronised Decks cues and corrections.
    drop_decks_cues_v166_schema(op)
