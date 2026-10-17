"""Actual Authlib grants backed by disposable PostgreSQL, with HTTP consent."""

import base64
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from authlib.oauth2.rfc6749.errors import OAuth2Error
from crate import auth
from crate.agent_diagnostics import DiagnosticError
from crate.api.mcp_oauth import router
from crate.db.repositories import mcp_oauth as store
from crate.db.repositories.agent_credentials import (
    resolve_credential,
    rotate_credential,
)
from crate.db.repositories.auth_sessions import create_session
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.tx import read_scope, transaction_scope
from crate.mcp import oauth
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_mcp_limits import isolated_redis as isolated_redis  # noqa: PLC0414 — pytest fixture registration.

ISSUER = "http://localhost:8585"
RESOURCE = ISSUER + "/mcp"
SCOPES = {"library.health.read", "ops.status.read"}
VERIFIER = "a" * 64
CHALLENGE = (
    base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest())
    .rstrip(b"=")
    .decode()
)


@pytest.fixture
def oauth_env(pg_db, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", ISSUER)
    monkeypatch.setenv("CRATE_MCP_OAUTH_ALLOW_LOCALHOST", "true")
    monkeypatch.setenv("JWT_SECRET", "mcp-oauth-test-secret-32-bytes-long")
    store.register_oauth_client(
        "test-client", "Test client", ["https://client.example/callback"], SCOPES
    )
    user = create_user("oauth@example.test", role="admin")
    sid = str(uuid4())
    create_session(sid, user["id"], datetime.now(UTC) + timedelta(days=1))
    user["session_id"] = sid
    return user


def _parameters(**overrides):
    return {
        "response_type": "code",
        "client_id": "test-client",
        "redirect_uri": "https://client.example/callback",
        "scope": " ".join(sorted(SCOPES)),
        "state": "opaque-state",
        "resource": RESOURCE,
        "code_challenge_method": "S256",
        "code_challenge": CHALLENGE,
        **overrides,
    }


def _code(user, **overrides):
    _, consent_id, nonce = oauth.prepare_consent(_parameters(**overrides), user)
    result = oauth.complete_consent(consent_id, nonce, user, True)
    assert result[0] == 302
    query = parse_qs(urlsplit(result[2]["Location"]).query)
    assert query["iss"] == [ISSUER]
    assert query["state"] == ["opaque-state"]
    return query["code"][0]


def _exchange(code, **overrides):
    return oauth.token_response(
        {
            "grant_type": "authorization_code",
            "client_id": "test-client",
            "redirect_uri": "https://client.example/callback",
            "resource": RESOURCE,
            "code": code,
            "code_verifier": VERIFIER,
            **overrides,
        }
    )


def _tokens(user):
    result = _exchange(_code(user))
    assert result[0] == 200, result
    return result[1]


def _refresh(raw, **overrides):
    return oauth.token_response(
        {
            "grant_type": "refresh_token",
            "client_id": "test-client",
            "resource": RESOURCE,
            "refresh_token": raw,
            **overrides,
        }
    )


def test_authlib_code_refresh_revoke_and_digest_only_storage(oauth_env, caplog):
    caplog.set_level("DEBUG", logger="authlib")
    tokens = _tokens(oauth_env)
    resolved = store.resolve_oauth_access_token(tokens["access_token"])
    principal = resolved[0]
    assert principal.actor_user_id == oauth_env["id"]
    assert principal.accepted_scopes == SCOPES
    assert principal.grants == SCOPES
    refreshed = _refresh(tokens["refresh_token"])
    assert refreshed[0] == 200, refreshed
    assert refreshed[1]["refresh_token"] != tokens["refresh_token"]
    assert store.resolve_oauth_access_token(refreshed[1]["access_token"])
    revoked = oauth.revocation_response(
        {
            "client_id": "test-client",
            "token": refreshed[1]["refresh_token"],
            "token_type_hint": "refresh_token",
        }
    )
    assert revoked[0] == 200, revoked
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    assert store.resolve_oauth_access_token(refreshed[1]["access_token"]) is None
    with read_scope() as session:
        stored = json.dumps(
            [
                dict(row)
                for row in session.execute(
                    text("SELECT * FROM mcp_oauth_tokens")
                ).mappings()
            ],
            default=str,
        )
    for value in [
        tokens["access_token"],
        tokens["refresh_token"],
        refreshed[1]["access_token"],
        refreshed[1]["refresh_token"],
    ]:
        assert value not in stored
        assert value not in caplog.text


def test_refresh_reuse_revokes_entire_family_durably(oauth_env):
    tokens = _tokens(oauth_env)
    refreshed = _refresh(tokens["refresh_token"])
    assert refreshed[0] == 200
    assert _refresh(tokens["refresh_token"])[0] == 400
    assert store.resolve_oauth_access_token(refreshed[1]["access_token"]) is None
    assert _refresh(refreshed[1]["refresh_token"])[0] == 400


def test_concurrent_code_exchange_is_single_use(oauth_env):
    code = _code(oauth_env)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: _exchange(code), range(2)))
    assert sorted(result[0] for result in results) == [200, 400]
    # Reuse invalidates tokens issued by the compromised code.
    issued = next(result[1] for result in results if result[0] == 200)
    assert store.resolve_oauth_access_token(issued["access_token"]) is None


