"""Candidate selection helpers for Music Paths."""

from __future__ import annotations

import re
import random

from crate.db.queries.paths import find_anchor_track_row, find_candidate_rows
from crate.smart_mix.transition_fit import RowTransitionScorer
from crate.track_versions import track_song_identity
from crate.recommendation_policy import (
    MAX_CONSECUTIVE_SAME_ARTIST as _MAX_CONSECUTIVE_SAME_ARTIST,
    PATH_RECENCY_QUALITY_BAND,
    fresh_path_candidates,
    path_artist_key,
)

_ARTIST_REPEAT_PENALTY = 2.0
_CANDIDATE_POOL_SIZE = 15

_W_BLISS = 0.34
_W_ARTIST_AFFINITY = 0.22
_W_GENRE_OVERLAP = 0.16
_W_BPM = 0.09
_W_KEY = 0.05
_W_ENERGY = 0.08
_W_ERA = 0.03
_W_TRANSITION = 0.30

_LOW_SIGNAL_TITLE_RE = re.compile(
    r"\b(intro|interlude|outro|reprise|skit|spoken word|voice memo|voicemail|announcement|commentary)\b",
    re.IGNORECASE,
)
_ALT_VERSION_RE = re.compile(
    r"\b(live|remaster(?:ed)?|redux|re-recorded|acoustic|orchestral|alternate take|alt take|session|demo|version|mix|edit|radio edit|instrumental|karaoke|acapella|a cappella)\b",
    re.IGNORECASE,
)


def _find_anchor_track(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
    *,
    exclude_song_keys: set[tuple[str, str]] | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
    session=None,
) -> dict | None:
    """Find the best track that belongs to the endpoint (artist/album/genre)."""
    return find_anchor_track_row(
        endpoint_type,
        endpoint_value,
        target_vec,
        exclude,
        exclude_song_keys=exclude_song_keys,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        selection_seed=selection_seed,
        session=session,
    )


