"""Bind playback continuation access tokens to the session that issued them."""

from alembic import op

from crate.db.schema_sections.access_tokens_v115 import (
    create_playback_continuation_token_v115_schema,
)


revision = "115"
down_revision = "114"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_playback_continuation_token_v115_schema(op)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_access_tokens_session")
    op.execute("ALTER TABLE user_access_tokens DROP COLUMN IF EXISTS session_id")
