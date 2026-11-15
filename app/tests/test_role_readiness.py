"""The worker health check: fresh own-role progress, Redis and PostgreSQL."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from crate import role_readiness

APP_ROOT = Path(__file__).resolve().parents[1]


def _closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class FakeRedis:
    """A tiny RESP server: AUTH against one password, PING, or silence."""

    def __init__(self, password: str | None = None, *, silent: bool = False):
        self.password = password
        self.silent = silent
        self.commands: list[list[str]] = []
        self.server = socket.create_server(("127.0.0.1", 0))
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def url(self, password: str | None = None, username: str = "") -> str:
        auth = f"{username}:{password}@" if password is not None else ""
        return f"redis://{auth}127.0.0.1:{self.port}/0"

    def close(self) -> None:
        self.server.close()

    def _serve(self) -> None:
        while True:
            try:
                connection, _ = self.server.accept()
            except OSError:
                return
            with connection, connection.makefile("rwb") as stream:
                self._session(stream)

    def _session(self, stream) -> None:
        authenticated = self.password is None
        while True:
            header = stream.readline()
            if not header.startswith(b"*"):
                return
            args = []
            for _ in range(int(header[1:])):
                size = int(stream.readline()[1:])
                args.append(stream.read(size + 2)[:-2].decode())
            self.commands.append(args)
            if self.silent:
                continue
            if args[0] == "AUTH":
                authenticated = args[-1] == self.password
                reply = b"+OK\r\n" if authenticated else b"-WRONGPASS invalid\r\n"
            elif args[0] == "PING":
                reply = b"+PONG\r\n" if authenticated else b"-NOAUTH required\r\n"
            else:
                reply = b"-ERR unknown\r\n"
            stream.write(reply)
            stream.flush()


@pytest.fixture
def fake_redis():
    servers: list[FakeRedis] = []

    def start(password: str | None = None, **kw) -> FakeRedis:
        servers.append(FakeRedis(password, **kw))
        return servers[-1]

    yield start
    for server in servers:
        server.close()


@pytest.fixture
def fresh_fast_worker(tmp_path, monkeypatch):
    monkeypatch.setattr(role_readiness, "ROOT", tmp_path)
    monkeypatch.setenv("CRATE_READINESS_ROLE", "worker")
    monkeypatch.setenv("CRATE_READINESS_QUEUES", "fast")
    role_readiness.progress("queue_fast")
    role_readiness.progress("queue_fast_delay")
    return tmp_path


def test_stale_progress_is_not_ready_and_skips_the_probes(
    fresh_fast_worker, monkeypatch
):
    probes = []
    monkeypatch.setattr(role_readiness, "redis_ready", lambda: probes.append(1) or True)
    monkeypatch.setattr(
        role_readiness, "database_ready", lambda: probes.append(1) or True
    )
    assert role_readiness.healthy()

    path = next(fresh_fast_worker.glob("queue_fast.*.json"))
    value = json.loads(path.read_text())
    value["observed_at"] -= 1000
    path.write_text(json.dumps(value))
    probes.clear()

    assert not role_readiness.healthy()
    assert probes == []


def test_missing_role_or_progress_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(role_readiness, "ROOT", tmp_path)
    monkeypatch.delenv("CRATE_READINESS_ROLE", raising=False)
    monkeypatch.delenv("CRATE_READINESS_QUEUES", raising=False)
    assert not role_readiness.progress_fresh()
    monkeypatch.setenv("CRATE_READINESS_ROLE", "worker")
    monkeypatch.setenv("CRATE_READINESS_QUEUES", "fast")
    assert not role_readiness.progress_fresh()


def test_redis_down_is_not_ready(fresh_fast_worker, monkeypatch):
    monkeypatch.setenv("REDIS_DURABLE_URL", f"redis://127.0.0.1:{_closed_port()}/0")
    monkeypatch.setattr(role_readiness, "database_ready", lambda: True)
    assert not role_readiness.healthy()


def test_redis_ping_authenticates_and_fails_closed(fake_redis):
    secured = fake_redis("s3cret/with:chars")
    assert role_readiness.redis_ready(secured.url("s3cret%2Fwith%3Achars"))
    assert secured.commands[-2:] == [["AUTH", "s3cret/with:chars"], ["PING"]]
    assert role_readiness.redis_ready(secured.url("s3cret%2Fwith%3Achars", "ops"))
    assert secured.commands[-2] == ["AUTH", "ops", "s3cret/with:chars"]

    assert not role_readiness.redis_ready(secured.url("wrong"))
    assert not role_readiness.redis_ready(secured.url())  # NOAUTH
    assert not role_readiness.redis_ready("unix:///run/redis.sock")
    assert not role_readiness.redis_ready("redis://127.0.0.1:notaport/0")

    hanging = fake_redis(silent=True)
    assert not role_readiness.redis_ready(hanging.url(), timeout=0.2)


def test_redis_url_follows_the_config_env_vars(monkeypatch):
    from crate.config import get_durable_redis_url

    for durable, shared in (
        (None, None),
        (None, "redis://:a@shared:6379/0"),
        ("redis://:b@durable:6379/0", "redis://:a@shared:6379/0"),
    ):
        for name, value in (("REDIS_DURABLE_URL", durable), ("REDIS_URL", shared)):
            if value is None:
                monkeypatch.delenv(name, raising=False)
            else:
                monkeypatch.setenv(name, value)
        assert role_readiness.durable_redis_url() == get_durable_redis_url()


def test_postgres_settings_follow_the_db_env_vars(monkeypatch):
    from crate.db.core_settings import get_pg_connection_settings

    names = ("USER", "PASSWORD", "HOST", "PORT", "DB")
    for name in names:
        monkeypatch.delenv("CRATE_POSTGRES_" + name, raising=False)
    keys = ("user", "password", "host", "port", "dbname")
    settings = role_readiness.postgres_settings()
    assert tuple(settings[key] for key in keys) == get_pg_connection_settings()
    for name in names:
        monkeypatch.setenv("CRATE_POSTGRES_" + name, "x-" + name.lower())
    settings = role_readiness.postgres_settings()
    assert tuple(settings[key] for key in keys) == get_pg_connection_settings()


def test_database_down_is_not_ready(fresh_fast_worker, fake_redis, monkeypatch):
    monkeypatch.setenv("REDIS_DURABLE_URL", fake_redis().url())
    monkeypatch.setenv("CRATE_POSTGRES_HOST", "127.0.0.1")
    monkeypatch.setenv("CRATE_POSTGRES_PORT", str(_closed_port()))
    assert role_readiness.redis_ready()
    assert not role_readiness.database_ready()
    assert not role_readiness.healthy()


def test_all_good_is_ready(pg_db, fresh_fast_worker, fake_redis, monkeypatch):
    redis_server = fake_redis("pw")
    monkeypatch.setenv("REDIS_DURABLE_URL", redis_server.url("pw"))
    assert role_readiness.database_ready()
    assert role_readiness.healthy()
    assert ["PING"] in redis_server.commands


def test_probe_never_imports_heavy_modules_or_prints_credentials(tmp_path):
    secret = "readiness-secret-do-not-print"
    script = f"""
