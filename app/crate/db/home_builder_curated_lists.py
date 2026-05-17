from __future__ import annotations

from crate.db.home_builder_discovery import (
    _build_artist_core_rows,
    _query_discovery_tracks,
)
from crate.db.home_builder_shared import (
    _artwork_artists,
    _artwork_tracks,
    _select_diverse_tracks_with_backfill,
)
from crate.db.queries.home import get_artists_core_track_rows
from crate.db.repositories.playlists import list_system_playlists
from crate.slugs import build_artist_slug

SYSTEM_PLAYLIST_HOME_PREFIX = "system-playlist-"


def _artist_slug_from_playlist_rules(playlist: dict) -> str | None:
    curation_key = str(playlist.get("curation_key") or "")
    prefix = "blueprint:artist:"
    if curation_key.startswith(prefix):
        remainder = curation_key.removeprefix(prefix)
        artist_slug = remainder.split(":", 1)[0].strip()
        if artist_slug:
            return artist_slug

    smart_rules = playlist.get("smart_rules") or {}
    for rule in smart_rules.get("rules") or []:
        if rule.get("field") != "artist":
            continue
        raw_value = str(rule.get("value") or "").strip()
        if raw_value:
            return build_artist_slug(raw_value)
    return None


def _candidate_identity(row: dict) -> str | None:
    artist_id = row.get("artist_id")
    if artist_id is not None:
        return f"id:{artist_id}"
    artist_slug = row.get("artist_slug") or build_artist_slug(
        row.get("artist_name") or ""
    )
    if artist_slug:
        return f"slug:{artist_slug}"
    return None


