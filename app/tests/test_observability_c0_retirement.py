"""Retire the unused Tidarr companion while preserving native Tidal acquisition."""

import ast
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "filename", ["docker-compose.yaml", "docker-compose.local-stack.yaml"]
)
def test_tidarr_is_not_recreated_or_routed_by_compose(filename):
    services = yaml.safe_load((ROOT / filename).read_text())["services"]
    assert "tidarr" not in services
    for name, service in services.items():
        assert "tidarr" not in str(service.get("labels", {})).lower(), name
        assert "TIDARR_PORT" not in str(service.get("ports", [])), name


def test_stack_does_not_offer_the_retired_tidarr_external_link():
    source = (ROOT / "app/ui/src/pages/Stack.tsx").read_text()
    urls = re.search(r"const SERVICE_URLS[^=]*=\s*\{(.*?)\};", source, re.DOTALL)
    assert urls, "The Stack service URL registry must be found"
    registry = dict(re.findall(r'(\w+):\s*"(https?://[^\"]+)"', urls[1]))
    assert registry.get("traefik"), "Other managed service links remain available"
    assert "tidarr" not in registry
    assert "https://search.lespedants.org" not in registry.values()


def test_stack_management_allowlists_exclude_tidarr():
    tree = ast.parse((ROOT / "app/crate/api/stack.py").read_text())
    allowlists = [
        ast.literal_eval(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name)
            and target.id in {"allowed_prefixes", "ALLOWED_PREFIXES"}
            for target in node.targets
        )
    ]
    assert allowlists, "Stack actions must keep an explicit management allowlist"
    for prefixes in allowlists:
        assert not any("tidarr".startswith(prefix) for prefix in prefixes)
        assert any("traefik".startswith(prefix) for prefix in prefixes)


def test_environment_template_no_longer_provisions_tidarr_ports():
    assignments = {
        line.partition("=")[0].strip()
        for line in (ROOT / ".env.example").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert not any(key.startswith("TIDARR_") for key in assignments)
    assert "CRATE_API_PORT" in assignments


def test_initial_directory_setup_does_not_provision_tidarr():
    makefile = (ROOT / "Makefile").read_text().splitlines()
    start = makefile.index("_create-dirs:") + 1
    body = []
    for line in makefile[start:]:
        if not line.startswith("\t"):
            break
        body.append(line)
    assert body
    commands = "\n".join(body)
    assert not re.search(r"\btidarr\b", commands)
    assert "tidal/" in commands, "Native Tidal download directories remain provisioned"


def test_native_tidal_routes_remain_registered():
    tree = ast.parse((ROOT / "app/crate/api/tidal.py").read_text())
    routers = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "APIRouter"
    ]
    assert any(
        keyword.arg == "prefix" and ast.literal_eval(keyword.value) == "/api/tidal"
        for router in routers
        for keyword in router.keywords
    )
    functions = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert {"tidal_status", "tidal_search", "tidal_download"} <= functions
    application = ast.parse((ROOT / "app/crate/api/__init__.py").read_text())
    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "include_router"
        and node.args
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id == "tidal_router"
        for node in ast.walk(application)
    )
