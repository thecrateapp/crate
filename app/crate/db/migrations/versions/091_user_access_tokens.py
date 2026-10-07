"""Add scoped opaque access tokens for external clients."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("user_access_tokens"):
        op.create_table(
            "user_access_tokens",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column(
                "token_type",
                sa.Text(),
                nullable=False,
                server_default="virtualdj",
            ),
            sa.Column("token_digest", sa.Text(), nullable=False, unique=True),
            sa.Column("token_prefix", sa.Text(), nullable=False),
            sa.Column(
                "scopes",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        )

    for statement in (
        """
        CREATE INDEX IF NOT EXISTS idx_user_access_tokens_user
        ON user_access_tokens(user_id, created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_user_access_tokens_active_lookup
        ON user_access_tokens(token_digest)
        WHERE revoked_at IS NULL
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_user_access_tokens_expiry
        ON user_access_tokens(expires_at)
        WHERE expires_at IS NOT NULL AND revoked_at IS NULL
        """,
    ):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("user_access_tokens")
