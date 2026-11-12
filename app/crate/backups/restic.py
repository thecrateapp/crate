"""restic and rclone, run for one destination at a time (admin backups, BK2).

A ``Runner`` runs restic against one repository with a clean environment: only
``PATH``, a private ``HOME``, the provider's variables and ``RESTIC_PASSWORD``. The
worker's own environment (the database password among others) never reaches
restic, rclone or ssh, and ambient ``AWS_*`` or ``RCLONE_*`` settings cannot change
where a backup goes. Every secret of the destination is scrubbed from any output
before it becomes an error message.

The SFTP backend writes its key and ``known_hosts`` into the runner's work
directory; the caller owns that directory and removes it.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any

from crate.backups.local import BackupCancelled, BackupError
from crate.backups.providers import RcloneRemote, ResticTarget

RESTIC_BIN_ENV = "CRATE_RESTIC_BIN"
RCLONE_BIN_ENV = "CRATE_RCLONE_BIN"
SNAPSHOT_HOST = "crate"
_ERROR_TAIL = 600
_STOP_GRACE_SECONDS = 10
_RCLONE_FLAGS = (
    "--retries",
    "1",
    "--low-level-retries",
    "2",
    "--contimeout",
    "20s",
    "--timeout",
    "60s",
    "-q",
)


class ResticError(BackupError):
    """restic or rclone failed; the message is scrubbed of secrets."""


def restic_bin() -> str:
    return os.environ.get(RESTIC_BIN_ENV, "").strip() or "restic"


def rclone_bin() -> str:
    return os.environ.get(RCLONE_BIN_ENV, "").strip() or "rclone"


def tools_available() -> list[str]:
    """The backup tools missing from this process's PATH (empty when all are there)."""
    missing = []
    for name, binary in (("restic", restic_bin()), ("rclone", rclone_bin())):
        if shutil.which(binary) is None:
            missing.append(name)
    return missing


def scrub(text: str, secrets: Iterable[str]) -> str:
    for secret in sorted(
        {s for s in secrets if s and len(s) >= 4}, key=len, reverse=True
    ):
        text = text.replace(secret, "***")
        # Multi-line secrets (an SSH key) may surface one line at a time.
        for line in secret.splitlines():
            if len(line.strip()) >= 16:
                text = text.replace(line.strip(), "***")
    return text


def _short(raw: bytes, secrets: Iterable[str]) -> str:
    text = scrub(raw.decode("utf-8", "replace"), secrets)
    return " ".join(text.split())[-_ERROR_TAIL:]


def _base_env(work_dir: Path) -> dict[str, str]:
    rclone_config = work_dir / "rclone.conf"
    if not rclone_config.exists():
        rclone_config.touch(mode=0o600)
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(work_dir),
        "TMPDIR": str(work_dir),
        "LANG": "C.UTF-8",
        # Remotes come only from the environment below, never from a config file.
        "RCLONE_CONFIG": str(rclone_config),
    }
    return env


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=_STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run_command(
    args: Sequence[str],
    *,
    env: Mapping[str, str],
    secrets: Iterable[str],
    stdin: IO[bytes] | None = None,
    input_bytes: bytes | None = None,
    stdout_path: Path | None = None,
    should_cancel: Callable[[], bool] | None = None,
    timeout_seconds: float | None = None,
    poll_seconds: float = 2.0,
    label: str = "restic",
) -> bytes:
    """Run a backup tool; return its stdout (empty when written to ``stdout_path``)."""
    secrets = list(secrets)
    deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
    with tempfile.TemporaryFile() as stderr, tempfile.TemporaryFile() as captured:
        out_handle: IO[bytes] = (
            stdout_path.open("wb") if stdout_path is not None else captured
        )
        try:
            source: Any = stdin
            if input_bytes is not None:
                source = subprocess.PIPE
            try:
                process = subprocess.Popen(
                    list(args),
                    stdin=source if source is not None else subprocess.DEVNULL,
                    stdout=out_handle,
                    stderr=stderr,
                    env=dict(env),
                )
            except OSError as exc:
                raise ResticError(f"Cannot run {label}: {exc.strerror or exc}") from exc
            try:
                if input_bytes is not None and process.stdin is not None:
                    process.stdin.write(input_bytes)
                    process.stdin.close()
                while True:
                    try:
                        returncode = process.wait(timeout=poll_seconds)
                        break
                    except subprocess.TimeoutExpired:
                        if should_cancel is not None and should_cancel():
                            raise BackupCancelled(
                                f"Cancelled while {label} ran"
                            ) from None
                        if deadline is not None and time.monotonic() > deadline:
                            raise ResticError(
                                f"{label} ran longer than {int(timeout_seconds or 0)}s"
                            ) from None
            finally:
                _stop(process)
        finally:
            if stdout_path is not None:
                out_handle.close()
        if returncode != 0:
            stderr.seek(0)
            detail = _short(stderr.read(), secrets)
            raise ResticError(
                f"{label} exited with {returncode}: {detail}".rstrip(": ")
            )
        if stdout_path is not None:
            return b""
        captured.seek(0)
        return captured.read()