@pytest.mark.parametrize(
    "parameters",
    [
        {"code_challenge_method": "plain"},
        {"code_challenge": ""},
        {"code_challenge_method": ""},
        {"resource": "https://other.example/mcp"},
        {"redirect_uri": "https://client.example/callback/"},
        {"redirect_uri": "https://attacker.example/callback"},
        {"response_type": "token"},
        {"scope": "admin.write"},
    ],
)
def test_invalid_authorization_parameters_never_create_consent(oauth_env, parameters):
    with pytest.raises(OAuth2Error):
        oauth.prepare_consent(_parameters(**parameters), oauth_env)
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM mcp_oauth_consents")
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"code_verifier": "b" * 64},
        {"resource": "https://other.example/mcp"},
        {"redirect_uri": "https://client.example/other"},
        {"client_id": "missing"},
    ],
)
def test_code_binds_pkce_client_resource_and_redirect(oauth_env, overrides):
    code = _code(oauth_env)
    assert _exchange(code, **overrides)[0] == 400
    assert _exchange(code)[0] == 200


def test_expired_code_is_not_accepted(oauth_env):
    code = _code(oauth_env)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE mcp_oauth_codes SET expires_at = NOW() - INTERVAL '1 second'")
        )
    assert _exchange(code)[0] == 400


def test_consent_is_one_use_bound_to_session_nonce_and_actor(oauth_env):
    _, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, "wrong", oauth_env, True)
    second = dict(oauth_env, session_id=str(uuid4()))
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, nonce, second, True)
    assert oauth.complete_consent(consent_id, nonce, oauth_env, True)[0] == 302
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, nonce, oauth_env, True)


def test_two_users_same_client_have_isolated_stable_principals(oauth_env):
    first = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    second_user = create_user("oauth2@example.test", role="admin")
    second_user["session_id"] = str(uuid4())
    create_session(
        second_user["session_id"],
        second_user["id"],
        datetime.now(UTC) + timedelta(days=1),
    )
    second = store.resolve_oauth_access_token(_tokens(second_user)["access_token"])[0]
    assert first.id != second.id
    store.revoke_oauth_authorization(first.authorization_id)
    renewed = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    assert renewed.id == first.id
    assert renewed.authorization_id != first.authorization_id
    with pytest.raises(DiagnosticError):
        store.delegated_authorization_grants(
            first.authorization_id,
            actor_user_id=first.actor_user_id,
            client_id=first.client_id,
            accepted_scopes=first.accepted_scopes,
            worker=True,
        )


def test_current_user_client_and_integration_grants_bound_every_call(oauth_env):
    tokens = _tokens(oauth_env)
    first = store.resolve_oauth_access_token(tokens["access_token"])[0]
    set_user_roles(oauth_env["id"], ["user"])
    assert store.resolve_oauth_access_token(tokens["access_token"])[0].grants == {
        "library.health.read"
    }
    assert _refresh(tokens["refresh_token"])[0] == 400
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE agent_principals SET grants = ARRAY['ops.status.read'] WHERE id = :id"
            ),
            {"id": first.id},
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    set_user_roles(oauth_env["id"], ["admin"])
    store.update_oauth_client("test-client", enabled=False)
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None


