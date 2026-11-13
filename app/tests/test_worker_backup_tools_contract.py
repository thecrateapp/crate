"""The worker image carries the backups engine's tools, pinned and checked (BK1).

`pg_dump`/`pg_restore` 15 match the PostgreSQL 15 server; `restic` and `rclone`
are release binaries checked against their published SHA-256. The static tests keep
the Dockerfile pinned; the image test runs the binaries of a built image when
``CRATE_WORKER_IMAGE_UNDER_TEST`` names one (for example ``crate-worker:local``).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = (APP_ROOT / "Dockerfile").read_text()
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _stage(name: str) -> str:
    match = re.search(
        rf"^FROM \S+ AS {re.escape(name)}\n(.*?)(?=^FROM |\Z)", DOCKERFILE, re.M | re.S
    )
    assert match is not None, name
    return match.group(1)


def _args(stage: str) -> dict[str, str]:
    return dict(re.findall(r"^ARG (\w+)=(\S+)$", stage, re.M))


def test_restic_and_rclone_are_pinned_and_checked_per_architecture() -> None:
    tools = _stage("backup-tools")
    args = _args(tools)

    assert re.fullmatch(r"\d+\.\d+\.\d+", args["CRATE_RESTIC_VERSION"])
    assert re.fullmatch(r"\d+\.\d+\.\d+", args["CRATE_RCLONE_VERSION"])
    for name in (
        "CRATE_RESTIC_SHA256_AMD64",
        "CRATE_RESTIC_SHA256_ARM64",
        "CRATE_RCLONE_SHA256_AMD64",
        "CRATE_RCLONE_SHA256_ARM64",
    ):
        assert SHA256.match(args[name]), name
    assert 'echo "${restic_sha}  restic.bz2" | sha256sum -c -' in tools
    assert 'echo "${rclone_sha}  rclone.zip" | sha256sum -c -' in tools
    # Any other architecture fails instead of installing an unchecked binary.
    assert "exit 1" in tools.split("case", 1)[1]
    # The build stops if the binary does not report the pinned version.
    assert 'grep -q "^restic ${CRATE_RESTIC_VERSION} "' in tools
    assert 'grep -qx "rclone v${CRATE_RCLONE_VERSION}"' in tools


def test_worker_core_installs_the_postgresql_15_client_pinned() -> None:
    core = _stage("worker-core")
    args = _args(core)

    assert SHA256.match(args["PGDG_ACCC4CF8_ASC_SHA256"])
    assert re.fullmatch(r"15\.\d+-\S+", args["PG_CLIENT_VERSION"])
    assert (
        'echo "${PGDG_ACCC4CF8_ASC_SHA256}  /usr/share/keyrings/pgdg.asc" | sha256sum -c -'
        in core
    )
    assert "signed-by=/usr/share/keyrings/pgdg.asc" in core
    assert '"postgresql-client-15=${PG_CLIENT_VERSION}"' in core
    assert 'ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"' in core
    assert 'grep -q "^pg_dump (PostgreSQL) 15\\."' in core
    assert 'grep -q "^pg_restore (PostgreSQL) 15\\."' in core


def test_only_the_core_worker_image_carries_the_backup_tools() -> None:
    core = _stage("worker-core")

    assert (
        "COPY --from=backup-tools /usr/local/bin/restic /usr/local/bin/rclone "
        "/usr/local/bin/" in core
    )
    # The maintenance queue runs on worker-core; the analysis, playback and API
    # images stay without them.
    for other in ("worker-analysis", "worker-playback", "api", "worker-core-deps"):
        body = _stage(other)
        assert "backup-tools" not in body, other
        assert "postgresql-client" not in body, other


def _image_under_test() -> str:
    image = os.environ.get("CRATE_WORKER_IMAGE_UNDER_TEST", "").strip()
    if not image:
        pytest.skip("set CRATE_WORKER_IMAGE_UNDER_TEST to check a built worker image")
    if shutil.which("docker") is None:
        pytest.skip("docker CLI required")
    return image


def test_built_worker_image_reports_the_pinned_versions() -> None:
    image = _image_under_test()
    tools, core = _args(_stage("backup-tools")), _args(_stage("worker-core"))
    script = "pg_dump --version; pg_restore --version; restic version; rclone version"
    result = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", image, "-c", script],
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    pg_version = core["PG_CLIENT_VERSION"].split("-", 1)[0]
    assert f"pg_dump (PostgreSQL) {pg_version}" in result.stdout
    assert f"pg_restore (PostgreSQL) {pg_version}" in result.stdout
    assert f"restic {tools['CRATE_RESTIC_VERSION']} " in result.stdout
    assert f"rclone v{tools['CRATE_RCLONE_VERSION']}\n" in result.stdout
