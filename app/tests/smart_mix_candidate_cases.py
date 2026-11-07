"""Profiles and edges shared by the Smart Mix v3 candidate tests (SM2).

At 125 BPM a beat is exactly 480 ms and a bar 1,920 ms, so phrase boundaries,
mix lengths and policy limits are whole milliseconds: 8 bars last 15,360 ms,
16 bars 30,720 ms and 32 bars 61,440 ms (longer than the 48 s long blend).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime

from crate.smart_mix.models import (
    MixProfileQuality,
    Phrase,
    TrackMixProfile,
    TransitionContext,
)

OUTGOING_UID = "11111111-1111-4111-8111-111111111111"
INCOMING_UID = "22222222-2222-4222-8222-222222222222"
BPM = 125.0
BEAT_MS = 480
BAR_MS = 4 * BEAT_MS
ANCHOR_MS = 480
VOICE_DETECTOR = "yamnet-2"

# (kind, bars, energy) from the first downbeat.
OUTGOING_LAYOUT: tuple[tuple[str, int, float], ...] = (
    ("intro", 16, 0.45),
    ("build", 8, 0.6),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 16, 0.5),
)
INCOMING_LAYOUT: tuple[tuple[str, int, float], ...] = (
    ("intro", 16, 0.5),
    ("build", 8, 0.65),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 16, 0.45),
)


def phrases(
    layout: Sequence[tuple[str, int, float]],
    *,
    anchor_ms: int = ANCHOR_MS,
    bpm: float = BPM,
) -> tuple[Phrase, ...]:
    beat_ms = 60_000.0 / bpm
    result: list[Phrase] = []
    bar = 0
    previous: float | None = None
    for kind, bars, energy in layout:
        start_beat = 4 * bar
        result.append(
            Phrase(
                start_beat=start_beat,
                start_ms=round(anchor_ms + start_beat * beat_ms),
                bars=bars,
                energy=energy,
                delta_energy=None if previous is None else round(energy - previous, 6),
                kind=kind,
            )
        )
        previous = energy
        bar += bars
    return tuple(result)


def music_end_ms(
    layout: Sequence[tuple[str, int, float]],
    *,
    anchor_ms: int = ANCHOR_MS,
    bpm: float = BPM,
) -> int:
    bars = sum(item[1] for item in layout)
    return round(anchor_ms + 4 * bars * 60_000.0 / bpm)


def profile(
    track_uid: str,
    *,
    layout: Sequence[tuple[str, int, float]] | None = None,
    vocals: Sequence[int] | None = None,
    **overrides: object,
) -> TrackMixProfile:
    """A full 125 BPM profile; ``layout`` adds phrases and the energy curve.

    With a layout the music (``active_end_ms``) ends where the last phrase does;
    ``overrides`` win over everything.
    """
    values: dict[str, object] = {
        "track_entity_uid": track_uid,
        "profile_version": 1,
        "profile_revision": f"profile-{track_uid}",
        "analyzer": "crate-rust",
        "analyzer_version": "smart-mix-audio-v7",
        "source_revision": f"source-{track_uid}",
        "duration_ms": 240_000,
        "quality": MixProfileQuality.FULL,
        "bpm": BPM,
        "bpm_confidence": 0.95,
        "tempo_stability": 0.97,
        "beat_anchor_ms": ANCHOR_MS,
        "downbeat_anchor_ms": ANCHOR_MS,
        "time_signature": 4,
        "key": "A",
        "scale": "minor",
        "camelot": "8A",
        "key_confidence": 0.9,
        "intro_cue_ms": ANCHOR_MS,
        "outro_cue_ms": 200_160,
        "intro_lufs": -10.0,
        "outro_lufs": -10.0,
        "true_peak_dbfs": -1.0,
        "intro_energy": 0.5,
        "outro_energy": 0.5,
        "global_energy": 0.7,
        "danceability": 0.7,
        "valence": 0.5,
        "active_start_ms": ANCHOR_MS,
        "active_end_ms": 233_000,
        "analyzed_at": datetime(2026, 11, 6, tzinfo=UTC),
    }
    if layout is not None:
        bpm = float(overrides.get("bpm", BPM))  # type: ignore[arg-type]
        anchor_ms = int(overrides.get("downbeat_anchor_ms", ANCHOR_MS))  # type: ignore[arg-type]
        values.update(
            phrases=phrases(layout, anchor_ms=anchor_ms, bpm=bpm),
            energy_curve=bytes(
                round(energy * 255)
                for _kind, length, energy in layout
                for _bar in range(length)
            ),
            structure_confidence=0.6,
            active_end_ms=music_end_ms(layout, anchor_ms=anchor_ms, bpm=bpm),
        )
    if vocals is not None:
        values.update(vocal_presence=bytes(vocals), vocal_detector=VOICE_DETECTOR)
    values.update(overrides)
    return TrackMixProfile(**values)  # type: ignore[arg-type]


def context(
    *,
    source: str = "playlist",
    automatic: bool = True,
    preferred_duration_ms: int = 12_000,
    allow_beatmatch: bool = True,
    allow_tempo_adjustment: bool = True,
    allow_bass_handoff: bool = True,
    allow_long_beatmatch: bool = True,
) -> TransitionContext:
    """The DJ context of the evaluation harness by default."""
    return TransitionContext(
        source=source,
        automatic=automatic,
        offline=False,
        preferred_duration_ms=preferred_duration_ms,
        user_cue_profile="auto",
        allow_beatmatch=allow_beatmatch,
        allow_tempo_adjustment=allow_tempo_adjustment,
        allow_bass_handoff=allow_bass_handoff,
        allow_long_beatmatch=allow_long_beatmatch,
    )


LISTEN = {
    "preferred_duration_ms": 6_000,
    "allow_bass_handoff": False,
    "allow_long_beatmatch": False,
}


def edge_cases() -> list[
    tuple[str, TrackMixProfile | None, TrackMixProfile | None, TransitionContext]
]:
    """A fixed set of edges that covers every branch of the v2 planner."""
    structured_out = profile(OUTGOING_UID, layout=OUTGOING_LAYOUT)
    structured_in = profile(INCOMING_UID, layout=INCOMING_LAYOUT)
    voiced_out = profile(
        OUTGOING_UID, layout=OUTGOING_LAYOUT, vocals=(20, 40, 160, 30, 170, 150)
    )
    voiced_in = profile(
        INCOMING_UID, layout=INCOMING_LAYOUT, vocals=(140, 20, 180, 30, 160, 10)
    )
    plain_out = profile(OUTGOING_UID)
    plain_in = profile(INCOMING_UID)
    return [
        ("structured_dj", structured_out, structured_in, context()),
        ("structured_listen", structured_out, structured_in, context(**LISTEN)),
        ("voiced_dj", voiced_out, voiced_in, context()),
        ("plain_dj", plain_out, plain_in, context()),
        ("plain_listen", plain_out, plain_in, context(**LISTEN)),
        (
            "incompatible_key_dj",
            structured_out,
            replace(structured_in, camelot="2B", key="F#", scale="major"),
            context(),
        ),
        (
            "incompatible_tempo",
            structured_out,
            profile(INCOMING_UID, layout=INCOMING_LAYOUT, bpm=140.0),
            context(),
        ),
        (
            "unstable_tempo",
            replace(structured_out, tempo_stability=0.7),
            structured_in,
            context(),
        ),
        (
            "short_incoming",
            structured_out,
            profile(INCOMING_UID, duration_ms=40_000, active_end_ms=39_000),
            context(),
        ),
        ("album_gapless", structured_out, structured_in, context(source="album")),
        ("manual", structured_out, structured_in, context(automatic=False)),
        ("missing_incoming", structured_out, None, context()),
    ]


__all__ = [
    "ANCHOR_MS",
    "BAR_MS",
    "BEAT_MS",
    "BPM",
    "INCOMING_LAYOUT",
    "INCOMING_UID",
    "LISTEN",
    "OUTGOING_LAYOUT",
    "OUTGOING_UID",
    "VOICE_DETECTOR",
    "context",
    "edge_cases",
    "music_end_ms",
    "phrases",
    "profile",
]
