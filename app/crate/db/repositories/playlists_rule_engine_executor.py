from __future__ import annotations

from typing import Literal, overload

from sqlalchemy import text

from crate.db.repositories.playlists_rule_engine_builder import build_rule_conditions
from crate.db.repositories.playlists_rule_engine_config import SORT_MAP
from crate.db.repositories.playlists_rule_engine_genre import combine_sql_extrema
from crate.db.tx import read_scope
from crate.genre_taxonomy import get_related_genre_terms
from crate.track_versions import dedupe_track_variants


@overload
def execute_smart_rules(rules: dict, *, count_only: Literal[True]) -> int: ...


@overload
def execute_smart_rules(
    rules: dict, *, count_only: Literal[False] = False
) -> list[dict]: ...


def execute_smart_rules(rules: dict, *, count_only: bool = False) -> list[dict] | int:
    match_mode = rules.get("match", "all")
    rule_list = rules.get("rules", [])
    limit = _positive_int(rules.get("limit"), default=50)
    sort = rules.get("sort", "random")
    has_genre_rule = _has_genre_rule(rule_list)
    has_artist_rule = _has_artist_rule(rule_list)
    deduplicate_artist = rules.get(
        "deduplicate_artist", has_genre_rule and not has_artist_rule
    )
    max_per_artist = _positive_int(rules.get("max_per_artist"), default=2)
    max_per_album = _positive_int(rules.get("max_per_album"), default=2)
    expand_related_genres = bool(rules.get("expand_related_genres", has_genre_rule))

    where, params, genre_score_exprs = build_rule_conditions(rule_list, match_mode)

    with read_scope() as session:
        if count_only:
            row = (
                session.execute(
                    text(
                        f"""
                    SELECT COUNT(*) AS cnt
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON t.album_id = a.id
                    LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
                    WHERE ({where})
                      AND (t.entity_uid IS NOT NULL OR t.storage_id IS NOT NULL)
                    """
                    ),
                    params,
                )
                .mappings()
                .first()
            )
            return row["cnt"] if row else 0

        sort_clause = SORT_MAP.get(sort, "RANDOM()")
        sort_clause = _with_genre_relevance_sort(
            sort_clause, genre_score_exprs, match_mode
        )

        fetch_limit = (
            _diverse_fetch_limit(limit, max_per_artist) if deduplicate_artist else limit
        )
        rows = _fetch_smart_rule_rows(
            session,
            where=where,
            params=params,
            sort_clause=sort_clause,
            limit=fetch_limit,
        )

    results = [dict(row) for row in rows]

    if deduplicate_artist and max_per_artist > 0:
        if expand_related_genres:
            expanded_rules = _expand_related_genre_rules(rule_list)
            if expanded_rules != rule_list:
                expanded_where, expanded_params, expanded_genre_score_exprs = (
                    build_rule_conditions(expanded_rules, match_mode)
                )
                expanded_sort_clause = _with_genre_relevance_sort(
                    SORT_MAP.get(sort, "RANDOM()"),
                    expanded_genre_score_exprs,
                    match_mode,
                )
                with read_scope() as session:
                    expanded_rows = _fetch_smart_rule_rows(
                        session,
                        where=expanded_where,
                        params=expanded_params,
                        sort_clause=expanded_sort_clause,
                        limit=max(fetch_limit, _diverse_fetch_limit(limit, 1)),
                    )
                results = _merge_smart_rows(
                    results, [dict(row) for row in expanded_rows]
                )

        return _select_diverse_smart_rows(
            results,
            limit=limit,
            max_per_artist=max_per_artist,
            max_per_album=max_per_album,
        )
    return results[:limit]


