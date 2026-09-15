from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    ("dockerfile", "project"),
    [
        ("app/ui/Dockerfile", "crate-admin"),
        ("app/listen/Dockerfile", "crate-listen"),
        ("app/cast-receiver/Dockerfile", "crate-cast-receiver"),
        ("app/site/Dockerfile", "crate-site"),
        ("app/docs/Dockerfile", "crate-docs"),
    ],
)
def test_production_frontend_image_uploads_its_own_source_maps(
    dockerfile: str, project: str
) -> None:
    body = (ROOT / dockerfile).read_text()

    assert "# syntax=docker/dockerfile:1.7" in body
    assert "ARG SENTRY_ORG=ninja-development" in body
    assert f"ARG SENTRY_PROJECT={project}" in body
    assert "SENTRY_RELEASE=$VITE_SENTRY_RELEASE" in body
    assert "--mount=type=secret,id=sentry_auth_token,required=false" in body
    assert "/run/secrets/sentry_auth_token" in body
    assert "ARG SENTRY_AUTH_TOKEN" not in body


def test_image_builds_pass_sentry_token_as_a_buildkit_secret() -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows/build-images.yml").read_text())

    for job_name in (
        "build-ui",
        "build-listen",
        "build-cast-receiver",
        "build-site",
        "build-docs",
    ):
        build_step = next(
            step
            for step in workflow["jobs"][job_name]["steps"]
            if step.get("id") == "build"
        )
        assert (
            "sentry_auth_token=${{ secrets.SENTRY_AUTH_TOKEN }}"
            in build_step["with"]["secrets"]
        )


def test_frontend_validation_build_does_not_upload_decoy_source_maps() -> None:
    workflow = (ROOT / ".github/workflows/test-frontend.yml").read_text()

    assert "SENTRY_AUTH_TOKEN" not in workflow
    assert "upload Sentry source maps" not in workflow


def test_auxiliary_frontends_are_validated_before_image_builds() -> None:
    workflow = (ROOT / ".github/workflows/test-frontend.yml").read_text()

    for app in ("site", "docs"):
        assert f"npm ci --prefix app/{app}" in workflow
        assert f"npm test --prefix app/{app}" in workflow
        assert f"npm run build --prefix app/{app}" in workflow


@pytest.mark.parametrize("workflow_name", ["build-android.yml", "build-ios.yml"])
def test_capacitor_builds_embed_runtime_sentry_configuration(
    workflow_name: str,
) -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows" / workflow_name).read_text())
    job = next(iter(workflow["jobs"].values()))
    environment = job["env"]

    assert environment["VITE_SENTRY_DSN"] == "${{ vars.SENTRY_LISTEN_DSN }}"
    assert environment["VITE_SENTRY_ENVIRONMENT"] == "production"
    assert environment["VITE_SENTRY_RELEASE"] == "crate-${{ github.sha }}"

    bundle_step = next(
        step
        for step in job["steps"]
        if step.get("name")
        in {"Build web bundle (capacitor mode)", "Build and sync Capacitor bundle"}
    )
    assert bundle_step["env"]["SENTRY_AUTH_TOKEN"] == (
        "${{ github.event_name == 'push' && secrets.SENTRY_AUTH_TOKEN || '' }}"
    )
    assert bundle_step["env"]["SENTRY_ORG"] == "ninja-development"
    assert bundle_step["env"]["SENTRY_PROJECT"] == "crate-listen"
    assert bundle_step["env"]["SENTRY_RELEASE"] == "crate-${{ github.sha }}"
