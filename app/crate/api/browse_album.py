import logging
from pathlib import Path
import re
import shutil
from typing import Any, Mapping

import mutagen
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from starlette.background import BackgroundTask

from crate.api._deps import COVER_NAMES, extensions, library_path
from crate.api.auth import _require_auth
from crate.api.image_variants import build_image_response
from crate.api.browse_shared import (
    build_genre_profile,
    display_name,
    find_album_dir,
    fs_album_detail,
    has_library_data,
)
from crate.db.queries.browse import find_album_row
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.schemas.browse import AlbumDetailResponse, RelatedAlbumResponse
from crate.api.schemas.common import TaskEnqueueResponse
from crate.audio import get_audio_files
from crate.db.cache_store import get_cache, set_cache
from crate.db.repositories.library import (
    get_library_album_by_id,
    get_library_album_by_entity_uid,
    get_library_albums,
    get_library_artist,
    get_library_artist_by_slug,
    get_library_tracks,
)
from crate.db.repositories.library_contributions import list_album_contributors
from crate.db.releases import (
    find_upcoming_release_by_artist_album_slug,
    get_artist_release_track_matches,
)
from crate.db.queries.browse import (
    get_album_genre_ids,
    get_related_albums,
    get_album_genre_profile,
)
from crate.db.queries.lyrics import get_album_track_lyrics_status
from crate.db.repositories.tasks import create_task
from crate.slugs import build_public_album_slug
from crate.db.queries.streaming_admin import get_track_variant_summaries
from crate.storage_layout import resolve_album_dir
from crate.track_versions import canonical_track_title_key

router = APIRouter(tags=["browse"])
log = logging.getLogger(__name__)

_BROWSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested browse resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_IMAGE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary image response.",
            "content": {
                "image/jpeg": {},
                "image/png": {},
                "image/webp": {},
                "image/svg+xml": {},
            },
        },
        404: error_response("The requested image was not found."),
    },
)

_ZIP_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Zip archive download.",
            "content": {
                "application/zip": {},
            },
        },
        404: error_response("The requested album archive was not found."),
    },
)


def _tag_text(value) -> str:
    return str(value) if value is not None else ""


def _track_tags(track: Mapping[str, Any]) -> dict:
    return {
        "title": _tag_text(track.get("title")),
        "artist": _tag_text(track.get("artist")),
        "album": _tag_text(track.get("album")),
        "albumartist": _tag_text(track.get("albumartist")),
        "tracknumber": _tag_text(track.get("track_number")),
        "discnumber": _tag_text(track.get("disc_number")),
        "date": _tag_text(track.get("year"))[:4],
        "genre": _tag_text(track.get("genre")),
        "musicbrainz_albumid": track.get("musicbrainz_albumid"),
        "musicbrainz_trackid": track.get("musicbrainz_trackid"),
    }


def _album_slug_matches(
    album: Mapping[str, Any], requested_slug: str, artist_slug: str
) -> bool:
    requested = build_public_album_slug(requested_slug)
    artist = build_public_album_slug(artist_slug)
    album_name_slug = build_public_album_slug(album.get("name"))
    stored_slug = build_public_album_slug(album.get("slug"))
    candidates = {album_name_slug, stored_slug}
    for slug in (album_name_slug, stored_slug):
        if artist and slug.startswith(f"{artist}-"):
            candidates.add(slug[len(artist) + 1 :])
    return requested in candidates


def _json_list(value: Any) -> list[dict]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
        except Exception:
            return []
        return (
            [item for item in parsed if isinstance(item, dict)]
            if isinstance(parsed, list)
            else []
        )
    return []


def _relative_track_path(path: str | None) -> str:
    if not path:
        return ""
    try:
        return str(Path(path).relative_to(library_path()))
    except Exception:
        return str(path)


