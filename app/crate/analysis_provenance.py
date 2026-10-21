"""Evidence recorded with a completed daemon result."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
from functools import lru_cache
from pathlib import Path


def source_identity(raw: str) -> dict:
    path = Path(raw)
    if any(component.is_symlink() for component in (path, *path.parents)):
        raise ValueError("Analysis source is a symbolic link")
    stat = path.stat()
    return {
        "path": str(path),
        "device": stat.st_dev,
        "inode": stat.st_ino,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "ctime_ns": stat.st_ctime_ns,
    }


def source_version(source: dict) -> str:
    return hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()


@lru_cache(maxsize=16)
def _digest(raw: str, size: int, mtime_ns: int) -> str:
    digest = hashlib.sha256()
    with Path(raw).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hash(path: Path) -> str | None:
    try:
        stat = path.stat()
        return _digest(str(path), stat.st_size, stat.st_mtime_ns)
    except OSError:
        return None


def result_signature(pipeline: str, source: dict, components: list[str]) -> str:
    from crate.crate_cli import find_binary

    binary = find_binary() if "crate-cli" in components else None
    packages = {}
    for package in ("essentia", "librosa", "torch", "panns-inference"):
        try:
            packages[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            packages[package] = None
    module = Path(__file__).with_name(
        "audio_analysis.py" if pipeline == "analysis" else "bliss.py"
    )
    return json.dumps(
        {
            "schema_version": 1,
            "pipeline": pipeline,
            "implementation_sha256": _hash(module),
            "components_invoked": sorted(set(components)),
            "packages": packages,
            "binary_sha256": _hash(Path(binary)) if binary else None,
            "model_sha256": _hash(Path("/app/panns_data/Cnn14_mAP=0.431.pth"))
            if "panns-cnn14" in components
            else None,
            "source_version": source_version(source),
        },
        sort_keys=True,
    )


__all__ = ["source_identity", "source_version", "result_signature"]
