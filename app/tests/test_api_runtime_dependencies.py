"""The API image only installs requirements-api.txt.

Tests run with every worker dependency installed, so a router that imports an
analysis module (numpy, librosa...) passes here and then crashes the API container
at startup. This test builds the app with those packages unimportable.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]

# Import names installed by requirements-worker-core.txt or
# requirements-worker-analysis.txt but absent from the API image.
WORKER_ONLY_MODULES = (
    "apscheduler",
    "essentia",
    "jinja2",
    "librosa",
    "numba",
    "numpy",
    "scipy",
    "sklearn",
    "soundfile",
    "watchdog",
)

_BUILD_APP_WITHOUT_WORKER_MODULES = """
import sys

for name in {modules!r}:
    sys.modules[name] = None  # any import of it raises ImportError

from crate.api import create_app

create_app()
"""


def test_api_app_builds_without_worker_only_dependencies():
    environment = {
        **os.environ,
        "PYTHONPATH": str(APP_ROOT),
        "JWT_SECRET": os.environ.get(
            "JWT_SECRET", "api-runtime-dependencies-test-secret-0123456789"
        ),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            _BUILD_APP_WITHOUT_WORKER_MODULES.format(modules=WORKER_ONLY_MODULES),
        ],
        cwd=APP_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-4000:]
