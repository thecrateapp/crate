"""Model outputs stored per track and reused while the file and the models hold
(SM3-D16)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta

import numpy as np

from crate.db.repositories.smart_mix_signals import (
    TrackMixSignals,
    get_track_mix_signals,
    store_track_mix_beats,
    store_track_mix_voice,
)
from crate.smart_mix.beat_model import BeatTrack, beat_tracker_name
from crate.smart_mix.models import MixProfileQuality, Phrase, TrackMixProfileDraft
from crate.smart_mix.voice_model import VoiceWindows
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


def test_older_signal_does_not_overwrite_newer(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("signals-older")
    replaced_at = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    store_track_mix_beats(
        track_id,
        "revision-b",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
        updated_at=replaced_at,
    )

    # A slow task that read the file before it was replaced finishes afterwards.
    read_before = replaced_at - timedelta(minutes=5)
    store_track_mix_voice(
        track_id,
        "revision-a",
        detector="yamnet-2",
        hop_ms=480,
        scores=b"\x10",
        updated_at=read_before,
    )
    store_track_mix_beats(
        track_id,
        "revision-a",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS[:3],
        downbeats_ms=DOWNBEATS[:1],
        beats_per_bar=3,
        updated_at=read_before,
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-b",
        beat_tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )


def test_older_signal_of_the_same_file_still_joins_the_row(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("signals-older-same")
    read_at = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    store_track_mix_beats(
        track_id,
        "revision-a",
        tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
        updated_at=read_at,
    )

    # Another task read the same file earlier: its voice describes this audio too.
    store_track_mix_voice(
        track_id,
        "revision-a",
        detector="yamnet-2",
        hop_ms=480,
        scores=b"\x10",
        updated_at=read_at - timedelta(minutes=5),
    )

    assert get_track_mix_signals(track_id) == TrackMixSignals(
        source_revision="revision-a",
        beat_tracker="beat-this-small0-dbn",
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
        vocal_detector="yamnet-2",
        voice_hop_ms=480,
        voice_scores=b"\x10",
    )


# The profile task (SM3-D16): the model outputs stored for the captured file and the
# current tracker or detector replace running the models; anything else runs them and
# stores what they give.

PATH = "/music/artist/album/track.flac"
SOURCE = "source-now"


@dataclass
class _Harness:
    model_calls: list[str] = field(default_factory=list)
    voice_model_calls: list[int] = field(default_factory=list)
    analysed: list[object] = field(default_factory=list)
    kept_beats: list[tuple] = field(default_factory=list)
    kept_voice: list[tuple] = field(default_factory=list)
    published: list[TrackMixProfileDraft] = field(default_factory=list)
    captured_at: datetime | None = None
    stamps: list[datetime] = field(default_factory=list)


def _profile_task(
    monkeypatch,
    *,
    stored: TrackMixSignals | None | Exception,
    model_beats: BeatTrack | None = None,
    voice_windows: VoiceWindows | None = None,
    draft: TrackMixProfileDraft | None = None,
    store_error: Exception | None = None,
    source_now: str = SOURCE,
) -> _Harness:
    from crate.db.jobs.analysis_storage import SmartMixCapture
    from crate.smart_mix import vocals
    from crate.worker_handlers import analysis

    harness = _Harness()
    draft = draft if draft is not None else _draft(phrases=False)
    monkeypatch.setattr(
        analysis, "resolve_smart_mix_track", lambda **_kwargs: {"id": 7, "path": PATH}
    )

    def capture(track_id, path, *, claim_token=None):
        harness.captured_at = datetime.now(UTC)
        return SmartMixCapture(
            track_id=track_id,
            path=path,
            source_revision=SOURCE,
            expected_profile_revision=None,
            claim_token=claim_token,
        )

    monkeypatch.setattr(analysis, "capture_smart_mix_source", capture)
    # The file as it is when the task stores what the models read from it.
    monkeypatch.setattr(analysis, "smart_mix_source_revision", lambda _path: source_now)

    def lookup(track_id):
        assert track_id == 7
        if isinstance(stored, Exception):
            raise stored
        return stored

    def keep_beats(track_id, source_revision, *, updated_at, **values):
        if store_error is not None:
            raise store_error
        harness.stamps.append(updated_at)
        harness.kept_beats.append((track_id, source_revision, values))

    def keep_voice(track_id, source_revision, *, updated_at, **values):
        if store_error is not None:
            raise store_error
        harness.stamps.append(updated_at)
        harness.kept_voice.append((track_id, source_revision, values))

    def beat_model(path):
        harness.model_calls.append(str(path))
        if model_beats is None:
            return None
        return model_beats

    class VoiceModel:
        def voice_windows(self, audio):
            harness.voice_model_calls.append(int(audio.size))
            if voice_windows is None:
                raise AssertionError("stored voice windows replace YAMNet")
            return voice_windows

    monkeypatch.setattr(analysis, "get_track_mix_signals", lookup)
    monkeypatch.setattr(analysis, "store_track_mix_beats", keep_beats)
    monkeypatch.setattr(analysis, "store_track_mix_voice", keep_voice)
    monkeypatch.setattr("crate.smart_mix.beat_model.track_file_beats", beat_model)
    monkeypatch.setattr(vocals, "load_voice_model", VoiceModel)
    monkeypatch.setattr(
        vocals, "load_audio", lambda _path: np.zeros(16_000, dtype=np.float32)
    )
    monkeypatch.setattr(
        "crate.audio_analysis.analyze_mix_profile",
        lambda _path, beats=None: harness.analysed.append(beats) or draft,
    )
    monkeypatch.setattr(
        analysis,
        "publish_smart_mix_profile",
        lambda _capture, value: (
            harness.published.append(value) or analysis.SmartMixPublication.PUBLISHED
        ),
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(analysis, "refresh_live_smart_mix_coverage", lambda: None)
    result = analysis._handle_compute_smart_mix_profile("task-1", {"track_id": 7}, {})
    assert result["stored"] is True
    return harness


def _model_track(tracker: str | None = None) -> BeatTrack:
    return BeatTrack(
        tracker=tracker or beat_tracker_name(),
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )


def _stored_beats(*, source_revision: str = SOURCE, tracker: str | None = None):
    return TrackMixSignals(
        source_revision=source_revision,
        beat_tracker=tracker or beat_tracker_name(),
        beats_ms=BEATS,
        downbeats_ms=DOWNBEATS,
        beats_per_bar=4,
    )


def _kept_beats(source_revision: str = SOURCE) -> tuple:
    return (
        7,
        source_revision,
        {
            "tracker": beat_tracker_name(),
            "beats_ms": BEATS,
            "downbeats_ms": DOWNBEATS,
            "beats_per_bar": 4,
        },
    )


def _voice(scores: list[float]) -> VoiceWindows:
    values = np.asarray(scores, dtype=np.float32)
    return VoiceWindows(centres_ms=np.arange(values.size) * 480 + 488, scores=values)


def _draft(*, phrases: bool) -> TrackMixProfileDraft:
    return TrackMixProfileDraft(
        analyzer="crate-rust",
        analyzer_version="smart-mix-audio-v7",
        duration_ms=60_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_ms=tuple(500 + 500 * beat for beat in range(110)),
        phrases=tuple(
            Phrase(
                start_beat=32 * index,
                start_ms=500 + 16_000 * index,
                bars=8,
                energy=0.5,
                delta_energy=None if index == 0 else 0.0,
                kind="body",
            )
            for index in range(3)
        )
        if phrases
        else (),
        energy_curve=bytes(24) if phrases else None,
        structure_confidence=0.6 if phrases else None,
    )


def test_reuses_stored_beats_when_source_and_tracker_match(monkeypatch) -> None:
    harness = _profile_task(monkeypatch, stored=_stored_beats())

    assert harness.model_calls == []
    assert harness.analysed == [_model_track()]
    assert harness.kept_beats == []


def test_recomputes_when_source_revision_changes(monkeypatch) -> None:
    harness = _profile_task(
        monkeypatch,
        stored=_stored_beats(source_revision="source-before"),
        model_beats=_model_track(),
    )

    assert harness.model_calls == [PATH]
    assert harness.analysed == [_model_track()]
    assert harness.kept_beats == [_kept_beats()]


def test_recomputes_when_tracker_changes(monkeypatch) -> None:
    harness = _profile_task(
        monkeypatch,
        stored=_stored_beats(tracker="beat-this-final0-dbn"),
        model_beats=_model_track(),
    )

    assert harness.model_calls == [PATH]
    assert harness.kept_beats == [_kept_beats()]


def test_a_track_without_model_beats_stores_nothing(monkeypatch) -> None:
    harness = _profile_task(monkeypatch, stored=None, model_beats=None)

    assert harness.model_calls == [PATH]
    assert harness.analysed == [None]
    assert harness.kept_beats == []
    # Without phrases there is no voice to compute, and none to store.
    assert harness.voice_model_calls == []
    assert harness.kept_voice == []


def test_reuses_stored_voice_windows(monkeypatch) -> None:
    from crate.smart_mix.vocals import (
        VOCAL_DETECTOR,
        phrase_spans_ms,
        phrase_vocal_presence_from_windows,
        voice_window_bytes,
    )

    windows = voice_window_bytes(_voice([1.0] * 34 + [1e-4] * 34 + [1.0] * 34))
    stored = replace(
        _stored_beats(),
        vocal_detector=windows.detector,
        voice_hop_ms=windows.hop_ms,
        voice_scores=windows.scores,
    )
    draft = _draft(phrases=True)

    harness = _profile_task(monkeypatch, stored=stored, draft=draft)

    assert harness.model_calls == []
    assert harness.voice_model_calls == []
    assert harness.kept_voice == []
    [published] = harness.published
    assert published.vocal_detector == VOCAL_DETECTOR
    assert published.vocal_presence == phrase_vocal_presence_from_windows(
        windows, phrase_spans_ms(draft.phrases, draft.beat_grid_ms)
    )


def test_recomputes_voice_windows_of_another_file(monkeypatch) -> None:
    from crate.smart_mix.vocals import voice_window_bytes

    scores = _voice([1.0] * 102)
    stale = replace(
        _stored_beats(source_revision="source-before"),
        vocal_detector="yamnet-2",
        voice_hop_ms=480,
        voice_scores=bytes(102),
    )

    harness = _profile_task(
        monkeypatch,
        stored=stale,
        model_beats=_model_track(),
        voice_windows=scores,
        draft=_draft(phrases=True),
    )

    windows = voice_window_bytes(scores)
    assert len(harness.voice_model_calls) == 1
    assert harness.kept_voice == [
        (
            7,
            SOURCE,
            {
                "detector": windows.detector,
                "hop_ms": windows.hop_ms,
                "scores": windows.scores,
            },
        )
    ]
    assert harness.published[0].vocal_presence == bytes([255, 255, 255])


def test_signal_store_failure_keeps_profile(monkeypatch, caplog) -> None:
    with caplog.at_level(logging.WARNING):
        harness = _profile_task(
            monkeypatch,
            stored=RuntimeError("database is down"),
            model_beats=_model_track(),
            voice_windows=_voice([1.0] * 102),
            draft=_draft(phrases=True),
            store_error=RuntimeError("database is down"),
        )

    # The models run, the analysis takes their beats and the profile keeps its voice.
    assert harness.model_calls == [PATH]
    assert harness.analysed == [_model_track()]
    [published] = harness.published
    assert published.vocal_presence == bytes([255, 255, 255])
    assert "stored signals" in caplog.text
    assert "store the Beat This! beats" in caplog.text
    assert "store the voice windows" in caplog.text


def test_signal_not_stored_when_source_changed_during_task(monkeypatch, caplog) -> None:
    with caplog.at_level(logging.WARNING):
        harness = _profile_task(
            monkeypatch,
            stored=None,
            model_beats=_model_track(),
            voice_windows=_voice([1.0] * 102),
            draft=_draft(phrases=True),
            source_now="source-after",
        )

    # The models read a file that is no longer there: their outputs describe neither.
    assert harness.model_calls == [PATH]
    assert len(harness.voice_model_calls) == 1
    assert harness.kept_beats == []
    assert harness.kept_voice == []
    assert caplog.text.count("changed during the task") == 2


def test_signals_carry_the_time_the_source_was_read(monkeypatch) -> None:
    harness = _profile_task(
        monkeypatch,
        stored=None,
        model_beats=_model_track(),
        voice_windows=_voice([1.0] * 102),
        draft=_draft(phrases=True),
    )

    # Both are stamped with when the task read the file, not when it stored them,
    # so a slower task that read an older file never replaces them.
    [beats_at, voice_at] = harness.stamps
    assert beats_at == voice_at
    assert beats_at.tzinfo is not None
    assert harness.captured_at is not None
    assert beats_at <= harness.captured_at
