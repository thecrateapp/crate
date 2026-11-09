"""Smart Mix playlists and per-track stem work (Smart Mix Stems, STEM-D2).

A Smart Mix playlist is a playlist its owner marks for Smart Mix: the server separates its
tracks into stems, and Crate Decks keeps it as an offline set. ``smart_mix_playlists``
holds one row per marked playlist, deleted with it; turning it off keeps the row with
``enabled = false`` so clients and the stem-file LRU see the change. ``revision`` comes
from the owner's counter in ``smart_mix_playlist_revisions``, so Decks syncs "changes
since revision N".

Work is per track, not per playlist: ``track_stem_jobs`` has one row per track, so a
track in two Smart Mix playlists is separated once.
"""

SMART_MIX_PLAYLISTS_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS smart_mix_playlist_revisions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision BIGINT NOT NULL CHECK (revision > 0)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS smart_mix_playlists (
        playlist_id INTEGER PRIMARY KEY
            REFERENCES playlists(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL,
        enabled_at TIMESTAMPTZ NOT NULL,
        disabled_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        revision BIGINT NOT NULL CHECK (revision > 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (enabled = (disabled_at IS NULL))
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_smart_mix_playlists_user_revision
        ON smart_mix_playlists (user_id, revision)
    """,
    """
    CREATE TABLE IF NOT EXISTS track_stem_jobs (
        track_id BIGINT PRIMARY KEY
            REFERENCES library_tracks(id) ON DELETE CASCADE,
        state TEXT NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'analyzing', 'ready', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        source_revision TEXT
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_track_stem_jobs_pending
        ON track_stem_jobs (requested_at) WHERE state = 'pending'
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_track_stem_jobs_finished
        ON track_stem_jobs (finished_at DESC) WHERE state = 'ready'
    """,
)


def create_smart_mix_playlists_v157_schema(cur) -> None:
    for statement in SMART_MIX_PLAYLISTS_STATEMENTS:
        cur.execute(statement)


def drop_smart_mix_playlists_v157_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS track_stem_jobs")
    cur.execute("DROP TABLE IF EXISTS smart_mix_playlists")
    cur.execute("DROP TABLE IF EXISTS smart_mix_playlist_revisions")


__all__ = [
    "SMART_MIX_PLAYLISTS_STATEMENTS",
    "create_smart_mix_playlists_v157_schema",
    "drop_smart_mix_playlists_v157_schema",
]
