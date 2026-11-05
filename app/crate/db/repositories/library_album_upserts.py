from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import and_, false, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from crate.entity_ids import album_entity_uid
from crate.db.orm.library import LibraryAlbum
from crate.db.orm.library import LibraryArtist
from crate.release_dates import normalize_release_date
from crate.db.repositories.entity_identity_keys import upsert_entity_identity_key
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.repositories.library_shared import (
    allocate_unique_slug,
    coerce_uuid_or_none,
)
from crate.db.tx import optional_scope
from crate.slugs import build_album_slug


class LibraryAlbumIdentityConflict(RuntimeError):
    """A scanned album folder is a second live copy of an album indexed elsewhere."""

    def __init__(self, *, path: str, existing_album_id: int, existing_path: str):
        super().__init__(
            f"Album at {path} is already indexed as album {existing_album_id} "
            f"at {existing_path}"
        )
        self.path = path
        self.existing_album_id = existing_album_id
        self.existing_path = existing_path


def _adopt_moved_album(
    s: Session,
    data: dict,
    entity_uid,
    columns: tuple,
    indexed_path_is_live: Callable[[str], bool],
) -> Row | None:
    """Return the row a folder moved away from, or ``None`` for a new album.

    ``library_albums`` keeps one row per artist and name and per entity UID. A
    row holding either key at another path is the same album: when its folder
    has gone the album moved, so the caller updates that row; when its folder
    still holds audio this folder is a second copy, which is not indexed.
    """
    rows = s.execute(
        select(*columns, LibraryAlbum.path, LibraryAlbum.quarantined_at)
        .where(
            LibraryAlbum.path != data["path"],
            or_(
                and_(
                    LibraryAlbum.artist == data["artist"],
                    LibraryAlbum.name == data["name"],
                ),
                LibraryAlbum.entity_uid == entity_uid,
            ),
        )
        .order_by(LibraryAlbum.id)
        .limit(2)
    ).all()
    if not rows:
        return None
    conflict = rows[0]
    if (
        len(rows) > 1
        or conflict.quarantined_at is not None
        or indexed_path_is_live(conflict.path)
    ):
        raise LibraryAlbumIdentityConflict(
            path=data["path"],
            existing_album_id=int(conflict.id),
            existing_path=conflict.path,
        )
    return conflict


