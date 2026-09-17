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


def test_android_release_uploads_r8_mapping_to_sentry() -> None:
    root_gradle = (ROOT / "app/listen/android/build.gradle").read_text()
    app_gradle = (ROOT / "app/listen/android/app/build.gradle").read_text()
    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/build-android.yml").read_text()
    )
    job = workflow["jobs"]["build-apk"]

    assert "io.sentry:sentry-android-gradle-plugin:6.22.0" in root_gradle
    assert "apply plugin: 'io.sentry.android.gradle'" in app_gradle
    assert "includeProguardMapping = true" in app_gradle
    assert "autoUploadProguardMapping = sentryUploadEnabled" in app_gradle
    assert "authToken = sentryAuthToken" in app_gradle
    assert 'org = "ninja-development"' in app_gradle
    assert 'projectName = "crate-listen"' in app_gradle
    assert "autoInstallation" in app_gradle
    assert "enabled = false" in app_gradle

    release_step = next(
        step
        for step in job["steps"]
        if step.get("name") == "Build signed release APK and AAB"
    )
    assert (
        release_step["env"]["SENTRY_AUTH_TOKEN"] == "${{ secrets.SENTRY_AUTH_TOKEN }}"
    )


def test_desktop_release_uploads_native_debug_symbols() -> None:
    cargo = (ROOT / "app/listen-desktop/src-tauri/Cargo.toml").read_text()
    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/build-desktop.yml").read_text()
    )
    job = workflow["jobs"]["build-desktop"]

    assert "[profile.release]" in cargo
    assert 'debug = "line-tables-only"' in cargo

    dsym_step = next(
        step for step in job["steps"] if step.get("name") == "Generate macOS dSYMs"
    )
    assert dsym_step["if"] == "runner.os == 'macOS' && github.event_name == 'push'"
    assert "dsymutil" in dsym_step["run"]
    assert "*/release/crate-desktop" in dsym_step["run"]

    symbol_step = next(
        step
        for step in job["steps"]
        if step.get("name") == "Upload desktop native debug symbols"
    )
    assert symbol_step["if"] == "github.event_name == 'push'"
    assert symbol_step["env"]["SENTRY_AUTH_TOKEN"] == "${{ secrets.SENTRY_AUTH_TOKEN }}"
    assert symbol_step["env"]["SENTRY_ORG"] == "ninja-development"
    assert symbol_step["env"]["SENTRY_PROJECT"] == "crate-listen"
    assert "sentry-cli debug-files upload" in symbol_step["run"]
    assert "app/listen-desktop/src-tauri/target" in symbol_step["run"]
    assert "--wait-for 120" in symbol_step["run"]

    step_names = [step.get("name") for step in job["steps"]]
    assert step_names.index("Generate macOS dSYMs") < step_names.index(
        "Upload desktop native debug symbols"
    )
