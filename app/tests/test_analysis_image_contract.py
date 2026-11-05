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
    assert re.search(r'pip install [^\n]*"torch==\$\{TORCH_VERSION\}"', deps)
    # torchaudio 2.9+ declares torch >= its own minor version.
    assert torch[:2] >= torchaudio[:2]


MADMOM_COMMIT = "27f032e8947204902c675e5e341a3faf5dc86dae"
COMPILERS = ("build-essential", "gcc", "g++", "cython")


def test_madmom_is_built_from_a_pinned_commit_against_the_image_numpy() -> None:
    # PyPI's madmom 0.16.1 does not build on Python 3.13, and Beat This! needs its DBN.
    builder = _stage("madmom-wheel")

    assert re.search(r"^FROM worker-analysis-python AS madmom-wheel$", DOCKERFILE, re.M)
    assert f"ARG MADMOM_COMMIT={MADMOM_COMMIT}" in builder
    assert "--no-build-isolation" in builder
    # Nothing it installs to build may move the numpy it builds against.
    assert "-c /tmp/numpy-constraint.txt" in builder


def test_the_analysis_image_installs_the_madmom_wheel_without_compilers() -> None:
    deps = _stage("worker-analysis-deps")
    analysis = _stage("worker-analysis") + _stage("worker-analysis-python")
    install = deps.split("ARG TORCH_VERSION", 1)[1].split("\n\n", 1)[0]

    assert not [tool for tool in COMPILERS if tool in deps + analysis]
    # Same PANNS condition as torch and Beat This!, and the wheel never lands in a layer.
    assert "--mount=type=bind,from=madmom-wheel" in install
    assert 'if [ "$PANNS" = "on" ]' in install
    assert "/tmp/madmom-wheels/" in install.split("-r requirements-beat-this.txt", 1)[1]
    # Neither torch nor numpy may move after the wheel was built against them.
    assert "grep -iE '^(numpy|torch)=='" in install
    assert "cmp -s" in install
    assert "madmom.features.downbeats" in install


def test_madmom_licence_ships_with_the_models() -> None:
    assert (
        "COPY --from=madmom-wheel /madmom/LICENSE /app/models/madmom.LICENSE"
        in DOCKERFILE
    )
