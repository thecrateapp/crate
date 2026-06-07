from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Literal

from crate.db.home_taste_guardrails import (
    rank_by_daily_seed,
    select_mix_tracks_with_diagnostics,
    track_version_penalty,
)

TracklistIntent = Literal[
    "home_mix",
    "smart_playlist",
    "artist_radio",
    "genre_radio",
    "editorial",
]
TracklistOrdering = Literal[
    "input",
    "popularity",
    "recent",
    "random_seeded",
    "personalized",
]


@dataclass(frozen=True)
class TracklistProfile:
    id: str
    intent: TracklistIntent
    ordering: TracklistOrdering = "input"
    max_per_artist: int = 2
    max_per_album: int = 2
    strict_song_identity: bool = True
    prefer_studio: bool = True
    popularity_weight: float = 0.0
    recency_weight: float = 0.0
    novelty_weight: float = 0.0
    source_weight: float = 0.0
    variant_penalty_weight: float = 1.0
    score_version: str = "tracklist_engine_v1"


@dataclass(frozen=True)
class TracklistRequest:
    rows: list[dict]
    profile: TracklistProfile
    limit: int
    user_id: int | None = None
    seed_id: str = ""
    reference_day: date | str | None = None


@dataclass(frozen=True)
class TracklistResult:
    tracks: list[dict]
    diagnostics: dict


TRACKLIST_PROFILES: dict[str, TracklistProfile] = {
    "home_daily_discovery_v1": TracklistProfile(
        id="home_daily_discovery_v1",
        intent="home_mix",
        ordering="personalized",
        max_per_artist=2,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        novelty_weight=1.0,
        source_weight=1.0,
        variant_penalty_weight=1.0,
    ),
    "home_new_arrivals_v1": TracklistProfile(
        id="home_new_arrivals_v1",
        intent="home_mix",
        ordering="personalized",
        max_per_artist=2,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        recency_weight=0.8,
        novelty_weight=0.4,
        variant_penalty_weight=1.0,
    ),
    "home_genre_mix_v1": TracklistProfile(
        id="home_genre_mix_v1",
        intent="home_mix",
        ordering="personalized",
        max_per_artist=2,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        popularity_weight=0.0,
        novelty_weight=0.5,
        source_weight=1.0,
        variant_penalty_weight=1.0,
    ),
    "curator_smart_playlist_v1": TracklistProfile(
        id="curator_smart_playlist_v1",
        intent="smart_playlist",
        ordering="input",
        max_per_artist=2,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        popularity_weight=0.3,
        variant_penalty_weight=1.0,
    ),
    "artist_radio_v1": TracklistProfile(
        id="artist_radio_v1",
        intent="artist_radio",
        ordering="random_seeded",
        max_per_artist=3,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        novelty_weight=0.3,
        variant_penalty_weight=1.0,
    ),
    "genre_radio_v1": TracklistProfile(
        id="genre_radio_v1",
        intent="genre_radio",
        ordering="random_seeded",
        max_per_artist=2,
        max_per_album=2,
        strict_song_identity=True,
        prefer_studio=True,
        novelty_weight=0.5,
        variant_penalty_weight=1.0,
    ),
}


def get_tracklist_profile(
    profile_id: str, *, overrides: dict | None = None
) -> TracklistProfile:
    profile = TRACKLIST_PROFILES[profile_id]
    if not overrides:
        return profile
    allowed = set(TracklistProfile.__dataclass_fields__)
    updates = {key: value for key, value in overrides.items() if key in allowed}
    updates.pop("id", None)
    return replace(profile, **updates)


def generate_tracklist(request: TracklistRequest) -> TracklistResult:
    ordered_rows, ordering_debug = _order_rows(request)
    selected, diagnostics = select_mix_tracks_with_diagnostics(
        ordered_rows,
        limit=request.limit,
        max_per_artist=request.profile.max_per_artist,
        max_per_album=request.profile.max_per_album,
        strict=request.profile.strict_song_identity,
    )
    diagnostics.update(ordering_debug)
    diagnostics.update(
        {
            "profile_id": request.profile.id,
            "intent": request.profile.intent,
            "ordering": request.profile.ordering,
            "score_version": request.profile.score_version,
            "limit": request.limit,
        }
    )
    return TracklistResult(tracks=selected, diagnostics=diagnostics)


