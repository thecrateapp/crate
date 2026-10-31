from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    ("base_services", "overlay_included"),
    [
        ("crate-agent\ncrate-api\n", False),
        ("crate-api\n", True),
    ],
)
def test_remote_deploy_selects_legacy_operator_overlay_only_when_needed(
    tmp_path: Path, base_services: str, overlay_included: bool
) -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    compose_setup = script[
        script.index("COMPOSE=(docker compose") : script.index("PROJECT_SERVICES=(")
    ]
    overlay = tmp_path / ".deploy/crate-operator.compose.yaml"
    overlay.parent.mkdir()
    overlay.write_text("services: {}\n")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        '[[ "$1" == ps ]] && exit 0\n'
        'printf \'%s\' "$*" > "$FAKE_DOCKER_ARGS"\n'
        "printf '%s\\n' \"$FAKE_COMPOSE_SERVICES\"\n"
    )
    docker.chmod(0o755)
    args_file = tmp_path / "docker-args"
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "FAKE_COMPOSE_SERVICES": base_services,
        "FAKE_DOCKER_ARGS": str(args_file),
    }
    result = subprocess.run(
        [
            "bash",
            "-euo",
            "pipefail",
            "-c",
            compose_setup + "printf '%s\\n' \"${COMPOSE[@]}\"\n",
        ],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    assert (".deploy/crate-operator.compose.yaml" in result.stdout) is overlay_included
    docker_args = args_file.read_text()
    assert "--profile agent" in docker_args
    assert "config --services" in docker_args


def _compose_setup() -> str:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    return script[
        script.index("COMPOSE=(docker compose") : script.index("PROJECT_SERVICES=(")
    ]


def _shell_function(name: str) -> str:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    start = script.index(f"{name}() {{")
    return script[start : script.index("\n}\n", start) + 3]


def _deployment_snapshot_fixture(tmp_path: Path) -> tuple[Path, list[str]]:
    root = tmp_path / "snapshots"
    root.mkdir()
    names = [
        "v9-ancient",
        "v8-ancient",
        "zzz-older",
        "release-old",
        "v3-backup",
        "v2-backup",
        "aaa-recent",
        "bbb-most-recent",
    ]
    for index, name in enumerate(names, 1):
        directory = root / name
        directory.mkdir()
        (directory / "payload").write_text(name)
        timestamp = 1_700_000_000 + index * 100
        os.utime(directory, (timestamp, timestamp))
    return root, names


def _run_snapshot_cleanup(root: Path, current: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "bash",
            "-euo",
            "pipefail",
            "-c",
            "log() { :; }\n"
            "cleanup_legacy_cache_layout() { :; }\n"
            "prune_unused_images() { :; }\n"
            + _shell_function("cmd_cleanup")
            + "\ncmd_cleanup\n",
        ],
        cwd=root.parent,
        env={
            "PATH": os.environ["PATH"],
            "BACKUP_ROOT": str(root),
            "BACKUP_DIR": str(root / current),
            "DEPLOY_ID": current,
        },
        capture_output=True,
        text=True,
        timeout=15,
    )


@pytest.mark.parametrize("current_timestamp", [1_700_000_050, 1_700_000_900])
def test_cleanup_keeps_the_current_custom_snapshot_and_four_latest_by_age(
    tmp_path: Path, current_timestamp: int
) -> None:
    root, _names = _deployment_snapshot_fixture(tmp_path)
    current = root / "c0-custom-id"
    current.mkdir()
    (current / "payload").write_text("current snapshot")
    os.utime(current, (current_timestamp, current_timestamp))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "payload").write_text("external data")
    link = root / "unrelated-symlink"
    link.symlink_to(outside, target_is_directory=True)

    result = _run_snapshot_cleanup(root, current.name)

    assert result.returncode == 0, result.stderr
    assert link.is_symlink()
    assert (outside / "payload").read_text() == "external data"
    expected = {
        "c0-custom-id",
        "v3-backup",
        "v2-backup",
        "aaa-recent",
        "bbb-most-recent",
    }
    assert {
        path.name for path in root.iterdir() if path.is_dir() and not path.is_symlink()
    } == expected
    assert (current / "payload").read_text() == "current snapshot"
    for name in expected - {current.name}:
        assert (root / name / "payload").read_text() == name


@pytest.mark.parametrize("current_state", ["missing", "symlink"])
def test_cleanup_never_prunes_without_a_real_current_snapshot(
    tmp_path: Path, current_state: str
) -> None:
    root, names = _deployment_snapshot_fixture(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "payload").write_text("external data")
    if current_state == "symlink":
        (root / "c0-current").symlink_to(outside, target_is_directory=True)

    _run_snapshot_cleanup(root, "c0-current")

    assert {path.name for path in root.iterdir() if not path.is_symlink()} == set(names)
    for name in names:
        assert (root / name / "payload").read_text() == name
    assert (outside / "payload").read_text() == "external data"
    if current_state == "symlink":
        assert (root / "c0-current").is_symlink()


