from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from crate.smart_mix.compatible import (
    CompatibleTrackCandidate,
    rank_compatible_tracks,
    seed_tempo_window,
)
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile
from crate.smart_mix.policy import PLANNER_POLICY
from crate.smart_mix.transition_fit import (
    TransitionEdges,
    beatmatch_affinity,
    genre_beatmatch_prior,
    level_jump_db,
    pair_genre_prior,
    score_transition_fit,
)


def _edges(**overrides: object) -> TransitionEdges:
    base = TransitionEdges(
        bpm=124.0,
        bpm_confidence=0.95,
        tempo_stability=0.96,
        intro_tempo_stability=0.96,
        outro_tempo_stability=0.96,
        time_signature=4,
        has_beat_reference=True,
        camelot="8A",
        intro_lufs=-9.0,
        outro_lufs=-9.0,
        accredited_loudness=True,
        intro_energy=0.8,
        outro_energy=0.8,
        intro_density=0.72,
        outro_density=0.72,
        leading_silence_ms=200,
        trailing_silence_ms=300,
        danceability=0.7,
        valence=0.5,
    )
    return replace(base, **overrides)


@pytest.mark.parametrize(
    ("genres", "expected"),
    [
        (["Techno"], 0.95),
        (["deep_house"], 0.95),
        (["UK Garage"], 0.85),
        (["garage rock"], 0.15),
        (["post-hardcore"], 0.15),
        (["hardcore techno"], 0.95),
        (["hip hop"], 0.6),
        (["classical"], 0.05),
        (["field recordings"], None),
        (["demo"], None),
        (["greenhouse sessions"], None),
        (["dancehall"], 0.4),
        (["electronic"], 0.8),
        ([], None),
        (None, None),
    ],
)
def test_genre_prior_maps_families_and_resolves_ambiguous_names(
    genres: list[str] | None,
    expected: float | None,
) -> None:
    assert genre_beatmatch_prior(genres) == expected


def test_genre_prior_weights_artist_genres_and_ignores_unknown_tags() -> None:
    prior = genre_beatmatch_prior({"techno": 3.0, "rock": 1.0, "mystery": 5.0})

    assert prior == pytest.approx((0.95 * 3.0 + 0.15) / 4.0, abs=1e-4)
    assert pair_genre_prior(0.9, None) == 0.9
    assert pair_genre_prior(0.9, 0.1) == 0.5
    assert pair_genre_prior(None, None) is None


def test_affinity_combines_genre_prior_with_rhythm_evidence() -> None:
    steady = _edges()
    loose = _edges(outro_tempo_stability=0.55, tempo_stability=0.55)

    assert beatmatch_affinity(steady, steady, genre_prior=0.95) == 0.95
    assert beatmatch_affinity(steady, steady, genre_prior=0.15) == 0.15
    assert beatmatch_affinity(loose, steady, genre_prior=0.95) < 0.15
    assert beatmatch_affinity(_edges(bpm_confidence=None), steady) == 0.0
    assert beatmatch_affinity(steady, steady) == PLANNER_POLICY.default_beatmatch_prior


@pytest.mark.parametrize(("mode", "expected"), [("beatmatch", 1.0), ("smooth", 0.0)])
def test_explicit_modes_override_genre_and_evidence(mode: str, expected: float) -> None:
    loose = _edges(bpm_confidence=0.2)

    assert beatmatch_affinity(loose, loose, mode=mode, genre_prior=0.5) == expected


def test_loudness_jumps_up_are_penalised_harder_than_drops() -> None:
    fade_out = _edges(outro_lufs=-22.0)
    cold_open = _edges(intro_lufs=-8.0)
    loud_finish = _edges(outro_lufs=-8.0)
    quiet_intro = _edges(intro_lufs=-22.0)

    rise = score_transition_fit(fade_out, cold_open, beatmatch_affinity=0.0)
    drop = score_transition_fit(loud_finish, quiet_intro, beatmatch_affinity=0.0)
    flat = score_transition_fit(_edges(), _edges(), beatmatch_affinity=0.0)

    assert rise.level == 0.0
    assert drop.level == pytest.approx(1.0 - (14.0 - 3.0) / 12.0, abs=1e-4)
    assert flat.level == 1.0
    assert rise.overall < drop.overall < flat.overall


