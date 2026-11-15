from __future__ import annotations

import fnmatch
import importlib.util
import json
import os
import re
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
BUILD_WORKFLOW_PATH = ".github/workflows/build-images.yml"
SPEC = importlib.util.spec_from_file_location(
    "crate_release_manifest", ROOT / "scripts/release_manifest.py"
)
assert SPEC is not None and SPEC.loader is not None
release_manifest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release_manifest
SPEC.loader.exec_module(release_manifest)

IMAGE_SPECS = release_manifest.IMAGE_SPECS
ManifestError = release_manifest.ManifestError
assemble_manifest = release_manifest.assemble_manifest
detect_changed_images = release_manifest.detect_changed_images
render_release_env = release_manifest.render_release_env
validate_manifest = release_manifest.validate_manifest


RELEASE_SHA = "b" * 40
PREVIOUS_SHA = "a" * 40


def _previous_manifest() -> dict:
    images = {}
    for index, (name, spec) in enumerate(IMAGE_SPECS.items(), start=1):
        digest = f"sha256:{index:064x}"
        images[name] = {
            "repository": f"ghcr.io/thecrateapp/{spec.repository}",
            "digest": digest,
            "source_sha": PREVIOUS_SHA,
            "environment": spec.environment,
            "services": list(spec.services),
        }
    return {
        "schema_version": 1,
        "release_sha": PREVIOUS_SHA,
        "images": images,
    }


def test_listen_change_only_selects_listen_image() -> None:
    assert detect_changed_images(["app/listen/src/App.tsx"]) == {"listen"}


def test_blog_edit_rebuilds_only_the_site_and_the_agent() -> None:
    previous = assemble_manifest(
        release_sha=PREVIOUS_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=_previous_manifest(),
        changed_digests={"agent": "sha256:" + "e" * 64},
    )
    paths = ["app/web/src/content/blog/a-post.md"]
    selected = detect_changed_images(
        paths
    ) | release_manifest.detect_changed_agent_images(paths)
    # The agent image bakes the release context, so it follows every change.
    assert selected == {"site", "agent"}
    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=previous,
        changed_digests={name: "sha256:" + "f" * 64 for name in selected},
    )
    assert manifest["agent_images"]["agent"]["source_sha"] == RELEASE_SHA
    assert {
        name
        for name in IMAGE_SPECS
        if manifest["images"][name] != previous["images"][name]
    } == {"site"}


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        (
            "jobs:\n  build-site:\n    steps:\n      - run: build old\n",
            "jobs:\n  build-site:\n    steps:\n      - run: build new\n",
            {"site"},
        ),
        (
            "jobs:\n  build-worker:\n    uses: old\n",
            "jobs:\n  build-worker:\n    uses: new\n",
            {"worker"},
        ),
        (
            "env:\n  REGISTRY: old\njobs:\n  build-site:\n    steps: []\n",
            "env:\n  REGISTRY: new\njobs:\n  build-site:\n    steps: []\n",
            set(release_manifest.ALL_IMAGE_SPECS),
        ),
        (
            "jobs:\n  changes:\n    steps: []\n",
            "jobs:\n  changes:\n    steps: [new]\n",
            set(release_manifest.ALL_IMAGE_SPECS),
        ),
        (
            "jobs:\n  promote-release:\n    steps: []\n",
            "jobs:\n  promote-release:\n    steps: [new]\n",
            set(release_manifest.ALL_IMAGE_SPECS),
        ),
        (
            "jobs:\n  unknown:\n    steps: []\n",
            "jobs:\n  unknown:\n    steps: [new]\n",
            set(release_manifest.ALL_IMAGE_SPECS),
        ),
        ("", "jobs: {}\n", set(release_manifest.ALL_IMAGE_SPECS)),
    ],
)
def test_workflow_changes_rebuild_only_affected_jobs_or_fail_closed(
    before, after, expected
):
    assert release_manifest.detect_workflow_images(before, after) == expected


def test_scoped_site_workflow_change_does_not_rebuild_other_images():
    detect_agent = release_manifest.detect_changed_agent_images
    workflow = [".github/workflows/build-images.yml"]
    assert detect_changed_images(workflow, workflow_images={"site"}) == {"site"}
    assert detect_agent(workflow, workflow_images={"site"}) == set()
    # Source changes still follow their own patterns; the agent follows all.
    paths = [*workflow, "app/web/Dockerfile"]
    assert detect_changed_images(paths, workflow_images={"site"}) == {"site"}
    assert detect_agent(paths, workflow_images={"site"}) == {"agent"}


