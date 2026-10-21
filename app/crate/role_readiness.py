"""Container-local fresh role progress plus current dependencies, opt-in probes."""

import json
import os
import re
import time
from pathlib import Path

ROOT = Path("/tmp/crate-readiness")


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


def healthy():
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
    import redis

    from crate.config import get_durable_redis_url
    from crate.db.queries.role_readiness import database_ready

    client = redis.Redis.from_url(
        get_durable_redis_url(), socket_timeout=2, socket_connect_timeout=2
    )
    try:
        return bool(client.ping() and database_ready())
    finally:
        client.close()


if __name__ == "__main__":
    try:
        ready = healthy()
    except Exception:  # noqa: BLE001 — health must fail closed without credentials in logs
        ready = False
    raise SystemExit(0 if ready else 1)
