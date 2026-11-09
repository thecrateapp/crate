"""Stem files the server keeps for Crate Decks (Smart Mix Stems, STEM-D6).

The server separates the tracks of Smart Mix playlists and keeps, per track, one MP4 with
three AAC streams (drums, bass, vocals) in ``CRATE_STEMS_DIR`` on the music volume.
``track_stem_files`` has one row per kept file, deleted with the track: its ``path``
relative to that directory, its size, the separator and the source revision it was
separated from, and when it was last used, which the quota's LRU reads.
"""

SMART_MIX_STEM_FILES_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS track_stem_files (
        track_id BIGINT PRIMARY KEY
            REFERENCES library_tracks(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE
            CHECK (path <> '' AND path NOT LIKE '/%' AND path NOT LIKE '%..%'),
        bytes BIGINT NOT NULL CHECK (bytes > 0),
        separator_model TEXT NOT NULL,
        separator_version TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_track_stem_files_last_used
        ON track_stem_files (last_used_at)
    """,
)


def create_smart_mix_stem_files_v158_schema(cur) -> None:
    for statement in SMART_MIX_STEM_FILES_STATEMENTS:
        cur.execute(statement)


def drop_smart_mix_stem_files_v158_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS track_stem_files")


__all__ = [
    "SMART_MIX_STEM_FILES_STATEMENTS",
    "create_smart_mix_stem_files_v158_schema",
    "drop_smart_mix_stem_files_v158_schema",
]