def test_shared_workflow_alias_rebuilds_all_its_consumers():
    before = "jobs:\n  build-site:\n    steps: &shared\n      - run: old\n  build-docs:\n    steps: *shared\n"
    assert release_manifest.detect_workflow_images(
        before, before.replace("run: old", "run: new")
    ) == {"site", "docs"}
    assert release_manifest.detect_workflow_images(before, before) == set()


# Isolate fixture repositories from the developer's Git configuration (commit
# signing, templates, hooks).
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def _git_commit(repo: Path) -> str:
    if not (repo / ".git").exists():
        subprocess.run(["git", "init", "-q", str(repo)], check=True, env=GIT_ENV)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, env=GIT_ENV)
    subprocess.run(
        [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "fixture",
        ],
        cwd=repo,
        check=True,
        env=GIT_ENV,
    )
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True, env=GIT_ENV
    ).strip()


def _detect_cli(repo: Path, base: str, head: str) -> set[str]:
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/release_manifest.py"),
            "detect",
            "--base",
            base,
            "--head",
            head,
        ],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
        env=GIT_ENV,
    )
    outputs = dict(line.split("=", 1) for line in result.stdout.splitlines())
    return {name for name, value in outputs.items() if value == "true"}


def test_detect_cli_scopes_git_workflow_diff_and_blog_changes(tmp_path):
    workflow = tmp_path / ".github/workflows/build-images.yml"
    workflow.parent.mkdir(parents=True)
    before = "jobs:\n  changes:\n    steps: []\n  build-site:\n    steps:\n      - run: old\n"
    workflow.write_text(before)
    base = _git_commit(tmp_path)
    workflow.write_text(before.replace("run: old", "run: new"))
    post = tmp_path / "app/web/src/content/blog/post.md"
    post.parent.mkdir(parents=True)
    post.write_text("A new post")
    head = _git_commit(tmp_path)
    assert _detect_cli(tmp_path, base, head) == {"site", "agent", "any"}


def test_detect_cli_selects_the_image_a_file_moves_out_of(tmp_path):
    source = tmp_path / "app/web/src/styles/tokens.css"
    source.parent.mkdir(parents=True)
    source.write_text(":root { --accent: #f60; }\n" * 20)
    base = _git_commit(tmp_path)
    target = tmp_path / "app/web/src/legacy/tokens.css"
    target.parent.mkdir(parents=True)
    source.rename(target)
    head = _git_commit(tmp_path)
    # A rename-aware diff names only the destination, which ryoku-site does not watch.
    assert "ryoku_site" in _detect_cli(tmp_path, base, head)


def test_cast_receiver_change_only_selects_receiver_image() -> None:
    assert detect_changed_images(["app/cast-receiver/src/App.tsx"]) == {"cast-receiver"}


def test_legacy_manifest_without_cast_receiver_is_not_a_usable_baseline() -> None:
    previous = _previous_manifest()
    del previous["images"]["cast-receiver"]

    assert (
        release_manifest.baseline_release_sha(
            previous, registry="ghcr.io", owner="thecrateapp"
        )
        is None
    )


def test_complete_manifest_returns_its_release_sha_as_baseline() -> None:
    assert (
        release_manifest.baseline_release_sha(
            _previous_manifest(), registry="ghcr.io", owner="thecrateapp"
        )
        == PREVIOUS_SHA
    )


def test_cast_receiver_font_change_selects_every_font_consumer() -> None:
    assert detect_changed_images(["app/shared/fonts/poppins.css"]) == {
        "cast-receiver",
        "docs",
        "listen",
        "site",
        "ui",
    }


def test_shared_frontend_change_selects_every_shared_consumer() -> None:
    assert detect_changed_images(["app/shared/web/api.ts"]) == {
        "docs",
        "listen",
        "site",
        "ui",
    }


def test_ryoku_site_change_only_selects_the_ryoku_site_image() -> None:
    assert detect_changed_images(["app/ryoku/src/pages/index.astro"]) == {"ryoku-site"}


@pytest.mark.parametrize(
    "path",
    [
        "app/web/src/styles/tokens.css",
        "app/web/src/scripts/motion/reveal.ts",
        "app/web/public/fonts/roboto/latin.woff2",
        "app/web/public/icons/logo.svg",
    ],
)
def test_crate_web_foundation_change_rebuilds_both_sites(path: str) -> None:
    assert detect_changed_images([path]) == {"site", "ryoku-site"}


