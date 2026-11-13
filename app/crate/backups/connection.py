"""Test connection for a backup destination (admin backups, BK2).

The test writes, reads back and deletes a probe file where the repository lives
with rclone (restic's forget --prune needs delete rights), opens the restic
repository or initialises it when there is none yet, and finally counts the
snapshots and sizes the repository. SFTP opens the repository first, to learn the
server's host key the probe then requires. The result is stored on the destination: ``ok``, ``failing`` with
a scrubbed error, or ``unavailable`` when this worker image has no restic or
rclone (a custom image, for example).

On first contact with an SFTP server its host key is learnt and pinned in the
destination's configuration; later connections require the same key.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from crate.backups import providers
from crate.backups.destinations import (
    DestinationNotFound,
    DestinationSecrets,
    load_destination_secrets,
)
from crate.backups.local import BackupCancelled, BackupError
from crate.backups.restic import (
    ResticError,
    Runner,
    compact_snapshots,
    list_snapshots,
    open_or_init,
    probe_remote,
    remote_has_repository,
    repository_size,
    scrub,
    tools_available,
)
from crate.backups.settings import backup_dir
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.repositories.backup_destinations import record_destination_check

log = logging.getLogger(__name__)


@dataclass(slots=True)
class ConnectionResult:
    status: str
    error: str | None = None
    repository: str | None = None
    snapshot_count: int | None = None
    repository_bytes: int | None = None
    learned: dict[str, Any] = field(default_factory=dict)
    snapshots: list[dict[str, Any]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "error": self.error,
            "repository": self.repository,
            "snapshot_count": self.snapshot_count,
            "repository_bytes": self.repository_bytes,
            "learned": sorted(self.learned),
        }


@contextmanager
def open_destination(
    row: dict[str, Any],
    secrets: DestinationSecrets,
    *,
    should_cancel: Callable[[], bool] | None = None,
    cache_dir: Path | None = None,
) -> Iterator[tuple[Runner, Path]]:
    """A restic runner for a destination, with its private work directory."""
    with tempfile.TemporaryDirectory(prefix="crate-backup-") as raw_dir:
        work_dir = Path(raw_dir)
        target = providers.restic_target(
            row["kind"],
            row["config"] or {},
            secrets.credentials,
            backup_dir=backup_dir(),
            work_dir=work_dir,
        )
        yield (
            Runner(
                target,
                secrets.repository_password,
                work_dir,
                cache_dir=cache_dir,
                should_cancel=should_cancel,
            ),
            work_dir,
        )


def learned_host_key(row: dict[str, Any], work_dir: Path) -> dict[str, Any]:
    """The SFTP host key ssh accepted on first contact, to pin it."""
    if row["kind"] != "sftp" or (row["config"] or {}).get("known_hosts"):
        return {}
    known_hosts = work_dir / "known_hosts"
    content = known_hosts.read_text().strip() if known_hosts.exists() else ""
    return {"known_hosts": content} if content else {}


def check_destination(
    row: dict[str, Any], *, should_cancel: Callable[[], bool] | None = None
) -> ConnectionResult:
    """Run the connection test without storing its result."""
    missing_tools = tools_available()
    if missing_tools:
        return ConnectionResult(
            "unavailable",
            f"This worker has no {' or '.join(missing_tools)}; "
            "backups need the standard Crate worker image",
        )
    spec = providers.provider(row["kind"])
    try:
        secrets = load_destination_secrets(row)
    except Exception:
        return ConnectionResult("failing", "The destination's secrets cannot be read")
    missing = spec.missing_secrets(secrets.credentials)
    if missing:
        hint = " (connect it from Admin)" if "token" in missing and spec.oauth else ""
        return ConnectionResult("failing", f"Missing: {', '.join(missing)}{hint}")
    secret_values = [secrets.repository_password, *secrets.credentials.values()]
    result = ConnectionResult("ok")
    try:
        with open_destination(row, secrets, should_cancel=should_cancel) as (
            runner,
            work_dir,
        ):
            if row["kind"] == "sftp":
                # ssh fails fast and learns the host key the probe then requires.
                result.repository = open_or_init(runner)
                result.learned = learned_host_key(row, work_dir)
            config = {**(row["config"] or {}), **result.learned}
            remote = providers.rclone_remote(
                row["kind"],
                config,
                secrets.credentials,
                backup_dir=backup_dir(),
                work_dir=work_dir,
                bucket_exists=row.get("repository_initialized_at") is not None,
            )
            # The probe goes first elsewhere: restic retries a refused request for
            # minutes, rclone gives up after one retry.
            probe_remote(remote, work_dir=work_dir, should_cancel=should_cancel)
            if result.repository is None:
                result.repository = open_or_init(runner)
            listed = list_snapshots(runner)
            result.snapshot_count = len(listed)
            result.snapshots = compact_snapshots(listed)
            result.repository_bytes = repository_size(runner)
    except BackupCancelled:
        raise
    except (ResticError, BackupError, OSError) as exc:
        result.status = "failing"
        result.error = scrub(str(exc), secret_values)
    return result


def test_destination(
    destination_id: str, *, should_cancel: Callable[[], bool] | None = None
) -> ConnectionResult:
    """Test a destination and store the result on it."""
    row = get_backup_destination(destination_id)
    if row is None:
        raise DestinationNotFound(destination_id)
    result = check_destination(row, should_cancel=should_cancel)
    if result.error:
        log.warning(
            "Backup destination %s failed its test: %s", row["name"], result.error
        )
    record_destination_check(
        destination_id,
        status=result.status,
        error=result.error,
        snapshot_count=result.snapshot_count,
        repository_bytes=result.repository_bytes,
        initialized=result.status == "ok",
        config_updates=result.learned if result.status == "ok" else None,
        snapshots=result.snapshots if result.status == "ok" else None,
    )
    return result


def probe_unsaved(
    kind: str,
    config: dict[str, Any],
    secrets: dict[str, Any],
    *,
    should_cancel: Callable[[], bool] | None = None,
) -> ConnectionResult:
    """Test settings that are not saved yet (BG1-9), without storing anything.

    The rclone probe writes, reads and deletes a file where the repository would
    live, then looks for an existing restic repository there (``repository`` is
    ``existing`` or ``empty``). restic itself needs the repository password, which
    Crate generates only when the destination is saved, so the full test runs
    after saving; its first pass enables the destination.
    """
    if any("rclone" in tool for tool in tools_available()):
        return ConnectionResult(
            "unavailable", "This worker has no rclone; use the standard image"
        )
    try:
        clean_config, clean_secrets = providers.validate(kind, config, secrets)
    except providers.DestinationError as exc:
        return ConnectionResult("failing", str(exc))
    if kind == "sftp":
        return ConnectionResult(
            "failing",
            "Save the destination first: Crate generates its SSH key, and the "
            "server must accept the public key before a test can pass",
        )
    spec = providers.provider(kind)
    missing = spec.missing_secrets(clean_secrets)
    if missing:
        return ConnectionResult("failing", f"Missing: {', '.join(missing)}")
    secret_values = [str(v) for v in clean_secrets.values()]
    result = ConnectionResult("ok")
    with tempfile.TemporaryDirectory(prefix="crate-probe-") as raw_dir:
        work_dir = Path(raw_dir)
        try:
            remote = providers.rclone_remote(
                kind,
                clean_config,
                clean_secrets,
                backup_dir=backup_dir(),
                work_dir=work_dir,
            )
            probe_remote(remote, work_dir=work_dir, should_cancel=should_cancel)
            result.repository = (
                "existing"
                if remote_has_repository(
                    remote, work_dir=work_dir, should_cancel=should_cancel
                )
                else "empty"
            )
        except BackupCancelled:
            raise
        except (ResticError, BackupError, OSError, providers.DestinationError) as exc:
            result.status = "failing"
            result.error = scrub(str(exc), secret_values)
    return result


# pytest would collect ``test_destination`` from modules that import it.
test_destination.__test__ = False  # type: ignore[attr-defined]

__all__ = [
    "ConnectionResult",
    "check_destination",
    "probe_unsaved",
    "learned_host_key",
    "open_destination",
    "test_destination",
]
