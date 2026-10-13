"""Let users opt out of the Crate Pulse top listeners ranking."""

from alembic import op

from crate.db.schema_sections.auth_v106 import create_users_pulse_listed_v106_schema


revision = "106"
down_revision = "105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_users_pulse_listed_v106_schema(op)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS pulse_listed")
