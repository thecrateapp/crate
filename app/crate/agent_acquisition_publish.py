"""Worker-only exact new-album publication from a separately approved audio manifest."""

import ctypes
import errno
import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import UUID, uuid5

from mutagen.flac import FLAC

from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_acquisition as store
from crate.entity_ids import album_entity_uid


def _safe_path(root, relative):
    root = Path(root).resolve(strict=True)
    parts = Path(relative).parts
    if (
        not parts
        or Path(relative).is_absolute()
        or any(p in {".", ".."} for p in parts)
    ):
        raise ValueError("Invalid acquisition path")
    result = root
    for part in parts:
        result = result / part
        if result.is_symlink():
            raise ValueError("Acquisition never follows symbolic links")
    if not result.resolve().is_relative_to(root):
        raise ValueError("Acquisition path escaped its root")
    return result


def _file_manifest(path, expected, source):
    with path.open("rb") as handle:
        size = os.fstat(handle.fileno()).st_size
        if size != expected["size"]:
            raise DiagnosticError(
                "SOURCE_CONFLICT", "Staged bytes differ from the approved selection"
            )
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    decoded = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-xerror",
            "-i",
            str(path),
            "-f",
            "null",
            "-",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    if decoded.returncode:
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Staged FLAC cannot be decoded completely"
        )
    audio = FLAC(path)
    if (
        audio.info.bits_per_sample != expected["bitDepth"]
        or audio.info.sample_rate != expected["sampleRate"]
        or audio.info.length <= 0
    ):
        raise DiagnosticError(
            "SOURCE_CONFLICT",
            "Staged audio quality differs from the approved selection",
        )

    def tag(key):
        values = audio.get(key) or [""]
        value = str(values[0]).strip()
        if len(value) > 512 or any(ord(c) < 32 for c in value):
            raise ValueError("Invalid staged audio metadata")
        return value

    artist = tag("albumartist") or tag("artist")
    if (
        artist.casefold() != source["artist"].casefold()
        or tag("album").casefold() != source["release"].casefold()
    ):
        raise DiagnosticError(
            "SOURCE_CONFLICT",
            "Staged audio does not match the reviewed artist and release",
        )
    return {
        "filename": path.name,
        "size": size,
        "sha256": digest,
        "duration": audio.info.length,
        "sample_rate": audio.info.sample_rate,
        "bit_depth": audio.info.bits_per_sample,
        "title": tag("title"),
        "track_number": tag("tracknumber"),
        "disc_number": tag("discnumber"),
    }


def staging_root(config):
    root = Path(config.get("downloads_path", "/downloads/soulseek")).resolve(
        strict=True
    )
    library = Path(config["library_path"]).resolve(strict=True)
    if root.is_relative_to(library) or library.is_relative_to(root):
        raise DiagnosticError(
            "NOT_EXECUTABLE", "Provider staging and library roots must be disjoint"
        )
    return root


def staged_manifest(source, config, relative, *, check=None):
    staging_root(config)
    directory = _safe_path(
        config.get("downloads_path", "/downloads/soulseek"), relative
    )
    expected = {
        f["filename"].replace("\\", "/").split("/")[-1]: f for f in source["files"]
    }
    if not directory.is_dir() or {p.name for p in directory.iterdir()} != set(expected):
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Staging contains missing or unexpected files"
        )
    result = []
    for name, file in expected.items():
        if check is not None:
            check()
        path = _safe_path(directory, name)
        if not path.is_file() or path.stat().st_nlink != 1:
            raise ValueError("Unsupported staged source")
        result.append(_file_manifest(path, file, source))
    return result


