"""Settings of the local backup policy, read from the environment (BK1).

- ``CRATE_LOCAL_BACKUPS_ENABLED`` (default on): the scheduler runs the nightly dump
  and its retention. Off, the scheduler skips them and the tasks do nothing even
  when queued by hand. Production sets it off in ``docker-compose.yaml`` while the
  ``crate-postgres-backup`` sidecar still makes its dumps (until BK6), so the two
  never dump side by side.
- ``CRATE_BACKUP_DIR`` (default ``$DATA_DIR/backups``): the backup directory as the
  maintenance worker sees it, for example the mount of a dedicated volume. Dumps go
  to its ``dumps/`` folder. A configured directory must exist: the engine never
  creates it, so an unmounted volume fails instead of filling the container's own
  disk. The default is created inside ``$DATA_DIR``, which must exist.
- ``CRATE_BACKUP_KEEP_DAILY``, ``_WEEKLY`` and ``_MONTHLY`` (default 3, 4 and 3):
  how many days, ISO weeks and months of dumps retention keeps.
- Since BK3 the local counts can be set from Admin (``set_local_retention``,
  stored in ``settings`` as ``backups.local_keep_*``). They are the local dumps'
  own counts, apart from the off-site policies (BG1-5); when set, they win over
  the environment.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from crate.backups.local import BackupError, RetentionPolicy

ENABLED_ENV = "CRATE_LOCAL_BACKUPS_ENABLED"
BACKUP_DIR_ENV = "CRATE_BACKUP_DIR"
DUMPS_FOLDER = "dumps"
DEFAULT_RETENTION = RetentionPolicy(daily=3, weekly=4, monthly=3)
_FALSE = {"0", "false", "no", "off"}


def local_backups_enabled() -> bool:
    raw = os.environ.get(ENABLED_ENV, "").strip().lower()
    return raw not in _FALSE


def backup_dir() -> Path:
    configured = os.environ.get(BACKUP_DIR_ENV, "").strip()
    if configured:
        return Path(configured)
    return Path(os.environ.get("DATA_DIR", "/data")) / "backups"


def dumps_dir() -> Path:
    return backup_dir() / DUMPS_FOLDER


def prepare_dumps_dir() -> Path:
    """The dumps folder, created if its backup directory is in place."""
    base = backup_dir()
    configured = bool(os.environ.get(BACKUP_DIR_ENV, "").strip())
    if not base.is_dir():
        if configured or not base.parent.is_dir():
            raise BackupError(
                f"The backup directory {base} does not exist; mount it or set "
                f"{BACKUP_DIR_ENV}"
            )
        base.mkdir(exist_ok=True)
    folder = base / DUMPS_FOLDER
    folder.mkdir(mode=0o700, exist_ok=True)
    return folder


def _env_count(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value >= 0 else default


def _param_count(value: Any) -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"A retention count is a whole number >= 0, not {value!r}")
    return value


LOCAL_RETENTION_SETTING = "backups.local_keep_{field}"
MAX_LOCAL_KEEP = 1000


def _stored_count(field: str) -> int | None:
    from crate.db.repositories.settings import get_setting

    try:
        raw = get_setting(LOCAL_RETENTION_SETTING.format(field=field))
    except Exception:  # pragma: no cover - the database is down: use the environment
        return None
    try:
        value = int(raw) if raw is not None else None
    except ValueError:
        return None
    return value if value is not None and value >= 0 else None


def set_local_retention(*, daily: int, weekly: int, monthly: int) -> RetentionPolicy:
    """Store the local dumps' retention counts (Admin, BG1-5)."""
    counts = {"daily": daily, "weekly": weekly, "monthly": monthly}
    for value in counts.values():
        if type(value) is not int or not 0 <= value <= MAX_LOCAL_KEEP:
            raise ValueError(
                f"A retention count is a whole number from 0 to {MAX_LOCAL_KEEP}"
            )
    if not any(counts.values()):
        raise ValueError("Local retention must keep at least one dump")
    from crate.db.repositories.settings import set_setting

    for field, value in counts.items():
        set_setting(LOCAL_RETENTION_SETTING.format(field=field), str(value))
    return RetentionPolicy(**counts)


def retention_policy(params: Mapping[str, Any] | None = None) -> RetentionPolicy:
    """The local counts: a task's ``keep_*`` params, else Admin's, else the env."""
    params = params or {}
    counts = {}
    for field in ("daily", "weekly", "monthly"):
        key = f"keep_{field}"
        if key in params:
            counts[field] = _param_count(params[key])
            continue
        stored = _stored_count(field)
        counts[field] = (
            stored
            if stored is not None
            else _env_count(
                f"CRATE_BACKUP_KEEP_{field.upper()}",
                getattr(DEFAULT_RETENTION, field),
            )
        )
    return RetentionPolicy(**counts)


__all__ = [
    "BACKUP_DIR_ENV",
    "DEFAULT_RETENTION",
    "DUMPS_FOLDER",
    "ENABLED_ENV",
    "backup_dir",
    "dumps_dir",
    "local_backups_enabled",
    "prepare_dumps_dir",
    "retention_policy",
    "set_local_retention",
]
