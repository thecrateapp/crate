"""Add the curated artist artwork gallery and slot assignments."""

import sqlalchemy as sa
from alembic import op


revision = "084"
down_revision = "083"
branch_labels = None
depends_on = None


_SLOTS = "'avatar', 'background', 'hero_desktop', 'hero_mobile'"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("artist_artwork_assets"):
        op.create_table(
            "artist_artwork_assets",
            sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
            sa.Column(
                "artist_id",
                sa.BIGINT(),
                sa.ForeignKey("library_artists.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("checksum", sa.Text(), nullable=False),
            sa.Column("storage_path", sa.Text(), nullable=False),
            sa.Column("origin", sa.Text(), nullable=False),
            sa.Column("label", sa.Text(), nullable=False),
            sa.Column("mime_type", sa.Text(), nullable=False),
            sa.Column("width", sa.Integer(), nullable=False),
            sa.Column("height", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.UniqueConstraint(
                "artist_id", "checksum", name="uq_artist_artwork_asset_checksum"
            ),
            sa.CheckConstraint(
                "width > 0 AND height > 0",
                name="ck_artist_artwork_asset_dimensions",
            ),
        )
        op.create_index(
            "idx_artist_artwork_assets_artist_created",
            "artist_artwork_assets",
            ["artist_id", "created_at"],
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("artist_artwork_slots"):
        op.create_table(
            "artist_artwork_slots",
            sa.Column(
                "artist_id",
                sa.BIGINT(),
                sa.ForeignKey("library_artists.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("slot", sa.Text(), primary_key=True),
            sa.Column(
                "asset_id",
                sa.BIGINT(),
                sa.ForeignKey("artist_artwork_assets.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.CheckConstraint(
                f"slot IN ({_SLOTS})", name="ck_artist_artwork_slot_name"
            ),
        )
        op.create_index(
            "idx_artist_artwork_slots_asset",
            "artist_artwork_slots",
            ["asset_id"],
        )


def downgrade() -> None:
    op.drop_table("artist_artwork_slots")
    op.drop_table("artist_artwork_assets")
