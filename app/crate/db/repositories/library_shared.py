"""Shared helpers for library repository modules."""

from __future__ import annotations

import uuid
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.orm import Session


def coerce_uuid(value: str | uuid.UUID | None) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    if value:
        return uuid.UUID(str(value))
    return uuid.uuid4()


def coerce_uuid_or_none(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if value:
        return uuid.UUID(str(value))
    return None


class LibraryArtistRow(TypedDict):
    id: int
    storage_id: str | None
    entity_uid: str | None
    name: str
    slug: str | None
    folder_name: str | None
    album_count: int
    track_count: int
    total_size: int
    formats: list[str]
    primary_format: str | None
    has_photo: int
    dir_mtime: float | None
    updated_at: Any | None
    bio: str | None
    tags_json: Any | None
    similar_json: Any | None
    spotify_id: str | None
    spotify_popularity: int | None
    spotify_followers: int | None
    mbid: str | None
    country: str | None
    area: str | None
    formed: str | None
    ended: str | None
    artist_type: str | None
    members_json: Any | None
    urls_json: Any | None
    listeners: int | None
    enriched_at: Any | None
    discogs_id: str | None
    lastfm_playcount: int | None
    popularity: int | None
    popularity_score: float | None
    popularity_confidence: float | None
    discogs_profile: str | None
    discogs_members_json: Any | None
    latest_release_date: str | None
    content_hash: str | None


class LibraryAlbumRow(TypedDict):
    id: int
    storage_id: str | None
    entity_uid: str | None
    artist: str
    name: str
    slug: str | None
    path: str
    track_count: int
    total_size: int
    total_duration: float
    formats: list[str]
    year: str | None
    genre: str | None
    has_cover: int
    musicbrainz_albumid: str | None
    musicbrainz_releasegroupid: str | None
    tag_album: str | None
    dir_mtime: float | None
    updated_at: Any | None
    discogs_master_id: str | None
    lastfm_listeners: int | None
    lastfm_playcount: int | None
    popularity: int | None
    popularity_score: float | None
    popularity_confidence: float | None
    quarantined_at: Any | None
    quarantine_task_id: str | None


class LibraryTrackRow(TypedDict):
    id: int
    storage_id: str | None
    entity_uid: str | None
    album_id: int | None
    artist: str
    album: str
    slug: str | None
    filename: str
    title: str | None
    track_number: int | None
    disc_number: int
    format: str | None
    bitrate: int | None
    sample_rate: int | None
    bit_depth: int | None
    duration: float | None
    size: int | None
    year: str | None
    genre: str | None
    albumartist: str | None
    musicbrainz_albumid: str | None
    musicbrainz_trackid: str | None
    audio_fingerprint: str | None
    audio_fingerprint_source: str | None
    audio_fingerprint_computed_at: Any | None
    path: str
    updated_at: Any | None
    bpm: float | None
    audio_key: str | None
    audio_scale: str | None
    energy: float | None
    mood_json: Any | None
    danceability: float | None
    valence: float | None
    acousticness: float | None
    instrumentalness: float | None
    loudness: float | None
    dynamic_range: float | None
    spectral_complexity: float | None
    analysis_state: str | None
    bliss_state: str | None
    analysis_completed_at: Any | None
    bliss_computed_at: Any | None
    bliss_vector: list[float] | None
    lastfm_listeners: int | None
    lastfm_playcount: int | None
    lastfm_top_rank: int | None
    spotify_track_popularity: int | None
    spotify_top_rank: int | None
    popularity: int | None
    popularity_score: float | None
    popularity_confidence: float | None
    rating: int


def artist_to_dict(artist) -> LibraryArtistRow | None:
    if artist is None:
        return None
    entity_uid = str(artist.entity_uid) if getattr(artist, "entity_uid", None) else None
    return {
        "id": artist.id,
        "storage_id": None
        if entity_uid
        else (str(artist.storage_id) if artist.storage_id else None),
        "entity_uid": entity_uid,
        "name": artist.name,
        "slug": artist.slug,
        "folder_name": artist.folder_name,
        "album_count": artist.album_count or 0,
        "track_count": artist.track_count or 0,
        "total_size": artist.total_size or 0,
        "formats": list(artist.formats_json or []),
        "primary_format": artist.primary_format,
        "has_photo": artist.has_photo or 0,
        "dir_mtime": artist.dir_mtime,
        "updated_at": artist.updated_at,
        "bio": artist.bio,
        "tags_json": artist.tags_json,
        "similar_json": artist.similar_json,
        "spotify_id": artist.spotify_id,
        "spotify_popularity": artist.spotify_popularity,
        "spotify_followers": artist.spotify_followers,
        "mbid": artist.mbid,
        "country": artist.country,
        "area": artist.area,
        "formed": artist.formed,
        "ended": artist.ended,
        "artist_type": artist.artist_type,
        "members_json": artist.members_json,
        "urls_json": artist.urls_json,
        "listeners": artist.listeners,
        "enriched_at": artist.enriched_at,
        "discogs_id": artist.discogs_id,
        "lastfm_playcount": artist.lastfm_playcount,
        "popularity": artist.popularity,
        "popularity_score": artist.popularity_score,
        "popularity_confidence": artist.popularity_confidence,
        "discogs_profile": artist.discogs_profile,
        "discogs_members_json": artist.discogs_members_json,
        "latest_release_date": artist.latest_release_date,
        "content_hash": artist.content_hash,
    }


def album_to_dict(album) -> LibraryAlbumRow | None:
    if album is None:
        return None
    entity_uid = str(album.entity_uid) if getattr(album, "entity_uid", None) else None
    return {
        "id": album.id,
        "storage_id": None
        if entity_uid
        else (str(album.storage_id) if album.storage_id else None),
        "entity_uid": entity_uid,
        "artist": album.artist,
        "name": album.name,
        "slug": album.slug,
        "path": album.path,
        "track_count": album.track_count or 0,
        "total_size": album.total_size or 0,
        "total_duration": album.total_duration or 0,
        "formats": list(album.formats_json or []),
        "year": album.year,
        "genre": album.genre,
        "has_cover": album.has_cover or 0,
        "musicbrainz_albumid": album.musicbrainz_albumid,
        "musicbrainz_releasegroupid": album.musicbrainz_releasegroupid,
        "tag_album": album.tag_album,
        "dir_mtime": album.dir_mtime,
        "updated_at": album.updated_at,
        "discogs_master_id": album.discogs_master_id,
        "lastfm_listeners": album.lastfm_listeners,
        "lastfm_playcount": album.lastfm_playcount,
        "popularity": album.popularity,
        "popularity_score": album.popularity_score,
        "popularity_confidence": album.popularity_confidence,
        "quarantined_at": album.quarantined_at,
        "quarantine_task_id": album.quarantine_task_id,
    }


def track_to_dict(track) -> LibraryTrackRow | None:
    if track is None:
        return None
    entity_uid = str(track.entity_uid) if getattr(track, "entity_uid", None) else None
    return {
        "id": track.id,
        "storage_id": str(track.storage_id) if track.storage_id else None,
        "entity_uid": entity_uid,
        "album_id": track.album_id,
        "artist": track.artist,
        "album": track.album,
        "slug": track.slug,
        "filename": track.filename,
        "title": track.title,
        "track_number": track.track_number,
        "disc_number": track.disc_number or 1,
        "format": track.format,
        "bitrate": track.bitrate,
        "sample_rate": track.sample_rate,
        "bit_depth": track.bit_depth,
        "duration": track.duration,
        "size": track.size,
        "year": track.year,
        "genre": track.genre,
        "albumartist": track.albumartist,
        "musicbrainz_albumid": track.musicbrainz_albumid,
        "musicbrainz_trackid": track.musicbrainz_trackid,
        "audio_fingerprint": track.audio_fingerprint,
        "audio_fingerprint_source": track.audio_fingerprint_source,
        "audio_fingerprint_computed_at": track.audio_fingerprint_computed_at,
        "path": track.path,
        "updated_at": track.updated_at,
        "bpm": track.bpm,
        "audio_key": track.audio_key,
        "audio_scale": track.audio_scale,
        "energy": track.energy,
        "mood_json": track.mood_json,
        "danceability": track.danceability,
        "valence": track.valence,
        "acousticness": track.acousticness,
        "instrumentalness": track.instrumentalness,
        "loudness": track.loudness,
        "dynamic_range": track.dynamic_range,
        "spectral_complexity": track.spectral_complexity,
        "analysis_state": track.analysis_state,
        "bliss_state": track.bliss_state,
        "analysis_completed_at": track.analysis_completed_at,
        "bliss_computed_at": track.bliss_computed_at,
        "bliss_vector": list(track.bliss_vector or [])
        if track.bliss_vector is not None
        else None,
        "lastfm_listeners": track.lastfm_listeners,
        "lastfm_playcount": track.lastfm_playcount,
        "lastfm_top_rank": track.lastfm_top_rank,
        "spotify_track_popularity": track.spotify_track_popularity,
        "spotify_top_rank": track.spotify_top_rank,
        "popularity": track.popularity,
        "popularity_score": track.popularity_score,
        "popularity_confidence": track.popularity_confidence,
        "rating": track.rating or 0,
    }


def allocate_unique_slug(session: Session, model, base_slug: str) -> str:
    candidate = base_slug or "item"
    suffix = 2
    while True:
        exists = session.execute(
            select(model.id).where(model.slug == candidate).limit(1)
        ).scalar_one_or_none()
        if exists is None:
            return candidate
        candidate = f"{base_slug}-{suffix}"
        suffix += 1


__all__ = [
    "album_to_dict",
    "allocate_unique_slug",
    "artist_to_dict",
    "coerce_uuid",
    "coerce_uuid_or_none",
    "LibraryAlbumRow",
    "LibraryArtistRow",
    "LibraryTrackRow",
    "track_to_dict",
]
