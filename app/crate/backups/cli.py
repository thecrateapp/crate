"""Command line of the backups engine (BK3, BK6).

``python -m crate.backups.cli before-upgrade [--wait] [--timeout SECONDS]`` runs the
enabled policies marked "run before upgrades" (decision BG1-15): one dump each,
then its copies. With ``--wait`` it waits for the dump and every copy and exits
non-zero when one fails (1) or does not finish in time (2), so a deploy can stop
before it migrates the database. With the engine off
(``CRATE_LOCAL_BACKUPS_ENABLED=false``) or without such a policy it does nothing
and exits 0. ``make backup-before-upgrade`` and ``make deploy`` call it inside the
maintenance worker. Run it where the worker can reach the database and Redis.

``python -m crate.backups.cli import-destination`` registers an existing restic
repository with its current password (BK6, ``crate.backups.importer``). Exit codes:
0 imported or already imported, 1 the repository cannot be opened, 2 invalid
settings or missing secrets, 3 a destination already has this name or repository.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from crate.backups.settings import ENABLED_ENV, local_backups_enabled
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
    if not local_backups_enabled():
        # The dump task would skip itself and --wait would report a failure.
        print(f"The backups engine is off ({ENABLED_ENV}); nothing to do.")
        return 0
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


IMPORT_HELP = """\
Register an EXISTING restic repository as a backup destination, with its current
repository password, for example the crate-backup-offsite sidecar's Cloudflare R2
(--kind s3) and Google Drive (--kind gdrive) repositories.

Secrets never go on the command line. They are read from the environment
(--secrets-from env, the default) or from stdin (--secrets-from stdin: a JSON
object, or KEY=VALUE lines as `env` prints them), under their own names
(repository_password, access_key_id, secret_access_key, key_id, application_key,
client_secret, token), as CRATE_IMPORT_<NAME>, or under the sidecar's names
(RESTIC_PASSWORD, CRATE_OFFSITE_R2_ACCESS_KEY_ID/_SECRET_ACCESS_KEY,
RCLONE_CONFIG_GDRIVE_CLIENT_SECRET/_TOKEN). --from-sidecar also reads the
location from the sidecar's variables (CRATE_OFFSITE_R2_ACCOUNT_ID/_BUCKET/_PATH,
CRATE_OFFSITE_GDRIVE_PATH, RCLONE_CONFIG_GDRIVE_CLIENT_ID/_ROOT_FOLDER_ID).

Google Drive reuses the OAuth client that minted the token (decision D4): a
token cannot be refreshed with another client.

The repository is opened (restic cat config, snapshots, stats) before anything
is stored, and never initialised. The listing is stored for Admin's snapshots
tab, then a connection test is queued (--no-test skips it).

Retention (D6): the engine prunes with `restic forget --group-by host`, so the
sidecar's snapshots (host crate, /crate.sql.gz) are pruned together with the
engine's (host crate, /crate.dump): the old history thins out to the policy's
counts. The sidecar (`--group-by host,paths`) never prunes the engine's.

Exit codes: 0 imported or already imported, 1 the repository cannot be opened,
2 invalid settings or missing secrets, 3 a destination already has this name or
repository (--replace overwrites it).
"""


def import_command(args: argparse.Namespace, *, stdin=None) -> int:
    from crate.backups import importer
    from crate.backups.local import BackupError
    from crate.backups.providers import DestinationError

    try:
        if args.secrets_from == "stdin":
            source = importer.parse_secret_stream((stdin or sys.stdin).read())
        else:
            source = importer.environment_source()
        config = importer.sidecar_config(args.kind, source) if args.from_sidecar else {}
        for key in (
            "endpoint",
            "bucket",
            "prefix",
            "region",
            "bucket_lookup",
            "path",
            "root_folder_id",
            "client_id",
        ):
            value = getattr(args, key)
            if value is not None:
                config[key] = value
        credentials, password = importer.read_secrets(args.kind, source)
        result = importer.import_destination(
            kind=args.kind,
            name=args.name,
            config=config,
            credentials=credentials,
            repository_password=password,
            replace=args.replace,
            queue_test=not args.no_test,
        )
    except importer.ImportConflict as exc:
        print(f"Not imported: {exc}", file=sys.stderr)
        return 3
    except DestinationError as exc:
        print(f"Not imported: {exc}", file=sys.stderr)
        return 2
    except BackupError as exc:
        print(f"Not imported: {exc}", file=sys.stderr)
        return 1
    destination = result.destination
    if result.action == "unchanged":
        print(
            f"{destination['name']} ({destination['id']}) is already imported with "
            "these settings; nothing changed."
        )
        return 0
    opened = result.opened
    print(
        f"{destination['name']} ({destination['id']}) {result.action}: "
        f"{destination['location']}"
    )
    if opened is not None:
        print(
            f"Repository opened: {len(opened.snapshots)} snapshots, "
            f"{opened.repository_bytes if opened.repository_bytes is not None else 'unknown'} bytes."
        )
    if result.test_task_id:
        print(f"Connection test queued as task {result.test_task_id}.")
    for note in result.notes:
        print(f"Note: {note}")
    return 0


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
    imported = commands.add_parser(
        "import-destination",
        help="Register an existing restic repository with its current password",
        description=IMPORT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    imported.add_argument(
        "--kind", required=True, choices=("s3", "b2", "gdrive", "dropbox", "local")
    )
    imported.add_argument("--name", required=True, help="Its name in Admin")
    imported.add_argument(
        "--secrets-from",
        choices=("env", "stdin"),
        default="env",
        help="Where the secrets are read from (default env)",
    )
    imported.add_argument(
        "--from-sidecar",
        action="store_true",
        help="Take the location from crate-backup-offsite's variables",
    )
    imported.add_argument("--endpoint", help="s3: endpoint URL")
    imported.add_argument("--bucket", help="s3, b2: bucket")
    imported.add_argument("--prefix", help="s3, b2: folder in the bucket")
    imported.add_argument("--region", help="s3: region (R2: auto)")
    imported.add_argument(
        "--bucket-lookup", dest="bucket_lookup", choices=("auto", "dns", "path")
    )
    imported.add_argument("--path", help="gdrive, dropbox, local: folder")
    imported.add_argument("--root-folder-id", dest="root_folder_id")
    imported.add_argument(
        "--client-id", dest="client_id", help="gdrive, dropbox: OAuth client ID"
    )
    imported.add_argument(
        "--replace",
        action="store_true",
        help="Overwrite the destination that has this name or repository",
    )
    imported.add_argument(
        "--no-test", action="store_true", help="Do not queue a connection test"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "before-upgrade":
        return before_upgrade(wait=args.wait, timeout=args.timeout)
    if args.command == "import-destination":
        return import_command(args)
    return 2  # pragma: no cover - argparse refuses other commands


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
