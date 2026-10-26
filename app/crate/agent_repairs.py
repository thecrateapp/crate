"""Versioned, exact library repair variants executed only by workers."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from crate.agent_metadata import _fingerprint
from crate.artist_photo import observe_artist_photo
from crate.audio import audio_format_rank, read_tags
from crate.db.repositories.agent_repairs import (
    _deleted_rows,
    apply_repair_item,
    read_repair_source,
    repair_source_version,
    reopen_unverified_repair,
)
from crate.repair_contracts import repair_contracts, _overlapping_targets
from crate.db.queries.repair_plans import get_open_repair_issues


def _contained(raw: str, config: dict) -> Path:
    root = Path(config["library_path"]).resolve(strict=True)
    path = Path(raw)
    if path.is_absolute():
        if path.is_relative_to(root):
            path = path.relative_to(root)
        elif path.is_relative_to("/music"):
            path = path.relative_to("/music")
        else:
            raise ValueError("Repair path is outside the library")
    if not path.parts or any(part in {"..", "."} for part in path.parts):
        raise ValueError("Repair path is outside the library")
    candidate = root
    for part in path.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError("Symbolic links are not supported for repair effects")
    if candidate == root or not candidate.resolve(strict=False).is_relative_to(root):
        raise ValueError("Repair path is outside the library")
    return candidate


def _targets(source: dict) -> list[dict]:
    result = []
    for kind, rows in (
        ("artist", source["artists"]),
        ("album", source["albums"]),
        ("track", source["tracks"]),
    ):
        for row in rows:
            if not row.get("entity_uid"):
                raise ValueError(
                    "Repair target has no stable entity UID; run identity backfill"
                )
            result.append(
                {"entity_type": kind, "entity_uid": str(UUID(row["entity_uid"]))}
            )
    if not result:
        raise ValueError("Repair target no longer exists")
    return result


def _file(raw: str, config: dict) -> dict:
    path = _contained(raw, config)
    if not path.is_file():
        raise ValueError("Repair evidence requires an existing regular file")
    return {"path": raw, "fingerprint": _fingerprint(path)}


def _prepare(source: dict, config: dict) -> dict:
    issue, artists, albums, tracks = (
        source["issue"],
        source["artists"],
        source["albums"],
        source["tracks"],
    )
    check = issue["check_type"]
    details = issue.get("details_json") or {}
    root_info = Path(config["library_path"]).resolve(strict=True).stat()
    item = {
        "issue_id": issue["id"],
        "check_type": check,
        "database_version": repair_source_version(source),
        "targets": _targets(source),
        "files": [],
        "absent_paths": [],
        "drop_ids": [],
        "library_root": {"device": root_info.st_dev, "inode": root_info.st_ino},
    }
    if check == "has_photo_desync":
        observation = observe_artist_photo(config, artists[0]["entity_uid"])
        if observation["db_has_photo"] == observation["fs_has_photo"]:
            raise ValueError("Photo flag is already consistent; rerun the check")
        item.update(action="photo_flag", photo=observation)
    elif check in {"stale_artists", "stale_albums", "stale_tracks"}:
        if check == "stale_artists":
            raw = str(
                Path(config["library_path"])
                / (artists[0].get("folder_name") or artists[0]["name"])
            )
            item["action"] = "delete_artist"
        elif check == "stale_albums":
            raw = albums[0]["path"]
            item["action"] = "delete_album"
        else:
            raw = tracks[0]["path"]
            item.update(action="delete_track", drop_ids=[tracks[0]["id"]])
        if _contained(raw, config).exists():
            raise ValueError(
                "A supposedly missing library path exists; rerun the check"
            )
        item["absent_paths"] = [raw]
    elif check == "zombie_artists":
        if albums or tracks:
            raise ValueError("Artist is no longer empty")
        item["action"] = "delete_artist"
    elif check == "fk_orphan_albums":
        if len(artists) > 1:
            raise ValueError("More than one canonical artist matches the orphan")
        if artists and artists[0]["name"] == albums[0]["artist"]:
            raise ValueError("Album already has its canonical artist")
        item.update(
            action="reassign_album", new_artist=artists[0]["name"]
        ) if artists else item.update(action="delete_album")
    elif check == "fk_orphan_tracks":
        if albums or tracks[0].get("album_id") is None:
            raise ValueError("Track is not an orphan of a missing album")
        item.update(action="delete_track", drop_ids=[tracks[0]["id"]])
    elif check == "tag_mismatch":
        path = tracks[0]["path"]
        evidence = _file(path, config)
        observed = read_tags(_contained(path, config))
        artist = observed.get("albumartist")
        if not isinstance(artist, str) or not artist or artist == tracks[0]["artist"]:
            raise ValueError("Fresh tags no longer show an artist mismatch")
        if any(
            lock["entity_type"] == "track"
            and lock["entity_id"] == tracks[0]["id"]
            and lock["field_name"] == "artist"
            for lock in source["locks"]
        ):
            raise ValueError("The track artist was chosen manually and is locked")
        item.update(action="update_track_artist", new_artist=artist, files=[evidence])
    elif check == "duplicate_albums":
        if (
            len({a["artist"] for a in albums}) != 1
            or len({a["name"].strip().casefold() for a in albums}) != 1
            or any(a.get("quarantined_at") for a in albums)
        ):
            raise ValueError(
                "Indexed albums no longer form the declared duplicate group"
            )
        years = {str(a.get("year") or "")[:4] for a in albums if a.get("year")}
        if (
            len(years) > 1
            or max(int(a.get("track_count") or 0) for a in albums)
            - min(int(a.get("track_count") or 0) for a in albums)
            > 1
        ):
            raise ValueError("Album editions require a manual decision")

        def keep_key(album):
            return (
                max(
                    (audio_format_rank(fmt) for fmt in album.get("formats_json") or []),
                    default=0,
                ),
                int(album.get("track_count") or 0),
                float(album.get("total_duration") or 0),
                int(album.get("total_size") or 0),
                -album["id"],
            )

        keep = max(albums, key=keep_key)
        item.update(
            action="quarantine_albums",
            keep_uid=keep["entity_uid"],
            drop_ids=[a["id"] for a in albums if a["id"] != keep["id"]],
        )
    elif check in {"duplicate_tracks", "shadow_quality_tracks"}:
        if len(albums) != 1:
            raise ValueError("Track cleanup must stay inside one indexed album")
        if check == "duplicate_tracks":
            if (
                len(
                    {
                        (
                            t.get("album_id"),
                            str(t.get("title") or "").strip().casefold(),
                            t.get("track_number"),
                            t.get("disc_number"),
                        )
                        for t in tracks
                    }
                )
                != 1
            ):
                raise ValueError("Track identities differ")
            if any(
                not t.get("title")
                or not t.get("track_number")
                or float(t.get("duration") or 0) <= 1
                for t in tracks
            ):
                raise ValueError("Track metadata is incomplete")
            files = [_file(t["path"], config) for t in tracks]
            if len({f["fingerprint"]["sha256"] for f in files}) != 1:
                raise ValueError(
                    "Audio equivalence requires identical current files; cached audio fingerprints do not prove current equivalence"
                )
            keep = max(
                tracks,
                key=lambda t: (
                    audio_format_rank(t.get("format") or ""),
                    t.get("bit_depth") or 0,
                    t.get("sample_rate") or 0,
                    t.get("bitrate") or 0,
                    t.get("size") or 0,
                    -t["id"],
                ),
            )
            drop = [t for t in tracks if t["id"] != keep["id"]]
            keepers = [keep]
        else:
            canonical = _contained(albums[0]["path"], config)
            if str(details.get("canonical_album_path")) != albums[0]["path"]:
                raise ValueError("Canonical album changed")
            selected = set(details.get("paths") or [])
            drop = [t for t in tracks if t["path"] in selected]
            keepers = [
                t
                for t in tracks
                if t["path"] not in selected
                and _contained(t["path"], config).is_relative_to(canonical)
                and t.get("title")
                and int(t.get("track_number") or 0) > 0
                and float(t.get("duration") or 0) > 1
            ]
            if (
                not keepers
                or not drop
                or any(
                    _contained(t["path"], config).is_relative_to(canonical)
                    or (
                        t.get("title")
                        and int(t.get("track_number") or 0) > 0
                        and float(t.get("duration") or 0) > 1
                    )
                    for t in drop
                )
            ):
                raise ValueError("Shadow classification is no longer valid")
            files = [_file(t["path"], config) for t in drop + keepers]
            keep_hashes = {
                file["fingerprint"]["sha256"]
                for file in files
                if file["path"] in {track["path"] for track in keepers}
            }
            if any(
                file["fingerprint"]["sha256"] not in keep_hashes
                for file in files
                if file["path"] in {track["path"] for track in drop}
            ):
                raise ValueError(
                    "Shadow audio requires an identical current canonical file; incomplete metadata alone does not prove equivalence"
                )
        quarantine_id = str(
            uuid5(
                NAMESPACE_URL, f"crate:repair:{issue['id']}:{item['database_version']}"
            )
        )
        item.update(
            action="quarantine_tracks",
            files=files,
            keep_uids=[t["entity_uid"] for t in keepers],
            drop_ids=[t["id"] for t in drop],
            quarantine_id=quarantine_id,
        )
        for track in drop:
            relative = _contained(track["path"], config).relative_to(
                Path(config["library_path"]).resolve()
            )
            destination = (
                Path(config["library_path"])
                / ".crate-trash"
                / "agent-repairs"
                / quarantine_id
                / relative
            )
            _contained(str(destination), config)
            item.setdefault("moves", []).append(
                {
                    "entity_uid": track["entity_uid"],
                    "source": track["path"],
                    "destination": str(destination),
                }
            )
    else:
        raise ValueError("This repair variant requires manual review")
    return item


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation != "repairs" or set(parameters) != {"issue_ids"}:
        raise ValueError("Repairs accept only canonical issue IDs")
    ids = parameters["issue_ids"]
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= 20
        or any(type(value) is not int or value < 1 for value in ids)
        or len(set(ids)) != len(ids)
    ):
        raise ValueError("Repairs require 1 to 20 unique positive issue IDs")
    contracts = {value["check_type"]: value for value in repair_contracts()}
    items, changes, targets, versions = [], [], [], {}
    destructive = False
    for issue_id in ids:
        try:
            source = read_repair_source(issue_id)
        except ValueError as error:
            issue = get_open_repair_issues([issue_id])[0]
            source = {
                "issue": issue,
                "artists": [],
                "albums": [],
                "tracks": [],
                "locks": [],
                "dependents": [],
                "manual_reason": str(error),
            }
        versions[str(issue_id)] = {"database": repair_source_version(source)}
        check = source["issue"]["check_type"]
        contract = contracts.get(check)
        try:
            if not contract or not contract["executable"]:
                raise ValueError(
                    contract["reason"] if contract else "Unknown repair check"
                )
            if source.get("manual_reason"):
                raise ValueError(source["manual_reason"])
            item = _prepare(source, config)
            items.append(item)
            targets.extend(item["targets"])
            destructive = destructive or contract["approval_required"]
            deleted = _deleted_rows(source, item)
            parents = {
                "library_artists": deleted["artist"],
                "library_albums": deleted["album"],
                "library_tracks": deleted["track"],
            }
            cascades = [
                {
                    "relation": d["table_name"],
                    "on_delete": d["on_delete"],
                    "rows": [
                        {
                            "source_hash": repair_source_version(row),
                            "keys": {
                                key: value
                                for key, value in row.items()
                                if key
                                in {
                                    "id",
                                    "user_id",
                                    "playlist_id",
                                    "track_id",
                                    "album_id",
                                    "artist_id",
                                    "entity_key",
                                    "field_name",
                                    "provider",
                                }
                            },
                        }
                        for row in d["rows"]
                        if row[d["column_name"]]
                        in {
                            parent[d["parent_column"]]
                            for parent in parents[d["parent_table"]]
                        }
                    ],
                }
                for d in source["dependents"]
                if d["rows"]
            ]
            cascades = [cascade for cascade in cascades if cascade["rows"]]
            versions[str(issue_id)]["files"] = [f["fingerprint"] for f in item["files"]]
            versions[str(issue_id)]["library_root"] = item["library_root"]
            changes.append(
                {
                    "issue_id": issue_id,
                    "check_type": check,
                    "action": item["action"],
                    "targets": item["targets"],
                    "executable": True,
                    "drop_ids": item["drop_ids"],
                    "keep_uids": item.get("keep_uids")
                    or ([item["keep_uid"]] if item.get("keep_uid") else []),
                    "new_artist": item.get("new_artist"),
                    "photo_after": item.get("photo", {}).get("fs_has_photo"),
                    "quarantine_id": item.get("quarantine_id"),
                    "dependent_relations": cascades,
                    "deleted_targets": [
                        {"entity_type": kind, "entity_uid": row["entity_uid"]}
                        for kind, rows in deleted.items()
                        for row in rows
                    ],
                }
            )
        except (ValueError, OSError) as error:
            from crate.agent_diagnostics import _text

            changes.append(
                {
                    "issue_id": issue_id,
                    "check_type": check,
                    "executable": False,
                    "support": "manual",
                    "scope": "global",
                    "reason": _text(str(error), 512),
                }
            )
            targets.append(
                {"entity_type": "library", "scope": "global", "diagnostic_only": True}
            )
    overlaps = _overlapping_targets(items)
    executable = len(items) == len(ids) and not overlaps
    unique = {(t["entity_type"], t.get("entity_uid", "global")): t for t in targets}
    return {
        "document": {
            "operation": operation,
            "targets": list(unique.values()),
            "source_versions": versions,
            "changes": changes,
            "executable": executable,
            "impact": {
                "database": True,
                "filesystem": any(i["action"] == "quarantine_tracks" for i in items),
                "external_providers": False,
                "scope": "selected_issues",
                "issues": len(ids),
                "overlapping_scopes": overlaps,
                "batch_constraint": "Overlapping entity scopes must be prepared and applied separately; no effect starts for an overlapping MCP plan.",
                "audio_deleted": False,
                "metadata_relationship_loss": destructive,
                "parent_summaries": "Album track totals/formats and active artist album/track/size totals are refreshed from the remaining catalog; no artist filesystem rescan or enrichment is run.",
                "manual_selection_policy": "Any manual item blocks the entire selection; prepare a new exact selection.",
            },
            "risk": "destructive"
            if destructive
            else "caution"
            if any(i["action"] == "quarantine_albums" for i in items)
            else "safe",
            "reversibility": "Quarantined audio is preserved. Deleted database metadata/relationships require backup restoration or a new import; no rollback is promised.",
        },
        "execution": {"executable": executable, "items": items},
    }


def _check_files(item: dict, config: dict, authorize: Callable) -> dict:
    root_info = Path(config["library_path"]).resolve(strict=True).stat()
    if {"device": root_info.st_dev, "inode": root_info.st_ino} != item["library_root"]:
        return {"status": "conflict", "code": "LIBRARY_ROOT_CHANGED"}
    for raw in item["absent_paths"]:
        if _contained(raw, config).exists():
            return {"status": "conflict", "code": "SOURCE_CHANGED"}
    for file in item["files"]:
        candidate = _contained(file["path"], config)
        if not candidate.is_file() or _fingerprint(candidate) != file["fingerprint"]:
            return {"status": "conflict", "code": "SOURCE_CHANGED"}
    if item["action"] == "photo_flag":
        observed = observe_artist_photo(config, item["photo"]["artist_uid"])
        if any(
            observed[field] != item["photo"][field]
            for field in (
                "name",
                "folder_name",
                "db_has_photo",
                "fs_has_photo",
                "filesystem_fingerprint",
            )
        ):
            return {"status": "conflict", "code": "SOURCE_CHANGED"}
    moved = []
    for move in item.get("moves", []):
        authorize()
        source, destination = (
            _contained(move["source"], config),
            _contained(move["destination"], config),
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        _contained(str(destination), config)
        if destination.exists():
            return {
                "status": "partial" if moved else "conflict",
                "code": "QUARANTINE_OCCUPIED",
                "moved": moved,
            }
        expected = next(
            file["fingerprint"]
            for file in item["files"]
            if file["path"] == move["source"]
        )
        if _fingerprint(source) != expected:
            return {
                "status": "partial" if moved else "conflict",
                "code": "SOURCE_CHANGED",
                "moved": moved,
            }
        os.link(source, destination, follow_symlinks=False)
        linked_source = _fingerprint(source)
        if any(
            linked_source[field] != expected[field]
            for field in ("sha256", "device", "inode", "size")
        ):
            return {"status": "partial", "code": "SOURCE_CHANGED", "moved": moved}
        source.unlink()
        if _fingerprint(destination)["sha256"] != expected["sha256"] or source.exists():
            return {
                "status": "partial",
                "code": "QUARANTINE_VERIFY_FAILED",
                "moved": moved + [move["entity_uid"]],
            }
        moved.append(move["entity_uid"])
    return {
        "status": "passed",
        "quarantined_uids": moved,
        "quarantine_id": item.get("quarantine_id"),
    }


def _verify_files(item: dict, config: dict) -> dict:
    if any(_contained(path, config).exists() for path in item["absent_paths"]):
        return {"status": "failed", "code": "SOURCE_CHANGED"}
    moved = {move["source"]: move for move in item.get("moves", [])}
    for file in item["files"]:
        path = _contained(
            moved[file["path"]]["destination"]
            if file["path"] in moved
            else file["path"],
            config,
        )
        if (
            not path.is_file()
            or _fingerprint(path)["sha256"] != file["fingerprint"]["sha256"]
        ):
            return {"status": "failed", "code": "FILE_POSTCONDITION_FAILED"}
        if file["path"] in moved and _contained(file["path"], config).exists():
            return {"status": "failed", "code": "QUARANTINE_SOURCE_STILL_EXISTS"}
    if item["action"] == "photo_flag":
        observed = observe_artist_photo(config, item["photo"]["artist_uid"])
        if (
            observed["filesystem_fingerprint"]
            != item["photo"]["filesystem_fingerprint"]
        ):
            return {"status": "failed", "code": "SOURCE_CHANGED"}
    return {"status": "passed"}


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize: Callable
) -> dict:
    if (
        operation != "repairs"
        or not execution.get("executable")
        or not execution.get("items")
    ):
        raise ValueError("The entire repair selection must be executable and nonempty")
    results = []
    for item in execution["items"]:
        authorize()
        try:
            result = authorize(
                lambda i=item: apply_repair_item(
                    i,
                    check_files=lambda: _check_files(i, config, authorize),
                    verify_files=lambda: _verify_files(i, config),
                    task_id=task_id,
                )
            )
            if item["action"] == "photo_flag" and result["status"] == "applied":
                observed = observe_artist_photo(config, item["photo"]["artist_uid"])
                if (
                    observed["db_has_photo"] != observed["fs_has_photo"]
                    or observed["filesystem_fingerprint"]
                    != item["photo"]["filesystem_fingerprint"]
                ):
                    result.update(status="partial", verification="failed")
                    authorize(
                        lambda: reopen_unverified_repair(item["issue_id"], task_id)
                    )
        except (OSError, ValueError):
            result = {
                "status": "partial",
                "code": "REPAIR_EFFECT_UNCERTAIN",
                "verification": "manual_reconciliation_required",
            }
        results.append(
            {"issue_id": item["issue_id"], "check_type": item["check_type"], **result}
        )
        if result["status"] == "partial":
            break
    complete = len(results) == len(execution["items"]) and all(
        r["status"] == "applied" for r in results
    )
    return {
        "execution": {
            "status": "completed" if complete else "partial",
            "items": results,
        },
        "verification": {
            "status": "passed" if complete else "manual_reconciliation_required",
            "items": [
                {
                    "issue_id": result["issue_id"],
                    "status": result.get("verification") or result["status"],
                }
                for result in results
            ],
        },
    }


__all__ = ["compile_operation", "apply_operation"]
