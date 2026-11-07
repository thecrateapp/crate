from __future__ import annotations

import importlib.util
import json
import os
import stat
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/observability_setup.py"
GRAFANA_PASSWORD = "grafana-first-password"
REDIS_PASSWORD = "redis-secret-value-123"


def _setup():
    spec = importlib.util.spec_from_file_location("_observability_setup_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def setup():
    return _setup()


@pytest.fixture
def owners():
    calls: dict[str, tuple[int, int]] = {}

    def chown(path, uid, gid):
        calls[Path(path).name] = (uid, gid)

    chown.calls = calls
    return chown


def _settings(tmp_path: Path) -> dict:
    return {
        "OBS_DATA_DIR": str(tmp_path / "observability"),
        "OBS_APP_NETWORK": "crate",
        "CRATE_POSTGRES_DB": "crate",
        "REDIS_PASSWORD": REDIS_PASSWORD,
    }


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_prepare_creates_directories_and_secrets_with_their_owners_and_modes(
    setup, owners, tmp_path
):
    settings = _settings(tmp_path)

    result = setup.prepare(
        settings, {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD}, chown=owners
    )

    root = tmp_path / "observability"
    assert _mode(root / "prometheus") == 0o750
    assert _mode(root / "grafana") == 0o750
    assert _mode(root / "secrets") == 0o700
    assert owners.calls["prometheus"] == (65534, 65534)
    assert owners.calls["grafana"] == (472, 472)
    assert owners.calls["secrets"] == (0, 0)
    for name in setup.SECRETS:
        path = root / "secrets" / name
        assert _mode(path) == 0o400, name
    assert set(result["written"]) == set(setup.SECRETS)
    assert result["initialize_empty"] is True
    assert (root / "secrets/grafana-admin-password").read_text() == GRAFANA_PASSWORD
    assert json.loads((root / "secrets/redis-cache-passwords.json").read_text()) == {
        "redis://crate-redis:6379": REDIS_PASSWORD
    }
    assert json.loads((root / "secrets/redis-durable-passwords.json").read_text()) == {
        "redis://crate-redis-durable:6379": REDIS_PASSWORD
    }


def test_prepare_never_rotates_and_only_follows_the_redis_password(
    setup, owners, tmp_path
):
    settings = _settings(tmp_path)
    setup.prepare(settings, {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD}, chown=owners)
    secrets = tmp_path / "observability/secrets"
    exporter = (secrets / "postgres-exporter-password").read_text()

    again = setup.prepare(
        settings, {"GRAFANA_ADMIN_PASSWORD": "another-strong-password"}, chown=owners
    )
    assert again == {"created": [], "written": [], "initialize_empty": False}
    assert (secrets / "postgres-exporter-password").read_text() == exporter
    assert (secrets / "grafana-admin-password").read_text() == GRAFANA_PASSWORD

    settings["REDIS_PASSWORD"] = "rotated-by-the-installer"
    changed = setup.prepare(settings, {}, chown=owners)
    assert set(changed["written"]) == {
        "redis-cache-passwords.json",
        "redis-durable-passwords.json",
    }


@pytest.mark.parametrize(
    ("environ", "settings_patch", "message"),
    [
        ({}, {}, "GRAFANA_ADMIN_PASSWORD"),
        ({"GRAFANA_ADMIN_PASSWORD": "short"}, {}, "GRAFANA_ADMIN_PASSWORD"),
        (
            {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD},
            {"REDIS_PASSWORD": ""},
            "REDIS_PASSWORD",
        ),
        (
            {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD},
            {"OBS_DATA_DIR": "relative"},
            "absolute",
        ),
    ],
)
def test_prepare_refuses_missing_inputs(
    setup, owners, tmp_path, environ, settings_patch, message
):
    settings = {**_settings(tmp_path), **settings_patch}
    with pytest.raises(setup.SetupError, match=message):
        setup.prepare(settings, environ, chown=owners)


def test_cli_prints_names_and_booleans_but_never_a_secret(
    setup, tmp_path, capsys, monkeypatch
):
    env = tmp_path / ".env"
    env.write_text(f'REDIS_PASSWORD="{REDIS_PASSWORD}"\nCRATE_POSTGRES_DB=crate\n')
    monitoring = tmp_path / "monitoring.env"
    monitoring.write_text(
        f"OBS_DATA_DIR={tmp_path / 'observability'}\nOBS_APP_NETWORK=crate\n"
    )
    monkeypatch.setenv("GRAFANA_ADMIN_PASSWORD", GRAFANA_PASSWORD)
    monkeypatch.setattr(os, "chown", lambda *args, **kwargs: None)
    arguments = ["--env-file", str(env), "--monitoring-env", str(monitoring)]

    assert setup.main(["prepare", *arguments]) == 0
    assert setup.main(["status", "--no-database", *arguments]) == 0
    output = capsys.readouterr()

    exporter = (
        tmp_path / "observability/secrets/postgres-exporter-password"
    ).read_text()
    for secret in (GRAFANA_PASSWORD, REDIS_PASSWORD, exporter):
        assert secret not in output.out
        assert secret not in output.err
    report = json.loads(output.out.strip().splitlines()[-1])
    assert all(isinstance(value, bool) for value in report.values())
    assert report["storage_ready"] is False


def test_status_reports_storage_ready_once_collectors_have_written(
    setup, owners, tmp_path
):
    settings = _settings(tmp_path)
    setup.prepare(settings, {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD}, chown=owners)
    root = tmp_path / "observability"
    (root / "prometheus/wal").mkdir()
    (root / "grafana/grafana.db").write_text("")

    report = setup.status(settings, connect=False)

    assert report["storage_ready"] is True
    assert report["role"] is False


def test_scram_verifier_has_the_postgres_format(setup):
    verifier = setup.scram_verifier("password", salt=b"0123456789abcdef")
    head, keys = verifier.split("$", 2)[1:]
    assert verifier.startswith("SCRAM-SHA-256$4096:")
    assert head == "4096:MDEyMzQ1Njc4OWFiY2RlZg=="
    assert len(keys.split(":")) == 2
    assert "password" not in verifier


def test_role_lets_the_exporter_log_in_and_stays_idempotent(
    setup, owners, tmp_path, pg_db
):
    psycopg2 = pytest.importorskip("psycopg2")
    from psycopg2.extensions import parse_dsn

    from tests import conftest

    dsn = parse_dsn(conftest._test_dsn)
    database = os.environ["CRATE_POSTGRES_DB"]
    settings = {
        **_settings(tmp_path),
        "CRATE_POSTGRES_HOST": dsn.get("host", "localhost"),
        "CRATE_POSTGRES_PORT": dsn.get("port", "5432"),
        "POSTGRES_SUPERUSER_USER": dsn["user"],
        "POSTGRES_SUPERUSER_PASSWORD": dsn.get("password", ""),
        "CRATE_POSTGRES_DB": database,
    }
    setup.prepare(settings, {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD}, chown=owners)
    name = f"crate_observer_test_{uuid.uuid4().hex[:8]}"
    password = (
        tmp_path / "observability/secrets/postgres-exporter-password"
    ).read_text()
    try:
        assert setup.role(settings, name=name)["created"] is True
        assert setup.role(settings, name=name)["created"] is False

        observer = psycopg2.connect(
            host=settings["CRATE_POSTGRES_HOST"],
            port=settings["CRATE_POSTGRES_PORT"],
            user=name,
            password=password,
            dbname=database,
        )
        with observer.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            assert cursor.fetchone()[0] == "5s"
            cursor.execute("SELECT pg_has_role(current_user, 'pg_monitor', 'MEMBER')")
            assert cursor.fetchone()[0] is True
            cursor.execute(
                "SELECT rolsuper, rolconnlimit FROM pg_roles WHERE rolname = current_user"
            )
            assert cursor.fetchone() == (False, 4)
        observer.close()

        report = setup.status(settings, name=name)
        assert report["role"] is True
        assert report["pg_stat_statements"] is True
    finally:
        admin = psycopg2.connect(
            host=settings["CRATE_POSTGRES_HOST"],
            port=settings["CRATE_POSTGRES_PORT"],
            user=settings["POSTGRES_SUPERUSER_USER"],
            password=settings["POSTGRES_SUPERUSER_PASSWORD"],
            dbname=database,
        )
        admin.autocommit = True
        with admin.cursor() as cursor:
            cursor.execute(f'DROP OWNED BY "{name}"')
            cursor.execute(f'DROP ROLE IF EXISTS "{name}"')
        admin.close()


def test_backup_grafana_copies_its_data_and_keeps_owners(
    setup, owners, tmp_path, monkeypatch
):
    settings = _settings(tmp_path)
    setup.prepare(settings, {"GRAFANA_ADMIN_PASSWORD": GRAFANA_PASSWORD}, chown=owners)
    grafana = tmp_path / "observability/grafana"
    (grafana / "plugins").mkdir()
    (grafana / "grafana.db").write_text("dashboards")
    chowned = {}
    monkeypatch.setattr(
        os,
        "lchown",
        lambda path, uid, gid: chowned.__setitem__(Path(path).name, (uid, gid)),
    )

    result = setup.backup_grafana(settings, stamp="20261103T000000Z")

    target = tmp_path / "observability/backups/grafana-20261103T000000Z"
    assert result == {"backup": target.name}
    assert (target / "grafana.db").read_text() == "dashboards"
    assert {"grafana-20261103T000000Z", "grafana.db", "plugins"} <= set(chowned)
    assert _mode(tmp_path / "observability/backups") == 0o700


def test_backup_grafana_needs_its_data(setup, tmp_path):
    with pytest.raises(setup.SetupError, match="no Grafana data"):
        setup.backup_grafana(_settings(tmp_path))