def test_ryoku_site_release_env_names_its_image() -> None:
    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=_previous_manifest(),
        changed_digests={},
    )

    assert (
        "CRATE_RYOKU_SITE_IMAGE=ghcr.io/thecrateapp/crate-ryoku-site@sha256:"
        in render_release_env(manifest)
    )


def test_backend_change_selects_backend_compatibility_group() -> None:
    assert detect_changed_images(["app/crate/api/catalog.py"]) == {
        "analysis-worker",
        "api",
        "playback-worker",
        "worker",
    }


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("app/media-worker/src/main.rs", {"media-worker"}),
        ("app/readplane/internal/server/server.go", {"readplane"}),
        (
            "app/Dockerfile",
            {
                "analysis-worker",
                "api",
                "media-worker",
                "playback-worker",
                "worker",
            },
        ),
        (
            "app/.dockerignore",
            {
                "analysis-worker",
                "api",
                "media-worker",
                "playback-worker",
                "worker",
            },
        ),
        ("app/requirements-beat-this.txt", {"analysis-worker"}),
        ("package-lock.json", {"cast-receiver", "listen", "ui"}),
        ("package.json", {"cast-receiver", "listen", "ui"}),
        ("app/ui/Dockerfile.dockerignore", {"ui"}),
        ("app/listen/Dockerfile.dockerignore", {"listen"}),
        ("app/cast-receiver/Dockerfile.dockerignore", {"cast-receiver"}),
        ("app/ryoku/Dockerfile.dockerignore", {"ryoku-site"}),
        ("app/web/README.md", {"site"}),
        (".github/workflows/build-images.yml", set(IMAGE_SPECS)),
        (".github/workflows/build-image.yml", set(IMAGE_SPECS)),
    ],
)
def test_change_classifier_covers_independent_build_inputs(
    path: str, expected: set[str]
) -> None:
    assert detect_changed_images([path]) == expected


def test_manual_backend_request_expands_compatibility_group() -> None:
    assert detect_changed_images([], requested="backend") == {
        "analysis-worker",
        "api",
        "playback-worker",
        "worker",
    }


def test_assemble_manifest_replaces_changed_digest_and_preserves_others() -> None:
    previous = _previous_manifest()
    listen_digest = f"sha256:{999:064x}"

    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=previous,
        changed_digests={"listen": listen_digest},
    )

    assert manifest["release_sha"] == RELEASE_SHA
    assert manifest["images"]["listen"]["digest"] == listen_digest
    assert manifest["images"]["listen"]["source_sha"] == RELEASE_SHA
    assert manifest["images"]["api"] == previous["images"]["api"]
    validate_manifest(manifest, expected_release_sha=RELEASE_SHA)


def test_assemble_manifest_requires_every_image_without_previous_release() -> None:
    with pytest.raises(ManifestError, match="missing image"):
        assemble_manifest(
            release_sha=RELEASE_SHA,
            registry="ghcr.io",
            owner="thecrateapp",
            previous=None,
            changed_digests={"listen": f"sha256:{999:064x}"},
        )


def test_validation_rejects_repository_or_digest_tampering() -> None:
    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=_previous_manifest(),
        changed_digests={},
    )
    tampered_repository = deepcopy(manifest)
    tampered_repository["images"]["listen"]["repository"] = "evil.invalid/listen"
    with pytest.raises(ManifestError, match="repository"):
        validate_manifest(tampered_repository, expected_release_sha=RELEASE_SHA)

    tampered_digest = deepcopy(manifest)
    tampered_digest["images"]["listen"]["digest"] = "latest"
    with pytest.raises(ManifestError, match="digest"):
        validate_manifest(tampered_digest, expected_release_sha=RELEASE_SHA)


def test_release_environment_uses_immutable_digest_references() -> None:
    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=_previous_manifest(),
        changed_digests={},
    )

    rendered = render_release_env(manifest)

    assert f"CRATE_RELEASE_SHA={RELEASE_SHA}" in rendered
    assert "CRATE_LISTEN_IMAGE=ghcr.io/thecrateapp/crate-listen@sha256:" in rendered
    assert (
        "CRATE_CAST_RECEIVER_IMAGE=ghcr.io/thecrateapp/crate-cast-receiver@sha256:"
        in rendered
    )
    assert ":latest" not in rendered


def _manifest_with_changed(*names: str) -> dict:
    return assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=_previous_manifest(),
        changed_digests={
            name: f"sha256:{900 + i:064x}" for i, name in enumerate(names)
        },
    )


