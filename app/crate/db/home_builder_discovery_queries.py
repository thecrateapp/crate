from __future__ import annotations

from collections.abc import Mapping

from crate.artist_hero_artwork import (
    DESKTOP_HERO_SIZE,
    MOBILE_HERO_SIZE,
    get_artist_hero_artwork_bounds,
)
from crate.artist_hero_contract import artist_hero_recipe_hash
from crate.db.home_builder_shared import _trim_bio
from crate.db.home_hero_scoring import (
    HOME_HERO_SCORE_VERSION,
    score_home_hero_rows,
    strip_home_hero_score,
)
from crate.db.home_debug import record_home_hero_debug
from crate.db.queries.home import (
    get_artist_genres_map,
    get_discovery_track_rows,
    get_home_hero_rows,
    get_recent_interest_track_rows,
    get_track_candidates_for_album_ids,
)
from crate.genre_taxonomy import expand_genre_terms_with_aliases

HOME_JUST_LANDED_VERSION = "home_just_landed_v2"
HOME_HERO_CANDIDATE_LIMIT = 15


def _dedupe_home_hero_rows(rows: list[dict]) -> list[dict]:
    seen_names: set[str] = set()
    deduped: list[dict] = []
    for row in rows:
        name = " ".join(str(row.get("name") or "").split()).casefold()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        deduped.append(row)
    return deduped


def _add_hero_artwork_bounds(item: dict) -> None:
    generic_width = item.pop("_hero_source_width", None)
    generic_height = item.pop("_hero_source_height", None)
    compositions: dict[str, dict] = {}
    for composition, output_size in (
        ("desktop", DESKTOP_HERO_SIZE),
        ("mobile", MOBILE_HERO_SIZE),
    ):
        width = item.pop(f"_hero_{composition}_source_width", None) or generic_width
        height = item.pop(f"_hero_{composition}_source_height", None) or generic_height
        recipe = item.pop(f"_hero_{composition}_recipe", None)
        if not width or not height or not isinstance(recipe, Mapping):
            continue
        bounds = get_artist_hero_artwork_bounds(
            (int(width), int(height)), recipe, output_size
        )
        item[f"{composition}_artwork_bounds"] = bounds
        if item.get("artwork_revision"):
            compositions[composition] = {
                "schema_version": 1,
                "composition": composition,
                "render_revision": str(item["artwork_revision"]),
                "recipe_hash": artist_hero_recipe_hash(recipe),
                "width": output_size[0],
                "height": output_size[1],
                "bounds": bounds,
                "asset_path": (
                    f"/api/artists/{int(item['id'])}/hero?composition={composition}"
                    f"&size={output_size[0]}&v={item['artwork_revision']}"
                ),
            }
    if compositions:
        item["hero_compositions"] = compositions


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
        limit=HOME_HERO_CANDIDATE_LIMIT,
    )
    if not rows:
        record_home_hero_debug(
            {
                "selection_version": HOME_JUST_LANDED_VERSION,
                "score_version": HOME_HERO_SCORE_VERSION,
                "candidate_pool_size": 0,
                "selected_count": 0,
                "candidates": [],
            }
        )
        return None

    personalized = any(
        row.get("is_followed")
        or row.get("similar_hits")
        or row.get("genre_hits")
        or row.get("user_play_count")
        or row.get("recent_exposure_count")
        for row in rows
    )
    ranked_rows = score_home_hero_rows(rows) if personalized else rows
    ranked_rows = _dedupe_home_hero_rows(ranked_rows)
    selected_rows = ranked_rows[:5]

    record_home_hero_debug(
        {
            "selection_version": HOME_JUST_LANDED_VERSION,
            "score_version": HOME_HERO_SCORE_VERSION,
            "candidate_pool_size": len(ranked_rows),
            "selected_count": len(selected_rows),
            "personalized": personalized,
            "candidates": [
                {
                    "name": row.get("name"),
                    "slug": row.get("slug"),
                    "first_added_sort": row.get("first_added_sort"),
                    "artwork_provenance": row.get("artwork_provenance", "fallback"),
                    "score": row.get("score"),
                    "score_contributions": row.get("score_contributions", []),
                }
                for row in ranked_rows
            ],
        }
    )

    artist_names = [row["name"] for row in selected_rows]
    genre_map = get_artist_genres_map(artist_names)

    for item in selected_rows:
        _add_hero_artwork_bounds(item)
        item["bio"] = _trim_bio(item.get("bio") or "")
        item["genres"] = genre_map.get(item["name"], [])[:4]
        item.setdefault("artwork_provenance", "fallback")

    return [strip_home_hero_score(item) for item in selected_rows]


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
