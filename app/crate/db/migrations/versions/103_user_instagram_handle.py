"""Store an optional Instagram handle on user profiles."""

from alembic import op

from crate.db.schema_sections.auth_v103 import create_users_instagram_v103_schema


revision = "103"
down_revision = "102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_users_instagram_v103_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS instagram_handle")
