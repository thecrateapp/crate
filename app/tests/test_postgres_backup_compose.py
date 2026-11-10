"""The PostgreSQL backup sidecar keeps configurable retention, compression and storage."""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SERVICE = "crate-postgres-backup"


def _service():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    return compose, compose["services"][SERVICE]


def _environment(service):
    return dict(entry.split("=", 1) for entry in service["environment"])


def test_backup_sidecar_declares_safe_configurable_defaults():
    compose, service = _service()
    environment = _environment(service)

    assert environment["BACKUP_KEEP_DAYS"] == "${POSTGRES_BACKUP_KEEP_DAYS:-3}"
    assert environment["BACKUP_KEEP_WEEKS"] == "${POSTGRES_BACKUP_KEEP_WEEKS:-4}"
    assert environment["BACKUP_KEEP_MONTHS"] == "${POSTGRES_BACKUP_KEEP_MONTHS:-3}"
    assert environment["POSTGRES_EXTRA_OPTS"] == "${POSTGRES_BACKUP_EXTRA_OPTS:--Z6}"
    assert service["volumes"] == [
        "${POSTGRES_BACKUP_DIR:-${DATA_DIR}/backups/postgres}:/backups"
    ]
    assert compose["volumes"]["crate_postgres_backups"] == {"driver": "local"}


def test_env_example_documents_backup_settings():
    text = (ROOT / ".env.example").read_text()
    for key in (
        "POSTGRES_BACKUP_DIR",
        "POSTGRES_BACKUP_KEEP_DAYS",
        "POSTGRES_BACKUP_KEEP_WEEKS",
        "POSTGRES_BACKUP_KEEP_MONTHS",
        "POSTGRES_BACKUP_EXTRA_OPTS",
    ):
        # Commented out so the compose defaults stay the single source of truth.
        assert re.search(rf"^# {key}=", text, re.MULTILINE), key


def _resolved_config(tmp_path, overrides, profiles=()):
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("Docker Compose CLI required; no daemon or containers used")
    if subprocess.run([docker, "compose", "version"], capture_output=True).returncode:
        pytest.skip("Docker Compose plugin required; no daemon or containers used")
    files = ["docker-compose.yaml", "docker-compose.project.yaml"]
    # Start from the documented example so ports and paths resolve like a real install.
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.example").read_text().splitlines()
        if re.match(r"^[A-Z][A-Z0-9_]*=", line)
    )
    values["DATA_DIR"] = "/var/lib/crate-test"
    for file in files:
        for variable in re.findall(r"\$\{([A-Z0-9_]+):\?", (ROOT / file).read_text()):
            values[variable] = values.get(variable) or "synthetic-value"
    values.update(overrides)
    env_file = tmp_path / "synthetic.env"
    env_file.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    command = [docker, "compose", "--project-directory", str(ROOT)]
    command += ["--project-name", "crate", "--env-file", str(env_file)]
    for file in files:
        command += ["-f", str(ROOT / file)]
    for profile in profiles:
        command += ["--profile", profile]
    command += ["config", "--format", "json"]
    # Shell variables override --env-file, so keep only what the Docker CLI needs:
    # the backend suite exports its own DATA_DIR.
    environment = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "XDG_RUNTIME_DIR"} or key.startswith("DOCKER_")
    }
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=60, env=environment
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _resolved_backup_service(tmp_path, overrides):
    config = _resolved_config(tmp_path, overrides)
    return config, config["services"][SERVICE]


def test_resolved_defaults_keep_the_host_path(tmp_path):
    config, service = _resolved_backup_service(tmp_path, {})

    assert service["environment"]["BACKUP_KEEP_DAYS"] == "3"
    assert service["environment"]["BACKUP_KEEP_WEEKS"] == "4"
    assert service["environment"]["BACKUP_KEEP_MONTHS"] == "3"
    assert service["environment"]["POSTGRES_EXTRA_OPTS"] == "-Z6"
    assert service["volumes"] == [
        {
            "type": "bind",
            "source": "/var/lib/crate-test/backups/postgres",
            "target": "/backups",
            "bind": {},
        }
    ]
    assert "crate_postgres_backups" not in config.get("volumes", {})


