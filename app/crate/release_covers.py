"""Storage helpers for virtual pre-release artwork."""

import os
from pathlib import Path


def release_covers_root() -> Path:
    root = Path(os.environ.get("DATA_DIR", "/data")) / "release-covers"
    root.mkdir(parents=True, exist_ok=True)
    return root


def release_cover_abspath(release_id: int) -> Path:
    return release_covers_root() / f"release-{abs(int(release_id))}.jpg"


def release_cover_public_url(release_id: int) -> str:
    return f"/api/albums/-{abs(int(release_id))}/cover"
