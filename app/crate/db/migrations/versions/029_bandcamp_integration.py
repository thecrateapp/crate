"""Bandcamp integration foundation.

Revision ID: 029
Revises: 028
"""

from typing import Sequence, Union

from alembic import op


revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS credential_secrets (
            secret_ref TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_credential_secrets_scope
        ON credential_secrets(scope)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_credential_secrets_expires
        ON credential_secrets(expires_at)
        WHERE expires_at IS NOT NULL
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_connections (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            username TEXT,
            fan_id BIGINT,
            display_name TEXT,
            image_url TEXT,
            status TEXT NOT NULL DEFAULT 'connected',
            session_secret_ref TEXT NOT NULL,
            session_fingerprint TEXT NOT NULL,
            password_secret_ref TEXT,
            connection_method TEXT NOT NULL,
            last_sync_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            last_error TEXT,
            sync_cursor_json JSONB DEFAULT '{}'::jsonb,
            settings_json JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            UNIQUE(user_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_connections_user_status
        ON bandcamp_connections(user_id, status)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_items (
            id SERIAL PRIMARY KEY,
            bandcamp_item_id BIGINT,
            bandcamp_item_type TEXT NOT NULL,
            band_id BIGINT,
            album_id BIGINT,
            track_id BIGINT,
            art_id BIGINT,
            artist_name TEXT,
            album_title TEXT,
            track_title TEXT,
            label_name TEXT,
            item_url TEXT NOT NULL,
            artist_url TEXT,
            album_url TEXT,
            cover_url TEXT,
            release_date DATE,
            tags_json JSONB DEFAULT '[]'::jsonb,
            raw_json JSONB DEFAULT '{}'::jsonb,
            first_seen_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE(item_url)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_items_type_name
        ON bandcamp_items(bandcamp_item_type, lower(coalesce(artist_name, '')), lower(coalesce(album_title, '')))
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS user_bandcamp_items (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            connection_id INTEGER NOT NULL REFERENCES bandcamp_connections(id) ON DELETE CASCADE,
            bandcamp_item_id INTEGER NOT NULL REFERENCES bandcamp_items(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL,
            owned BOOLEAN NOT NULL DEFAULT FALSE,
            downloadable BOOLEAN NOT NULL DEFAULT FALSE,
            purchase_date TIMESTAMPTZ,
            added_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ NOT NULL,
            removed_at TIMESTAMPTZ,
            raw_json JSONB DEFAULT '{}'::jsonb,
            UNIQUE(user_id, bandcamp_item_id, relation_type)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_bandcamp_items_user_relation
        ON user_bandcamp_items(user_id, relation_type, removed_at)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_library_matches (
            id SERIAL PRIMARY KEY,
            bandcamp_item_id INTEGER NOT NULL REFERENCES bandcamp_items(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            entity_uid UUID NOT NULL,
            confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'candidate',
            source TEXT NOT NULL,
            evidence_json JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE(bandcamp_item_id, entity_type, entity_uid)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_library_matches_entity
        ON bandcamp_library_matches(entity_type, entity_uid, status)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_imports (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            connection_id INTEGER REFERENCES bandcamp_connections(id) ON DELETE SET NULL,
            bandcamp_item_id INTEGER NOT NULL REFERENCES bandcamp_items(id) ON DELETE CASCADE,
            task_id TEXT,
            requested_format TEXT NOT NULL DEFAULT 'flac',
            status TEXT NOT NULL DEFAULT 'queued',
            imported_artist_uid UUID,
            imported_album_uid UUID,
            imported_track_uids UUID[] DEFAULT '{}',
            source_archive_url TEXT,
            source_archive_sha256 TEXT,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_imports_user_status
        ON bandcamp_imports(user_id, status, created_at DESC)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_radar_items (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            bandcamp_item_id INTEGER REFERENCES bandcamp_items(id) ON DELETE CASCADE,
            scope TEXT NOT NULL,
            source TEXT NOT NULL,
            score DOUBLE PRECISION NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'new',
            reason_json JSONB DEFAULT '{}'::jsonb,
            first_seen_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE(user_id, bandcamp_item_id, source)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_radar_user_status
        ON bandcamp_radar_items(user_id, status, score DESC)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS bandcamp_pairing_challenges (
            pairing_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            connection_method TEXT NOT NULL,
            task_id TEXT,
            result_json JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_bandcamp_pairing_user_status
        ON bandcamp_pairing_challenges(user_id, status, expires_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bandcamp_pairing_challenges")
    op.execute("DROP TABLE IF EXISTS bandcamp_radar_items")
    op.execute("DROP TABLE IF EXISTS bandcamp_imports")
    op.execute("DROP TABLE IF EXISTS bandcamp_library_matches")
    op.execute("DROP TABLE IF EXISTS user_bandcamp_items")
    op.execute("DROP TABLE IF EXISTS bandcamp_items")
    op.execute("DROP TABLE IF EXISTS bandcamp_connections")
    op.execute("DROP TABLE IF EXISTS credential_secrets")
