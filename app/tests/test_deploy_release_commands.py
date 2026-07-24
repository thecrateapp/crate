from __future__ import annotations

import subprocess
from pathlib import Path


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
    assert "docker-compose.yaml" in snapshot_body
    assert "recovery.env" in snapshot_body
    assert 'sha256sum "${checksum_files[@]}"' in snapshot_body
    assert "recovery_complete" in script


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
