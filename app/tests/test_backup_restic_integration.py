"""restic round-trips through real destinations (admin backups, BK2).

Needs restic and rclone (``CRATE_RESTIC_BIN`` / ``CRATE_RCLONE_BIN`` or PATH) and,
for MinIO and SFTP, Docker. The images are pinned by digest: MinIO stands in for
Cloudflare R2's S3 API (the frozen Bitnami build, as in the off-site sidecar's CI)
and atmoz/sftp for a Hetzner Storage Box. Each test creates a destination through
``crate.backups.destinations``, runs the connection test, backs up a file, lists
the snapshot and restores the same bytes; no secret may appear in any output.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from crate.backups.connection import open_destination, test_destination
from crate.backups.destinations import (
    create_destination,
    get_destination,
    load_destination_secrets,
)
from crate.backups.restic import (
    backup_file,
    list_snapshots,
    rclone_bin,
    restic_bin,
    restore_file,
)
from crate.db.queries.backup_destinations import get_backup_destination

MINIO_IMAGE = (
    "bitnamilegacy/minio@sha256:"
    "8935e75fa5d11295c17171e4aa49efe390a1193cd7f12e4d21b92af9ffef09d7"
)
SFTP_IMAGE = (
    "atmoz/sftp@sha256:c5fb9e4beb8b7054a4c0b65c5e11df47cc20da95ad6002e88aecff62bab06372"
)
MINIO_SECRET = "minio-secret-key-must-never-leak"

# The Backups engine workflow sets this: there a missing tool fails instead of skipping.
REQUIRED = os.environ.get("CRATE_BACKUP_INTEGRATION_REQUIRED") == "1"


def _unavailable(reason: str) -> None:
    if REQUIRED:
        pytest.fail(reason)
    pytest.skip(reason)


@pytest.fixture(autouse=True)
def backup_tools():
    if shutil.which(restic_bin()) is None or shutil.which(rclone_bin()) is None:
        _unavailable(
            "restic and rclone are required (CRATE_RESTIC_BIN / CRATE_RCLONE_BIN)"
        )


def _docker() -> None:
    if shutil.which("docker") is None:
        _unavailable("docker is required")
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        _unavailable("docker is not reachable")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait(predicate, what: str, seconds: float = 90) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(1)
    raise AssertionError(f"{what} did not start")


def _run_container(*args: str) -> str:
    result = subprocess.run(
        ["docker", "run", "-d", "--rm", *args], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(root))
    return root


@pytest.fixture(scope="module")
def minio():
    _docker()
    port = _free_port()
    container = _run_container(
        "-p",
        f"127.0.0.1:{port}:9000",
        "-e",
        "MINIO_ROOT_USER=crateaccess",
        "-e",
        f"MINIO_ROOT_PASSWORD={MINIO_SECRET}",
        MINIO_IMAGE,
    )

    def ready() -> bool:
        probe = subprocess.run(
            [
                "docker",
                "exec",
                container,
                "curl",
                "-fs",
                "http://localhost:9000/minio/health/ready",
            ],
            capture_output=True,
        )
        return probe.returncode == 0

    try:
        _wait(ready, "MinIO")
        yield {"endpoint": f"http://127.0.0.1:{port}", "access": "crateaccess"}
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)


def _round_trip(destination_id: str, tmp_path: Path, caplog, *secrets: str) -> None:
    result = test_destination(destination_id)
    assert result.status == "ok", result.error
    assert result.repository == "initialized"
    assert result.snapshot_count == 0

    # A second test finds the repository already there.
    again = test_destination(destination_id)
    assert (again.status, again.repository) == ("ok", "existing")

    row = get_backup_destination(destination_id)
    assert row is not None
    source = tmp_path / "crate-20261110T030000Z.dump"
    source.write_bytes(b"PGDMP" + os.urandom(256 * 1024))
    with open_destination(row, load_destination_secrets(row)) as (runner, _):
        summary = backup_file(
            runner,
            source,
            filename="crate.dump",
            tags=["daily", "dump:crate-20261110T030000Z.dump"],
            taken_at="2026-11-10 03:00:00",
        )
        snapshots = list_snapshots(runner, host="crate", tags=["daily"])
        assert [s["id"] for s in snapshots] == [summary["snapshot_id"]]
        restored = tmp_path / "restored.dump"
        restore_file(runner, summary["snapshot_id"], "crate.dump", restored)
    assert restored.read_bytes() == source.read_bytes()

    after = test_destination(destination_id)
    assert after.snapshot_count == 1 and (after.repository_bytes or 0) > 0
    view = get_destination(destination_id)
    assert view is not None and view["status"] == "ok"
    assert view["snapshot_count"] == 1
    serialized = json.dumps(view, default=str)
    for secret in (*secrets, load_destination_secrets(row).repository_password):
        assert secret not in serialized
        assert secret not in caplog.text


def test_local_volume_round_trip(pg_db, backup_root, tmp_path, caplog):
    del pg_db
    caplog.set_level(logging.DEBUG)
    view = create_destination(kind="local", name="Volume", config={"path": "restic"})

    _round_trip(view["id"], tmp_path, caplog)
    assert (backup_root / "restic" / "config").is_file()


def test_s3_round_trip_against_minio(pg_db, backup_root, minio, tmp_path, caplog):
    del pg_db, backup_root
    caplog.set_level(logging.DEBUG)
    view = create_destination(
        kind="s3",
        name="MinIO",
        config={
            "endpoint": minio["endpoint"],
            "bucket": f"crate-{uuid.uuid4().hex[:8]}",
            "prefix": "pg",
            "region": "us-east-1",
            "bucket_lookup": "path",
        },
        secrets={"access_key_id": minio["access"], "secret_access_key": MINIO_SECRET},
    )

    _round_trip(view["id"], tmp_path, caplog, MINIO_SECRET)


def test_s3_errors_are_stored_without_the_secret(pg_db, backup_root, minio, caplog):
    del pg_db, backup_root
    caplog.set_level(logging.DEBUG)
    wrong = f"{MINIO_SECRET}-but-wrong"
    view = create_destination(
        kind="s3",
        name="Wrong key",
        config={
            "endpoint": minio["endpoint"],
            "bucket": "crate-wrong",
            "bucket_lookup": "path",
        },
        secrets={"access_key_id": minio["access"], "secret_access_key": wrong},
    )

    result = test_destination(view["id"])
    assert result.status == "failing" and result.error
    stored = get_destination(view["id"])
    assert stored is not None and stored["status"] == "failing"
    assert stored["last_error"]
    for text in (stored["last_error"], caplog.text, json.dumps(stored, default=str)):
        assert wrong not in text and MINIO_SECRET not in text


def test_sftp_round_trip_with_the_generated_key(pg_db, backup_root, tmp_path, caplog):
    del pg_db, backup_root
    _docker()
    caplog.set_level(logging.DEBUG)
    port = _free_port()
    view = create_destination(
        kind="sftp",
        name="Storage Box",
        config={
            "host": "127.0.0.1",
            "port": port,
            "user": "crate",
            "path": "upload/restic",
        },
    )
    keys = tmp_path / "keys"
    keys.mkdir()
    (keys / "crate.pub").write_text(view["config"]["public_key"] + "\n")
    container = _run_container(
        "-p",
        f"127.0.0.1:{port}:22",
        "-v",
        f"{keys}:/home/crate/.ssh/keys:ro",
        SFTP_IMAGE,
        "crate::1001:1001:upload",
    )
    try:
        _wait(
            lambda: (
                subprocess.run(
                    ["ssh-keyscan", "-p", str(port), "127.0.0.1"], capture_output=True
                ).stdout.strip()
                != b""
            ),
            "SFTP",
        )
        row = get_backup_destination(view["id"])
        assert row is not None
        private = load_destination_secrets(row).credentials["private_key"]

        _round_trip(view["id"], tmp_path, caplog, private)

        # The host key seen on first contact is now pinned.
        pinned = get_destination(view["id"])
        assert pinned is not None and "ssh-" in pinned["config"]["known_hosts"]
        assert pinned["config"]["public_key"] == view["config"]["public_key"]
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)
