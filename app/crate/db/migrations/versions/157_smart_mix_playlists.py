"""Add Smart Mix playlists and per-track stem jobs (Smart Mix Stems)."""

from alembic import op

from crate.db.schema_sections.smart_mix_playlists_v157 import (
    create_smart_mix_playlists_v157_schema,
    drop_smart_mix_playlists_v157_schema,
)

revision = "157"
down_revision = "156"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_playlists_v157_schema(op)


def downgrade() -> None:
    drop_smart_mix_playlists_v157_schema(op)
