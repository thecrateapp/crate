"""Scope favorites and ratings to their owning user.

Revision ID: 098
Revises: 097
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text


revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None


def backfill_legacy_favorite_owners(connection) -> int:
    """Assign ownerless historical favorites to the oldest available admin."""
    owner_id = connection.execute(
        text(
            """
            SELECT id
            FROM users
            WHERE deleted_at IS NULL
            ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
            LIMIT 1
            """
        )
    ).scalar_one_or_none()
    has_orphans = connection.execute(
        text("SELECT EXISTS (SELECT 1 FROM favorites WHERE user_id IS NULL)")
    ).scalar_one()
    if has_orphans and owner_id is None:
        raise RuntimeError("Cannot assign legacy favorites: no non-deleted users exist")
    if not has_orphans:
        return 0
    result = connection.execute(
        text("UPDATE favorites SET user_id = :owner_id WHERE user_id IS NULL"),
        {"owner_id": int(owner_id)},
    )
    return int(result.rowcount or 0)


def upgrade() -> None:
    bind = op.get_bind()
    backfill_legacy_favorite_owners(bind)
    op.execute(
        "ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_item_type_item_id_key"
    )
    op.execute("ALTER TABLE favorites ALTER COLUMN user_id SET NOT NULL")
    op.execute(
        """
        ALTER TABLE favorites
        ADD CONSTRAINT uq_favorites_user_item UNIQUE (user_id, item_type, item_id)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_track_ratings (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE CASCADE,
            global_track_uid UUID REFERENCES global_catalog_tracks(global_track_uid)
                ON DELETE CASCADE,
            rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (track_id IS NOT NULL OR global_track_uid IS NOT NULL)
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_user_track_ratings_local
        ON user_track_ratings (user_id, track_id)
        WHERE track_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_user_track_ratings_global
        ON user_track_ratings (user_id, global_track_uid)
        WHERE global_track_uid IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_track_ratings")
    op.execute("ALTER TABLE favorites DROP CONSTRAINT IF EXISTS uq_favorites_user_item")
    op.execute("ALTER TABLE favorites ALTER COLUMN user_id DROP NOT NULL")
    op.execute(
        """
        ALTER TABLE favorites
        ADD CONSTRAINT favorites_item_type_item_id_key UNIQUE (item_type, item_id)
        """
    )
