from __future__ import annotations

from typing import Any


def create_smart_mix_track_signals_v150_schema(cur: Any) -> None:
    """The model outputs a Smart Mix profile was built from, per track (SM3-D16).

    Beat This!'s beats, downbeats and bar length after its DBN, and YAMNet's voice
    score per window (one byte each, on the log scale of the phrase voice bytes). They
    hold for the file of ``source_revision`` and the tracker or detector named next to
    them, so a later analyzer version reuses them instead of running the models again.
    A row of another source revision is replaced whole.
    """
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS track_mix_signals (
            track_id BIGINT PRIMARY KEY
                REFERENCES library_tracks(id) ON DELETE CASCADE,
            source_revision TEXT NOT NULL,
            beat_tracker TEXT,
            beats_ms INTEGER[],
            downbeats_ms INTEGER[],
            beats_per_bar SMALLINT
                CHECK (beats_per_bar IS NULL OR beats_per_bar > 0),
            vocal_detector TEXT,
            voice_hop_ms SMALLINT
                CHECK (voice_hop_ms IS NULL OR voice_hop_ms > 0),
            voice_scores BYTEA,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK ((beat_tracker IS NULL) = (beats_ms IS NULL)),
            CHECK ((beats_ms IS NULL) = (downbeats_ms IS NULL)),
            CHECK ((vocal_detector IS NULL) = (voice_scores IS NULL)),
            CHECK ((voice_scores IS NULL) = (voice_hop_ms IS NULL))
        )
        """
    )


__all__ = ["create_smart_mix_track_signals_v150_schema"]
