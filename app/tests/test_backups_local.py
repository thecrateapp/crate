"""Local dumps and their grandfather-father-son retention (admin backups, BK1)."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from crate.backups import local
from crate.backups.local import (
    BackupCancelled,
    BackupError,
    RetentionPolicy,
    apply_local_retention,
    dump_database,
    dump_name,
    select_retained,
)
from crate.backups.settings import (
    backup_dir,
    local_backups_enabled,
    retention_policy,
)

UTC = timezone.utc


def _at(day: str, hour: int = 3) -> datetime:
    return datetime.fromisoformat(day).replace(hour=hour, tzinfo=UTC)


def _fake_pg_dump(tmp_path: Path, body: str) -> str:

    script = tmp_path / "fake-pg-dump"
    script.write_text(
        "#!/bin/sh\n"
        'while [ "$#" -gt 0 ]; do\n'
        '  if [ "$1" = "-f" ]; then out="$2"; fi\n'
        "  shift\n"
        "done\n" + textwrap.dedent(body)
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def _connection() -> local.Connection:
    return local.Connection(
        host="db", port="5432", user="crate", password="s3cret", database="crate"
    )


# ── Settings ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, enabled",
    [
        (None, True),
        ("", True),
        ("true", True),
        ("1", True),
        ("false", False),
        ("0", False),
        ("off", False),
        ("no", False),
    ],
)
def test_local_backups_are_on_unless_the_flag_turns_them_off(monkeypatch, raw, enabled):
    if raw is None:
        monkeypatch.delenv("CRATE_LOCAL_BACKUPS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRATE_LOCAL_BACKUPS_ENABLED", raw)

    assert local_backups_enabled() is enabled


def test_backup_dir_defaults_under_data_dir(monkeypatch, tmp_path):
    monkeypatch.delenv("CRATE_BACKUP_DIR", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert backup_dir() == tmp_path / "backups"

    monkeypatch.setenv("CRATE_BACKUP_DIR", "/backups")
    assert backup_dir() == Path("/backups")


def test_retention_defaults_are_three_four_three(monkeypatch):
    for name in ("DAILY", "WEEKLY", "MONTHLY"):
        monkeypatch.delenv(f"CRATE_BACKUP_KEEP_{name}", raising=False)
    assert retention_policy() == RetentionPolicy(daily=3, weekly=4, monthly=3)

    monkeypatch.setenv("CRATE_BACKUP_KEEP_WEEKLY", "8")
    monkeypatch.setenv("CRATE_BACKUP_KEEP_MONTHLY", "junk")
    assert retention_policy() == RetentionPolicy(daily=3, weekly=8, monthly=3)
    assert retention_policy({"keep_daily": 7}) == RetentionPolicy(7, 8, 3)
    with pytest.raises(ValueError):
        retention_policy({"keep_daily": -1})


# ── Dump ──────────────────────────────────────────────────────────


def test_a_dump_is_renamed_into_place_with_its_checksum(tmp_path):
    pg_dump = _fake_pg_dump(tmp_path, 'printf "PGDMP-fake" > "$out"\n')
    dumps = tmp_path / "dumps"
    dumps.mkdir()

    result = dump_database(
        dumps, now=_at("2026-11-10"), connection=_connection(), pg_dump=pg_dump
    )

    assert result.path == dumps / "crate-20261110T030000Z.dump"
    assert result.path.read_bytes() == b"PGDMP-fake"
    assert result.size_bytes == len(b"PGDMP-fake")
    import hashlib

    digest = hashlib.sha256(b"PGDMP-fake").hexdigest()
    assert result.sha256 == digest
    assert (dumps / "crate-20261110T030000Z.dump.sha256").read_text() == (
        f"{digest}  crate-20261110T030000Z.dump\n"
    )
    assert sorted(p.name for p in dumps.iterdir()) == [
        "crate-20261110T030000Z.dump",
        "crate-20261110T030000Z.dump.sha256",
    ]
    # The archive holds every credential in the database: owner-only.
    assert stat.S_IMODE(result.path.stat().st_mode) == 0o600


def test_pg_dump_gets_the_password_in_its_environment_only(tmp_path):
    pg_dump = _fake_pg_dump(
        tmp_path,
        """
        printf 'PGDMP%s' "$PGPASSWORD" > "$out"
        """,
    )
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    args_seen: list[list[str]] = []
    real_popen = subprocess.Popen

    def recording_popen(args, **kwargs):
        args_seen.append(list(args))
        return real_popen(args, **kwargs)

    local_popen = local.subprocess.Popen
    local.subprocess.Popen = recording_popen
    try:
        result = dump_database(
            dumps, now=_at("2026-11-10"), connection=_connection(), pg_dump=pg_dump
        )
    finally:
        local.subprocess.Popen = local_popen

    assert result.path.read_text() == "PGDMPs3cret"
    assert "s3cret" not in " ".join(args_seen[0])
    assert ["-Fc", "--no-password"] == args_seen[0][1:3]


@pytest.mark.parametrize(
    "body",
    [
        # pg_dump fails half way, after writing part of the archive.
        'printf "PGDMP-partial" > "$out"\necho "connection lost s3cret" >&2\nexit 1\n',
        # pg_dump "succeeds" but writes nothing.
        "exit 0\n",
    ],
)
def test_a_failed_dump_leaves_no_file(tmp_path, body):
    pg_dump = _fake_pg_dump(tmp_path, body)
    dumps = tmp_path / "dumps"
    dumps.mkdir()

    with pytest.raises(BackupError) as caught:
        dump_database(
            dumps, now=_at("2026-11-10"), connection=_connection(), pg_dump=pg_dump
        )

    assert list(dumps.iterdir()) == []
    # The password never reaches the error kept in backup_runs.
    assert "s3cret" not in str(caught.value)


def test_a_failure_after_pg_dump_leaves_no_file(tmp_path, monkeypatch):
    pg_dump = _fake_pg_dump(tmp_path, 'printf "PGDMP-fake" > "$out"\n')
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    real_replace = os.replace

    def failing_replace(src, dst):
        if str(dst).endswith(".sha256"):
            raise OSError("disk full")
        return real_replace(src, dst)

    monkeypatch.setattr(local.os, "replace", failing_replace)

    with pytest.raises(OSError):
        dump_database(
            dumps, now=_at("2026-11-10"), connection=_connection(), pg_dump=pg_dump
        )

    assert list(dumps.iterdir()) == []


def test_a_cancelled_dump_stops_pg_dump_and_leaves_no_file(tmp_path):
    pg_dump = _fake_pg_dump(tmp_path, 'printf "PGDMP" > "$out"\nexec sleep 30\n')
    dumps = tmp_path / "dumps"
    dumps.mkdir()

    with pytest.raises(BackupCancelled):
        dump_database(
            dumps,
            now=_at("2026-11-10"),
            connection=_connection(),
            pg_dump=pg_dump,
            should_cancel=lambda: True,
            poll_seconds=0.05,
        )

    assert list(dumps.iterdir()) == []


def test_a_dump_never_overwrites_one_with_the_same_name(tmp_path):
    pg_dump = _fake_pg_dump(tmp_path, 'printf "new" > "$out"\n')
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    existing = dumps / dump_name(_at("2026-11-10"))
    existing.write_text("old")

    with pytest.raises(BackupError):
        dump_database(
            dumps, now=_at("2026-11-10"), connection=_connection(), pg_dump=pg_dump
        )

    assert existing.read_text() == "old"
    assert [p.name for p in dumps.iterdir()] == [existing.name]


# ── Retention ─────────────────────────────────────────────────────


def test_retention_keeps_the_newest_dump_of_each_recent_period():
    # Wednesday 11 November 2026, one dump a day at 03:00 UTC since 1 July.
    end = _at("2026-11-11")
    stamps = [end - timedelta(days=n) for n in range(0, 134)]

    kept = select_retained(stamps, RetentionPolicy(daily=3, weekly=4, monthly=3))

    assert sorted(kept) == sorted(
        _at(day)
        for day in (
            # Daily: the last three days.
            "2026-11-11",
            "2026-11-10",
            "2026-11-09",
            # Weekly (ISO weeks, Monday to Sunday): the last dump of each of the
            # last four weeks; this week's is today's.
            "2026-11-08",
            "2026-11-01",
            "2026-10-25",
            # Monthly: the last dump of each of the last three months.
            "2026-10-31",
            "2026-09-30",
        )
    )


def test_two_dumps_on_one_day_count_once():
    stamps = [_at("2026-11-11", 3), _at("2026-11-11", 15), _at("2026-11-10")]

    kept = select_retained(stamps, RetentionPolicy(daily=1, weekly=0, monthly=0))

    assert kept == {_at("2026-11-11", 15)}


def test_the_newest_dump_is_always_kept():
    stamps = [_at("2026-11-11"), _at("2026-11-10")]

    assert select_retained(stamps, RetentionPolicy(0, 0, 0)) == {_at("2026-11-11")}
    assert select_retained([], RetentionPolicy(3, 4, 3)) == set()


def test_retention_over_a_simulated_calendar_keeps_exactly_the_right_files(tmp_path):
    """Run the nightly dump and retention for 200 days, as the scheduler would."""
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    policy = RetentionPolicy(daily=3, weekly=4, monthly=3)
    day = _at("2026-04-26")
    end = _at("2026-11-11")
    unrelated = dumps / "notes.txt"
    unrelated.write_text("not a dump")
    while day <= end:
        name = dump_name(day)
        (dumps / name).write_bytes(b"PGDMP")
        (dumps / f"{name}.sha256").write_text(f"{'0' * 64}  {name}\n")
        outcome = apply_local_retention(dumps, policy)
        # At most 3 + 4 + 3 dumps, fewer when periods share their newest dump.
        assert len(outcome.kept) <= 10
        day += timedelta(days=1)

    expected = {
        dump_name(_at(d))
        for d in (
            "2026-11-11",
            "2026-11-10",
            "2026-11-09",
            "2026-11-08",
            "2026-11-01",
            "2026-10-25",
            "2026-10-31",
            "2026-09-30",
        )
    }
    names = {p.name for p in dumps.iterdir()}
    assert names == expected | {f"{n}.sha256" for n in expected} | {"notes.txt"}


def test_retention_removes_stale_partials_and_orphan_checksums(tmp_path):
    dumps = tmp_path / "dumps"
    dumps.mkdir()
    keep = dumps / dump_name(_at("2026-11-11"))
    keep.write_bytes(b"PGDMP")
    (dumps / ".crate-dump-abc.partial").write_bytes(b"PGD")
    (dumps / f"{dump_name(_at('2026-01-01'))}.sha256").write_text("x")

    outcome = apply_local_retention(dumps, RetentionPolicy(3, 4, 3))

    assert [p.name for p in dumps.iterdir()] == [keep.name]
    assert outcome.kept == [keep.name]
    assert outcome.deleted == []
    assert sorted(outcome.removed_leftovers) == [
        ".crate-dump-abc.partial",
        f"{dump_name(_at('2026-01-01'))}.sha256",
    ]


# ── Against PostgreSQL ────────────────────────────────────────────


def test_a_real_dump_restores_its_table_of_contents(pg_db, tmp_path):
    del pg_db
    if shutil.which("pg_dump") is None or shutil.which("pg_restore") is None:
        pytest.skip("pg_dump and pg_restore required")
    dumps = tmp_path / "dumps"
    dumps.mkdir()

    result = dump_database(
        dumps,
        now=datetime.now(UTC),
        connection=local.connection_from_env(),
    )

    listing = subprocess.run(
        ["pg_restore", "--list", str(result.path)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "TABLE public backup_runs" in listing.stdout
    assert "TABLE public library_tracks" in listing.stdout
    assert result.size_bytes == result.path.stat().st_size > 0
