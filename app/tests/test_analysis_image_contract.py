"""How the analysis worker image installs the Smart Mix beat model (SM3-D14).

The image itself is checked by building it; these tests keep the Dockerfile from
drifting away from what that check verified.
"""

from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = (APP_ROOT / "Dockerfile").read_text()
BEAT_THIS_REQUIREMENTS = (APP_ROOT / "requirements-beat-this.txt").read_text()


def _stage(name: str) -> str:
    match = re.search(
        rf"^FROM \S+ AS {re.escape(name)}\n(.*?)(?=^FROM |\Z)", DOCKERFILE, re.M | re.S
    )
    assert match is not None, name
    return match.group(1)


def _version(pattern: str, text: str) -> tuple[int, ...]:
    match = re.search(pattern, text, re.M)
    assert match is not None, pattern
    return tuple(int(part) for part in match.group(1).split("."))


def test_torch_is_pinned_with_the_torchaudio_beat_this_runs_on() -> None:
    deps = _stage("worker-analysis-deps")
    torch = _version(r"^ARG TORCH_VERSION=(\d+\.\d+\.\d+)$", deps)
    torchaudio = _version(r"^torchaudio==(\d+\.\d+\.\d+)$", BEAT_THIS_REQUIREMENTS)

    # Both are pinned, so a new torch on the CPU index never pairs itself with a
    # torchaudio nobody ran Beat This! on.
    assert 'pip install "torch==${TORCH_VERSION}"' in deps
    # torchaudio 2.9+ declares torch >= its own minor version.
    assert torch[:2] >= torchaudio[:2]
