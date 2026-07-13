"""Canonical catalog APIs for Listen."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from crate.api.auth import _require_auth
from crate.api.browse_artist import (
    api_artist_background_by_entity_uid,
    api_artist_background_by_id,
    api_artist_page_by_entity_uid,
    api_artist_photo_by_entity_uid,
    api_artist_photo_by_id,
)
from crate.api.browse_album import api_cover_by_entity_uid, api_cover_by_id
from crate.api.browse_media import (
    _playback_payload_for_track,
    api_eq_features_by_entity_uid,
    api_eq_features_by_id,
    api_track_effective_eq_by_entity_uid,
    api_track_effective_eq_by_id,
    api_track_genre_by_entity_uid,
    api_track_genre_by_id,
    api_track_info_by_entity_uid,
    api_track_info_by_id,
)
from crate.api.federation_remote import (
    remote_album_cover_cached as remote_album_cover,
    remote_artist_background,
    remote_artist_photo,
    resolve_remote_playback,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.media import (
    EffectiveEqResponse,
    EqFeaturesResponse,
    PlaybackResolutionResponse,
    SearchResponse,
    TrackGenreResponse,
    TrackInfoResponse,
)
from crate.db.repositories.streaming import (
    get_track_delivery_row_by_entity_uid,
    get_track_delivery_row_by_id,
)
from crate.db.queries.global_catalog import (
    get_global_album_detail,
    get_global_artist_page,
    get_global_genre_detail,
    get_global_track_info,
    get_global_track_genres,
    list_global_catalog_genres,
    search_global_catalog,
)
from crate.db.repositories.global_user_library import (
    follow_global_artist,
    is_global_album_saved,
    is_global_artist_followed,
    list_user_global_album_saves,
    list_user_global_artist_follows,
    save_global_album,
    unfollow_global_artist,
    unsave_global_album,
)
from crate.federation.global_artwork import (
    GlobalArtistNotFound,
    GlobalAlbumNotFound,
    NoArtistBackgroundSource,
    NoArtistPhotoSource,
    NoArtworkSource,
    resolve_global_artist_background,
    resolve_global_artist_photo,
    resolve_global_album_artwork,
)
from crate.federation.global_playback import (
    GlobalTrackNotFound,
    NoPlayableGlobalTrack,
    resolve_global_track_playback,
)
from crate.federation.global_remote_facets import get_or_fetch_remote_json_facet
from crate.federation.global_source_resolver import (
    GlobalEntityNotFound,
    NoGlobalSource,
    resolve_global_source,
)

router = APIRouter(tags=["catalog"])


_TRACK_INFO_REMOTE_FIELDS = {
    "title",
    "artist",
    "album",
    "format",
    "bitrate",
    "sample_rate",
    "bit_depth",
    "bpm",
    "audio_key",
    "audio_scale",
    "energy",
    "danceability",
    "valence",
    "acousticness",
    "instrumentalness",
    "loudness",
    "dynamic_range",
    "mood_json",
    "lastfm_listeners",
    "lastfm_playcount",
    "popularity",
    "rating",
    "genre",
    "bliss_signature",
}

_ALBUM_DETAIL_REMOTE_FIELDS = {
    "year",
    "genre",
    "track_count",
    "total_duration",
    "has_cover",
}

_ALBUM_TRACK_REMOTE_FIELDS = {
    "duration",
    "format",
    "genre",
    "year",
    "track_number",
    "disc_number",
}


@router.get(
    "/api/catalog/search",
    response_model=SearchResponse,
    response_model_exclude_none=True,
    responses=AUTH_ERROR_RESPONSES,
    summary="Search the canonical global catalog",
)
def catalog_search(
    request: Request,
    q: str = "",
    limit: int = 20,
    include_sources: bool = Query(default=False),
):
    user = _require_auth(request)
    include_debug_sources = include_sources and user.get("role") in {
        "admin",
        "owner",
        "ops",
    }
    return search_global_catalog(
        q,
        limit=max(1, min(limit, 50)),
        include_sources=include_debug_sources,
    )


@router.get(
    "/api/catalog/genres",
    responses=AUTH_ERROR_RESPONSES,
    summary="List canonical global catalog genres",
)
def catalog_genres(request: Request):
    _require_auth(request)
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

    descriptor = get_core_taxonomy_descriptor()
    return {
        "taxonomy": {
            "id": descriptor["taxonomy_id"],
            "version": descriptor["version"],
            "digest": descriptor["digest"],
        },
        "items": list_global_catalog_genres(),
    }


@router.get(
    "/api/catalog/genres/{slug}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get a canonical global catalog genre",
)
def catalog_genre_detail(request: Request, slug: str):
    _require_auth(request)
    payload = get_global_genre_detail(slug)
    if payload is None:
        raise HTTPException(status_code=404, detail="Genre not found")
    return payload


@router.get(
    "/api/catalog/me/artists",
    responses=AUTH_ERROR_RESPONSES,
    summary="List artists for the Listen collection surface",
)
def catalog_me_artists(
    request: Request,
    limit: int = Query(500, ge=1, le=2000),
):
    user = _require_auth(request)
    return list_user_global_artist_follows(int(user["id"]))


@router.get(
    "/api/catalog/me/albums",
    responses=AUTH_ERROR_RESPONSES,
    summary="List albums for the Listen collection surface",
)
def catalog_me_albums(
    request: Request,
    limit: int = Query(500, ge=1, le=2000),
):
    user = _require_auth(request)
    return list_user_global_album_saves(int(user["id"]))


@router.get(
    "/api/catalog/me/follows",
    responses=AUTH_ERROR_RESPONSES,
    summary="List followed canonical artists",
)
def catalog_me_follows(request: Request):
    user = _require_auth(request)
    return list_user_global_artist_follows(int(user["id"]))


@router.get(
    "/api/catalog/me/follows/{global_artist_uid}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Check whether the user follows a canonical artist",
)
def catalog_me_follow_state(request: Request, global_artist_uid: str):
    user = _require_auth(request)
    return {"following": is_global_artist_followed(int(user["id"]), global_artist_uid)}


@router.post(
    "/api/catalog/me/follows/{global_artist_uid}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Follow a canonical artist",
)
def catalog_me_follow_artist(request: Request, global_artist_uid: str):
    user = _require_auth(request)
    added = follow_global_artist(int(user["id"]), global_artist_uid)
    if not added and not is_global_artist_followed(int(user["id"]), global_artist_uid):
        raise HTTPException(status_code=404, detail="Artist not found")
    return {"ok": True, "added": added}


@router.delete(
    "/api/catalog/me/follows/{global_artist_uid}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Unfollow a canonical artist",
)
def catalog_me_unfollow_artist(request: Request, global_artist_uid: str):
    user = _require_auth(request)
    removed = unfollow_global_artist(int(user["id"]), global_artist_uid)
    if not removed:
        raise HTTPException(status_code=404, detail="Not following this artist")
    return {"ok": True}


@router.get(
    "/api/catalog/me/albums/saved",
    responses=AUTH_ERROR_RESPONSES,
    summary="List saved canonical albums",
)
def catalog_me_saved_albums(request: Request):
    user = _require_auth(request)
    return list_user_global_album_saves(int(user["id"]))


@router.get(
    "/api/catalog/me/albums/{global_album_uid}/saved",
    responses=AUTH_ERROR_RESPONSES,
    summary="Check whether the user saved a canonical album",
)
def catalog_me_album_saved_state(request: Request, global_album_uid: str):
    user = _require_auth(request)
    return {"saved": is_global_album_saved(int(user["id"]), global_album_uid)}


@router.post(
    "/api/catalog/me/albums/{global_album_uid}/save",
    responses=AUTH_ERROR_RESPONSES,
    summary="Save a canonical album",
)
def catalog_me_save_album(request: Request, global_album_uid: str):
    user = _require_auth(request)
    added = save_global_album(int(user["id"]), global_album_uid)
    if not added and not is_global_album_saved(int(user["id"]), global_album_uid):
        raise HTTPException(status_code=404, detail="Album not found")
    return {"ok": True, "added": added}


@router.delete(
    "/api/catalog/me/albums/{global_album_uid}/save",
    responses=AUTH_ERROR_RESPONSES,
    summary="Unsave a canonical album",
)
def catalog_me_unsave_album(request: Request, global_album_uid: str):
    user = _require_auth(request)
    removed = unsave_global_album(int(user["id"]), global_album_uid)
    if not removed:
        raise HTTPException(status_code=404, detail="Album not in library")
    return {"ok": True}


@router.get(
    "/api/catalog/artists/{global_artist_uid}/page",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get a canonical artist page",
)
def catalog_artist_page(request: Request, global_artist_uid: str):
    _require_auth(request)
    payload = get_global_artist_page(global_artist_uid)
    if payload is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Artist not found")
    return _hydrate_catalog_artist_page(request, global_artist_uid, payload)


@router.get(
    "/api/catalog/artists/{global_artist_uid}/photo",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get canonical artist photo",
)
def catalog_artist_photo(
    request: Request,
    global_artist_uid: str,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    _require_auth(request)
    payload = get_global_artist_page(global_artist_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Artist not found")
    artist = payload.get("artist") or {}
    local_entity_uid = artist.get("local_artist_entity_uid")
    if local_entity_uid:
        return api_artist_photo_by_entity_uid(
            request,
            local_entity_uid,
            size=size,
            image_format=image_format,
        )
    local_artist_id = artist.get("id")
    if local_artist_id is not None:
        return api_artist_photo_by_id(
            request,
            int(local_artist_id),
            size=size,
            image_format=image_format,
        )
    try:
        selection = resolve_global_artist_photo(global_artist_uid)
    except (GlobalArtistNotFound, NoArtistPhotoSource):
        raise HTTPException(status_code=404, detail="Artist photo not found") from None

    if selection["kind"] == "local":
        entity_uid = selection.get("local_artist_entity_uid")
        if entity_uid:
            return api_artist_photo_by_entity_uid(
                request,
                entity_uid,
                size=size,
                image_format=image_format,
            )
        if selection.get("local_artist_id") is not None:
            return api_artist_photo_by_id(
                request,
                int(selection["local_artist_id"]),
                size=size,
                image_format=image_format,
            )
    if selection["kind"] == "remote":
        return remote_artist_photo(
            selection["node_uid"],
            selection["remote_entity_uid"],
            request,
            size=size,
            image_format=image_format,
            selection=selection,
        )
    raise HTTPException(status_code=404, detail="Artist photo not found")


@router.get(
    "/api/catalog/artists/{global_artist_uid}/background",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get canonical artist hero background",
)
def catalog_artist_background(
    request: Request,
    global_artist_uid: str,
    random_pick: bool = Query(False, alias="random"),
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    _require_auth(request)
    payload = get_global_artist_page(global_artist_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Artist not found")
    artist = payload.get("artist") or {}
    local_entity_uid = artist.get("local_artist_entity_uid")
    if local_entity_uid:
        response = api_artist_background_by_entity_uid(
            request,
            str(local_entity_uid),
            random_pick=random_pick,
            size=size,
            image_format=image_format,
        )
        if not _is_not_found_response(response):
            return response
    local_artist_id = artist.get("id")
    if local_artist_id is not None:
        response = api_artist_background_by_id(
            request,
            int(local_artist_id),
            random_pick=random_pick,
            size=size,
            image_format=image_format,
        )
        if not _is_not_found_response(response):
            return response

    try:
        selection = resolve_global_artist_background(global_artist_uid)
    except (GlobalArtistNotFound, NoArtistBackgroundSource):
        raise HTTPException(
            status_code=404, detail="Artist background not found"
        ) from None

    if selection["kind"] == "local":
        entity_uid = selection.get("local_artist_entity_uid")
        if entity_uid:
            response = api_artist_background_by_entity_uid(
                request,
                entity_uid,
                random_pick=random_pick,
                size=size,
                image_format=image_format,
            )
            if not _is_not_found_response(response):
                return response
        if selection.get("local_artist_id") is not None:
            response = api_artist_background_by_id(
                request,
                int(selection["local_artist_id"]),
                random_pick=random_pick,
                size=size,
                image_format=image_format,
            )
            if not _is_not_found_response(response):
                return response
    if selection["kind"] == "remote":
        try:
            return remote_artist_background(
                selection["node_uid"],
                selection["remote_entity_uid"],
                request,
                size=size,
                image_format=image_format,
                selection=selection,
            )
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return remote_artist_photo(
                selection["node_uid"],
                selection["remote_entity_uid"],
                request,
                size=size,
                image_format=image_format,
                selection=selection,
            )
    raise HTTPException(status_code=404, detail="Artist background not found")


def _is_not_found_response(response: object) -> bool:
    return getattr(response, "status_code", None) == 404


def _hydrate_catalog_artist_page(
    request: Request,
    global_artist_uid: str,
    payload: dict,
) -> dict:
    artist = payload.get("artist") or {}
    local_entity_uid = artist.get("local_artist_entity_uid")
    if local_entity_uid:
        try:
            local_payload = api_artist_page_by_entity_uid(
                request,
                str(local_entity_uid),
                top_tracks_count=12,
                shows_limit=12,
                stats_window="30d",
                stats_limit=12,
            )
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        else:
            if not hasattr(local_payload, "status_code"):
                return _merge_global_artist_identity(
                    dict(local_payload),
                    global_artist_uid,
                    artist,
                )

    try:
        selection = resolve_global_source(
            global_entity_uid=global_artist_uid,
            entity_type="artist",
            facet="artist_info",
        )
    except (GlobalEntityNotFound, NoGlobalSource):
        return payload

    if selection["kind"] != "remote":
        return payload

    remote_info = get_or_fetch_remote_json_facet(selection, request)
    if not remote_info:
        return payload
    hydrated = dict(payload)
    hydrated["info"] = _merge_artist_info(hydrated.get("info"), remote_info)
    return hydrated


def _merge_global_artist_identity(
    local_payload: dict,
    global_artist_uid: str,
    global_artist: dict,
) -> dict:
    artist = dict(local_payload.get("artist") or {})
    artist["global_uid"] = global_artist_uid
    artist["global_artist_uid"] = global_artist_uid
    artist.setdefault(
        "local_artist_entity_uid", global_artist.get("local_artist_entity_uid")
    )
    artist.setdefault("availability", global_artist.get("availability", {}))
    local_payload["artist"] = artist
    return local_payload


def _merge_artist_info(current: object, remote_info: dict) -> dict:
    info = dict(current) if isinstance(current, dict) else {}
    for key in ("bio", "tags", "similar", "listeners", "playcount", "image_url", "url"):
        value = remote_info.get(key)
        if value not in (None, "", []):
            info[key] = value
    for key in ("country", "area", "formed", "ended"):
        if remote_info.get(key) is not None:
            info[key] = remote_info[key]
    info.setdefault("bio", "")
    info.setdefault("tags", [])
    info.setdefault("similar", [])
    return info


@router.get(
    "/api/catalog/albums/{global_album_uid}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get a canonical album detail",
)
def catalog_album_detail(request: Request, global_album_uid: str):
    _require_auth(request)
    payload = get_global_album_detail(global_album_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Album not found")
    return _hydrate_catalog_album_detail(request, global_album_uid, payload)


def _hydrate_catalog_album_detail(
    request: Request,
    global_album_uid: str,
    payload: dict,
) -> dict:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_album_uid,
            entity_type="album",
            facet="album_detail",
        )
    except (GlobalEntityNotFound, NoGlobalSource):
        return payload

    if selection["kind"] != "remote":
        return payload

    remote_detail = get_or_fetch_remote_json_facet(selection, request)
    if not remote_detail:
        return payload
    return _merge_album_detail(payload, remote_detail)


def _merge_album_detail(base: dict, remote_detail: dict) -> dict:
    payload = dict(base)
    for key in _ALBUM_DETAIL_REMOTE_FIELDS:
        if key in remote_detail and remote_detail[key] is not None:
            payload[key] = remote_detail[key]

    remote_tracks = remote_detail.get("tracks")
    if isinstance(remote_tracks, list) and isinstance(payload.get("tracks"), list):
        payload["tracks"] = _merge_album_tracks(payload["tracks"], remote_tracks)
    return payload


def _merge_album_tracks(base_tracks: list, remote_tracks: list) -> list:
    remote_by_key = {
        _album_track_key(track): track
        for track in remote_tracks
        if isinstance(track, dict)
    }
    merged = []
    for base_track in base_tracks:
        if not isinstance(base_track, dict):
            merged.append(base_track)
            continue
        remote_track = remote_by_key.get(_album_track_key(base_track))
        if not isinstance(remote_track, dict):
            merged.append(base_track)
            continue
        next_track = dict(base_track)
        for key in _ALBUM_TRACK_REMOTE_FIELDS:
            if key in remote_track and remote_track[key] is not None:
                next_track[key] = remote_track[key]
        genre = remote_track.get("genre")
        if genre:
            tags = dict(next_track.get("tags") or {})
            tags["genre"] = genre
            next_track["tags"] = tags
        merged.append(next_track)
    return merged


def _album_track_key(track: dict) -> tuple[int, int, str]:
    return (
        _album_track_number(track.get("disc_number"), default=1),
        _album_track_number(track.get("track_number"), default=0),
        str(track.get("title") or track.get("filename") or "").casefold(),
    )


def _album_track_number(value: object, *, default: int) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


@router.get(
    "/api/catalog/albums/{global_album_uid}/cover",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get canonical album artwork",
)
def catalog_album_cover(
    request: Request,
    global_album_uid: str,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    _require_auth(request)
    try:
        selection = resolve_global_album_artwork(global_album_uid)
    except GlobalAlbumNotFound:
        raise HTTPException(status_code=404, detail="Album not found") from None
    except NoArtworkSource:
        raise HTTPException(status_code=404, detail="Artwork not found") from None

    if selection["kind"] == "local":
        entity_uid = selection.get("local_album_entity_uid")
        if entity_uid:
            return api_cover_by_entity_uid(
                entity_uid,
                size=size,
                image_format=image_format,
            )
        if selection.get("local_album_id") is not None:
            return api_cover_by_id(
                selection["local_album_id"],
                size=size,
                image_format=image_format,
            )
        raise HTTPException(status_code=404, detail="Artwork not found")

    if selection["kind"] == "remote":
        return remote_album_cover(
            selection["node_uid"],
            selection["remote_entity_uid"],
            request,
            size=size,
            image_format=image_format,
            selection=selection,
        )

    raise HTTPException(status_code=404, detail="Artwork not found")


@router.get(
    "/api/catalog/tracks/{global_track_uid}/playback",
    response_model=PlaybackResolutionResponse,
    response_model_exclude_none=True,
    responses=AUTH_ERROR_RESPONSES,
    summary="Resolve playback delivery for a canonical global track",
)
def catalog_track_playback(
    request: Request,
    global_track_uid: str,
    delivery: str = Query("original"),
):
    _require_auth(request)
    return _catalog_track_playback_payload(request, global_track_uid, delivery)


@router.get(
    "/api/catalog/tracks/{global_track_uid}/stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream a canonical global track",
)
def catalog_track_stream(
    request: Request,
    global_track_uid: str,
    delivery: str = Query("original"),
):
    _require_auth(request)
    playback = _catalog_track_playback_payload(request, global_track_uid, delivery)
    return RedirectResponse(url=playback["stream_url"], status_code=307)


@router.get(
    "/api/catalog/tracks/{global_track_uid}/info",
    response_model=TrackInfoResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get canonical global track metadata",
)
def catalog_track_info(request: Request, global_track_uid: str):
    _require_auth(request)
    payload = get_global_track_info(global_track_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Track not found")

    entity_uid = payload.get("local_track_entity_uid")
    if entity_uid:
        try:
            return api_track_info_by_entity_uid(request, str(entity_uid))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    local_track_id = payload.get("local_track_id")
    if local_track_id is not None:
        try:
            return api_track_info_by_id(request, int(local_track_id))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

    return _hydrate_catalog_track_info(request, global_track_uid, payload)


def _hydrate_catalog_track_info(
    request: Request,
    global_track_uid: str,
    payload: dict,
) -> dict:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_track_uid,
            entity_type="track",
            facet="track_info",
        )
    except (GlobalEntityNotFound, NoGlobalSource):
        return payload

    if selection["kind"] != "remote":
        return payload

    remote_info = get_or_fetch_remote_json_facet(selection, request)
    if not remote_info:
        return payload
    return _merge_track_info(payload, remote_info)


def _merge_track_info(base: dict, remote_info: dict) -> dict:
    payload = dict(base)
    for key in _TRACK_INFO_REMOTE_FIELDS:
        if key in remote_info and remote_info[key] is not None:
            payload[key] = remote_info[key]
    payload["entity_uid"] = base.get("entity_uid")
    return payload


def _empty_track_genre_payload() -> dict:
    return {
        "primary": None,
        "topLevel": None,
        "source": None,
        "preset": None,
    }


def _track_genre_payload_from_name(raw_genre: str | None) -> dict:
    genre = (raw_genre or "").strip()
    if not genre:
        return _empty_track_genre_payload()

    from crate.genre_taxonomy import (
        get_genre_display_name,
        get_top_level_slug,
        is_canonical_genre_slug,
        resolve_genre_eq_preset,
        resolve_genre_slug,
        slugify_genre,
    )

    resolved = resolve_genre_slug(genre)
    if resolved and is_canonical_genre_slug(resolved):
        top_level_slug = get_top_level_slug(resolved) or resolved
        preset_info = resolve_genre_eq_preset(resolved)
        preset_payload = None
        if preset_info is not None:
            preset_payload = {
                "gains": preset_info["gains"],
                "source": preset_info["source"],
                "inheritedFrom": (
                    {"slug": preset_info["slug"], "name": preset_info["name"]}
                    if preset_info["source"] == "inherited"
                    else None
                ),
            }
        return {
            "primary": {
                "slug": resolved,
                "name": get_genre_display_name(resolved),
                "canonical": True,
            },
            "topLevel": {
                "slug": top_level_slug,
                "name": get_genre_display_name(top_level_slug),
            },
            "source": "track",
            "preset": preset_payload,
        }

    return {
        "primary": {
            "slug": slugify_genre(genre),
            "name": genre,
            "canonical": False,
        },
        "topLevel": None,
        "source": "track",
        "preset": None,
    }


@router.get(
    "/api/catalog/tracks/{global_track_uid}/genre",
    response_model=TrackGenreResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the primary genre for a canonical global track",
)
def catalog_track_genre(request: Request, global_track_uid: str):
    _require_auth(request)
    try:
        canonical = get_global_track_genres(global_track_uid)
    except Exception:
        canonical = None
    if canonical is not None:
        genres = canonical.get("genres") or []
        primary = genres[0] if genres else None
        return {
            **canonical,
            "primary": (
                {
                    "slug": primary["canonical_slug"],
                    "name": primary["canonical_slug"].replace("-", " "),
                    "canonical": True,
                }
                if primary
                else None
            ),
            "topLevel": None,
            "source": "global_catalog",
            "preset": None,
        }
    payload = get_global_track_info(global_track_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Track not found")

    entity_uid = payload.get("local_track_entity_uid")
    if entity_uid:
        try:
            return api_track_genre_by_entity_uid(request, str(entity_uid))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    local_track_id = payload.get("local_track_id")
    if local_track_id is not None:
        try:
            return api_track_genre_by_id(request, int(local_track_id))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

    hydrated = _hydrate_catalog_track_info(request, global_track_uid, payload)
    return _track_genre_payload_from_name(hydrated.get("genre"))


@router.get(
    "/api/catalog/tracks/{global_track_uid}/eq-features",
    response_model=EqFeaturesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get adaptive EQ features for a canonical global track",
)
def catalog_track_eq_features(request: Request, global_track_uid: str):
    _require_auth(request)
    payload = get_global_track_info(global_track_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Track not found")

    entity_uid = payload.get("local_track_entity_uid")
    if entity_uid:
        try:
            return api_eq_features_by_entity_uid(request, str(entity_uid))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    local_track_id = payload.get("local_track_id")
    if local_track_id is not None:
        try:
            return api_eq_features_by_id(request, int(local_track_id))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

    return {
        "energy": None,
        "loudness": None,
        "dynamicRange": None,
        "brightness": None,
        "danceability": None,
        "valence": None,
        "acousticness": None,
        "instrumentalness": None,
    }


@router.get(
    "/api/catalog/tracks/{global_track_uid}/eq",
    response_model=EffectiveEqResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Resolve the effective EQ preset for a canonical global track",
)
def catalog_track_effective_eq(request: Request, global_track_uid: str):
    _require_auth(request)
    payload = get_global_track_info(global_track_uid)
    if payload is None:
        raise HTTPException(status_code=404, detail="Track not found")

    entity_uid = payload.get("local_track_entity_uid")
    if entity_uid:
        try:
            return api_track_effective_eq_by_entity_uid(request, str(entity_uid))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    local_track_id = payload.get("local_track_id")
    if local_track_id is not None:
        try:
            return api_track_effective_eq_by_id(request, int(local_track_id))
        except HTTPException as exc:
            if exc.status_code != 404:
                raise

    return {
        "trackId": 0,
        "trackEntityUid": None,
        "albumId": None,
        "albumEntityUid": None,
        "gains": [0.0] * 10,
        "source": "unavailable",
        "label": "Flat",
        "reasoning": "Remote track analysis is not available on this node.",
        "scope": None,
        "targetType": None,
        "targetEntityUid": None,
        "userId": None,
        "genre": None,
        "inheritedFrom": None,
    }


def _catalog_track_playback_payload(
    request: Request,
    global_track_uid: str,
    delivery: str,
) -> dict:
    try:
        selection = resolve_global_track_playback(global_track_uid)
    except GlobalTrackNotFound:
        raise HTTPException(status_code=404, detail="Track not found") from None
    except NoPlayableGlobalTrack:
        raise HTTPException(
            status_code=503, detail="Track has no playable source"
        ) from None

    if selection["kind"] == "local":
        track = None
        entity_uid = selection.get("local_track_entity_uid")
        if entity_uid:
            track = get_track_delivery_row_by_entity_uid(entity_uid)
        if not track and selection.get("local_track_id") is not None:
            track = get_track_delivery_row_by_id(selection["local_track_id"])
        if not track:
            raise HTTPException(status_code=404, detail="Local track not found")
        return _playback_payload_for_track(track, delivery)

    if selection["kind"] == "remote":
        remote = resolve_remote_playback(
            selection["node_uid"],
            selection["remote_entity_uid"],
            request,
        )
        remote["quality"] = selection.get("quality")
        return _remote_playback_resolution(remote, requested_policy=delivery)

    raise HTTPException(status_code=503, detail="Unsupported playback source")


def _remote_playback_resolution(remote: dict, *, requested_policy: str) -> dict:
    delivery_policy = remote.get("delivery_policy") or requested_policy
    quality = _remote_quality_payload(remote.get("quality"))
    source_format = quality.get("format") or "remote"
    remote_quality = {
        "format": source_format,
        "codec": source_format if source_format != "remote" else None,
        "bitrate": quality.get("bitrate"),
        "sample_rate": quality.get("sample_rate"),
        "bit_depth": quality.get("bit_depth"),
        "bytes": quality.get("size_bytes"),
        "lossless": source_format in {"flac", "wav", "alac"},
    }
    return {
        "stream_url": remote["stream_url"],
        "requested_policy": requested_policy,
        "effective_policy": delivery_policy,
        "source": remote_quality,
        "delivery": remote_quality,
        "transcoded": False,
        "cache_hit": False,
        "preparing": False,
        "task_id": None,
        "variant_id": None,
        "variant_status": None,
    }


def _remote_quality_payload(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    quality: dict[str, object] = {}
    fmt = str(value.get("format") or "").strip().lower()
    if fmt:
        quality["format"] = fmt
    for key in ("bitrate", "sample_rate", "bit_depth", "size_bytes"):
        raw = value.get(key)
        if raw is None:
            continue
        try:
            normalized = int(raw)
        except (TypeError, ValueError):
            continue
        if normalized <= 0:
            continue
        quality[key] = normalized
    return quality