def _take_release_track_match(
    matches: dict[str, list[dict]],
    title: str,
    used_ids: set[int],
    *,
    album_title: str = "",
) -> dict | None:
    key = canonical_track_title_key(title)
    if not key:
        return None
    candidates = matches.get(key, [])
    title_slug = build_public_album_slug(title)
    if album_title:
        release_slug = build_public_album_slug(album_title)
        candidates = sorted(
            candidates,
            key=lambda track: (
                build_public_album_slug(str(track.get("album") or "")) != release_slug,
                build_public_album_slug(str(track.get("album_slug") or ""))
                != release_slug,
            ),
        )
    for track in candidates:
        if build_public_album_slug(str(track.get("title") or "")) != title_slug:
            continue
        track_id = int(track.get("id") or 0)
        if track_id and track_id not in used_ids:
            used_ids.add(track_id)
            return track
    return None


def _tidal_album_id_from_release(release: Mapping[str, Any]) -> str:
    explicit = str(release.get("tidal_id") or "").strip()
    if explicit:
        return explicit
    for value in (release.get("source_url"), release.get("tidal_url")):
        raw = str(value or "")
        match = re.search(r"(?:tidal\.com/album/|/album/)(\d+)", raw)
        if match:
            return match.group(1)
    return ""


def _release_tracklist_from_tidal_source(release: Mapping[str, Any]) -> list[dict]:
    album_id = _tidal_album_id_from_release(release)
    if not album_id:
        return []

    cache_key = f"tidal:release-tracklist:{album_id}"
    cached = get_cache(cache_key)
    if isinstance(cached, list):
        return _json_list(cached)

    try:
        from crate import tidal as tidal_mod

        tracklist = tidal_mod.album_tracks_to_release_tracklist(
            tidal_mod.get_album_tracks(album_id)
        )
    except Exception:
        log.debug(
            "Failed to load Tidal release tracklist for %s", album_id, exc_info=True
        )
        return []

    if tracklist:
        set_cache(cache_key, tracklist, ttl=86400)
    return tracklist


def _release_tracklist_from_musicbrainz_source(
    release: Mapping[str, Any],
) -> list[dict]:
    release_group_id = str(release.get("mb_release_group_id") or "").strip()
    if not release_group_id:
        return []

    cache_key = f"mb:release-tracklist:{release_group_id}"
    cached = get_cache(cache_key)
    if isinstance(cached, list):
        return _json_list(cached)

    try:
        from crate.musicbrainz_ext import get_release_group_tracklist

        tracklist = get_release_group_tracklist(release_group_id)
    except Exception:
        log.debug(
            "Failed to load MusicBrainz release tracklist for %s",
            release_group_id,
            exc_info=True,
        )
        return []

    if tracklist:
        set_cache(cache_key, tracklist, ttl=86400)
    return tracklist