def _fake_docker(tmp_path: Path) -> tuple[dict, Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%s\\n\' "$*" >> "$FAKE_DOCKER_LOG"\n'
        'if [[ "$1" == ps ]]; then\n'
        "  for name in $FAKE_RUNNING; do\n"
        '    [[ "$*" == *"name=^${name}\\$"* ]] && echo "id-${name}"\n'
        "  done\n"
        "  exit 0\n"
        "fi\n"
        'if [[ "$*" == *" ps -q --status running "* ]]; then\n'
        "  for name in $FAKE_RUNNING; do\n"
        '    [[ "${@: -1}" == "$name" ]] && echo "id-${name}"\n'
        "  done\n"
        "  exit 0\n"
        "fi\n"
        'if [[ "$*" == *"config --services"* ]]; then echo crate-agent; fi\n'
    )
    docker.chmod(0o755)
    log = tmp_path / "docker.log"
    log.write_text("")
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "FAKE_DOCKER_LOG": str(log),
    }
    return env, log


@pytest.mark.parametrize(
    ("running", "overlay_file", "expected"),
    [
        ("crate-api", True, None),
        ("crate-operator", True, "deploy/operator/compose.operator.yaml"),
    ],
)
def test_remote_deploy_keeps_the_operator_overlay_while_it_runs(
    tmp_path: Path, running: str, overlay_file: bool, expected: str | None
) -> None:
    if overlay_file:
        overlay = tmp_path / "deploy/operator/compose.operator.yaml"
        overlay.parent.mkdir(parents=True)
        overlay.write_text("services: {}\n")
    env, _log = _fake_docker(tmp_path)
    env["FAKE_RUNNING"] = running
    result = subprocess.run(
        [
            "bash",
            "-euo",
            "pipefail",
            "-c",
            _compose_setup()
            + "printf '%s\\n' \"${COMPOSE[@]}\"\nprintf 'overlay=%s\\n' \"$OPERATOR_OVERLAY\"\n",
        ],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    lines = result.stdout.splitlines()
    if expected is None:
        assert "overlay=" in lines
        assert not any("compose.operator.yaml" in line for line in lines[:-1])
    else:
        assert lines.count(expected) == 1
        assert f"overlay={expected}" in lines


def test_remote_deploy_refuses_a_running_operator_without_its_overlay(
    tmp_path: Path,
) -> None:
    env, _log = _fake_docker(tmp_path)
    env["FAKE_RUNNING"] = "crate-operator"
    result = subprocess.run(
        ["bash", "-euo", "pipefail", "-c", _compose_setup()],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 1
    assert "compose.operator.yaml is missing" in result.stderr


@pytest.mark.parametrize(
    ("running", "agent_image", "recreated"),
    [
        ("crate-agent", "img", [["--profile", "agent", "crate-agent"]]),
        (
            "crate-operator crate-operator-supervisor",
            "img",
            [
                [
                    "--profile",
                    "crate-operator",
                    "crate-operator",
                    "crate-operator-supervisor",
                ]
            ],
        ),
        (
            "crate-operator crate-operator-supervisor crate-infra-relay",
            "img",
            [
                [
                    "--profile",
                    "crate-operator",
                    "crate-operator",
                    "crate-operator-supervisor",
                    "crate-infra-relay",
                ]
            ],
        ),
        (
            "crate-operator crate-provenance crate-provenance-docker",
            "img",
            [
                [
                    "--profile",
                    "crate-operator",
                    "crate-operator",
                    "crate-provenance",
                    "crate-provenance-docker",
                ]
            ],
        ),
        ("crate-operator", "", []),
        ("crate-api", "img", []),
    ],
)
def test_deploy_recreates_running_agent_or_operator_on_the_release_image(
    tmp_path: Path, running: str, agent_image: str, recreated: list
) -> None:
    (tmp_path / ".env").write_text(f"CRATE_AGENT_IMAGE={agent_image}\n")
    env, log = _fake_docker(tmp_path)
    env["FAKE_RUNNING"] = running
    operator = "crate-operator" in running.split()
    script = (
        "COMPOSE=(docker compose -f docker-compose.yaml)\n"
        f"OPERATOR_OVERLAY={'deploy/operator/compose.operator.yaml' if operator else ''}\n"
        + "\n".join(
            _shell_function(name)
            for name in (
                "log",
                "dc",
                "env_file_value",
                "env_value",
                "refresh_running_agent",
            )
        )
        + "\nrefresh_running_agent\n"
    )
    subprocess.run(
        ["bash", "-euo", "pipefail", "-c", script],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    ups = [
        line.split()
        for line in log.read_text().splitlines()
        if " up -d --no-build --no-deps " in line
    ]
    assert [
        [up[up.index("--profile")], up[up.index("--profile") + 1]]
        + up[up.index("--no-deps") + 1 :]
        for up in ups
    ] == recreated


def _agent_tooling(deploy: str) -> list[str]:
    block = deploy[deploy.index("AGENT_TOOLING=(") :]
    return block[len("AGENT_TOOLING=(") : block.index(")")].split()


def test_deploy_ships_the_operator_overlay_and_agent_tooling() -> None:
    deploy = (ROOT / "scripts/deploy.sh").read_text()
    tooling = _agent_tooling(deploy)

    assert set(tooling) == {
        "Makefile",
        "scripts/agent_setup.py",
        "deploy/operator/compose.operator.yaml",
        "deploy/operator/config.operator.example.json",
        "deploy/operator/provenance-docker.haproxy.cfg",
    }
    for file in tooling:
        assert (ROOT / file).is_file(), file
    payload = deploy[
        deploy.index("prepare_payload() {") : deploy.index("sync_config() {")
    ]
    assert payload.count('for file in "${AGENT_TOOLING[@]}"; do') == 2
    sync = deploy[deploy.index("sync_config() {") :]
    assert sync.index('for file in "${AGENT_TOOLING[@]}"; do') < sync.index(
        "deploy-remote.sh"
    )


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
        (
            "docker-compose.yaml",
            "crate-cast-receiver",
            "CRATE_CAST_RECEIVER_IMAGE",
        ),
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


def test_preflight_validates_enabled_custom_cast_receiver_configuration() -> None:
    remote_script = (ROOT / "scripts/deploy-remote.sh").read_text()

    assert "assert_cast_receiver_config" in remote_script
    assert "env_value CRATE_CAST_CUSTOM_RECEIVER_ENABLED" in remote_script
    assert "env_value CRATE_CAST_RECEIVER_APP_ID" in remote_script
    assert "env_value CRATE_CAST_RECEIVER_HOST" in remote_script
    assert "CC1AD845" in remote_script


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


def test_cast_receiver_is_part_of_release_health_and_rollback_contracts() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()

    for array_name in ("PROJECT_SERVICES", "HEALTHY_SERVICES", "RUNNING_SERVICES"):
        assignment = next(
            line for line in script.splitlines() if line.startswith(f"{array_name}=(")
        )
        assert "crate-cast-receiver" in assignment

    assert '[crate-cast-receiver]="${IMAGE_PREFIX}/crate-cast-receiver"' in script
    assert '[CRATE_CAST_RECEIVER_IMAGE]="crate-cast-receiver"' in script


def test_cast_receiver_build_and_frontend_gates_are_wired_in_ci() -> None:
    images = (ROOT / ".github/workflows/build-images.yml").read_text()
    frontend = (ROOT / ".github/workflows/test-frontend.yml").read_text()
    react_doctor = (ROOT / ".github/workflows/react-doctor.yml").read_text()

    assert "build-cast-receiver:" in images
    assert "crate-cast-receiver" in images
    assert "CHANGED_CAST_RECEIVER" in images
    assert "npm run --workspace=app/cast-receiver test" in frontend
    assert "npm run --workspace=app/cast-receiver build" in frontend
    assert react_doctor.count('"app/cast-receiver/**"') == 2
    assert "app/cast-receiver" in react_doctor


def test_frontend_ci_enforces_initial_js_budgets_for_both_apps() -> None:
    frontend = (ROOT / ".github/workflows/test-frontend.yml").read_text()
    admin_package = json.loads((ROOT / "app/ui/package.json").read_text())

    for workspace in ("app/listen", "app/ui"):
        build = f"npm run --workspace={workspace} build"
        check = f"npm run --workspace={workspace} check:bundle"
        assert check in frontend
        assert frontend.index(build) < frontend.index(check)
    assert admin_package["scripts"]["check:bundle"] == (
        "node scripts/check-bundle-budget.mjs dist"
    )


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


def test_recovery_snapshot_leaves_redis_running_for_the_pinned_deploy() -> None:
    script = (ROOT / "scripts/deploy-remote.sh").read_text()
    snapshot_body = script[
        script.index("cmd_recovery_snapshot() {") : script.index("cmd_config() {")
    ]
    stop = snapshot_body.index('dc stop --timeout 30 "$redis_service"')
    capture = snapshot_body.index("tar -C /data -czf /backup/redis-durable.tar.gz .")
    restart = snapshot_body.index('dc start "$redis_service"')

    assert stop < capture < restart < snapshot_body.index("recovery_complete")
    prerequisites = script[
        script.index("for service in crate-postgres crate-redis; do") :
    ]
    assert "is not running" in prerequisites


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
