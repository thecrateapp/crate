"""Store preview track metadata for upcoming releases.

Revision ID: 028
Revises: 027
"""

from typing import Sequence, Union

from alembic import op


revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE new_releases ADD COLUMN IF NOT EXISTS source_name TEXT")
    op.execute("ALTER TABLE new_releases ADD COLUMN IF NOT EXISTS source_url TEXT")
    op.execute("ALTER TABLE new_releases ADD COLUMN IF NOT EXISTS cover_source TEXT")
    op.execute(
        "ALTER TABLE new_releases ADD COLUMN IF NOT EXISTS tracklist_json JSONB DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE new_releases ADD COLUMN IF NOT EXISTS preview_tracks_json JSONB DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE new_releases DROP COLUMN IF EXISTS preview_tracks_json")
    op.execute("ALTER TABLE new_releases DROP COLUMN IF EXISTS tracklist_json")
    op.execute("ALTER TABLE new_releases DROP COLUMN IF EXISTS cover_source")
    op.execute("ALTER TABLE new_releases DROP COLUMN IF EXISTS source_url")
    op.execute("ALTER TABLE new_releases DROP COLUMN IF EXISTS source_name")