def _pre_release_track_payload(
    *,
    release_id: int,
    release: Mapping[str, Any],
    planned: Mapping[str, Any],
    local_track: Mapping[str, Any] | None,
    preview_track: Mapping[str, Any] | None,
    position: int,
) -> dict:
    title = str(planned.get("title") or (preview_track or {}).get("title") or "")
    duration = planned.get("duration") or (preview_track or {}).get("duration") or 0
    track_number = int(planned.get("position") or position)
    if local_track:
        size = int(local_track.get("size") or 0)
        duration = local_track.get("duration") or duration or 0
        return {
            "id": local_track["id"],
            "entity_uid": local_track.get("entity_uid"),
            "storage_id": local_track.get("storage_id"),
            "filename": local_track.get("filename") or title,
            "format": local_track.get("format") or "",
            "size_mb": round(size / (1024**2), 1) if size else 0,
            "bitrate": int(local_track["bitrate"]) // 1000
            if local_track.get("bitrate")
            else None,
            "sample_rate": local_track.get("sample_rate"),
            "bit_depth": local_track.get("bit_depth"),
            "bpm": local_track.get("bpm"),
            "audio_key": local_track.get("audio_key"),
            "audio_scale": local_track.get("audio_scale"),
            "energy": local_track.get("energy"),
            "danceability": local_track.get("danceability"),
            "valence": local_track.get("valence"),
            "bliss_vector": local_track.get("bliss_vector"),
            "length_sec": round(float(duration)) if duration else 0,
            "popularity": local_track.get("popularity"),
            "popularity_score": local_track.get("popularity_score"),
            "popularity_confidence": local_track.get("popularity_confidence"),
            "rating": local_track.get("rating", 0) or 0,
            "stream_variants": [],
            "lyrics": {
                "status": "none",
                "found": False,
                "has_plain": False,
                "has_synced": False,
                "provider": "lrclib",
                "updated_at": None,
            },
            "tags": {
                "title": local_track.get("title") or title,
                "artist": local_track.get("artist") or release.get("artist_name") or "",
                "album": release.get("album_title") or "",
                "albumartist": release.get("artist_name") or "",
                "tracknumber": str(track_number),
                "discnumber": str(local_track.get("disc_number") or 1),
                "date": str(release.get("release_date") or "")[:4],
                "genre": local_track.get("genre") or "",
                "musicbrainz_albumid": release.get("mb_release_group_id"),
                "musicbrainz_trackid": planned.get("recording_mbid"),
            },
            "path": _relative_track_path(str(local_track.get("path") or "")),
            "is_available": True,
            "source": "library",
        }

    return {
        "id": -(int(release_id) * 1000 + track_number),
        "entity_uid": None,
        "storage_id": None,
        "filename": title,
        "format": "",
        "size_mb": 0,
        "bitrate": None,
        "sample_rate": None,
        "bit_depth": None,
        "bpm": None,
        "audio_key": None,
        "audio_scale": None,
        "energy": None,
        "danceability": None,
        "valence": None,
        "bliss_vector": None,
        "length_sec": round(float(duration)) if duration else 0,
        "popularity": None,
        "popularity_score": None,
        "popularity_confidence": None,
        "rating": 0,
        "stream_variants": [],
        "lyrics": {
            "status": "none",
            "found": False,
            "has_plain": False,
            "has_synced": False,
            "provider": "lrclib",
            "updated_at": None,
        },
        "tags": {
            "title": title,
            "artist": release.get("artist_name") or "",
            "album": release.get("album_title") or "",
            "albumartist": release.get("artist_name") or "",
            "tracknumber": str(track_number),
            "discnumber": "1",
            "date": str(release.get("release_date") or "")[:4],
            "genre": "",
            "musicbrainz_albumid": release.get("mb_release_group_id"),
            "musicbrainz_trackid": planned.get("recording_mbid"),
        },
        "path": "",
        "is_available": False,
        "source": "pre_release",
        "source_url": (preview_track or {}).get("source_url")
        or (preview_track or {}).get("url"),
    }


