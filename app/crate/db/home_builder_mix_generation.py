from __future__ import annotations

from datetime import datetime, timezone

from crate.db.home_builder_discovery import (
    _fallback_recent_interest_tracks,
    _filter_interesting_releases,
    _query_discovery_tracks,
    _track_candidates_for_album_ids,
)
from crate.db.home_release_weeks import build_new_arrivals_release_index
from crate.db.home_builder_shared import (
    _artwork_artists,
    _artwork_tracks,
    _daily_rotation_index,
    _merge_track_rows,
    _select_home_mix_tracks,
)
from crate.db.releases import get_new_releases
from crate.genre_taxonomy import (
    expand_genre_terms_with_aliases,
    get_genre_display_name,
    get_related_genre_terms,
)

_COLD_START_DISCOVERY_GENRES = ["rock", "punk", "metal", "alternative", "electronic"]


def _coerce_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _candidate_personal_score(row: dict) -> float:
    score = 0.0
    score -= min(_coerce_int(row.get("user_play_count")), 10) * 0.25
    if row.get("is_liked"):
        score -= 3.0
    return score


def _rank_personalized_rows(rows: list[dict]) -> list[dict]:
    return [
        row
        for _index, row in sorted(
            enumerate(rows),
            key=lambda item: (-_candidate_personal_score(item[1]), item[0]),
        )
    ]


