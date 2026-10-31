from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "sentry_release_contract_manifest", ROOT / "scripts/release_manifest.py"
)
assert SPEC is not None and SPEC.loader is not None
manifest_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = manifest_module
SPEC.loader.exec_module(manifest_module)
KEYS = {
    "api": "CRATE_API_SENTRY_RELEASE",
    "readplane": "CRATE_READPLANE_SENTRY_RELEASE",
    "worker": "CRATE_WORKER_SENTRY_RELEASE",
    "analysis-worker": "CRATE_ANALYSIS_WORKER_SENTRY_RELEASE",
    "playback-worker": "CRATE_PLAYBACK_WORKER_SENTRY_RELEASE",
    "media-worker": "CRATE_MEDIA_WORKER_SENTRY_RELEASE",
}


def _manifest():
    return {
        "schema_version": 1,
        "release_sha": "b" * 40,
        "images": {
            name: {
                "repository": "ghcr.io/thecrateapp/" + spec.repository,
                "digest": f"sha256:{index:064x}",
                "source_sha": "a" * 40,
                "environment": spec.environment,
                "services": list(spec.services),
            }
            for index, (name, spec) in enumerate(manifest_module.IMAGE_SPECS.items(), 1)
        },
    }


def _function(script, name):
    start = script.index(name + "() {")
    return script[start : script.index("\n}\n", start) + 3]


def _shell(tmp_path, body):
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    constants = script[script.index("RELEASE_ENV_KEYS=(") : script.index("\nlog() {")]
    functions = "\n".join(
        _function(script, name)
        for name in (
            "env_file_value",
            "set_env_file_value",
            "set_env_value",
            "is_release_env_key",
            "validate_release_env_file",
            "apply_release_env",
            "record_changed_release_services",
        )
    )
    return subprocess.run(
        [
            "bash",
            "-euo",
            "pipefail",
            "-c",
            "IMAGE_PREFIX=ghcr.io/thecrateapp\nlog() { :; }\n"
            + constants
            + functions
            + body,
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )


def test_runtime_releases_follow_the_image_source_instead_of_deployment():
    manifest = _manifest()
    manifest["images"]["readplane"]["source_sha"] = "c" * 40
    rendered = dict(
        line.split("=", 1)
        for line in manifest_module.render_release_env(manifest).splitlines()
    )
    assert rendered["CRATE_RELEASE_SHA"] == "b" * 40
    assert rendered[KEYS["readplane"]] == "crate-" + "c" * 40
    assert all(
        rendered[key] == "crate-" + "a" * 40
        for group, key in KEYS.items()
        if group != "readplane"
    )


@pytest.mark.parametrize(
    "suffix,valid",
    [
        ("", True),
        ("SENTRY_RELEASE=custom\n", False),
        ("CRATE_UNKNOWN_SENTRY_RELEASE=crate-" + "a" * 40 + "\n", False),
        ("CRATE_API_SENTRY_RELEASE=custom\n", False),
        ("CRATE_API_SENTRY_RELEASE=crate-" + "c" * 40 + "\n", False),
    ],
)
def test_validator_only_accepts_allowlisted_immutable_runtime_releases(
    tmp_path, suffix, valid
):
    (tmp_path / "candidate.env").write_text(
        manifest_module.render_release_env(_manifest()) + suffix
    )
    result = _shell(tmp_path, "\nvalidate_release_env_file candidate.env\n")
    assert (result.returncode == 0) is valid


def test_legacy_release_env_clears_managed_values_and_preserves_custom_fallback(
    tmp_path,
):
    lines = manifest_module.render_release_env(_manifest()).splitlines()
    legacy = (
        "\n".join(
            line
            for line in lines
            if not any(line.startswith(key + "=") for key in KEYS.values())
        )
        + "\n"
    )
    (tmp_path / "candidate.env").write_text(legacy)
    old = (
        "SENTRY_RELEASE=custom-installation\n"
        + "\n".join(key + "=crate-" + "f" * 40 for key in KEYS.values())
        + "\n"
    )
    (tmp_path / ".env").write_text(old)
    result = _shell(tmp_path, "\napply_release_env candidate.env\n")
    assert result.returncode == 0, result.stderr
    actual = dict(
        line.split("=", 1)
        for line in (tmp_path / ".env").read_text().splitlines()
        if "=" in line
    )
    assert actual["SENTRY_RELEASE"] == "custom-installation"
    assert all(actual[key] == "" for key in KEYS.values())


def test_metadata_only_change_restarts_worker_roles_without_pulling_images(tmp_path):
    manifest = _manifest()
    rendered = manifest_module.render_release_env(manifest)
    (tmp_path / ".env").write_text(
        rendered.replace(
            "CRATE_WORKER_SENTRY_RELEASE=crate-" + "a" * 40,
            "CRATE_WORKER_SENTRY_RELEASE=crate-" + "f" * 40,
        )
    )
    backup = tmp_path / "backup"
    backup.mkdir()
    candidate = tmp_path / ".deploy"
    candidate.mkdir()
    (candidate / "release.env.candidate").write_text(rendered)
    for name in ("docker-compose.yaml", "docker-compose.project.yaml"):
        (tmp_path / name).write_text("services: {}\n")
        (backup / name).write_text("services: {}\n")
    result = _shell(tmp_path, "\nBACKUP_DIR=backup\nrecord_changed_release_services\n")
    assert result.returncode == 0, result.stderr
    assert (backup / "changed_image_refs").read_text() == ""
    assert set((backup / "changed_services").read_text().splitlines()) == {
        "crate-worker",
        "crate-fast-worker",
        "crate-maintenance-worker",
        "crate-projector",
    }


def test_compose_uses_matching_image_release_with_manual_fallback():
    services = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"]
    expected = {
        "crate-api": "api",
        "crate-readplane": "readplane",
        "crate-worker": "worker",
        "crate-projector": "worker",
        "crate-maintenance-worker": "worker",
        "crate-analysis-worker": "analysis-worker",
        "crate-playback-worker": "playback-worker",
        "crate-media-worker": "media-worker",
    }
    for service, group in expected.items():
        env = dict(value.split("=", 1) for value in services[service]["environment"])
        assert env["SENTRY_RELEASE"] == "${" + KEYS[group] + ":-${SENTRY_RELEASE:-}}"
    assert services["crate-fast-worker"]["extends"]["service"] == "crate-worker"


def test_rollback_restores_runtime_metadata_before_restarting_services():
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    body = _function(script, "cmd_rollback")
    assert (
        "for file in docker-compose.yaml docker-compose.project.yaml .env; do" in body
    )
    assert body.index('cp -a "$BACKUP_DIR/$file" "$file"') < body.index("dc pull")
    assert '"${rollback_services[@]}"' in body
