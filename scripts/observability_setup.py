#!/usr/bin/env python3
"""Prepare monitoring storage, secrets and the database role for a home install.

The `crate` installer runs this inside a throwaway crate-api container as root,
with the install folder and the data folder mounted at their host paths, so the
host needs neither Python nor sudo. Every command prints JSON with names and
booleans only; no secret value is ever printed.

  prepare  directories, owners and modes; the exporter password once; the Redis
           exporter files from REDIS_PASSWORD; the Grafana admin password from
           GRAFANA_ADMIN_PASSWORD the first time
  role     the crate_observer database role, with its password stored as a
           SCRAM-SHA-256 verifier, and the pg_stat_statements extension
  status   what is in place, as booleans
  backup-grafana
           copy Grafana's data, with its owners, before a new Grafana image
           migrates it
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets as tokens
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent_setup import load_settings
from observability_preflight import validate_start_environment

PROMETHEUS = 65534
GRAFANA = 472
DIRECTORIES = {"prometheus": (PROMETHEUS, 0o750), "grafana": (GRAFANA, 0o750)}
SECRETS = {
    "grafana-admin-password": GRAFANA,
    "postgres-exporter-password": PROMETHEUS,
    "redis-cache-passwords.json": PROMETHEUS,
    "redis-durable-passwords.json": PROMETHEUS,
}
REDIS = {
    "redis-cache-passwords.json": "redis://crate-redis:6379",
    "redis-durable-passwords.json": "redis://crate-redis-durable:6379",
}
ROLE = "crate_observer"
SCRAM_ITERATIONS = 4096


class SetupError(Exception):
    pass


def data_dir(settings: dict) -> Path:
    value = settings.get("OBS_DATA_DIR", "").strip()
    if not value or not Path(value).is_absolute():
        raise SetupError("OBS_DATA_DIR must be an absolute path in monitoring.env")
    return Path(value)


def secrets_dir(settings: dict) -> Path:
    return data_dir(settings) / "secrets"


def _write(path: Path, content: str, uid: int, chown) -> None:
    staging = path.with_name(f".{path.name}.{os.getpid()}")
    staging.write_text(content)
    staging.chmod(0o400)
    chown(staging, uid, uid)
    os.replace(staging, path)


def prepare(settings: dict, environ: dict, chown=None) -> dict:
    chown = chown or os.chown
    root = data_dir(settings)
    created, written = [], []
    root.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name, (uid, mode) in DIRECTORIES.items():
        path = root / name
        if not path.exists():
            path.mkdir(mode=mode)
            created.append(name)
        path.chmod(mode)
        chown(path, uid, uid)
    secrets = secrets_dir(settings)
    if not secrets.exists():
        secrets.mkdir(mode=0o700)
        created.append("secrets")
    secrets.chmod(0o700)
    chown(secrets, 0, 0)

    grafana = secrets / "grafana-admin-password"
    if not grafana.exists():
        password = environ.get("GRAFANA_ADMIN_PASSWORD", "")
        if len(password) < 12:
            raise SetupError(
                "GRAFANA_ADMIN_PASSWORD with at least 12 characters is required the first time"
            )
        _write(grafana, password, GRAFANA, chown)
        written.append(grafana.name)

    exporter = secrets / "postgres-exporter-password"
    if not exporter.exists():
        _write(exporter, tokens.token_urlsafe(32), PROMETHEUS, chown)
        written.append(exporter.name)

    redis_password = settings.get("REDIS_PASSWORD", "")
    if not redis_password:
        raise SetupError("REDIS_PASSWORD is missing from .env")
    for name, url in REDIS.items():
        path = secrets / name
        content = json.dumps({url: redis_password}) + "\n"
        if not path.exists() or path.read_text() != content:
            _write(path, content, PROMETHEUS, chown)
            written.append(name)
    return {
        "created": created,
        "written": written,
        "initialize_empty": {"prometheus", "grafana"} <= set(created),
    }


def scram_verifier(
    password: str, salt: bytes | None = None, iterations: int = SCRAM_ITERATIONS
) -> str:
    salt = salt if salt is not None else os.urandom(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", "sha256").digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", "sha256").digest()

    def encode(raw: bytes) -> str:
        return base64.b64encode(raw).decode()

    return f"SCRAM-SHA-256${iterations}:{encode(salt)}${encode(stored_key)}:{encode(server_key)}"


def _connect(settings: dict, connect):
    if connect is None:
        import psycopg2

        connect = psycopg2.connect
    return connect(
        host=settings.get("CRATE_POSTGRES_HOST", "crate-postgres"),
        port=int(settings.get("CRATE_POSTGRES_PORT", "5432")),
        user=settings.get("POSTGRES_SUPERUSER_USER")
        or settings.get("CRATE_POSTGRES_USER", "crate"),
        password=settings.get("POSTGRES_SUPERUSER_PASSWORD")
        or settings.get("CRATE_POSTGRES_PASSWORD", ""),
        dbname=settings.get("CRATE_POSTGRES_DB", "crate"),
        connect_timeout=10,
    )


def role(settings: dict, connect=None, name: str = ROLE) -> dict:
    password_file = secrets_dir(settings) / "postgres-exporter-password"
    if not password_file.is_file():
        raise SetupError("run prepare first: the exporter password is missing")
    from psycopg2 import sql

    verifier = scram_verifier(password_file.read_text().strip())
    database = settings.get("CRATE_POSTGRES_DB", "crate")
    connection = _connect(settings, connect)
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (name,))
            created = cursor.fetchone() is None
            verb = "CREATE" if created else "ALTER"
            cursor.execute(
                sql.SQL(
                    verb
                    + " ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4 PASSWORD %s"
                ).format(sql.Identifier(name)),
                (verifier,),
            )
            cursor.execute(
                sql.SQL("GRANT pg_monitor TO {}").format(sql.Identifier(name))
            )
            cursor.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(database), sql.Identifier(name)
                )
            )
            cursor.execute(
                sql.SQL("ALTER ROLE {} SET statement_timeout = '5s'").format(
                    sql.Identifier(name)
                )
            )
            cursor.execute(
                sql.SQL("ALTER ROLE {} SET lock_timeout = '1s'").format(
                    sql.Identifier(name)
                )
            )
            cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
    finally:
        connection.close()
    return {"role": name, "created": created, "pg_stat_statements": True}


def _owned(path: Path, uid: int, mode: int) -> bool:
    try:
        info = path.stat()
    except OSError:
        return False
    return info.st_uid == uid and info.st_mode & 0o777 == mode


def status(settings: dict, connect=None, name: str = ROLE) -> dict:
    root = data_dir(settings)
    secrets = secrets_dir(settings)
    report = {
        f"{directory}_dir": _owned(root / directory, uid, mode)
        for directory, (uid, mode) in DIRECTORIES.items()
    }
    report["secrets_dir"] = _owned(secrets, 0, 0o700)
    for secret, uid in SECRETS.items():
        report[secret] = _owned(secrets / secret, uid, 0o400)
    try:
        validate_start_environment(
            {
                "OBS_DATA_DIR": str(root),
                "OBS_SECRETS_DIR": str(secrets),
                "OBS_APP_NETWORK": settings.get("OBS_APP_NETWORK", ""),
                "CRATE_POSTGRES_DB": settings.get("CRATE_POSTGRES_DB", ""),
            }
        )
        report["storage_ready"] = True
    except ValueError:
        report["storage_ready"] = False
    report["role"] = report["pg_stat_statements"] = False
    if connect is not False:
        import psycopg2

        try:
            connection = _connect(settings, connect)
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_has_role(%s, 'pg_monitor', 'MEMBER') FROM pg_roles WHERE rolname = %s",
                        (name, name),
                    )
                    row = cursor.fetchone()
                    report["role"] = bool(row and row[0])
                    cursor.execute(
                        "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'"
                    )
                    report["pg_stat_statements"] = cursor.fetchone() is not None
            finally:
                connection.close()
        except (OSError, psycopg2.Error):
            return report
    return report


def backup_grafana(settings: dict, stamp: str | None = None) -> dict:
    root = data_dir(settings)
    source = root / "grafana"
    if not source.is_dir():
        raise SetupError("there is no Grafana data to back up")
    stamp = stamp or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backups = root / "backups"
    backups.mkdir(mode=0o700, exist_ok=True)
    target = backups / f"grafana-{stamp}"
    shutil.copytree(source, target, symlinks=True)
    for path in [source, *source.rglob("*")]:
        info = path.lstat()
        os.lchown(target / path.relative_to(source), info.st_uid, info.st_gid)
    return {"backup": target.name}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Prepare monitoring storage, secrets and the database role."
    )
    parser.add_argument(
        "command", choices=("prepare", "role", "status", "backup-grafana")
    )
    parser.add_argument(
        "--env-file", type=Path, required=True, help="the application .env"
    )
    parser.add_argument(
        "--monitoring-env", type=Path, required=True, help="monitoring.env"
    )
    parser.add_argument(
        "--no-database",
        action="store_true",
        help="status without connecting to PostgreSQL",
    )
    args = parser.parse_args(argv)
    settings = load_settings(args.env_file, environ={})
    settings.update(load_settings(args.monitoring_env, environ={}))
    try:
        if args.command == "prepare":
            result = prepare(settings, dict(os.environ))
        elif args.command == "role":
            result = role(settings)
        elif args.command == "backup-grafana":
            result = backup_grafana(settings)
        else:
            result = status(settings, connect=False if args.no_database else None)
    except SetupError as error:
        print(f"Monitoring setup: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 — failures must not leak credentials.
        print(f"Monitoring setup failed: {type(error).__name__}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
