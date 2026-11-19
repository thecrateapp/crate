"""Account data export archive shared by the API (lookups) and the worker (builds)."""

from __future__ import annotations

import json
import re
import zipfile
from collections.abc import Callable, Iterable
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

USER_DATA_EXPORT_KIND = "account-export"
USER_DATA_EXPORT_FORMAT = "crate-account-export"
USER_DATA_EXPORT_FORMAT_VERSION = 1
USER_DATA_EXPORT_CLEANUP_TASK_TYPE = "cleanup_user_data_exports"

_EXPORT_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def is_user_data_export_id(value: object) -> bool:
    return isinstance(value, str) and bool(_EXPORT_ID_RE.match(value))


def user_data_export_filename(created_at: datetime) -> str:
    return f"crate-data-export-{created_at:%Y%m%d-%H%M%S}.zip"


def user_data_export_download_url(export_id: str) -> str:
    return f"/api/me/export/{export_id}/download"


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Unsupported export value: {type(value).__name__}")


def _encode_row(row: dict) -> bytes:
    return json.dumps(row, default=_json_default, ensure_ascii=False).encode("utf-8")


def write_user_data_export_zip(
    path: Path,
    *,
    user_id: int,
    generated_at: datetime,
    sections: Iterable[str],
    rows_for: Callable[[str], Iterable[dict]],
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, int] | None:
    counts: dict[str, int] = {}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for section in sections:
            if should_stop is not None and should_stop():
                return None
            count = 0
            with archive.open(f"{section}.json", "w", force_zip64=True) as handle:
                handle.write(b"[")
                for row in rows_for(section):
                    handle.write(b"\n" if count == 0 else b",\n")
                    handle.write(_encode_row(row))
                    count += 1
                handle.write(b"\n]\n" if count else b"]\n")
            counts[section] = count
        manifest = {
            "format": USER_DATA_EXPORT_FORMAT,
            "version": USER_DATA_EXPORT_FORMAT_VERSION,
            "user_id": user_id,
            "generated_at": generated_at.isoformat(),
            "sections": counts,
        }
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        )
    return counts


__all__ = [
    "USER_DATA_EXPORT_CLEANUP_TASK_TYPE",
    "USER_DATA_EXPORT_FORMAT",
    "USER_DATA_EXPORT_FORMAT_VERSION",
    "USER_DATA_EXPORT_KIND",
    "is_user_data_export_id",
    "user_data_export_download_url",
    "user_data_export_filename",
    "write_user_data_export_zip",
]
