"""Canonical shows and durable provenance without automatic consolidation."""

from alembic import op

from crate.db.schema_sections.shows_v117 import create_shows_v117_schema

revision = "117"
down_revision = "116"
branch_labels = None
depends_on = None


def upgrade():
    create_shows_v117_schema(op)


def downgrade():
    op.execute("DROP TABLE IF EXISTS show_extraction_drafts")
    op.execute("DROP TABLE IF EXISTS show_sources")
    op.execute("DROP TABLE IF EXISTS show_source_aliases")
    op.execute("DROP TRIGGER IF EXISTS trg_show_revision ON shows")
    op.execute("DROP FUNCTION IF EXISTS bump_show_revision()")
    op.execute("DROP INDEX IF EXISTS idx_shows_artist_date_identity")
    op.execute("DROP INDEX IF EXISTS idx_shows_identity_key")
    op.execute("DROP INDEX IF EXISTS idx_shows_lineup")
    for column in (
        "timezone",
        "doors_time",
        "identity_key",
        "revision",
        "archived_at",
        "field_provenance",
        "merged_into_id",
    ):
        op.execute(f"ALTER TABLE shows DROP COLUMN IF EXISTS {column}")
