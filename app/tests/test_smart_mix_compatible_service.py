from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

from crate.smart_mix.compatible import (
    CompatibleTrackCandidate,
    rank_compatible_tracks,
)
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile
from crate.smart_mix.policy import PLANNER_POLICY_V1


def test_ranking_is_deterministic_and_uses_shared_policy() -> None:
    seed = _candidate("seed", bpm=120.0, camelot="8A")
    candidates = [
        _candidate("incompatible", bpm=128.0, camelot="2B"),
        _candidate("relative", bpm=120.0, camelot="8B"),
        _candidate("adjacent", bpm=121.0, camelot="9A"),
    ]

    first = rank_compatible_tracks(seed, candidates, limit=10)
    second = rank_compatible_tracks(seed, reversed(candidates), limit=10)

    assert [item.track_entity_uid for item in first] == [
        "relative",
        "adjacent",
        "incompatible",
    ]
    assert first == second
    assert first[0].score_breakdown.planner_version == PLANNER_POLICY_V1.version


def test_half_and_double_bpm_candidates_remain_compatible() -> None:
    seed = _candidate("seed", bpm=120.0)

    ranked = rank_compatible_tracks(
        seed,
        [
            _candidate("half", bpm=60.0),
            _candidate("double", bpm=240.0),
        ],
        limit=10,
    )

    assert {item.track_entity_uid for item in ranked} == {"half", "double"}
    assert all(item.score_breakdown.tempo == 1.0 for item in ranked)


def test_energy_and_bliss_improve_ranking_without_duplicating_weights() -> None:
    seed = _candidate(
        "seed",
        outro_energy=0.8,
        bliss_vector=(1.0, 0.0, 0.0),
    )
    close = _candidate(
        "close",
        intro_energy=0.79,
        bliss_vector=(0.99, 0.01, 0.0),
    )
    distant = _candidate(
        "distant",
        intro_energy=0.1,
        bliss_vector=(0.0, 1.0, 0.0),
    )

    ranked = rank_compatible_tracks(seed, [distant, close], limit=10)

    assert [item.track_entity_uid for item in ranked] == ["close", "distant"]
    assert ranked[0].score_breakdown.energy > ranked[1].score_breakdown.energy
    assert ranked[0].score_breakdown.bliss > ranked[1].score_breakdown.bliss


def test_missing_signals_return_a_reason_instead_of_excluding_candidate() -> None:
    seed = _candidate("seed")
    partial = _candidate(
        "partial",
        quality=MixProfileQuality.PARTIAL,
        bpm=None,
        bpm_confidence=None,
        tempo_stability=None,
        camelot=None,
        key_confidence=None,
    )

    [result] = rank_compatible_tracks(seed, [partial], limit=10)

    assert result.track_entity_uid == "partial"
    assert result.confidence < 0.75
    assert result.fallback_reasons == ("low_confidence",)


def test_prefers_canonical_recording_over_remaster_live_and_demo_duplicates() -> None:
    seed = _candidate("seed")
    canonical = _candidate(
        "canonical",
        title="Target Song",
        recording_mbid="recording-1",
    )
    remaster = _candidate(
        "remaster",
        title="Target Song (2010 Remaster)",
        recording_mbid="recording-1",
    )
    live = _candidate(
        "live",
        title="Target Song (Live)",
        recording_mbid="recording-1",
    )
    demo = _candidate(
        "demo",
        title="Target Song (Demo)",
        recording_mbid="recording-1",
    )

    ranked = rank_compatible_tracks(
        seed,
        [remaster, live, demo, canonical],
        limit=10,
    )

    assert [item.track_entity_uid for item in ranked] == ["canonical"]


def test_seed_variant_prefers_the_same_explicit_variant() -> None:
    seed = _candidate("seed", title="Seed Song (Live)")
    canonical = _candidate(
        "canonical",
        title="Target Song",
        recording_mbid="recording-2",
    )
    live = _candidate(
        "live",
        title="Target Song (Live)",
        recording_mbid="recording-2",
    )

    ranked = rank_compatible_tracks(seed, [canonical, live], limit=10)

    assert [item.track_entity_uid for item in ranked] == ["live"]


def test_excludes_seed_and_unavailable_or_unplayable_sources() -> None:
    seed = _candidate("seed")
    ranked = rank_compatible_tracks(
        seed,
        [
            seed,
            _candidate(
                "unavailable",
                quality=MixProfileQuality.UNAVAILABLE,
            ),
            _candidate("unplayable", playable=False),
            _candidate("valid"),
        ],
        limit=10,
    )

    assert [item.track_entity_uid for item in ranked] == ["valid"]


def _candidate(
    track_uid: str,
    *,
    title: str | None = None,
    artist: str = "Artist",
    album: str = "Album",
    recording_mbid: str | None = None,
    bliss_vector: tuple[float, ...] = (1.0, 0.0, 0.0),
    genres: frozenset[str] = frozenset({"post-hardcore"}),
    playable: bool = True,
    **profile_overrides: object,
) -> CompatibleTrackCandidate:
    profile = TrackMixProfile(
        track_entity_uid=track_uid,
        profile_version=1,
        profile_revision=f"profile-{track_uid}",
        analyzer="crate-rust",
        analyzer_version="smart-mix-v1",
        source_revision=f"source-{track_uid}",
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        camelot="8A",
        key_confidence=0.9,
        intro_cue_ms=8_000,
        outro_cue_ms=165_000,
        intro_energy=0.7,
        outro_energy=0.7,
        global_energy=0.7,
        danceability=0.7,
        valence=0.5,
        analyzed_at=datetime(2026, 7, 28, tzinfo=UTC),
    )
    return CompatibleTrackCandidate(
        track_id=abs(hash(track_uid)) % 1_000_000 + 1,
        track_entity_uid=track_uid,
        title=title or f"Track {track_uid}",
        artist=artist,
        album=album,
        profile=replace(profile, **profile_overrides),
        recording_mbid=recording_mbid,
        bliss_vector=bliss_vector,
        genres=genres,
        playable=playable,
    )
