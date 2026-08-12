from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


def _make_dry_run(target: str, *variables: str) -> str:
    result = subprocess.run(
        ["make", "--no-print-directory", "--dry-run", target, *variables],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def test_deploy_version_forwards_one_commit_to_the_release_script() -> None:
    output = _make_dry_run(
        "deploy",
        "VERSION=0123456789abcdef0123456789abcdef01234567",
    )

    assert "DEPLOY_VERSION='0123456789abcdef0123456789abcdef01234567'" in output
    assert "scripts/deploy.sh deploy" in output


def test_build_workflow_promotes_a_complete_manifest_after_selective_builds() -> None:
    workflow = (ROOT / ".github/workflows/build-images.yml").read_text()

    assert "concurrency:" in workflow
    assert "changes:" in workflow
    assert "promote-release:" in workflow
    assert "args=(detect --head" in workflow
    assert 'scripts/release_manifest.py "${args[@]}"' in workflow
    assert "scripts/release_manifest.py assemble" in workflow
    assert "crate-release-manifest:stable" in workflow
    assert "steps.build.outputs.digest" in workflow
    assert "needs: changes" in workflow
    assert "type=raw,value=latest" not in workflow
    assert "artifact-metadata: write" in workflow
    assert "Promote release manifest to stable" in workflow
    assert workflow.index("Attest release manifest") < workflow.index(
        "Promote release manifest to stable"
    )


def test_deploy_extracts_release_manifest_for_production_platform() -> None:
    deploy_script = (ROOT / "scripts/deploy.sh").read_text()

    assert (
        'docker pull -q --platform "$DEPLOY_IMAGE_PLATFORM" "$manifest_image"'
        in deploy_script
    )
    assert (
        'docker create --platform "$DEPLOY_IMAGE_PLATFORM" "$manifest_image" true'
        in deploy_script
    )


def test_deploy_builds_candidate_from_the_remote_production_environment() -> None:
    deploy_script = (ROOT / "scripts/deploy.sh").read_text()

    assert 'scp "$REMOTE:$SERVER_PATH/.env" "$TMP_DIR/.env"' in deploy_script
    assert 'chmod 600 "$TMP_DIR/.env"' in deploy_script
    assert 'cp "$ROOT_DIR/.env" "$TMP_DIR/.env"' not in deploy_script
    assert 'test -f "$ROOT_DIR/.env"' not in deploy_script


@pytest.mark.parametrize(
    ("compose_name", "service_name", "image_variable"),
    [
        ("docker-compose.yaml", "crate-api", "CRATE_API_IMAGE"),
        ("docker-compose.yaml", "crate-readplane", "CRATE_READPLANE_IMAGE"),
        ("docker-compose.yaml", "crate-worker", "CRATE_WORKER_IMAGE"),
        ("docker-compose.yaml", "crate-projector", "CRATE_WORKER_IMAGE"),
        ("docker-compose.yaml", "crate-maintenance-worker", "CRATE_WORKER_IMAGE"),
        (
            "docker-compose.yaml",
            "crate-analysis-worker",
            "CRATE_ANALYSIS_WORKER_IMAGE",
        ),
        (
            "docker-compose.yaml",
            "crate-playback-worker",
            "CRATE_PLAYBACK_WORKER_IMAGE",
        ),
        ("docker-compose.yaml", "crate-media-worker", "CRATE_MEDIA_WORKER_IMAGE"),
        ("docker-compose.yaml", "crate-ui", "CRATE_UI_IMAGE"),
        ("docker-compose.yaml", "crate-listen", "CRATE_LISTEN_IMAGE"),
        ("docker-compose.project.yaml", "crate-site", "CRATE_SITE_IMAGE"),
        ("docker-compose.project.yaml", "crate-docs", "CRATE_DOCS_IMAGE"),
        (
            "docker-compose.home.yaml",
            "crate-media-worker",
            "CRATE_MEDIA_WORKER_IMAGE",
        ),
        ("docker-compose.home.yaml", "crate-api", "CRATE_API_IMAGE"),
        (
            "docker-compose.home.yaml",
            "crate-readplane",
            "CRATE_READPLANE_IMAGE",
        ),
        ("docker-compose.home.yaml", "crate-worker", "CRATE_WORKER_IMAGE"),
        ("docker-compose.home.yaml", "crate-projector", "CRATE_WORKER_IMAGE"),
        (
            "docker-compose.home.yaml",
            "crate-maintenance-worker",
            "CRATE_WORKER_IMAGE",
        ),
        (
            "docker-compose.home.yaml",
            "crate-analysis-worker",
            "CRATE_ANALYSIS_WORKER_IMAGE",
        ),
        (
            "docker-compose.home.yaml",
            "crate-playback-worker",
            "CRATE_PLAYBACK_WORKER_IMAGE",
        ),
        ("docker-compose.home.yaml", "crate-ui", "CRATE_UI_IMAGE"),
        ("docker-compose.home.yaml", "crate-listen", "CRATE_LISTEN_IMAGE"),
    ],
)
def test_compose_supports_independent_immutable_image_references(
    compose_name: str, service_name: str, image_variable: str
) -> None:
    compose = yaml.safe_load((ROOT / compose_name).read_text())
    image = compose["services"][service_name]["image"]

    assert image.startswith(f"${{{image_variable}:-")
    assert "${CRATE_IMAGE_TAG:-latest}" in image


def test_deploy_preflight_uses_the_same_versioned_release_contract() -> None:
    output = _make_dry_run(
        "deploy-preflight",
        "VERSION=0123456789abcdef0123456789abcdef01234567",
    )

    assert "DEPLOY_VERSION='0123456789abcdef0123456789abcdef01234567'" in output
    assert "scripts/deploy.sh preflight" in output


def test_preflight_validates_candidate_compose_with_production_environment() -> None:
    local_script = (ROOT / "scripts/deploy.sh").read_text()
    remote_script = (ROOT / "scripts/deploy-remote.sh").read_text()

    assert "stage_remote_preflight_payload" in local_script
    assert "DEPLOY_CANDIDATE_DIR" in local_script
    assert 'docker compose \\\n    --env-file "$SERVER_PATH/.env"' in remote_script
    assert '"$DEPLOY_CANDIDATE_DIR/docker-compose.yaml"' in remote_script


def test_preflight_requires_a_persistent_jwt_secret() -> None:
    remote_script = (ROOT / "scripts/deploy-remote.sh").read_text()

    assert "assert_required_env JWT_SECRET 32" in remote_script


def test_deploy_cannot_bypass_remote_release_preflight() -> None:
    script = (ROOT / "scripts/deploy.sh").read_text()
    deploy_body = script[
        script.index("run_deploy() {") : script.index("run_recovery_snapshot() {")
    ]

    assert "stage_remote_preflight_payload" in deploy_body
    assert "remote_deploy release-preflight" in deploy_body
    assert deploy_body.index("remote_deploy release-preflight") < deploy_body.index(
        "remote_deploy backup"
    )


def test_local_deploy_resolves_and_stages_an_immutable_release_manifest() -> None:
    script = (ROOT / "scripts/deploy.sh").read_text()

    assert "crate-release-manifest:${DEPLOY_IMAGE_SHA}" in script
    assert "fetch_release_manifest" in script
    assert 'scripts/release_manifest.py" validate' in script
    assert 'scripts/release_manifest.py" env' in script
    assert '"$TMP_DIR/release-manifest.json"' in script
    assert '"$TMP_DIR/release.env"' in script
    assert 'scripts/release_manifest.py" refs' in script


def test_remote_deploy_only_pulls_and_restarts_changed_release_services() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    config_body = script[script.index("cmd_config() {") : script.index("cmd_pull() {")]
    pull_body = script[script.index("cmd_pull() {") : script.index("cmd_up() {")]
    up_body = script[script.index("cmd_up() {") : script.index("cmd_verify() {")]

    assert "record_changed_release_services" in config_body
    assert "changed_image_refs" in pull_body
    assert "PROJECT_IMAGES" not in pull_body
    assert "changed_services" in up_body
    assert "--no-deps" in up_body


def test_worker_release_manages_every_production_worker_role() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()

    for array_name in (
        "PROJECT_SERVICES",
        "RUNNING_SERVICES",
        "QUIESCE_SERVICES",
    ):
        assignment = next(
            line for line in script.splitlines() if line.startswith(f"{array_name}=(")
        )
        assert "crate-fast-worker" in assignment

    assert '[crate-fast-worker]="${IMAGE_PREFIX}/crate-worker"' in script
    assert (
        '[CRATE_WORKER_IMAGE]="crate-worker crate-fast-worker '
        'crate-projector crate-maintenance-worker"'
    ) in script


def test_image_rollback_restores_only_the_services_changed_by_the_release() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    rollback_body = script[
        script.index("cmd_rollback() {") : script.index("cmd_state_rollback() {")
    ]
    makefile = (ROOT / "Makefile").read_text()

    assert "changed_services" in rollback_body
    assert "--no-deps" in rollback_body
    assert "release-manifest.json" in rollback_body
    assert "deploy-image-rollback:" in makefile
    assert 'test "$(CONFIRM)" = "rollback-images"' in makefile
    assert "scripts/deploy.sh image-rollback" in makefile


def test_production_compose_propagates_federation_identity_and_secrets() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())

    environments = {
        service_name: {
            entry.split("=", 1)[0]: entry.split("=", 1)[1]
            for entry in compose["services"][service_name]["environment"]
        }
        for service_name in ("crate-api", "crate-worker", "crate-playback-worker")
    }

    assert environments["crate-api"]["CRATE_INSTANCE_NAME"] == (
        "${CRATE_INSTANCE_NAME:?CRATE_INSTANCE_NAME must be set}"
    )
    assert environments["crate-api"]["CRATE_PUBLIC_API_BASE_URL"] == (
        "${CRATE_PUBLIC_API_BASE_URL:?CRATE_PUBLIC_API_BASE_URL must be set}"
    )
    assert environments["crate-api"]["CRATE_FEDERATION_CURSOR_SECRET"] == (
        "${CRATE_FEDERATION_CURSOR_SECRET:?CRATE_FEDERATION_CURSOR_SECRET must be set}"
    )
    assert environments["crate-api"]["CRATE_FEDERATION_CATALOG_PAGE_MAX_BYTES"] == (
        "${CRATE_FEDERATION_CATALOG_PAGE_MAX_BYTES:-2097152}"
    )
    assert environments["crate-worker"]["CRATE_FEDERATION_DELTA_RETENTION_DAYS"] == (
        "${CRATE_FEDERATION_DELTA_RETENTION_DAYS:-90}"
    )
    for environment in environments.values():
        assert environment["CRATE_FEDERATION_SUBJECT_SECRET"] == (
            "${CRATE_FEDERATION_SUBJECT_SECRET:"
            "?CRATE_FEDERATION_SUBJECT_SECRET must be set}"
        )