@dataclass(slots=True)
class Runner:
    """restic against one repository."""

    target: ResticTarget
    password: str
    work_dir: Path
    cache_dir: Path | None = None
    should_cancel: Callable[[], bool] | None = None
    timeout_seconds: float | None = 3600

    @property
    def secrets(self) -> list[str]:
        return [self.password, *self.target.secret_values]

    def env(self) -> dict[str, str]:
        env = _base_env(self.work_dir)
        env.update(self.target.env)
        env["RESTIC_PASSWORD"] = self.password
        return env

    def args(self, *arguments: str) -> list[str]:
        args = [restic_bin(), "--repo", self.target.repository]
        if self.cache_dir is None:
            args.append("--no-cache")
        else:
            args += ["--cache-dir", str(self.cache_dir)]
        for option in self.target.options:
            args += ["-o", option]
        if self.target.repository.startswith("rclone:"):
            args += ["-o", f"rclone.program={rclone_bin()}"]
        return [*args, *arguments]

    def run(
        self,
        *arguments: str,
        stdin: IO[bytes] | None = None,
        stdout_path: Path | None = None,
        timeout_seconds: float | None = None,
    ) -> str:
        output = run_command(
            self.args(*arguments),
            env=self.env(),
            secrets=self.secrets,
            stdin=stdin,
            stdout_path=stdout_path,
            should_cancel=self.should_cancel,
            timeout_seconds=timeout_seconds or self.timeout_seconds,
        )
        return output.decode("utf-8", "replace")

    def json(self, *arguments: str, timeout_seconds: float | None = None) -> Any:
        output = self.run(*arguments, "--json", timeout_seconds=timeout_seconds)
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:
            raise ResticError(f"restic {arguments[0]} printed no JSON") from exc


# ── Repository operations ─────────────────────────────────────────


def open_or_init(runner: Runner, *, timeout_seconds: float = 300) -> str:
    """``initialized`` for a new repository, ``existing`` for one already there.

    init goes first: probing a missing S3 bucket makes restic retry for minutes,
    while init creates it, and on an existing repository init fails at once.
    """
    try:
        runner.run("init", timeout_seconds=timeout_seconds)
        return "initialized"
    except BackupCancelled:
        raise
    except ResticError as init_error:
        try:
            runner.run("cat", "config", timeout_seconds=timeout_seconds)
        except ResticError:
            raise init_error from None
        return "existing"


def list_snapshots(
    runner: Runner, *, host: str | None = None, tags: Sequence[str] = ()
) -> list[dict[str, Any]]:
    args = ["snapshots"]
    if host:
        args += ["--host", host]
    for tag in tags:
        args += ["--tag", tag]
    snapshots = runner.json(*args, timeout_seconds=600)
    return list(snapshots or [])


def repository_size(runner: Runner) -> int | None:
    stats = runner.json("stats", "--mode", "raw-data", timeout_seconds=1800)
    size = stats.get("total_size") if isinstance(stats, dict) else None
    return int(size) if isinstance(size, int) else None


def backup_file(
    runner: Runner,
    path: Path,
    *,
    filename: str,
    tags: Sequence[str],
    taken_at: str,
    host: str = SNAPSHOT_HOST,
) -> dict[str, Any]:
    """Back up one file as ``/<filename>``; return restic's summary."""
    args = [
        "backup",
        "--json",
        "--quiet",
        "--stdin",
        "--stdin-filename",
        filename,
        "--host",
        host,
        "--time",
        taken_at,
    ]
    for tag in tags:
        args += ["--tag", tag]
    with path.open("rb") as source:
        output = runner.run(*args, stdin=source)
    for line in output.splitlines():
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(message, dict) and message.get("message_type") == "summary":
            return message
    raise ResticError("restic backup reported no summary")


def restore_file(
    runner: Runner, snapshot_id: str, filename: str, out_path: Path
) -> None:
    runner.run("dump", snapshot_id, f"/{filename}", stdout_path=out_path)


def unlock_stale(runner: Runner) -> None:
    """Remove stale locks only (a killed run's); live ones are left alone."""
    runner.run("unlock", timeout_seconds=300)


# ── rclone probe ──────────────────────────────────────────────────


def probe_remote(
    remote: RcloneRemote,
    *,
    work_dir: Path,
    should_cancel: Callable[[], bool] | None = None,
    timeout_seconds: float = 120,
) -> None:
    """Write, read back and delete a small file next to the repository."""
    env = _base_env(work_dir)
    env.update(remote.env)
    name = f"{remote.path.rstrip('/')}/.crate-probe-{uuid.uuid4().hex}"
    payload = f"crate backup probe {uuid.uuid4().hex}\n".encode()

    def rclone(command: str, label: str, input_bytes: bytes | None = None) -> bytes:
        return run_command(
            [rclone_bin(), command, *_RCLONE_FLAGS, name],
            env=env,
            secrets=remote.secret_values,
            input_bytes=input_bytes,
            should_cancel=should_cancel,
            timeout_seconds=timeout_seconds,
            poll_seconds=0.5,
            label=label,
        )

    try:
        rclone("rcat", "rclone write probe", payload)
    except ResticError as exc:
        raise ResticError(f"Cannot write to the destination: {exc}") from exc
    failure: ResticError | None = None
    try:
        read = rclone("cat", "rclone read probe")
        if read != payload:
            failure = ResticError(
                "The destination returned other bytes than were written"
            )
    except ResticError as exc:
        failure = ResticError(f"Cannot read from the destination: {exc}")
    try:
        rclone("deletefile", "rclone delete probe")
    except ResticError as exc:
        failure = failure or ResticError(
            f"Cannot delete from the destination (pruning needs it): {exc}"
        )
    if failure is not None:
        raise failure


__all__ = [
    "RCLONE_BIN_ENV",
    "RESTIC_BIN_ENV",
    "ResticError",
    "Runner",
    "SNAPSHOT_HOST",
    "backup_file",
    "list_snapshots",
    "open_or_init",
    "probe_remote",
    "rclone_bin",
    "repository_size",
    "restic_bin",
    "restore_file",
    "run_command",
    "scrub",
    "tools_available",
    "unlock_stale",
]
