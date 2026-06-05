"""Track new-release scan cursor per artist.

Revision ID: 034
Revises: 033
"""

from typing import Sequence, Union

from alembic import op


revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE library_artists ADD COLUMN IF NOT EXISTS new_releases_checked_at TIMESTAMPTZ"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_library_artists_new_releases_checked_at "
        "ON library_artists(new_releases_checked_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_library_artists_new_releases_checked_at")
    op.execute(
        "ALTER TABLE library_artists DROP COLUMN IF EXISTS new_releases_checked_at"
    )
