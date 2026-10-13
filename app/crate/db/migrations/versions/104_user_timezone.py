"""Store the IANA timezone used to bucket a user's listening stats."""

from alembic import op

from crate.db.schema_sections.auth_v104 import create_users_timezone_v104_schema


revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_users_timezone_v104_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS timezone")
