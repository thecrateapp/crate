"""Persist a single default model and reasoning choice for AI configuration."""

from alembic import op
from crate.db.schema_sections.ai_configuration_v121 import (
    create_ai_default_model_v121_schema,
)

revision = "131"
down_revision = "130"
branch_labels = None
depends_on = None


def upgrade():
    create_ai_default_model_v121_schema(op)


def downgrade():
    op.execute("ALTER TABLE ai_configuration_state DROP COLUMN IF EXISTS default_model")
