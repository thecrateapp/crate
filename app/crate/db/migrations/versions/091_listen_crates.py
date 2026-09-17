"""Create Listen Crates and their collaboration tables."""

from alembic import op

from crate.db.schema_sections.crates_v091 import create_crates_v091_schema


revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_crates_v091_schema(op)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS crate_invites, crate_members, crate_albums, crates
        CASCADE
        """
    )
