"""Explicit album sets and identity-bound source versions for library sync."""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from sqlalchemy import text

from crate.db.tx import read_scope


def sync_state_version(state: dict) -> str:
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, default=str).encode()
    ).hexdigest()


def list_sync_albums(
    scope: str, entity_uid: str | None, *, limit: int, session=None
) -> list[dict]:
    if (
        scope not in {"album", "artist", "global"}
        or type(limit) is not int
        or not 1 <= limit <= 100
    ):
        raise ValueError("Invalid sync scope or limit")
    if scope != "global":
        entity_uid = str(UUID(str(entity_uid)))
    elif entity_uid is not None:
        raise ValueError("Global sync does not accept an entity UID")
    condition = (
        "a.entity_uid=CAST(:uid AS uuid)"
        if scope == "album"
        else "r.entity_uid=CAST(:uid AS uuid)"
        if scope == "artist"
        else "TRUE"
    )

    def load(current):
        rows = [
            dict(r)
            for r in current.execute(
                text(
                    f"SELECT a.entity_uid::text AS entity_uid,a.path,a.artist,r.entity_uid::text AS artist_uid FROM library_albums a JOIN library_artists r ON r.name=a.artist WHERE {condition} ORDER BY a.id LIMIT :limit"
                ),
                {"uid": entity_uid, "limit": limit + 1},
            ).mappings()
        ]
        if not rows:
            raise ValueError("Sync scope has no indexed albums")
        if len(rows) > limit:
            raise ValueError("Sync scope exceeds its explicit album limit")
        return rows

    if session is not None:
        return load(session)
    with read_scope() as current:
        return load(current)


def read_sync_state(album_uid: str, *, session=None, locked: bool = False) -> dict:
    uid = str(UUID(str(album_uid)))

    def load(current):
        suffix = " FOR UPDATE" if locked else ""
        album = current.execute(
            text(
                "SELECT to_jsonb(a) FROM library_albums a WHERE entity_uid=CAST(:uid AS uuid)"
                + suffix
            ),
            {"uid": uid},
        ).scalar_one_or_none()
        if album is None:
            raise ValueError("Sync album is not in the library")
        artist = current.execute(
            text(
                "SELECT jsonb_build_object('entity_uid',entity_uid,'name',name,'folder_name',folder_name) FROM library_artists WHERE name=:name"
            ),
            {"name": album["artist"]},
        ).scalar_one()
        tracks = list(
            current.execute(
                text(
                    "SELECT to_jsonb(t) - ARRAY['analysis_state','bliss_state','analysis_completed_at','bliss_computed_at','bpm','audio_key','audio_scale','energy','mood_json','danceability','valence','acousticness','instrumentalness','loudness','dynamic_range','spectral_complexity','bliss_vector','bliss_embedding'] FROM library_tracks t WHERE album_id=:id ORDER BY id LIMIT 1001"
                    + suffix
                ),
                {"id": album["id"]},
            ).scalars()
        )
        if len(tracks) > 1000:
            raise ValueError("Sync supports at most 1000 tracks per album")
        locks = list(
            current.execute(
                text("""SELECT to_jsonb(l) FROM library_field_locks l
            WHERE (entity_type='album' AND entity_id=:album)
               OR (entity_type='track' AND entity_id=ANY(:tracks))
            ORDER BY entity_type,entity_id,field_name"""),
                {"album": album["id"], "tracks": [track["id"] for track in tracks]},
            ).scalars()
        )
        return {"album": album, "artist": artist, "tracks": tracks, "locks": locks}

    if session is not None:
        return load(session)
    if locked:
        raise ValueError("Locked sync reads require a transaction")
    with read_scope() as current:
        return load(current)


__all__ = ["list_sync_albums", "read_sync_state", "sync_state_version"]
