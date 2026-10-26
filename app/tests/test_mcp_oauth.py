"""OAuth configuration, public discovery and client-metadata network boundaries."""

import asyncio
import socket
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from crate.agent_access import AgentPrincipal, generate_token
from crate.api.mcp_oauth import router
from crate.db.repositories import mcp_oauth as store
from crate.mcp.auth import AgentAuth
from crate.mcp.oauth import CrateTokenVerifier, OAuthClient
from crate.mcp.oauth_config import (
    fetch_client_metadata,
    oauth_enabled,
    oauth_settings,
    public_metadata_addresses,
    validate_client_registration,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse


@pytest.fixture
def config(monkeypatch):
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", "https://crate.example")
    return monkeypatch


@pytest.mark.parametrize(
    "issuer",
    [
        "",
        "http://crate.example",
        "https://user:pass@crate.example",
        "https://crate.example/path",
        "https://crate.example?a=b",
        "https://crate.example#fragment",
        "http://localhost:8585",
        "https://crate.example:99999",
    ],
)
def test_issuer_requires_explicit_https_origin(config, issuer):
    config.setenv("CRATE_MCP_OAUTH_ISSUER", issuer)
    with pytest.raises(ValueError):
        oauth_settings()


def test_issuer_has_explicit_local_development_escape_hatch(config):
    assert oauth_settings().resource == "https://crate.example/mcp"
    config.setenv("CRATE_MCP_OAUTH_ISSUER", "http://127.0.0.1:8585")
    config.setenv("CRATE_MCP_OAUTH_ALLOW_LOCALHOST", "true")
    assert oauth_settings().issuer == "http://127.0.0.1:8585"
    config.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    assert oauth_enabled() is False


def _dns(addresses):
    return [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            6,
            "",
            (address, 443),
        )
        for address in addresses
    ]


@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["10.0.0.1"],
        ["169.254.169.254"],
        ["192.168.1.1"],
        ["::1"],
        ["fc00::1"],
        ["fe80::1"],
        ["::ffff:127.0.0.1"],
        ["93.184.216.34", "10.0.0.1"],
        ["224.0.0.1"],
        [],
    ],
)
def test_metadata_rejects_all_internal_addresses_and_mixed_dns(config, addresses):
    config.setattr(socket, "getaddrinfo", lambda *a, **kw: _dns(addresses))
    with pytest.raises(ValueError):
        public_metadata_addresses("https://client.example/metadata.json")


@pytest.mark.parametrize(
    "url",
    [
        "http://client.example/metadata",
        "https://user:pass@client.example/metadata",
        "https://client.example:444/metadata",
        "https://client.example/metadata?next=internal",
        "https://client.example/metadata#fragment",
    ],
)
def test_metadata_rejects_unsafe_url_forms_without_dns(config, url):
    dns = Mock(side_effect=AssertionError("URL must fail before DNS"))
    config.setattr(socket, "getaddrinfo", dns)
    with pytest.raises(ValueError):
        public_metadata_addresses(url)
    dns.assert_not_called()


def test_metadata_pins_public_ip_rejects_redirects_and_bounds_bytes(config):
    import crate.mcp.oauth_config as module

    config.setattr(socket, "getaddrinfo", lambda *a, **kw: _dns(["93.184.216.34"]))
    response = Mock(status=200)
    response.getheader.return_value = "application/json"
    response.read.return_value = b'{"client_id":"https://client.example/metadata.json"}'
    connection = Mock()
    connection.getresponse.return_value = response
    factory = Mock(return_value=connection)
    config.setattr(module, "_PinnedHTTPSConnection", factory)
    document = fetch_client_metadata("https://client.example/metadata.json")
    assert document["client_id"].startswith("https://client.example/")
    factory.assert_called_once_with("client.example", "93.184.216.34")
    response.read.assert_called_once_with(65537)
    connection.close.assert_called_once()
    response.status = 302
    with pytest.raises(ValueError, match="without redirects"):
        fetch_client_metadata("https://client.example/metadata.json")
    response.status = 200
    response.read.return_value = b"x" * 65537
    with pytest.raises(ValueError, match="64 KiB"):
        fetch_client_metadata("https://client.example/metadata.json")
    response.read.return_value = b"[]"
    with pytest.raises(ValueError, match="JSON object"):
        fetch_client_metadata("https://client.example/metadata.json")


def test_metadata_tls_uses_original_hostname_and_resolved_ip(config):
    from crate.mcp.oauth_config import _PinnedHTTPSConnection

    raw = Mock()
    create = Mock(return_value=raw)
    context = Mock()
    config.setattr(socket, "create_connection", create)
    config.setattr("ssl.create_default_context", lambda: context)
    connection = _PinnedHTTPSConnection("client.example", "93.184.216.34")
    connection.connect()
    create.assert_called_once_with(("93.184.216.34", 443), 3)
    context.wrap_socket.assert_called_once_with(raw, server_hostname="client.example")