def _pre_release_album_payload(
    request: Request, artist: Mapping[str, Any], release: Mapping[str, Any]
) -> dict:
    _require_auth(request)
    release_id = int(release["id"])
    tracklist = _json_list(release.get("tracklist_json"))
    preview_tracks = _json_list(release.get("preview_tracks_json"))
    if not tracklist:
        tracklist = _release_tracklist_from_musicbrainz_source(release)
    if not tracklist:
        tracklist = _release_tracklist_from_tidal_source(release)
    if not tracklist:
        tracklist = preview_tracks

    preview_by_title = {
        canonical_track_title_key(str(track.get("title") or "")): track
        for track in preview_tracks
        if track.get("title")
    }
    local_matches = get_artist_release_track_matches(str(artist["name"]))
    used_ids: set[int] = set()
    tracks = []
    for index, planned in enumerate(tracklist, start=1):
        title = str(planned.get("title") or "")
        preview_track = preview_by_title.get(canonical_track_title_key(title))
        local_track = _take_release_track_match(
            local_matches,
            title,
            used_ids,
            album_title=str(release.get("album_title") or ""),
        )
        tracks.append(
            _pre_release_track_payload(
                release_id=release_id,
                release=release,
                planned=planned,
                local_track=local_track,
                preview_track=preview_track,
                position=index,
            )
        )

    playable_count = sum(1 for track in tracks if track.get("is_available"))
    total_length = sum(int(track.get("length_sec") or 0) for track in tracks)
    release_date = str(release.get("release_date") or "")
    return {
        "id": -release_id,
        "entity_uid": None,
        "slug": build_public_album_slug(str(release.get("album_title") or "")),
        "artist_id": artist.get("id"),
        "artist_entity_uid": artist.get("entity_uid"),
        "artist_slug": artist.get("slug"),
        "artist": artist["name"],
        "name": release.get("album_title") or "",
        "display_name": display_name(str(release.get("album_title") or "")),
        "path": "",
        "track_count": max(len(tracks), int(release.get("tracks") or 0)),
        "playable_track_count": playable_count,
        "total_size_mb": 0,
        "total_length_sec": total_length,
        "has_cover": bool(release.get("cover_url")),
        "cover_file": None,
        "cover_url": release.get("cover_url") or "",
        "tracks": tracks,
        "album_tags": {
            "artist": artist["name"],
            "album": release.get("album_title") or "",
            "year": release_date[:4],
            "genre": "",
            "musicbrainz_albumid": release.get("mb_release_group_id"),
        },
        "musicbrainz_albumid": release.get("mb_release_group_id"),
        "genres": [],
        "genre_profile": [],
        "popularity": None,
        "popularity_score": None,
        "popularity_confidence": None,
        "is_pre_release": True,
        "release_date": release_date,
        "release_status": release.get("status") or "detected",
        "release_type": release.get("release_type") or "Album",
        "source_name": release.get("source_name") or "",
        "source_url": release.get("source_url") or release.get("tidal_url") or "",
    }


@router.get(
    "/api/albums/{album_id}/related",
    response_model=list[RelatedAlbumResponse],
    responses=_BROWSE_RESPONSES,
    summary="List albums related to a given album",
)
def api_related_albums_by_id(request: Request, album_id: int, limit: int = 15):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_related_albums(request, album["artist"], album["name"], limit)


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/related",
    response_model=list[RelatedAlbumResponse],
    responses=_BROWSE_RESPONSES,
    summary="List albums related to a given album by entity UID",
)
def api_related_albums_by_entity_uid(
    request: Request, album_entity_uid: str, limit: int = 15
):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_related_albums(request, album["artist"], album["name"], limit)


def api_related_albums(request: Request, artist: str, album: str, limit: int = 15):
    """Find related albums: same artist, same genre+decade, similar audio profile."""
    _require_auth(request)
    related = []
    seen = set()

    current = find_album_row(artist, album)
    if not current:
        return []

    album_id = current["id"]
    year = (
        current["year"][:4]
        if current.get("year") and len(current.get("year", "")) >= 4
        else None
    )
    seen.add(album_id)

    genre_ids = get_album_genre_ids(album_id)
    grouped = get_related_albums(album_id, artist, year, genre_ids)
    for reason, rows in grouped.items():
        for row in rows:
            if row["id"] not in seen:
                seen.add(row["id"])
                related.append({**row, "reason": reason})

    import re

    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    for row in related:
        row["display_name"] = year_re.sub("", row["name"])

    return related[:limit]