def test_sentry_releases_name_each_image_release_with_its_projects() -> None:
    manifest = _manifest_with_changed("api", "worker", "cast-receiver")

    releases = release_manifest.sentry_releases(manifest)

    # Each image reports the release of the commit it was built at.
    assert releases == {
        f"cast-receiver-{RELEASE_SHA}": ["crate-cast-receiver"],
        f"crate-{PREVIOUS_SHA}": [
            "crate-admin",
            "crate-docs",
            "crate-listen",
            "crate-media-worker",
            "crate-readplane",
            "crate-workers",
        ],
        f"crate-{RELEASE_SHA}": ["crate-api", "crate-workers"],
    }


def test_sentry_releases_keep_only_the_images_built_at_a_commit() -> None:
    manifest = _manifest_with_changed("ui", "listen")

    assert release_manifest.sentry_releases(manifest, source_sha=RELEASE_SHA) == {
        f"crate-{RELEASE_SHA}": ["crate-admin", "crate-listen"],
    }
    assert release_manifest.sentry_releases(manifest, source_sha="c" * 40) == {}


def test_sentry_releases_skip_images_without_sentry() -> None:
    releases = release_manifest.sentry_releases(_manifest_with_changed("site"))

    assert all(
        "site" not in project for projects in releases.values() for project in projects
    )
    assert f"crate-{RELEASE_SHA}" not in releases


def test_sentry_releases_command_prints_release_and_projects(tmp_path: Path) -> None:
    path = tmp_path / "release-manifest.json"
    path.write_text(json.dumps(_manifest_with_changed("api", "readplane")))

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/release_manifest.py"),
            "sentry-releases",
            "--manifest",
            str(path),
            "--source-sha",
            RELEASE_SHA,
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout == f"crate-{RELEASE_SHA}\tcrate-api,crate-readplane\n"


AGENT_DIGEST = f"sha256:{777:064x}"


def test_any_change_rebuilds_the_agent_image_without_touching_fleet_detection() -> None:
    detect_agent = release_manifest.detect_changed_agent_images
    assert detect_changed_images(["docs/technical/operations.md"]) == {"docs"}
    assert detect_agent(["docs/technical/operations.md"]) == {"agent"}
    assert detect_agent([]) == set()
    assert detect_agent([], requested="api") == set()
    assert detect_agent([], requested="agent") == {"agent"}
    assert detect_changed_images([], requested="agent") == set()
    assert "agent" in detect_agent([], requested="all")


def test_agent_image_is_an_optional_entry_outside_the_fleet() -> None:
    previous = _previous_manifest()
    validate_manifest(previous, registry="ghcr.io", owner="thecrateapp")
    without = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=previous,
        changed_digests={},
    )
    assert "agent_images" not in without
    assert "CRATE_AGENT_IMAGE" not in render_release_env(without)

    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=previous,
        changed_digests={"agent": AGENT_DIGEST},
    )
    assert set(manifest["images"]) == set(IMAGE_SPECS)
    entry = manifest["agent_images"]["agent"]
    assert entry["repository"] == "ghcr.io/thecrateapp/crate-agent"
    assert entry["services"] == ["crate-agent", "crate-operator"]
    assert (
        f"CRATE_AGENT_IMAGE=ghcr.io/thecrateapp/crate-agent@{AGENT_DIGEST}"
        in render_release_env(manifest)
    )

    carried = assemble_manifest(
        release_sha="c" * 40,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=manifest,
        changed_digests={},
    )
    assert carried["agent_images"] == manifest["agent_images"]

    tampered = deepcopy(manifest)
    tampered["agent_images"]["agent"]["digest"] = "latest"
    with pytest.raises(ManifestError, match="digest"):
        validate_manifest(tampered)
    unknown = deepcopy(manifest)
    unknown["agent_images"]["other"] = entry
    with pytest.raises(ManifestError, match="unknown agent image"):
        validate_manifest(unknown)


RYOKU_DOCKERFILE = ROOT / "app/ryoku/Dockerfile"
# Module and stylesheet references: static, re-exported and dynamic imports,
# CSS @import (quoted or url()) and CSS url().
WEB_REFERENCE = re.compile(
    r"""(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']"""
    r"""|@import\s+(?:url\(\s*)?["']?([^"')\s;]+)"""
    r"""|\burl\(\s*["']?([^"')\s]+)"""
)
WEB_SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".mjs", ".astro", ".css")


