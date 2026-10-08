from __future__ import annotations

from typing import Any


def create_listening_projections_v105_schema(cur: Any) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_listening_projection_state (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            timezone TEXT NOT NULL,
            built_at TIMESTAMPTZ NOT NULL,
            refreshed_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_listening_dirty_days (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day DATE NOT NULL,
            marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, day)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_hourly_listening (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day DATE NOT NULL,
            hour SMALLINT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day, hour)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_track_daily (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day DATE NOT NULL,
            entity_key TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            track_id INTEGER,
            global_track_uid UUID,
            track_entity_uid UUID,
            track_path TEXT,
            title TEXT,
            genre TEXT,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            skip_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            first_played_at TIMESTAMPTZ NOT NULL,
            last_played_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, day, entity_key, artist, album)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_track_daily_artist ON user_track_daily(user_id, artist, day)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_entity_firsts (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            first_day DATE NOT NULL,
            first_played_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, entity_type, entity_key)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_entity_firsts_recent ON user_entity_firsts(user_id, entity_type, first_day DESC)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_listening_sessions (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            started_at TIMESTAMPTZ NOT NULL,
            ended_at TIMESTAMPTZ NOT NULL,
            track_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, started_at)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_listening_sessions_end ON user_listening_sessions(user_id, ended_at)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_artist_stats_artist ON user_artist_stats(stat_window, artist_name, play_count)"
    )