def api_album(request: Request, artist: str, album: str):
    _require_auth(request)
    if not has_library_data():
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    album_data = find_album_row(artist, album)
    if not album_data:
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    cache_key = f"listen:album_detail:v2:{album_data['id']}"
    cached = get_cache(cache_key, max_age_seconds=30)
    if cached is not None:
        return cached

    tracks_data = get_library_tracks(album_data["id"])
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    has_cover = album_data.get("has_cover", False)
    cover_file = None
    if album_dir and album_dir.is_dir():
        for cover_name in COVER_NAMES:
            if (album_dir / cover_name).exists():
                cover_file = cover_name
                break

    track_ids = [track["id"] for track in tracks_data if track.get("id")]
    variant_map = get_track_variant_summaries(track_ids)
    lyrics_map = get_album_track_lyrics_status(album_data["id"])
    track_list = []
    album_tags = {}
    for track in tracks_data:
        entity_uid = track.get("entity_uid")
        size = int(track.get("size") or 0)
        bitrate = int(track.get("bitrate") or 0)
        duration = float(track.get("duration") or 0)
        track_list.append(
            {
                "id": track["id"],
                "entity_uid": entity_uid,
                "storage_id": track.get("storage_id"),
                "filename": track["filename"],
                "format": track.get("format", ""),
                "size_mb": round(size / (1024**2), 1) if size else 0,
                "bitrate": bitrate // 1000 if bitrate else None,
                "sample_rate": track.get("sample_rate"),
                "bit_depth": track.get("bit_depth"),
                "bpm": track.get("bpm"),
                "audio_key": track.get("audio_key"),
                "audio_scale": track.get("audio_scale"),
                "energy": track.get("energy"),
                "danceability": track.get("danceability"),
                "valence": track.get("valence"),
                "bliss_vector": track.get("bliss_vector"),
                "length_sec": round(duration) if duration else 0,
                "popularity": track.get("popularity"),
                "popularity_score": track.get("popularity_score"),
                "popularity_confidence": track.get("popularity_confidence"),
                "rating": track.get("rating", 0) or 0,
                "stream_variants": variant_map.get(track["id"], []),
                "lyrics": lyrics_map.get(
                    track["id"],
                    {
                        "status": "none",
                        "found": False,
                        "has_plain": False,
                        "has_synced": False,
                        "provider": "lrclib",
                        "updated_at": None,
                    },
                ),
                "tags": _track_tags(track),
                "path": str(Path(track["path"]).relative_to(lib))
                if track.get("path")
                else "",
            }
        )
        if not album_tags and track.get("album"):
            album_tags = {
                "artist": track.get("albumartist") or track.get("artist", ""),
                "album": track.get("album", ""),
                "year": str(track.get("year") or "")[:4],
                "genre": track.get("genre", ""),
                "musicbrainz_albumid": track.get("musicbrainz_albumid"),
            }

    total_size = sum(track.get("size", 0) or 0 for track in tracks_data)
    total_length = sum(track["length_sec"] for track in track_list)

    genre_rows = get_album_genre_profile(album_data["id"], limit=8)
    album_genres = [row["name"] for row in genre_rows]
    genre_profile = build_genre_profile(genre_rows, limit=6)

    if album_genres:
        album_tags["genre"] = ", ".join(album_genres)

    # Prefer DB MBID (set by matcher) over tag MBID
    db_mbid = album_data.get("musicbrainz_albumid")
    if db_mbid and db_mbid.strip():
        album_tags["musicbrainz_albumid"] = db_mbid

    payload = {
        "id": album_data["id"],
        "entity_uid": album_data.get("entity_uid"),
        "slug": album_data.get("slug"),
        "artist_id": artist_row["id"]
        if (artist_row := get_library_artist(artist))
        else None,
        "artist_entity_uid": artist_row.get("entity_uid") if artist_row else None,
        "artist_slug": artist_row["slug"] if artist_row else None,
        "artist": artist,
        "name": album,
        "display_name": display_name(album),
        "path": album_data.get("path", ""),
        "track_count": len(tracks_data),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": bool(has_cover),
        "cover_file": cover_file,
        "tracks": track_list,
        "album_tags": album_tags,
        "musicbrainz_albumid": db_mbid,
        "genres": album_genres,
        "genre_profile": genre_profile,
        "contributors": list_album_contributors(int(album_data["id"])),
        "popularity": album_data.get("popularity"),
        "popularity_score": album_data.get("popularity_score"),
        "popularity_confidence": album_data.get("popularity_confidence"),
    }
    set_cache(cache_key, payload, ttl=45)
    return payload