def _ryoku_web_copies() -> set[str]:
    """app/web sources the ryoku-site image copies, as change-detection patterns."""
    copies = set()
    for line in RYOKU_DOCKERFILE.read_text().splitlines():
        parts = line.split()
        if parts[:1] != ["COPY"] or any(part.startswith("--") for part in parts):
            continue
        for source in parts[1:-1]:
            if source.startswith("app/web/"):
                copies.add(source + "**" if source.endswith("/") else source)
    return copies


def _web_references(text: str) -> list[str]:
    return [
        next(group for group in match if group) for match in WEB_REFERENCE.findall(text)
    ]


def _resolve_web_file(path: Path) -> Path:
    candidates = [path]
    candidates += [path.with_name(path.name + suffix) for suffix in WEB_SOURCE_SUFFIXES]
    candidates += [path / f"index{suffix}" for suffix in WEB_SOURCE_SUFFIXES]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise AssertionError(f"unresolved app/web reference: {path}")


def _web_dependencies(
    entries: Path, web: Path, alias: str = "@crate-web/"
) -> set[Path]:
    """Every file under ``web`` that ``entries`` reach through ``alias``, transitively.

    Relative references resolve beside their file and absolute CSS URLs against
    the served ``public`` directory; package and remote references are skipped.
    """
    pending = [
        _resolve_web_file(web / "src" / reference.removeprefix(alias))
        for source in entries.rglob("*")
        if source.is_file() and source.suffix in WEB_SOURCE_SUFFIXES
        for reference in _web_references(source.read_text(errors="ignore"))
        if reference.startswith(alias)
    ]
    seen: set[Path] = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        if path.suffix not in WEB_SOURCE_SUFFIXES:
            continue
        for reference in _web_references(path.read_text()):
            reference = reference.split("?", 1)[0].split("#", 1)[0]
            if reference.startswith(alias):
                target = web / "src" / reference.removeprefix(alias)
            elif reference.startswith(("./", "../")):
                target = (path.parent / reference).resolve()
            elif reference.startswith("/") and not reference.startswith("//"):
                target = web / "public" / reference.lstrip("/")
            else:
                continue
            pending.append(_resolve_web_file(target))
    return seen


def _ryoku_web_dependencies() -> set[str]:
    web = ROOT / "app/web"
    return {
        str(path.relative_to(ROOT))
        for path in _web_dependencies(ROOT / "app/ryoku/src", web)
    }


def test_web_dependency_walker_follows_every_reference_form(tmp_path: Path) -> None:
    entries, web = tmp_path / "ryoku/src", tmp_path / "web"
    files = {
        entries / "page.astro": (
            'import "@crate-web/styles/base.css";\n'
            'const lazy = await import("@crate-web/scripts/lazy");\n'
            'export { motion } from "@crate-web/scripts/motion";\n'
            'import pkg from "gsap";\n'
        ),
        web / "src/styles/base.css": (
            '@import "./tokens.css";\n@import url(./reset.css);\n'
            '@import "@fontsource/mono/400.css";\n'
            "body { background: url(/fonts/a.woff2); mask: url('../img/m.svg'); }\n"
            'p { background: url("data:image/svg+xml;utf8,<svg/>"); }\n'
        ),
        web / "src/styles/tokens.css": "",
        web / "src/styles/reset.css": "",
        web / "src/img/m.svg": "<svg/>",
        web / "public/fonts/a.woff2": "",
        web / "src/scripts/lazy.mjs": 'import { env } from "./env";\n',
        web / "src/scripts/env.ts": "",
        web / "src/scripts/motion/index.ts": "export const motion = 1;\n",
        web / "src/unused.ts": "",
    }
    for path, text in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert {str(path.relative_to(web)) for path in _web_dependencies(entries, web)} == {
        "src/styles/base.css",
        "src/styles/tokens.css",
        "src/styles/reset.css",
        "src/img/m.svg",
        "public/fonts/a.woff2",
        "src/scripts/lazy.mjs",
        "src/scripts/env.ts",
        "src/scripts/motion/index.ts",
    }


def test_ryoku_site_patterns_match_exactly_what_its_image_copies() -> None:
    web_patterns = {
        pattern
        for pattern in IMAGE_SPECS["ryoku-site"].patterns
        if pattern.startswith("app/web/")
    }
    assert web_patterns == _ryoku_web_copies()
    assert not any(
        pattern.startswith(("app/web/src/content", "app/web/src/**"))
        for pattern in web_patterns
    )


