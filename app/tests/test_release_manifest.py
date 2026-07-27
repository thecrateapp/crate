from __future__ import annotations

import importlib.util
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


def test_shared_frontend_change_selects_every_shared_consumer() -> None:
    assert detect_changed_images(["app/shared/web/api.ts"]) == {
        "docs",
        "listen",
        "site",
        "ui",
    }


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
        (".github/workflows/build-images.yml", set(IMAGE_SPECS)),
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
    assert ":latest" not in rendered
