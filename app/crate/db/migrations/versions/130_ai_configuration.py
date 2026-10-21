"""Persist inactive AI configuration and atomic invocation budgets."""

from alembic import op
from crate.db.schema_sections.ai_configuration_v120 import (
    create_ai_configuration_v120_schema,
)

revision = "130"
down_revision = "129"
branch_labels = None
depends_on = None


def upgrade():
    create_ai_configuration_v120_schema(op)


def downgrade():
    for table in (
        "ai_legacy_invocation_receipts",
        "ai_usage_daily",
        "ai_invocations",
        "ai_action_bindings",
        "ai_configuration_state",
        "ai_profile_versions",
        "ai_profiles",
        "ai_provider_connections",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
    op.execute("DROP FUNCTION IF EXISTS ai_profile_version_immutable_v120()")
