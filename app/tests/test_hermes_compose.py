"""Crate Hermes is opt-in and cannot inherit the personal assistant's authority."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def test_hermes_service_is_isolated_inside_the_crate_project():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    service = compose["services"]["crate-hermes-agent"]
    assert service["container_name"] == "crate-hermes-agent"
    assert service["profiles"] == ["hermes"]
    assert service["networks"] == ["crate"]
    assert "@sha256:" in service["image"]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert not service.get("ports")
    assert not service.get("privileged")
    volumes = "\n".join(service["volumes"])
    assert "docker.sock" not in volumes
    assert "family" not in volumes
    assert "MEDIA_DIR" not in volumes
    assert "/opt/crate-context:ro" in volumes
    assert "/etc/hermes/config.yaml:ro" in volumes
    assert "/etc/hermes/.env:ro" in volumes
    assert "hermes-agent/runtime/current" in volumes
    assert "./deploy/hermes:" not in volumes
    assert "./.env" not in str(service)


def test_managed_policy_only_exposes_read_mcp_and_memory():
    config = json.loads((ROOT / "deploy/hermes/config.json").read_text())
    assert config["model"]["default"] == "gpt-6-luna"
    assert config["model"]["provider"] == "openai-codex"
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
    assert body.index("remote_deploy verify") < body.index("activate_hermes_context")
