"""Native device tokens: device_id and one active token per session and device."""

from alembic import op

from crate.db.schema_sections.native_device_tokens_v170 import (
    create_native_device_tokens_v170_schema,
    drop_native_device_tokens_v170_schema,
)

revision = "170"
down_revision = "169"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_native_device_tokens_v170_schema(op)


def downgrade() -> None:
    drop_native_device_tokens_v170_schema(op)
