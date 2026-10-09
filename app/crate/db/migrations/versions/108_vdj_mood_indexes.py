"""Index mood scores so VirtualDJ mood folders never scan library_tracks."""

from alembic import op

from crate.db.schema_sections.vdj_catalog_v108 import (
    VDJ_MOOD_INDEX_MOODS,
    vdj_mood_index_statements,
)


revision = "108"
down_revision = "107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for statement in vdj_mood_index_statements(concurrently=True):
            op.execute(statement)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for mood in VDJ_MOOD_INDEX_MOODS:
            op.execute(
                f"DROP INDEX CONCURRENTLY IF EXISTS idx_library_tracks_mood_{mood}"
            )
