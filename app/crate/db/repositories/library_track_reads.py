"""Track catalog lookup helpers for the library repository."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.repositories.library_shared import (
    LibraryTrackRow,
    coerce_uuid,
    track_to_dict,
)
from crate.db.tx import read_scope


def _index_tracks(rows: Iterable[Any], key_attr: str) -> dict[str, LibraryTrackRow]:
    indexed: dict[str, LibraryTrackRow] = {}
    for row in rows:
        key = getattr(row, key_attr, None)
        track = track_to_dict(row)
        if key is not None and track is not None:
            indexed[str(key)] = track
    return indexed


def get_library_tracks(
    album_id: int, *, session: Session | None = None
) -> list[LibraryTrackRow]:
    def impl(s: Session) -> list[LibraryTrackRow]:
        rows = (
            s.execute(
                select(LibraryTrack)
                .where(LibraryTrack.album_id == album_id)
                .order_by(LibraryTrack.disc_number, LibraryTrack.track_number)
            )
            .scalars()
            .all()
        )
        return [track for row in rows if (track := track_to_dict(row)) is not None]

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_id(
    track_id: int, *, session: Session | None = None
) -> LibraryTrackRow | None:
    def impl(s: Session) -> LibraryTrackRow | None:
        row = s.get(LibraryTrack, track_id)
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def resolve_library_track_reference(
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_storage_id: str | None = None,
    track_path: str | None = None,
    session: Session | None = None,
) -> LibraryTrackRow | None:
    def impl(s: Session) -> LibraryTrackRow | None:
        if track_id is not None:
            track = get_library_track_by_id(int(track_id), session=s)
            if track is not None:
                return track
        if track_entity_uid:
            track = get_library_track_by_entity_uid(str(track_entity_uid), session=s)
            if track is not None:
                return track
        if track_storage_id:
            track = get_library_track_by_storage_id(str(track_storage_id), session=s)
            if track is not None:
                return track
        if track_path:
            track = get_library_track_by_path(str(track_path), session=s)
            if track is not None:
                return track
        return None

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_storage_id(
    storage_id: str, *, session: Session | None = None
) -> LibraryTrackRow | None:
    def impl(s: Session) -> LibraryTrackRow | None:
        row = s.execute(
            select(LibraryTrack)
            .where(LibraryTrack.storage_id == coerce_uuid(storage_id))
            .limit(1)
        ).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_entity_uid(
    entity_uid: str, *, session: Session | None = None
) -> LibraryTrackRow | None:
    def impl(s: Session) -> LibraryTrackRow | None:
        row = s.execute(
            select(LibraryTrack)
            .where(LibraryTrack.entity_uid == coerce_uuid(entity_uid))
            .limit(1)
        ).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_path(
    path: str, *, session: Session | None = None
) -> LibraryTrackRow | None:
    def impl(s: Session) -> LibraryTrackRow | None:
        row = s.execute(
            select(LibraryTrack).where(LibraryTrack.path == path).limit(1)
        ).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_tracks_by_storage_ids(
    storage_ids: list[str], *, session: Session | None = None
) -> dict[str, LibraryTrackRow]:
    cleaned_ids = [storage_id for storage_id in storage_ids if storage_id]
    if not cleaned_ids:
        return {}

    uuids = [coerce_uuid(storage_id) for storage_id in cleaned_ids]

    def impl(s: Session) -> dict[str, LibraryTrackRow]:
        rows = (
            s.execute(select(LibraryTrack).where(LibraryTrack.storage_id.in_(uuids)))
            .scalars()
            .all()
        )
        return _index_tracks(rows, "storage_id")

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_tracks_by_entity_uids(
    entity_uids: list[str], *, session: Session | None = None
) -> dict[str, LibraryTrackRow]:
    cleaned_ids = [entity_uid for entity_uid in entity_uids if entity_uid]
    if not cleaned_ids:
        return {}

    uuids = [coerce_uuid(entity_uid) for entity_uid in cleaned_ids]

    def impl(s: Session) -> dict[str, LibraryTrackRow]:
        rows = (
            s.execute(select(LibraryTrack).where(LibraryTrack.entity_uid.in_(uuids)))
            .scalars()
            .all()
        )
        return _index_tracks(rows, "entity_uid")

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = [
    "get_library_track_by_entity_uid",
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_track_by_storage_id",
    "get_library_tracks",
    "get_library_tracks_by_entity_uids",
    "get_library_tracks_by_storage_ids",
    "resolve_library_track_reference",
]
