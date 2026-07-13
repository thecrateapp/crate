"""Version the complete user-reference catalog projection.

Revision ID: 061
Revises: 060
"""

from collections.abc import Sequence

from alembic import op


revision = "061"
down_revision = "060"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE global_catalog_state
        ADD COLUMN IF NOT EXISTS user_refs_backfill_version INTEGER NOT NULL DEFAULT 0
        """
    )
    op.execute(
        """
        ALTER TABLE global_catalog_state
        ADD COLUMN IF NOT EXISTS user_refs_backfill_report_json JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )
    op.execute(
        """
        ALTER TABLE playlist_track_exclusions
        ADD COLUMN IF NOT EXISTS global_track_uid UUID
        """
    )
    op.execute("DROP INDEX IF EXISTS idx_playlist_track_exclusions_identity")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_exclusions_identity
        ON playlist_track_exclusions(
            playlist_id,
            COALESCE(global_track_uid::text, ''),
            COALESCE(track_entity_uid::text, ''),
            COALESCE(track_storage_id::text, ''),
            COALESCE(track_path, ''),
            COALESCE(track_id::text, '')
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_track_exclusions_global_track_uid
        ON playlist_track_exclusions(global_track_uid)
        WHERE global_track_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_local_track_id
        ON global_catalog_tracks(local_track_id)
        WHERE local_track_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_global_tracks_local_track_entity_uid
        ON global_catalog_tracks(local_track_entity_uid)
        WHERE local_track_entity_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_global_tracks_local_track_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_global_tracks_local_track_id")
    op.execute("DROP INDEX IF EXISTS idx_playlist_track_exclusions_global_track_uid")
    op.execute("DROP INDEX IF EXISTS idx_playlist_track_exclusions_identity")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_exclusions_identity
        ON playlist_track_exclusions(
            playlist_id,
            COALESCE(track_entity_uid::text, ''),
            COALESCE(track_storage_id::text, ''),
            COALESCE(track_path, ''),
            COALESCE(track_id::text, '')
        )
        """
    )
    op.execute(
        "ALTER TABLE playlist_track_exclusions DROP COLUMN IF EXISTS global_track_uid"
    )
    op.execute(
        "ALTER TABLE global_catalog_state DROP COLUMN IF EXISTS user_refs_backfill_report_json"
    )
    op.execute(
        "ALTER TABLE global_catalog_state DROP COLUMN IF EXISTS user_refs_backfill_version"
    )