def test_example_environment_documents_required_federation_identity() -> None:
    example = (ROOT / ".env.example").read_text()

    assert "CRATE_INSTANCE_NAME=" in example
    assert "CRATE_PUBLIC_API_BASE_URL=" in example
    assert "CRATE_FEDERATION_SUBJECT_SECRET=" in example


def test_recovery_snapshot_requires_an_explicit_deploy_id() -> None:
    makefile = (ROOT / "Makefile").read_text()

    assert "deploy-recovery-snapshot:" in makefile
    assert 'test -n "$(strip $(DEPLOY_ID))"' in makefile
    assert "scripts/deploy.sh recovery-snapshot" in makefile


def test_production_rollback_requires_destructive_confirmation() -> None:
    makefile = (ROOT / "Makefile").read_text()

    assert "deploy-rollback:" in makefile
    assert 'test "$(CONFIRM)" = "restore-production"' in makefile
    assert "scripts/deploy.sh rollback" in makefile


def test_remote_recovery_snapshot_captures_database_and_durable_redis() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    snapshot_body = script[
        script.index("cmd_recovery_snapshot() {") : script.index("cmd_config() {")
    ]

    assert "cmd_recovery_snapshot" in script
    assert "pg_dump" in script
    assert "redis-durable.tar.gz" in script
    assert "sha256sum" in script
    assert 'BACKUP_UID="$(id -u)"' in snapshot_body
    assert 'BACKUP_GID="$(id -g)"' in snapshot_body
    assert 'chown "$BACKUP_UID:$BACKUP_GID" /backup/redis-durable.tar.gz' in (
        snapshot_body
    )
    assert "chmod 600 /backup/redis-durable.tar.gz" in snapshot_body
    assert "docker-compose.yaml" in snapshot_body
    assert ".deploy/release-manifest.json" in snapshot_body
    assert "recovery.env" in snapshot_body
    assert 'sha256sum "${checksum_files[@]}"' in snapshot_body
    assert "recovery_complete" in script
    assert 'log "Stopping any quiesce service missed by Compose"' in snapshot_body
    assert 'docker stop --time 45 "$service"' in snapshot_body


