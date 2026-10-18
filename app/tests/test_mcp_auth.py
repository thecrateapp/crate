"""Machine authentication must never inherit the human authentication fallbacks."""

import asyncio
from datetime import UTC, datetime, timedelta
from threading import get_ident
from unittest.mock import Mock
from urllib.parse import urlencode

import httpx
import pytest
from crate.agent_access import AgentPrincipal, generate_token
from crate.mcp.auth import AgentAuth
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import text
from starlette.responses import JSONResponse


def _principal(name="library", grants=frozenset({"library.health.read"})):
    return AgentPrincipal(name, f"credential-{name}", name, grants)


async def _identity(scope, receive, send):
    principal = scope["state"]["agent_principal"]
    await JSONResponse(
        {"principal_id": principal.id, "grants": sorted(principal.grants)}
    )(scope, receive, send)


@pytest.mark.parametrize(
    "headers,query",
    [
        ({}, ""),
        ({"Authorization": "Basic user:password"}, ""),
        ({"Authorization": "Bearer human.jwt.token"}, ""),
        ({"Cookie": "crate_token=human.jwt.token"}, ""),
        ({"Remote-User": "owner@example.test"}, ""),
        ({}, "?token=crate_mcp_" + "A" * 43),
        ({"Authorization": "Bearer crate_mcp_" + "A" * 43}, "?token=human"),
        (
            {
                "Authorization": "Bearer crate_mcp_" + "A" * 43,
                "Cookie": "crate_token=human",
            },
            "",
        ),
        (
            {
                "Authorization": "Bearer crate_mcp_" + "A" * 43,
                "Remote-User": "owner@example.test",
            },
            "",
        ),
        (
            [
                ("Authorization", "Bearer crate_mcp_" + "A" * 43),
                ("Authorization", "Bearer crate_mcp_" + "B" * 43),
            ],
            "",
        ),
    ],
)
def test_rejects_missing_human_and_mixed_credentials(monkeypatch, headers, query):
    resolver = Mock(return_value=_principal())
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", resolver)
    response = TestClient(AgentAuth(_identity)).post("/mcp" + query, headers=headers)

    assert response.status_code == 401
    assert response.json() == {"error": "UNAUTHORIZED"}
    assert response.headers["www-authenticate"] == 'Bearer realm="crate-mcp"'
    assert response.headers["cache-control"] == "no-store"
    resolver.assert_not_called()


def test_invalid_machine_token_is_rejected_without_disclosing_it(monkeypatch):
    token = generate_token()
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", lambda _: None)
    response = TestClient(AgentAuth(_identity)).post(
        "/mcp", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert token not in response.text


def test_authentication_database_failure_fails_closed(monkeypatch):
    token = generate_token()
    monkeypatch.setattr(
        "crate.mcp.auth.resolve_credential",
        Mock(side_effect=RuntimeError(f"database contains {token}")),
    )
    response = TestClient(AgentAuth(_identity)).post(
        "/mcp", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 503
    assert response.json() == {"error": "AUTH_UNAVAILABLE"}
    assert token not in response.text


def test_concurrent_requests_keep_separate_principals_and_offload_auth(monkeypatch):
    tokens = {
        generate_token(): _principal("library"),
        generate_token(): _principal("ops"),
    }
    resolver_threads = []

    def resolve(token):
        resolver_threads.append(get_ident())
        return tokens[token]

    monkeypatch.setattr("crate.mcp.auth.resolve_credential", resolve)

    async def run():
        event_loop_thread = get_ident()
        arrived = 0
        ready = asyncio.Event()

        async def overlapping_identity(scope, receive, send):
            nonlocal arrived
            arrived += 1
            if arrived == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), 2)
            await _identity(scope, receive, send)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=AgentAuth(overlapping_identity)),
            base_url="http://testserver",
        ) as client:
            responses = await asyncio.gather(
                *(
                    client.post("/mcp", headers={"Authorization": f"Bearer {token}"})
                    for token in tokens
                )
            )
        assert [response.json()["principal_id"] for response in responses] == [
            principal.id for principal in tokens.values()
        ]
        assert all(thread != event_loop_thread for thread in resolver_threads)

    asyncio.run(run())