def test_suspension_revocation_and_expiry_and_wrong_audience(oauth_env):
    tokens = _tokens(oauth_env)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET status = 'suspended' WHERE id = :id"),
            {"id": oauth_env["id"]},
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET status = 'active' WHERE id = :id"),
            {"id": oauth_env["id"]},
        )
        session.execute(
            text("UPDATE mcp_oauth_tokens SET resource = 'https://other.example/mcp'")
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE mcp_oauth_tokens SET resource = :resource, expires_at = NOW() - INTERVAL '1 second'"
            ),
            {"resource": RESOURCE},
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    # Token expiry does not invalidate the accepted job's durable authorization context.
    authorization = store.list_oauth_authorizations()[0]
    assert (
        store.delegated_authorization_grants(
            authorization["id"],
            actor_user_id=oauth_env["id"],
            client_id="test-client",
            accepted_scopes=SCOPES,
            worker=True,
        )
        == SCOPES
    )
    store.revoke_oauth_authorization(authorization["id"])
    with pytest.raises(DiagnosticError):
        store.delegated_authorization_grants(
            authorization["id"],
            actor_user_id=oauth_env["id"],
            client_id="test-client",
            accepted_scopes=SCOPES,
            worker=True,
        )


def test_delegated_credential_cannot_rotate_into_private_bearer(oauth_env):
    principal = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    with pytest.raises(ValueError):
        rotate_credential(
            principal.credential_id, datetime.now(UTC) + timedelta(days=1)
        )
    # Even knowing a synthetic digest preimage would not authenticate a delegated principal.
    with transaction_scope() as session:
        from crate.agent_access import digest_token, generate_token

        private_token = generate_token()
        session.execute(
            text("UPDATE agent_credentials SET token_digest = :digest WHERE id = :id"),
            {"digest": digest_token(private_token), "id": principal.credential_id},
        )
    assert resolve_credential(private_token) is None


def test_http_consent_discovery_code_refresh_revocation(oauth_env):
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, base_url=ISSUER)
    assert (
        client.get("/.well-known/oauth-protected-resource/mcp").json()["resource"]
        == RESOURCE
    )
    discovery = client.get("/.well-known/oauth-authorization-server").json()
    assert discovery["code_challenge_methods_supported"] == ["S256"]
    assert discovery["client_id_metadata_document_supported"] is True
    assert client.get("/oauth/authorize", params=_parameters()).status_code == 401
    cookie = auth.create_jwt(
        oauth_env["id"], oauth_env["email"], "admin", session_id=oauth_env["session_id"]
    )
    client.cookies.set("crate_session", cookie)
    page = client.get("/oauth/authorize", params=_parameters())
    assert page.status_code == 200
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM mcp_oauth_codes")).scalar_one()
            == 0
        )
    consent_id = re.search("name='consent_id' value='([^']+)'", page.text).group(1)
    nonce = re.search("name='nonce' value='([^']+)'", page.text).group(1)
    form = {"consent_id": consent_id, "nonce": nonce, "decision": "approve"}
    assert (
        client.post(
            "/oauth/consent",
            data=form,
            headers={"Origin": "https://evil.example"},
            follow_redirects=False,
        ).status_code
        == 403
    )
    granted = client.post(
        "/oauth/consent", data=form, headers={"Origin": ISSUER}, follow_redirects=False
    )
    assert granted.status_code == 302, granted.text
    code = parse_qs(urlsplit(granted.headers["location"]).query)["code"][0]
    tokens = client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "client_id": "test-client",
            "code": code,
            "code_verifier": VERIFIER,
            "redirect_uri": "https://client.example/callback",
            "resource": RESOURCE,
        },
    )
    assert tokens.status_code == 200, tokens.text
    assert tokens.headers["cache-control"] == "no-store"
    rotated = client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "client_id": "test-client",
            "refresh_token": tokens.json()["refresh_token"],
            "resource": RESOURCE,
        },
    )
    assert rotated.status_code == 200, rotated.text
    assert (
        client.post(
            "/oauth/revoke",
            data={"client_id": "test-client", "token": rotated.json()["access_token"]},
        ).status_code
        == 200
    )
    assert store.resolve_oauth_access_token(rotated.json()["access_token"]) is None


