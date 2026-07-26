"""Remove deprecated Navidrome track identifiers."""

from alembic import op
import sqlalchemy as sa


revision = "081"
down_revision = "080"
branch_labels = None
depends_on = None


def _has_navidrome_id_column() -> bool:
    return bool(
        op.get_bind()
        .execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'library_tracks'
                      AND column_name = 'navidrome_id'
                )
                """
            )
        )
        .scalar_one()
    )


def upgrade() -> None:
    if _has_navidrome_id_column():
        op.drop_column("library_tracks", "navidrome_id")


def downgrade() -> None:
    if not _has_navidrome_id_column():
        op.add_column(
            "library_tracks",
            sa.Column("navidrome_id", sa.Text(), nullable=True),
        )
