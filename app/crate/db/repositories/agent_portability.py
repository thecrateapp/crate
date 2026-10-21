"""Bounded portable snapshots and field-level compare-and-set imports."""

import json
from collections import Counter

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.repositories.agent_metadata import metadata_state_version
from crate.db.repositories.field_locks import lock_fields
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import optional_scope, read_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale

IMPORT_FIELDS = {
    "album": {
        "year",
        "genre",
        "musicbrainz_albumid",
        "musicbrainz_releasegroupid",
        "release_group_primary_type",
        "release_group_secondary_types",
        "discogs_master_id",
    },
    "track": {
        "title",
        "artist",
        "album",
        "albumartist",
        "year",
        "genre",
        "track_number",
        "disc_number",
        "musicbrainz_albumid",
        "musicbrainz_trackid",
    },
}
_TABLES = {"album": "library_albums", "track": "library_tracks"}
LOCK_ALIASES = {
    "date": "year",
    "tracknumber": "track_number",
    "discnumber": "disc_number",
}


def read_portability_state(
    album_uids: list[str], *, session=None, locked=False
) -> dict:
    if (
        not album_uids
        or len(album_uids) > 20
        or len(set(album_uids)) != len(album_uids)
    ):
        raise ValueError("Select 1 to 20 unique album UIDs")

    def _read(current):
        suffix = " FOR UPDATE" if locked else ""
        albums = list(
            current.execute(
                text(
                    "SELECT to_jsonb(a) FROM library_albums a WHERE entity_uid=ANY(CAST(:uids AS uuid[])) ORDER BY id"
                    + suffix
                ),
                {"uids": album_uids},
            ).scalars()
        )
        if len(albums) != len(album_uids):
            raise ValueError("Every selected album must exist")
        tracks = list(
            current.execute(
                text(
                    "SELECT to_jsonb(t) FROM library_tracks t WHERE album_id=ANY(:ids) ORDER BY id LIMIT 2001"
                    + suffix
                ),
                {"ids": [a["id"] for a in albums]},
            ).scalars()
        )
        if len(tracks) > 2000 or any(
            count > 100 for count in Counter(t["album_id"] for t in tracks).values()
        ):
            raise ValueError("Portable metadata is limited to 100 tracks per album")
        locks = list(
            current.execute(
                text("""SELECT to_jsonb(l) FROM library_field_locks l
            WHERE (entity_type='album' AND entity_id=ANY(:albums))
               OR (entity_type='track' AND entity_id=ANY(:tracks)) ORDER BY entity_type,entity_id,field_name"""),
                {
                    "albums": [a["id"] for a in albums],
                    "tracks": [t["id"] for t in tracks],
                },
            ).scalars()
        )
        return {"albums": albums, "tracks": tracks, "locks": locks}

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def apply_portability_changes(
    album_uids: list[str],
    expected_version: str,
    changes: list[dict],
    *,
    task_id: str,
    session=None,
) -> dict:
    with optional_scope(session) as current:
        state = read_portability_state(album_uids, session=current, locked=True)
        if metadata_state_version(state) != expected_version:
            return {"status": "conflict", "code": "SOURCE_CHANGED", "items": []}
        entities = {("album", str(a["entity_uid"])): a for a in state["albums"]}
        entities.update({("track", str(t["entity_uid"])): t for t in state["tracks"]})
        for change in changes:
            kind, uid, field = (
                change["entity_type"],
                change["entity_uid"],
                change["field"],
            )
            if kind not in IMPORT_FIELDS or field not in IMPORT_FIELDS[kind]:
                raise ValueError("Unsupported portable metadata field")
            entity = entities[(kind, uid)]
            if entity.get(field) != change["before"] or any(
                field_lock["entity_type"] == kind
                and field_lock["entity_id"] == entity["id"]
                and LOCK_ALIASES.get(field_lock["field_name"], field_lock["field_name"])
                == field
                for field_lock in state["locks"]
            ):
                raise ValueError("Portable metadata precondition changed")
            # SQL_SAFE: table and field come exclusively from the closed maps above.
            value = (
                "CAST(:value AS jsonb)"
                if field == "release_group_secondary_types"
                else ":value"
            )
            current.execute(
                text(
                    f"UPDATE {_TABLES[kind]} SET {field}={value},updated_at=NOW() WHERE id=:id"
                ),
                {
                    "value": json.dumps(change["after"])
                    if field == "release_group_secondary_types"
                    else change["after"],
                    "id": entity["id"],
                },
            )
            lock_fields(
                entity_type=kind,
                entity_id=entity["id"],
                field_names=[field],
                source="portable_import",
                reason="Approved portable metadata import",
                session=current,
            )
            enqueue_local_dirty_source(kind, uid, "upsert", session=current)
        mark_ui_snapshots_stale(scope="library", session=current)
        append_domain_event(
            "ui.invalidate",
            {"scope": "library"},
            scope="ui.invalidate",
            subject_key="portable_metadata",
            session=current,
        )
        current.execute(
            text(
                "INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json,task_id) VALUES(NOW(),'agent.metadata.rehydrate','library','portable metadata',CAST(:details AS jsonb),:task)"
            ),
            {
                "details": json.dumps(
                    {"fields": len(changes), "source": "portable_import"}
                ),
                "task": task_id,
            },
        )
        return {
            "status": "completed",
            "items": [
                {
                    "entity_type": c["entity_type"],
                    "entity_uid": c["entity_uid"],
                    "field": c["field"],
                    "status": "applied",
                }
                for c in changes
            ],
        }


__all__ = ["IMPORT_FIELDS", "read_portability_state", "apply_portability_changes"]
