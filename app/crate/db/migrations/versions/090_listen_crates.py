"""Create Listen Crates and their collaboration tables."""

from alembic import op

from crate.db.schema_sections.crates_v090 import create_crates_v090_schema


revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_crates_v090_schema(op)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS crate_invites, crate_members, crate_albums, crates
        CASCADE
        """
    )
