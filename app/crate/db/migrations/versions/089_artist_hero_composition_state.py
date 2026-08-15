"""Persist whether each Artist Hero composition is active."""

from alembic import op
import sqlalchemy as sa


revision = "089"
down_revision = "088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"] for column in inspector.get_columns("artist_hero_artwork")
    }
    for name in ("desktop_enabled", "mobile_enabled"):
        if name not in existing:
            op.add_column(
                "artist_hero_artwork",
                sa.Column(
                    name,
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )


def downgrade() -> None:
    for name in ("mobile_enabled", "desktop_enabled"):
        op.drop_column("artist_hero_artwork", name)