def test_a_fade_out_is_measured_against_the_body_of_the_outgoing_track() -> None:
    fade_out = _edges(outro_lufs=-26.0, integrated_lufs=-10.0)
    quiet_song = _edges(outro_lufs=-21.0, integrated_lufs=-20.0)
    normal_entry = _edges(intro_lufs=-9.0)
    loud_entry = _edges(intro_lufs=-2.0)

    after_fade = score_transition_fit(fade_out, normal_entry, beatmatch_affinity=0.0)
    after_quiet_song = score_transition_fit(
        quiet_song, normal_entry, beatmatch_affinity=0.0
    )
    loud_after_fade = score_transition_fit(fade_out, loud_entry, beatmatch_affinity=0.0)

    assert level_jump_db(fade_out, normal_entry) == 1.0
    assert after_fade.level == 1.0
    assert level_jump_db(quiet_song, normal_entry) == 12.0
    assert after_quiet_song.level == 0.0
    assert level_jump_db(fade_out, loud_entry) == 8.0
    assert loud_after_fade.level < 0.2


def test_a_short_tail_dip_is_not_treated_as_a_fade() -> None:
    dip = _edges(outro_lufs=-14.0, integrated_lufs=-10.0)

    assert level_jump_db(dip, _edges(intro_lufs=-9.0)) == 5.0
    assert level_jump_db(_edges(outro_lufs=-26.0), _edges(intro_lufs=-9.0)) == 17.0


def test_unaccredited_loudness_falls_back_to_edge_energy() -> None:
    outgoing = _edges(accredited_loudness=False, outro_energy=0.5)
    incoming = _edges(accredited_loudness=False, intro_energy=0.6)

    fit = score_transition_fit(outgoing, incoming, beatmatch_affinity=0.0)

    assert fit.level == pytest.approx(1.0 - (6.0 - 1.5) / 7.5, abs=1e-4)


def test_missing_edges_are_neutral_instead_of_penalised() -> None:
    empty = TransitionEdges()

    fit = score_transition_fit(empty, empty, beatmatch_affinity=0.5)

    assert fit.level == fit.brightness == fit.silence == fit.mood == 0.5
    assert fit.tempo == fit.tempo_flow == 0.5
    assert fit.beatmatchable is False


def test_dead_air_between_tracks_lowers_the_fit() -> None:
    outgoing = _edges(trailing_silence_ms=6_000)
    incoming = _edges(leading_silence_ms=3_000)

    fit = score_transition_fit(outgoing, incoming, beatmatch_affinity=0.0)

    assert fit.silence == 0.0


def test_half_and_double_time_count_as_the_same_pulse() -> None:
    fit = score_transition_fit(
        _edges(bpm=140.0), _edges(bpm=70.0), beatmatch_affinity=1.0
    )

    assert fit.tempo == 1.0
    assert fit.tempo_flow == 1.0
    assert fit.beatmatchable is True


def test_beatmatch_gate_requires_confident_steady_tempo_and_meter() -> None:
    steady = _edges()

    assert score_transition_fit(steady, steady, beatmatch_affinity=1.0).beatmatchable
    for incoming in (
        _edges(bpm=131.0),
        _edges(bpm_confidence=0.6),
        _edges(intro_tempo_stability=0.7),
        _edges(time_signature=3),
        _edges(has_beat_reference=False),
    ):
        assert not score_transition_fit(
            steady, incoming, beatmatch_affinity=1.0
        ).beatmatchable


def test_rock_context_prefers_a_smooth_entry_over_an_exact_tempo_cold_open() -> None:
    outgoing = _edges(bpm=140.0, outro_lufs=-20.0, outro_density=0.68)
    exact_tempo_cold_open = _edges(bpm=140.0, intro_lufs=-7.0, intro_density=0.86)
    smooth_entry = _edges(
        bpm=118.0,
        camelot="3B",
        intro_lufs=-19.0,
        intro_density=0.69,
    )

    smooth_a = score_transition_fit(
        outgoing, exact_tempo_cold_open, beatmatch_affinity=0.1
    )
    smooth_b = score_transition_fit(outgoing, smooth_entry, beatmatch_affinity=0.1)
    beat_a = score_transition_fit(
        outgoing, exact_tempo_cold_open, beatmatch_affinity=1.0
    )
    beat_b = score_transition_fit(outgoing, smooth_entry, beatmatch_affinity=1.0)

    assert smooth_b.overall > smooth_a.overall
    assert beat_a.overall > beat_b.overall


