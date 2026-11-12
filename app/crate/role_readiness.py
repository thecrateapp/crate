"""Container-local fresh role progress plus current dependencies, opt-in probes.

``python3 -m crate.role_readiness`` is the compose health check of every worker
role. It runs every 15 s inside CPU-capped containers (the fast worker gets a
fraction of a core), so it must stay cheap: it never imports ``crate.config``,
the ``crate.db`` facade, SQLAlchemy or redis-py. Redis is pinged over a raw
RESP socket and PostgreSQL through a direct psycopg2 connection, both with
short timeouts. The connection settings come from the same environment
variables that ``crate.config.get_durable_redis_url`` and
``crate.db.core_settings.get_pg_connection_settings`` read; tests pin that.

Every failure means "not ready", and nothing here prints or logs, so neither
the Redis password nor the database password can reach the container log.
"""

import json
import os
import re
import socket
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path("/tmp/crate-readiness")

# Short per-step bounds: the worst case (Redis then PostgreSQL both hanging)
# stays well under the compose health check timeout.
TIMEOUT_SECONDS = 2.0

# Same statements as crate.db.queries.role_readiness.database_ready.
DATABASE_STATEMENTS = ("SET LOCAL statement_timeout='2s'", "SELECT 1")


def progress(role):
    if not os.environ.get("CRATE_READINESS_ROLE"):
        return
    if not re.fullmatch(r"[a-z_-]{1,40}", role):
        raise ValueError("Invalid readiness role")
    ROOT.mkdir(exist_ok=True)
    path = ROOT / (role + "." + str(os.getpid()) + ".json")
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "observed_at": time.time(),
                "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "pid": os.getpid(),
            }
        )
    )
    temporary.replace(path)


def progress_fresh():
    role = os.environ.get("CRATE_READINESS_ROLE")
    queues = os.environ.get("CRATE_READINESS_QUEUES", "").split(",")
    required = (
        ["projector"]
        if role == "projector"
        else ["queue_" + q + suffix for q in queues if q for suffix in ("", "_delay")]
    )
    if not required:
        return False
    now = time.time()
    for item in required:
        fresh = False
        for path in ROOT.glob(item + ".*.json"):
            try:
                value = json.loads(path.read_text())
                # /proc presence plus process start time prevents PID reuse from
                # treating an old consumer's evidence as current progress.
                stat = Path("/proc/" + str(value["pid"]) + "/stat").read_text().split()
                uptime = float(Path("/proc/uptime").read_text().split()[0])
                age = uptime - int(stat[21]) / os.sysconf("SC_CLK_TCK")
                fresh |= 0 <= now - value["observed_at"] <= min(45, age)
            except (OSError, ValueError, KeyError, TypeError):
                continue
        if not fresh:
            return False
    return True


def durable_redis_url():
    # Mirrors crate.config.get_durable_redis_url.
    return os.environ.get("REDIS_DURABLE_URL") or os.environ.get(
        "REDIS_URL", "redis://localhost:6379/0"
    )


def postgres_settings():
    # Mirrors crate.db.core_settings.get_pg_connection_settings.
    return {
        "user": os.environ.get("CRATE_POSTGRES_USER", "crate"),
        "password": os.environ.get("CRATE_POSTGRES_PASSWORD", "crate"),
        "host": os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres"),
        "port": os.environ.get("CRATE_POSTGRES_PORT", "5432"),
        "dbname": os.environ.get("CRATE_POSTGRES_DB", "crate"),
    }


def _resp(*args):
    parts = [b"*%d\r\n" % len(args)]
    for arg in args:
        data = arg.encode()
        parts.append(b"$%d\r\n%s\r\n" % (len(data), data))
    return b"".join(parts)


def redis_ready(url=None, timeout=TIMEOUT_SECONDS):
    """AUTH (when the URL carries a password) and PING; True only on +PONG."""
    try:
        parts = urlsplit(url or durable_redis_url())
        if parts.scheme not in ("redis", "rediss"):
            return False
        host = parts.hostname or "localhost"
        commands = []
        if parts.password:
            password = unquote(parts.password)
            username = unquote(parts.username) if parts.username else ""
            commands.append(
                _resp("AUTH", username, password)
                if username
                else _resp("AUTH", password)
            )
        commands.append(_resp("PING"))
        with socket.create_connection((host, parts.port or 6379), timeout) as sock:
            if parts.scheme == "rediss":
                import ssl

                sock = ssl.create_default_context().wrap_socket(
                    sock, server_hostname=host
                )
            sock.settimeout(timeout)
            with sock, sock.makefile("rb") as replies:
                sock.sendall(b"".join(commands))
                expected = [b"+OK\r\n"] * (len(commands) - 1) + [b"+PONG\r\n"]
                return all(replies.readline(256) == line for line in expected)
    except Exception:  # noqa: BLE001 — fail closed, never surface the URL
        return False


def database_ready(timeout=TIMEOUT_SECONDS):
    """One bounded round trip on a fresh connection; True only on SELECT 1 = 1."""
    try:
        import psycopg2

        settings = postgres_settings()
        connection = psycopg2.connect(
            host=settings["host"],
            port=settings["port"],
            user=settings["user"],
            password=settings["password"],
            dbname=settings["dbname"],
            connect_timeout=max(1, int(timeout)),
            application_name="crate-role-readiness",
        )
        try:
            # Raw cursor on purpose: the crate.db facade costs seconds of CPU in
            # a capped container (see the module docstring).
            with connection.cursor() as cursor:
                for statement in DATABASE_STATEMENTS:
                    cursor.execute(statement)
                row = cursor.fetchone()
            return row is not None and row[0] == 1
        finally:
            connection.close()
    except Exception:  # noqa: BLE001 — fail closed, never surface the DSN
        return False


def healthy():
    return progress_fresh() and redis_ready() and database_ready()


if __name__ == "__main__":
    try:
        ready = healthy()
    except Exception:  # noqa: BLE001 — health must fail closed without credentials in logs
        ready = False
    raise SystemExit(0 if ready else 1)
