from __future__ import annotations

import hashlib
import math
from datetime import date, datetime, timezone
from typing import Any

HOME_HERO_SCORE_VERSION = "home_hero_v2"
HOME_HERO_ROTATION_VERSION = "home_hero_rotation_v1"

HOME_HERO_SCORE_WEIGHTS_V1 = {
    "followed_artist": 2.6,
    "similar_artist_match": 3.0,
    "genre_overlap": 2.2,
    "user_listening": 1.5,
    "bounded_popularity": 0.4,
    "underplayed_bonus": 0.5,
    "catalog_depth": 0.3,
    "positive_feedback": 1.2,
    "recent_exposure_penalty": -0.75,
    "radio_dislike_penalty": -1.0,
    "skip_penalty": -1.5,
    "negative_feedback_penalty": -10.0,
}


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _contribution(reason: str, value: float) -> dict:
    return {"reason": reason, "value": round(value, 4)}


def _hero_score_contributions(row: dict) -> list[dict]:
    weights = HOME_HERO_SCORE_WEIGHTS_V1
    listeners = max(_float(row.get("listeners")), 0.0)
    followed_artist = _bool(row.get("is_followed"))
    similar_hits = min(_int(row.get("similar_hits")), 1)
    genre_hits = max(_int(row.get("genre_hits")), 0)
    user_play_count = max(_int(row.get("user_play_count")), 0)
    recent_exposure_count = max(_int(row.get("recent_exposure_count")), 0)
    positive_feedback_count = max(_int(row.get("positive_feedback_count")), 0)
    radio_dislike_count = max(_int(row.get("radio_dislike_count")), 0)
    skip_rate = max(min(_float(row.get("skip_rate")), 1.0), 0.0)
    track_count = max(_int(row.get("track_count")), 0)
    album_count = max(_int(row.get("album_count")), 0)

    bounded_popularity = min(math.log10(1 + listeners) / 7.0, 1.0)
    underplayed = max(0.0, 1.0 - min(listeners / 250_000.0, 1.0))
    genre_overlap = min(genre_hits / 3.0, 1.0)
    catalog_depth = 1.0 if track_count >= 8 and album_count >= 1 else 0.0
    user_listening = min(
        math.log1p(user_play_count) / math.log1p(40),
        1.0,
    )

    contributions = [
        _contribution(
            "followed_artist",
            weights["followed_artist"] if followed_artist else 0.0,
        ),
        _contribution(
            "similar_artist_match", similar_hits * weights["similar_artist_match"]
        ),
        _contribution("genre_overlap", genre_overlap * weights["genre_overlap"]),
        _contribution("user_listening", user_listening * weights["user_listening"]),
        _contribution(
            "bounded_popularity", bounded_popularity * weights["bounded_popularity"]
        ),
        _contribution("underplayed_bonus", underplayed * weights["underplayed_bonus"]),
        _contribution("catalog_depth", catalog_depth * weights["catalog_depth"]),
        _contribution(
            "positive_feedback",
            min(positive_feedback_count, 2) * weights["positive_feedback"],
        ),
        _contribution(
            "recent_exposure_penalty",
            min(recent_exposure_count, 5) * weights["recent_exposure_penalty"],
        ),
        _contribution(
            "radio_dislike_penalty",
            min(radio_dislike_count, 5) * weights["radio_dislike_penalty"],
        ),
        _contribution("skip_penalty", skip_rate * weights["skip_penalty"]),
    ]

    if row.get("active_negative_feedback") or row.get("ignored_cooldown"):
        contributions.append(
            _contribution(
                "negative_feedback_penalty", weights["negative_feedback_penalty"]
            )
        )

    return [item for item in contributions if item["value"] != 0]


def score_home_hero_rows(rows: list[dict]) -> list[dict]:
    scored: list[dict] = []
    for index, row in enumerate(rows):
        contributions = _hero_score_contributions(row)
        score = round(sum(item["value"] for item in contributions), 4)
        top_contributions = sorted(
            contributions, key=lambda item: abs(float(item["value"])), reverse=True
        )[:5]
        scored.append(
            {
                **row,
                "score": score,
                "score_version": HOME_HERO_SCORE_VERSION,
                "score_contributions": top_contributions,
                "_original_index": index,
            }
        )

    return sorted(
        scored,
        key=lambda item: (
            -float(item["score"]),
            int(item["_original_index"]),
            str(item.get("name") or ""),
        ),
    )


def strip_home_hero_score(row: dict) -> dict:
    internal_fields = {
        "score",
        "score_version",
        "score_contributions",
        "_original_index",
        "first_added_sort",
        "is_followed",
        "similar_hits",
        "genre_hits",
        "recent_exposure_count",
        "user_play_count",
        "user_complete_play_count",
        "user_minutes_listened",
        "user_last_played_at",
    }
    return {key: value for key, value in row.items() if key not in internal_fields}


def _stable_unit_interval(value: str) -> float:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    integer = int.from_bytes(digest[:8], byteorder="big", signed=False)
    return integer / float(2**64)


def rotate_home_hero_rows(
    rows: list[dict],
    *,
    user_id: int,
    day: date | None = None,
) -> list[dict]:
    """Select a stable daily hero from the personalized candidate order.

    The input order carries the personalized score. A small rank-based
    exploration floor prevents the first candidate from winning every day,
    while the hash keeps the result stable for the same user and UTC day.
    """

    if len(rows) <= 1:
        return list(rows)

    rotation_day = day or datetime.now(timezone.utc).date()
    candidate_count = min(len(rows), 5)
    candidates = rows[:candidate_count]
    weights = [0.35 + (1.0 / ((index + 1) ** 0.65)) for index in range(candidate_count)]
    total_weight = sum(weights)
    target = (
        _stable_unit_interval(
            f"{HOME_HERO_ROTATION_VERSION}:{user_id}:{rotation_day.isoformat()}"
        )
        * total_weight
    )

    selected_index = 0
    for index, weight in enumerate(weights):
        if target < weight:
            selected_index = index
            break
        target -= weight

    selected = candidates[selected_index]
    remaining = [
        candidate
        for index, candidate in enumerate(candidates)
        if index != selected_index
    ]
    return [selected, *remaining, *rows[candidate_count:]]


__all__ = [
    "HOME_HERO_SCORE_VERSION",
    "HOME_HERO_ROTATION_VERSION",
    "HOME_HERO_SCORE_WEIGHTS_V1",
    "rotate_home_hero_rows",
    "score_home_hero_rows",
    "strip_home_hero_score",
]
