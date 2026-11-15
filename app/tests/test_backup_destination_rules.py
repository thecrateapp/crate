"""Destination rules for the Admin API (BK4): snapshot cache, first test enables,
test before save without storing a secret (migration 165, BG1-9, BG1-11)."""

from __future__ import annotations

import shutil
from importlib import import_module

import pytest
from sqlalchemy import text

from crate.backups import ephemeral
from crate.backups.connection import probe_unsaved, test_destination
from crate.backups.destinations import create_destination
from crate.backups.restic import rclone_bin, restic_bin
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.repositories.backup_destinations import (
    record_destination_check,
    update_backup_destination,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.backup_destination_snapshots_v165 import (
    create_backup_destination_snapshots_v165_schema,
    drop_backup_destination_snapshots_v165_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.165_backup_destination_snapshots"
SECRET = "probe-secret-never-stored"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_backup_destination_snapshots_v165_schema(section)
    create_schema(bootstrap)
    assert migration.revision == "165" and migration.down_revision == "164"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)
    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_backup_destination_snapshots_v165_schema(expected)
    assert downgrade.statements == expected.statements


def test_a_check_caches_the_snapshot_list(pg_db, tmp_path, monkeypatch):
    del pg_db
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    row = create_destination(kind="local", name="Volume", config={"path": "r"})
    snapshots = [
        {
            "id": "a91f03c2",
            "time": "2026-11-10T03:37:00Z",
            "host": "crate",
            "tags": ["daily"],
            "paths": ["/crate.dump"],
        },
    ]
    assert record_destination_check(
        row["id"], status="ok", snapshot_count=1, snapshots=snapshots
    )
    stored = get_backup_destination(row["id"])
    assert stored is not None
    assert stored["snapshots"] == snapshots
    assert stored["snapshots_listed_at"] is not None
    # A failed check keeps the last listing.
    assert record_destination_check(row["id"], status="failing", error="down")
    kept = get_backup_destination(row["id"])
    assert kept is not None and kept["snapshots"] == snapshots


def test_the_first_passing_test_enables_a_destination(pg_db, tmp_path, monkeypatch):
    """BG1-11: a destination stays disabled until its first test passes."""
    del pg_db
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    row = create_destination(
        kind="local", name="Volume", config={"path": "r"}, enabled=False
    )
    record_destination_check(row["id"], status="failing", error="down")
    assert get_backup_destination(row["id"])["enabled"] is False
    record_destination_check(row["id"], status="ok", initialized=True)
    assert get_backup_destination(row["id"])["enabled"] is True
    # Turned off by the operator later, a passing test leaves it off.
    update_backup_destination(row["id"], enabled=False)
    record_destination_check(row["id"], status="ok", initialized=True)
    assert get_backup_destination(row["id"])["enabled"] is False


def test_unsaved_settings_travel_encrypted_and_once(monkeypatch):
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.delenv("REDIS_URL", raising=False)
    probe_id = ephemeral.put({"kind": "s3", "secrets": {"secret_access_key": SECRET}})
    stored = ephemeral._memory[ephemeral._key(probe_id)]
    assert SECRET not in stored
    assert ephemeral.take(probe_id) == {
        "kind": "s3",
        "secrets": {"secret_access_key": SECRET},
    }
    assert ephemeral.take(probe_id) is None
    assert ephemeral.take("not-a-probe") is None


def test_unsaved_settings_are_never_written_to_postgres(pg_db, monkeypatch, tmp_path):
    del pg_db
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.delenv("REDIS_URL", raising=False)
    ephemeral.put({"kind": "s3", "secrets": {"secret_access_key": SECRET}})
    with transaction_scope() as session:
        dump = session.execute(
            text(
                "SELECT coalesce(string_agg(ciphertext, ''), '') FROM credential_secrets"
            )
        ).scalar_one()
        tasks = session.execute(
            text("SELECT coalesce(string_agg(params_json::text, ''), '') FROM tasks")
        ).scalar_one()
    assert SECRET not in dump and SECRET not in tasks


@pytest.mark.skipif(
    shutil.which(rclone_bin()) is None or shutil.which(restic_bin()) is None,
    reason="restic and rclone required",
)
def test_probing_unsaved_local_settings(pg_db, tmp_path, monkeypatch):
    del pg_db
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    empty = probe_unsaved("local", {"path": "restic"}, {})
    assert empty.status == "ok" and empty.repository == "empty"
    # Nothing is left where the probe wrote.
    assert not any((tmp_path / "restic").iterdir())

    saved = create_destination(kind="local", name="Volume", config={"path": "restic"})
    assert test_destination(saved["id"]).status == "ok"
    existing = probe_unsaved("local", {"path": "restic"}, {})
    assert existing.status == "ok" and existing.repository == "existing"

    bad = probe_unsaved("local", {"path": "../outside"}, {})
    assert bad.status == "failing" and "path" in bad.error.lower()


@pytest.mark.skipif(shutil.which(rclone_bin()) is None, reason="rclone required")
def test_the_probe_task_takes_the_settings_once(pg_db, tmp_path, monkeypatch):
    del pg_db
    from crate.worker_handlers import backups

    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setattr(backups, "is_cancelled", lambda task_id: False)
    probe_id = ephemeral.put(
        {"kind": "local", "config": {"path": "restic"}, "secrets": {}}
    )

    first = backups._handle_backup_probe_destination("t1", {"probe_id": probe_id}, {})
    assert first["connection"]["status"] == "ok"
    assert first["connection"]["repository"] == "empty"
    again = backups._handle_backup_probe_destination("t2", {"probe_id": probe_id}, {})
    assert again["connection"]["status"] == "failing"
    assert "expired" in again["connection"]["error"]


def test_the_probe_task_is_wired():
    from crate.actors import TASK_POOL_CONFIG
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    config = TASK_POOL_CONFIG["backup_probe_destination"]
    assert (config.queue, config.priority, config.max_retries) == ("default", 0, 0)
    assert "backup_probe_destination" in TASK_TYPES
    assert "backup_probe_destination" in TASK_HANDLERS
