"""``python -m crate.backups.cli before-upgrade``: the deploy's hook (BG1-15)."""

from __future__ import annotations

from pathlib import Path

import pytest

from crate.backups import cli
from crate.db.repositories.backup_policies import insert_backup_policy

ROOT = Path(__file__).resolve().parents[2]


class FakeTasks:
    def __init__(self, outcomes):
        self.outcomes = outcomes
        self.created: list[tuple[str, dict, str]] = []

    def create(self, task_type, params, *, dedup_key):
        self.created.append((task_type, params, dedup_key))
        return f"task-{len(self.created)}"

    def get(self, task_id):
        return self.outcomes.get(task_id)


@pytest.fixture
def tasks(monkeypatch):
    fake = FakeTasks({})
    monkeypatch.setattr(cli, "create_task_dedup", fake.create)
    monkeypatch.setattr(cli, "get_task", fake.get)
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)
    return fake


def test_nothing_to_do_without_a_before_upgrade_policy(pg_db, tasks, capsys):
    del pg_db
    insert_backup_policy(name="Nightly", schedule_kind="daily", daily_at="03:30")
    assert cli.main(["before-upgrade", "--wait"]) == 0
    assert tasks.created == []
    assert "No backup policy runs before upgrades" in capsys.readouterr().out


def test_it_runs_the_policy_and_waits_for_every_copy(pg_db, tasks, capsys):
    del pg_db
    policy = insert_backup_policy(
        name="Before upgrades", schedule_kind="manual", run_before_upgrade=True
    )
    insert_backup_policy(
        name="Off", schedule_kind="manual", run_before_upgrade=True, enabled=False
    )
    tasks.outcomes = {
        "task-1": {
            "status": "completed",
            "result": {"run_id": "r", "offsite_task_ids": ["copy-1", "copy-2"]},
        },
        "copy-1": {"status": "completed", "result": {"snapshot_id": "a91f03c2"}},
        "copy-2": {"status": "completed", "result": {"snapshot_id": "7c2e91fa"}},
    }

    assert cli.main(["before-upgrade", "--wait", "--timeout", "60"]) == 0
    assert tasks.created == [
        (
            "backup_dump",
            {
                "policy_id": policy["id"],
                "ignore_maintenance_window": True,
                "reason": "before_upgrade",
            },
            f"backup_policy:{policy['id']}",
        )
    ]
    out = capsys.readouterr().out
    assert "Before upgrades: 2 copies done" in out


@pytest.mark.parametrize(
    "outcomes, code, message",
    [
        (
            {
                "task-1": {
                    "status": "completed",
                    "result": {
                        "status": "skipped",
                        "reason": "Local backups are off (CRATE_LOCAL_BACKUPS_ENABLED)",
                    },
                }
            },
            1,
            "Local backups are off",
        ),
        (
            {
                "task-1": {
                    "status": "completed",
                    "result": {"offsite_task_ids": ["copy-1"]},
                },
                "copy-1": {
                    "status": "completed",
                    "result": {"status": "failed", "error": "Permission denied"},
                },
            },
            1,
            "Permission denied",
        ),
        ({"task-1": {"status": "failed", "error": "boom"}}, 1, "boom"),
        ({"task-1": {"status": "running"}}, 2, "Timed out"),
    ],
)
def test_it_fails_loudly(pg_db, tasks, capsys, outcomes, code, message):
    del pg_db
    insert_backup_policy(
        name="Before upgrades", schedule_kind="manual", run_before_upgrade=True
    )
    tasks.outcomes = outcomes
    assert cli.main(["before-upgrade", "--wait", "--timeout", "0"]) == code
    assert message in capsys.readouterr().err


def test_without_wait_it_only_queues(pg_db, tasks):
    del pg_db
    insert_backup_policy(
        name="Before upgrades", schedule_kind="manual", run_before_upgrade=True
    )
    assert cli.main(["before-upgrade"]) == 0
    assert len(tasks.created) == 1


def test_the_make_target_calls_the_hook():
    makefile = (ROOT / "Makefile").read_text()
    assert "backup-before-upgrade:" in makefile
    assert "python -m crate.backups.cli before-upgrade --wait" in makefile


def test_waiting_prints_a_line_every_minute_for_the_deploy(monkeypatch, capsys):
    statuses = iter(["pending", "running", "running", "running", "completed"])
    monkeypatch.setattr(
        cli, "get_task", lambda task_id: {"status": next(statuses), "result": {}}
    )
    ticks = iter(range(0, 1000, 30))
    monkeypatch.setattr(cli.time, "monotonic", lambda: float(next(ticks)))
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)

    assert cli._wait("task-9", deadline=10_000) == {}
    lines = capsys.readouterr().out.splitlines()
    assert lines == ["Waiting for task task-9 (running)"] * len(lines)
    assert 1 <= len(lines) <= 2
