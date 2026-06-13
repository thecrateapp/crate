from __future__ import annotations

from crate.db.home_builder_shared import _trim_bio
from crate.db.home_debug import record_home_hero_debug
from crate.db.home_hero_scoring import (
    HOME_HERO_SCORE_VERSION,
    score_home_hero_rows,
    strip_home_hero_score,
)
from crate.db.queries.home import (
    get_artist_genres_map,
    get_discovery_track_rows,
    get_home_hero_rows,
    get_recent_interest_track_rows,
    get_track_candidates_for_album_ids,
)
from crate.genre_taxonomy import expand_genre_terms_with_aliases


def get_home_hero(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> list[dict] | None:
    rows = get_home_hero_rows(
        user_id=user_id,
        followed_names_lower=followed_names_lower,
        similar_target_names_lower=similar_target_names_lower,
        top_genres_lower=top_genres_lower,
        limit=40,
    )
    if not rows:
        record_home_hero_debug(
            {
                "score_version": HOME_HERO_SCORE_VERSION,
                "candidate_pool_size": 0,
                "selected_count": 0,
                "candidates": [],
            }
        )
        return None

    scored_rows = score_home_hero_rows(rows)
    record_home_hero_debug(
        {
            "score_version": HOME_HERO_SCORE_VERSION,
            "candidate_pool_size": len(rows),
            "selected_count": min(len(scored_rows), 7),
            "candidates": [
                {
                    "name": row.get("name"),
                    "slug": row.get("slug"),
                    "score": row.get("score"),
                    "top_contributions": row.get("score_contributions") or [],
                }
                for row in scored_rows[:10]
            ],
        }
    )

    rows = [strip_home_hero_score(row) for row in scored_rows[:7]]
    artist_names = [row["name"] for row in rows]
    genre_map = get_artist_genres_map(artist_names)

    for item in rows:
        item["bio"] = _trim_bio(item.get("bio") or "")
        item["genres"] = genre_map.get(item["name"], [])[:4]

    return rows


def track_candidates_for_album_ids(
    user_id: int, album_ids: list[int], limit: int = 240
) -> list[dict]:
    return get_track_candidates_for_album_ids(
        user_id=user_id, album_ids=album_ids, limit=limit
    )


def query_discovery_tracks(
    user_id: int,
    *,
    genres: list[str],
    excluded_artist_names: list[str],
    limit: int = 240,
) -> list[dict]:
    if not genres:
        return []
    genres = expand_genre_terms_with_aliases(genres)
    return get_discovery_track_rows(
        user_id=user_id,
        genres=genres,
        excluded_artist_names=excluded_artist_names,
        limit=limit,
    )


def fallback_recent_interest_tracks(
    user_id: int, interest_artists_lower: list[str], limit: int = 240
) -> list[dict]:
    return get_recent_interest_track_rows(
        user_id=user_id, interest_artists_lower=interest_artists_lower, limit=limit
    )


__all__ = [
    "fallback_recent_interest_tracks",
    "get_home_hero",
    "query_discovery_tracks",
    "track_candidates_for_album_ids",
]
