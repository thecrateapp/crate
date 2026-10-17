"""Bounded metadata plans shared by worker-backed maintenance clients."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from uuid import UUID

import mutagen

from crate.db.repositories.agent_metadata import (
    apply_metadata_state,
    metadata_state_version,
    read_metadata_state,
)

_ARTIST_FIELDS = {
    "bio",
    "tags",
    "genres",
    "urls",
    "mbid",
    "country",
    "area",
    "formed",
    "ended",
    "artist_type",
    "bandcamp_url",
}
_TAG_FIELDS = {
    "title",
    "artist",
    "albumartist",
    "album",
    "date",
    "genre",
    "tracknumber",
    "discnumber",
}


def _patch(kind: str, patch: object) -> dict:
    fields = _ARTIST_FIELDS if kind == "artist" else _TAG_FIELDS
    if kind == "album":
        fields = fields - {"title", "tracknumber", "discnumber"}
    if not isinstance(patch, dict) or not patch or set(patch) - fields:
        raise ValueError("Metadata patch contains unsupported or no fields")
    for field, value in patch.items():
        if kind == "artist" and field in {"tags", "genres"}:
            if (
                not isinstance(value, list)
                or len(value) > 100
                or any(
                    not isinstance(v, str) or not v.strip() or len(v) > 200
                    for v in value
                )
            ):
                raise ValueError(f"Invalid {field}")
        elif kind == "artist" and field == "urls":
            if (
                not isinstance(value, dict)
                or len(value) > 30
                or any(
                    not isinstance(k, str)
                    or len(k) > 100
                    or not isinstance(v, str)
                    or len(v) > 4096
                    or not v.startswith(("https://", "http://"))
                    for k, v in value.items()
                )
            ):
                raise ValueError("Invalid urls")
        elif value is not None and (
            not isinstance(value, str)
            or len(value) > (50000 if field == "bio" else 4096)
            or "\x00" in value
        ):
            raise ValueError(f"Invalid {field}")
        if (
            field in {"tracknumber", "discnumber"}
            and isinstance(value, str)
            and value
            and (
                not re.fullmatch(r"[0-9]{1,4}(?:/[0-9]{1,4})?", value)
                or int(value.split("/", 1)[0]) < 1
            )
        ):
            raise ValueError(f"Invalid {field}")
    return dict(patch)


def _path(raw: str, config: dict) -> Path:
    root = Path(config["library_path"]).resolve(strict=True)
    relative = Path(raw)
    if relative.is_absolute():
        if relative.is_relative_to(root):
            relative = relative.relative_to(root)
        elif relative.is_relative_to(Path("/music")):
            relative = relative.relative_to("/music")
        else:
            raise ValueError("Track path is outside the library")
    if ".." in relative.parts:
        raise ValueError("Track path is outside the library")
    candidate = root
    for component in relative.parts:
        candidate = candidate / component
        if candidate.is_symlink():
            raise ValueError("Symbolic links are not supported for metadata writes")
    if not candidate.is_file() or not candidate.resolve().is_relative_to(root):
        raise ValueError("Track file is unavailable")
    return candidate


def _fingerprint(path: Path) -> dict:
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.stat()

    def identity(s):
        return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

    if identity(before) != identity(after):
        raise ValueError("Track changed while preparing metadata plan")
    return {
        "sha256": digest.hexdigest(),
        "size": after.st_size,
        "device": after.st_dev,
        "inode": after.st_ino,
        "mtime_ns": after.st_mtime_ns,
        "ctime_ns": after.st_ctime_ns,
    }


def _read(path: Path, fields: dict) -> dict:
    audio = getattr(mutagen, "File")(path, easy=True)
    if audio is None:
        raise ValueError("Audio tags cannot be read")
    return {field: list(audio.get(field, [])) for field in fields}


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation != "metadata_update" or set(parameters) - {
        "entity_type",
        "entity_uid",
        "patch",
    }:
        raise ValueError("Unsupported metadata operation parameters")
    kind = parameters.get("entity_type")
    if kind not in {"artist", "album", "track"}:
        raise ValueError("Unsupported metadata entity type")
    uid = str(UUID(str(parameters.get("entity_uid"))))
    patch = _patch(kind, parameters.get("patch"))
    state = read_metadata_state(kind, uid)
    files = []
    changes = []
    if kind == "artist":
        aliases = {"tags": "tags_json", "urls": "urls_json"}
        for field, after in patch.items():
            before = (
                state["genres"]
                if field == "genres"
                else state["entity"].get(aliases.get(field, field))
            )
            changes.append(
                {"entity_uid": uid, "field": field, "before": before, "after": after}
            )
    else:
        if not state["tracks"]:
            raise ValueError("Album has no indexed tracks")
        for track in state["tracks"]:
            if not track.get("entity_uid"):
                raise ValueError("Track has no entity UID")
            path = _path(track["path"], config)
            fingerprint = _fingerprint(path)
            before = _read(path, patch)
            files.append(
                {
                    "entity_uid": str(track["entity_uid"]),
                    "path": track["path"],
                    "fingerprint": fingerprint,
                    "before": before,
                }
            )
            changes.extend(
                {
                    "entity_uid": str(track["entity_uid"]),
                    "field": field,
                    "before": before[field],
                    "after": [value] if value is not None else [],
                }
                for field, value in patch.items()
            )
    version = metadata_state_version(state)
    targets = [{"entity_type": kind, "entity_uid": uid}]
    if kind == "album":
        targets.extend(
            {"entity_type": "track", "entity_uid": str(t["entity_uid"])}
            for t in state["tracks"]
        )
    return {
        "document": {
            "operation": operation,
            "targets": targets,
            "source_versions": {
                "database": version,
                "files": [
                    {"entity_uid": f["entity_uid"], **f["fingerprint"]} for f in files
                ],
            },
            "changes": changes,
            "impact": {
                "database": True,
                "filesystem": bool(files),
                "files": len(files),
                "bytes_read_for_preconditions": sum(
                    f["fingerprint"]["size"] for f in files
                ),
                "locks_modified_fields": True,
                "provenance": "manual_edit",
                "refreshes_size_totals": ["album", "artist"] if files else [],
            },
            "risk": "caution" if files else "safe",
            "reversibility": "new_plan_required; original audio tags are not retained"
            if files
            else "new_plan_required",
        },
        "execution": {
            "entity_type": kind,
            "entity_uid": uid,
            "patch": patch,
            "database_version": version,
            "files": files,
        },
    }


def _write_file(file: dict, patch: dict, config: dict, authorize: Callable) -> dict:
    path = _path(file["path"], config)
    if (
        _fingerprint(path) != file["fingerprint"]
        or _read(path, patch) != file["before"]
    ):
        return {
            "entity_uid": file["entity_uid"],
            "status": "conflict",
            "code": "SOURCE_CHANGED",
        }
    fd, raw = tempfile.mkstemp(
        prefix=".crate-tags-", suffix=path.suffix, dir=path.parent
    )
    os.close(fd)
    temporary = Path(raw)
    try:
        shutil.copy2(path, temporary)
        audio = getattr(mutagen, "File")(temporary, easy=True)
        if audio is None:
            raise ValueError("Audio tags cannot be written")
        for field, value in patch.items():
            if value is None:
                if field in audio:
                    del audio[field]
            else:
                audio[field] = [value]
        audio.save()
        expected = {
            field: [value] if value is not None else []
            for field, value in patch.items()
        }
        if _read(temporary, patch) != expected:
            raise ValueError("Written audio tags did not verify")
        authorize()
        if (
            _path(file["path"], config) != path
            or _fingerprint(path) != file["fingerprint"]
        ):
            return {
                "entity_uid": file["entity_uid"],
                "status": "conflict",
                "code": "SOURCE_CHANGED",
            }
        os.replace(temporary, path)
        observed = _read(path, patch)
        if observed != expected:
            return {
                "entity_uid": file["entity_uid"],
                "status": "verification_failed",
                "effect_applied": True,
            }
        return {
            "entity_uid": file["entity_uid"],
            "status": "applied",
            "before": file["before"],
            "after": patch,
            "size": path.stat().st_size,
        }
    finally:
        temporary.unlink(missing_ok=True)


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize: Callable
) -> dict:
    if operation != "metadata_update":
        raise ValueError("Unsupported metadata operation")
    kind = execution["entity_type"]
    patch = _patch(kind, execution["patch"])
    authorize()

    def files(_state: dict) -> list[dict]:
        results = []
        for file in execution["files"]:
            authorize()
            try:
                results.append(_write_file(file, patch, config, authorize))
            except (OSError, ValueError, mutagen.MutagenError):
                results.append(
                    {
                        "entity_uid": file["entity_uid"],
                        "status": "failed",
                        "code": "TAG_WRITE_FAILED",
                    }
                )
        return results

    result = authorize(
        lambda: apply_metadata_state(
            kind,
            execution["entity_uid"],
            expected_version=execution["database_version"],
            patch=patch,
            apply_files=files,
            task_id=task_id,
            actor_user_id=execution.get("actor_user_id"),
        )
    )
    success = result["status"] == "completed"
    return {
        "execution": result,
        "verification": {
            "status": "passed"
            if success
            else "conflict"
            if result["status"] == "conflict"
            else "failed",
            "items": [
                {
                    "entity_uid": i["entity_uid"],
                    "status": "passed" if i["status"] == "applied" else i["status"],
                }
                for i in result["items"]
            ],
        },
    }


__all__ = ["compile_operation", "apply_operation"]
