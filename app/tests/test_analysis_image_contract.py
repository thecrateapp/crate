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
    builder = _stage("madmom-build")

    assert re.search(r"^FROM worker-analysis-python AS madmom-build$", DOCKERFILE, re.M)
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


def _global_args() -> dict[str, str]:
    head = DOCKERFILE.split("\nFROM ", 1)[0]
    return dict(re.findall(r"^ARG (\w+)=(\S*)$", head, re.M))


def _stages() -> dict[str, tuple[str, str]]:
    """Every named stage: its FROM reference and its body."""
    return {
        name: (base, body)
        for base, name, body in re.findall(
            r"^FROM (\S+) AS (\S+)\n(.*?)(?=^FROM |\Z)", DOCKERFILE, re.M | re.S
        )
    }


def _reachable(target: str, build_args: dict[str, str]) -> set[str]:
    """The stages BuildKit builds for ``target`` with these build arguments."""
    args = _global_args() | build_args
    stages = _stages()

    def expand(ref: str) -> str:
        return re.sub(r"\$\{(\w+)\}", lambda match: args[match.group(1)], ref)

    seen: set[str] = set()
    pending = [target]
    while pending:
        name = pending.pop()
        if name in seen or name not in stages:
            continue
        seen.add(name)
        base, body = stages[name]
        pending.append(expand(base))
        # COPY --from= and RUN --mount=...,from=
        pending.extend(re.findall(r"\bfrom=([\w.-]+)", body))
    return seen


def _fetches_or_compiles_madmom(stages: set[str]) -> list[str]:
    bodies = _stages()
    return [
        name
        for name in sorted(stages)
        if re.search(r"madmom\.git|pip wheel|build-essential|cython", bodies[name][1])
    ]


# The same rule as torch: PANNS=on installs it everywhere, auto only on x86_64.
WITH_TORCH = [("on", "amd64"), ("on", "arm64"), ("auto", "amd64")]
WITHOUT_TORCH = [("off", "amd64"), ("off", "arm64"), ("auto", "arm64")]


def test_images_without_torch_neither_fetch_nor_compile_madmom() -> None:
    for panns, arch in WITHOUT_TORCH:
        stages = _reachable("worker-analysis", {"PANNS": panns, "TARGETARCH": arch})

        assert _fetches_or_compiles_madmom(stages) == [], (panns, arch)
        # A misspelt alias would reach no stage at all (BuildKit would then pull it as
        # an image and fail), which the check above alone cannot tell from skipping.
        assert {"madmom-wheel", "madmom-skip"} <= stages, (panns, arch)
        assert "madmom-build" not in stages, (panns, arch)


def test_images_with_torch_build_madmom() -> None:
    for panns, arch in WITH_TORCH:
        stages = _reachable("worker-analysis", {"PANNS": panns, "TARGETARCH": arch})

        assert _fetches_or_compiles_madmom(stages) != [], (panns, arch)
        assert {"madmom-wheel", "madmom-build"} <= stages, (panns, arch)
        assert "madmom-skip" not in stages, (panns, arch)


def test_madmom_licence_ships_only_with_madmom() -> None:
    deps = _stage("worker-analysis-deps")
    install = deps.split("ARG TORCH_VERSION", 1)[1].split("\n\n", 1)[0]

    # Copied by the install under the torch condition, never by a COPY of its own.
    assert not re.search(r"^COPY --from=madmom", DOCKERFILE, re.M)
    assert "cp /tmp/madmom-wheels/madmom.LICENSE /app/models/madmom.LICENSE" in install
