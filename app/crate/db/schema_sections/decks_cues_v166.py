"""Crate Decks cues and corrections synchronised per user (S7, F8.S-PR1).

`user_track_cue_sets` holds one row per user and track: the revision of the
user's whole cue set for that track. A client replaces the set in one PUT with
one `base_revision`, so the revision belongs to the set, not to each cue. The
row outlives an emptied set, so the revision never goes back to zero.

`user_track_cues` holds the cues of a set, unique by `(cue_type, slot)`. Each
cue's `revision` is the set revision that last changed it. `hotcue`, `loop` and
`jump` cues are Mixxx hot cues: they share the 36 hot cue slots (0-35), so a
partial unique index keeps one of them per slot. `main`, `intro` and `outro`
are single cues in slot 0.

`user_track_corrections` holds one row per user and track: the user's own BPM,
beat grid (`delta-ms-v1`, encoded as the Smart Mix profiles store it) and
Camelot key. A row whose three values are null is a cleared correction that
keeps its revision.

The tables reference users (deleting a user deletes their cues) but not
`library_tracks`: the entity UID is the track's stable identity, and user data
keyed on it (`user_play_events`, `playlist_tracks`) survives library rescans
and repairs without a foreign key.
"""

DECKS_CUES_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS user_track_cue_sets (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_uid UUID NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_id TEXT CHECK (client_id IS NULL OR char_length(client_id) <= 128),
        PRIMARY KEY (user_id, entity_uid)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_track_cues (
        user_id INTEGER NOT NULL,
        entity_uid UUID NOT NULL,
        cue_type TEXT NOT NULL
            CHECK (cue_type IN ('hotcue', 'loop', 'main', 'intro', 'outro', 'jump')),
        slot SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 35),
        start_ms DOUBLE PRECISION
            CHECK (start_ms IS NULL OR start_ms BETWEEN 0 AND 86400000),
        end_ms DOUBLE PRECISION
            CHECK (end_ms IS NULL OR end_ms BETWEEN 0 AND 86400000),
        label TEXT CHECK (label IS NULL OR char_length(label) <= 200),
        color TEXT CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$'),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_id TEXT CHECK (client_id IS NULL OR char_length(client_id) <= 128),
        PRIMARY KEY (user_id, entity_uid, cue_type, slot),
        FOREIGN KEY (user_id, entity_uid)
            REFERENCES user_track_cue_sets (user_id, entity_uid) ON DELETE CASCADE,
        CHECK (cue_type IN ('hotcue', 'loop', 'jump') OR slot = 0),
        CHECK (start_ms IS NOT NULL OR cue_type IN ('intro', 'outro')),
        CHECK (start_ms IS NOT NULL OR end_ms IS NOT NULL),
        CHECK (cue_type NOT IN ('hotcue', 'main') OR end_ms IS NULL),
        CHECK (cue_type <> 'loop' OR (end_ms IS NOT NULL AND end_ms > start_ms)),
        CHECK (cue_type <> 'jump' OR (end_ms IS NOT NULL AND end_ms <> start_ms)),
        CHECK (
            cue_type NOT IN ('intro', 'outro')
            OR start_ms IS NULL OR end_ms IS NULL OR end_ms > start_ms
        )
    )
    """,
    # Hot cues, saved loops and saved jumps are all Mixxx hot cues.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_track_cues_hotcue_slot
        ON user_track_cues (user_id, entity_uid, slot)
        WHERE cue_type IN ('hotcue', 'loop', 'jump')
    """,
    """
    CREATE TABLE IF NOT EXISTS user_track_corrections (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_uid UUID NOT NULL,
        bpm DOUBLE PRECISION CHECK (bpm IS NULL OR bpm BETWEEN 30 AND 300),
        beat_grid_format TEXT
            CHECK (beat_grid_format IS NULL OR beat_grid_format = 'delta-ms-v1'),
        beat_grid_data BYTEA,
        key TEXT CHECK (key IS NULL OR key ~ '^(1[0-2]|[1-9])[AB]$'),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_id TEXT CHECK (client_id IS NULL OR char_length(client_id) <= 128),
        PRIMARY KEY (user_id, entity_uid),
        CHECK ((beat_grid_format IS NULL) = (beat_grid_data IS NULL))
    )
    """,
)


def create_decks_cues_v166_schema(cur) -> None:
    for statement in DECKS_CUES_STATEMENTS:
        cur.execute(statement)


def drop_decks_cues_v166_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS user_track_corrections")
    cur.execute("DROP TABLE IF EXISTS user_track_cues")
    cur.execute("DROP TABLE IF EXISTS user_track_cue_sets")


__all__ = [
    "DECKS_CUES_STATEMENTS",
    "create_decks_cues_v166_schema",
    "drop_decks_cues_v166_schema",
]