def compile_publication(parameters, config, *, principal, task_id=None):
    from crate.worker_handlers import is_cancelled

    def check():
        if task_id and is_cancelled(task_id):
            raise DiagnosticError("CANCELLED", "Publication preparation was cancelled")

    if set(parameters) != {"source_job_id"}:
        raise ValueError("An exact owned source job is required")
    transfer = store.owned_transfer(principal, parameters["source_job_id"])
    evidence = transfer["evidence"]
    if str(staging_root(config)) != evidence["download_root"]:
        raise DiagnosticError("EVIDENCE_STALE", "Provider staging root changed")
    manifest = None
    if transfer["state"] != "staged":
        from crate.agent_acquisition import reconcile_transfer

        evidence = reconcile_transfer(
            parameters["source_job_id"], evidence, config, check=check
        )
        manifest = evidence["manifest"]
    source, target = evidence["source"], evidence["target"]
    if store.target_state(target["artist_uid"], source["release"]) != target:
        raise DiagnosticError("EVIDENCE_STALE", "Target artist changed")
    if manifest is None:
        manifest = staged_manifest(
            source, config, evidence["staging_relative"], check=check
        )
    check()
    if manifest != evidence["manifest"]:
        raise DiagnosticError("EVIDENCE_STALE", "Staged acquisition content changed")
    uid = str(
        album_entity_uid(artist_uid=target["artist_uid"], album_name=source["release"])
    )
    relative = f"{target['artist_uid']}/{uid}"
    destination = _safe_path(config["library_path"], relative)
    if destination.exists():
        raise DiagnosticError("ALREADY_EXISTS", "Album destination already exists")
    tracks = []
    for file in manifest:
        track_uid = str(uuid5(UUID(uid), file["filename"]))
        tracks.append(
            {
                "entity_uid": track_uid,
                "path": str(destination / (track_uid + ".flac")),
                "title": file["title"] or file["filename"],
                "artist": target["name"],
                "album": source["release"],
                "format": "flac",
                "filename": track_uid + ".flac",
                "size": file["size"],
                "duration": file["duration"],
                "sample_rate": file["sample_rate"],
                "bit_depth": file["bit_depth"],
                "track_number": _number(file["track_number"]),
                "disc_number": _number(file["disc_number"]),
            }
        )
    album = {
        "entity_uid": uid,
        "artist": target["name"],
        "name": source["release"],
        "path": str(destination),
        "tag_album": source["release"],
        "track_count": len(tracks),
        "total_size": sum(f["size"] for f in manifest),
        "total_duration": sum(f["duration"] for f in manifest),
        "formats": ["flac"],
    }
    execution = {
        **parameters,
        "source": source,
        "target": target,
        "manifest": manifest,
        "staging_relative": evidence["staging_relative"],
        "destination_relative": relative,
        "album": album,
        "tracks": tracks,
    }
    return {
        "document": {
            "operation": "acquisition_publish",
            "risk": "high",
            "targets": [{"entity_type": "artist", "entity_uid": target["artist_uid"]}],
            "changes": [
                {
                    "source_job_id": parameters["source_job_id"],
                    "batch_id": evidence["batch_id"],
                    "source_receipt_id": evidence["batch_id"],
                    "manifest": manifest,
                    "destination": relative,
                    "album_uid": uid,
                    "track_uids": [t["entity_uid"] for t in tracks],
                    "overwrite": False,
                }
            ],
            "impact": {
                "scope": "selected",
                "library_files": len(tracks),
                "bytes": album["total_size"],
            },
            "verification": {
                "status": "audio_hashes_and_exact_index_then_projection_pending"
            },
        },
        "execution": execution,
    }


def _number(value):
    first = value.split("/")[0]
    return int(first) if first.isdigit() and len(first) < 6 else None


def _rename_absent(source, destination):
    # Linux worker: an atomic no-replace directory publication. Never use os.replace.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise ValueError("Atomic no-replace publication is unavailable")
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise DiagnosticError(
                "ALREADY_EXISTS", "Publication destination became occupied"
            )
        raise OSError(code, "Atomic publication failed")


def _hash_file(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def apply_publication(execution, config, *, task_id, authorize):
    from crate.worker_handlers import is_cancelled

    source = execution["source"]
    if (
        staged_manifest(source, config, execution["staging_relative"], check=authorize)
        != execution["manifest"]
    ):
        raise DiagnosticError("EVIDENCE_STALE", "Staged audio changed after approval")
    destination = _safe_path(config["library_path"], execution["destination_relative"])
    if str(destination) != execution["album"]["path"] or destination.exists():
        raise DiagnosticError("SOURCE_CONFLICT", "Library root or destination changed")
    staging = _safe_path(
        config.get("downloads_path", "/downloads/soulseek"),
        execution["staging_relative"],
    )
    temporary = None

    def publish_files():
        nonlocal temporary
        destination.parent.mkdir(exist_ok=True)
        _safe_path(config["library_path"], execution["destination_relative"])
        temporary = Path(
            tempfile.mkdtemp(prefix=".crate-acquisition-", dir=destination.parent)
        )
        for file, track in zip(execution["manifest"], execution["tracks"], strict=True):
            if is_cancelled(task_id):
                raise DiagnosticError(
                    "CANCELLED", "Publication cancelled before library visibility"
                )
            authorize()
            original = _safe_path(staging, file["filename"])
            copied = temporary / Path(track["path"]).name
            # Copy exactly the approved size; reject growth, truncation or content change.
            with original.open("rb") as src, copied.open("xb") as dst:
                remaining = file["size"]
                while remaining:
                    if is_cancelled(task_id):
                        raise DiagnosticError(
                            "CANCELLED", "Publication cancelled during audio copy"
                        )
                    authorize()
                    chunk = src.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Staged audio truncated")
                    dst.write(chunk)
                    remaining -= len(chunk)
                if src.read(1):
                    raise ValueError("Staged audio grew")
                dst.flush()
                os.fsync(dst.fileno())
            with copied.open("rb") as check:
                if hashlib.file_digest(check, "sha256").hexdigest() != file["sha256"]:
                    raise ValueError("Staged audio changed")
        authorize()
        _safe_path(config["library_path"], execution["destination_relative"])
        _rename_absent(temporary, destination)
        temporary = None

    try:
        result = authorize(lambda: store.publish_album(execution, publish_files))
    finally:
        if temporary is not None:
            shutil.rmtree(temporary)
    verified = all(
        Path(track["path"]).stat().st_size == file["size"]
        and _hash_file(Path(track["path"])) == file["sha256"]
        for file, track in zip(execution["manifest"], execution["tracks"], strict=True)
    )
    return {
        "execution": {
            "status": "completed" if verified else "partial",
            "items": [result],
        },
        "verification": {
            "status": "passed" if verified else "manual_reconciliation_required"
        },
        "projection": {"status": "pending"},
    }


__all__ = [
    "apply_publication",
    "compile_publication",
    "staged_manifest",
    "staging_root",
]
