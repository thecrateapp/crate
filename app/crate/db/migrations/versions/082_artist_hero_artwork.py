"""Add editorial artist-hero artwork profiles."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "082"
down_revision = "081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("artist_hero_artwork"):
        return
    op.create_table(
        "artist_hero_artwork",
        sa.Column(
            "artist_id",
            sa.BIGINT(),
            sa.ForeignKey("library_artists.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column("review_status", sa.Text(), nullable=False),
        sa.Column("source_width", sa.Integer(), nullable=False),
        sa.Column("source_height", sa.Integer(), nullable=False),
        sa.Column("desktop_recipe", postgresql.JSONB(), nullable=False),
        sa.Column("mobile_recipe", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint(
            "provenance IN ('manual', 'derived_background')",
            name="ck_artist_hero_artwork_provenance",
        ),
        sa.CheckConstraint(
            "review_status IN ('approved', 'unreviewed', 'rejected')",
            name="ck_artist_hero_artwork_review_status",
        ),
        sa.CheckConstraint(
            "source_width > 0 AND source_height > 0",
            name="ck_artist_hero_artwork_source_dimensions",
        ),
    )
    op.create_index(
        "idx_artist_hero_artwork_selection",
        "artist_hero_artwork",
        ["review_status", "provenance", "updated_at"],
    )


def downgrade() -> None:
    op.drop_table("artist_hero_artwork")
