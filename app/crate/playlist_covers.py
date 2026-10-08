import base64
import binascii
import os
import re
from pathlib import Path


_DATA_URL_RE = re.compile(r"^data:image/(?P<fmt>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$")


def playlist_covers_root() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")) / "playlist-covers"


def playlist_cover_abspath(cover_path: str | None) -> Path | None:
    if not cover_path:
        return None
    root = playlist_covers_root().resolve()
    candidate = (root / cover_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def persist_playlist_cover_data(playlist_id: int, cover_data_url: str) -> str:
    match = _DATA_URL_RE.match((cover_data_url or "").strip())
    if not match:
        raise ValueError("Unsupported playlist cover payload")

    fmt = match.group("fmt").lower()
    ext = "jpg" if fmt in {"jpeg", "jpg"} else fmt
    if ext not in {"jpg", "png", "webp", "gif"}:
        raise ValueError("Unsupported playlist cover format")

    try:
        payload = base64.b64decode(match.group("data"), validate=True)
    except binascii.Error as exc:
        raise ValueError("Invalid playlist cover encoding") from exc

    filename = f"playlist-{playlist_id}.{ext}"
    root = playlist_covers_root()
    root.mkdir(parents=True, exist_ok=True)
    path = root / filename
    path.write_bytes(payload)
    return filename


def delete_playlist_cover(cover_path: str | None):
    absolute = playlist_cover_abspath(cover_path)
    if absolute and absolute.exists():
        absolute.unlink()
