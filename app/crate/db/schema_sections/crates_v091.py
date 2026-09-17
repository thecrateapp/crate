"""DDL for Alembic revision 091; keep immutable after the revision ships."""

from typing import Any


def create_crates_v091_schema(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS crates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private', 'public')),
            is_collaborative BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_crates_owner_updated
        ON crates(owner_id, updated_at DESC)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS crate_albums (
            crate_id UUID NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
            global_album_uid UUID NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 0),
            added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (crate_id, global_album_uid)
        )
        """
    )
    cur.execute(
        """
        DO $$ BEGIN
            IF to_regclass('global_catalog_albums') IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'crate_albums'::regclass
                     AND conname = 'fk_crate_albums_global_album'
               ) THEN
                ALTER TABLE crate_albums
                ADD CONSTRAINT fk_crate_albums_global_album
                FOREIGN KEY (global_album_uid)
                REFERENCES global_catalog_albums(global_album_uid)
                ON DELETE CASCADE;
            END IF;
        END $$
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_crate_albums_order
        ON crate_albums(crate_id, position)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS crate_members (
            crate_id UUID NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (crate_id, user_id)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_crate_members_user
        ON crate_members(user_id, created_at DESC)
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS crate_invites (
            token TEXT PRIMARY KEY,
            crate_id UUID NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
            use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_crate_invites_crate_created
        ON crate_invites(crate_id, created_at DESC)
        """
    )
