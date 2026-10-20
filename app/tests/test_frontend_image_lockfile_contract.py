"""The ui, listen and cast-receiver images install from the root lockfile.

Each image builds with the repository root as context, runs ``npm ci`` limited
to its workspace and the workspaces it depends on, and sends only an
allowlisted context through ``<Dockerfile>.dockerignore``.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
IMAGES = {
    "ui": "app/ui",
    "listen": "app/listen",
    "cast-receiver": "app/cast-receiver",
}
ROOT_PACKAGE = json.loads((ROOT / "package.json").read_text())
LOCK_PACKAGES = json.loads((ROOT / "package-lock.json").read_text())["packages"]
NEVER_SENT = ("data", "media", "test-music", ".git", ".env", "node_modules")
RELATIVE_IMPORT = re.compile(
    r"""(?:from\s+|import\s*\(\s*|import\s+|@import\s+|@source\s+|url\(\s*)"""
    r"""["'](\.\.?/[^"']+)["']"""
)
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".css", ".html"}


def _workspace_closure(workspace: str) -> set[str]:
    """The workspace plus every workspace it links to, transitively."""
    closure: set[str] = set()
    pending = [workspace]
    while pending:
        current = pending.pop()
        if current in closure:
            continue
        closure.add(current)
        entry = LOCK_PACKAGES[current]
        for name in {
            **entry.get("dependencies", {}),
            **entry.get("devDependencies", {}),
        }:
            linked = LOCK_PACKAGES.get(f"node_modules/{name}", {})
            if linked.get("link"):
                pending.append(linked["resolved"])
    return closure


def _source_files(directory: Path) -> list[Path]:
    files = []
    for path in directory.rglob("*"):
        parts = set(path.relative_to(ROOT).parts)
        if parts & {"node_modules", "dist", "android", "ios", "coverage"}:
            continue
        if path.suffix in SOURCE_SUFFIXES and ".test." not in path.name:
            files.append(path)
    return files


def _shared_dirs_imported_by(workspaces: set[str]) -> set[str]:
    """app/shared/<dir> folders reached by relative imports from the build."""
    shared: set[str] = set()
    for workspace in workspaces:
        for path in _source_files(ROOT / workspace):
            for specifier in RELATIVE_IMPORT.findall(path.read_text()):
                target = os.path.normpath(path.parent / specifier)
                relative = Path(target).relative_to(ROOT).parts
                if relative[:2] == ("app", "shared") and len(relative) > 2:
                    shared.add(f"app/shared/{relative[2]}")
    return shared


def _dockerfile(image: str) -> str:
    return (ROOT / IMAGES[image] / "Dockerfile").read_text()


def _ignore_patterns(image: str) -> list[str]:
    text = (ROOT / IMAGES[image] / "Dockerfile.dockerignore").read_text()
    return [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


@pytest.mark.parametrize("image", IMAGES)
def test_image_installs_its_workspaces_from_the_root_lockfile(image: str) -> None:
    dockerfile = _dockerfile(image)
    workspaces = _workspace_closure(IMAGES[image])
    install = re.search(r"^RUN npm ci((?: --workspace=\S+)+)$", dockerfile, re.M)

    assert install, "the image must install with npm ci"
    assert set(re.findall(r"--workspace=(\S+)", install.group(1))) == workspaces
    assert workspaces <= set(ROOT_PACKAGE["workspaces"])
    lock_copy = dockerfile.index("COPY package.json package-lock.json ./")
    for workspace in workspaces:
        manifest = dockerfile.index(f"COPY {workspace}/package.json {workspace}/")
        assert lock_copy < manifest < install.start()
    for legacy in ("npm install", "--package-lock=false", "sed -i", "ln -s"):
        assert legacy not in dockerfile


@pytest.mark.parametrize("image", IMAGES)
def test_image_builds_and_serves_from_its_repository_path(image: str) -> None:
    dockerfile = _dockerfile(image)
    workspace = IMAGES[image]

    assert f"WORKDIR /repo/{workspace}" in dockerfile
    assert f"COPY --from=build /repo/{workspace}/dist /usr/share/nginx/html" in (
        dockerfile
    )
    assert (
        f"COPY --from=build /repo/{workspace}/nginx.conf /etc/nginx/conf.d/default.conf"
    ) in dockerfile


@pytest.mark.parametrize("image", IMAGES)
def test_image_context_is_an_allowlist(image: str) -> None:
    patterns = _ignore_patterns(image)
    included = {p[1:].rstrip("/") for p in patterns if p.startswith("!")}
    workspaces = _workspace_closure(IMAGES[image])
    needed = workspaces | _shared_dirs_imported_by(workspaces)

    assert patterns[0] == "*"
    assert included == {"package.json", "package-lock.json", *needed}
    for name in NEVER_SENT:
        assert not any(path.split("/")[0] == name for path in included)
    for generated in ("**/node_modules/", "**/dist/", "**/.env", "**/.env.*"):
        assert generated in patterns
        assert patterns.index(generated) > max(
            patterns.index(f"!{path}/") for path in needed
        )


@pytest.mark.parametrize("image", IMAGES)
def test_ci_builds_the_image_from_the_repository_root(image: str) -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows/build-images.yml").read_text())
    build = next(
        step
        for step in workflow["jobs"][f"build-{image}"]["steps"]
        if step.get("id") == "build"
    )["with"]

    assert build["context"] == "."
    assert build["file"] == f"./{IMAGES[image]}/Dockerfile"
    assert build["cache-from"] == f"type=gha,scope={image}"
    assert build["cache-to"] == f"type=gha,scope={image},mode=max"


def test_compose_builds_the_images_from_the_repository_root() -> None:
    dockerfiles = {f"{workspace}/Dockerfile" for workspace in IMAGES.values()}
    builds = []
    for compose_file in sorted(ROOT.glob("docker-compose*.yaml")):
        services = yaml.safe_load(compose_file.read_text()).get("services", {})
        for name, service in services.items():
            build = service.get("build")
            if not isinstance(build, dict):
                continue
            context = os.path.normpath(build.get("context", "."))
            dockerfile = os.path.normpath(
                os.path.join(context, build.get("dockerfile", "Dockerfile"))
            )
            if dockerfile in dockerfiles or any(
                dockerfile.endswith(path.removeprefix("app/")) for path in dockerfiles
            ):
                builds.append((compose_file.name, name, context, dockerfile))

    assert {(file, name) for file, name, *_ in builds} >= {
        ("docker-compose.yaml", "crate-ui"),
        ("docker-compose.yaml", "crate-listen"),
        ("docker-compose.yaml", "crate-cast-receiver"),
        ("docker-compose.dev.yaml", "cast-receiver"),
        ("docker-compose.federation-dev.yaml", "node-a-admin"),
        ("docker-compose.federation-dev.yaml", "node-a-listen"),
    }
    for file, name, context, dockerfile in builds:
        assert context == ".", (file, name)
        assert dockerfile in dockerfiles, (file, name)
