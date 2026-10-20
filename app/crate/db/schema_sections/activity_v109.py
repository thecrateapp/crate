from __future__ import annotations

from typing import Any


def create_instance_listening_rollups_v109_schema(cur: Any) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS instance_track_daily (
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
            listener_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, entity_key, artist, album)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS instance_entity_firsts (
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            first_day DATE NOT NULL,
            PRIMARY KEY (entity_type, entity_key)
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_instance_entity_firsts_recent ON instance_entity_firsts(entity_type, first_day DESC)"
    )
