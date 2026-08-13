"""Add detached Auto DJ settings to Jam rooms."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("jam_rooms")}
    if "auto_dj_voting" not in columns:
        op.add_column(
            "jam_rooms",
            sa.Column(
                "auto_dj_voting",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )
    if "genre_filters" not in columns:
        op.add_column(
            "jam_rooms",
            sa.Column(
                "genre_filters",
                postgresql.JSONB(),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )

    op.execute(
        "UPDATE jam_rooms SET auto_dj_voting = true WHERE auto_dj_voting IS NULL"
    )
    op.execute(
        "UPDATE jam_rooms SET genre_filters = '[]'::jsonb WHERE genre_filters IS NULL"
    )


def downgrade() -> None:
    op.drop_column("jam_rooms", "genre_filters")
    op.drop_column("jam_rooms", "auto_dj_voting")
