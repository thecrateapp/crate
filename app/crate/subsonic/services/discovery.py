"""Lyrics and library-backed discovery for OpenSubsonic clients."""

from __future__ import annotations

import re
from math import isfinite
from statistics import fmean
from typing import Any

from crate.db.queries.artist_bliss_centroids import get_artist_bliss_centroid
from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates
from crate.db.queries.bliss_track_lookup import (
    get_same_artist_tracks,
    get_track_with_artist,
)
from crate.db.queries.subsonic_discovery import (
    get_discovery_seed_tracks,
    get_global_tracks_by_local_ids,
    get_top_songs_for_artist,
)
from crate.db.queries.subsonic_global import (
    get_global_album,
    get_global_album_by_local_id,
    get_global_artist,
    get_global_artist_by_local_id,
    get_global_artists_by_names,
)
from crate.db.repositories.lyrics import get_cached_lyrics
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.global_ids import (
    EntityKind,
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
)
from crate.subsonic.serializers import serialize_song
from crate.subsonic.services.playback import _track_for_subsonic_id

DEFAULT_COUNT = 50
MAX_COUNT = 500
BLISS_VECTOR_SIZE = 20

_TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]")
_METADATA_RE = re.compile(r"^\[[a-zA-Z]+:.*\]$")


def _invalid_parameter(name: str) -> OpenSubsonicError:
    return OpenSubsonicError(ErrorCode.MISSING_PARAMETER, f"Invalid parameter '{name}'")


def _parse_count(value: int | str | None) -> int:
    if value is None or value == "":
        return DEFAULT_COUNT
    try:
        count = int(value)
    except (TypeError, ValueError) as exc:
        raise _invalid_parameter("count") from exc
    if count < 0:
        raise _invalid_parameter("count")
    return min(count, MAX_COUNT)


def get_lyrics(artist: str | None, title: str | None) -> dict[str, str]:
    """Return cached lyrics or the valid empty Subsonic lyrics object."""
    artist_name = (artist or "").strip()
    song_title = (title or "").strip()
    cached = (
        get_cached_lyrics(artist_name, song_title, max_age_seconds=None)
        if artist_name and song_title
        else None
    )
    value = str((cached or {}).get("plainLyrics") or "").strip()
    if not value:
        value = "\n".join(_lyric_text_lines((cached or {}).get("syncedLyrics")))
    return {"artist": artist_name, "title": song_title, "value": value}


def get_lyrics_by_song_id(identifier: str) -> dict[str, list[dict[str, Any]]]:
    """Return structured cached lyrics without performing network lookups."""
    track = _track_for_subsonic_id(identifier)
    if track is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track not found")

    _entity_id, metadata = track
    artist = str(metadata.get("artist") or "").strip()
    title = str(metadata.get("title") or "").strip()
    cached = (
        get_cached_lyrics(artist, title, max_age_seconds=None)
        if artist and title
        else None
    )
    if not cached:
        return {"structuredLyrics": []}

    structured: list[dict[str, Any]] = []
    synced_lines = _synced_lyric_lines(cached.get("syncedLyrics"))
    if synced_lines:
        structured.append({"lang": "und", "synced": True, "line": synced_lines})
    plain_lines = _plain_lyric_lines(cached.get("plainLyrics"))
    if plain_lines:
        structured.append(
            {
                "lang": "und",
                "synced": False,
                "line": [{"value": line} for line in plain_lines],
            }
        )
    return {"structuredLyrics": structured}


def _lyric_text_lines(value: Any) -> list[str]:
    if not isinstance(value, str):
        return []
    lines: list[str] = []
    for raw_line in value.lstrip("\ufeff").splitlines():
        line = _TIMESTAMP_RE.sub("", raw_line).strip()
        if line and not _METADATA_RE.fullmatch(line):
            lines.append(line)
    return lines


def _plain_lyric_lines(value: Any) -> list[str]:
    return _lyric_text_lines(value)


