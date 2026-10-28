"""Crate Agent is opt-in and cannot inherit a personal assistant's authority."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def test_agent_service_is_isolated_inside_the_crate_project():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    service = compose["services"]["crate-agent"]
    assert service["container_name"] == "crate-agent"
    assert service["profiles"] == ["agent"]
    assert service["networks"] == ["crate"]
    assert service["image"].startswith("${CRATE_AGENT_IMAGE:-")
    assert "/crate-agent:${CRATE_IMAGE_TAG:-latest}" in service["image"]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert not service.get("ports")
    assert not service.get("privileged")
    volumes = "\n".join(service["volumes"])
    assert "docker.sock" not in volumes
    assert "family" not in volumes
    assert "MEDIA_DIR" not in volumes
    assert "/opt/crate-context:ro" in volumes
    assert "/run/crate-hermes-secrets:ro" in volumes
    assert "runtime/current" not in volumes
    assert "/etc/hermes" not in volumes
    assert service["tmpfs"] == [
        "/etc/hermes:uid=${PUID:-1000},gid=${PGID:-1000},mode=0700"
    ]
    assert service["environment"]["HERMES_MANAGED_DIR"] == "/etc/hermes"
    assert service["environment"]["HERMES_TIMEZONE"] == "${TZ:-UTC}"
    for name in ("PROVIDER", "MODEL", "BASE_URL"):
        variable = "CRATE_AGENT_" + name
        assert service["environment"][variable] == "${" + variable + ":-}"
    assert "./deploy/hermes:" not in volumes
    assert "./.env" not in str(service)


def test_home_installs_run_the_same_agent_service():
    base = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    home = yaml.safe_load((ROOT / "docker-compose.home.yaml").read_text())
    assert home["services"]["crate-agent"] == base["services"]["crate-agent"]
    assert "TELEGRAM_BOT_TOKEN" not in (ROOT / "docker-compose.home.yaml").read_text()


def test_agent_image_bakes_runtime_and_release_context():
    dockerfile = (ROOT / "deploy/hermes/Dockerfile").read_text()
    assert "FROM nousresearch/hermes-agent:v0.22.2@sha256:" in dockerfile
    assert "COPY deploy/hermes/ /opt/crate-hermes/" in dockerfile
    assert "COPY build/hermes-context/ /opt/crate-hermes-context/active/" in dockerfile
    ignore = (ROOT / "deploy/hermes/Dockerfile.dockerignore").read_text().split()
    assert ignore[ignore.index("*") + 1 :][:4] == [
        "!deploy/hermes/",
        "!deploy/operator/",
        "!scripts/release_manifest.py",
        "!build/hermes-context/",
    ]
    workflow = yaml.safe_load((ROOT / ".github/workflows/build-images.yml").read_text())
    job = workflow["jobs"]["build-agent"]
    script = "\n".join(step.get("run", "") for step in job["steps"])
    assert "scripts/hermes_context.py" in script
    assert '--revision "$GITHUB_SHA"' in script
    build = next(step for step in job["steps"] if step.get("id") == "build")
    assert build["with"]["file"] == "./deploy/hermes/Dockerfile"
    assert build["with"]["platforms"] == "linux/amd64,linux/arm64"
    dockerfile = (ROOT / "deploy/hermes/Dockerfile").read_text().splitlines()
    assert not [line for line in dockerfile if line.startswith("RUN")]
    assert "build-agent" in workflow["jobs"]["promote-release"]["needs"]


def test_managed_policy_only_exposes_read_mcp_and_memory():
    config = json.loads((ROOT / "deploy/hermes/config.json").read_text())
    assert "model" not in config
    assert set(config["platform_toolsets"]["telegram"]) == {
        "crate",
        "crate_context",
        "memory",
    }
    assert {
        "terminal",
        "file",
        "code_execution",
        "delegation",
        "connections",
        "cronjob",
        "skills",
    } <= set(config["agent"]["disabled_toolsets"])
    # Hermes CLI filters discovery by server keys before resolving toolset aliases.
    assert set(config["mcp_servers"]) <= set(config["toolsets"])
    assert config["tools"]["tool_search"]["enabled"] == "off"
    assert config["approvals"]["unattended_mode"] == "deny"
    assert config["approvals"]["cron_mode"] == "deny"
    assert "coding" not in config["agent"]["disabled_toolsets"]
    assert (
        config["mcp_servers"]["crate"]["headers"]["Authorization"]
        == "Bearer ${CRATE_MCP_TOKEN}"
    )


def test_context_is_built_from_release_and_activated_after_successful_verify():
    deploy = (ROOT / "scripts/deploy.sh").read_text()
    assert "scripts/hermes_context.py" in deploy
    assert '--revision "$DEPLOY_IMAGE_SHA"' in deploy
    body = deploy[deploy.index("run_deploy() {") :]
    assert body.index("remote_deploy verify") < body.index("activate_agent_context")


def test_provenance_publisher_runs_in_the_operator_profile_without_host_root():
    import re

    overlay = yaml.safe_load(
        (ROOT / "deploy/operator/compose.operator.yaml").read_text()
    )
    services = overlay["services"]
    assert not (ROOT / "deploy/operator/crate-provenance.service").exists()
    assert overlay["networks"]["crate-provenance"] == {"internal": True}

    proxy = services["crate-provenance-docker"]
    assert proxy["profiles"] == ["crate-operator"]
    assert re.fullmatch(r"haproxy:[0-9.]+-alpine@sha256:[a-f0-9]{64}", proxy["image"])
    assert proxy["read_only"] is True and proxy["cap_drop"] == ["ALL"]
    assert proxy["security_opt"] == ["no-new-privileges:true"]
    assert proxy["networks"] == ["crate-provenance"]
    assert proxy["volumes"] == [
        "${CRATE_DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock:ro"
    ]
    assert not proxy.get("ports") and not proxy.get("privileged")

    publisher = services["crate-provenance"]
    assert publisher["profiles"] == ["crate-operator"]
    assert publisher["image"] == services["crate-operator"]["image"]
    assert publisher["user"] == "${PUID:-1000}:${PGID:-1000}"
    assert publisher["read_only"] is True and publisher["cap_drop"] == ["ALL"]
    assert publisher["entrypoint"] == ["python3", "-m", "deploy.operator.provenance"]
    assert publisher["environment"]["CRATE_DOCKER_API"] == (
        "http://crate-provenance-docker:2375"
    )
    assert publisher["volumes"] == [
        "${CRATE_OPERATOR_ROOT:-${DATA_DIR}/crate-operator}/context:/opt/crate-context:ro",
        "${CRATE_OPERATOR_ROOT:-${DATA_DIR}/crate-operator}/provenance:/opt/crate-provenance",
    ]
    assert publisher["healthcheck"]["test"][-1] == "--health"
    assert not publisher.get("ports") and not publisher.get("depends_on")

    # Among Crate services, only the filter sees the Docker socket.
    base = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"]
    for name, service in {**base, **services}.items():
        if name.startswith("crate-") and name != "crate-provenance-docker":
            assert "docker.sock" not in str(service.get("volumes", [])), name
    for name in (
        "crate-api",
        "crate-worker",
        "crate-fast-worker",
        "crate-maintenance-worker",
        "crate-analysis-worker",
    ):
        volumes = services[name]["volumes"]
        assert (
            "${CRATE_OPERATOR_ROOT:-${DATA_DIR}/crate-operator}/provenance"
            ":/run/crate-provenance-evidence:ro"
        ) in volumes
        assert any(volume.endswith(":/run/crate-provenance:ro") for volume in volumes)


def test_provenance_docker_filter_allows_only_container_listing_and_image_inspect():
    import re

    overlay = yaml.safe_load(
        (ROOT / "deploy/operator/compose.operator.yaml").read_text()
    )
    config = overlay["configs"]["crate-provenance-docker"]["content"]
    assert overlay["services"]["crate-provenance-docker"]["configs"] == [
        {
            "source": "crate-provenance-docker",
            "target": "/usr/local/etc/haproxy/haproxy.cfg",
        }
    ]
    rules = [line.strip() for line in config.splitlines() if "http-request" in line]
    assert len(rules) == 1
    assert rules[0].startswith("http-request deny unless { method GET } ")
    pattern = re.search(r"\{ path -m reg (\S+) \}", rules[0])[1].replace("$$", "$")
    image = "sha256:" + "a" * 64
    for path in (
        "/containers/json",
        "/v1.47/containers/json",
        f"/images/{image}/json",
        f"/v1.47/images/{image}/json",
    ):
        assert re.search(pattern, path), path
    for path in (
        "/containers/crate-api/json",
        "/containers/abc/archive",
        "/containers/abc/logs",
        "/containers/abc/exec",
        f"/images/{image}/get",
        "/images/json",
        "/images/crate-api/json",
        "/containers/json/../abc/exec",
        f"/images/{image}/json/../../x",
        "/containers%2Fjson",
        "//containers/json",
        "/info",
        "/_ping",
    ):
        assert not re.search(pattern, path), path
    assert "server docker /var/run/docker.sock" in config
