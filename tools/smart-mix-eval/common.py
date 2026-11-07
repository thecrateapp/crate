"""Shared plumbing for the Smart Mix evaluation tools.

The tools only read a development database. ``open_read_only_database``
refuses anything but a loopback DSN unless the caller passes
``allow_remote=True`` (which needs Diego's authorization when it is not a
development database), and then makes every connection read-only in
PostgreSQL before the first query.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / "app"
DSN_ENVIRONMENT_VARIABLE = "SMART_MIX_EVAL_DSN"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class UnsafeDatabaseError(RuntimeError):
    pass


def ensure_app_on_path() -> None:
    if str(APP_ROOT) not in sys.path:
        sys.path.insert(0, str(APP_ROOT))


def database_environment(dsn: str, *, allow_remote: bool = False) -> dict[str, str]:
    """Translate a postgresql:// DSN into Crate's ``CRATE_POSTGRES_*`` variables."""
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise UnsafeDatabaseError("The DSN must be a postgresql:// URL")
    host = parsed.hostname or ""
    database = parsed.path.lstrip("/")
    if not database:
        raise UnsafeDatabaseError("The DSN must name a database")
    if host not in LOOPBACK_HOSTS and not allow_remote:
        raise UnsafeDatabaseError(
            f"Refusing a database that is not on this machine (host={host!r}). "
            "These tools run against a development library; any other target "
            "needs explicit authorization and --allow-remote-database."
        )
    return {
        "CRATE_POSTGRES_USER": parsed.username or "crate",
        "CRATE_POSTGRES_PASSWORD": parsed.password or "",
        "CRATE_POSTGRES_HOST": host,
        "CRATE_POSTGRES_PORT": str(parsed.port or 5432),
        "CRATE_POSTGRES_DB": database,
    }


def describe_database(environment: dict[str, str]) -> dict[str, str]:
    """Where the data came from, without credentials."""
    return {
        "host": environment["CRATE_POSTGRES_HOST"],
        "port": environment["CRATE_POSTGRES_PORT"],
        "database": environment["CRATE_POSTGRES_DB"],
    }


def open_read_only_database(dsn: str, *, allow_remote: bool = False) -> dict[str, str]:
    environment = database_environment(dsn, allow_remote=allow_remote)
    os.environ.update(environment)
    ensure_app_on_path()
    from crate.db.queries.smart_mix_evaluation import (
        enforce_read_only_connections,
        session_is_read_only,
    )

    enforce_read_only_connections()
    if not session_is_read_only():
        raise UnsafeDatabaseError("Could not make the database session read-only")
    return describe_database(environment)


def resolve_dsn(value: str | None) -> str | None:
    return value or os.environ.get(DSN_ENVIRONMENT_VARIABLE)


def git_commit() -> str | None:
    """HEAD of the checkout, or ``SMART_MIX_EVAL_GIT_COMMIT`` where git is absent."""
    explicit = os.environ.get("SMART_MIX_EVAL_GIT_COMMIT")
    if explicit:
        return explicit
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout.strip() or None


def display_path(path: Path) -> str:
    """A path relative to the repository when it lives inside it."""
    resolved = Path(path).resolve()
    try:
        return str(resolved.relative_to(REPO_ROOT))
    except ValueError:
        return str(resolved)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