def _synced_lyric_lines(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, str):
        return []
    parsed: list[tuple[int, int, str]] = []
    sequence = 0
    for raw_line in value.lstrip("\ufeff").splitlines():
        timestamps = list(_TIMESTAMP_RE.finditer(raw_line))
        line_value = _TIMESTAMP_RE.sub("", raw_line).strip()
        if not line_value or _METADATA_RE.fullmatch(line_value):
            continue
        for timestamp in timestamps:
            fraction = (timestamp.group(3) or "").ljust(3, "0")[:3]
            start_ms = (
                int(timestamp.group(1)) * 60_000
                + int(timestamp.group(2)) * 1_000
                + int(fraction or "0")
            )
            parsed.append((start_ms, sequence, line_value))
            sequence += 1

    parsed.sort(key=lambda item: (item[0], item[1]))
    return [{"start": start, "value": line} for start, _order, line in parsed]


def _artist_for_identifier(identifier: str) -> dict[str, Any]:
    try:
        entity_id = decode_subsonic_id(identifier, expected_kind="artist")
    except SubsonicIdError as exc:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Artist not found") from exc
    artist = (
        get_global_artist(str(entity_id.global_uid))
        if entity_id.scope == "global"
        else get_global_artist_by_local_id(int(entity_id.local_id or 0))
    )
    if artist is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Artist not found")
    return artist


def get_top_songs(
    *,
    artist: str | None = None,
    artist_id: str | None = None,
    count: int | str | None = None,
) -> list[dict[str, Any]]:
    """Return only ranked tracks already stored in Crate's local catalog."""
    limit = _parse_count(count)
    if limit == 0:
        return []

    if artist_id and artist_id.strip():
        artist_row = _artist_for_identifier(artist_id.strip())
    else:
        artist_name = (artist or "").strip()
        if not artist_name:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER,
                "Required parameter 'artist' or 'id' is missing",
            )
        matches = get_global_artists_by_names(
            [artist_name], include_not_present=True, limit=1
        )
        artist_row = matches[0] if matches else None
    if artist_row is None:
        return []

    rows = get_top_songs_for_artist(str(artist_row["global_artist_uid"]), limit=limit)
    return _serialize_unique_songs(rows, identity_key="global_track_uid", limit=limit)


def _serialize_unique_songs(
    rows: list[dict[str, Any]], *, identity_key: str, limit: int
) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        identifier = str(row.get(identity_key) or row.get("id") or "")
        if not identifier or identifier in seen:
            continue
        seen.add(identifier)
        serialized.append(serialize_song(row))
        if len(serialized) >= limit:
            break
    return serialized


def _kind_for_identifier(identifier: str) -> EntityKind:
    if identifier.startswith(("ga-", "ar-")):
        return "artist"
    if identifier.startswith(("gal-", "al-")):
        return "album"
    return "track"


def _valid_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if len(vector) != BLISS_VECTOR_SIZE or not all(isfinite(item) for item in vector):
        return None
    return vector


def _average_seed_vector(seeds: list[dict[str, Any]]) -> list[float] | None:
    vectors = [
        vector
        for seed in seeds
        if (vector := _valid_vector(seed.get("bliss_vector"))) is not None
    ]
    if not vectors:
        return None
    return [fmean(values) for values in zip(*vectors, strict=True)]