def _order_rows(request: TracklistRequest) -> tuple[list[dict], dict]:
    profile = request.profile
    if profile.ordering == "input":
        return list(request.rows), {"ordering_applied": "input"}
    if profile.ordering == "random_seeded":
        if request.user_id is None:
            return list(request.rows), {"ordering_applied": "input_missing_user"}
        return (
            rank_by_daily_seed(
                request.rows,
                user_id=request.user_id,
                surface_id=request.seed_id or profile.id,
                day=request.reference_day or date.today().isoformat(),
            ),
            {"ordering_applied": "random_seeded"},
        )
    if profile.ordering == "popularity":
        return (
            sorted(
                request.rows,
                key=lambda row: (_popularity_score(row), -track_version_penalty(row)),
                reverse=True,
            ),
            {"ordering_applied": "popularity"},
        )
    if profile.ordering == "recent":
        return (
            sorted(request.rows, key=_recent_sort_key, reverse=True),
            {"ordering_applied": "recent"},
        )
    if profile.ordering == "personalized":
        ordered = sorted(
            enumerate(request.rows),
            key=lambda item: (_candidate_score(item[1], profile), -item[0]),
            reverse=True,
        )
        return [row for _index, row in ordered], {"ordering_applied": "personalized"}
    return list(request.rows), {"ordering_applied": "unknown"}


def _candidate_score(row: dict, profile: TracklistProfile) -> float:
    score = 0.0
    score += profile.popularity_weight * _popularity_score(row)
    score += profile.recency_weight * _recency_score(row)
    score += profile.novelty_weight * _novelty_score(row)
    score += profile.source_weight * _recommendation_source_score(row)
    if profile.prefer_studio:
        score -= profile.variant_penalty_weight * track_version_penalty(row)
    return score


def _popularity_score(row: dict) -> float:
    return _coerce_float(
        row.get("lastfm_playcount")
        or row.get("playcount")
        or row.get("listeners")
        or row.get("popularity")
    )


def _novelty_score(row: dict) -> float:
    user_play_count = _coerce_float(row.get("user_play_count"))
    liked_penalty = 3.0 if row.get("is_liked") else 0.0
    return -(min(user_play_count, 10.0) * 0.25 + liked_penalty)


def _recommendation_source_score(row: dict) -> float:
    source = str(row.get("recommendation_source") or "").strip().lower()
    if source == "discovery":
        return 2.0
    if source == "underplayed":
        return 0.6
    if source == "comfort":
        return -1.2
    if source == "direct_genre":
        return 1.5
    if source == "related_genre":
        return 0.2
    return 0.0


def _recency_score(row: dict) -> float:
    value = (
        row.get("source_release_date")
        or row.get("release_date")
        or row.get("added_at")
        or row.get("created_at")
    )
    if value is None:
        return 0.0
    if isinstance(value, datetime):
        return float(value.date().toordinal())
    if isinstance(value, date):
        return float(value.toordinal())
    try:
        return float(datetime.fromisoformat(str(value)[:10]).date().toordinal())
    except ValueError:
        return 0.0


def _recent_sort_key(row: dict) -> tuple[str, float]:
    value = str(
        row.get("source_release_date")
        or row.get("release_date")
        or row.get("added_at")
        or row.get("created_at")
        or ""
    )
    return value, _popularity_score(row)


def _coerce_float(value: object) -> float:
    if not isinstance(value, int | float | str):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


__all__ = [
    "TRACKLIST_PROFILES",
    "TracklistProfile",
    "TracklistRequest",
    "TracklistResult",
    "generate_tracklist",
    "get_tracklist_profile",
]