def _coerce_float(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _coerce_year(value) -> int | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if year <= 0:
        return None
    return year


def _latest_track_context(recent_tracks: list[dict] | None) -> dict | None:
    if not recent_tracks:
        return None
    for row in reversed(recent_tracks):
        if row:
            return row
    return None


def _bpm_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_bpm = _coerce_float(candidate.get("bpm"))
    ctx_bpm = _coerce_float(context.get("bpm"))
    if cand_bpm is None or ctx_bpm is None:
        return 0.0
    return min(abs(cand_bpm - ctx_bpm) / 40.0, 1.0)


def _key_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_key = (candidate.get("audio_key") or "").strip().upper()
    ctx_key = (context.get("audio_key") or "").strip().upper()
    cand_scale = (candidate.get("audio_scale") or "").strip().lower()
    ctx_scale = (context.get("audio_scale") or "").strip().lower()
    if not cand_key or not ctx_key:
        return 0.0
    if cand_key == ctx_key and cand_scale == ctx_scale:
        return 0.0
    if cand_key == ctx_key:
        return 0.15
    if cand_scale and ctx_scale and cand_scale == ctx_scale:
        return 0.35
    return 0.65


def _audio_transition_penalty(
    candidate: dict,
    context: dict | None,
    transition_scorer: RowTransitionScorer | None = None,
) -> float:
    if transition_scorer is not None:
        fit = transition_scorer.fit(context, candidate)
        if fit is not None:
            return _W_TRANSITION * (1.0 - fit)
    return (
        _W_BPM * _bpm_penalty(candidate, context)
        + _W_KEY * _key_penalty(candidate, context)
        + _W_ENERGY * _energy_penalty(candidate, context)
    )


def _energy_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_energy = _coerce_float(candidate.get("energy"))
    ctx_energy = _coerce_float(context.get("energy"))
    if cand_energy is None or ctx_energy is None:
        return 0.0
    return min(abs(cand_energy - ctx_energy), 1.0)


def _era_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_year = _coerce_year(candidate.get("year"))
    ctx_year = _coerce_year(context.get("year"))
    if cand_year is None or ctx_year is None:
        return 0.0
    return min(abs(cand_year - ctx_year) / 25.0, 1.0)


def _curation_penalty(candidate: dict) -> float:
    title = (candidate.get("title") or "").strip()
    album = (candidate.get("album") or "").strip()
    text = f"{title} {album}".strip()
    penalty = 0.0
    if title and _LOW_SIGNAL_TITLE_RE.search(title):
        penalty += 0.12
    if text and _ALT_VERSION_RE.search(text):
        penalty += 0.08
    duration = _coerce_float(candidate.get("duration"))
    if duration is not None and 0 < duration < 75:
        penalty += 0.03
    return min(penalty, 0.25)


def _vector_distance(
    candidate: dict, target: list[float], *, target_norm: float | None = None
) -> float:
    vector = candidate.get("bliss_vector") or []
    if len(vector) != len(target) or not vector:
        return _coerce_float(candidate.get("distance")) or 1.0

    dot = sum(
        float(vector[index]) * float(target[index]) for index in range(len(target))
    )
    left_norm = sum(float(value) * float(value) for value in vector) ** 0.5
    effective_target_norm = (
        sum(float(value) * float(value) for value in target) ** 0.5
        if target_norm is None
        else target_norm
    )
    if left_norm <= 0 or effective_target_norm <= 0:
        return _coerce_float(candidate.get("distance")) or 1.0
    return max(0.0, min(2.0, 1.0 - (dot / (left_norm * effective_target_norm))))


def _find_best_candidate(
    target: list[float],
    exclude_ids: set[int],
    exclude_titles: set[str],
    recent_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
    target_artists: list[str],
    *,
    artist_affinity=lambda *_args, **_kwargs: 0.0,
    genre_overlap=lambda *_args, **_kwargs: 0.0,
    candidate_pool_size: int = _CANDIDATE_POOL_SIZE,
    recent_tracks: list[dict] | None = None,
    exclude_song_keys: set[tuple[str, str]] | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
    transition_scorer: RowTransitionScorer | None = None,
    session=None,
) -> dict | None:
    """Find the best track near ``target`` using hybrid bliss/affinity scoring."""
    query_exclude = set(exclude_ids)
    pool_size = min(240, max(1, candidate_pool_size))
    all_rows = []
    fatigued = (recent_song_keys or set()) | (previous_song_keys or set())
    for _ in range(3):
        rows = find_candidate_rows(
            target,
            query_exclude,
            limit=pool_size,
            use_track_artist=True,
            session=session,
        )
        all_rows.extend(rows)
        selected = _select_best_candidate_from_rows(
            all_rows,
            target,
            exclude_ids,
            exclude_titles,
            recent_artists,
            sim_graph,
            genre_map,
            member_graph,
            target_artists,
            artist_affinity=artist_affinity,
            genre_overlap=genre_overlap,
            recent_tracks=recent_tracks,
            exclude_song_keys=exclude_song_keys,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            selection_seed=selection_seed,
            transition_scorer=transition_scorer,
        )
        if (
            selected
            and track_song_identity(selected) not in fatigued
            and selected["id"] not in (previous_track_ids or set())
        ):
            return selected
        if len(rows) < pool_size:
            break
        query_exclude.update(row["id"] for row in rows)
        pool_size = min(240, pool_size * 4)
    return _select_best_candidate_from_rows(
        all_rows,
        target,
        exclude_ids,
        exclude_titles,
        recent_artists,
        sim_graph,
        genre_map,
        member_graph,
        target_artists,
        artist_affinity=artist_affinity,
        genre_overlap=genre_overlap,
        recent_tracks=recent_tracks,
        exclude_song_keys=exclude_song_keys,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        selection_seed=selection_seed,
        transition_scorer=transition_scorer,
    )


def _select_best_candidate_from_rows(
    rows: list[dict],
    target: list[float],
    exclude_ids: set[int],
    exclude_titles: set[str],
    recent_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
    target_artists: list[str],
    *,
    artist_affinity=lambda *_args, **_kwargs: 0.0,
    genre_overlap=lambda *_args, **_kwargs: 0.0,
    recent_tracks: list[dict] | None = None,
    exclude_song_keys: set[tuple[str, str]] | None = None,
    max_consecutive: int | None = _MAX_CONSECUTIVE_SAME_ARTIST,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
    transition_scorer: RowTransitionScorer | None = None,
) -> dict | None:
    """Rank a prefetched candidate pool without going back to Postgres."""
    if not rows:
        return None

    scored_rows: list[tuple[dict, float]] = [
        (dict(row), _vector_distance(dict(row), target)) for row in rows
    ]
    max_dist = max(distance for _row, distance in scored_rows) or 1.0
    best: dict | None = None
    best_score = float("inf")
    track_context = _latest_track_context(recent_tracks)
    recent_artist_keys = [path_artist_key({"artist": name}) for name in recent_artists]
    ranked: list[tuple[dict, float]] = []

    for candidate, distance in scored_rows:
        if candidate.get("id") in exclude_ids:
            continue
        artist = candidate["artist"]
        artist_key = path_artist_key(candidate)
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        if title_key in exclude_titles:
            continue
        if track_song_identity(candidate) in (exclude_song_keys or set()):
            continue

        if artist_key and max_consecutive is not None:
            consecutive = 0
            for recent_artist_key in reversed(recent_artist_keys):
                if recent_artist_key != artist_key:
                    break
                consecutive += 1
            if consecutive >= max_consecutive:
                continue

        bliss_norm = distance / max_dist
        affinity = artist_affinity(
            artist, recent_artists + target_artists, sim_graph, member_graph
        )
        overlap = genre_overlap(artist, target_artists, genre_map)

        score = (
            _W_BLISS * bliss_norm
            + _W_ARTIST_AFFINITY * (1.0 - affinity)
            + _W_GENRE_OVERLAP * (1.0 - overlap)
            + _audio_transition_penalty(candidate, track_context, transition_scorer)
            + _W_ERA * _era_penalty(candidate, track_context)
            + _curation_penalty(candidate)
        )

        if artist_key and artist_key in recent_artist_keys[-2:]:
            score *= _ARTIST_REPEAT_PENALTY

        candidate["distance"] = distance
        ranked.append((candidate, score))
        if score < best_score:
            best_score = score
            best = candidate
            best["distance"] = distance

    if best:
        pool = fresh_path_candidates(
            [(row, -score) for row, score in ranked],
            preferred=best,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
        )
        scores = {row["id"]: score for row, score in ranked}
        if selection_seed is not None:
            floor = min(scores[row["id"]] for row in pool) + PATH_RECENCY_QUALITY_BAND
            pool = [row for row in pool if scores[row["id"]] <= floor]
            fatigued = (recent_song_keys or set()) | (previous_song_keys or set())
            fresh = [
                row
                for row in pool
                if track_song_identity(row) not in fatigued
                and row["id"] not in (previous_track_ids or set())
            ]
            pool = sorted(fresh or pool, key=lambda row: row["id"])
            best = random.Random(selection_seed).choice(pool)
        else:
            best = min(pool, key=lambda row: scores[row["id"]])
        best["bliss_vector"] = (
            list(best["bliss_vector"]) if best.get("bliss_vector") else None
        )

    return best


__all__ = [
    "_W_TRANSITION",
    "_audio_transition_penalty",
    "_find_anchor_track",
    "_find_best_candidate",
    "_select_best_candidate_from_rows",
]
