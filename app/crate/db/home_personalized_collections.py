from __future__ import annotations

from crate.db.home_builders import (
    _artwork_artists,
    _artwork_tracks,
    _build_artist_core_rows,
    _build_core_playlists,
    _build_core_discovery_artists,
    _build_custom_mix_summaries,
    _build_favorite_artists,
    _build_mix_rows,
    _build_radio_stations,
    _build_recommended_tracks,
    _build_recently_played,
    _build_suggested_albums,
    _get_home_hero,
    _get_library_artist,
    _global_rows_for_mix,
    _track_payload,
)
from crate.db.home_builder_curated_lists import SYSTEM_PLAYLIST_HOME_PREFIX
from crate.db.home_builder_curated_lists import GLOBAL_ARTIST_CORE_HOME_PREFIX
from crate.db.home_builder_global_recommendations import (
    global_artist_uids_from_context,
    global_recommended_track_rows,
    global_suggested_albums,
    merge_global_track_rows,
    merge_suggested_albums,
)
from crate.db.home_context import (
    get_cached_home_context,
    merged_artists_from_context,
    recent_releases_from_context,
)
from crate.db.queries.global_catalog import get_global_radio_seed_tracks
from crate.db.repositories.playlists import get_playlist, get_playlist_tracks
from crate.federation.global_policy import global_catalog_surface_enabled
from crate.track_versions import dedupe_track_variants


def _global_home_track_rows(context: dict, *, limit: int) -> list[dict]:
    return global_recommended_track_rows(
        global_artist_uids_from_context(context),
        limit=limit,
    )


def get_home_mix(user_id: int, mix_id: str, limit: int = 40) -> dict | None:
    context = get_cached_home_context(
        user_id, top_artist_limit=28, top_album_limit=12, top_genre_limit=8
    )
    recent_releases = recent_releases_from_context(context)

    name, description, rows = _build_mix_rows(
        user_id,
        interest_artists_lower=context["interest_artists_lower"],
        top_genres_lower=context["top_genres_lower"],
        mix_id=mix_id,
        limit=limit,
        recent_releases=recent_releases,
    )
    global_rows = _global_rows_for_mix(
        mix_id,
        _global_home_track_rows(context, limit=max(limit, 40)),
    )
    if not name or not rows:
        if not name or not global_rows:
            return None
        rows = global_rows
    else:
        rows = merge_global_track_rows(
            rows,
            global_rows,
            limit=limit,
        )
    rows = dedupe_track_variants(rows)

    return {
        "id": mix_id,
        "name": name,
        "description": description,
        "artwork_tracks": _artwork_tracks(rows),
        "artwork_artists": _artwork_artists(rows),
        "track_count": len(rows),
        "total_duration": sum(int(row.get("duration") or 0) for row in rows),
        "badge": "Mix",
        "kind": "mix",
        "tracks": [_track_payload(row) for row in rows],
    }


