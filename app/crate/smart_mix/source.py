from __future__ import annotations

import hashlib
import os
from pathlib import Path


def smart_mix_source_revision_from_stat(stat: os.stat_result) -> str:
    identity = f"{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ino}"
    return hashlib.sha256(identity.encode()).hexdigest()


def smart_mix_source_revision(path: str | Path) -> str:
    source = Path(path)
    try:
        return smart_mix_source_revision_from_stat(source.stat())
    except OSError:
        return hashlib.sha256(f"missing:{source}".encode()).hexdigest()


__all__ = ["smart_mix_source_revision", "smart_mix_source_revision_from_stat"]