def _positive_int(value: object, *, default: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _has_genre_rule(rule_list: list[dict]) -> bool:
    return any(rule.get("field") == "genre" for rule in rule_list)


def _has_artist_rule(rule_list: list[dict]) -> bool:
    return any(rule.get("field") == "artist" for rule in rule_list)


def _with_genre_relevance_sort(
    sort_clause: str, genre_score_exprs: list[str], match_mode: str
) -> str:
    if not genre_score_exprs:
        return sort_clause
    genre_relevance = combine_sql_extrema(
        genre_score_exprs,
        mode="least" if match_mode == "all" else "greatest",
    )
    return f"{genre_relevance} DESC, {sort_clause}"


def _diverse_fetch_limit(limit: int, max_per_artist: int) -> int:
    if limit <= 0:
        return 0
    return min(max(limit * max(max_per_artist * 6, 12), 200), 2000)


def _fetch_smart_rule_rows(
    session,
    *,
    where: str,
    params: dict,
    sort_clause: str,
    limit: int,
):
    query_params = {**params, "lim": limit}
    return (
        session.execute(
            text(
                f"""
            SELECT t.id, t.id AS track_id,
                   t.entity_uid::text AS entity_uid, t.storage_id::text AS storage_id,
                   t.path, t.path AS track_path, t.title, t.artist, a.name AS album,
                   t.duration, t.format, t.bpm, t.energy, t.genre, t.year,
                   a.id AS album_id, a.slug AS album_slug,
                   a_artist.id AS artist_id, a_artist.slug AS artist_slug
            FROM library_tracks t
            LEFT JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
            WHERE ({where})
              AND (t.entity_uid IS NOT NULL OR t.storage_id IS NOT NULL)
            ORDER BY {sort_clause}
            LIMIT :lim
            """
            ),
            query_params,
        )
        .mappings()
        .all()
    )


def _expand_related_genre_rules(rule_list: list[dict]) -> list[dict]:
    expanded_rules: list[dict] = []
    for rule in rule_list:
        if rule.get("field") != "genre" or rule.get("op") != "contains":
            expanded_rules.append(rule)
            continue

        raw_values = _split_rule_values(rule.get("value"))
        values: list[str] = []
        seen: set[str] = set()
        for raw_value in raw_values:
            for candidate in [raw_value, *get_related_genre_terms(raw_value, limit=16)]:
                normalized = candidate.strip().lower()
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                values.append(candidate)

        expanded_rules.append({**rule, "value": "|".join(values) or rule.get("value")})
    return expanded_rules


def _split_rule_values(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").split("|") if item.strip()]


def _track_identity(track: dict) -> object:
    return (
        track.get("track_id")
        or track.get("id")
        or track.get("track_path")
        or track.get("path")
    )


def _merge_smart_rows(*collections: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen_tracks: set[object] = set()

    for rows in collections:
        for row in rows:
            track_key = _track_identity(row)
            if not track_key or track_key in seen_tracks:
                continue
            seen_tracks.add(track_key)
            merged.append(row)
    return merged


def _select_diverse_smart_rows(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int,
    max_per_album: int,
) -> list[dict]:
    rows = dedupe_track_variants(rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}
    passes = [
        (max_per_artist, max_per_album),
        (max(max_per_artist + 1, 3), max(max_per_album + 1, 3)),
        (limit, limit),
    ]

    for artist_limit, album_limit in passes:
        for track in rows:
            track_key = _track_identity(track)
            if not track_key or track_key in seen_tracks:
                continue
            artist = str(track.get("artist") or "").strip().lower()
            album = str(track.get("album") or "").strip().lower()
            album_key = (artist, album)
            if artist and artist_counts.get(artist, 0) >= artist_limit:
                continue
            if album and album_counts.get(album_key, 0) >= album_limit:
                continue

            seen_tracks.add(track_key)
            if artist:
                artist_counts[artist] = artist_counts.get(artist, 0) + 1
            if album:
                album_counts[album_key] = album_counts.get(album_key, 0) + 1
            selected.append(track)
            if len(selected) >= limit:
                return selected

    return selected


__all__ = ["execute_smart_rules"]