def get_home_playlist(user_id: int, playlist_id: str, limit: int = 40) -> dict | None:
    core_prefix = "core-tracks-artist-"
    if not playlist_id.startswith(
        (
            SYSTEM_PLAYLIST_HOME_PREFIX,
            GLOBAL_ARTIST_CORE_HOME_PREFIX,
            core_prefix,
        )
    ):
        mix = get_home_mix(user_id, playlist_id, limit=limit)
        if mix:
            return mix

    if playlist_id.startswith(SYSTEM_PLAYLIST_HOME_PREFIX):
        try:
            system_playlist_id = int(
                playlist_id.removeprefix(SYSTEM_PLAYLIST_HOME_PREFIX)
            )
        except ValueError:
            return None
        playlist = get_playlist(system_playlist_id)
        if not playlist or playlist.get("scope") != "system":
            return None
        if not playlist.get("is_active", False):
            return None
        tracks = get_playlist_tracks(system_playlist_id)[:limit]
        return {
            "id": playlist_id,
            "playlist_id": system_playlist_id,
            "name": playlist.get("name") or "Core Tracks",
            "description": playlist.get("description") or "Editorial core tracks.",
            "artwork_tracks": playlist.get("artwork_tracks") or _artwork_tracks(tracks),
            "artwork_artists": _artwork_artists(tracks),
            "track_count": len(tracks),
            "total_duration": sum(int(row.get("duration") or 0) for row in tracks),
            "badge": "Core Tracks"
            if playlist.get("generation_mode") == "smart"
            else "Crate Selects",
            "kind": "core",
            "tracks": [_track_payload(row) for row in tracks],
        }

    if playlist_id.startswith(GLOBAL_ARTIST_CORE_HOME_PREFIX):
        if not global_catalog_surface_enabled("home"):
            return None
        global_artist_uid = playlist_id.removeprefix(GLOBAL_ARTIST_CORE_HOME_PREFIX)
        seed = get_global_radio_seed_tracks("artist", global_artist_uid, limit=limit)
        if not seed:
            return None
        rows = list(seed.get("tracks") or [])[:limit]
        if not rows:
            return None
        artist_name = str(seed.get("label") or rows[0].get("artist") or "Artist")
        return {
            "id": playlist_id,
            "name": artist_name,
            "description": f"The defining tracks from {artist_name}, shaped by what you keep coming back to.",
            "artwork_tracks": _artwork_tracks(rows),
            "artwork_artists": _artwork_artists(rows),
            "track_count": len(rows),
            "total_duration": sum(int(row.get("duration") or 0) for row in rows),
            "badge": "Artist Set",
            "kind": "core",
            "tracks": [_track_payload(row) for row in rows],
        }

    if not playlist_id.startswith(core_prefix):
        return None

    try:
        artist_id = int(playlist_id.removeprefix(core_prefix))
    except ValueError:
        return None

    artist = _get_library_artist(artist_id)
    if not artist:
        return None

    rows = _build_artist_core_rows(
        user_id, artist_id=artist_id, artist_name=artist["name"], limit=limit
    )
    if not rows:
        return None
    rows = dedupe_track_variants(rows)

    return {
        "id": playlist_id,
        "name": artist["name"],
        "description": f"The defining tracks from {artist['name']}, shaped by what you keep coming back to.",
        "artwork_tracks": _artwork_tracks(rows),
        "artwork_artists": _artwork_artists(rows),
        "track_count": len(rows),
        "total_duration": sum(int(row.get("duration") or 0) for row in rows),
        "badge": "Artist Set",
        "kind": "core",
        "tracks": [_track_payload(row) for row in rows],
    }


def get_home_hero(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return (
        _get_home_hero(
            user_id,
            ctx["followed_names_lower"],
            ctx["top_artist_names_lower"][:8],
            ctx["top_genres_lower"][:4],
        )
        or []
    )


def get_home_recently_played(user_id: int) -> list[dict]:
    return _build_recently_played(user_id, limit=18)


def get_home_mixes(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    recent_releases = recent_releases_from_context(ctx)
    return _build_custom_mix_summaries(
        user_id,
        mix_seed_genres=ctx["mix_seed_genres"],
        interest_artists_lower=ctx["interest_artists_lower"],
        top_genres_lower=ctx["top_genres_lower"],
        mix_count=8,
        recent_releases=recent_releases,
        global_track_rows=_global_home_track_rows(ctx, limit=64),
    )


def get_home_suggested_albums(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    local_albums = _build_suggested_albums(recent_releases_from_context(ctx), 14)
    return merge_suggested_albums(
        local_albums,
        global_suggested_albums(14),
        limit=14,
    )


def get_home_recommended_tracks(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    rows = _build_recommended_tracks(
        user_id,
        recent_releases=recent_releases_from_context(ctx),
        interest_artists_lower=ctx["interest_artists_lower"],
        limit=18,
    )
    rows = merge_global_track_rows(
        rows,
        global_recommended_track_rows(global_artist_uids_from_context(ctx), limit=18),
        limit=18,
    )
    return [_track_payload(row) for row in rows]


def get_home_radio_stations(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_radio_stations(
        merged_artists_from_context(ctx), ctx["top_albums"], 14
    )


def get_home_favorite_artists(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    return _build_favorite_artists(merged_artists_from_context(ctx), 14)


def get_home_essentials(user_id: int) -> list[dict]:
    ctx = get_cached_home_context(user_id)
    discovery_artists = _build_core_discovery_artists(
        user_id,
        top_genres_lower=ctx["top_genres_lower"],
        interest_artists_lower=ctx["interest_artists_lower"],
        limit=14,
    )
    return _build_core_playlists(
        user_id,
        merged_artists_from_context(ctx),
        7,
        discovery_artists=discovery_artists,
    )


__all__ = [
    "get_home_essentials",
    "get_home_favorite_artists",
    "get_home_hero",
    "get_home_mix",
    "get_home_mixes",
    "get_home_playlist",
    "get_home_radio_stations",
    "get_home_recently_played",
    "get_home_recommended_tracks",
    "get_home_suggested_albums",
]
