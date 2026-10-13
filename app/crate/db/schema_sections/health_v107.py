from __future__ import annotations

from typing import Any


def create_health_issue_identity_v107_schema(cur: Any) -> None:
    cur.execute("ALTER TABLE health_issues ADD COLUMN IF NOT EXISTS identity_key TEXT")
    cur.execute(
        "ALTER TABLE health_issues ADD COLUMN IF NOT EXISTS artist_id BIGINT "
        "REFERENCES library_artists(id) ON DELETE SET NULL"
    )
    cur.execute(
        "ALTER TABLE health_issues ADD COLUMN IF NOT EXISTS album_id INTEGER "
        "REFERENCES library_albums(id) ON DELETE SET NULL"
    )
    cur.execute(
        "ALTER TABLE health_issues ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ"
    )
    cur.execute(
        "UPDATE health_issues SET identity_key = md5(description) "
        "WHERE identity_key IS NULL"
    )
    cur.execute("""
        UPDATE health_issues hi SET album_id = al.id
        FROM library_albums al
        WHERE hi.album_id IS NULL
          AND (hi.details_json->>'album_id') ~ '^[0-9]+$'
          AND al.id = (hi.details_json->>'album_id')::integer
    """)
    cur.execute("""
        UPDATE health_issues hi SET artist_id = la.id
        FROM library_artists la
        WHERE hi.artist_id IS NULL
          AND la.name = COALESCE(hi.details_json->>'artist', hi.details_json->>'db_artist')
    """)
    cur.execute("""
        UPDATE health_issues hi SET artist_id = la.id
        FROM library_albums al
        JOIN library_artists la ON la.name = al.artist
        WHERE hi.artist_id IS NULL AND hi.album_id = al.id
    """)
    cur.execute("DROP INDEX IF EXISTS idx_health_issues_dedup")
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_health_issues_open_identity
        ON health_issues (check_type, identity_key) WHERE status = 'open'
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_health_issues_dismissed_identity
        ON health_issues (check_type, identity_key) WHERE status = 'dismissed'
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_health_issues_open_artist
        ON health_issues (artist_id) WHERE status = 'open'
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS health_check_runs (
            check_type TEXT PRIMARY KEY,
            last_run_at TIMESTAMPTZ NOT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            issue_count INTEGER NOT NULL DEFAULT 0
        )
    """)
