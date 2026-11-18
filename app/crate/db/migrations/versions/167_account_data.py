"""Self-service account data exports and per-session sign-in time (M10)."""

from alembic import op

from crate.db.schema_sections.account_data_v167 import (
    create_account_data_v167_schema,
    drop_account_data_v167_schema,
)

revision = "167"
down_revision = "166"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_account_data_v167_schema(op)


def downgrade() -> None:
    drop_account_data_v167_schema(op)
