from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.skipif(
    os.environ.get("CRATE_RUN_FEDERATION_E2E") != "1",
    reason="requires the running two-node federation harness",
)
def test_two_node_remote_album_import_lifecycle() -> None:
    completed = subprocess.run(
        [sys.executable, "scripts/federation-dev-e2e.py", "import"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=900,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Federation remote import E2E complete." in completed.stdout
