"""Require the bootstrap admin to replace the initial password on first sign-in."""

from alembic import op

from crate.db.schema_sections.auth_v167 import (
    create_users_password_change_required_v167_schema,
)


revision = "167"
down_revision = "166"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_users_password_change_required_v167_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS password_change_required")