def _dedupe_artist_candidates(candidates: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for row in candidates:
        artist_name = row.get("artist_name") or ""
        if row.get("artist_id") is None or not artist_name:
            continue
        identity = _candidate_identity(row)
        if not identity or identity in seen:
            continue
        seen.add(identity)
        deduped.append(row)
    return deduped


def _blend_core_candidates(
    comfort_candidates: list[dict],
    discovery_candidates: list[dict],
    limit: int,
    discovery_target: int | None = None,
) -> list[dict]:
    if limit <= 0:
        return []

    comfort = [
        {**row, "recommendation_source": "comfort"}
        for row in _dedupe_artist_candidates(comfort_candidates)
    ]
    discovery = [
        {**row, "recommendation_source": "discovery"}
        for row in _dedupe_artist_candidates(discovery_candidates)
    ]

    selected: list[dict] = []
    seen: set[str] = set()

    def append_unique(rows: list[dict], max_items: int) -> None:
        for row in rows:
            if len(selected) >= limit or max_items <= 0:
                return
            identity = _candidate_identity(row)
            if not identity or identity in seen:
                continue
            selected.append(row)
            seen.add(identity)
            max_items -= 1

    target = discovery_target if discovery_target is not None else max(1, limit // 2)
    target = min(len(discovery), target) if discovery else 0
    append_unique(discovery, target)
    append_unique(comfort, limit - len(selected))
    append_unique(discovery, limit - len(selected))
    return selected


def _build_core_discovery_artists(
    user_id: int,
    *,
    top_genres_lower: list[str],
    interest_artists_lower: list[str],
    limit: int,
) -> list[dict]:
    rows = _query_discovery_tracks(
        user_id,
        genres=top_genres_lower[:4],
        excluded_artist_names=interest_artists_lower[:24],
        limit=max(limit * 8, 80),
    )
    candidates: list[dict] = []
    seen: set[int] = set()
    for row in rows:
        artist_id = row.get("artist_id")
        artist_name = row.get("artist") or row.get("artist_name") or ""
        if artist_id is None or not artist_name:
            continue
        artist_id_int = int(artist_id)
        if artist_id_int in seen:
            continue
        seen.add(artist_id_int)
        candidates.append(
            {
                "artist_id": artist_id_int,
                "artist_entity_uid": row.get("artist_entity_uid"),
                "artist_slug": row.get("artist_slug"),
                "artist_name": artist_name,
                "play_count": 0,
                "minutes_listened": 0,
                "recommendation_source": "discovery",
            }
        )
        if len(candidates) >= limit:
            break
    return candidates


def _system_core_playlist_by_artist_slug(candidates: list[dict]) -> dict[str, dict]:
    wanted_slugs = {
        build_artist_slug(row.get("artist_name") or "")
        for row in candidates
        if row.get("artist_name")
    }
    if not wanted_slugs:
        return {}

    playlists = list_system_playlists(
        only_curated=False,
        only_active=True,
        category="artist",
    )
    by_artist_slug: dict[str, dict] = {}
    for playlist in playlists:
        if playlist.get("generation_mode") != "smart":
            continue
        if int(playlist.get("track_count") or 0) <= 0:
            continue
        artist_slug = _artist_slug_from_playlist_rules(playlist)
        if not artist_slug or artist_slug not in wanted_slugs:
            continue
        by_artist_slug.setdefault(artist_slug, playlist)
    return by_artist_slug


def _system_core_playlist_summary(
    playlist: dict, *, recommendation_source: str
) -> dict:
    artwork_tracks = playlist.get("artwork_tracks") or []
    return {
        "id": f"{SYSTEM_PLAYLIST_HOME_PREFIX}{playlist['id']}",
        "playlist_id": playlist["id"],
        "name": playlist.get("name") or "Core Tracks",
        "description": playlist.get("description") or "Editorial core tracks.",
        "artwork_tracks": artwork_tracks,
        "artwork_artists": _artwork_artists(artwork_tracks),
        "track_count": int(playlist.get("track_count") or 0),
        "badge": "Core Tracks",
        "kind": "core",
        "source": "system",
        "recommendation_source": recommendation_source,
    }


def _build_radio_stations(
    top_artists: list[dict], top_albums: list[dict], limit: int
) -> list[dict]:
    radio_stations: list[dict] = []
    seen: set[tuple[str, object]] = set()

    for row in top_artists:
        artist_id = row.get("artist_id")
        if artist_id is None:
            continue
        key = ("artist", artist_id)
        if key in seen:
            continue
        seen.add(key)
        radio_stations.append(
            {
                "type": "artist",
                "artist_id": artist_id,
                "artist_slug": row.get("artist_slug"),
                "artist_name": row.get("artist_name") or "",
                "title": f"{row.get('artist_name') or ''} Radio",
                "subtitle": "Based on your heavy rotation",
                "play_count": row.get("play_count") or 0,
            }
        )
        if len(radio_stations) >= limit:
            return radio_stations

    for row in top_albums:
        album_id = row.get("album_id")
        if album_id is None:
            continue
        key = ("album", album_id)
        if key in seen:
            continue
        seen.add(key)
        radio_stations.append(
            {
                "type": "album",
                "album_id": album_id,
                "album_slug": row.get("album_slug"),
                "album_name": row.get("album") or "",
                "artist_name": row.get("artist") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "title": f"{row.get('album') or ''} Radio",
                "subtitle": "Seeded from an album you keep coming back to",
                "play_count": row.get("play_count") or 0,
            }
        )
        if len(radio_stations) >= limit:
            break

    return radio_stations


def _build_favorite_artists(top_artists: list[dict], limit: int) -> list[dict]:
    return [
        {
            "artist_id": row.get("artist_id"),
            "artist_slug": row.get("artist_slug"),
            "artist_name": row.get("artist_name") or "",
            "play_count": row.get("play_count") or 0,
            "minutes_listened": row.get("minutes_listened") or 0,
        }
        for row in top_artists[:limit]
        if row.get("artist_id") is not None
    ]


def _build_core_playlists(
    user_id: int,
    top_artists: list[dict],
    limit: int,
    track_limit: int = 8,
    discovery_artists: list[dict] | None = None,
) -> list[dict]:
    essentials: list[dict] = []
    comfort_candidates = [
        row
        for row in top_artists
        if row.get("artist_id") is not None and (row.get("artist_name") or "")
    ]
    visible_discovery_target = max(1, limit // 2) if discovery_artists else 0
    candidates = _blend_core_candidates(
        comfort_candidates,
        discovery_artists or [],
        limit=max(limit * 2, limit),
        discovery_target=visible_discovery_target,
    )
    system_by_artist_slug = _system_core_playlist_by_artist_slug(candidates)
    artist_ids = [
        int(artist_id)
        for row in candidates
        if (artist_id := row.get("artist_id")) is not None
        and build_artist_slug(row.get("artist_name") or "") not in system_by_artist_slug
    ]
    rows_by_artist: dict[int, list[dict]] = {}
    if artist_ids:
        for track in get_artists_core_track_rows(
            artist_ids=artist_ids, per_artist_limit=track_limit
        ):
            artist_id = track.get("artist_id")
            if artist_id is None:
                continue
            rows_by_artist.setdefault(int(artist_id), []).append(track)

    for row in candidates:
        artist_id = row.get("artist_id")
        if artist_id is None:
            continue
        artist_id_int = int(artist_id)
        artist_name = row.get("artist_name") or ""
        artist_slug = build_artist_slug(artist_name)
        recommendation_source = row.get("recommendation_source") or "comfort"
        if system_playlist := system_by_artist_slug.get(artist_slug):
            essentials.append(
                _system_core_playlist_summary(
                    system_playlist,
                    recommendation_source=str(recommendation_source),
                )
            )
            if len(essentials) >= limit:
                break
            continue

        rows = _select_diverse_tracks_with_backfill(
            rows_by_artist.get(artist_id_int, []),
            limit=track_limit,
            max_per_artist=track_limit,
            max_per_album=2,
        )
        if not rows:
            rows = _build_artist_core_rows(
                user_id,
                artist_id=artist_id_int,
                artist_name=artist_name,
                limit=track_limit,
            )
        if not rows:
            continue
        essentials.append(
            {
                "id": f"core-tracks-artist-{artist_id_int}",
                "name": artist_name,
                "description": (
                    f"A discovery route into {artist_name}, tuned to your library."
                    if recommendation_source == "discovery"
                    else f"The defining tracks from {artist_name}."
                ),
                "artwork_tracks": _artwork_tracks(rows),
                "artwork_artists": _artwork_artists(rows),
                "track_count": len(rows),
                "badge": "Core Tracks",
                "kind": "core",
                "recommendation_source": recommendation_source,
            }
        )
        if len(essentials) >= limit:
            break
    return essentials


__all__ = [
    "_build_core_playlists",
    "_build_core_discovery_artists",
    "_build_favorite_artists",
    "_build_radio_stations",
    "_blend_core_candidates",
]
