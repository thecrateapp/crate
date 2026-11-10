"""Publish committed catalog intents in a cursor-safe order."""

from alembic import op
from crate.db.schema_sections.federation_catalog_publication_v159 import (
    create_federation_catalog_publication_v159_schema,
    drop_federation_catalog_publication_v159_schema,
)

revision = "159"
down_revision = "158"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_federation_catalog_publication_v159_schema(op)


def downgrade() -> None:
    drop_federation_catalog_publication_v159_schema(op)