def test_resolved_named_volume_and_overrides(tmp_path):
    config, service = _resolved_backup_service(
        tmp_path,
        {
            "POSTGRES_BACKUP_DIR": "crate_postgres_backups",
            "POSTGRES_BACKUP_KEEP_DAYS": "7",
            "POSTGRES_BACKUP_EXTRA_OPTS": "-Z9",
        },
    )

    assert service["environment"]["BACKUP_KEEP_DAYS"] == "7"
    assert service["environment"]["POSTGRES_EXTRA_OPTS"] == "-Z9"
    assert service["volumes"] == [
        {
            "type": "volume",
            "source": "crate_postgres_backups",
            "target": "/backups",
            "volume": {},
        }
    ]
    assert config["volumes"]["crate_postgres_backups"] == {
        "name": "crate_crate_postgres_backups",
        "driver": "local",
    }


OFFSITE = "crate-backup-offsite"
OFFSITE_SECRETS = (
    "RESTIC_PASSWORD",
    "CRATE_OFFSITE_R2_ACCOUNT_ID",
    "CRATE_OFFSITE_R2_BUCKET",
    "CRATE_OFFSITE_R2_ACCESS_KEY_ID",
    "CRATE_OFFSITE_R2_SECRET_ACCESS_KEY",
    "RCLONE_CONFIG_GDRIVE_TYPE",
    "RCLONE_CONFIG_GDRIVE_TOKEN",
    "RCLONE_CONFIG_GDRIVE_CLIENT_ID",
    "RCLONE_CONFIG_GDRIVE_CLIENT_SECRET",
)


def test_offsite_service_is_opt_in_and_isolated():
    compose, _ = _service()
    service = compose["services"][OFFSITE]
    environment = _environment(service)

    assert service["profiles"] == ["offsite-backup"]
    assert (ROOT / service["build"]["context"] / "Dockerfile").is_file()
    assert service["volumes"] == [
        "${POSTGRES_BACKUP_DIR:-${DATA_DIR}/backups/postgres}:/backups:ro",
        "crate_backup_offsite:/state",
    ]
    # Its own network: the drill must never be able to reach crate-postgres.
    assert service["networks"] == ["backup-offsite"]
    assert "depends_on" not in service
    for key in OFFSITE_SECRETS:
        assert environment[key] == f"${{{key}:-}}", key
    assert environment["RCLONE_CONFIG_GDRIVE_SCOPE"] == (
        "${RCLONE_CONFIG_GDRIVE_SCOPE:-drive.file}"
    )
    assert not [key for key in environment if "B2" in key]
    assert compose["volumes"]["crate_backup_offsite"] == {"driver": "local"}


def test_env_example_lists_offsite_keys_without_values():
    text = (ROOT / ".env.example").read_text()
    for key in OFFSITE_SECRETS:
        match = re.search(rf"^# {key}=(.*)$", text, re.MULTILINE)
        assert match, key
        assert match.group(1) in {"", "drive"} or "..." in match.group(1), key


def test_offsite_service_resolves_only_with_its_profile(tmp_path):
    default = _resolved_config(tmp_path, {})
    assert OFFSITE not in default["services"]
    assert "backup-offsite" not in default.get("networks", {})

    enabled = _resolved_config(
        tmp_path,
        {"POSTGRES_BACKUP_DIR": "crate_postgres_backups"},
        profiles=("offsite-backup",),
    )
    service = enabled["services"][OFFSITE]
    backups = next(v for v in service["volumes"] if v["target"] == "/backups")
    assert backups["source"] == "crate_postgres_backups"
    assert backups["read_only"] is True
    assert list(service["networks"]) == ["backup-offsite"]