def test_remote_backup_preserves_a_sealed_recovery_set() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    backup_body = script[
        script.index("cmd_backup() {") : script.index("recovery_redis_service() {")
    ]

    sealed_guard = 'if [[ -f "$BACKUP_DIR/recovery_complete" ]]; then'
    assert sealed_guard in backup_body
    assert backup_body.index(sealed_guard) < backup_body.index(
        'cp -a "$file" "$BACKUP_DIR/$file"'
    )
    assert "return 0" in backup_body[backup_body.index(sealed_guard) :]


def test_remote_verify_checks_internal_urls_inside_the_api_container() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    verify_body = script[
        script.index("cmd_verify() {") : script.index("cmd_rollback() {")
    ]

    assert (
        'wait_for_container_http_url crate-api "http://127.0.0.1:8585/api/status"'
        in verify_body
    )
    assert (
        'wait_for_container_http_url crate-api "http://crate-readplane:8686/readyz"'
        in verify_body
    )


def test_remote_verify_waits_for_public_routes_to_become_ready() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    verify_body = script[
        script.index("cmd_verify() {") : script.index("cmd_rollback() {")
    ]

    assert "DEPLOY_PUBLIC_WAIT_SECONDS" in script
    assert "wait_for_public_get_url" in verify_body
    assert verify_body.count("wait_for_public_url") == 4


def test_health_wait_does_not_treat_running_before_health_init_as_ready() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    wait_body = script[
        script.index("wait_for_container_healthy() {") : script.index(
            "wait_for_public_url() {"
        )
    ]

    assert ".State.Health.Status" in wait_body
    assert "{{else}}{{.State.Running}}" not in wait_body


def test_internal_api_checks_retry_with_exponential_backoff() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    verify_body = script[
        script.index("cmd_verify() {") : script.index("cmd_rollback() {")
    ]

    assert "wait_for_container_http_url" in verify_body
    assert "retry_delay=$((retry_delay * 2))" in script
    assert "DEPLOY_API_RETRY_MAX_SECONDS" in script


def test_remote_state_rollback_restores_database_before_old_images() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    rollback_body = script[
        script.index("cmd_state_rollback() {") : script.index("cmd_cleanup() {")
    ]

    assert "cmd_state_rollback" in script
    assert "pg_restore" in script
    assert "redis-durable.tar.gz" in script
    assert 'stop_existing_services "${PROJECT_SERVICES[@]}"' in rollback_body
    assert rollback_body.index("pg_restore") < rollback_body.index(
        'log "Restarting recovered release'
    )