def test_two_named_oauth_clients_complete_discovery_consent_mcp_refresh_revoke_over_tcp(
    oauth_env, monkeypatch, isolated_redis
):
    """Exercise independent MCP SDK and Authlib clients over real HTTP, PostgreSQL and Redis."""
    import asyncio
    import socket
    from contextlib import asynccontextmanager

    import httpx
    import httpx2
    import uvicorn
    from authlib.integrations.httpx_client import AsyncOAuth2Client
    from crate.mcp import limits
    from crate.mcp.server import create_mcp_server
    from mcp import Client
    from mcp.client.auth import OAuthClientProvider
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared.auth import (
        AuthorizationCodeResult,
        OAuthClientMetadata,
    )
    from starlette.routing import Route

    isolated_redis.flushdb()
    monkeypatch.setattr(limits, "_redis", lambda: isolated_redis)
    browser_cookie = auth.create_jwt(
        oauth_env["id"], oauth_env["email"], "admin", session_id=oauth_env["session_id"]
    )
    store.register_oauth_client(
        "authlib-client", "Authlib 1.9.1", ["https://authlib.example/callback"], SCOPES
    )
    metadata_id = "https://sdk.example/client.json"
    monkeypatch.setattr(
        "crate.mcp.oauth_config.fetch_client_metadata",
        lambda url: {
            "client_id": metadata_id,
            "redirect_uris": ["https://client.example/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    store.register_oauth_client(
        metadata_id,
        "MCP Python SDK 2.3.0",
        ["https://client.example/callback"],
        SCOPES,
        metadata_url=metadata_id,
    )
    evidence = []

    async def run():
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            issuer = f"http://127.0.0.1:{listener.getsockname()[1]}"
            resource = issuer + "/mcp"
            monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", issuer)
            monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "127.0.0.1:*")
            _, manager, endpoint = create_mcp_server()

            @asynccontextmanager
            async def lifespan(app):
                async with manager.run():
                    yield

            app = FastAPI(lifespan=lifespan)
            app.include_router(router)
            app.router.routes.append(Route("/mcp", endpoint=endpoint))
            server = uvicorn.Server(
                uvicorn.Config(app, log_level="warning", lifespan="on")
            )
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(5):
                    while not server.started:
                        if serving.done():
                            await serving
                        await asyncio.sleep(0.01)

                async def browser_consent(authorization_url):
                    async with httpx.AsyncClient(
                        cookies={"crate_session": browser_cookie}
                    ) as browser:
                        page = await browser.get(authorization_url)
                        assert page.status_code == 200, page.text
                        consent_id = re.search(
                            "name='consent_id' value='([^']+)'", page.text
                        ).group(1)
                        nonce = re.search(
                            "name='nonce' value='([^']+)'", page.text
                        ).group(1)
                        result = await browser.post(
                            issuer + "/oauth/consent",
                            data={
                                "consent_id": consent_id,
                                "nonce": nonce,
                                "decision": "approve",
                            },
                            headers={"Origin": issuer},
                        )
                        assert result.status_code == 302, result.text
                        return result.headers["location"]

                class SDKStorage:
                    tokens = None
                    client_info = None

                    async def get_tokens(self):
                        return self.tokens

                    async def set_tokens(self, tokens):
                        self.tokens = tokens

                    async def get_client_info(self):
                        return self.client_info

                    async def set_client_info(self, info):
                        self.client_info = info

                storage = SDKStorage()
                callback = None

                async def redirect(url):
                    nonlocal callback
                    callback = parse_qs(urlsplit(await browser_consent(url)).query)

                async def completed():
                    return AuthorizationCodeResult(
                        code=callback["code"][0],
                        state=callback["state"][0],
                        iss=callback["iss"][0],
                    )

                provider = OAuthClientProvider(
                    resource,
                    OAuthClientMetadata(
                        redirect_uris=["https://client.example/callback"],
                        token_endpoint_auth_method="none",
                        scope=" ".join(sorted(SCOPES)),
                        client_name="Crate SDK OAuth acceptance",
                        software_version="2.3.0",
                    ),
                    storage,
                    redirect,
                    completed,
                    client_metadata_url=metadata_id,
                )
                async with (
                    httpx2.AsyncClient(auth=provider) as http,
                    Client(
                        streamable_http_client(resource, http_client=http)
                    ) as client,
                ):
                    tools = await client.list_tools()
                    assert {"get_instance_status", "inspect_artist"} <= {
                        tool.name for tool in tools.tools
                    }
                    result = await client.call_tool("get_instance_status", {})
                    assert not result.is_error
                    old_access = storage.tokens.access_token
                    with transaction_scope() as session:
                        session.execute(
                            text(
                                "UPDATE mcp_oauth_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE access_digest = :digest"
                            ),
                            {"digest": store.token_digest(old_access)},
                        )
                    assert not (
                        await client.call_tool("get_instance_status", {})
                    ).is_error
                    assert storage.tokens.access_token != old_access
                    async with httpx.AsyncClient() as revoke_client:
                        revoked = await revoke_client.post(
                            issuer + "/oauth/revoke",
                            data={
                                "client_id": metadata_id,
                                "token": storage.tokens.refresh_token,
                                "token_type_hint": "refresh_token",
                            },
                        )
                        assert revoked.status_code == 200
                        assert (
                            await revoke_client.post(
                                resource,
                                headers={
                                    "Authorization": "Bearer "
                                    + storage.tokens.access_token
                                },
                            )
                        ).status_code == 401
                    evidence.append(
                        "MCP Python SDK 2.3.0: discovery, consent, read, refresh, revoke"
                    )

                async with AsyncOAuth2Client(
                    client_id="authlib-client",
                    redirect_uri="https://authlib.example/callback",
                    scope=" ".join(sorted(SCOPES)),
                    token_endpoint_auth_method="none",
                    revocation_endpoint_auth_method="none",
                    code_challenge_method="S256",
                ) as client:
                    metadata = (
                        await client.request(
                            "GET",
                            issuer + "/.well-known/oauth-authorization-server",
                            withhold_token=True,
                        )
                    ).json()
                    authorization_url, state = client.create_authorization_url(
                        metadata["authorization_endpoint"],
                        code_verifier=VERIFIER,
                        resource=resource,
                    )
                    callback_url = await browser_consent(authorization_url)
                    tokens = await client.fetch_token(
                        metadata["token_endpoint"],
                        authorization_response=callback_url,
                        state=state,
                        code_verifier=VERIFIER,
                        resource=resource,
                    )
                    headers = {"Accept": "application/json, text/event-stream"}
                    initialized = await client.post(
                        resource,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "protocolVersion": "2026-07-28",
                                "capabilities": {},
                                "clientInfo": {
                                    "name": "Authlib OAuth MCP acceptance",
                                    "version": "1.9.1",
                                },
                            },
                        },
                        headers=headers,
                    )
                    assert initialized.status_code == 200, initialized.text
                    tools = await client.post(
                        resource,
                        json={
                            "jsonrpc": "2.0",
                            "id": 2,
                            "method": "tools/list",
                            "params": {},
                        },
                        headers=headers,
                    )
                    assert "get_instance_status" in {
                        tool["name"] for tool in tools.json()["result"]["tools"]
                    }
                    result = await client.post(
                        resource,
                        json={
                            "jsonrpc": "2.0",
                            "id": 3,
                            "method": "tools/call",
                            "params": {"name": "get_instance_status", "arguments": {}},
                        },
                        headers=headers,
                    )
                    assert result.status_code == 200, result.text
                    assert not result.json()["result"].get("isError", False)
                    refreshed = await client.refresh_token(
                        metadata["token_endpoint"],
                        refresh_token=tokens["refresh_token"],
                        resource=resource,
                    )
                    assert refreshed["access_token"] != tokens["access_token"]
                    assert (
                        await client.revoke_token(
                            metadata["revocation_endpoint"],
                            token=refreshed["refresh_token"],
                            token_type_hint="refresh_token",
                        )
                    ).status_code == 200
                    async with httpx.AsyncClient() as raw:
                        assert (
                            await raw.post(
                                resource,
                                headers={
                                    "Authorization": "Bearer "
                                    + refreshed["access_token"]
                                },
                            )
                        ).status_code == 401
                    evidence.append(
                        "Authlib 1.9.1 public OAuth client: discovery, consent, MCP JSON-RPC read, refresh, revoke"
                    )
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, 5)

    asyncio.run(run())
    assert len(evidence) == 2