import sys
from pathlib import Path
from crate import role_readiness as r
r.ROOT = Path({str(tmp_path)!r})
r.progress("queue_fast")
r.progress("queue_fast_delay")
assert r.progress_fresh()
assert not r.healthy()
assert not r.database_ready()
heavy = sorted(
    m for m in sys.modules
    if m.split(".")[0] in {{"sqlalchemy", "redis"}}
    or m == "crate.config" or m.startswith("crate.db")
)
assert heavy == [], heavy
"""
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(APP_ROOT),
        "CRATE_READINESS_ROLE": "worker",
        "CRATE_READINESS_QUEUES": "fast",
        "REDIS_DURABLE_URL": f"redis://:{secret}@127.0.0.1:{_closed_port()}/0",
        "CRATE_POSTGRES_HOST": "127.0.0.1",
        "CRATE_POSTGRES_PORT": str(_closed_port()),
        "CRATE_POSTGRES_PASSWORD": secret,
    }
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=APP_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    cli = subprocess.run(
        [sys.executable, "-m", "crate.role_readiness"],
        cwd=APP_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert cli.returncode == 1
    for output in (result.stdout, result.stderr, cli.stdout, cli.stderr):
        assert secret not in output


def test_compose_gives_the_probe_headroom_and_a_configurable_fast_worker_cap():
    import yaml

    repository = APP_ROOT.parent
    overlay = yaml.safe_load(
        (repository / "deploy/operator/compose.operator.yaml").read_text()
    )["services"]
    probed = [
        name
        for name, service in overlay.items()
        if service.get("healthcheck", {}).get("test")
        == ["CMD", "python3", "-m", "crate.role_readiness"]
    ]
    assert {"crate-worker", "crate-fast-worker", "crate-projector"} <= set(probed)
    for name in probed:
        assert overlay[name]["healthcheck"]["timeout"] == "15s"
    installer_copy = APP_ROOT / "installer/internal/assets/files/compose.operator.yaml"
    assert (
        installer_copy.read_text()
        == (repository / "deploy/operator/compose.operator.yaml").read_text()
    )

    base = yaml.safe_load((repository / "docker-compose.yaml").read_text())
    assert base["services"]["crate-fast-worker"]["cpus"] == "${FAST_WORKER_CPUS:-0.5}"
    assert "FAST_WORKER_CPUS=0.5" in (repository / ".env.example").read_text()
