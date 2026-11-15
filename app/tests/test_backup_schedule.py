"""The default local backup policy and the flag that keeps it off (admin backups, BK1)."""

from __future__ import annotations

import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from crate.backups.local import BackupError
from crate.backups.settings import prepare_dumps_dir
from crate.db.queries.backup_runs import list_backup_runs
from crate.scheduler import DEFAULT_SCHEDULES, guarded_run_schedule, should_run
from crate.worker_handlers import backups

ROOT = Path(__file__).resolve().parents[2]
FLAG = "CRATE_LOCAL_BACKUPS_ENABLED"


class _Allowed:
    allowed = True
    reason = ""
    defer_seconds = 0


def test_every_install_schedules_a_nightly_dump_and_no_separate_retention():
    assert DEFAULT_SCHEDULES["backup_dump"] == 86400
    # Retention follows each good dump instead of running on its own clock.
    assert "backup_local_retention" not in DEFAULT_SCHEDULES


@pytest.mark.parametrize("raw, due", [(None, True), ("true", True), ("false", False)])
def test_the_flag_gates_the_scheduled_dump(monkeypatch, raw, due):
    if raw is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, raw)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()

    with (
        patch("crate.scheduler.get_setting", return_value=yesterday),
        patch("crate.scheduler.list_tasks", return_value=[]),
    ):
        assert should_run("backup_dump", {"backup_dump": 86400}) is due


def test_an_admin_run_now_is_unavailable_with_the_flag_off(monkeypatch):
    monkeypatch.setenv(FLAG, "false")
    enqueued: list[str] = []
    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task", lambda *args: _Allowed()
    )
    monkeypatch.setattr(
        "crate.db.repositories.runtime_policy.enqueue_schedule",
        lambda task_type, **kwargs: enqueued.append(task_type),
    )

    result = guarded_run_schedule("backup_dump", origin="admin")

    assert result["status"] == "unavailable"
    assert enqueued == []


def test_with_the_flag_off_the_tasks_do_nothing(pg_db, tmp_path, monkeypatch):
    del pg_db
    monkeypatch.setenv(FLAG, "off")
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    old = dumps / "crate-20200101T000000Z.dump"
    old.write_bytes(b"PGDMP")
    newer = dumps / "crate-20260101T000000Z.dump"
    newer.write_bytes(b"PGDMP")

    dump = backups._handle_backup_dump("task-dump", {}, {})
    retention = backups._handle_backup_local_retention(
        "task-ret", {"keep_daily": 0, "keep_weekly": 0, "keep_monthly": 0}, {}
    )

    expected = {"status": "skipped", "reason": f"Local backups are off ({FLAG})"}
    assert dump == retention == expected
    assert sorted(p.name for p in dumps.iterdir()) == [old.name, newer.name]
    assert list_backup_runs() == []


def test_the_default_backup_dir_is_created_inside_data_dir(monkeypatch, tmp_path):
    monkeypatch.delenv("CRATE_BACKUP_DIR", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    assert prepare_dumps_dir() == tmp_path / "backups" / "dumps"
    assert (tmp_path / "backups" / "dumps").is_dir()
    assert stat.S_IMODE((tmp_path / "backups" / "dumps").stat().st_mode) == 0o700

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "missing"))
    with pytest.raises(BackupError):
        prepare_dumps_dir()
    assert not (tmp_path / "missing").exists()


def test_a_configured_backup_dir_must_already_exist(monkeypatch, tmp_path):
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path / "volume"))

    with pytest.raises(BackupError, match="does not exist"):
        prepare_dumps_dir()
    assert not (tmp_path / "volume").exists()

    (tmp_path / "volume").mkdir()
    assert prepare_dumps_dir() == tmp_path / "volume" / "dumps"


def _environment(service: dict) -> dict[str, str]:
    raw = service.get("environment", {})
    if isinstance(raw, dict):
        return {key: str(value) for key, value in raw.items()}
    return dict(entry.split("=", 1) for entry in raw)


def test_production_compose_keeps_the_engine_off_beside_the_sidecar():
    services = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"]

    assert "crate-postgres-backup" in services
    for name in ("crate-worker", "crate-maintenance-worker"):
        assert _environment(services[name])[FLAG] == f"${{{FLAG}:-false}}", name
    # The fast worker extends crate-worker and so inherits the flag.
    assert services["crate-fast-worker"]["extends"]["service"] == "crate-worker"


def test_home_installs_keep_the_engine_on():
    for compose in (
        ROOT / "docker-compose.home.yaml",
        ROOT / "app/installer/internal/assets/files/docker-compose.home.yaml",
    ):
        text = compose.read_text()
        services = yaml.safe_load(text)["services"]
        assert "crate-postgres-backup" not in services
        assert FLAG not in text


def test_env_example_documents_the_flag():
    text = (ROOT / ".env.example").read_text()

    assert f"# {FLAG}=false" in text
