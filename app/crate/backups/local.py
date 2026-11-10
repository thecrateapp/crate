"""Local dumps of the Crate database and their retention (admin backups, BK1).

A dump is ``pg_dump -Fc`` into a hidden ``.partial`` file in the dumps folder. Only a
complete archive (pg_dump exited 0, the file starts with the custom-format magic and
is not empty) is fsynced, hashed and renamed to ``crate-<UTC stamp>.dump``, next to
``<name>.sha256`` in ``sha256sum`` format. Any failure, cancellation or exception
removes every file the attempt wrote, so the folder only ever holds whole dumps.

Retention is grandfather-father-son, in UTC, with the rule restic's ``forget`` uses:
for each of the last N days, ISO weeks (Monday to Sunday) and calendar months that
have a dump, keep the newest dump of that period. The newest dump is always kept.
Dumps are dated by their file name, never by mtime, so a copy or a restore of the
folder prunes the same way.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

DUMP_PREFIX = "crate-"
DUMP_SUFFIX = ".dump"
CHECKSUM_SUFFIX = ".sha256"
PARTIAL_PREFIX = ".crate-dump-"
PARTIAL_SUFFIX = ".partial"
ARCHIVE_MAGIC = b"PGDMP"
_STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_DUMP_NAME = re.compile(r"^crate-(\d{8}T\d{6}Z)\.dump$")
_STOP_GRACE_SECONDS = 10
_ERROR_TAIL = 500
_HASH_CHUNK = 1024 * 1024


class BackupError(RuntimeError):
    """A backup step failed; the message is safe to store and show."""


class BackupCancelled(BackupError):
    """The task was cancelled while pg_dump ran."""


@dataclass(frozen=True, slots=True)
class Connection:
    host: str
    port: str
    user: str
    password: str
    database: str


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    daily: int
    weekly: int
    monthly: int


@dataclass(frozen=True, slots=True)
class DumpResult:
    path: Path
    size_bytes: int
    sha256: str


@dataclass(slots=True)
class RetentionOutcome:
    kept: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    removed_leftovers: list[str] = field(default_factory=list)


def connection_from_env() -> Connection:
    """The Crate database, from the ``CRATE_POSTGRES_*`` variables the engine reads."""
    return Connection(
        host=os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres"),
        port=os.environ.get("CRATE_POSTGRES_PORT", "5432"),
        user=os.environ.get("CRATE_POSTGRES_USER", "crate"),
        password=os.environ.get("CRATE_POSTGRES_PASSWORD", "crate"),
        database=os.environ.get("CRATE_POSTGRES_DB", "crate"),
    )


def dump_name(at: datetime) -> str:
    return f"{DUMP_PREFIX}{at.astimezone(timezone.utc).strftime(_STAMP_FORMAT)}{DUMP_SUFFIX}"


def parse_dump_name(name: str) -> datetime | None:
    match = _DUMP_NAME.match(name)
    if match is None:
        return None
    try:
        return datetime.strptime(match.group(1), _STAMP_FORMAT).replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def _is_partial(name: str) -> bool:
    return name.startswith(PARTIAL_PREFIX) and name.endswith(PARTIAL_SUFFIX)


def remove_partials(dumps_dir: Path) -> list[str]:
    """Remove ``.partial`` files. Call it only while holding the backup lock."""
    removed = []
    if not dumps_dir.is_dir():
        return removed
    for entry in dumps_dir.iterdir():
        if _is_partial(entry.name) and entry.is_file():
            entry.unlink(missing_ok=True)
            removed.append(entry.name)
    return sorted(removed)


# ── Dump ──────────────────────────────────────────────────────────


def _error_text(raw: bytes, secret: str) -> str:
    text = raw.decode("utf-8", "replace")
    if secret:
        text = text.replace(secret, "***")
    text = " ".join(text.split())
    return text[-_ERROR_TAIL:]


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=_STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _run_pg_dump(
    pg_dump: str,
    target: Path,
    connection: Connection,
    *,
    should_cancel: Callable[[], bool] | None,
    poll_seconds: float,
    timeout_seconds: float | None,
) -> None:
    args = [
        pg_dump,
        "-Fc",
        "--no-password",
        "-f",
        str(target),
        "-h",
        connection.host,
        "-p",
        str(connection.port),
        "-U",
        connection.user,
        "-d",
        connection.database,
    ]
    # The password travels in the environment, never on the command line.
    env = {**os.environ, "PGPASSWORD": connection.password}
    env.setdefault("PGCONNECT_TIMEOUT", "30")
    deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
    with tempfile.TemporaryFile() as stderr:
        try:
            process = subprocess.Popen(
                args,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=stderr,
                env=env,
            )
        except OSError as exc:
            raise BackupError(f"Cannot run {pg_dump}: {exc.strerror or exc}") from exc
        try:
            while True:
                try:
                    returncode = process.wait(timeout=poll_seconds)
                    break
                except subprocess.TimeoutExpired:
                    if should_cancel is not None and should_cancel():
                        raise BackupCancelled("Cancelled while pg_dump ran") from None
                    if deadline is not None and time.monotonic() > deadline:
                        raise BackupError(
                            f"pg_dump ran longer than {int(timeout_seconds or 0)}s"
                        ) from None
        finally:
            _stop(process)
        if returncode != 0:
            stderr.seek(0)
            detail = _error_text(stderr.read(), connection.password)
            raise BackupError(
                f"pg_dump exited with {returncode}: {detail}".rstrip(": ")
            )


def _hash_and_sync(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        head = handle.read(len(ARCHIVE_MAGIC))
        if head != ARCHIVE_MAGIC:
            raise BackupError("pg_dump wrote no custom-format archive")
        digest.update(head)
        size += len(head)
        while chunk := handle.read(_HASH_CHUNK):
            digest.update(chunk)
            size += len(chunk)
        os.fsync(handle.fileno())
    return size, digest.hexdigest()


def _write_synced(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def _fsync_dir(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def dump_database(
    dumps_dir: Path,
    *,
    now: datetime,
    connection: Connection,
    pg_dump: str = "pg_dump",
    should_cancel: Callable[[], bool] | None = None,
    poll_seconds: float = 5.0,
    timeout_seconds: float | None = None,
) -> DumpResult:
    """Write a whole dump to ``dumps_dir`` or nothing at all."""
    final = dumps_dir / dump_name(now)
    checksum = final.with_name(final.name + CHECKSUM_SUFFIX)
    if final.exists() or checksum.exists():
        raise BackupError(f"{final.name} already exists")
    token = uuid.uuid4().hex
    partial = dumps_dir / f"{PARTIAL_PREFIX}{token}{PARTIAL_SUFFIX}"
    partial_checksum = (
        dumps_dir / f"{PARTIAL_PREFIX}{token}{CHECKSUM_SUFFIX}{PARTIAL_SUFFIX}"
    )
    placed: list[Path] = []
    try:
        # Dumps hold every credential in the database: the archive is created
        # owner-only before pg_dump opens it, so it is never readable by others.
        os.close(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        _run_pg_dump(
            pg_dump,
            partial,
            connection,
            should_cancel=should_cancel,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
        )
        if not partial.is_file():
            raise BackupError("pg_dump wrote no archive")
        size, sha256 = _hash_and_sync(partial)
        _write_synced(partial_checksum, f"{sha256}  {final.name}\n")
        os.replace(partial, final)
        placed.append(final)
        os.replace(partial_checksum, checksum)
        placed.append(checksum)
        _fsync_dir(dumps_dir)
    except BaseException:
        for leftover in (partial, partial_checksum, *placed):
            leftover.unlink(missing_ok=True)
        raise
    return DumpResult(path=final, size_bytes=size, sha256=sha256)


# ── Retention ─────────────────────────────────────────────────────


_PERIODS: tuple[tuple[str, Callable[[datetime], object]], ...] = (
    ("daily", lambda at: at.date()),
    ("weekly", lambda at: at.isocalendar()[:2]),
    ("monthly", lambda at: (at.year, at.month)),
)


def select_retained(
    stamps: Iterable[datetime], policy: RetentionPolicy
) -> set[datetime]:
    """The dumps to keep: the newest of each of the last N periods of each kind."""
    ordered = sorted({stamp.astimezone(timezone.utc) for stamp in stamps}, reverse=True)
    if not ordered:
        return set()
    kept = {ordered[0]}
    for name, period_of in _PERIODS:
        limit = getattr(policy, name)
        seen: set[object] = set()
        for stamp in ordered:
            if len(seen) >= limit:
                break
            period = period_of(stamp)
            if period in seen:
                continue
            seen.add(period)
            kept.add(stamp)
    return kept


def apply_local_retention(dumps_dir: Path, policy: RetentionPolicy) -> RetentionOutcome:
    """Prune ``dumps_dir`` to ``policy``. Call it only while holding the backup lock.

    Files Crate did not name are left alone. Checksums without their dump and
    ``.partial`` files (left by a killed worker) are removed.
    """
    outcome = RetentionOutcome()
    if not dumps_dir.is_dir():
        return outcome
    dumps: dict[datetime, Path] = {}
    checksums: list[Path] = []
    for entry in dumps_dir.iterdir():
        if not entry.is_file():
            continue
        stamp = parse_dump_name(entry.name)
        if stamp is not None:
            dumps[stamp] = entry
        elif entry.name.endswith(CHECKSUM_SUFFIX) and parse_dump_name(
            entry.name[: -len(CHECKSUM_SUFFIX)]
        ):
            checksums.append(entry)
    kept = select_retained(dumps, policy)
    for stamp in sorted(dumps):
        path = dumps[stamp]
        if stamp in kept:
            continue
        path.unlink(missing_ok=True)
        path.with_name(path.name + CHECKSUM_SUFFIX).unlink(missing_ok=True)
        outcome.deleted.append(path.name)
    outcome.kept = [dumps[stamp].name for stamp in sorted(kept, reverse=True)]
    kept_names = set(outcome.kept)
    for checksum in checksums:
        dump = checksum.name[: -len(CHECKSUM_SUFFIX)]
        if dump not in kept_names and dump not in outcome.deleted:
            checksum.unlink(missing_ok=True)
            outcome.removed_leftovers.append(checksum.name)
    outcome.removed_leftovers.extend(remove_partials(dumps_dir))
    outcome.removed_leftovers.sort()
    return outcome


__all__ = [
    "ARCHIVE_MAGIC",
    "BackupCancelled",
    "BackupError",
    "Connection",
    "DumpResult",
    "RetentionOutcome",
    "RetentionPolicy",
    "apply_local_retention",
    "connection_from_env",
    "dump_database",
    "dump_name",
    "parse_dump_name",
    "remove_partials",
    "select_retained",
]
