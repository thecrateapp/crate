"""Store Smart Mix stem analyses per track and producer (Smart Mix Stems)."""

from alembic import op

from crate.db.schema_sections.smart_mix_stems_v156 import (
    create_smart_mix_stems_v156_schema,
    drop_smart_mix_stems_v156_schema,
)

revision = "156"
down_revision = "155"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_smart_mix_stems_v156_schema(op)


def downgrade() -> None:
    drop_smart_mix_stems_v156_schema(op)
