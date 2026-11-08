"""The stems layer a profile derives from a stem analysis (STEM-D4, design §5)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

from crate.smart_mix.models import MixProfileQuality, Phrase, TrackMixProfile
from crate.smart_mix.stems import (
    STEM_SOURCES,
    StemAnalysis,
    StemPhraseLevels,
    stem_phrase_layer,
)
from crate.smart_mix.versions import ANALYZER_VERSION

REVISION = "c" * 64
# 64 beats at 120 BPM: two phrases of eight bars, 16 s each, and 128 windows of 250 ms.
GRID = tuple(range(0, 32_000, 500))
PHRASES = (
    Phrase(
        start_beat=0, start_ms=0, bars=8, energy=0.5, delta_energy=None, kind="intro"
    ),
    Phrase(
        start_beat=32,
        start_ms=16_000,
        bars=8,
        energy=0.7,
        delta_energy=0.2,
        kind="body",
    ),
)


def _profile(**changes) -> TrackMixProfile:
    profile = TrackMixProfile(
        track_entity_uid=str(uuid4()),
        profile_version=1,
        profile_revision="profile-1",
        analyzer="crate-rust",
        analyzer_version=ANALYZER_VERSION,
        source_revision=REVISION,
        duration_ms=32_000,
        quality=MixProfileQuality.FULL,
        analyzed_at=datetime(2026, 11, 8, tzinfo=UTC),
        beat_grid_format="delta-ms-v1",
        beat_grid_ms=GRID,
        phrases=PHRASES,
    )
    return replace(profile, **changes)


def _analysis(
    levels: dict[str, bytes] | None = None,
    *,
    duration_ms: int = 32_000,
    revision: str = REVISION,
) -> StemAnalysis:
    windows = -(-duration_ms // 250)
    return StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/2026.11.8",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision=revision,
        hop_ms=250,
        levels=levels or {stem: bytes([50]) * windows for stem in STEM_SOURCES},
        duration_ms=duration_ms,
    )


def test_mean_level_per_phrase() -> None:
    first, second = 64, 64
    levels = {
        # 100 and 101 alternate: the mean 100.5 rounds half up.
        "drums": bytes([100, 101]) * (first // 2) + bytes([200]) * second,
        "bass": bytes(first) + bytes([60]) * second,
        "other": bytes([30]) * (first + second),
        # Half the windows of the second phrase are silent: 127.5 rounds to 128.
        "vocals": bytes(first) + bytes([255, 0]) * (second // 2),
    }
    analysis = _analysis(levels)

    layer = stem_phrase_layer(_profile(), analysis)

    assert layer is not None
    assert layer.producer == "crate-server/2026.11.8"
    assert layer.separator_model == "htdemucs"
    assert layer.separator_version == "htdemucs-onnx-1"
    assert layer.phrases == (
        StemPhraseLevels(
            start_ms=0, end_ms=16_000, drums=101, bass=0, other=30, vocals=0
        ),
        StemPhraseLevels(
            start_ms=16_000, end_ms=32_000, drums=200, bass=60, other=30, vocals=128
        ),
    )
    assert layer.to_dict()["phrases"][1] == {
        "startMs": 16_000,
        "endMs": 32_000,
        "drums": 200,
        "bass": 60,
        "other": 30,
        "vocals": 128,
    }


def test_a_window_belongs_to_the_phrase_that_holds_its_centre() -> None:
    # The boundary at 16,100 ms splits window 64 (16,000-16,250 ms) before its
    # centre, so the window goes to the second phrase.
    phrases = (PHRASES[0], replace(PHRASES[1], start_ms=16_100))
    levels = {stem: bytes(64) + bytes([255]) * 64 for stem in STEM_SOURCES}

    layer = stem_phrase_layer(_profile(phrases=phrases), _analysis(levels))

    assert layer is not None
    assert [phrase.drums for phrase in layer.phrases] == [0, 255]


def test_the_last_phrase_runs_to_the_end_of_the_track_without_a_beat_grid() -> None:
    profile = _profile(beat_grid_ms=(), beat_grid_format=None)

    layer = stem_phrase_layer(profile, _analysis())

    assert layer is not None
    assert layer.phrases[-1].end_ms == 32_000


def test_no_layer_when_the_analysed_duration_differs_from_the_profile_by_more_than_2_percent() -> (
    None
):
    profile = _profile()

    assert stem_phrase_layer(profile, _analysis(duration_ms=32_640)) is not None
    assert stem_phrase_layer(profile, _analysis(duration_ms=31_360)) is not None
    assert stem_phrase_layer(profile, _analysis(duration_ms=32_700)) is None
    assert stem_phrase_layer(profile, _analysis(duration_ms=31_300)) is None


def test_no_layer_for_a_stale_source_revision() -> None:
    assert stem_phrase_layer(_profile(), _analysis(revision="d" * 64)) is None


def test_no_layer_without_phrases() -> None:
    assert stem_phrase_layer(_profile(phrases=None), _analysis()) is None
    assert stem_phrase_layer(_profile(phrases=()), _analysis()) is None
