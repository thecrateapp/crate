"""Enrichment/delete helpers for library repository writes."""

from __future__ import annotations

from typing import Any
from datetime import datetime, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.repositories.field_locks import list_locked_fields, lock_fields
from crate.db.repositories.library_shared import coerce_uuid_or_none
from crate.db.tx import optional_scope


ARTIST_METADATA_FIELDS = {
    "bio": "bio",
    "tags": "tags_json",
    "urls": "urls_json",
    "mbid": "mbid",
    "country": "country",
    "area": "area",
    "formed": "formed",
    "ended": "ended",
    "artist_type": "artist_type",
    "bandcamp_url": "bandcamp_url",
}


def _artist_metadata_snapshot(artist: LibraryArtist) -> dict[str, Any]:
    return {
        "bio": artist.bio,
        "tags": artist.tags_json if isinstance(artist.tags_json, list) else [],
        "urls": artist.urls_json if isinstance(artist.urls_json, dict) else {},
        "mbid": artist.mbid,
        "country": artist.country,
        "area": artist.area,
        "formed": artist.formed,
        "ended": artist.ended,
        "artist_type": artist.artist_type,
        "bandcamp_url": artist.bandcamp_url,
    }


def update_artist_metadata(
    *,
    artist_id: int | None = None,
    artist_entity_uid: str | None = None,
    artist_name: str | None = None,
    metadata: dict[str, Any],
    locked_by_user_id: int | None = None,
    session: Session | None = None,
) -> dict[str, Any] | None:
    values = {
        key: value for key, value in metadata.items() if key in ARTIST_METADATA_FIELDS
    }
    if not values:
        return None

    def _impl(s: Session) -> dict[str, Any] | None:
        predicates = []
        if artist_id is not None:
            predicates.append(LibraryArtist.id == int(artist_id))
        if artist_entity_uid:
            entity_uid = coerce_uuid_or_none(artist_entity_uid)
            if entity_uid is not None:
                predicates.append(LibraryArtist.entity_uid == entity_uid)
        if artist_name:
            predicates.append(func.lower(LibraryArtist.name) == func.lower(artist_name))
        if not predicates:
            return None

        artist = s.execute(
            select(LibraryArtist).where(or_(*predicates)).limit(1)
        ).scalar_one_or_none()
        if artist is None:
            return None

        before = _artist_metadata_snapshot(artist)
        for key, value in values.items():
            setattr(artist, ARTIST_METADATA_FIELDS[key], value)
            if key == "bandcamp_url":
                artist.bandcamp_url_source = "manual" if value else None
                artist.bandcamp_url_updated_at = datetime.now(timezone.utc)

        after = _artist_metadata_snapshot(artist)
        changed_fields = [key for key in values if before.get(key) != after.get(key)]
        if changed_fields:
            artist.updated_at = datetime.now(timezone.utc)
            lock_fields(
                entity_type="artist",
                entity_id=int(artist.id),
                field_names=changed_fields,
                locked_by_user_id=locked_by_user_id,
                reason="Manual artist metadata edit",
                source="manual_edit",
                session=s,
            )

        return {
            "artist_id": artist.id,
            "artist_entity_uid": str(artist.entity_uid)
            if artist.entity_uid is not None
            else None,
            "artist_name": artist.name,
            "before": {key: before.get(key) for key in changed_fields},
            "after": {key: after.get(key) for key in changed_fields},
            "changed_fields": changed_fields,
        }

    with optional_scope(session) as s:
        return _impl(s)


def update_artist_enrichment(
    name: str, data: dict, *, session: Session | None = None
) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(
            select(LibraryArtist).where(LibraryArtist.name == name).limit(1)
        ).scalar_one_or_none()
        if artist is None:
            return

        locked_fields = list_locked_fields(
            entity_type="artist",
            entity_id=int(artist.id),
            session=s,
        )
        field_map = {
            "bio": data.get("bio"),
            "tags_json": data.get("tags"),
            "similar_json": data.get("similar"),
            "spotify_id": data.get("spotify_id"),
            "spotify_popularity": data.get("spotify_popularity"),
            "spotify_followers": data.get("spotify_followers"),
            "mbid": data.get("mbid"),
            "country": data.get("country"),
            "area": data.get("area"),
            "formed": data.get("formed"),
            "ended": data.get("ended"),
            "artist_type": data.get("artist_type"),
            "members_json": data.get("members"),
            "urls_json": data.get("urls"),
            "listeners": data.get("listeners"),
            "lastfm_playcount": data.get("lastfm_playcount"),
            "discogs_id": data.get("discogs_id"),
            "discogs_profile": data.get("discogs_profile"),
            "discogs_members_json": data.get("discogs_members"),
        }
        field_lock_map = {
            "bio": "bio",
            "tags_json": "tags",
            "mbid": "mbid",
            "country": "country",
            "area": "area",
            "formed": "formed",
            "ended": "ended",
            "artist_type": "artist_type",
            "urls_json": "urls",
        }
        for attr, value in field_map.items():
            locked_field = field_lock_map.get(attr)
            if value is not None and locked_field not in locked_fields:
                setattr(artist, attr, value)
        artist.enriched_at = datetime.now(timezone.utc)

    with optional_scope(session) as s:
        _impl(s)


def update_artist_has_photo(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(
            select(LibraryArtist).where(LibraryArtist.name == name).limit(1)
        ).scalar_one_or_none()
        if artist is not None:
            artist.has_photo = 1

    with optional_scope(session) as s:
        _impl(s)


def delete_artist(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        album_ids = (
            s.execute(select(LibraryAlbum.id).where(LibraryAlbum.artist == name))
            .scalars()
            .all()
        )
        if album_ids:
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id.in_(album_ids)))
        s.execute(delete(LibraryAlbum).where(LibraryAlbum.artist == name))
        s.execute(delete(LibraryArtist).where(LibraryArtist.name == name))

    with optional_scope(session) as s:
        _impl(s)


def delete_album(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        album_id = s.execute(
            select(LibraryAlbum.id).where(LibraryAlbum.path == path).limit(1)
        ).scalar_one_or_none()
        if album_id is not None:
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id == album_id))
            s.execute(delete(LibraryAlbum).where(LibraryAlbum.id == album_id))

    with optional_scope(session) as s:
        _impl(s)


def delete_track(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        s.execute(delete(LibraryTrack).where(LibraryTrack.path == path))

    with optional_scope(session) as s:
        _impl(s)


def set_track_rating(
    track_id: int, rating: int, *, session: Session | None = None
) -> None:
    def _impl(s: Session) -> None:
        track = s.get(LibraryTrack, track_id)
        if track is not None:
            track.rating = max(0, min(5, rating))

    with optional_scope(session) as s:
        _impl(s)


__all__ = [
    "delete_album",
    "delete_artist",
    "delete_track",
    "set_track_rating",
    "update_artist_metadata",
    "update_artist_enrichment",
    "update_artist_has_photo",
]