@pytest.mark.parametrize("state", ["revoked", "expired", "disabled"])
def test_database_credential_state_takes_effect_on_the_next_request(pg_db, state):
    from crate.db.repositories.agent_credentials import (
        create_credential,
        revoke_credential,
        set_principal_enabled,
    )
    from crate.db.tx import transaction_scope

    issued = create_credential(
        "Read-only integration",
        {"library.health.read"},
        datetime.now(UTC) + timedelta(days=1),
    )
    client = TestClient(AgentAuth(_identity))
    headers = {"Authorization": f"Bearer {issued.token}"}
    assert client.post("/mcp", headers=headers).status_code == 200

    if state == "revoked":
        revoke_credential(issued.principal.credential_id)
    elif state == "disabled":
        set_principal_enabled(issued.principal.id, False)
    else:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE agent_credentials SET created_at = NOW() - INTERVAL '2 days', "
                    "expires_at = NOW() - INTERVAL '1 day' WHERE id = :id"
                ),
                {"id": issued.principal.credential_id},
            )

    assert client.post("/mcp", headers=headers).status_code == 401


@pytest.mark.parametrize(
    "path",
    ["/api/private", "/api/stream/private", "/rest/private", "/api/federation/private"],
)
@pytest.mark.parametrize(
    "placement",
    [
        "bearer",
        "cookie",
        "session_cookie",
        "listen_cookie",
        "refresh_cookie",
        "query",
        "media_ticket",
        "duplicate_bearer",
        "duplicate_query",
        "duplicate_media_ticket",
        "duplicate_cookie",
        "duplicate_cookie_headers",
    ],
)
def test_machine_credential_cannot_authenticate_other_surfaces(
    monkeypatch, path, placement
):
    from crate.api.auth import AuthMiddleware
    from crate.api.auth_dependencies import require_auth

    monkeypatch.setattr("crate.api.auth._has_valid_forward_auth_secret", lambda _: True)
    monkeypatch.setattr("crate.api.auth.verify_jwt", lambda _: None)
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get(path)
    def protected(request: Request):
        return require_auth(request)

    token = generate_token()
    headers = {"Remote-User": "owner@example.test", "Remote-Groups": "admins"}
    if placement == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    elif placement == "duplicate_bearer":
        headers = [
            *headers.items(),
            ("Authorization", "Bearer human.jwt.token"),
            ("Authorization", f"Bearer {token}"),
        ]
    elif placement == "duplicate_cookie_headers":
        headers = [
            *headers.items(),
            ("Cookie", "crate_session=human.jwt.token"),
            ("Cookie", f"crate_session_listen={token}"),
        ]
    elif placement == "duplicate_cookie":
        headers["Cookie"] = f"crate_session={token}; crate_session=human.jwt.token"
    elif placement == "duplicate_query":
        path += f"?token={token}&token=human.jwt.token"
    elif placement == "duplicate_media_ticket":
        path += f"?media_ticket={token}&media_ticket=human"
    elif placement.endswith("cookie"):
        cookie_name = {
            "cookie": "crate_token",
            "session_cookie": "crate_session",
            "listen_cookie": "crate_session_listen",
            "refresh_cookie": "crate_refresh_listen",
        }[placement]
        headers["Cookie"] = f"{cookie_name}={token}"
    elif placement == "media_ticket":
        path += f"?media_ticket={token}"
    else:
        path += f"?token={token}"

    response = TestClient(app, client=("127.0.0.1", 50000)).get(path, headers=headers)
    assert response.status_code == 401


@pytest.mark.parametrize(
    "query,cookies",
    [
        pytest.param({"search": "archive crate_mcp_collection"}, {}, id="query"),
        pytest.param({}, {"ui_preference": "crate_mcp_recent"}, id="cookie"),
    ],
)
def test_human_resolver_ignores_mcp_substrings_outside_credential_carriers(
    monkeypatch, query, cookies
):
    from crate.api.auth import AuthMiddleware

    monkeypatch.setenv("FORWARD_AUTH_SECRET", "test-forward-auth-secret")
    headers = {
        "remote-user": "owner@example.test",
        "remote-groups": "admins",
        "x-forward-auth-secret": "test-forward-auth-secret",
    }
    if cookies:
        headers["cookie"] = "; ".join(
            f"{key}={value}" for key, value in cookies.items()
        )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/private",
            "query_string": urlencode(query).encode(),
            "headers": [
                (key.encode(), value.encode()) for key, value in headers.items()
            ],
            "client": ("127.0.0.1", 50000),
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )

    user = asyncio.run(AuthMiddleware(_identity).resolve_user(request))

    assert user == {"id": None, "email": "owner@example.test", "role": "admin"}