def test_normal_user_logs_in_and_consents_without_admin_console_capability(
    oauth_env, monkeypatch
):
    from crate.api.auth import router as auth_router
    from crate.api.permissions import get_user_capabilities

    user = create_user(
        "listener@example.test",
        password_hash=auth.hash_password("listener-password"),
        role="user",
    )
    assert "admin.access" not in get_user_capabilities(user)
    monkeypatch.setattr("crate.api.auth._password_enabled", lambda: True)
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(router)
    client = TestClient(app, base_url=ISSUER)
    login = client.post(
        "/api/auth/login",
        json={"email": user["email"], "password": "listener-password"},
    )
    assert login.status_code == 200, login.text
    assert "crate_session" in client.cookies
    page = client.get("/oauth/authorize", params=_parameters())
    assert page.status_code == 200, page.text
    assert "library.health.read" in page.text
    assert "ops.status.read" not in page.text
    consent_id = re.search("name='consent_id' value='([^']+)'", page.text).group(1)
    nonce = re.search("name='nonce' value='([^']+)'", page.text).group(1)
    approved = client.post(
        "/oauth/consent",
        data={"consent_id": consent_id, "nonce": nonce, "decision": "approve"},
        headers={"Origin": ISSUER},
        follow_redirects=False,
    )
    assert approved.status_code == 302
    code = parse_qs(urlsplit(approved.headers["location"]).query)["code"][0]
    issued = _exchange(code)
    assert issued[0] == 200
    assert issued[1]["scope"] == "library.health.read"
    principal = store.resolve_oauth_access_token(issued[1]["access_token"])[0]
    assert principal.actor_user_id == user["id"]
    assert principal.grants == {"library.health.read"}


