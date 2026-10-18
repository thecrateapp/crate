"""Apply frozen scanner payloads without identity retargeting or wider resync."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.queries.agent_sync import read_sync_state, sync_state_version
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.repositories.library_album_upserts import upsert_album
from crate.db.repositories.library_track_upserts import upsert_track
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import optional_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale


def apply_sync_album(
    album_uid: str,
    *,
    expected_version: str,
    prepared: dict,
    validate_source: Callable[[], bool],
    session=None,
) -> dict:
    uid = str(UUID(str(album_uid)))
    with optional_scope(session) as current:
        initial = read_sync_state(uid, session=current)
        # Keep parent updates serialized without blocking centroid FK checks
        # from a bliss writer that already owns one of this album's tracks.
        current.execute(
            text("SELECT name FROM library_artists WHERE name=:name FOR NO KEY UPDATE"),
            {"name": initial["artist"]["name"]},
        ).scalar_one()
        state = read_sync_state(uid, session=current, locked=True)
        if sync_state_version(state) != expected_version or not validate_source():
            return {"entity_uid": uid, "status": "conflict", "code": "SOURCE_CHANGED"}
        if prepared.get("skipped"):
            return {
                "entity_uid": uid,
                "status": "skipped",
                "reason": prepared["skipped"],
            }
        album = state["album"]
        payload = dict(prepared["album_payload"])
        if (
            payload["path"] != album["path"]
            or prepared["artist_payload"]["name"] != album["artist"]
        ):
            raise ValueError("Sync payload does not match approved identity")
        tracks = prepared["track_payloads"]
        paths = [t["path"] for t in tracks]
        if (
            len(paths) != len(set(paths))
            or len(paths) > 1000
            or any(not Path(p).is_relative_to(Path(album["path"])) for p in paths)
        ):
            raise ValueError("Sync payload exceeds the approved album")
        existing = {t["path"]: t for t in state["tracks"]}
        requested = [
            str(UUID(str(t["entity_uid"]))) for t in tracks if t.get("entity_uid")
        ]
        occupied_rows = list(
            current.execute(
                text(
                    "SELECT entity_uid::text AS entity_uid,path,album_id FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[])) OR path=ANY(:paths) ORDER BY id FOR UPDATE"
                ),
                {"uids": requested, "paths": paths},
            ).mappings()
        )
        occupied = {r["entity_uid"]: r["path"] for r in occupied_rows}
        if any(
            row["path"] in paths and row["album_id"] != album["id"]
            for row in occupied_rows
        ):
            return {
                "entity_uid": uid,
                "status": "conflict",
                "code": "IDENTITY_CONFLICT",
            }
        for track in tracks:
            requested_uid = str(track.get("entity_uid") or "")
            if requested_uid in occupied and occupied[requested_uid] != track["path"]:
                return {
                    "entity_uid": uid,
                    "status": "conflict",
                    "code": "IDENTITY_CONFLICT",
                }
        payload.update(entity_uid=uid, artist=album["artist"])
        album_id = upsert_album(payload, session=current)
        if album_id != album["id"]:
            raise RuntimeError("Strict sync changed album identity")
        for track in tracks:
            frozen = {**track, "album_id": album_id}
            if track["path"] in existing:
                frozen["entity_uid"] = existing[track["path"]]["entity_uid"]
            upsert_track(frozen, session=current, strict_identity=True)
        removed = [t for t in state["tracks"] if t["path"] not in set(paths)]
        if removed:
            current.execute(
                text(
                    "DELETE FROM library_tracks WHERE id=ANY(:ids) AND album_id=:album"
                ),
                {"ids": [t["id"] for t in removed], "album": album_id},
            )
            for track in removed:
                if track["entity_uid"]:
                    enqueue_local_dirty_source(
                        "track", str(track["entity_uid"]), "delete", session=current
                    )
        all_albums = [
            dict(r)
            for r in current.execute(
                text(
                    "SELECT track_count,total_size,formats_json FROM library_albums WHERE artist=:name AND quarantined_at IS NULL ORDER BY id"
                ),
                {"name": album["artist"]},
            ).mappings()
        ]
        formats = Counter(fmt for a in all_albums for fmt in (a["formats_json"] or []))
        current.execute(
            text(
                "UPDATE library_artists SET album_count=:albums,track_count=:tracks,total_size=:size,formats_json=CAST(:formats AS jsonb),primary_format=:primary,updated_at=NOW() WHERE name=:name"
            ),
            {
                "albums": len(all_albums),
                "tracks": sum(a["track_count"] or 0 for a in all_albums),
                "size": sum(a["total_size"] or 0 for a in all_albums),
                "formats": json.dumps(sorted(formats)),
                "primary": formats.most_common(1)[0][0] if formats else None,
                "name": album["artist"],
            },
        )
        after = read_sync_state(uid, session=current)
        actual = {t["path"]: t for t in after["tracks"]}
        valid = str(after["album"]["entity_uid"]) == uid and set(actual) == set(paths)
        compare_fields = {
            "artist",
            "album",
            "filename",
            "title",
            "track_number",
            "disc_number",
            "format",
            "bitrate",
            "sample_rate",
            "bit_depth",
            "duration",
            "size",
            "year",
            "genre",
            "albumartist",
        }
        for track in tracks:
            valid = valid and str(actual[track["path"]]["entity_uid"]) == str(
                track["entity_uid"]
            )
            valid = valid and all(
                actual[track["path"]].get(field) == track.get(field)
                for field in compare_fields
            )
        if not valid:
            raise RuntimeError("Strict sync postcondition failed")
        if prepared.get("has_cover"):
            create_task_dedup(
                "materialize_artwork_variants",
                {
                    "kind": "album-cover",
                    "entity_key": uid,
                    "reason": "planned-library-sync",
                },
                dedup_key=f"artwork:album-cover:{uid}",
                session=current,
            )
        enqueue_local_dirty_source(
            "artist", str(state["artist"]["entity_uid"]), "upsert", session=current
        )
        append_domain_event(
            "library.changed",
            {"reason": "planned-library-sync", "album_uid": uid},
            session=current,
        )
        mark_ui_snapshots_stale(scope="library", session=current)
        return {
            "entity_uid": uid,
            "status": "applied",
            "tracks": len(paths),
            "removed_tracks": len(removed),
            "verification": "passed",
        }


__all__ = ["apply_sync_album"]
