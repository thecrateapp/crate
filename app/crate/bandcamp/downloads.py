from __future__ import annotations

import json
import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from crate.bandcamp.models import BandcampSessionMaterial


class BandcampDownloadError(RuntimeError):
    pass


class BandcampDownloadNotConfigured(BandcampDownloadError):
    pass


@dataclass(frozen=True)
class BandcampDownloadResult:
    archive_paths: tuple[Path, ...]
    message: str = ""
    format: str = "flac"


def download_purchase_with_command(
    session: BandcampSessionMaterial,
    *,
    item: dict[str, Any],
    output_dir: Path,
    requested_format: str = "flac",
) -> BandcampDownloadResult:
    command = os.environ.get("CRATE_BANDCAMP_DOWNLOAD_COMMAND", "").strip()
    if not command:
        return _download_purchase_with_web(
            session,
            item=item,
            output_dir=output_dir,
            requested_format=requested_format,
        )

    return _download_purchase_with_command_backend(
        session,
        item=item,
        output_dir=output_dir,
        requested_format=requested_format,
        command=command,
    )


def _download_purchase_with_web(
    session: BandcampSessionMaterial,
    *,
    item: dict[str, Any],
    output_dir: Path,
    requested_format: str,
) -> BandcampDownloadResult:
    backend = os.environ.get("CRATE_BANDCAMP_DOWNLOAD_BACKEND", "web").strip()
    if backend and backend.lower() not in {"web", "native"}:
        raise BandcampDownloadNotConfigured(
            "Bandcamp download command is not configured"
        )

    from crate.bandcamp.web import BandcampWebClient, BandcampWebError

    timeout = float(os.environ.get("CRATE_BANDCAMP_DOWNLOAD_TIMEOUT", "7200"))
    try:
        result = BandcampWebClient(session, timeout=timeout).download_purchase_archive(
            item=item,
            output_dir=output_dir,
            requested_format=requested_format,
        )
    except BandcampWebError as exc:
        raise BandcampDownloadError(str(exc)) from exc
    return BandcampDownloadResult(
        archive_paths=(result.archive_path,),
        message=result.message,
        format=result.format,
    )


def _download_purchase_with_command_backend(
    session: BandcampSessionMaterial,
    *,
    item: dict[str, Any],
    output_dir: Path,
    requested_format: str,
    command: str,
) -> BandcampDownloadResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    timeout = float(os.environ.get("CRATE_BANDCAMP_DOWNLOAD_TIMEOUT", "7200"))
    payload = json.dumps(
        {
            "session": {
                "cookies": session.cookies,
                "profile": {
                    "username": session.profile.username,
                    "fan_id": session.profile.fan_id,
                    "display_name": session.profile.display_name,
                    "image_url": session.profile.image_url,
                },
            },
            "item": _public_item_payload(item),
            "format": requested_format,
            "output_dir": str(output_dir),
        },
        default=str,
    ).encode("utf-8")

    try:
        completed = subprocess.run(
            shlex.split(command),
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BandcampDownloadError("Bandcamp download timed out") from exc

    if completed.returncode != 0:
        raise BandcampDownloadError("Bandcamp download command failed")

    result: dict[str, Any] = {}
    if completed.stdout.strip():
        try:
            payload_result = json.loads(completed.stdout.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise BandcampDownloadError(
                "Bandcamp download returned invalid JSON"
            ) from exc
        if not isinstance(payload_result, dict):
            raise BandcampDownloadError("Bandcamp download must return an object")
        result = payload_result

    archive_paths = _resolve_archive_paths(result, output_dir)
    if not archive_paths:
        raise BandcampDownloadError("Bandcamp download produced no archive files")
    return BandcampDownloadResult(
        archive_paths=tuple(archive_paths),
        message=str(result.get("message") or ""),
        format=str(result.get("format") or requested_format),
    )


def _public_item_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "item_url": item.get("item_url"),
        "bandcamp_item_id": item.get("bandcamp_item_id"),
        "bandcamp_item_type": item.get("bandcamp_item_type"),
        "artist_name": item.get("artist_name"),
        "album_title": item.get("album_title"),
        "track_title": item.get("track_title"),
        "album_id": item.get("album_id"),
        "track_id": item.get("track_id"),
    }


def _resolve_archive_paths(result: dict[str, Any], output_dir: Path) -> list[Path]:
    raw_paths = result.get("archive_paths") or result.get("archives") or []
    if isinstance(raw_paths, str):
        raw_paths = [raw_paths]
    paths = [
        _safe_child_path(str(path), output_dir)
        for path in raw_paths
        if str(path).strip()
    ]
    if not paths:
        paths = sorted(output_dir.glob("*.zip"))
    return [path for path in paths if path.is_file()]


def _safe_child_path(value: str, output_dir: Path) -> Path:
    base = output_dir.resolve()
    path = Path(value)
    if not path.is_absolute():
        path = output_dir / path
    resolved = path.resolve()
    if not str(resolved).startswith(str(base)):
        raise BandcampDownloadError("Bandcamp download path escaped output directory")
    return resolved
