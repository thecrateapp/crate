"""Migration 164 adds backup policies and links runs to them (admin backups, BK3)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.credentials import store_secret
from crate.db.queries.backup_policies import (
    get_backup_policy,
    list_backup_policies,
    list_enabled_scheduled_policies,
)
from crate.db.queries.backup_runs import (
    latest_destination_runs,
    list_backup_runs,
)
from crate.db.repositories.backup_destinations import insert_backup_destination
from crate.db.repositories.backup_policies import (
    delete_backup_policy,
    insert_backup_policy,
    mark_policy_scheduled,
    set_policy_destinations,
    update_backup_policy,
)
from crate.db.repositories.backup_runs import (
    close_interrupted_backup_runs,
    close_interrupted_destination_runs,
    finish_backup_run,
    start_backup_run,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.backup_policies_v164 import (
    create_backup_policies_v164_schema,
    drop_backup_policies_v164_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.164_backup_policies"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_backup_policies_v164_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "164" and migration.down_revision == "163"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_backup_policies_v164_schema(expected)
    assert downgrade.statements == expected.statements
    assert "DROP TABLE IF EXISTS backup_policies" in downgrade.statements


def _destination(name: str) -> str:
    row = insert_backup_destination(
        kind="local",
        name=name,
        config={"path": name.lower()},
        secret_ref=None,
        repo_password_ref=store_secret("backup_repository", {"password": "pw"}),
    )
    return str(row["id"])


def test_policies_keep_their_schedule_retention_and_tiers(pg_db):
    del pg_db
    volume, bucket = _destination("Volume"), _destination("Bucket")

    nightly = insert_backup_policy(
        name="Nightly",
        schedule_kind="daily",
        daily_at="03:30",
        window_start="02:00",
        window_end="06:00",
        keep_daily=7,
        keep_weekly=4,
        keep_monthly=3,
    )
    manual = insert_backup_policy(
        name="Before upgrades",
        schedule_kind="manual",
        keep_daily=3,
        keep_weekly=0,
        keep_monthly=0,
        run_before_upgrade=True,
    )
    assert nightly["compression"] == "auto"
    assert (nightly["verify_every_days"], nightly["verify_read_percent"]) == (7, 5)
    assert nightly["drill_every_days"] == 30
    assert nightly["drill_destination_id"] is None  # rotate

    set_policy_destinations(
        nightly["id"], {volume: ["daily", "weekly"], bucket: ["weekly", "monthly"]}
    )
    row = get_backup_policy(nightly["id"])
    assert row is not None
    assert row["destinations"] == {
        volume: ["daily", "weekly"],
        bucket: ["weekly", "monthly"],
    }
    # Replacing the tiers replaces the whole set.
    set_policy_destinations(nightly["id"], {bucket: ["daily"]})
    row = get_backup_policy(nightly["id"])
    assert row is not None and row["destinations"] == {bucket: ["daily"]}

    assert [p["name"] for p in list_backup_policies()] == ["Before upgrades", "Nightly"]
    assert [p["id"] for p in list_enabled_scheduled_policies()] == [nightly["id"]]

    updated = update_backup_policy(
        nightly["id"], enabled=False, keep_daily=5, drill_destination_id=bucket
    )
    assert updated is not None
    assert (updated["enabled"], updated["keep_daily"]) == (False, 5)
    assert updated["drill_destination_id"] == bucket
    assert list_enabled_scheduled_policies() == []
    assert manual["run_before_upgrade"] is True

    assert mark_policy_scheduled(nightly["id"])
    marked = get_backup_policy(nightly["id"])
    assert marked is not None and marked["last_scheduled_at"] is not None

    assert delete_backup_policy(manual["id"]) is not None
    assert get_backup_policy(manual["id"]) is None
    assert get_backup_policy("not-a-uuid") is None


def test_runs_belong_to_a_policy_and_a_destination(pg_db):
    del pg_db
    volume, bucket = _destination("Volume"), _destination("Bucket")
    policy = insert_backup_policy(
        name="Nightly", schedule_kind="hours", interval_hours=12, keep_daily=7
    )

    first = start_backup_run(
        "offsite", task_id="t1", policy_id=policy["id"], destination_id=volume
    )
    assert finish_backup_run(
        first, status="succeeded", snapshot_id="a91f03c2", size_bytes=10
    )
    start_backup_run(
        "offsite", task_id="t2", policy_id=policy["id"], destination_id=bucket
    )
    start_backup_run("verify", task_id="t3", destination_id=volume)

    runs = list_backup_runs(destination_id=volume)
    assert [r["kind"] for r in runs] == ["verify", "offsite"]
    assert runs[1]["snapshot_id"] == "a91f03c2"
    assert runs[1]["policy_id"] == policy["id"]
    assert runs[1]["destination_id"] == volume
    assert [r["kind"] for r in list_backup_runs(policy_id=policy["id"])] == [
        "offsite",
        "offsite",
    ]

    latest = latest_destination_runs()
    assert latest[volume]["offsite"]["status"] == "succeeded"
    assert latest[volume]["offsite_succeeded"]["snapshot_id"] == "a91f03c2"
    assert latest[bucket]["offsite"]["status"] == "running"

    # A restart closes the destination's runs, whatever their kind, and only its own.
    assert close_interrupted_destination_runs(volume) == 1
    assert list_backup_runs(destination_id=volume)[0]["status"] == "failed"
    assert list_backup_runs(destination_id=bucket)[0]["status"] == "running"
    # The local runs' recovery leaves the destinations' runs alone.
    assert close_interrupted_backup_runs("offsite") == 0

    # Deleting a destination or a policy keeps its history.
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM backup_destinations WHERE id = CAST(:id AS uuid)"),
            {"id": bucket},
        )
    assert delete_backup_policy(policy["id"]) is not None
    orphaned = list_backup_runs(kind="offsite")
    assert len(orphaned) == 2
    assert all(r["policy_id"] is None for r in orphaned)
    assert {r["destination_id"] for r in orphaned} == {volume, None}


@pytest.mark.parametrize(
    "columns, values",
    [
        ("name, schedule_kind", "'x', 'yearly'"),
        ("name, schedule_kind", "'', 'manual'"),
        ("name, schedule_kind", "'x', 'daily'"),  # daily needs its time
        ("name, schedule_kind, daily_at", "'x', 'daily', '25:00'"),
        ("name, schedule_kind", "'x', 'hours'"),  # hours needs its interval
        ("name, schedule_kind, interval_hours", "'x', 'hours', 0"),
        ("name, schedule_kind, window_start", "'x', 'manual', '02:00'"),
        ("name, schedule_kind, keep_daily", "'x', 'manual', -1"),
        (
            "name, schedule_kind, keep_daily, keep_weekly, keep_monthly",
            "'x', 'manual', 0, 0, 0",
        ),
        ("name, schedule_kind, compression", "'x', 'manual', 'zstd'"),
        ("name, schedule_kind, verify_read_percent", "'x', 'manual', 101"),
    ],
)
def test_the_policy_table_checks_its_values(pg_db, columns, values):
    del pg_db

    with pytest.raises(IntegrityError):
        with transaction_scope() as session:
            session.execute(
                text(f"INSERT INTO backup_policies ({columns}) VALUES ({values})")
            )


def test_tiers_are_daily_weekly_or_monthly(pg_db):
    del pg_db
    volume = _destination("Volume")
    policy = insert_backup_policy(name="Nightly", schedule_kind="manual", keep_daily=1)
    for tiers in ("ARRAY['yearly']", "ARRAY[]::text[]"):
        with pytest.raises(IntegrityError):
            with transaction_scope() as session:
                session.execute(
                    text(
                        "INSERT INTO backup_policy_destinations "
                        "(policy_id, destination_id, tiers) "
                        f"VALUES (CAST(:p AS uuid), CAST(:d AS uuid), {tiers})"
                    ),
                    {"p": policy["id"], "d": volume},
                )