def _seed_for_identifier(identifier: str) -> dict[str, Any] | None:
    if not identifier.strip():
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Required parameter 'id' is missing"
        )
    kind = _kind_for_identifier(identifier)
    try:
        entity_id: SubsonicEntityId = decode_subsonic_id(identifier, expected_kind=kind)
    except SubsonicIdError as exc:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Media not found") from exc

    if kind == "artist":
        artist = _artist_for_identifier(identifier)
        uid = str(artist["global_artist_uid"])
        seeds = get_discovery_seed_tracks("artist", uid)
        centroid = get_artist_bliss_centroid(str(artist.get("name") or ""))
        vector = _valid_vector((centroid or {}).get("bliss_vector"))
        if vector is None:
            vector = _average_seed_vector(seeds)
    elif kind == "album":
        album = (
            get_global_album(str(entity_id.global_uid))
            if entity_id.scope == "global"
            else get_global_album_by_local_id(int(entity_id.local_id or 0))
        )
        if album is None:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Album not found")
        uid = str(album["global_album_uid"])
        seeds = get_discovery_seed_tracks("album", uid)
        vector = _average_seed_vector(seeds)
    else:
        track_result = _track_for_subsonic_id(identifier)
        if track_result is None:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track not found")
        _track_entity, track = track_result
        bliss_track = get_track_with_artist(track_path=str(track.get("path") or ""))
        if bliss_track is None:
            return None
        vector = _valid_vector(bliss_track.get("bliss_vector"))
        track_path = str(bliss_track.get("path") or track.get("path") or "")
        artist_name = str(
            bliss_track.get("album_artist") or bliss_track.get("artist") or ""
        ).strip()
        seeds = [
            {"path": track_path},
        ]

    if vector is None and kind != "track":
        return None
    seed = {
        "vector": vector,
        "paths": {
            str(seed["path"])
            for seed in seeds
            if seed.get("path") is not None and str(seed["path"])
        },
    }
    if kind == "track":
        seed.update(
            {
                "track_path": track_path,
                "artist_id": bliss_track.get("artist_id"),
                "artist_name": artist_name,
            }
        )
    return seed


def _same_artist_similar_songs(
    seed: dict[str, Any], *, limit: int
) -> list[dict[str, Any]]:
    track_path = str(seed.get("track_path") or "")
    artist_name = str(seed.get("artist_name") or "").strip()
    if not track_path or not artist_name:
        return []

    rows = get_same_artist_tracks(
        artist_id=seed.get("artist_id"),
        artist_name=artist_name,
        exclude_path=track_path,
        limit=MAX_COUNT,
    )
    local_ids: list[int] = []
    seen_local_ids: set[int] = set()
    for row in rows:
        path = str(row.get("path") or "")
        try:
            local_id = int(row["track_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if not path or path == track_path or local_id in seen_local_ids:
            continue
        seen_local_ids.add(local_id)
        local_ids.append(local_id)

    if not local_ids:
        return []

    tracks_by_local_id = get_global_tracks_by_local_ids(local_ids)
    tracks = [
        tracks_by_local_id[local_id]
        for local_id in local_ids
        if local_id in tracks_by_local_id
    ]
    return _serialize_unique_songs(tracks, identity_key="global_track_uid", limit=limit)


def get_similar_songs(
    identifier: str, count: int | str | None = None
) -> list[dict[str, Any]]:
    """Return unique ranked Bliss matches, or an empty result without seed data."""
    limit = _parse_count(count)
    if limit == 0:
        return []
    seed = _seed_for_identifier(identifier)
    if seed is None:
        return []
    vector = _valid_vector(seed.get("vector"))
    if vector is None:
        return _same_artist_similar_songs(seed, limit=limit)

    candidates = get_bliss_candidates(
        bliss_vector=vector,
        exclude_paths=sorted(seed["paths"]),
        limit=MAX_COUNT,
    )
    ordered_ids: list[int] = []
    seen_ids: set[int] = set()
    seed_paths = seed["paths"]
    for candidate in candidates:
        path = str(candidate.get("path") or "")
        try:
            local_id = int(candidate["track_id"])
        except (KeyError, TypeError, ValueError):
            continue
        if not path or path in seed_paths or local_id in seen_ids:
            continue
        seen_ids.add(local_id)
        ordered_ids.append(local_id)
    if not ordered_ids:
        return _same_artist_similar_songs(seed, limit=limit)

    tracks_by_local_id = get_global_tracks_by_local_ids(ordered_ids)
    result: list[dict[str, Any]] = []
    seen_global_ids: set[str] = set()
    for local_id in ordered_ids:
        track = tracks_by_local_id.get(local_id)
        if track is None:
            continue
        global_id = str(track.get("global_track_uid") or "")
        if not global_id or global_id in seen_global_ids:
            continue
        seen_global_ids.add(global_id)
        result.append(serialize_song(track))
        if len(result) >= limit:
            break
    return result or _same_artist_similar_songs(seed, limit=limit)


__all__ = [
    "get_lyrics",
    "get_lyrics_by_song_id",
    "get_similar_songs",
    "get_top_songs",
]