def test_ryoku_image_copies_every_app_web_file_the_ryoku_site_imports() -> None:
    dependencies = _ryoku_web_dependencies()
    assert dependencies, "app/ryoku no longer imports @crate-web"
    copies = _ryoku_web_copies()
    assert {
        path
        for path in dependencies
        if not any(fnmatch.fnmatchcase(path, pattern) for pattern in copies)
    } == set()


@pytest.mark.parametrize(
    "path",
    [
        "app/web/src/content/blog/a-post.md",
        "app/web/src/components/blog-viz/BlogFigure.astro",
        "app/web/src/lib/blog.ts",
    ],
)
def test_blog_edit_does_not_rebuild_the_ryoku_site(path: str) -> None:
    assert detect_changed_images([path]) == {"site"}


@pytest.mark.parametrize(
    ("before", "after"),
    [
        # YAML 1.1 reads yes/no as booleans; Actions (YAML 1.2) reads strings.
        (
            "jobs:\n  build-site:\n    with:\n      flag: true\n",
            "jobs:\n  build-site:\n    with:\n      flag: yes\n",
        ),
        # Duplicate keys collapse to the last one when parsed.
        (
            "jobs:\n  build-site:\n    with:\n      flag: a\n",
            "jobs:\n  build-site:\n    with:\n      flag: b\n      flag: a\n",
        ),
    ],
)
def test_job_text_change_hidden_by_yaml_parsing_still_selects_the_job(
    before: str, after: str
) -> None:
    assert release_manifest.detect_workflow_images(before, after) == {"site"}


def test_shared_text_change_hidden_by_yaml_parsing_rebuilds_everything() -> None:
    before = "env:\n  FLAG: true\njobs:\n  build-site:\n    steps: []\n"
    after = before.replace("FLAG: true", "FLAG: on")
    assert release_manifest.detect_workflow_images(before, after) == set(
        release_manifest.ALL_IMAGE_SPECS
    )


def test_duplicate_job_names_rebuild_everything() -> None:
    before = "jobs:\n  build-site:\n    steps: []\n  build-docs:\n    steps: []\n"
    after = before + "  build-site:\n    steps: []\n"
    assert release_manifest.detect_workflow_images(before, after) == set(
        release_manifest.ALL_IMAGE_SPECS
    )


def test_workflow_comparison_without_pyyaml_rebuilds_everything(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "yaml", None)
    before = "jobs:\n  build-site:\n    steps: []\n"
    assert release_manifest.detect_workflow_images(before, before) == set(
        release_manifest.ALL_IMAGE_SPECS
    )


def test_pyyaml_install_cannot_fail_the_change_detection_job() -> None:
    import yaml

    workflow = yaml.safe_load((ROOT / BUILD_WORKFLOW_PATH).read_text())
    steps = workflow["jobs"]["changes"]["steps"]
    install = next(step for step in steps if "PyYAML" in str(step.get("run", "")))
    assert install.get("continue-on-error") is True
    assert "PyYAML==" in install["run"]
    setup = [
        step
        for step in steps
        if str(step.get("uses", "")).startswith("actions/setup-python@")
    ]
    assert setup and steps.index(setup[0]) < steps.index(install)


def test_shared_settings_aliasing_a_job_anchor_rebuild_everything() -> None:
    workflow = (
        "jobs:\n  build-site:\n    env: &site\n      MODE: {mode}\n"
        "    steps: []\nenv: *site\n"
    )
    assert release_manifest.detect_workflow_images(
        workflow.format(mode="a"), workflow.format(mode="b")
    ) == set(release_manifest.ALL_IMAGE_SPECS)


def test_job_aliasing_a_shared_anchor_is_unchanged_until_that_anchor_changes() -> None:
    workflow = (
        "env: &shared\n  MODE: {mode}\njobs:\n  build-site:\n    env: *shared\n"
        "    steps: []\n"
    )
    before = workflow.format(mode="a")
    assert release_manifest.detect_workflow_images(before, before) == set()
    assert release_manifest.detect_workflow_images(
        before, workflow.format(mode="b")
    ) == set(release_manifest.ALL_IMAGE_SPECS)


def test_deploy_tooling_ci_runs_when_the_ryoku_web_sources_change() -> None:
    import yaml

    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/test-deploy-tooling.yml").read_text()
    )
    triggers = workflow.get("on", workflow.get(True))
    watched = [
        pattern
        for pattern in IMAGE_SPECS["ryoku-site"].patterns
        if pattern.startswith("app/web/src/")
    ]
    for event in ("push", "pull_request"):
        assert set(watched) <= set(triggers[event]["paths"]), event
