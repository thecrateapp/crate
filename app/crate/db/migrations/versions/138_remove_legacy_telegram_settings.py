"""Delete the retired built-in Telegram bot settings, including its plaintext token."""

from alembic import op

revision = "138"
down_revision = "137"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "DELETE FROM settings WHERE key IN "
        "('telegram_enabled', 'telegram_bot_token', 'telegram_chat_id')"
    )


def downgrade():
    pass
