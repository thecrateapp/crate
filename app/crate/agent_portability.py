"""Metadata-only portable plans with configured roots and private artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

from crate.db.repositories.agent_artifacts import register_artifact
from crate.db.repositories.agent_metadata import metadata_state_version
from crate.db.repositories.agent_portability import (
    IMPORT_FIELDS,
    LOCK_ALIASES,
    apply_portability_changes,
    read_portability_state,
)
from crate.portable_metadata import _contained_path, load_album_sidecar

MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
_PRIVATE_FIELDS = {"id", "storage_id", "album_id", "path", "folder_name"}


def _preset(config: dict, name: str, purpose: str) -> Path:
    presets = config.get("agent_metadata_presets") or {}
    preset = presets.get(name)
    if not isinstance(preset, dict) or preset.get(purpose) is not True:
        raise ValueError("The configured metadata preset does not allow this operation")
    root = Path(preset.get("root", "")).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Metadata preset root is unavailable")
    library = Path(config["library_path"]).resolve(strict=True)
    if purpose == "export" and (
        root.is_relative_to(library) or library.is_relative_to(root)
    ):
        raise ValueError("Export presets must be separate from the music library")
    return root


def _public_row(row: dict) -> dict:
    return {key: value for key, value in row.items() if key not in _PRIVATE_FIELDS}


def _sidecar(state: dict, album: dict) -> dict:
    tracks = []
    for track in state["tracks"]:
        if track["album_id"] == album["id"]:
            row = _public_row(track)
            try:
                row["relative_path"] = str(
                    Path(track["path"]).relative_to(Path(album["path"]))
                )
            except ValueError:
                raise ValueError(
                    "Track path does not belong to its portable album"
                ) from None
            tracks.append(row)
    return {
        "schema_version": 1,
        "album": _public_row(album),
        "tracks": tracks,
        "import_contract": {
            "album_fields": sorted(IMPORT_FIELDS["album"]),
            "track_fields": sorted(IMPORT_FIELDS["track"]),
            "computed_analysis": "exported_evidence_only; reanalyze to verify",
            "filesystem_tags": "unchanged",
        },
    }


def _read_source(root: Path, album_uid: str) -> tuple[dict, str]:
    source = _contained_path(root, f"{album_uid}/.crate/album.json")
    payload = load_album_sidecar(source)
    raw = _read_regular(source)
    # Parse the hashed bytes too: a concurrent replacement cannot approve different bytes.
    if hashlib.sha256(raw).hexdigest() != payload["_sidecar_sha256"]:
        raise ValueError("Portable source changed during preparation")
    return payload, hashlib.sha256(raw).hexdigest()


def _read_regular(path: Path) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARTIFACT_BYTES:
            raise ValueError("Portable source is not a bounded regular file")
        value = source.read(MAX_ARTIFACT_BYTES + 1)
    if len(value) > MAX_ARTIFACT_BYTES:
        raise ValueError("Portable source exceeds its byte budget")
    return value


def _import_changes(
    state: dict, sources: list[dict], policy: str
) -> tuple[list[dict], list[dict]]:
    changes, conflicts = [], []
    for source in sources:
        album = next(
            a for a in state["albums"] if str(a["entity_uid"]) == source["album_uid"]
        )
        payload = source["payload"]
        if str(payload.get("album", {}).get("entity_uid")) != source["album_uid"]:
            raise ValueError("Sidecar album UID does not match its selected target")
        selected = [("album", album, payload["album"])]
        indexed = {
            str(t["entity_uid"]): t
            for t in state["tracks"]
            if t["album_id"] == album["id"]
        }
        seen = set()
        for track in payload.get("tracks", []):
            uid = str(UUID(str(track.get("entity_uid"))))
            if uid not in indexed or uid in seen:
                raise ValueError(
                    "Sidecar track UIDs must uniquely belong to the selected album"
                )
            seen.add(uid)
            selected.append(("track", indexed[uid], track))
        for kind, before, after in selected:
            for field in sorted(IMPORT_FIELDS[kind]):
                if field not in after or after[field] == before.get(field):
                    continue
                value = after[field]
                if field == "release_group_secondary_types":
                    if (
                        not isinstance(value, list)
                        or len(value) > 20
                        or any(
                            not isinstance(item, str)
                            or not 1 <= len(item) <= 200
                            or "\x00" in item
                            for item in value
                        )
                    ):
                        raise ValueError("Invalid portable release type list")
                elif field in {"track_number", "disc_number", "discogs_master_id"}:
                    if value is not None and (
                        type(value) is not int or not 0 <= value <= 2147483647
                    ):
                        raise ValueError("Invalid portable numeric metadata")
                elif value is not None and (
                    not isinstance(value, str) or len(value) > 4096 or "\x00" in value
                ):
                    raise ValueError("Invalid portable text metadata")
                change = {
                    "entity_type": kind,
                    "entity_uid": str(before["entity_uid"]),
                    "field": field,
                    "before": before.get(field),
                    "after": value,
                }
                locked = any(
                    field_lock["entity_type"] == kind
                    and field_lock["entity_id"] == before["id"]
                    and LOCK_ALIASES.get(
                        field_lock["field_name"], field_lock["field_name"]
                    )
                    == field
                    for field_lock in state["locks"]
                )
                reason = (
                    "field_locked"
                    if locked
                    else "existing_value"
                    if policy == "fill_missing"
                    and before.get(field) not in (None, "", [])
                    else None
                )
                (conflicts if reason else changes).append(
                    {
                        **change,
                        **(
                            {"resolution": "preserve_current", "reason": reason}
                            if reason
                            else {}
                        ),
                    }
                )
    return changes, conflicts


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation not in {"metadata_export", "metadata_rehydrate"}:
        raise ValueError("Unsupported portable operation")
    exporting = operation == "metadata_export"
    key = "destination_preset" if exporting else "source_preset"
    if set(parameters) - {
        "album_uids",
        key,
        *([] if exporting else ["conflict_policy"]),
    }:
        raise ValueError("Unsupported portable parameters")
    uids = [str(UUID(str(uid))) for uid in parameters["album_uids"]]
    root = _preset(config, parameters[key], "export" if exporting else "rehydrate")
    state = read_portability_state(uids)
    sources, conflicts = [], []
    if exporting:
        changes = [
            {
                "entity_type": "album",
                "entity_uid": str(a["entity_uid"]),
                "field": "portable_sidecar",
                "before": None,
                "after": "metadata_only",
            }
            for a in state["albums"]
        ]
    else:
        policy = parameters.get("conflict_policy", "fill_missing")
        if policy not in {"fill_missing", "replace_unlocked"}:
            raise ValueError("Unsupported conflict policy")
        for uid in uids:
            payload, digest = _read_source(root, uid)
            sources.append({"album_uid": uid, "payload": payload, "sha256": digest})
        changes, conflicts = _import_changes(state, sources, policy)
    targets = [
        {"entity_type": "album", "entity_uid": str(a["entity_uid"])}
        for a in state["albums"]
    ]
    targets += [
        {"entity_type": "track", "entity_uid": str(t["entity_uid"])}
        for t in state["tracks"]
    ]
    execution_changes = changes
    if not changes:
        changes = [
            {
                "entity_type": "album",
                "entity_uid": uid,
                "field": "portable_metadata",
                "before": "current",
                "after": "already_satisfied",
            }
            for uid in uids
        ]
    version = metadata_state_version(state)
    return {
        "document": {
            "operation": operation,
            "targets": targets,
            "changes": changes,
            "conflicts": conflicts,
            "source_versions": {
                "database": version,
                "sidecars": [
                    {"album_uid": s["album_uid"], "sha256": s["sha256"]}
                    for s in sources
                ],
            },
            "impact": {
                "scope": "selected_albums",
                "database": not exporting,
                "filesystem": exporting,
                "preset": parameters[key],
                "include_audio": False,
                "artwork": False,
                "audio_tags": False,
                "computed_analysis_import": False,
                "conflict_policy": parameters.get("conflict_policy"),
                "max_artifact_bytes": MAX_ARTIFACT_BYTES,
            },
            "risk": "safe"
            if exporting
            or parameters.get("conflict_policy", "fill_missing") == "fill_missing"
            else "caution",
            "reversibility": "Export is isolated and never overwrites. Imports preserve current locked fields and record portable_import provenance.",
        },
        "execution": {
            "album_uids": uids,
            "preset": parameters[key],
            "root": str(root),
            "database_version": version,
            "sources": sources,
            "changes": execution_changes,
            "export_id": str(uuid4()) if exporting else None,
        },
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize
) -> dict:
    exporting = operation == "metadata_export"
    if not exporting and operation != "metadata_rehydrate":
        raise ValueError("Unsupported portable operation")
    root = _preset(config, execution["preset"], "export" if exporting else "rehydrate")
    if str(root) != execution["root"]:
        raise ValueError("Metadata preset changed")
    if not exporting:

        def import_metadata():
            for expected in execution["sources"]:
                authorize()
                _, digest = _read_source(root, expected["album_uid"])
                if digest != expected["sha256"]:
                    raise ValueError("Portable source changed")
            return apply_portability_changes(
                execution["album_uids"],
                execution["database_version"],
                execution["changes"],
                task_id=task_id,
            )

        result = authorize(import_metadata)
        return {
            "execution": result,
            "verification": {
                "status": "passed" if result["status"] == "completed" else "failed",
                "basis": "transactional field CAS; audio tags unchanged",
            },
        }

    def export():
        state = read_portability_state(execution["album_uids"])
        if metadata_state_version(state) != execution["database_version"]:
            raise ValueError("Portable database source changed")
        destination = _contained_path(root, str(UUID(execution["export_id"])))
        destination.mkdir(mode=0o700, exist_ok=False)
        archive_path = destination / "metadata.zip"
        with zipfile.ZipFile(
            archive_path, "x", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            uncompressed_bytes = 0
            for album in state["albums"]:
                authorize()
                relative = f"{album['entity_uid']}/.crate/album.json"
                sidecar_path = _contained_path(destination, relative)
                sidecar_path.parent.mkdir(parents=True, mode=0o700)
                serialized = json.dumps(
                    _sidecar(state, album),
                    ensure_ascii=False,
                    default=str,
                    allow_nan=False,
                ).encode()
                uncompressed_bytes += len(serialized)
                if uncompressed_bytes > MAX_ARTIFACT_BYTES:
                    raise ValueError("Sidecar exceeds its byte budget")
                with sidecar_path.open("xb") as target:
                    target.write(serialized)
                archive.writestr(relative, serialized)
        if archive_path.stat().st_size > MAX_ARTIFACT_BYTES:
            raise ValueError("Export exceeds its artifact budget")
        os.chmod(archive_path, 0o600)
        return archive_path

    archive_path = authorize(export)
    raw = _read_regular(archive_path)
    authorize()
    artifact = register_artifact(
        task_id,
        path=str(archive_path),
        filename="crate-metadata.zip",
        sha256=hashlib.sha256(raw).hexdigest(),
        byte_size=len(raw),
    )
    return {
        "execution": {
            "status": "completed",
            "albums": len(execution["album_uids"]),
            "include_audio": False,
            "artifacts": [artifact],
        },
        "verification": {
            "status": "passed",
            "basis": "isolated metadata sidecars and SHA-256 artifact",
        },
    }


__all__ = ["compile_operation", "apply_operation"]
