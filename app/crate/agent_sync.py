"""Frozen, bounded library-index synchronization plans."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from pathlib import Path

from crate.analysis_provenance import source_identity
from crate.db.queries.agent_sync import (
    list_sync_albums,
    read_sync_state,
    sync_state_version,
)
from crate.db.repositories.agent_sync import apply_sync_album
from crate.entity_ids import track_entity_uid
from crate.library_sync import LibrarySync


def _directory(raw: str, config: dict) -> Path:
    root = Path(config["library_path"]).resolve(strict=True)
    relative = Path(raw)
    if relative.is_absolute():
        if relative.is_relative_to(root):
            relative = relative.relative_to(root)
        elif relative.is_relative_to(Path("/music")):
            relative = relative.relative_to("/music")
        else:
            raise ValueError("Sync source is outside the library")
    if not relative.parts or any(
        p == ".." or p.startswith(".") for p in relative.parts
    ):
        raise ValueError("Invalid sync source")
    candidate = root
    for component in relative.parts:
        candidate = candidate / component
        if candidate.is_symlink():
            raise ValueError("Sync does not follow symbolic links")
    if not candidate.is_dir() or not candidate.resolve().is_relative_to(root):
        raise ValueError("Sync source directory is unavailable")
    return candidate


def _manifest(directory: Path) -> dict:
    entries = []
    pending = [directory]
    while pending:
        parent = pending.pop()
        with os.scandir(parent) as children:
            for child in sorted(children, key=lambda entry: entry.name):
                if child.is_symlink():
                    raise ValueError("Sync does not follow symbolic links")
                path = Path(child.path)
                if child.is_dir(follow_symlinks=False):
                    pending.append(path)
                    entries.append(
                        {
                            "path": str(path.relative_to(directory)),
                            "directory": True,
                            "mtime_ns": child.stat(follow_symlinks=False).st_mtime_ns,
                        }
                    )
                elif child.is_file(follow_symlinks=False):
                    entries.append(
                        {
                            **source_identity(str(path)),
                            "path": str(path.relative_to(directory)),
                        }
                    )
                else:
                    raise ValueError("Unsupported library entry")
                if len(entries) > 5000:
                    raise ValueError("Sync album exceeds 5000 filesystem entries")
    entries.sort(key=lambda entry: entry["path"])
    return {
        "version": hashlib.sha256(
            json.dumps(entries, sort_keys=True).encode()
        ).hexdigest(),
        "entries": entries,
    }


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation != "library_sync" or set(parameters) - {
        "scope",
        "entity_uid",
        "limit",
    }:
        raise ValueError("Unsupported sync parameters")
    scope = parameters.get("scope", "album")
    limit = parameters.get("limit", 20)
    if scope == "global" and "limit" not in parameters:
        raise ValueError("Global sync requires an explicit album limit")
    albums = list_sync_albums(scope, parameters.get("entity_uid"), limit=limit)
    sync = LibrarySync(config)
    executions = []
    changes = []
    targets = {}
    total_tracks = 0
    for album in albums:
        uid = album["entity_uid"]
        state = read_sync_state(uid)
        directory = _directory(album["path"], config)
        manifest = _manifest(directory)
        prepared = sync.prepare_album_sync(directory, album["artist"])
        if prepared.get("has_cover"):
            from crate.artwork_sources import freeze_album_artwork_source

            prepared["artwork_source"] = freeze_album_artwork_source(
                directory, sync.extensions
            )
        if _manifest(directory) != manifest:
            raise ValueError("Sync source changed while preparing the plan")
        targets[("album", uid)] = {"entity_type": "album", "entity_uid": uid}
        targets[("artist", album["artist_uid"])] = {
            "entity_type": "artist",
            "entity_uid": album["artist_uid"],
        }
        if not prepared.get("skipped"):
            prepared["album_payload"]["path"] = album["path"]
            prepared["album_payload"]["entity_uid"] = uid
            existing = {t["path"]: t for t in state["tracks"]}
            aliases = {
                "date": "year",
                "tracknumber": "track_number",
                "discnumber": "disc_number",
            }
            for field_lock in state.get("locks", []):
                if field_lock["entity_type"] == "album":
                    field = {"album": "tag_album", **aliases}.get(
                        field_lock["field_name"], field_lock["field_name"]
                    )
                    if field in prepared["album_payload"]:
                        prepared["album_payload"][field] = state["album"].get(field)
            for track in prepared["track_payloads"]:
                relative = Path(track["path"]).relative_to(directory)
                track["path"] = str(Path(album["path"]) / relative)
                before = existing.get(track["path"])
                if before:
                    for field_lock in state.get("locks", []):
                        if (
                            field_lock["entity_type"] == "track"
                            and field_lock["entity_id"] == before["id"]
                        ):
                            field = aliases.get(
                                field_lock["field_name"], field_lock["field_name"]
                            )
                            if field in track:
                                track[field] = before.get(field)
                track["entity_uid"] = (
                    str(before["entity_uid"])
                    if before and before["entity_uid"]
                    else str(
                        track.get("entity_uid")
                        or track_entity_uid(
                            album_uid=uid,
                            artist_name=track["artist"],
                            album_name=track["album"],
                            title=track.get("title"),
                            filename=track["filename"],
                            disc_number=track.get("disc_number"),
                            track_number=track.get("track_number"),
                        )
                    )
                )
                targets[("track", track["entity_uid"])] = {
                    "entity_type": "track",
                    "entity_uid": track["entity_uid"],
                }
                fields = {
                    k: v
                    for k, v in track.items()
                    # Keep the frozen apply payload (``track``, part of
                    # ``prepared["track_payloads"]``) intact so applying the plan
                    # still marks stale Smart Mix profiles; only the preview
                    # drops these: raw paths/fingerprints are redundant with
                    # other preview fields, and smart_mix_source_revision is an
                    # opaque sha256 that always reads null -> <sha256> and adds
                    # ~130 bytes/track against the plan size limit.
                    if k
                    not in {
                        "path",
                        "audio_fingerprint",
                        "audio_fingerprint_source",
                        "smart_mix_source_revision",
                    }
                }
                changes.append(
                    {
                        "entity_uid": track["entity_uid"],
                        "action": "update_index" if before else "add_index",
                        "relative_path": str(relative),
                        "before": {k: before.get(k) for k in fields}
                        if before
                        else None,
                        "after": fields,
                    }
                )
            paths = {t["path"] for t in prepared["track_payloads"]}
            for track in state["tracks"]:
                targets[("track", str(track["entity_uid"]))] = {
                    "entity_type": "track",
                    "entity_uid": str(track["entity_uid"]),
                }
                if track["path"] not in paths:
                    changes.append(
                        {
                            "entity_uid": str(track["entity_uid"]),
                            "action": "remove_index",
                            "before": {"title": track.get("title")},
                            "after": None,
                        }
                    )
            total_tracks += len(prepared["track_payloads"])
            if total_tracks > 5000:
                raise ValueError("Sync plan exceeds 5000 tracks")
        else:
            changes.append(
                {"entity_uid": uid, "action": "skip", "reason": prepared["skipped"]}
            )
        executions.append(
            {
                "entity_uid": uid,
                "path": album["path"],
                "database_version": sync_state_version(state),
                "manifest": manifest,
                "prepared": prepared,
            }
        )
    deletes = sum(change["action"] == "remove_index" for change in changes)
    return {
        "document": {
            "operation": operation,
            "targets": list(targets.values()),
            "source_versions": {
                "albums": [
                    {
                        "entity_uid": a["entity_uid"],
                        "database": a["database_version"],
                        "filesystem": a["manifest"]["version"],
                    }
                    for a in executions
                ]
            },
            "changes": changes,
            "impact": {
                "database": True,
                "filesystem": False,
                "scope": scope,
                "indexed_albums_only": True,
                "new_album_discovery": False,
                "albums": len(executions),
                "tracks": total_tracks,
                "removed_indexes": deletes,
                "refreshes_artist_summary": True,
                "artwork_materialization": "album-cover when present",
                "enrichment": False,
                "preserves_field_locks": True,
                "filesystem_precondition": "device/inode/size/mtime/ctime manifest",
            },
            "risk": "destructive" if deletes else "caution",
            "reversibility": "removed indexes can affect references; rescan does not restore deleted references",
        },
        "execution": {"scope": scope, "albums": executions},
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize: Callable
) -> dict:
    if operation != "library_sync":
        raise ValueError("Unsupported sync operation")
    results = []
    for album in execution["albums"]:
        authorize()

        def validate_source(album=album):
            return _manifest(_directory(album["path"], config)) == album["manifest"]

        try:
            result = authorize(
                lambda: apply_sync_album(
                    album["entity_uid"],
                    expected_version=album["database_version"],
                    prepared=album["prepared"],
                    validate_source=validate_source,
                    operator_task_id=task_id
                    if execution.get("operator_provenance")
                    else None,
                )
            )
        except (ValueError, OSError):
            result = {
                "entity_uid": album["entity_uid"],
                "status": "conflict",
                "code": "SOURCE_CHANGED",
            }
        results.append(result)
    failed = any(r["status"] not in {"applied", "skipped"} for r in results)
    status = (
        "partial"
        if failed and any(r["status"] == "applied" for r in results)
        else "conflict"
        if failed
        else "completed"
    )
    return {
        "execution": {"status": status, "items": results},
        "verification": {
            "status": "passed" if not failed else "failed",
            "items": [
                {
                    "entity_uid": r["entity_uid"],
                    "status": "passed"
                    if r["status"] in {"applied", "skipped"}
                    else r["status"],
                }
                for r in results
            ],
        },
    }


__all__ = ["apply_operation", "compile_operation"]