def test_rows_with_prefixed_profile_columns_become_edges() -> None:
    row = {
        "danceability": 0.42,
        "mix_quality": "partial",
        "mix_bpm": 128,
        "mix_bpm_confidence": 0.9,
        "mix_beat_anchor_ms": 0,
        "mix_key_camelot": "5A",
        "mix_outro_lufs": -11.5,
        "mix_measurement_version": "bs1770-v1",
        "mix_duration_ms": 200_000,
        "mix_active_start_ms": 150,
        "mix_active_end_ms": 197_500,
        "mix_danceability": 0.9,
    }

    edges = TransitionEdges.from_row(row)

    assert edges is not None
    assert edges.bpm == 128.0
    assert edges.has_beat_reference is True
    assert edges.camelot == "5A"
    assert edges.accredited_loudness is True
    assert edges.leading_silence_ms == 150
    assert edges.trailing_silence_ms == 2_500
    assert edges.danceability == 0.42
    assert TransitionEdges.from_row({"mix_quality": "unavailable"}) is None
    assert TransitionEdges.from_row({"bpm": 120.0}) is None


def _profile(uid: str, **overrides: object) -> TrackMixProfile:
    base = TrackMixProfile(
        track_entity_uid=uid,
        profile_version=1,
        profile_revision=f"profile-{uid}",
        analyzer="crate-rust",
        analyzer_version="smart-mix-v2",
        source_revision=f"source-{uid}",
        duration_ms=200_000,
        quality=MixProfileQuality.FULL,
        bpm=140.0,
        bpm_confidence=0.95,
        tempo_stability=0.96,
        beat_anchor_ms=400,
        time_signature=4,
        camelot="8A",
        key_confidence=0.9,
        intro_lufs=-9.0,
        outro_lufs=-20.0,
        true_peak_dbfs=-1.0,
        intro_energy=0.8,
        outro_energy=0.6,
        intro_spectral_density=0.72,
        outro_spectral_density=0.68,
        active_start_ms=100,
        active_end_ms=199_500,
        integrated_lufs=-10.0,
        measurement_version="bs1770-v1",
        analyzed_at=datetime(2026, 10, 30, tzinfo=UTC),
    )
    return replace(base, **overrides)


def _candidate(
    uid: str, genres: frozenset[str], track_id: int = 1, **profile: object
) -> CompatibleTrackCandidate:
    return CompatibleTrackCandidate(
        track_id=track_id,
        track_entity_uid=uid,
        title=f"Track {uid}",
        artist=f"Artist {uid}",
        album="Album",
        profile=_profile(uid, **profile),
        bliss_vector=(1.0, 0.0, 0.0),
        genres=genres,
    )


def test_compatible_ranking_follows_the_requested_context() -> None:
    rock = frozenset({"rock"})
    seed = _candidate("seed", rock, integrated_lufs=-19.0)
    cold_open = _candidate(
        "cold-open",
        rock,
        track_id=2,
        intro_lufs=-7.0,
        intro_spectral_density=0.86,
    )
    smooth = _candidate(
        "smooth",
        rock,
        track_id=3,
        bpm=118.0,
        camelot="3B",
        intro_lufs=-19.0,
        intro_spectral_density=0.69,
    )

    auto = rank_compatible_tracks(seed, [cold_open, smooth], limit=10)
    beatmatch = rank_compatible_tracks(
        seed, [cold_open, smooth], limit=10, mode="beatmatch"
    )

    assert [item.track_entity_uid for item in auto] == ["smooth", "cold-open"]
    assert auto[0].score_breakdown.beatmatch_affinity == 0.15
    assert [item.track_entity_uid for item in beatmatch] == ["cold-open", "smooth"]
    assert beatmatch[0].score_breakdown.beatmatchable is True


@pytest.mark.parametrize(
    ("genres", "mode", "expected"),
    [
        (frozenset({"techno"}), "auto", 0.12),
        (frozenset({"rock"}), "auto", 0.25),
        (frozenset(), "auto", 0.25),
        (frozenset({"rock"}), "beatmatch", 0.12),
        (frozenset({"techno"}), "smooth", 0.25),
    ],
)
def test_seed_tempo_window_follows_context(
    genres: frozenset[str], mode: str, expected: float
) -> None:
    assert seed_tempo_window(_candidate("seed", genres), mode=mode) == expected
