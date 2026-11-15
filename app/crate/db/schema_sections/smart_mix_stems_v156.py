"""Stem analyses per track and producer (Smart Mix Stems, STEM-D1 and D4).

A ``stem-analysis/1`` document keeps, per stem (drums, bass, other, vocals), one level
byte per window and optional beats tracked on the drum stem; never audio. Two producers
write it: the server, for the tracks of Smart Mix playlists, and Crate Decks, whose
uploads record the user in ``contributed_by``. One row per track and producer kind,
deleted with the track. A row describes the file of ``source_revision``: readers ignore
rows of another revision, and a new revision replaces the row.
"""

SMART_MIX_STEMS_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS track_stem_signals (
        track_id BIGINT NOT NULL
            REFERENCES library_tracks(id) ON DELETE CASCADE,
        producer_kind TEXT NOT NULL
            CHECK (producer_kind IN ('server', 'decks')),
        producer TEXT NOT NULL,
        separator_model TEXT NOT NULL,
        separator_version TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        hop_ms SMALLINT NOT NULL CHECK (hop_ms > 0),
        drums_levels BYTEA NOT NULL,
        bass_levels BYTEA NOT NULL,
        other_levels BYTEA NOT NULL,
        vocals_levels BYTEA NOT NULL,
        drum_beats_ms INTEGER[],
        duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
        contributed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (track_id, producer_kind),
        CHECK (producer LIKE ('crate-' || producer_kind || '/%')),
        CHECK (producer_kind = 'decks' OR contributed_by IS NULL),
        CHECK (octet_length(drums_levels) > 0),
        CHECK (octet_length(bass_levels) = octet_length(drums_levels)),
        CHECK (octet_length(other_levels) = octet_length(drums_levels)),
        CHECK (octet_length(vocals_levels) = octet_length(drums_levels))
    )
    """,
)


def create_smart_mix_stems_v156_schema(cur) -> None:
    for statement in SMART_MIX_STEMS_STATEMENTS:
        cur.execute(statement)


def drop_smart_mix_stems_v156_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS track_stem_signals")


__all__ = [
    "SMART_MIX_STEMS_STATEMENTS",
    "create_smart_mix_stems_v156_schema",
    "drop_smart_mix_stems_v156_schema",
]