@router.get(
    "/api/artist-slugs/{artist_slug}/albums/{album_slug}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information by artist and album slug",
)
def api_album_by_artist_slug(request: Request, artist_slug: str, album_slug: str):
    artist = get_library_artist_by_slug(artist_slug)
    if not artist:
        return JSONResponse({"error": "Not found"}, status_code=404)

    release = find_upcoming_release_by_artist_album_slug(artist["name"], album_slug)
    if release:
        return _pre_release_album_payload(request, artist, release)

    album = next(
        (
            current
            for current in get_library_albums(artist["name"])
            if _album_slug_matches(current, album_slug, artist_slug)
        ),
        None,
    )
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, artist["name"], album["name"])


@router.get(
    "/api/albums/by-entity/{album_entity_uid}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information by entity UID",
)
def api_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, album["artist"], album["name"])


@router.get(
    "/api/albums/{album_id}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information",
)
def api_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, album["artist"], album["name"])


def _placeholder_cover(seed: str) -> Response:
    """Return a deterministic SVG placeholder so <img> never 404s."""
    # Pick a hue from the seed string
    h = sum(ord(c) for c in (seed or "?")) % 360
    initial = (seed.strip()[:1] or "?").upper()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="hsl({h},45%,28%)"/>'
        f'<stop offset="100%" stop-color="hsl({(h + 30) % 360},35%,15%)"/>'
        f"</linearGradient></defs>"
        f'<rect width="200" height="200" fill="url(#g)"/>'
        f'<text x="100" y="118" font-family="sans-serif" font-size="86" '
        f'font-weight="700" fill="rgba(255,255,255,0.42)" text-anchor="middle">{initial}</text>'
        f"</svg>"
    )
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _extract_embedded_cover(audio_file: Path) -> tuple[bytes, str] | None:
    """Return (data, mime) for the first embedded cover in ``audio_file``.

    Handles FLAC (``audio.pictures``), Ogg/Opus (METADATA_BLOCK_PICTURE) and
    ID3-tagged files (MP3/AIFF with APIC frames) without blowing up on the
    tuple-vs-string iteration difference between ``VComment`` and ``ID3``.
    """
    try:
        audio = getattr(mutagen, "File")(audio_file)
    except Exception:
        return None
    if audio is None:
        return None

    # FLAC / Ogg / Opus expose pictures directly.
    pictures = getattr(audio, "pictures", None)
    if pictures:
        pic = pictures[0]
        return pic.data, pic.mime

    tags = getattr(audio, "tags", None)
    if not tags:
        return None

    # ID3 (MP3, AIFF, WAV) — tags iterates as string frame keys and indexing
    # returns the frame object. FLAC VComment iterates as (key, value) tuples
    # where the value is a plain text string, so APIC never lives there.
    try:
        keys = list(tags.keys()) if hasattr(tags, "keys") else list(tags)
    except Exception:
        return None
    for key in keys:
        if not isinstance(key, str) or not key.startswith("APIC"):
            continue
        frame = tags.get(key) if hasattr(tags, "get") else tags[key]
        data = getattr(frame, "data", None)
        mime = getattr(frame, "mime", None) or "image/jpeg"
        if data:
            return data, mime
    return None


def api_cover(
    artist: str,
    album: str,
    album_dir: Path | None = None,
    *,
    size: int | None = None,
    image_format: str | None = None,
):
    lib = library_path()
    # Prefer the caller-supplied canonical directory (from api_cover_by_id)
    # so we don't get fooled by a loose duplicate folder under /Artist/Album
    # that shadows the real /Artist/YYYY/Album entry in the DB.
    if album_dir is None or not album_dir.is_dir():
        album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return _placeholder_cover(album or artist)

    _IMG_CACHE = {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
    }

    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.exists():
            media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
            return build_image_response(
                cover.read_bytes(),
                media_type,
                size=size,
                output_format=image_format,
                headers=_IMG_CACHE,
            )

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    for track in tracks:
        extracted = _extract_embedded_cover(track)
        if extracted:
            data, mime = extracted
            return build_image_response(
                data, mime, size=size, output_format=image_format, headers=_IMG_CACHE
            )

    return _placeholder_cover(album or artist)


