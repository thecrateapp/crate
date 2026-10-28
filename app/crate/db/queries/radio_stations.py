from __future__ import annotations

import re
from decimal import Decimal

from sqlalchemy import text

from crate.db.home_context import get_cached_home_context, merged_artists_from_context
from crate.db.repositories.global_user_library import list_global_collection_artists
from crate.db.tx import read_scope
from crate.genre_covers import genre_cover_public_url
from crate.genre_taxonomy import get_genre_display_name, resolve_genre_slug


def _int_value(value: object) -> int:
    if value is None:
        return 0
    if not isinstance(value, int | float | Decimal | str):
        return 0
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _is_hidden_artist_name(value: object) -> bool:
    artist_name = str(value or "").strip().lower()
    return bool(artist_name) and (
        artist_name.startswith(".") or artist_name == "crate-trash"
    )


def _artist_station(row: dict) -> dict | None:
    artist_id = row.get("artist_id")
    global_artist_uid = row.get("global_artist_uid")
    artist_name = (row.get("artist_name") or "").strip()
    artist_slug = row.get("artist_slug")
    seed_value = str(artist_id) if artist_id is not None else global_artist_uid
    if not seed_value or not artist_name or _is_hidden_artist_name(artist_name):
        return None
    if _is_hidden_artist_name(artist_slug):
        return None

    return {
        "type": "artist",
        "seed_type": "artist",
        "seed_value": seed_value,
        "seed_label": artist_name,
        "seed_subtitle": "Artist",
        "artist_id": artist_id,
        "global_artist_uid": global_artist_uid,
        "artist_entity_uid": row.get("artist_entity_uid"),
        "artist_slug": artist_slug,
        "artist_name": artist_name,
        "title": f"{artist_name} Radio",
        "subtitle": "",
        "play_count": _int_value(row.get("play_count")),
        "minutes_listened": _int_value(row.get("minutes_listened")),
    }


_GENRE_TAG_SEPARATOR = re.compile(r"\s*[,;]\s*")


def _genre_slugs(row: dict) -> list[str]:
    genre_tag = (row.get("genre_name") or row.get("name") or "").strip()
    slugs: list[str] = []
    for part in _GENRE_TAG_SEPARATOR.split(genre_tag):
        slug = resolve_genre_slug(part) if part else None
        if slug and slug not in slugs:
            slugs.append(slug)
    return slugs


def get_genre_radio_representatives(slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH wanted AS (
                        SELECT unnest(CAST(:slugs AS text[])) AS slug
                    )
                    SELECT DISTINCT ON (wanted.slug)
                        wanted.slug,
                        node.cover_path,
                        album.id AS album_id,
                        album.entity_uid::text AS album_entity_uid,
                        album.slug AS album_slug,
                        album.name AS album_name
                    FROM wanted
                    JOIN genres ON genres.slug = wanted.slug
                    JOIN artist_genres ON artist_genres.genre_id = genres.id
                    LEFT JOIN genre_taxonomy_nodes node ON node.slug = wanted.slug
                    LEFT JOIN library_albums album
                      ON album.artist = artist_genres.artist_name
                     AND album.has_cover > 0
                    ORDER BY
                        wanted.slug,
                        album.id IS NULL,
                        artist_genres.weight DESC,
                        album.id
                    """
                ),
                {"slugs": slugs},
            )
            .mappings()
            .all()
        )
    return {str(row["slug"]): dict(row) for row in rows}


def _genre_station(
    genre_slug: str, play_count: int, minutes_listened: int, representative: dict
) -> dict:
    display_name = get_genre_display_name(genre_slug)
    station = {
        "type": "genre",
        "seed_type": "genre",
        "seed_value": genre_slug,
        "seed_label": display_name,
        "seed_subtitle": "Genre",
        "genre_slug": genre_slug,
        "genre_name": display_name,
        "cover_url": (
            genre_cover_public_url(genre_slug)
            if representative.get("cover_path")
            else None
        ),
        "title": f"{display_name} Radio",
        "subtitle": "",
        "play_count": play_count,
        "minutes_listened": minutes_listened,
    }
    if not station["cover_url"] and representative.get("album_id") is not None:
        station.update(
            {
                "album_id": representative["album_id"],
                "album_entity_uid": representative.get("album_entity_uid"),
                "album_slug": representative.get("album_slug"),
                "album_name": representative.get("album_name"),
            }
        )
    return station


def _build_artist_stations(context: dict, *, limit: int) -> list[dict]:
    stations: list[dict] = []
    seen: set[str] = set()
    for row in merged_artists_from_context(context):
        station = _artist_station(row)
        if not station:
            continue
        seed_value = str(station["seed_value"])
        if seed_value in seen:
            continue
        seen.add(seed_value)
        stations.append(station)
        if len(stations) >= limit:
            return stations

    for row in list_global_collection_artists(limit=limit * 2):
        station = _artist_station(row)
        if not station:
            continue
        seed_value = str(station["seed_value"])
        if seed_value in seen:
            continue
        if row.get("photo_url"):
            station["cover_url"] = row.get("photo_url")
        seen.add(seed_value)
        stations.append(station)
        if len(stations) >= limit:
            return stations
    return stations


def _build_genre_stations(context: dict, *, limit: int) -> list[dict]:
    listening: dict[str, list[int]] = {}
    for row in context.get("top_genres") or []:
        for genre_slug in _genre_slugs(row):
            totals = listening.setdefault(genre_slug, [0, 0])
            totals[0] += _int_value(row.get("play_count"))
            totals[1] += _int_value(row.get("minutes_listened"))
    ranked = sorted(listening.items(), key=lambda item: (-item[1][0], -item[1][1]))
    representatives = get_genre_radio_representatives(
        [genre_slug for genre_slug, _ in ranked]
    )
    stations: list[dict] = []
    for genre_slug, (play_count, minutes_listened) in ranked:
        representative = representatives.get(genre_slug)
        if representative is None:
            continue
        stations.append(
            _genre_station(genre_slug, play_count, minutes_listened, representative)
        )
        if len(stations) >= limit:
            break
    return stations


def build_radio_stations_from_context(
    context: dict,
    *,
    artist_limit: int = 12,
    genre_limit: int = 12,
) -> dict:
    return {
        "artist_stations": _build_artist_stations(context, limit=artist_limit),
        "genre_stations": _build_genre_stations(context, limit=genre_limit),
    }


def get_user_radio_stations(user_id: int) -> dict:
    context = get_cached_home_context(
        user_id,
        top_artist_limit=24,
        top_album_limit=1,
        top_genre_limit=16,
    )
    return build_radio_stations_from_context(context)
