from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from crate.secret_files import SECRET_NAMES, SecretFileError, load_secret_files

APP = Path(__file__).resolve().parents[1]


def _secret(tmp_path: Path, name: str, content: bytes) -> str:
    path = tmp_path / name
    path.write_bytes(content)
    return str(path)


def test_file_value_replaces_the_environment_value(tmp_path):
    environ = {
        "JWT_SECRET": "",
        "JWT_SECRET_FILE": _secret(tmp_path, "jwt", b"from-file\n"),
        "CRATE_POSTGRES_PASSWORD": "from-env",
    }

    assert load_secret_files(environ) == ["JWT_SECRET"]
    assert environ["JWT_SECRET"] == "from-file"
    assert environ["CRATE_POSTGRES_PASSWORD"] == "from-env"


def test_only_trailing_line_breaks_are_removed(tmp_path):
    environ = {
        "REDIS_URL_FILE": _secret(tmp_path, "redis", b"redis://:p w@redis:6379/0\r\n"),
        "APPLE_PRIVATE_KEY_FILE": _secret(tmp_path, "apple", b"-----A-----\nkey\n"),
    }

    load_secret_files(environ)

    assert environ["REDIS_URL"] == "redis://:p w@redis:6379/0"
    assert environ["APPLE_PRIVATE_KEY"] == "-----A-----\nkey"


def test_empty_file_variable_keeps_the_environment_value():
    environ = {"JWT_SECRET": "from-env", "JWT_SECRET_FILE": "  "}

    assert load_secret_files(environ) == []
    assert environ["JWT_SECRET"] == "from-env"


def test_names_outside_the_allowlist_are_ignored(tmp_path):
    environ = {"CRATE_CONFIG_FILE": _secret(tmp_path, "config", b"not-a-secret")}

    assert load_secret_files(environ) == []
    assert "CRATE_CONFIG" not in environ


def test_unreadable_file_fails_without_falling_back_to_the_environment(tmp_path):
    environ = {
        "JWT_SECRET": "from-env",
        "JWT_SECRET_FILE": str(tmp_path / "missing"),
    }

    with pytest.raises(SecretFileError, match="JWT_SECRET_FILE") as error:
        load_secret_files(environ)

    assert error.value.__cause__ is None
    assert error.value.__suppress_context__ is True
    assert environ["JWT_SECRET"] == "from-env"


def test_undecodable_file_error_does_not_include_its_content(tmp_path):
    environ = {"SLSKD_API_KEY_FILE": _secret(tmp_path, "slskd", b"secret\xff")}

    with pytest.raises(SecretFileError) as error:
        load_secret_files(environ)

    assert (
        str(error.value) == "SLSKD_API_KEY_FILE could not be read: UnicodeDecodeError"
    )
    assert error.value.__suppress_context__ is True


def test_core_and_external_service_secrets_are_supported():
    assert {
        "JWT_SECRET",
        "CRATE_POSTGRES_PASSWORD",
        "POSTGRES_SUPERUSER_PASSWORD",
        "REDIS_URL",
        "REDIS_CACHE_URL",
        "REDIS_DURABLE_URL",
        "CRATE_CREDENTIAL_KEY",
        "CRATE_READPLANE_SERVICE_TOKEN",
        "SLSKD_API_KEY",
        "LASTFM_API_SECRET",
        "SPOTIFY_SECRET",
        "GOOGLE_CLIENT_SECRET",
    } <= set(SECRET_NAMES)
    assert len(SECRET_NAMES) == len(set(SECRET_NAMES))


def test_every_crate_process_loads_secret_files_on_import(tmp_path):
    secret = _secret(tmp_path, "jwt", b"from-file\n")
    environment = {
        "PATH": os.environ["PATH"],
        "JWT_SECRET": "",
        "JWT_SECRET_FILE": secret,
    }

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import os, crate; print(os.environ['JWT_SECRET'] == 'from-file')",
        ],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "True"
