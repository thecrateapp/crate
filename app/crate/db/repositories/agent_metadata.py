"""Identity-bound metadata state and transactional worker mutations."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any, Literal, cast

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.repositories.field_locks import lock_fields
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.repositories.library_enrichment_writes import update_artist_metadata
from crate.db.tx import optional_scope, read_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale

_TABLES = {
    "artist": "library_artists",
    "album": "library_albums",
    "track": "library_tracks",
}
_TRACK_FIELDS = {
    "title": "title",
    "artist": "artist",
    "albumartist": "albumartist",
    "album": "album",
    "date": "year",
    "genre": "genre",
    "tracknumber": "track_number",
    "discnumber": "disc_number",
}


def metadata_state_version(state: dict) -> str:
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _load(current, entity_type: str, entity_uid: str, *, locked: bool) -> dict:
    if entity_type not in _TABLES:
        raise ValueError("Unsupported metadata entity type")
    table = _TABLES[entity_type]
    # Serialize parent updates with sync, while allowing the KEY SHARE needed
    # by a concurrent first bliss centroid. Identity changes still conflict.
    if locked and entity_type != "artist":
        parent = (
            "library_albums a"
            if entity_type == "album"
            else "library_tracks t JOIN library_albums a ON a.id=t.album_id"
        )
        target = "a" if entity_type == "album" else "t"
        # SQL_SAFE: parent and target come only from the two constants above.
        current.execute(
            text(
                f"SELECT ar.id FROM {parent} JOIN library_artists ar ON ar.name=a.artist "
                f"WHERE {target}.entity_uid=CAST(:uid AS uuid) FOR NO KEY UPDATE OF ar"
            ),
            {"uid": entity_uid},
        ).all()
    suffix = " FOR UPDATE" if locked else ""
    # SQL_SAFE: table and suffix are selected exclusively from constants above.
    entity = current.execute(
        text(
            f"SELECT to_jsonb(e) FROM {table} e WHERE entity_uid = CAST(:uid AS uuid){suffix}"
        ),
        {"uid": entity_uid},
    ).scalar_one_or_none()
    if entity is None:
        raise ValueError("Metadata target does not exist")
    tracks = []
    if entity_type == "album":
        tracks = list(
            current.execute(
                text(
                    "SELECT to_jsonb(t) FROM library_tracks t WHERE album_id = :id ORDER BY id LIMIT 101"
                    + suffix
                ),
                {"id": entity["id"]},
            ).scalars()
        )
        if len(tracks) > 100:
            raise ValueError("Album metadata is limited to 100 indexed tracks")
    elif entity_type == "track":
        tracks = [entity]
    ids = [entity["id"]] if entity_type == "artist" else [t["id"] for t in tracks]
    lock_type = "artist" if entity_type == "artist" else "track"
    locks = list(
        current.execute(
            text(
                "SELECT to_jsonb(l) FROM library_field_locks l WHERE (entity_type = :kind AND entity_id = ANY(:ids)) OR (:album AND entity_type='album' AND entity_id=:entity_id) ORDER BY entity_type, entity_id, field_name"
            ),
            {
                "kind": lock_type,
                "ids": ids,
                "album": entity_type == "album",
                "entity_id": entity["id"],
            },
        ).scalars()
    )
    genres = []
    if entity_type == "artist":
        genres = list(
            current.execute(
                text(
                    "SELECT g.slug FROM artist_genres ag JOIN genres g ON g.id=ag.genre_id WHERE ag.artist_name=:name AND ag.source='manual' ORDER BY g.slug"
                ),
                {"name": entity["name"]},
            ).scalars()
        )
    return {
        "entity_type": entity_type,
        "entity": entity,
        "tracks": tracks,
        "locks": locks,
        "genres": genres,
    }


def read_metadata_state(entity_type: str, entity_uid: str, *, session=None) -> dict:
    if session is not None:
        return _load(session, entity_type, entity_uid, locked=False)
    with read_scope() as current:
        return _load(current, entity_type, entity_uid, locked=False)


def _refresh_size_totals(current, album_ids: list[int]) -> None:
    if not album_ids:
        return
    albums = list(
        current.execute(
            text(
                "WITH sizes AS ("
                "SELECT a.id, COALESCE(SUM(t.size),0) AS total_size "
                "FROM library_albums a LEFT JOIN library_tracks t ON t.album_id=a.id "
                "WHERE a.id=ANY(:ids) GROUP BY a.id"
                ") UPDATE library_albums a SET total_size=s.total_size,updated_at=NOW() "
                "FROM sizes s WHERE a.id=s.id RETURNING a.artist,a.entity_uid::text AS entity_uid"
            ),
            {"ids": album_ids},
        ).mappings()
    )
    artists = list(
        current.execute(
            text(
                "WITH sizes AS ("
                "SELECT ar.id, COALESCE(SUM(a.total_size),0) AS total_size "
                "FROM library_artists ar LEFT JOIN library_albums a "
                "ON a.artist=ar.name AND a.quarantined_at IS NULL "
                "WHERE ar.name=ANY(:names) GROUP BY ar.id"
                ") UPDATE library_artists ar SET total_size=s.total_size,updated_at=NOW() "
                "FROM sizes s WHERE ar.id=s.id RETURNING ar.entity_uid::text AS entity_uid"
            ),
            {"names": sorted({album["artist"] for album in albums})},
        ).mappings()
    )
    for kind, entities in (("album", albums), ("artist", artists)):
        for entity in entities:
            if entity["entity_uid"]:
                enqueue_local_dirty_source(
                    cast(Literal["album", "artist"], kind),
                    entity["entity_uid"],
                    "upsert",
                    session=current,
                )


def apply_metadata_state(
    entity_type: str,
    entity_uid: str,
    *,
    expected_version: str,
    patch: dict,
    apply_files: Callable[[dict], list[dict]],
    task_id: str,
    actor_user_id: int | None = None,
    session=None,
) -> dict:
    with optional_scope(session) as current:
        state = _load(current, entity_type, entity_uid, locked=True)
        if metadata_state_version(state) != expected_version:
            return {"status": "conflict", "items": [], "code": "SOURCE_CHANGED"}
        if entity_type == "artist":
            result = update_artist_metadata(
                artist_entity_uid=entity_uid,
                metadata=patch,
                locked_by_user_id=actor_user_id,
                session=current,
            )
            if result is None:
                raise ValueError("No supported metadata fields")
            items = [
                {
                    "entity_uid": entity_uid,
                    "status": "applied",
                    "before": result["before"],
                    "after": result["after"],
                }
            ]
        else:
            items = apply_files(state)
            tracks = {str(t["entity_uid"]): t for t in state["tracks"]}
            changed_album_ids = set()
            for item in items:
                if item["status"] != "applied":
                    continue
                track = tracks[item["entity_uid"]]
                if track.get("album_id") is not None:
                    changed_album_ids.add(track["album_id"])
                values: dict[str, Any] = {"id": track["id"], "size": item["size"]}
                assignments = ["size=:size", "updated_at=NOW()"]
                for field, value in item["after"].items():
                    column = _TRACK_FIELDS[field]
                    if field in {"tracknumber", "discnumber"}:
                        value = int(str(value).split("/", 1)[0]) if value else None
                    assignments.append(f"{column}=:{field}")
                    values[field] = value
                # SQL_SAFE: columns derive from the closed tag map above.
                current.execute(
                    text(
                        "UPDATE library_tracks SET "
                        + ", ".join(assignments)
                        + " WHERE id=:id"
                    ),
                    values,
                )
                lock_fields(
                    entity_type="track",
                    entity_id=track["id"],
                    field_names=item["after"],
                    locked_by_user_id=actor_user_id,
                    reason="Planned metadata edit",
                    source="manual_edit",
                    session=current,
                )
                enqueue_local_dirty_source(
                    "track", item["entity_uid"], "upsert", session=current
                )
            if (
                entity_type == "album"
                and items
                and all(i["status"] == "applied" for i in items)
            ):
                updates = {
                    k: v for k, v in patch.items() if k in {"album", "date", "genre"}
                }
                columns = {"album": "tag_album", "date": "year", "genre": "genre"}
                assignments = [f"{columns[k]}=:{k}" for k in updates]
                if assignments:
                    current.execute(
                        text(
                            "UPDATE library_albums SET "
                            + ", ".join(assignments)
                            + ", updated_at=NOW() WHERE id=:id"
                        ),
                        {**updates, "id": state["entity"]["id"]},
                    )
                lock_fields(
                    entity_type="album",
                    entity_id=state["entity"]["id"],
                    field_names=patch,
                    locked_by_user_id=actor_user_id,
                    reason="Planned metadata edit",
                    source="manual_edit",
                    session=current,
                )
            _refresh_size_totals(current, sorted(changed_album_ids))
        enqueue_local_dirty_source(
            cast(Literal["artist", "album", "track"], entity_type),
            entity_uid,
            "upsert",
            session=current,
        )
        current.execute(
            text(
                "INSERT INTO audit_log (timestamp,action,target_type,target_name,details_json,user_id,task_id) VALUES (NOW(),'planned_metadata_update',:kind,:uid,CAST(:details AS jsonb),:actor,:task)"
            ),
            {
                "kind": entity_type,
                "uid": entity_uid,
                "details": json.dumps(
                    {"source": "manual_edit", "items": items}, default=str
                ),
                "actor": actor_user_id,
                "task": task_id,
            },
        )
        mark_ui_snapshots_stale(scope="library", session=current)
        append_domain_event(
            "ui.invalidate",
            {"scope": "library"},
            scope="ui.invalidate",
            subject_key=f"{entity_type}:{entity_uid}",
            session=current,
        )
        failed = sum(i["status"] != "applied" for i in items)
        return {"status": "partial" if failed else "completed", "items": items}


__all__ = ["metadata_state_version", "read_metadata_state", "apply_metadata_state"]