def test_delegation_relation_cannot_be_rebound_to_another_principal(oauth_env):
    principal = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    for overrides in [
        {"principal_id": str(uuid4())},
        {"actor_user_id": oauth_env["id"] + 1},
        {"client_id": "another-client"},
    ]:
        arguments = {
            "actor_user_id": principal.actor_user_id,
            "client_id": principal.client_id,
            "accepted_scopes": principal.accepted_scopes,
            "principal_id": principal.id,
            **overrides,
        }
        with pytest.raises(DiagnosticError):
            store.delegated_authorization_grants(
                principal.authorization_id, **arguments
            )


def test_unknown_or_disabled_clients_cannot_get_a_consent(oauth_env):
    with pytest.raises(OAuth2Error):
        oauth.prepare_consent(_parameters(client_id="unknown-client"), oauth_env)
    assert len(store.list_oauth_clients()) == 1
    store.update_oauth_client("test-client", enabled=False)
    assert store.get_oauth_client("test-client")["enabled"] is False
    with pytest.raises(OAuth2Error):
        oauth.prepare_consent(_parameters(), oauth_env)


def test_consent_deny_creates_no_authorization(oauth_env):
    _, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    denied = oauth.complete_consent(consent_id, nonce, oauth_env, False)
    assert denied[0] == 302
    assert parse_qs(urlsplit(denied[2]["Location"]).query)["error"] == ["access_denied"]
    assert store.list_oauth_authorizations(oauth_env["id"]) == []


def test_revoked_human_session_cannot_complete_prepared_consent(oauth_env):
    _, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE sessions SET revoked_at = NOW() WHERE id = :id"),
            {"id": oauth_env["session_id"]},
        )
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, nonce, oauth_env, True)


def test_concurrent_refresh_rotates_once_and_reuse_revokes_descendant(oauth_env):
    tokens = _tokens(oauth_env)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: _refresh(tokens["refresh_token"]), range(2)))
    assert sorted(result[0] for result in results) == [200, 400]
    issued = next(result[1] for result in results if result[0] == 200)
    assert store.resolve_oauth_access_token(issued["access_token"]) is None


def test_expired_refresh_and_other_resource_or_issuer_are_rejected(oauth_env):
    tokens = _tokens(oauth_env)
    assert (
        _refresh(tokens["refresh_token"], resource="https://other.example/mcp")[0]
        == 400
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE mcp_oauth_tokens SET issuer = 'https://other.example'")
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    assert _refresh(tokens["refresh_token"])[0] == 400
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE mcp_oauth_tokens SET issuer = :issuer, refresh_expires_at = NOW() - INTERVAL '1 second'"
            ),
            {"issuer": ISSUER},
        )
    assert _refresh(tokens["refresh_token"])[0] == 400


