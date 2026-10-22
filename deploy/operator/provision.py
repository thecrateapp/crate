"""Offline root-only scaffold for an explicitly reviewed source checkout.

No Docker/systemctl/network calls, credentials copied, permissions activated, or
existing live checkout moved. Administrator provisions separate secrets/config next.
"""

import argparse
import os
import shutil
from pathlib import Path

from .infra_policy import trusted_file

SOURCE_FILES = (
    "scripts/deploy-remote.sh",
    "scripts/release_manifest.py",
    "docker-compose.yaml",
    "docker-compose.project.yaml",
)
ROOT = Path("/opt/crate-operator")
HOST = Path("/opt/crate-host")


def provision(source):
    if os.geteuid() != 0:
        raise PermissionError("Root-owned provisioning required")
    if ROOT.exists() or HOST.exists():
        raise ValueError("Existing operator or host root must be maintained explicitly")
    source = source.resolve(strict=True)
    trusted_file(source)
    for relative in SOURCE_FILES:
        trusted_file(source / relative)
    for base in ("deploy/hermes", "deploy/operator"):
        for path in (source / base).rglob("*"):
            trusted_file(path)
    ROOT.mkdir(mode=0o755)
    HOST.mkdir(mode=0o755)
    for directory in (
        "context/public",
        "context/releases",
        "assets",
        "home",
        "supervisor-state",
        "secrets",
        "secrets/domain",
        "secrets/domain-native",
        "secrets/infra-native",
        "secrets/supervisor-native",
        "secrets/delivery",
        "secrets/infra-client",
        "secrets/supervisor-client",
        "secrets/supervisor",
    ):
        (ROOT / directory).mkdir(parents=True, exist_ok=True)
    for base in ("deploy/hermes", "deploy/operator"):
        shutil.copytree(source / base, ROOT / "assets" / base)
        shutil.copytree(source / base, HOST / base)
    for relative in SOURCE_FILES:
        target = HOST / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target)
    (ROOT / "assets/scripts").mkdir()
    shutil.copyfile(
        source / "scripts/release_manifest.py",
        ROOT / "assets/scripts/release_manifest.py",
    )
    (HOST / ".deploy").mkdir()
    (HOST / ".deploy-backups").mkdir()
    shutil.copyfile(
        source / "deploy/operator/compose.operator.yaml",
        HOST / ".deploy/hermes.compose.yaml",
    )
    # Explicit absent .env keeps the host executor disabled until the actual
    # administrator config/library mounts and image approvals have been reviewed.
    return {"operator_root": str(ROOT), "host_root": str(HOST), "activated": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reviewed-source", required=True, type=Path)
    parser.add_argument("--install-scaffold", action="store_true")
    args = parser.parse_args()
    if not args.install_scaffold:
        parser.error(
            "Explicit --install-scaffold required; this does not activate services"
        )
    print(provision(args.reviewed_source))