def upsert_album(
    data: dict,
    *,
    session: Session | None = None,
    indexed_path_is_live: Callable[[str], bool] | None = None,
) -> int:
    """Insert or update the album indexed at ``data["path"]``; return its id.

    A filesystem scan passes ``indexed_path_is_live`` to resolve a new path
    whose artist and name, or entity UID, already belong to another row: that
    row is moved here when its indexed folder no longer holds audio, and
    ``LibraryAlbumIdentityConflict`` is raised while it still does. Without it
    such an insert fails on the unique constraints.
    """
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_entity_uid = coerce_uuid_or_none(data.get("entity_uid"))
        path_match = LibraryAlbum.path == data["path"]
        entity_match = (
            LibraryAlbum.entity_uid == requested_entity_uid
            if requested_entity_uid is not None
            else false()
        )
        requested_mbid = (data.get("musicbrainz_albumid") or "").strip()
        requested_rgid = (data.get("musicbrainz_releasegroupid") or "").strip()
        requested_primary_type = (
            str(data.get("release_group_primary_type") or "").strip() or None
        )
        requested_secondary_types = [
            str(value).strip()
            for value in (data.get("release_group_secondary_types") or [])
            if str(value).strip()
        ]
        requested_release_date = normalize_release_date(data.get("release_date"))
        existing_columns = (
            LibraryAlbum.id,
            LibraryAlbum.slug,
            LibraryAlbum.storage_id,
            LibraryAlbum.entity_uid,
            LibraryAlbum.musicbrainz_albumid,
            LibraryAlbum.musicbrainz_releasegroupid,
            LibraryAlbum.tag_album,
        )
        existing = s.execute(
            select(*existing_columns).where(path_match).limit(1)
        ).first()
        if existing is None and requested_entity_uid is not None:
            existing = s.execute(
                select(*existing_columns).where(entity_match).limit(1)
            ).first()
        if (
            existing is None
            and requested_entity_uid is None
            and (requested_mbid or requested_rgid)
        ):
            existing = s.execute(
                select(*existing_columns)
                .where(
                    or_(
                        LibraryAlbum.musicbrainz_albumid == requested_mbid
                        if requested_mbid
                        else false(),
                        LibraryAlbum.musicbrainz_releasegroupid == requested_rgid
                        if requested_rgid
                        else false(),
                    )
                )
                .limit(1)
            ).first()
        elif existing is None and requested_mbid:
            existing = s.execute(
                select(*existing_columns)
                .where(
                    LibraryAlbum.musicbrainz_albumid == requested_mbid,
                    func.lower(LibraryAlbum.name) == str(data["name"]).lower(),
                )
                .limit(1)
            ).first()
        artist_entity_uid = s.execute(
            select(LibraryArtist.entity_uid)
            .where(LibraryArtist.name == data["artist"])
            .limit(1)
        ).scalar_one_or_none()
        candidate_entity_uid = requested_entity_uid or album_entity_uid(
            artist_name=data["artist"],
            artist_uid=artist_entity_uid,
            album_name=data["name"],
            year=data.get("year"),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            musicbrainz_releasegroupid=data.get("musicbrainz_releasegroupid"),
            tag_album=data.get("tag_album"),
        )
        if existing is None and indexed_path_is_live is not None:
            existing = _adopt_moved_album(
                s,
                data,
                candidate_entity_uid,
                existing_columns,
                indexed_path_is_live,
            )
        slug = (
            existing[1]
            if existing and existing[1]
            else allocate_unique_slug(
                s, LibraryAlbum, build_album_slug(data["artist"], data["name"])
            )
        )
        requested_storage_id = coerce_uuid_or_none(data.get("storage_id"))
        requested_tag_album = data.get("tag_album")
        entity_uid = existing[3] if existing and existing[3] else candidate_entity_uid
        storage_id = existing[2] if existing and existing[2] else requested_storage_id
        if existing:
            album_id = int(existing[0])
            existing_album_mbid = existing[4]
            existing_releasegroupid = existing[5]
            existing_tag_album = existing[6]
            s.execute(
                update(LibraryAlbum)
                .where(LibraryAlbum.id == album_id)
                .values(
                    storage_id=storage_id,
                    entity_uid=entity_uid,
                    artist=data["artist"],
                    name=data["name"],
                    slug=slug,
                    path=data["path"],
                    track_count=data.get("track_count", 0),
                    total_size=data.get("total_size", 0),
                    total_duration=data.get("total_duration", 0),
                    formats_json=list(data.get("formats", [])),
                    year=data.get("year"),
                    genre=data.get("genre"),
                    has_cover=data.get("has_cover", 0),
                    musicbrainz_albumid=requested_mbid or existing_album_mbid,
                    musicbrainz_releasegroupid=requested_rgid
                    or existing_releasegroupid,
                    release_group_primary_type=requested_primary_type
                    or LibraryAlbum.release_group_primary_type,
                    release_group_secondary_types=(
                        requested_secondary_types
                        if "release_group_secondary_types" in data
                        else LibraryAlbum.release_group_secondary_types
                    ),
                    release_date=requested_release_date or LibraryAlbum.release_date,
                    tag_album=requested_tag_album
                    if requested_tag_album is not None
                    else existing_tag_album,
                    dir_mtime=data.get("dir_mtime"),
                    updated_at=now,
                )
            )
            upsert_entity_identity_key(
                s,
                entity_type="album",
                entity_uid=entity_uid,
                key_type="scoped_name",
                key_value=f"{data['artist']}::{data['name']}",
                is_primary=True,
            )
            upsert_entity_identity_key(
                s,
                entity_type="album",
                entity_uid=entity_uid,
                key_type="slug",
                key_value=slug,
                is_primary=True,
            )
            if requested_mbid:
                upsert_entity_identity_key(
                    s,
                    entity_type="album",
                    entity_uid=entity_uid,
                    key_type="musicbrainz_albumid",
                    key_value=requested_mbid,
                )
            if requested_rgid:
                upsert_entity_identity_key(
                    s,
                    entity_type="album",
                    entity_uid=entity_uid,
                    key_type="musicbrainz_releasegroupid",
                    key_value=requested_rgid,
                )
            enqueue_local_dirty_source("album", str(entity_uid), "upsert", session=s)
            return album_id
        insert_stmt = pg_insert(LibraryAlbum).values(
            storage_id=storage_id,
            entity_uid=entity_uid,
            artist=data["artist"],
            name=data["name"],
            slug=slug,
            path=data["path"],
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            total_duration=data.get("total_duration", 0),
            formats_json=list(data.get("formats", [])),
            year=data.get("year"),
            genre=data.get("genre"),
            has_cover=data.get("has_cover", 0),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            musicbrainz_releasegroupid=data.get("musicbrainz_releasegroupid"),
            release_group_primary_type=requested_primary_type,
            release_group_secondary_types=requested_secondary_types,
            release_date=requested_release_date,
            tag_album=data.get("tag_album"),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryAlbum.path],
                set_={
                    "storage_id": func.coalesce(
                        LibraryAlbum.storage_id, insert_stmt.excluded.storage_id
                    ),
                    "entity_uid": func.coalesce(
                        LibraryAlbum.entity_uid, insert_stmt.excluded.entity_uid
                    ),
                    "artist": insert_stmt.excluded.artist,
                    "name": insert_stmt.excluded.name,
                    "slug": func.coalesce(LibraryAlbum.slug, insert_stmt.excluded.slug),
                    "track_count": insert_stmt.excluded.track_count,
                    "total_size": insert_stmt.excluded.total_size,
                    "total_duration": insert_stmt.excluded.total_duration,
                    "formats_json": insert_stmt.excluded.formats_json,
                    "year": insert_stmt.excluded.year,
                    "genre": insert_stmt.excluded.genre,
                    "has_cover": insert_stmt.excluded.has_cover,
                    "musicbrainz_albumid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_albumid, ""),
                        LibraryAlbum.musicbrainz_albumid,
                    ),
                    "musicbrainz_releasegroupid": func.coalesce(
                        func.nullif(
                            insert_stmt.excluded.musicbrainz_releasegroupid, ""
                        ),
                        LibraryAlbum.musicbrainz_releasegroupid,
                    ),
                    "release_group_primary_type": func.coalesce(
                        insert_stmt.excluded.release_group_primary_type,
                        LibraryAlbum.release_group_primary_type,
                    ),
                    "release_group_secondary_types": (
                        insert_stmt.excluded.release_group_secondary_types
                        if "release_group_secondary_types" in data
                        else LibraryAlbum.release_group_secondary_types
                    ),
                    "release_date": func.coalesce(
                        func.nullif(insert_stmt.excluded.release_date, ""),
                        LibraryAlbum.release_date,
                    ),
                    "tag_album": func.coalesce(
                        insert_stmt.excluded.tag_album, LibraryAlbum.tag_album
                    ),
                    "dir_mtime": insert_stmt.excluded.dir_mtime,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )
        upsert_entity_identity_key(
            s,
            entity_type="album",
            entity_uid=entity_uid,
            key_type="scoped_name",
            key_value=f"{data['artist']}::{data['name']}",
            is_primary=True,
        )
        upsert_entity_identity_key(
            s,
            entity_type="album",
            entity_uid=entity_uid,
            key_type="slug",
            key_value=slug,
            is_primary=True,
        )
        if requested_mbid:
            upsert_entity_identity_key(
                s,
                entity_type="album",
                entity_uid=entity_uid,
                key_type="musicbrainz_albumid",
                key_value=requested_mbid,
            )
        if requested_rgid:
            upsert_entity_identity_key(
                s,
                entity_type="album",
                entity_uid=entity_uid,
                key_type="musicbrainz_releasegroupid",
                key_value=requested_rgid,
            )
        enqueue_local_dirty_source("album", str(entity_uid), "upsert", session=s)
        row = s.execute(
            select(LibraryAlbum.id).where(LibraryAlbum.path == data["path"]).limit(1)
        ).scalar_one()
        return int(row)


__all__ = ["LibraryAlbumIdentityConflict", "upsert_album"]