def test_protocol_revocation_stops_previously_accepted_delegation(oauth_env):
    tokens = _tokens(oauth_env)
    principal = store.resolve_oauth_access_token(tokens["access_token"])[0]
    assert (
        oauth.revocation_response(
            {"client_id": "test-client", "token": tokens["refresh_token"]}
        )[0]
        == 200
    )
    with pytest.raises(DiagnosticError):
        store.delegated_authorization_grants(
            principal.authorization_id,
            actor_user_id=principal.actor_user_id,
            client_id=principal.client_id,
            accepted_scopes=principal.accepted_scopes,
            worker=True,
        )


def test_consent_cannot_complete_after_permission_loss_or_expiration(oauth_env):
    _, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    set_user_roles(oauth_env["id"], ["user"])
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, nonce, oauth_env, True)
    set_user_roles(oauth_env["id"], ["admin"])
    _, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE mcp_oauth_consents SET expires_at = NOW() - INTERVAL '1 second'"
            )
        )
    with pytest.raises(OAuth2Error):
        oauth.complete_consent(consent_id, nonce, oauth_env, True)


def test_oversized_code_is_invalid_grant_instead_of_backend_failure(oauth_env):
    assert _exchange("a" * 4096)[0] == 400


def test_database_user_deletion_cascades_oauth_grants_and_disables_access(oauth_env):

    tokens = _tokens(oauth_env)
    principal = store.resolve_oauth_access_token(tokens["access_token"])[0]
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM users WHERE id = :id"), {"id": oauth_env["id"]}
        )
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None
    with pytest.raises(DiagnosticError):
        store.delegated_authorization_grants(
            principal.authorization_id,
            actor_user_id=principal.actor_user_id,
            client_id=principal.client_id,
            accepted_scopes=principal.accepted_scopes,
            worker=True,
        )


def _connection_browser(user):
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, base_url=ISSUER)
    client.cookies.set(
        "crate_session",
        auth.create_jwt(
            user["id"],
            user["email"],
            user.get("role", "user"),
            session_id=user["session_id"],
        ),
    )
    return client


def _connection_nonce(page):
    return {
        "consent_id": re.search("name='consent_id' value='([^']+)'", page.text).group(
            1
        ),
        "nonce": re.search("name='nonce' value='([^']+)'", page.text).group(1),
    }


def test_normal_owner_can_review_and_revoke_connections_even_with_oauth_disabled(
    oauth_env, monkeypatch
):
    tokens = _tokens(oauth_env)
    principal = store.resolve_oauth_access_token(tokens["access_token"])[0]
    set_user_roles(oauth_env["id"], ["user"])
    client = _connection_browser(oauth_env)
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    page = client.get("/oauth/connections")
    assert page.status_code == 200
    assert "currently disabled" in page.text
    assert page.headers["cache-control"] == "no-store"
    form = _connection_nonce(page)
    path = f"/oauth/connections/{principal.authorization_id}/revoke"
    assert (
        client.post(
            path,
            data=form,
            headers={"Origin": "https://evil.example"},
            follow_redirects=False,
        ).status_code
        == 403
    )
    assert (
        client.post(
            path, data=form, headers={"Origin": ISSUER}, follow_redirects=False
        ).status_code
        == 303
    )
    assert (
        client.post(
            path, data=form, headers={"Origin": ISSUER}, follow_redirects=False
        ).status_code
        == 403
    )
    assert store.list_oauth_authorizations(oauth_env["id"])[0]["revoked_at"] is not None
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    assert store.resolve_oauth_access_token(tokens["access_token"]) is None


