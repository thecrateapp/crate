"""Canonical source manifests and exact transactional library repairs."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from typing import Literal, cast

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import optional_scope, read_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale

_ARTIST = {"stale_artists", "zombie_artists", "has_photo_desync"}
_TRACK = {"fk_orphan_tracks", "stale_tracks", "tag_mismatch"}
_DELETES = {
    "fk_orphan_albums",
    "fk_orphan_tracks",
    "stale_artists",
    "stale_albums",
    "stale_tracks",
    "zombie_artists",
    "duplicate_tracks",
    "shadow_quality_tracks",
}


def repair_source_version(source: dict) -> str:
    return hashlib.sha256(
        json.dumps(source, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _rows(
    current, table: str, where: str, params: dict, *, locked: bool, limit=200
) -> list[dict]:
    # SQL_SAFE: table/where are internal constants or validated PostgreSQL FK metadata.
    rows = list(
        current.execute(
            text(
                f"SELECT to_jsonb(e) FROM {table} e WHERE {where} LIMIT {limit + 1}"
                + (" FOR UPDATE" if locked else "")
            ),
            params,
        ).scalars()
    )
    if len(rows) > limit:
        raise ValueError(
            "Repair source exceeds its bounded manifest; narrow or review manually"
        )
    return sorted(rows, key=lambda row: json.dumps(row, sort_keys=True, default=str))


def _load(current, issue_id: int, *, locked: bool) -> dict:
    issue = current.execute(
        text(
            "SELECT to_jsonb(i) FROM health_issues i WHERE id=:id AND status='open'"
            + (" FOR UPDATE" if locked else "")
        ),
        {"id": issue_id},
    ).scalar_one_or_none()
    if issue is None:
        raise ValueError("Repair issue is missing or no longer open")
    check = issue["check_type"]
    details = issue.get("details_json") or {}
    artists, albums, tracks = [], [], []
    if check in _ARTIST:
        artists = _rows(
            current,
            "library_artists",
            "id=:id" if issue.get("artist_id") else "name=:name",
            {"id": issue.get("artist_id"), "name": details.get("artist")},
            locked=locked,
        )
        if artists and check != "has_photo_desync":
            albums = _rows(
                current,
                "library_albums",
                "LOWER(artist)=LOWER(:name)"
                if check == "zombie_artists"
                else "artist=:name",
                {"name": artists[0]["name"]},
                locked=locked,
            )
            tracks = _rows(
                current,
                "library_tracks",
                "LOWER(artist)=LOWER(:name) OR album_id=ANY(:ids)"
                if check == "zombie_artists"
                else "artist=:name OR album_id=ANY(:ids)",
                {"name": artists[0]["name"], "ids": [a["id"] for a in albums]},
                locked=locked,
            )
    elif check in _TRACK:
        tracks = _rows(
            current,
            "library_tracks",
            "path=:path",
            {"path": details.get("track_path")},
            locked=locked,
        )
        if tracks and tracks[0].get("album_id") is not None:
            albums = _rows(
                current,
                "library_albums",
                "id=:id",
                {"id": tracks[0]["album_id"]},
                locked=locked,
            )
    elif check in {"fk_orphan_albums", "stale_albums"}:
        albums = _rows(
            current,
            "library_albums",
            "id=:id" if issue.get("album_id") else "path=:path",
            {"id": issue.get("album_id"), "path": details.get("path")},
            locked=locked,
        )
        if albums:
            tracks = _rows(
                current,
                "library_tracks",
                "album_id=:id",
                {"id": albums[0]["id"]},
                locked=locked,
            )
            if check == "fk_orphan_albums":
                artists = _rows(
                    current,
                    "library_artists",
                    "LOWER(name)=LOWER(:name)",
                    {"name": albums[0]["artist"]},
                    locked=locked,
                )
    elif check == "duplicate_albums":
        copies = details.get("copies") or []
        ids = [copy.get("album_id") for copy in copies if isinstance(copy, dict)]
        if (
            not 2 <= len(ids) <= 20
            or any(type(value) is not int for value in ids)
            or len(set(ids)) != len(ids)
        ):
            raise ValueError(
                "Legacy duplicate album folders require manual classification"
            )
        albums = _rows(
            current, "library_albums", "id=ANY(:ids)", {"ids": ids}, locked=locked
        )
        if len(albums) != len(ids):
            raise ValueError("Duplicate album membership changed")
        tracks = _rows(
            current, "library_tracks", "album_id=ANY(:ids)", {"ids": ids}, locked=locked
        )
    elif check in {"duplicate_tracks", "shadow_quality_tracks"}:
        paths = details.get("paths") or []
        if (
            not isinstance(paths, list)
            or not (2 if check == "duplicate_tracks" else 1) <= len(paths) <= 20
            or any(not isinstance(path, str) for path in paths)
            or len(set(paths)) != len(paths)
        ):
            raise ValueError("Invalid duplicate track selection")
        tracks = _rows(
            current,
            "library_tracks",
            "path=ANY(:paths)",
            {"paths": paths},
            locked=locked,
        )
        if len(tracks) != len(set(paths)):
            raise ValueError("Duplicate track membership changed")
        ids = {t["album_id"] for t in tracks if t.get("album_id") is not None}
        albums = _rows(
            current, "library_albums", "id=ANY(:ids)", {"ids": list(ids)}, locked=locked
        )
        if check == "shadow_quality_tracks" and albums:
            tracks = _rows(
                current,
                "library_tracks",
                "album_id=ANY(:ids)",
                {"ids": list(ids)},
                locked=locked,
            )
    if albums and check not in _ARTIST and check != "fk_orphan_albums":
        artists = _rows(
            current,
            "library_artists",
            "name=ANY(:names)",
            {"names": list({album["artist"] for album in albums})},
            locked=locked,
        )
    locks = []
    for kind, rows in (("artist", artists), ("album", albums), ("track", tracks)):
        if rows:
            locks.extend(
                _rows(
                    current,
                    "library_field_locks",
                    "entity_type=:kind AND entity_id=ANY(:ids)",
                    {"kind": kind, "ids": [row["id"] for row in rows]},
                    locked=locked,
                )
            )
    dependents = []
    if check in _DELETES:
        references = current.execute(
            text("""SELECT ns.nspname AS schema, c.relname AS table_name, a.attname AS column_name,
            p.relname AS parent_table, pa.attname AS parent_column, co.confdeltype AS on_delete
            FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
            JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_class p ON p.oid=co.confrelid
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=co.conkey[1]
            JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=co.confkey[1]
            WHERE co.contype='f' AND cardinality(co.conkey)=1
              AND co.confrelid IN ('library_artists'::regclass,'library_albums'::regclass,'library_tracks'::regclass)
            ORDER BY ns.nspname,c.relname,a.attname""")
        ).mappings()
        parents = {
            "library_artists": artists,
            "library_albums": albums if check not in _TRACK else [],
            "library_tracks": tracks,
        }
        for reference in references:
            if reference["table_name"] in {
                "library_artists",
                "library_albums",
                "library_tracks",
            }:
                continue
            values = [
                row[reference["parent_column"]]
                for row in parents[reference["parent_table"]]
            ]
            if not values:
                continue
            names = [
                reference["schema"],
                reference["table_name"],
                reference["column_name"],
            ]
            if any(
                not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", value) for value in names
            ):
                raise ValueError("Unsupported dependent relation")
            table = f'"{names[0]}"."{names[1]}"'
            rows = _rows(
                current,
                table,
                f'"{names[2]}"=ANY(:values)',
                {"values": values},
                locked=locked,
            )
            dependents.append({**dict(reference), "rows": rows})
    return {
        "issue": issue,
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "locks": locks,
        "dependents": dependents,
    }


def read_repair_source(issue_id: int, *, session=None) -> dict:
    if type(issue_id) is not int or issue_id < 1:
        raise ValueError("A repair requires a positive canonical issue ID")
    if session is not None:
        return _load(session, issue_id, locked=False)
    with read_scope() as current:
        return _load(current, issue_id, locked=False)


def _deleted_rows(source: dict, item: dict) -> dict:
    action = item["action"]
    albums = source["albums"] if action in {"delete_artist", "delete_album"} else []
    album_ids = {album["id"] for album in albums}
    tracks = (
        [track for track in source["tracks"] if track.get("album_id") in album_ids]
        if albums
        else []
    )
    if action in {"delete_track", "quarantine_tracks"}:
        tracks = [
            track for track in source["tracks"] if track["id"] in item["drop_ids"]
        ]
    return {
        "artist": source["artists"] if action == "delete_artist" else [],
        "album": albums,
        "track": tracks,
    }


def apply_repair_item(
    item: dict,
    *,
    check_files: Callable[[], dict],
    task_id: str,
    verify_files: Callable[[], dict] | None = None,
    session=None,
) -> dict:
    with optional_scope(session) as current:
        initial = _load(current, item["issue_id"], locked=False)
        if repair_source_version(initial) != item["database_version"]:
            return {"status": "conflict", "code": "SOURCE_CHANGED"}
        for table, rows in (
            ("library_artists", initial["artists"]),
            ("library_albums", initial["albums"]),
            ("library_tracks", initial["tracks"]),
        ):
            if rows:
                current.execute(
                    text(
                        f"SELECT id FROM {table} WHERE id=ANY(:ids) ORDER BY id FOR UPDATE"
                    ),
                    {"ids": [row["id"] for row in rows]},
                ).all()
        source = _load(current, item["issue_id"], locked=True)
        if repair_source_version(source) != item["database_version"]:
            return {"status": "conflict", "code": "SOURCE_CHANGED"}
        evidence = check_files()
        if evidence["status"] != "passed":
            return evidence
        action = item["action"]
        deleted = _deleted_rows(source, item)
        deleted_artists, deleted_albums, deleted_tracks = (
            deleted["artist"],
            deleted["album"],
            deleted["track"],
        )
        if deleted_tracks:
            current.execute(
                text("DELETE FROM library_tracks WHERE id=ANY(:ids)"),
                {"ids": [t["id"] for t in deleted_tracks]},
            )
        if deleted_albums:
            current.execute(
                text("DELETE FROM library_albums WHERE id=ANY(:ids)"),
                {"ids": [a["id"] for a in deleted_albums]},
            )
        if deleted_artists:
            current.execute(
                text("DELETE FROM library_artists WHERE id=ANY(:ids)"),
                {"ids": [a["id"] for a in deleted_artists]},
            )
        if action == "reassign_album":
            current.execute(
                text(
                    "UPDATE library_albums SET artist=:artist,updated_at=NOW() WHERE id=:id"
                ),
                {"artist": item["new_artist"], "id": source["albums"][0]["id"]},
            )
        elif action == "update_track_artist":
            current.execute(
                text(
                    "UPDATE library_tracks SET artist=:artist,updated_at=NOW() WHERE id=:id"
                ),
                {"artist": item["new_artist"], "id": source["tracks"][0]["id"]},
            )
        elif action == "photo_flag":
            current.execute(
                text(
                    "UPDATE library_artists SET has_photo=:photo,updated_at=NOW() WHERE id=:id"
                ),
                {
                    "photo": int(item["photo"]["fs_has_photo"]),
                    "id": source["artists"][0]["id"],
                },
            )
        elif action == "quarantine_albums":
            current.execute(
                text(
                    "UPDATE library_albums SET quarantined_at=NOW(),quarantine_task_id=:task,updated_at=NOW() WHERE id=ANY(:ids)"
                ),
                {"task": task_id, "ids": item["drop_ids"]},
            )
        affected_album_ids = [
            album["id"]
            for album in source["albums"]
            if album["id"] not in {row["id"] for row in deleted_albums}
        ]
        if deleted_tracks and affected_album_ids:
            current.execute(
                text("""WITH stats AS (
                SELECT a.id,COUNT(t.id) AS tracks,COALESCE(SUM(t.size),0) AS size,
                    COALESCE(SUM(t.duration),0) AS duration,
                    COALESCE(jsonb_agg(DISTINCT t.format) FILTER(WHERE t.format IS NOT NULL),'[]'::jsonb) AS formats
                FROM library_albums a LEFT JOIN library_tracks t ON t.album_id=a.id
                WHERE a.id=ANY(:ids) GROUP BY a.id)
                UPDATE library_albums a SET track_count=s.tracks,total_size=s.size,total_duration=s.duration,
                    formats_json=s.formats,updated_at=NOW() FROM stats s WHERE a.id=s.id"""),
                {"ids": affected_album_ids},
            )
        remaining_artists = [
            artist
            for artist in source["artists"]
            if artist["id"] not in {row["id"] for row in deleted_artists}
        ]
        if (
            deleted_tracks
            or deleted_albums
            or action in {"quarantine_albums", "reassign_album"}
        ) and remaining_artists:
            current.execute(
                text("""WITH stats AS (
                SELECT a.name,COUNT(b.id) AS albums,COALESCE(SUM(b.track_count),0) AS tracks,
                    COALESCE(SUM(b.total_size),0) AS size
                FROM library_artists a LEFT JOIN library_albums b ON b.artist=a.name AND b.quarantined_at IS NULL
                WHERE a.id=ANY(:ids) GROUP BY a.name)
                UPDATE library_artists a SET album_count=s.albums,track_count=s.tracks,total_size=s.size,
                    formats_json=(SELECT COALESCE(jsonb_agg(DISTINCT f.value),'[]'::jsonb) FROM library_albums b
                        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.formats_json::jsonb,'[]'::jsonb)) f
                        WHERE b.artist=a.name AND b.quarantined_at IS NULL),
                    primary_format=(SELECT f.value FROM library_albums b
                        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.formats_json::jsonb,'[]'::jsonb)) f
                        WHERE b.artist=a.name AND b.quarantined_at IS NULL GROUP BY f.value ORDER BY COUNT(*) DESC,f.value LIMIT 1),updated_at=NOW()
                FROM stats s WHERE a.name=s.name"""),
                {"ids": [artist["id"] for artist in remaining_artists]},
            )
        for kind, rows in deleted.items():
            for row in rows:
                enqueue_local_dirty_source(
                    cast(Literal["artist", "album", "track"], kind),
                    row["entity_uid"],
                    "delete",
                    session=current,
                )
            if rows:
                current.execute(
                    text(
                        "DELETE FROM library_field_locks WHERE entity_type=:kind AND entity_id=ANY(:ids)"
                    ),
                    {"kind": kind, "ids": [row["id"] for row in rows]},
                )
        if not any(deleted.values()):
            for target in item["targets"]:
                enqueue_local_dirty_source(
                    target["entity_type"],
                    target["entity_uid"],
                    "upsert",
                    session=current,
                )
        else:
            for artist in remaining_artists:
                enqueue_local_dirty_source(
                    "artist", artist["entity_uid"], "upsert", session=current
                )
            for album in source["albums"]:
                if album["id"] in affected_album_ids:
                    enqueue_local_dirty_source(
                        "album", album["entity_uid"], "upsert", session=current
                    )
        verified = True
        for table, rows in (
            ("library_artists", deleted_artists),
            ("library_albums", deleted_albums),
            ("library_tracks", deleted_tracks),
        ):
            if rows:
                verified = verified and not _rows(
                    current,
                    table,
                    "id=ANY(:ids)",
                    {"ids": [row["id"] for row in rows]},
                    locked=False,
                )
        if action == "quarantine_albums":
            verified = verified and not _rows(
                current,
                "library_albums",
                "id=ANY(:ids) AND quarantined_at IS NULL",
                {"ids": item["drop_ids"]},
                locked=False,
            )
        if action in {"reassign_album", "update_track_artist"}:
            table = "library_albums" if action == "reassign_album" else "library_tracks"
            rows = source["albums"] if action == "reassign_album" else source["tracks"]
            verified = verified and bool(
                _rows(
                    current,
                    table,
                    "id=:id AND artist=:artist",
                    {"id": rows[0]["id"], "artist": item["new_artist"]},
                    locked=False,
                )
            )
        if action == "photo_flag":
            verified = verified and bool(
                _rows(
                    current,
                    "library_artists",
                    "id=:id AND has_photo=:photo",
                    {
                        "id": source["artists"][0]["id"],
                        "photo": int(item["photo"]["fs_has_photo"]),
                    },
                    locked=False,
                )
            )
        if verify_files is not None:
            observed = verify_files()
            verified = verified and observed["status"] == "passed"
            evidence["postcondition"] = observed
        if verified:
            current.execute(
                text(
                    "UPDATE health_issues SET status='fixed',resolved_at=NOW() WHERE id=:id"
                ),
                {"id": item["issue_id"]},
            )
        current.execute(
            text(
                "INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json,task_id) VALUES (NOW(),'planned_library_repair','health_issue',:id,CAST(:details AS jsonb),:task)"
            ),
            {
                "id": str(item["issue_id"]),
                "task": task_id,
                "details": json.dumps(
                    {
                        "check": source["issue"]["check_type"],
                        "action": action,
                        "targets": item["targets"],
                        "filesystem": evidence,
                        "verified": verified,
                    },
                    default=str,
                ),
            },
        )
        mark_ui_snapshots_stale(scope="ops:health", session=current)
        append_domain_event(
            "ui.invalidate",
            {"scope": "library"},
            scope="ui.invalidate",
            subject_key=f"repair:{item['issue_id']}",
            session=current,
        )
        return {
            "status": "applied" if verified else "partial",
            "verification": "passed" if verified else "failed",
            "action": action,
            "filesystem": evidence,
        }


def reopen_unverified_repair(issue_id: int, task_id: str, *, session=None) -> None:
    with optional_scope(session) as current:
        current.execute(
            text("""UPDATE health_issues i SET status='open',resolved_at=NULL
            WHERE i.id=:id AND i.status='fixed'
              AND EXISTS(SELECT 1 FROM audit_log a WHERE a.task_id=:task AND a.action='planned_library_repair' AND a.target_name=CAST(:id AS text))
              AND NOT EXISTS(SELECT 1 FROM health_issues other WHERE other.status='open'
                  AND other.check_type=i.check_type AND other.identity_key=i.identity_key)"""),
            {"id": issue_id, "task": task_id},
        )


__all__ = [
    "repair_source_version",
    "read_repair_source",
    "apply_repair_item",
    "reopen_unverified_repair",
]