@router.post(
    "/api/albums/{album_id}/enrich",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue album enrichment",
)
def api_enrich_album(request: Request, album_id: int):
    """Enrich an album: MBID lookup, cover fetch, audio analysis, bliss."""
    _require_auth(request)
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    task_id = create_task(
        "process_new_content",
        {
            "artist": album["artist"],
            "album": album["name"],
            "force": True,
            "triggered_by": "ui",
        },
    )
    return {"task_id": task_id}


@router.post(
    "/api/albums/by-entity/{album_entity_uid}/enrich",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue album enrichment by entity UID",
)
def api_enrich_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_enrich_album(request, album["id"])


@router.post(
    "/api/albums/{album_id}/fetch-cover",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue artwork fetching for an album",
)
def api_fetch_cover(request: Request, album_id: int):
    """Search and download a cover for an album from all available sources."""
    _require_auth(request)
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    task_id = create_task(
        "fetch_album_cover",
        {
            "album_id": album_id,
            "artist": album["artist"],
            "album": album["name"],
            "path": album.get("path", ""),
            "mbid": album.get("musicbrainz_albumid", ""),
        },
    )
    return {"task_id": task_id}


@router.post(
    "/api/albums/by-entity/{album_entity_uid}/fetch-cover",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue artwork fetching for an album by entity UID",
)
def api_fetch_cover_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    return api_fetch_cover(request, album["id"])


