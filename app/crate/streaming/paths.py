from __future__ import annotations

import os
from pathlib import Path


def data_root() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")).resolve()


def cache_root() -> Path:
    return Path(os.environ.get("CACHE_DIR", str(data_root()))).resolve()


def stream_cache_root() -> Path:
    return cache_root() / "stream-cache"


def resolve_confined_path(root: Path, relative_path: str | Path) -> Path | None:
    """Resolve a relative path only when its target remains below ``root``."""

    stored = Path(relative_path)
    if stored.is_absolute() or ".." in stored.parts:
        return None
    resolved_root = root.resolve()
    candidate = (resolved_root / stored).resolve(strict=False)
    return candidate if candidate.is_relative_to(resolved_root) else None


def resolve_confined_entry_path(root: Path, relative_path: str | Path) -> Path | None:
    """Return a confined lexical entry without following its final symlink."""

    stored = Path(relative_path)
    if stored.is_absolute() or ".." in stored.parts:
        return None
    resolved_root = root.resolve()
    current = resolved_root
    for part in stored.parts[:-1]:
        current /= part
        if current.is_symlink():
            return None
    candidate = resolved_root / stored
    resolved_parent = candidate.parent.resolve(strict=False)
    if not resolved_parent.is_relative_to(resolved_root):
        return None
    return candidate


def variant_relative_path(cache_key: str, preset: str, extension: str) -> str:
    safe_preset = "".join(
        ch if ch.isalnum() or ch in ("_", "-") else "-" for ch in preset
    )
    return str(
        Path("stream-cache")
        / safe_preset
        / cache_key[:2]
        / cache_key[2:4]
        / f"{cache_key}.{extension}"
    )


def resolve_data_file(relative_path: str | None) -> Path | None:
    if not relative_path:
        return None
    stored = Path(relative_path)
    root = cache_root() if stored.parts[:1] == ("stream-cache",) else data_root()
    return resolve_confined_path(root, relative_path)
