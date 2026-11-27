"""Federation FED2 catalog and peer summaries."""

from alembic import op

from crate.db.schema_sections.federation_catalog_summaries_v169 import (
    create_federation_catalog_summaries_v169_schema,
    drop_federation_catalog_summaries_v169_schema,
)

revision = "169"
down_revision = "168"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_federation_catalog_summaries_v169_schema(op)


def downgrade() -> None:
    # Summaries are derived data; workers and peer fetches rebuild them.
    drop_federation_catalog_summaries_v169_schema(op)
