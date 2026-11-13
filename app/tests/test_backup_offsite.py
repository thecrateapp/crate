"""Off-site copies, retention, verification and restore drills (admin backups, BK3).

The round-trips use a real restic repository on a local destination and the test
PostgreSQL server; the drill must restore into a throwaway database and leave the
database it was dumped from untouched.
"""

from __future__ import annotations

import os
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from crate.backups import local, offsite
from crate.backups.connection import open_destination, test_destination
from crate.backups.destinations import create_destination, load_destination_secrets
from crate.backups.local import BackupError
from crate.backups.restic import list_snapshots, rclone_bin, restic_bin
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.tx import transaction_scope

REQUIRED = os.environ.get("CRATE_BACKUP_INTEGRATION_REQUIRED") == "1"


def _need(*tools: str) -> None:
    missing = [t for t in tools if shutil.which(t) is None]
    if missing:
        if REQUIRED:
            pytest.fail(f"{', '.join(missing)} required")
        pytest.skip(f"{', '.join(missing)} required")


def policy(**overrides):
    base = {
        "id": "p1",
        "schedule_kind": "daily",
        "daily_at": "03:30",
        "keep_daily": 3,
        "keep_weekly": 0,
        "keep_monthly": 0,
        "compression": "auto",
    }
    base.update(overrides)
    return base


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(root))
    return root


@pytest.fixture
def volume(pg_db, backup_root):
    del pg_db
    _need(restic_bin(), rclone_bin())
    created = create_destination(kind="local", name="Volume", config={"path": "restic"})
    assert test_destination(created["id"]).status == "ok"
    row = get_backup_destination(created["id"])
    assert row is not None
    return row


@pytest.fixture
def dump(tmp_path, pg_db):
    del pg_db
    _need("pg_dump", "pg_restore", "psql")
    with transaction_scope() as session:
        session.execute(text("CREATE TABLE drill_marker (id int PRIMARY KEY)"))
        session.execute(text("INSERT INTO drill_marker VALUES (1), (2), (3)"))
    folder = tmp_path / "dumps"
    folder.mkdir()
    return local.dump_database(
        folder,
        now=datetime(2026, 11, 10, 3, 30, tzinfo=timezone.utc),
        connection=local.connection_from_env(),
    ).path


def _snapshots(row):
    secrets = load_destination_secrets(row)
    with open_destination(row, secrets) as (runner, _):
        return list_snapshots(runner)


def test_a_copy_is_tagged_and_retention_follows_the_policy(volume, dump):
    start = datetime(2026, 11, 1, 3, 30, tzinfo=timezone.utc)
    results = []
    for day in range(6):
        results.append(
            offsite.copy_dump(
                volume,
                policy(),
                dump,
                destination_tiers=["daily"],
                tags=["daily"],
                taken_at=start + timedelta(days=day),
            )
        )
    last = results[-1]
    assert last.snapshot_id
    assert last.tags == ["daily", f"dump:{dump.name}"]
    # keep_daily=3 over six days: the three newest days stay.
    assert last.snapshot_count == 3
    assert sum(r.removed_snapshots for r in results) == 3
    snapshots = _snapshots(volume)
    assert sorted(s["time"][:10] for s in snapshots) == [
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
    ]
    assert all(s["hostname"] == "crate" for s in snapshots)
    assert all(s["paths"] == ["/crate.dump"] for s in snapshots)


def test_manual_copies_never_displace_scheduled_ones(volume, dump):
    taken = datetime(2026, 11, 10, 3, 30, tzinfo=timezone.utc)
    offsite.copy_dump(
        volume,
        policy(keep_daily=1),
        dump,
        destination_tiers=["daily"],
        tags=["daily"],
        taken_at=taken,
    )
    manual = policy(schedule_kind="manual", daily_at=None, keep_daily=1)
    for hours in (1, 2):
        offsite.copy_dump(
            volume,
            manual,
            dump,
            destination_tiers=["daily", "weekly", "monthly"],
            tags=["daily", "weekly", "monthly"],
            taken_at=taken + timedelta(hours=hours),
        )
    hosts = sorted(s["hostname"] for s in _snapshots(volume))
    assert hosts == ["crate", "crate-manual"]


def test_verify_reads_a_subset_of_the_data(volume, dump):
    offsite.copy_dump(
        volume,
        policy(),
        dump,
        destination_tiers=["daily"],
        tags=["daily"],
        taken_at=datetime(2026, 11, 10, 3, 30, tzinfo=timezone.utc),
    )
    result = offsite.verify_destination(volume, read_percent=100)
    assert (result["read_percent"], result["snapshot_count"]) == (100, 1)
    assert [s["paths"] for s in result["snapshots"]] == [["/crate.dump"]]


def test_the_drill_restores_into_a_throwaway_database_only(volume, dump):
    offsite.copy_dump(
        volume,
        policy(),
        dump,
        destination_tiers=["daily"],
        tags=["daily"],
        taken_at=datetime(2026, 11, 10, 3, 30, tzinfo=timezone.utc),
    )
    connection = local.connection_from_env()
    # Production changes after the dump: the drill must not bring the old rows back.
    with transaction_scope() as session:
        session.execute(text("DELETE FROM drill_marker WHERE id = 3"))

    result = offsite.restore_drill(volume, connection=connection)

    assert result.database.startswith("crate_restore_drill_")
    assert result.database != connection.database
    assert result.tables > 10 and result.toc_entries > 10
    assert result.alembic_revision is not None
    assert "users" in result.rows
    # Dropped afterwards, nothing left behind.
    assert offsite.leftover_drill_databases(connection) == []
    assert not list((Path(os.environ["CRATE_BACKUP_DIR"]) / "drills").glob("*.dump"))
    with transaction_scope() as session:
        assert session.execute(
            text("SELECT array_agg(id ORDER BY id) FROM drill_marker")
        ).scalar_one() == [1, 2]


def test_a_drill_without_a_snapshot_fails_cleanly(volume):
    with pytest.raises(BackupError, match="No snapshot"):
        offsite.restore_drill(volume, connection=local.connection_from_env())
    assert offsite.leftover_drill_databases(local.connection_from_env()) == []


# ── the production database is never a target (no tools needed) ─────


def _connection(database="crate"):
    return local.Connection(
        host="db", port="5432", user="crate", password="pw", database=database
    )


@pytest.mark.parametrize(
    "name", ["crate", "crate_restore_drill_", "crate_restore_drill_ABCDEF012345", "x"]
)
def test_only_drill_databases_can_be_targets(name):
    with pytest.raises(BackupError, match="Refusing"):
        offsite._drill_target(name, _connection())


def test_a_production_database_named_like_a_drill_is_refused():
    name = "crate_restore_drill_0123456789ab"
    with pytest.raises(BackupError, match="Refusing"):
        offsite._drill_target(name, _connection(database=name))
    assert offsite._drill_target(name, _connection()) == name


def test_every_database_command_of_a_drill_avoids_production(monkeypatch, tmp_path):
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    commands: list[list[str]] = []

    def fake_run(args, **kwargs):
        commands.append(list(args))
        if args[0] == "pg_restore" and "--list" in args:
            return b"; header\n1; 0 0 TABLE public users crate\n"
        if args[0] == "psql":
            sql = args[-1]
            if "count(*) FROM pg_tables" in sql:
                return b"40"
            if "tablename IN" in sql:
                return b"users\nalembic_version"
            if "version_num" in sql:
                return b"164"
            if "count(*)" in sql:
                return b"2"
        return b""

    class FakeRunner:
        timeout_seconds = None

    class FakeOpen:
        def __enter__(self):
            return FakeRunner(), tmp_path

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(offsite, "run_command", fake_run)
    monkeypatch.setattr(offsite, "load_destination_secrets", lambda row: None)
    monkeypatch.setattr(offsite, "open_destination", lambda *a, **k: FakeOpen())
    monkeypatch.setattr(
        offsite,
        "list_snapshots",
        lambda runner: [{"id": "abc", "short_id": "abc", "paths": ["/crate.dump"]}],
    )
    monkeypatch.setattr(offsite, "restore_file", lambda *a: None)

    result = offsite.restore_drill({"kind": "local"}, connection=_connection())

    assert result.rows == {"alembic_version": 2, "users": 2}
    targets = [c[c.index("-d") + 1] for c in commands if "-d" in c]
    assert "crate" not in targets
    assert set(targets) == {"postgres", result.database}
    # The drop always runs, after the restore.
    assert "DROP DATABASE" in commands[-1][-1]
    # The password never reaches a command line.
    assert not any("pw" in arg for c in commands for arg in c)
