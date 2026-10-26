"""Retain operator plan/source lineage on asynchronous processing generations."""

from alembic import op
from crate.db.schema_sections.operator_generations_v134 import (
    create_operator_generations_v134_schema,
)

revision = "134"
down_revision = "133"
branch_labels = None
depends_on = None


def upgrade():
    create_operator_generations_v134_schema(op)


def downgrade():
    op.execute(
        "ALTER TABLE track_processing_state DROP COLUMN IF EXISTS operator_authority"
    )