def test_metadata_registration_is_explicit_and_exactly_pinned(config):
    import crate.mcp.oauth_config as module

    url = "https://client.example/metadata.json"
    document = {
        "client_id": url,
        "redirect_uris": ["https://client.example/callback"],
        "token_endpoint_auth_method": "none",
    }
    fetch = Mock(return_value=document)
    config.setattr(module, "fetch_client_metadata", fetch)
    with pytest.raises(ValueError, match="explicit metadata"):
        validate_client_registration(
            url, "Client", document["redirect_uris"], {"library.health.read"}
        )
    fetch.assert_not_called()
    validate_client_registration(
        url,
        "Client",
        document["redirect_uris"],
        {"library.health.read"},
        metadata_url=url,
    )
    document["redirect_uris"] = ["https://attacker.example/callback"]
    with pytest.raises(ValueError, match="differs"):
        validate_client_registration(
            url,
            "Client",
            ["https://client.example/callback"],
            {"library.health.read"},
            metadata_url=url,
        )


@pytest.mark.parametrize(
    "redirect",
    [
        "http://client.example/callback",
        "https://user:pass@client.example/callback",
        "https://client.example/callback#fragment",
        "javascript:alert(1)",
    ],
)
def test_registration_rejects_unsafe_callbacks(config, redirect):
    with pytest.raises(ValueError):
        validate_client_registration(
            "client", "Client", [redirect], {"library.health.read"}
        )


def test_public_discovery_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("CRATE_MCP_OAUTH_ENABLED", raising=False)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    for path in [
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/oauth/authorize",
    ]:
        assert client.get(path).status_code == 404


def test_duplicate_parameters_and_form_body_are_bounded(config):
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert client.get("/oauth/authorize?client_id=a&client_id=b").status_code == 400
    assert (
        client.post(
            "/oauth/token",
            content="x=" + "a" * 8192,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ).status_code
        == 413
    )
    assert client.post("/oauth/token", json={}).status_code == 415
    assert (
        client.post(
            "/oauth/token",
            content="grant_type=authorization_code&grant_type=refresh_token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ).status_code
        == 400
    )


def test_sdk_backend_challenge_and_private_service_auth(config):
    principal = AgentPrincipal(
        "private", "credential", "Service", frozenset({"library.health.read"})
    )
    config.setattr(
        "crate.mcp.auth.resolve_credential",
        lambda raw: principal if raw == generate else None,
    )
    generate = generate_token()

    async def endpoint(scope, receive, send):
        await JSONResponse({"id": scope["state"]["agent_principal"].id})(
            scope, receive, send
        )

    client = TestClient(AgentAuth(endpoint), base_url="https://crate.example")
    challenge = client.post("/mcp")
    assert challenge.status_code == 401
    assert (
        'resource_metadata="https://crate.example/.well-known/oauth-protected-resource/mcp"'
        in challenge.headers["www-authenticate"]
    )
    assert client.post(
        "/mcp", headers={"Authorization": "Bearer " + generate}
    ).json() == {"id": "private"}


def test_sdk_verifier_rejects_expired_and_other_audience_delegation(config):
    principal = AgentPrincipal(
        "p",
        "c",
        "Delegated",
        frozenset({"library.health.read"}),
        authorization_id="auth",
        actor_user_id=1,
        client_id="client",
        accepted_scopes=frozenset({"library.health.read"}),
    )
    config.setattr(
        store,
        "resolve_oauth_access_token",
        lambda token: (principal, datetime.now(UTC) + timedelta(minutes=1)),
    )
    token = asyncio.run(CrateTokenVerifier().verify_token("crate_mcp_at_test"))
    assert token.subject == "1"
    assert token.resource == "https://crate.example/mcp"
    assert token.claims["iss"] == "https://crate.example"
    config.setattr(store, "resolve_oauth_access_token", lambda token: None)
    assert asyncio.run(CrateTokenVerifier().verify_token("crate_mcp_at_test")) is None


def test_client_model_is_public_code_only_and_exact_redirect():
    client = OAuthClient(
        {
            "client_id": "client",
            "redirect_uris": ["https://client.example/callback"],
            "scopes": ["library.health.read"],
        }
    )
    assert client.get_client_id() == "client"
    assert client.get_default_redirect_uri() is None
    assert client.check_redirect_uri("https://client.example/callback")
    assert not client.check_redirect_uri("https://client.example/callback/")
    assert client.check_endpoint_auth_method("none", "token")
    assert not client.check_endpoint_auth_method("client_secret_basic", "token")
    assert not client.check_client_secret("anything")
    assert client.check_response_type("code")
    assert not client.check_response_type("token")
    assert not client.check_grant_type("client_credentials")
