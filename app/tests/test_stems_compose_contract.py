"""Where the server keeps Smart Mix stem audio (STEM-D6).

The worker accepts a stems directory only on the library's filesystem
(``crate.smart_mix.stem_storage``). Production keeps ``media/`` on the root disk and the
music on another volume, so the host directory is configurable like ``CACHE_DIR``:
``STEMS_DIR``, falling back to ``${MEDIA_DIR}/smart-mix-stems``.
"""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
STEMS_SOURCE = "${STEMS_DIR:-${MEDIA_DIR}/smart-mix-stems}"


def _stems_mounts(filename: str) -> dict[str, list[str]]:
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    return {
        name: [
            volume
            for volume in service.get("volumes") or []
            if isinstance(volume, str) and ":/stems" in volume
        ]
        for name, service in services.items()
        if any(
            isinstance(volume, str) and ":/stems" in volume
            for volume in service.get("volumes") or []
        )
    }


def test_production_compose_mounts_the_configurable_stems_directory():
    mounts = _stems_mounts("docker-compose.yaml")

    # The API only reads the stem files; the analysis worker writes them.
    assert mounts == {
        "crate-api": [f"{STEMS_SOURCE}:/stems:ro"],
        "crate-analysis-worker": [f"{STEMS_SOURCE}:/stems"],
    }


def test_env_example_documents_the_stems_directory():
    lines = (ROOT / ".env.example").read_text().splitlines()

    assert any(line.lstrip("# ").startswith("STEMS_DIR=") for line in lines)
