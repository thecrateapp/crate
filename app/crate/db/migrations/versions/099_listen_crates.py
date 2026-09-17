"""Create Listen Crates and their collaboration tables."""

from alembic import op

from crate.db.schema_sections.crates_v099 import create_crates_v099_schema


revision = "099"
down_revision = "098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_crates_v099_schema(op)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS crate_invites, crate_members, crate_albums, crates
        CASCADE
        """
    )
