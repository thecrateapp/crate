"""Checks and outputs shared by the VirtualDJ plugin packagers."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

FORBIDDEN_NAMES = {"vdjPlugin8.h", "vdjOnlineSource.h", "vdjDsp8.h", "vdjVideo8.h"}
TOKEN_PATTERN = re.compile(rb"crv_[A-Za-z0-9_-]{40,}")


class PackagingError(RuntimeError):
    pass


def shipped_file_problems(path: Path) -> list[str]:
    if path.name in FORBIDDEN_NAMES or "probe" in path.name.lower():
        return [f"{path.name} must not ship"]
    if TOKEN_PATTERN.search(path.read_bytes()):
        return [f"{path.name} contains an access token"]
    return []


def supported_contracts(header: Path) -> list[str]:
    match = re.search(
        r"supported_contract_versions\s*=\s*\{([^}]*)\}", header.read_text()
    )
    if match is None:
        raise PackagingError(f"no supported contract versions in {header}")
    return re.findall(r'"([^"]+)"', match.group(1))


def plugin_version(header: Path) -> str:
    match = re.search(r'kPluginVersion\s*=\s*"([^"]+)"', header.read_text())
    if match is None:
        raise PackagingError(f"no plugin version in {header}")
    return match.group(1)


def base_manifest(
    *,
    platform: str,
    version: str,
    contracts: list[str],
    tested_virtualdj: list[str],
    archive: str,
    sha256: str,
    install_path: str,
    signing: str,
) -> dict:
    return {
        "plugin": "Crate",
        "version": version,
        "platform": platform,
        "archive": archive,
        "sha256": sha256,
        "crate_contracts": contracts,
        "virtualdj_tested": tested_virtualdj,
        "requires": "VirtualDJ Pro",
        "install_path": install_path,
        "signing": signing,
    }


def write_checksum(archive: Path) -> str:
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_name(f"{archive.name}.sha256").write_bytes(
        f"{digest}  {archive.name}\n".encode()
    )
    return digest


def write_manifest(output: Path, platform: str, manifest: dict) -> None:
    (output / f"manifest-{platform}.json").write_bytes(
        (json.dumps(manifest, indent=2) + "\n").encode()
    )
