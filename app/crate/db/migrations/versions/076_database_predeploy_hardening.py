"""Add indexes required by high-volume foreign-key operations.

Revision ID: 076
Revises: 075
"""

from collections.abc import Sequence

from alembic import op


revision = "076"
down_revision = "075"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_global_track_likes_global_track_uid
        ON user_global_track_likes(global_track_uid)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_federation_nodes_directory_candidate_id
        ON federation_nodes(directory_candidate_id)
        WHERE directory_candidate_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_bandcamp_imports_bandcamp_item_id
        ON bandcamp_imports(bandcamp_item_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_bandcamp_imports_connection_id
        ON bandcamp_imports(connection_id)
        WHERE connection_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_bandcamp_radar_items_bandcamp_item_id
        ON bandcamp_radar_items(bandcamp_item_id)
        WHERE bandcamp_item_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_bandcamp_items_bandcamp_item_id
        ON user_bandcamp_items(bandcamp_item_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_bandcamp_items_connection_id
        ON user_bandcamp_items(connection_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_bandcamp_items_connection_id")
    op.execute("DROP INDEX IF EXISTS idx_user_bandcamp_items_bandcamp_item_id")
    op.execute("DROP INDEX IF EXISTS idx_bandcamp_radar_items_bandcamp_item_id")
    op.execute("DROP INDEX IF EXISTS idx_bandcamp_imports_connection_id")
    op.execute("DROP INDEX IF EXISTS idx_bandcamp_imports_bandcamp_item_id")
    op.execute("DROP INDEX IF EXISTS idx_federation_nodes_directory_candidate_id")
    op.execute("DROP INDEX IF EXISTS idx_user_global_track_likes_global_track_uid")
