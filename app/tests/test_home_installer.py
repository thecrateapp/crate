import hashlib
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest


INSTALLER = Path(__file__).resolve().parents[2] / "install.sh"


@pytest.fixture
def bootstrap(tmp_path):
    tools = tmp_path / "tools"
    tools.mkdir()
    artifact = tmp_path / "crate-linux-amd64"
    artifact.write_text(
        '#!/bin/sh\nprintf "%s\\0" "$@" > "$BOOTSTRAP_INVOCATION"\n',
        encoding="utf-8",
    )
    checksum = hashlib.sha256(artifact.read_bytes()).hexdigest()
    checksums = tmp_path / "crate-checksums.txt"
    checksums.write_text(f"{checksum}  crate-linux-amd64\n", encoding="utf-8")
    invocation = tmp_path / "invocation"
    downloads = tmp_path / "downloads"
    destination = tmp_path / "kept installer"
    (tools / "uname").write_text(
        '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 1 ;; esac\n',
        encoding="utf-8",
    )
    (tools / "curl").write_text(
        """#!/bin/sh
set -eu
[ "$1" = "-fsSL" ] && [ "$3" = "-o" ]
case "$2" in
  "$CRATE_RELEASE_BASE/crate-linux-amd64") source="$BOOTSTRAP_ARTIFACT" ;;
  "$CRATE_RELEASE_BASE/crate-checksums.txt") source="$BOOTSTRAP_CHECKSUMS" ;;
  *) exit 1 ;;
esac
printf '%s\\n' "$2" >> "$BOOTSTRAP_DOWNLOADS"
cp "$source" "$4"
""",
        encoding="utf-8",
    )
    for name in ("uname", "curl"):
        (tools / name).chmod(0o755)
    env = {
        "PATH": f"{tools}{os.pathsep}{os.defpath}",
        "HOME": str(tmp_path),
        "CRATE_BIN_DIR": str(destination),
        "CRATE_RELEASE_BASE": "https://releases.invalid/v3.0.0",
        "BOOTSTRAP_ARTIFACT": str(artifact),
        "BOOTSTRAP_CHECKSUMS": str(checksums),
        "BOOTSTRAP_INVOCATION": str(invocation),
        "BOOTSTRAP_DOWNLOADS": str(downloads),
    }

    def run(*args, **overrides):
        return subprocess.run(
            ["/bin/bash", str(INSTALLER), *args],
            cwd=tmp_path,
            env={**env, **overrides},
            capture_output=True,
            text=True,
            check=False,
        )

    return SimpleNamespace(
        run=run,
        artifact=artifact,
        checksums=checksums,
        invocation=invocation,
        downloads=downloads,
        binary=destination / "crate",
    )


def test_home_installer_verifies_and_delegates_to_the_binary(bootstrap):
    result = bootstrap.run("--dir", "/srv/my music", "--skip-start")

    assert result.returncode == 0, result.stderr
    assert bootstrap.invocation.read_bytes().split(b"\0") == [
        b"install",
        b"--dir",
        b"/srv/my music",
        b"--skip-start",
        b"",
    ]
    assert bootstrap.binary.read_bytes() == bootstrap.artifact.read_bytes()
    assert os.access(bootstrap.binary, os.X_OK)
    assert bootstrap.downloads.read_text().splitlines() == [
        "https://releases.invalid/v3.0.0/crate-linux-amd64",
        "https://releases.invalid/v3.0.0/crate-checksums.txt",
    ]


@pytest.mark.parametrize("checksum", ["0" * 64, ""])
def test_home_installer_rejects_an_unverified_binary(bootstrap, checksum):
    bootstrap.checksums.write_text(f"{checksum}  crate-linux-amd64\n")

    result = bootstrap.run()

    assert result.returncode != 0
    assert "checksum" in result.stderr
    assert not bootstrap.invocation.exists()
    assert not bootstrap.binary.exists()


def test_home_installer_can_keep_the_binary_without_running_it(bootstrap):
    result = bootstrap.run(CRATE_INSTALLER_ONLY="1")

    assert result.returncode == 0, result.stderr
    assert bootstrap.binary.read_bytes() == bootstrap.artifact.read_bytes()
    assert os.access(bootstrap.binary, os.X_OK)
    assert not bootstrap.invocation.exists()
