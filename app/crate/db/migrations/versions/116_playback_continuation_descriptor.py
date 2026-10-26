"""Store the queue continuation descriptor on the continuation token."""

from alembic import op

from crate.db.schema_sections.access_tokens_v116 import (
    create_playback_continuation_descriptor_v116_schema,
)


revision = "116"
down_revision = "115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_playback_continuation_descriptor_v116_schema(op)


def downgrade() -> None:
    op.execute(
        "ALTER TABLE user_access_tokens DROP COLUMN IF EXISTS continuation_descriptor"
    )
