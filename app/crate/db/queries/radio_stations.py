from __future__ import annotations

from decimal import Decimal

from sqlalchemy import text

from crate.db.home_context import get_cached_home_context, merged_artists_from_context
from crate.db.tx import read_scope
from crate.db.queries.genres_shared import MIN_GENRE_MEMBERSHIP_SCORE
from crate.db.queries.genres_taxonomy import get_genre_taxonomy_cover_path
from crate.db.repositories.global_user_library import list_global_collection_artists
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


def _genre_station(row: dict) -> dict | None:
    genre_name = (row.get("genre_name") or row.get("name") or "").strip()
    if not genre_name:
        return None

    genre_slug = resolve_genre_slug(genre_name)
    if not genre_slug:
        return None

    display_name = get_genre_display_name(genre_slug)
    cover_url = (
        genre_cover_public_url(genre_slug)
        if get_genre_taxonomy_cover_path(genre_slug)
        else None
    )
    return {
        "type": "genre",
        "seed_type": "genre",
        "seed_value": genre_slug,
        "seed_label": display_name,
        "seed_subtitle": "Genre",
        "genre_slug": genre_slug,
        "genre_name": display_name,
        "cover_url": cover_url,
        "title": f"{display_name} Radio",
        "subtitle": "",
        "play_count": _int_value(row.get("play_count")),
        "minutes_listened": _int_value(row.get("minutes_listened")),
    }


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
    stations: list[dict] = []
    seen: set[str] = set()
    for row in context.get("top_genres") or []:
        station = _genre_station(row)
        if not station:
            continue
        genre_slug = station["genre_slug"]
        if genre_slug in seen:
            continue
        seen.add(genre_slug)
        stations.append(station)
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


def _add_genre_station_artwork_fallbacks(stations: list[dict]) -> None:
    missing_cover_stations = [
        station
        for station in stations
        if station.get("type") == "genre" and not station.get("cover_url")
    ]
    if not missing_cover_stations:
        return

    genre_names = list(
        dict.fromkeys(station["genre_name"] for station in missing_cover_stations)
    )
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT DISTINCT ON (requested.genre_name)
                        requested.genre_name,
                        la.id AS artist_id
                    FROM unnest(CAST(:genre_names AS text[])) AS requested(genre_name)
                    JOIN genres g
                      ON LOWER(TRIM(g.name)) = LOWER(TRIM(requested.genre_name))
                    JOIN artist_genres ag ON ag.genre_id = g.id
                    JOIN library_artists la ON la.name = ag.artist_name
                    WHERE COALESCE(ag.weight, 0) >= :min_membership_score
                    ORDER BY
                        requested.genre_name,
                        COALESCE(ag.weight, 0) DESC,
                        COALESCE(la.listeners, 0) DESC,
                        COALESCE(la.lastfm_playcount, 0) DESC,
                        COALESCE(la.album_count, 0) DESC,
                        la.name ASC
                    """
                ),
                {
                    "genre_names": genre_names,
                    "min_membership_score": MIN_GENRE_MEMBERSHIP_SCORE,
                },
            )
            .mappings()
            .all()
        )

    backgrounds_by_genre = {
        str(row["genre_name"]).casefold(): (
            f"/api/artists/{row['artist_id']}/background?size=640&format=webp"
        )
        for row in rows
        if row.get("artist_id") is not None
    }
    for station in missing_cover_stations:
        fallback = backgrounds_by_genre.get(station["genre_name"].casefold())
        if fallback:
            station["cover_url"] = fallback


def get_user_radio_stations(user_id: int) -> dict:
    context = get_cached_home_context(
        user_id,
        top_artist_limit=24,
        top_album_limit=1,
        top_genre_limit=16,
    )
    stations = build_radio_stations_from_context(context)
    _add_genre_station_artwork_fallbacks(stations["genre_stations"])
    return stations
