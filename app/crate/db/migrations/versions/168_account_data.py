"""Self-service account data exports and per-session sign-in time."""

from alembic import op

from crate.db.schema_sections.account_data_v168 import (
    create_account_data_v168_schema,
    drop_account_data_v168_schema,
)

revision = "168"
down_revision = "167"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_account_data_v168_schema(op)


def downgrade() -> None:
    drop_account_data_v168_schema(op)
