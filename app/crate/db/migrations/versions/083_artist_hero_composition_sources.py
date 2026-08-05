"""Add independent source metadata for artist-hero compositions."""

from alembic import op
import sqlalchemy as sa


revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


_COLUMNS = (
    "desktop_source_width",
    "desktop_source_height",
    "mobile_source_width",
    "mobile_source_height",
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"] for column in inspector.get_columns("artist_hero_artwork")
    }
    for name in _COLUMNS:
        if name not in existing:
            op.add_column(
                "artist_hero_artwork", sa.Column(name, sa.Integer(), nullable=True)
            )
    for name in ("desktop_source_origin", "mobile_source_origin"):
        if name not in existing:
            op.add_column(
                "artist_hero_artwork", sa.Column(name, sa.Text(), nullable=True)
            )


def downgrade() -> None:
    for name in (
        "mobile_source_origin",
        "desktop_source_origin",
        "mobile_source_height",
        "mobile_source_width",
        "desktop_source_height",
        "desktop_source_width",
    ):
        op.drop_column("artist_hero_artwork", name)
