"""Model outputs stored per track and reused while the file and the models hold
(SM3-D16)."""

from __future__ import annotations

from crate.db.repositories.smart_mix_signals import (
    TrackMixSignals,
    get_track_mix_signals,
    store_track_mix_beats,
    store_track_mix_voice,
)
from tests.test_smart_mix_repository import _create_track

BEATS = (500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500)
DOWNBEATS = (500, 2_500, 4_500)


def test_a_track_without_signals_reads_none(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("signals-none")

    assert get_track_mix_signals(track_id) is None


def test_signals_of_one_source_revision_share_the_row(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("signals-share")

    store_track_mix_beats(
        track_id,
        "revision-a",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )
    store_track_mix_voice(
        track_id,
        "revision-a",
        detector="yamnet-2",
        hop_ms=480,
        scores=bytes([0, 90, 255]),
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-a",
        beat_tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
        vocal_detector="yamnet-2",
        voice_hop_ms=480,
        voice_scores=bytes([0, 90, 255]),
    )

    # New beats for the same file keep its voice windows, and the other way round.
    store_track_mix_beats(
        track_id,
        "revision-a",
        tracker="beat-this-final0-dbn",
        beats_ms=BEATS[:7],
        downbeats_ms=DOWNBEATS[:2],
        beats_per_bar=None,
    )
    store_track_mix_voice(
        track_id,
        "revision-a",
        detector="yamnet-3",
        hop_ms=480,
        scores=bytes([1, 2]),
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-a",
        beat_tracker="beat-this-final0-dbn",
        beats_ms=BEATS[:7],
        downbeats_ms=DOWNBEATS[:2],
        beats_per_bar=None,
        vocal_detector="yamnet-3",
        voice_hop_ms=480,
        voice_scores=bytes([1, 2]),
    )


def test_signals_of_a_new_source_revision_replace_the_row(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("signals-replace")
    store_track_mix_beats(
        track_id,
        "revision-a",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )
    store_track_mix_voice(
        track_id, "revision-a", detector="yamnet-2", hop_ms=480, scores=b"\x10"
    )

    # The file changed: its old beats describe another audio.
    store_track_mix_voice(
        track_id, "revision-b", detector="yamnet-2", hop_ms=480, scores=b"\x20"
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-b",
        vocal_detector="yamnet-2",
        voice_hop_ms=480,
        voice_scores=b"\x20",
    )

    store_track_mix_beats(
        track_id,
        "revision-c",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-c",
        beat_tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )
