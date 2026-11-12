"""Off-site copies, verification and restore drills of one destination (BK3).

- ``copy_dump``: ``restic backup --stdin`` of a local dump as ``/crate.dump``, tagged
  with the tiers it stands for and ``dump:<file name>``, then ``restic forget`` with
  the policy's retention for the tiers that destination receives, then ``prune``.
- ``verify_destination``: ``restic check --read-data-subset=<n>%``.
- ``restore_drill``: ``restic dump`` of the newest ``crate.dump`` snapshot, then
  ``pg_restore --list``, then a restore into a throwaway database
  ``crate_restore_drill_<hex>`` on the same PostgreSQL server, a few sanity
  queries, and a drop (decision D5). Every command that names a database goes
  through ``_drill_target``, which refuses the production database; the server is
  only reached otherwise through its maintenance database (``postgres``), to
  create and drop the drill's.

The caller holds the destination's advisory lock. The database password reaches
``pg_restore`` and ``psql`` only through their environment and is scrubbed from
errors, like the repository secrets.
"""

from __future__ import annotations

import os
import re
import secrets as token_source
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from crate.backups import policies
from crate.backups.connection import open_destination
from crate.backups.destinations import load_destination_secrets
from crate.backups.local import BackupError, Connection
from crate.backups.restic import (
    Runner,
    backup_file,
    list_snapshots,
    repository_size,
    restore_file,
    run_command,
    unlock_stale,
)
from crate.backups.settings import backup_dir

DUMP_FILENAME = "crate.dump"
DRILL_PREFIX = "crate_restore_drill_"
DRILL_FOLDER = "drills"
MAINTENANCE_DATABASE = "postgres"
SANITY_TABLES = (
    "alembic_version",
    "users",
    "library_artists",
    "library_albums",
    "library_tracks",
)
_DRILL_NAME = re.compile(rf"^{DRILL_PREFIX}[0-9a-f]{{12}}$")
COPY_TIMEOUT_SECONDS = 6 * 3600 - 600
VERIFY_TIMEOUT_SECONDS = 6 * 3600 - 600
DRILL_TIMEOUT_SECONDS = 4 * 3600 - 600


@dataclass(slots=True)
class CopyResult:
    snapshot_id: str
    bytes_added: int | None
    snapshot_count: int
    repository_bytes: int | None
    removed_snapshots: int
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class DrillResult:
    snapshot_id: str
    snapshot_time: str | None
    database: str
    toc_entries: int
    tables: int
    rows: dict[str, int]
    alembic_revision: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _restic_time(at: datetime) -> str:
    """restic's ``--time`` takes local wall-clock time without a zone."""
    return at.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _removed(forget_output: Any) -> int:
    if not isinstance(forget_output, list):
        return 0
    return sum(len(group.get("remove") or []) for group in forget_output)


def copy_dump(
    row: Mapping[str, Any],
    policy: Mapping[str, Any],
    dump_path: Path,
    *,
    destination_tiers: Sequence[str],
    tags: Sequence[str],
    taken_at: datetime,
    recover_locks: bool = False,
    should_cancel: Callable[[], bool] | None = None,
) -> CopyResult:
    """Copy one dump to the destination and apply the policy's retention there."""
    secrets = load_destination_secrets(dict(row))
    with open_destination(dict(row), secrets, should_cancel=should_cancel) as (
        runner,
        _,
    ):
        runner.timeout_seconds = COPY_TIMEOUT_SECONDS
        if recover_locks:
            unlock_stale(runner)
        snapshot_tags = [*tags, f"dump:{dump_path.name}"]
        summary = backup_file(
            runner,
            dump_path,
            filename=DUMP_FILENAME,
            tags=snapshot_tags,
            taken_at=_restic_time(taken_at),
            host=policies.snapshot_host(policy),
            extra_args=["--compression", str(policy.get("compression") or "auto")],
        )
        forgotten = runner.json(
            "forget", *policies.forget_arguments(policy, destination_tiers)
        )
        removed = _removed(forgotten)
        if removed:
            runner.run("prune")
        snapshots = list_snapshots(runner)
        size = repository_size(runner)
    added = summary.get("data_added")
    return CopyResult(
        snapshot_id=str(summary.get("snapshot_id") or "")[:64],
        bytes_added=int(added) if isinstance(added, int) else None,
        snapshot_count=len(snapshots),
        repository_bytes=size,
        removed_snapshots=removed,
        tags=snapshot_tags,
    )


def verify_destination(
    row: Mapping[str, Any],
    *,
    read_percent: int,
    recover_locks: bool = False,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """``restic check`` reading a random ``read_percent`` of the data."""
    percent = max(1, min(100, int(read_percent)))
    secrets = load_destination_secrets(dict(row))
    with open_destination(dict(row), secrets, should_cancel=should_cancel) as (
        runner,
        _,
    ):
        runner.timeout_seconds = VERIFY_TIMEOUT_SECONDS
        if recover_locks:
            unlock_stale(runner)
        runner.run("check", f"--read-data-subset={percent}%")
        snapshots = list_snapshots(runner)
    return {"read_percent": percent, "snapshot_count": len(snapshots)}


# ── restore drill ───────────────────────────────────────────────────


def drill_database_name() -> str:
    return f"{DRILL_PREFIX}{token_source.token_hex(6)}"


def _drill_target(database: str, production: Connection) -> str:
    """The only databases a drill may name: its own, never production's."""
    if not _DRILL_NAME.match(database) or database == production.database:
        raise BackupError(f"Refusing to restore into {database!r}")
    return database


def _pg_env(connection: Connection) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "PGPASSWORD": connection.password,
        "PGCONNECT_TIMEOUT": "30",
    }
    return env


def _pg_args(connection: Connection) -> list[str]:
    return [
        "-h",
        connection.host,
        "-p",
        str(connection.port),
        "-U",
        connection.user,
        "--no-password",
    ]


def _psql(
    connection: Connection,
    database: str,
    sql: str,
    *,
    should_cancel: Callable[[], bool] | None = None,
) -> str:
    output = run_command(
        [
            "psql",
            *_pg_args(connection),
            "-d",
            database,
            "-v",
            "ON_ERROR_STOP=1",
            "-X",
            "-q",
            "-t",
            "-A",
            "-c",
            sql,
        ],
        env=_pg_env(connection),
        secrets=[connection.password],
        should_cancel=should_cancel,
        timeout_seconds=600,
        label="psql",
    )
    return output.decode("utf-8", "replace").strip()


def _create_drill_database(
    connection: Connection, database: str, should_cancel: Callable[[], bool] | None
) -> None:
    _psql(
        connection,
        MAINTENANCE_DATABASE,
        f'CREATE DATABASE "{_drill_target(database, connection)}"',
        should_cancel=should_cancel,
    )


def drop_drill_database(connection: Connection, database: str) -> None:
    _psql(
        connection,
        MAINTENANCE_DATABASE,
        f'DROP DATABASE IF EXISTS "{_drill_target(database, connection)}" WITH (FORCE)',
    )


def leftover_drill_databases(connection: Connection) -> list[str]:
    """Drill databases a killed worker left behind."""
    listed = _psql(
        connection,
        MAINTENANCE_DATABASE,
        "SELECT datname FROM pg_database "
        f"WHERE datname LIKE '{DRILL_PREFIX}%' ORDER BY datname",
    )
    return [name for name in listed.splitlines() if _DRILL_NAME.match(name)]


def _sanity(
    connection: Connection, database: str, should_cancel: Callable[[], bool] | None
) -> tuple[int, dict[str, int], str | None]:
    target = _drill_target(database, connection)
    tables = int(
        _psql(
            connection,
            target,
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
            should_cancel=should_cancel,
        )
        or 0
    )
    present = [
        name
        for name in _psql(
            connection,
            target,
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
            "AND tablename IN (" + ", ".join(f"'{t}'" for t in SANITY_TABLES) + ")",
            should_cancel=should_cancel,
        ).splitlines()
        if name
    ]
    rows: dict[str, int] = {}
    for name in SANITY_TABLES:
        if name in present:
            rows[name] = int(
                _psql(
                    connection,
                    target,
                    f'SELECT count(*) FROM public."{name}"',
                    should_cancel=should_cancel,
                )
                or 0
            )
    revision = None
    if "alembic_version" in present:
        revision = (
            _psql(
                connection,
                target,
                "SELECT version_num FROM alembic_version LIMIT 1",
                should_cancel=should_cancel,
            )
            or None
        )
    return tables, rows, revision


def _newest_dump_snapshot(runner: Runner) -> dict[str, Any]:
    snapshots = [
        s
        for s in list_snapshots(runner)
        if f"/{DUMP_FILENAME}" in (s.get("paths") or [])
    ]
    if not snapshots:
        raise BackupError(f"No snapshot of {DUMP_FILENAME} in this repository yet")
    return max(snapshots, key=lambda s: str(s.get("time") or ""))


def _drill_dir() -> Path:
    # Inside the backup directory: a dump can be gigabytes, more than /tmp holds.
    folder = backup_dir() / DRILL_FOLDER
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def restore_drill(
    row: Mapping[str, Any],
    *,
    connection: Connection,
    recover_locks: bool = False,
    should_cancel: Callable[[], bool] | None = None,
) -> DrillResult:
    """Restore the newest dump into a throwaway database, check it, drop it."""
    secrets = load_destination_secrets(dict(row))
    folder = _drill_dir()
    dump_path = folder / f".drill-{token_source.token_hex(8)}.dump"
    database = drill_database_name()
    _drill_target(database, connection)
    try:
        with open_destination(dict(row), secrets, should_cancel=should_cancel) as (
            runner,
            _,
        ):
            runner.timeout_seconds = DRILL_TIMEOUT_SECONDS
            if recover_locks:
                unlock_stale(runner)
            snapshot = _newest_dump_snapshot(runner)
            restore_file(runner, str(snapshot["id"]), DUMP_FILENAME, dump_path)
        listing = run_command(
            ["pg_restore", "--list", str(dump_path)],
            env=_pg_env(connection),
            secrets=[connection.password],
            should_cancel=should_cancel,
            timeout_seconds=600,
            label="pg_restore --list",
        ).decode("utf-8", "replace")
        toc_entries = sum(
            1 for line in listing.splitlines() if line and not line.startswith(";")
        )
        _create_drill_database(connection, database, should_cancel)
        try:
            run_command(
                [
                    "pg_restore",
                    *_pg_args(connection),
                    "-d",
                    _drill_target(database, connection),
                    "--no-owner",
                    "--no-privileges",
                    "--exit-on-error",
                    str(dump_path),
                ],
                env=_pg_env(connection),
                secrets=[connection.password],
                should_cancel=should_cancel,
                timeout_seconds=DRILL_TIMEOUT_SECONDS,
                label="pg_restore",
            )
            tables, rows, revision = _sanity(connection, database, should_cancel)
        finally:
            drop_drill_database(connection, database)
    finally:
        dump_path.unlink(missing_ok=True)
    if tables == 0:
        raise BackupError("The restored database has no tables")
    if "alembic_version" in rows and revision is None:
        raise BackupError("The restored database has no Alembic revision")
    return DrillResult(
        snapshot_id=str(snapshot.get("short_id") or snapshot["id"]),
        snapshot_time=str(snapshot.get("time") or "") or None,
        database=database,
        toc_entries=toc_entries,
        tables=tables,
        rows=rows,
        alembic_revision=revision,
    )


def clean_drill_leftovers(connection: Connection) -> list[str]:
    """Drop drill databases and files a killed worker left; return what went."""
    removed = []
    for name in leftover_drill_databases(connection):
        drop_drill_database(connection, name)
        removed.append(name)
    folder = backup_dir() / DRILL_FOLDER
    if folder.is_dir():
        for leftover in folder.glob(".drill-*.dump"):
            leftover.unlink(missing_ok=True)
            removed.append(leftover.name)
    return removed


__all__ = [
    "DRILL_PREFIX",
    "DUMP_FILENAME",
    "CopyResult",
    "DrillResult",
    "clean_drill_leftovers",
    "copy_dump",
    "drill_database_name",
    "drop_drill_database",
    "leftover_drill_databases",
    "restore_drill",
    "verify_destination",
]