def test_owner_connection_page_never_lists_or_revokes_another_user(oauth_env):
    first = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    other = create_user("other-owner@example.test", role="admin")
    other["session_id"] = str(uuid4())
    create_session(
        other["session_id"], other["id"], datetime.now(UTC) + timedelta(days=1)
    )
    store.register_oauth_client(
        "other-client",
        "Private other-user client",
        ["https://client.example/callback"],
        SCOPES,
    )
    other_tokens = _exchange(
        _code(other, client_id="other-client"), client_id="other-client"
    )[1]
    second = store.resolve_oauth_access_token(other_tokens["access_token"])[0]
    client = _connection_browser(oauth_env)
    page = client.get("/oauth/connections")
    assert "Private other-user client" not in page.text
    form = _connection_nonce(page)
    assert (
        client.post(
            f"/oauth/connections/{second.authorization_id}/revoke",
            data=form,
            headers={"Origin": ISSUER},
            follow_redirects=False,
        ).status_code
        == 403
    )
    assert store.resolve_oauth_access_token(other_tokens["access_token"])
    # The failed cross-owner attempt did not consume the valid owner's decision.
    assert (
        client.post(
            f"/oauth/connections/{first.authorization_id}/revoke",
            data=form,
            headers={"Origin": ISSUER},
            follow_redirects=False,
        ).status_code
        == 303
    )


def test_connections_require_a_current_cookie_session_and_session_bound_nonce(
    oauth_env,
):
    principal = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    client = _connection_browser(oauth_env)
    form = _connection_nonce(client.get("/oauth/connections"))
    other_session = str(uuid4())
    create_session(
        other_session, oauth_env["id"], datetime.now(UTC) + timedelta(days=1)
    )
    second = _connection_browser({**oauth_env, "session_id": other_session})
    path = f"/oauth/connections/{principal.authorization_id}/revoke"
    assert (
        second.post(
            path, data=form, headers={"Origin": ISSUER}, follow_redirects=False
        ).status_code
        == 403
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE sessions SET revoked_at = NOW() WHERE id = :id"),
            {"id": oauth_env["session_id"]},
        )
    assert client.get("/oauth/connections").status_code == 401
    assert (
        client.post(
            path, data=form, headers={"Origin": ISSUER}, follow_redirects=False
        ).status_code
        == 401
    )


def test_oauth_client_and_authorization_keysets_cover_equal_timestamps(oauth_env):
    for client_id in ["alpha-client", "beta-client"]:
        store.register_oauth_client(
            client_id, client_id, ["https://client.example/callback"], SCOPES
        )
    first = store.list_oauth_clients(limit=2)
    second = store.list_oauth_clients(limit=2, before=first[-1]["client_id"])
    assert len(first) == 2 and len(second) == 1
    assert {row["client_id"] for row in first + second} == {
        "test-client",
        "alpha-client",
        "beta-client",
    }
    _tokens(oauth_env)
    _tokens(oauth_env)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE mcp_oauth_authorizations SET created_at = '2026-01-01T00:00:00Z'"
            )
        )
    first = store.list_oauth_authorizations(oauth_env["id"], limit=1)
    second = store.list_oauth_authorizations(
        oauth_env["id"], limit=1, before=(first[0]["created_at"], first[0]["id"])
    )
    assert len(first) == len(second) == 1 and first[0]["id"] != second[0]["id"]


def test_reconsent_respects_current_admin_ceiling_and_issues_exchangeable_code(
    oauth_env,
):
    principal = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE agent_principals SET grants = ARRAY['library.health.read'] WHERE id = :id"
            ),
            {"id": principal.id},
        )
    client, consent_id, nonce = oauth.prepare_consent(_parameters(), oauth_env)
    assert client["accepted_scopes"] == ["library.health.read"]
    approved = oauth.complete_consent(consent_id, nonce, oauth_env, True)
    code = parse_qs(urlsplit(approved[2]["Location"]).query)["code"][0]
    issued = _exchange(code)
    assert issued[0] == 200
    assert issued[1]["scope"] == "library.health.read"
    assert (
        store.resolve_oauth_access_token(issued[1]["access_token"])[0].id
        == principal.id
    )


@pytest.mark.parametrize(
    "authorization_id", [None, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]
)
def test_delegated_request_authorization_fails_closed_for_invalid_context(
    oauth_env, authorization_id
):
    from dataclasses import replace

    from crate.db.repositories.agent_requests import _authorize

    principal = store.resolve_oauth_access_token(_tokens(oauth_env)["access_token"])[0]
    invalid = replace(principal, authorization_id=authorization_id)
    with pytest.raises(DiagnosticError) as denied, transaction_scope() as session:
        _authorize(session, invalid, {"library.health.read"}, worker=True)
    assert denied.value.code == "FORBIDDEN"
