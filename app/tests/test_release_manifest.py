from __future__ import annotations

import fnmatch
import importlib.util
import json
import re
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
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


@pytest.mark.parametrize(
    "path",
    [
        "app/web/src/content/blog/a-post.md",
        "app/web/src/components/blog-viz/BlogFigure.astro",
        "docs/technical/engineering-blog-visual-plan.md",
    ],
)
def test_blog_changes_do_not_rebuild_the_agent(path: str) -> None:
    assert release_manifest.detect_changed_agent_images([path]) == set()


def test_blog_edit_preserves_every_other_image_including_agent() -> None:
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
    assert selected == {"site"}
    manifest = assemble_manifest(
        release_sha=RELEASE_SHA,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=previous,
        changed_digests={name: "sha256:" + "f" * 64 for name in selected},
    )
    assert manifest["agent_images"] == previous["agent_images"]
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
    paths = [".github/workflows/build-images.yml", "app/web/Dockerfile"]
    assert detect_changed_images(paths, workflow_images={"site"}) == {"site"}
    assert (
        release_manifest.detect_changed_agent_images(paths, workflow_images={"site"})
        == set()
    )


def test_shared_workflow_alias_rebuilds_all_its_consumers():
    before = "jobs:\n  build-site:\n    steps: &shared\n      - run: old\n  build-docs:\n    steps: *shared\n"
    assert release_manifest.detect_workflow_images(
        before, before.replace("run: old", "run: new")
    ) == {"site", "docs"}
    assert release_manifest.detect_workflow_images(before, before) == set()


def test_detect_cli_scopes_git_workflow_diff_and_blog_changes(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    workflow = tmp_path / ".github/workflows/build-images.yml"
    workflow.parent.mkdir(parents=True)
    before = "jobs:\n  changes:\n    steps: []\n  build-site:\n    steps:\n      - run: old\n"
    workflow.write_text(before)

    def commit():
        subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "-qm",
                "fixture",
            ],
            cwd=tmp_path,
            check=True,
        )
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True
        ).strip()

    base = commit()
    workflow.write_text(before.replace("run: old", "run: new"))
    post = tmp_path / "app/web/src/content/blog/post.md"
    post.parent.mkdir(parents=True)
    post.write_text("A new post")
    head = commit()
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
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    outputs = dict(line.split("=", 1) for line in result.stdout.splitlines())
    assert {name for name, value in outputs.items() if value == "true"} == {
        "site",
        "any",
    }


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


def test_non_website_source_changes_rebuild_agent_without_touching_fleet_detection() -> (
    None
):
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
CRATE_WEB_IMPORT = re.compile(r"""["']@crate-web/([^"']+)["']""")
RELATIVE_IMPORT = re.compile(r"""(?:from|import)\s+["'](\.{1,2}/[^"']+)["']""")


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


def _resolve_web_source(path: Path) -> Path:
    for candidate in (path, *(path.with_name(path.name + s) for s in (".ts", ".js"))):
        if candidate.is_file():
            return candidate
    raise AssertionError(f"unresolved app/web import: {path}")


def _ryoku_web_dependencies() -> set[str]:
    """Every app/web file app/ryoku reaches through @crate-web, transitively."""
    web_src = ROOT / "app/web/src"
    pending = [
        _resolve_web_source(web_src / match)
        for source in (ROOT / "app/ryoku/src").rglob("*")
        if source.is_file()
        for match in CRATE_WEB_IMPORT.findall(source.read_text(errors="ignore"))
    ]
    seen: set[Path] = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        for relative in RELATIVE_IMPORT.findall(path.read_text()):
            pending.append(_resolve_web_source((path.parent / relative).resolve()))
    return {str(path.relative_to(ROOT)) for path in seen}


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
    "path",
    [
        "app/web/src/content/blog/a-post.md",
        "app/web/src/content/install/steps.ts",
        "app/web/src/components/blog-viz/BlogFigure.astro",
        "app/web/src/scripts/viz/blog/connect.ts",
        "app/web/public/blog/cover.webp",
        "app/web/Dockerfile",
        "app/web/package.json",
        "docs/technical/engineering-blog.md",
    ],
)
def test_editorial_and_out_of_context_website_changes_reuse_the_agent(
    path: str,
) -> None:
    assert release_manifest.detect_changed_agent_images([path]) == set()


@pytest.mark.parametrize(
    "path",
    [
        "app/web/src/lib/blog.ts",
        "app/web/src/components/Hero.astro",
        "app/web/src/styles/tokens.css",
        "app/web/src/scripts/motion/page.ts",
        "app/web/src/pages/index.astro",
        "app/web/AGENTS.md",
    ],
)
def test_website_source_in_the_agent_context_rebuilds_the_agent(path: str) -> None:
    assert release_manifest.detect_changed_agent_images([path]) == {"agent"}


def test_agent_context_carries_app_web_only_from_its_source_tree() -> None:
    # The agent exemption for app/web files outside app/web/src relies on this.
    spec = importlib.util.spec_from_file_location(
        "crate_hermes_context", ROOT / "scripts/hermes_context.py"
    )
    assert spec is not None and spec.loader is not None
    hermes_context = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hermes_context)
    web_roots = [
        root for root in hermes_context.SOURCE_ROOTS if root.startswith("app/web")
    ]
    web_files = [
        path for path in hermes_context.SOURCE_FILES if path.startswith("app/web")
    ]
    assert web_roots == ["app/web/src/"]
    assert web_files == []


