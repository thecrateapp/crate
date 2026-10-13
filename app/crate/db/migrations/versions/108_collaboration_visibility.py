"""Constrain playlist visibility and retire invite links in favour of owner-added collaborators."""

from alembic import op

from crate.db.schema_sections.collaboration_v108 import (
    create_collaboration_visibility_v108_schema,
)


revision = "108"
down_revision = "107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_collaboration_visibility_v108_schema(op)


def downgrade() -> None:
    op.execute(
        "ALTER TABLE playlists DROP CONSTRAINT IF EXISTS playlists_visibility_check"
    )
