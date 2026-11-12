"""Command line of the backups engine (BK3).

``python -m crate.backups.cli before-upgrade [--wait] [--timeout SECONDS]`` runs the
enabled policies marked "run before upgrades" (decision BG1-15): one dump each,
then its copies. With ``--wait`` it waits for the dump and every copy and exits
non-zero when one fails (1) or does not finish in time (2), so a deploy can stop
before it migrates the database. ``make backup-before-upgrade`` calls it inside the
maintenance worker. Run it where the worker can reach the database and Redis.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from crate.db.queries.backup_policies import list_before_upgrade_policies
from crate.db.queries.tasks import get_task
from crate.db.repositories.tasks import create_task_dedup

TERMINAL = frozenset({"completed", "failed", "cancelled"})
POLL_SECONDS = 5.0
DEFAULT_TIMEOUT = 3 * 3600


class _Failed(Exception):
    pass


class _TimedOut(Exception):
    pass


def _wait(task_id: str, deadline: float) -> dict:
    while True:
        task = get_task(task_id) or {}
        if task.get("status") in TERMINAL:
            break
        if time.monotonic() > deadline:
            raise _TimedOut(f"Timed out waiting for task {task_id}")
        time.sleep(POLL_SECONDS)
    if task["status"] != "completed":
        raise _Failed(str(task.get("error") or f"Task {task_id} {task['status']}"))
    result = task.get("result") or {}
    if result.get("status") in ("failed", "skipped") or result.get("cancelled"):
        raise _Failed(str(result.get("error") or result.get("reason") or "cancelled"))
    return result


def before_upgrade(*, wait: bool, timeout: float) -> int:
    policies = list_before_upgrade_policies()
    if not policies:
        print("No backup policy runs before upgrades; nothing to do.")
        return 0
    queued = []
    for policy in policies:
        task_id = create_task_dedup(
            "backup_dump",
            {
                "policy_id": policy["id"],
                "ignore_maintenance_window": True,
                "reason": "before_upgrade",
            },
            dedup_key=f"backup_policy:{policy['id']}",
        )
        print(f"{policy['name']}: queued as task {task_id}")
        queued.append((policy, task_id))
    if not wait:
        return 0
    deadline = time.monotonic() + timeout
    code = 0
    for policy, task_id in queued:
        try:
            if not task_id:
                raise _Failed("the dump could not be queued")
            dump = _wait(str(task_id), deadline)
            copies = [str(t) for t in dump.get("offsite_task_ids") or []]
            for copy_id in copies:
                _wait(copy_id, deadline)
            print(f"{policy['name']}: {len(copies)} copies done")
        except _TimedOut as exc:
            print(f"{policy['name']}: {exc}", file=sys.stderr)
            code = max(code, 2)
        except _Failed as exc:
            print(f"{policy['name']}: failed: {exc}", file=sys.stderr)
            code = max(code, 1)
    return code


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m crate.backups.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    upgrade = commands.add_parser(
        "before-upgrade", help="Run the policies marked to run before upgrades"
    )
    upgrade.add_argument("--wait", action="store_true", help="Wait for every copy")
    upgrade.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Seconds to wait in all (default {DEFAULT_TIMEOUT})",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "before-upgrade":
        return before_upgrade(wait=args.wait, timeout=args.timeout)
    return 2  # pragma: no cover - argparse refuses other commands


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