def _audio_bucket(row: dict) -> tuple[int | None, int | None, str]:
    bpm = _coerce_float(row.get("bpm"))
    energy = _coerce_float(row.get("energy"))
    bpm_bucket = int(bpm // 20) if bpm is not None and bpm > 0 else None
    energy_bucket = int(energy * 5) if energy is not None else None
    key_bucket = str(row.get("audio_key") or "")
    return bpm_bucket, energy_bucket, key_bucket


def _prefer_acoustic_variety(rows: list[dict]) -> list[dict]:
    if len(rows) <= 2:
        return rows

    remaining = list(rows)
    ordered: list[dict] = []
    seen_buckets: set[tuple[int | None, int | None, str]] = set()

    while remaining:
        selected_index = next(
            (
                index
                for index, row in enumerate(remaining)
                if _audio_bucket(row) not in seen_buckets
            ),
            0,
        )
        row = remaining.pop(selected_index)
        bucket = _audio_bucket(row)
        if bucket in seen_buckets:
            seen_buckets.clear()
        seen_buckets.add(bucket)
        ordered.append(row)

    return ordered


def _prepare_mix_candidate_rows(rows: list[dict]) -> list[dict]:
    return _prefer_acoustic_variety(_rank_personalized_rows(rows))


def _with_recommendation_source(rows: list[dict], source: str) -> list[dict]:
    return [{**row, "recommendation_source": source} for row in rows]


def _normalized_terms(terms: list[str]) -> set[str]:
    return {term.strip().lower() for term in terms if term.strip()}


def _coerce_genre_values(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item is not None]
    return []


def _direct_genre_terms_for_mix(mix_id: str) -> set[str]:
    if not mix_id.startswith("genre-"):
        return set()
    genre_slug = mix_id.removeprefix("genre-")
    genre_name = get_genre_display_name(genre_slug)
    return _normalized_terms(expand_genre_terms_with_aliases([genre_slug, genre_name]))


def _track_genre_terms(row: dict) -> set[str]:
    values = _coerce_genre_values(row.get("genres"))
    for key in ("genre", "genre_name", "main_genre"):
        values.extend(_coerce_genre_values(row.get(key)))
    return _normalized_terms(expand_genre_terms_with_aliases(values))


def _global_rows_for_mix(mix_id: str, global_track_rows: list[dict]) -> list[dict]:
    if not global_track_rows or not mix_id.startswith("genre-"):
        return global_track_rows
    direct_terms = _direct_genre_terms_for_mix(mix_id)
    if not direct_terms:
        return []
    return [
        row
        for row in global_track_rows
        if _track_genre_terms(row).intersection(direct_terms)
    ]


def _with_release_week_metadata(
    rows: list[dict], releases_by_album_id: dict[int, dict]
) -> list[dict]:
    annotated: list[dict] = []
    for row in rows:
        try:
            album_id = int(row.get("album_id") or 0)
        except (TypeError, ValueError):
            album_id = 0
        release = releases_by_album_id.get(album_id)
        if not release:
            continue
        annotated.append(
            {
                **row,
                "release_week": release.get("release_week"),
                "release_week_index": release.get("release_week_index"),
                "release_week_label": release.get("release_week_label"),
                "source_release_date": release.get("source_release_date"),
                "release_date": release.get("source_release_date"),
            }
        )
    return annotated


def _discovery_seed_genres(top_genres_lower: list[str], *, limit: int = 3) -> list[str]:
    return (top_genres_lower or _COLD_START_DISCOVERY_GENRES)[:limit]


def _daily_rotate_rows(rows: list[dict], user_id: int) -> list[dict]:
    if len(rows) <= 1:
        return rows
    offset = _daily_rotation_index(len(rows), user_id)
    return rows[offset:] + rows[:offset]


def _build_mix_rows(
    user_id: int,
    *,
    interest_artists_lower: list[str],
    top_genres_lower: list[str],
    mix_id: str,
    limit: int,
    recent_releases: list[dict] | None = None,
) -> tuple[str, str, list[dict]]:
    if mix_id == "daily-discovery":
        seed_genres = _discovery_seed_genres(top_genres_lower)
        adjacent_rows = _query_discovery_tracks(
            user_id,
            genres=seed_genres,
            excluded_artist_names=interest_artists_lower[:12] or [""],
            limit=max(limit * 5, 120),
        )
        adjacent_rows = [
            row
            for row in adjacent_rows
            if not row.get("user_play_count") and not row.get("is_liked")
        ]

        underplayed_rows: list[dict] = []
        comfort_rows: list[dict] = []
        if len(adjacent_rows) < limit:
            interest_rows = _fallback_recent_interest_tracks(
                user_id,
                interest_artists_lower[:18] or [""],
                limit=max(limit * 5, 140),
            )
            underplayed_rows = [
                row
                for row in interest_rows
                if not row.get("is_liked") and int(row.get("user_play_count") or 0) <= 1
            ]
            if len(adjacent_rows) + len(underplayed_rows) < limit:
                comfort_rows = [
                    row
                    for row in interest_rows
                    if not row.get("is_liked")
                    and 1 < int(row.get("user_play_count") or 0) <= 4
                ]
            if len(adjacent_rows) + len(underplayed_rows) + len(comfort_rows) < limit:
                broad_rows = _query_discovery_tracks(
                    user_id,
                    genres=seed_genres,
                    excluded_artist_names=[],
                    limit=max(limit * 6, 160),
                )
                underplayed_rows = _merge_track_rows(
                    underplayed_rows,
                    [
                        row
                        for row in broad_rows
                        if not row.get("is_liked")
                        and int(row.get("user_play_count") or 0) <= 1
                    ],
                )
        rows = _merge_track_rows(
            _with_recommendation_source(adjacent_rows, "discovery"),
            _with_recommendation_source(underplayed_rows, "underplayed"),
            _with_recommendation_source(comfort_rows, "comfort"),
        )
        return (
            "Daily Discovery",
            "Fresh tracks orbiting around your favorite scenes.",
            _select_home_mix_tracks(
                _prepare_mix_candidate_rows(_daily_rotate_rows(rows, user_id)),
                limit=limit,
                max_per_artist=2,
                max_per_album=2,
                mix_id=mix_id,
                profile_id="home_daily_discovery_v1",
                user_id=user_id,
            ),
        )

    if mix_id == "my-new-arrivals":
        releases = (
            recent_releases
            if recent_releases is not None
            else _filter_interesting_releases(
                get_new_releases(limit=250),
                interest_artists_lower=set(interest_artists_lower),
                saved_album_ids=set(),
                days=180,
            )
        )
        releases_by_album_id = build_new_arrivals_release_index(
            releases,
            today=datetime.now(timezone.utc).date(),
            max_lookback_weeks=12,
        )
        album_ids = list(releases_by_album_id)[:40]
        if not album_ids:
            return ("", "", [])
        primary_rows = _track_candidates_for_album_ids(
            user_id, album_ids, limit=max(limit * 5, 120)
        )
        rows = _with_release_week_metadata(
            [row for row in primary_rows if not row.get("is_liked")],
            releases_by_album_id,
        )
        return (
            "My New Arrivals",
            "Recent material from the artists already in your orbit.",
            _select_home_mix_tracks(
                _prepare_mix_candidate_rows(rows),
                limit=limit,
                max_per_artist=2,
                max_per_album=2,
                mix_id=mix_id,
                profile_id="home_new_arrivals_v1",
                user_id=user_id,
            ),
        )

    if mix_id.startswith("genre-"):
        genre_slug = mix_id.removeprefix("genre-")
        genre_name = get_genre_display_name(genre_slug)
        direct_genres = [genre_slug, genre_name]
        related_genres = get_related_genre_terms(genre_slug, limit=16, max_depth=2)
        direct_terms = _normalized_terms(direct_genres)
        related_genres = [
            term for term in related_genres if term.strip().lower() not in direct_terms
        ]
        direct_rows = _query_discovery_tracks(
            user_id,
            genres=direct_genres,
            excluded_artist_names=[],
            limit=max(limit * 5, 140),
        )
        related_rows = _query_discovery_tracks(
            user_id,
            genres=related_genres,
            excluded_artist_names=[],
            limit=max(limit * 6, 180),
        )
        rows = _merge_track_rows(
            _with_recommendation_source(direct_rows, "direct_genre"),
            _with_recommendation_source(related_rows, "related_genre"),
        )
        if not rows:
            return ("", "", [])
        max_per_artist = 1 if limit <= 8 else 2
        max_per_album = 1 if limit <= 8 else 2
        return (
            f"{genre_name} mix",
            f"Tracks from your library matching {genre_name} and closely related scenes.",
            _select_home_mix_tracks(
                _prepare_mix_candidate_rows(_daily_rotate_rows(rows, user_id)),
                limit=limit,
                max_per_artist=max_per_artist,
                max_per_album=max_per_album,
                mix_id=mix_id,
                profile_id="home_genre_mix_v1",
                user_id=user_id,
            ),
        )

    return ("", "", [])


def _mix_summary_payload(mix: dict) -> dict:
    return {
        "id": mix["id"],
        "name": mix["name"],
        "description": mix["description"],
        "artwork_tracks": mix["artwork_tracks"],
        "artwork_artists": mix.get("artwork_artists", []),
        "track_count": mix["track_count"],
        "badge": mix["badge"],
        "kind": mix["kind"],
    }


def _profile_id_for_mix(mix_id: str) -> str:
    if mix_id == "my-new-arrivals":
        return "home_new_arrivals_v1"
    if mix_id.startswith("genre-"):
        return "home_genre_mix_v1"
    return "home_daily_discovery_v1"


def _build_custom_mix_summaries(
    user_id: int,
    *,
    mix_seed_genres: list[dict],
    interest_artists_lower: list[str],
    top_genres_lower: list[str],
    mix_count: int,
    summary_track_limit: int = 8,
    recent_releases: list[dict] | None = None,
    precomputed_mixes: dict[str, tuple[str, str, list[dict]]] | None = None,
    global_track_rows: list[dict] | None = None,
) -> list[dict]:
    custom_mix_ids = ["daily-discovery", "my-new-arrivals"]
    custom_mix_ids.extend(
        [
            f"genre-{item['slug']}"
            for item in mix_seed_genres[: max(mix_count - 2, 0)]
            if item.get("slug")
        ]
    )
    mixes: list[dict] = []
    for mix_id in dict.fromkeys(custom_mix_ids):
        precomputed = (precomputed_mixes or {}).get(mix_id)
        if precomputed is not None:
            name, description, rows = precomputed
        else:
            name, description, rows = _build_mix_rows(
                user_id,
                interest_artists_lower=interest_artists_lower,
                top_genres_lower=top_genres_lower,
                mix_id=mix_id,
                limit=summary_track_limit,
                recent_releases=recent_releases,
            )
        extra_rows = _global_rows_for_mix(mix_id, global_track_rows or [])
        if extra_rows:
            rows = _merge_track_rows(rows, extra_rows)
            rows = _select_home_mix_tracks(
                _prepare_mix_candidate_rows(_daily_rotate_rows(rows, user_id)),
                limit=summary_track_limit,
                max_per_artist=2,
                max_per_album=2,
                mix_id=mix_id,
                profile_id=_profile_id_for_mix(mix_id),
                user_id=user_id,
            )
        if not name or not rows:
            continue
        mixes.append(
            {
                "id": mix_id,
                "name": name,
                "description": description,
                "artwork_tracks": _artwork_tracks(rows),
                "artwork_artists": _artwork_artists(rows),
                "track_count": len(rows),
                "badge": "Mix",
                "kind": "mix",
            }
        )
        if len(mixes) >= mix_count:
            break
    return mixes


__all__ = [
    "_daily_rotate_rows",
    "_build_custom_mix_summaries",
    "_build_mix_rows",
    "_global_rows_for_mix",
    "_mix_summary_payload",
]
