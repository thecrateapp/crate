"""Add reusable facets to the genre taxonomy."""

from alembic import op

from crate.db.schema_sections.genre_facets_v136 import (
    create_genre_taxonomy_facets_v136_schema,
)


revision = "136"
down_revision = "135"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_genre_taxonomy_facets_v136_schema(op)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS genre_taxonomy_raw_tag_facets")
    op.execute("DROP TABLE IF EXISTS genre_taxonomy_raw_tag_classifications")
    op.execute("DROP TABLE IF EXISTS genre_taxonomy_node_facets")
    op.execute("DROP TABLE IF EXISTS genre_taxonomy_facet_values")