@router.get(
    "/api/albums/{album_id}/cover",
    responses=_IMAGE_RESPONSES,
    summary="Get album artwork",
)
def api_cover_by_id(
    album_id: int,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    album = get_library_album_by_id(album_id)
    if not album:
        return _placeholder_cover("?")
    artist = get_library_artist(album["artist"])
    album_dir = resolve_album_dir(library_path(), album, artist=artist)
    return api_cover(
        album["artist"],
        album["name"],
        album_dir=album_dir,
        size=size,
        image_format=image_format,
    )


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/cover",
    responses=_IMAGE_RESPONSES,
    summary="Get album artwork by entity UID",
)
def api_cover_by_entity_uid(
    album_entity_uid: str,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return _placeholder_cover("?")
    artist = get_library_artist(album["artist"])
    album_dir = resolve_album_dir(library_path(), album, artist=artist)
    return api_cover(
        album["artist"],
        album["name"],
        album_dir=album_dir,
        size=size,
        image_format=image_format,
    )


def api_download_album(request: Request, artist: str, album: str):
    """Download an entire album as a rich ZIP package."""
    _require_auth(request)
    import tempfile
    import zipfile

    from fastapi.responses import FileResponse

    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return Response(status_code=404)

    tmp_dir = Path(tempfile.mkdtemp(prefix="crate-album-download."))
    zip_path = tmp_dir / "album.zip"

    exts = extensions()
    album_row = find_album_row(artist, album)
    export_dir: Path | None = None
    cached_zip: Path | None = None
    cache_key: str | None = None
    if album_row:
        try:
            from crate.download_cache import (
                album_cache_ttl_seconds,
                album_download_cache_key,
                cached_download_artifact_path,
                download_cache_lock,
                download_cache_enabled,
                get_cached_download,
                safe_download_filename,
                store_cached_download,
            )
            from crate.db.queries.portable_metadata import get_portable_album_payload
            from crate.media_worker import build_album_download_package
            from crate.portable_metadata import (
                export_album_rich_metadata,
                find_album_artwork_file,
            )

            payload = get_portable_album_payload(int(album_row["id"]))
            if payload:
                album_payload = payload.get("album") or {}
                artwork_path = find_album_artwork_file(album_payload.get("path") or "")
                cache_key = album_download_cache_key(payload, artwork_path=artwork_path)
                cache_filename = safe_download_filename(
                    f"{artist} - {album}.zip", "album.zip"
                )
                cached = get_cached_download(
                    "album",
                    cache_key,
                    cache_filename,
                    ttl_seconds=album_cache_ttl_seconds(),
                )
                if cached is None:
                    with download_cache_lock("album", cache_key):
                        cached = get_cached_download(
                            "album",
                            cache_key,
                            cache_filename,
                            ttl_seconds=album_cache_ttl_seconds(),
                        )
                        if cached is None:
                            if download_cache_enabled():
                                worker_output_path = cached_download_artifact_path(
                                    "album", cache_key, cache_filename
                                )
                                worker_result = build_album_download_package(
                                    payload,
                                    output_path=worker_output_path,
                                    filename=cache_filename,
                                    job_id=cache_key,
                                    artwork_path=artwork_path,
                                    write_rich_tags=True,
                                    cache_kind="album",
                                    cache_key=cache_key,
                                    cache_metadata={
                                        "album_id": album_row["id"],
                                        "album_entity_uid": album_payload.get(
                                            "entity_uid"
                                        ),
                                        "engine": "crate-media-worker",
                                        "tracks": len(payload.get("tracks") or []),
                                    },
                                )
                                if worker_result and worker_result.get("ok"):
                                    cached = get_cached_download(
                                        "album",
                                        cache_key,
                                        cache_filename,
                                        ttl_seconds=album_cache_ttl_seconds(),
                                    )
                                elif worker_result:
                                    log.debug(
                                        "crate-media-worker package failed: %s",
                                        worker_result,
                                    )
                            if cached is None:
                                export_result = export_album_rich_metadata(
                                    payload,
                                    export_root=tmp_dir / "rich",
                                    include_audio=True,
                                    write_rich_tags=True,
                                )
                                export_dir = Path(str(export_result["export_path"]))
                                with zipfile.ZipFile(
                                    zip_path, "w", zipfile.ZIP_STORED
                                ) as zip_file:
                                    for file_path in sorted(
                                        path
                                        for path in export_dir.rglob("*")
                                        if path.is_file()
                                    ):
                                        zip_file.write(
                                            str(file_path),
                                            str(file_path.relative_to(export_dir)),
                                        )
                                cached = store_cached_download(
                                    "album",
                                    cache_key,
                                    cache_filename,
                                    zip_path,
                                    metadata={
                                        "album_id": album_row["id"],
                                        "album_entity_uid": album_payload.get(
                                            "entity_uid"
                                        ),
                                        "tracks": export_result.get("tracks"),
                                        "artwork_files": export_result.get(
                                            "artwork_files"
                                        ),
                                    },
                                )
                if cached is not None:
                    cached_zip = cached.path
        except Exception:
            export_dir = None

    if cached_zip is not None:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        safe_name = f"{artist} - {album}.zip".replace("/", "-")
        return FileResponse(
            path=str(cached_zip), filename=safe_name, media_type="application/zip"
        )

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zip_file:
        if export_dir and export_dir.is_dir():
            for file_path in sorted(
                path for path in export_dir.rglob("*") if path.is_file()
            ):
                zip_file.write(str(file_path), str(file_path.relative_to(export_dir)))
        else:
            for file_path in sorted(album_dir.iterdir()):
                if file_path.is_file() and (
                    file_path.suffix.lower() in exts
                    or file_path.name.lower()
                    in ("cover.jpg", "cover.png", "folder.jpg", "front.jpg")
                ):
                    zip_file.write(str(file_path), file_path.name)

    safe_name = f"{artist} - {album}.zip".replace("/", "-")
    return FileResponse(
        path=str(zip_path),
        filename=safe_name,
        media_type="application/zip",
        background=BackgroundTask(shutil.rmtree, tmp_dir, ignore_errors=True),
    )


@router.get(
    "/api/albums/{album_id}/download",
    responses=_ZIP_RESPONSES,
    summary="Download an album as a zip archive",
)
def api_download_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return Response(status_code=404)
    return api_download_album(request, album["artist"], album["name"])


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/download",
    responses=_ZIP_RESPONSES,
    summary="Download an album as a zip archive by entity UID",
)
def api_download_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return Response(status_code=404)
    return api_download_album(request, album["artist"], album["name"])
