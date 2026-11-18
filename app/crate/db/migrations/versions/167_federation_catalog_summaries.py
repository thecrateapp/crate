"""Federation FED2 catalog and peer summaries."""

from alembic import op

from crate.db.schema_sections.federation_catalog_summaries_v167 import (
    create_federation_catalog_summaries_v167_schema,
    drop_federation_catalog_summaries_v167_schema,
)

revision = "167"
down_revision = "166"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_federation_catalog_summaries_v167_schema(op)


def downgrade() -> None:
    # Summaries are derived data; workers and peer fetches rebuild them.
    drop_federation_catalog_summaries_v167_schema(op)
