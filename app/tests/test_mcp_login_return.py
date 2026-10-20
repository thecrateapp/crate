"""Human provider login resumes only canonical configured MCP destinations."""

from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from crate import auth as tokens
from crate.api import auth
from crate.api.mcp_oauth import router as mcp_oauth_router

ISSUER = "https://api.example.test"


@pytest.fixture
def mcp_login_config(monkeypatch):
    monkeypatch.setenv("DOMAIN", "example.test")
    monkeypatch.delenv("DEV_DOMAIN", raising=False)
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", ISSUER)
    monkeypatch.delenv("CRATE_MCP_OAUTH_ALLOW_LOCALHOST", raising=False)
    monkeypatch.setenv("JWT_SECRET", "mcp-login-test-secret-32-bytes-long")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-test-client")
    monkeypatch.setenv("APPLE_CLIENT_ID", "apple-test-client")
    return monkeypatch


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.hrefs.extend(value for key, value in attrs if key == "href")


@pytest.mark.parametrize("provider", ["google", "apple"])
@pytest.mark.parametrize("path", ["/oauth/authorize", "/oauth/connections"])
def test_mcp_destination_resumes_after_real_provider_callback(
    mcp_login_config, provider, path
):
    monkeypatch = mcp_login_config
    query = urlencode(
        {
            "response_type": "code",
            "client_id": "remote-client",
            "redirect_uri": "https://client.example/callback",
            "scope": "library.health.read ops.status.read",
            "state": "opaque state + / = & retained",
            "resource": ISSUER + "/mcp",
            "code_challenge_method": "S256",
            "code_challenge": "a" * 43,
        }
    )
    expected_return = (
        ISSUER + path + ("?" + query if path.endswith("authorize") else "")
    )
    app = FastAPI()
    app.include_router(mcp_oauth_router)
    app.include_router(auth.router)
    monkeypatch.setattr(auth, "_provider_available", lambda _: True)
    monkeypatch.setattr(auth, "_enforce_login_rate_limit", lambda *args: None)
    monkeypatch.setattr(auth, "_clear_failed_login", lambda *args: None)
    monkeypatch.setattr(
        auth,
        f"_{provider}_userinfo",
        lambda *args: {
            "id": "provider-account",
            "sub": "provider-account",
            "email": "human@example.test",
            "name": "Human",
        },
    )
    monkeypatch.setattr(
        auth,
        "get_user_by_external_identity",
        lambda *args: {
            "id": 42,
            "email": "human@example.test",
            "role": "admin",
            "status": "active",
        },
    )
    monkeypatch.setattr(auth, "update_user_last_login", lambda *args: None)
    # Keep the actual JWT expiry: it must not decorate the MCP authorization query.
    jwt = tokens.create_jwt(42, "human@example.test", "admin")
    monkeypatch.setattr(
        auth,
        "_create_login_session",
        lambda *args, **kwargs: (jwt, {"id": "isolated-session"}, None),
    )
    monkeypatch.setattr(auth, "_set_login_cookies", lambda *args, **kwargs: None)
    with TestClient(app, base_url=ISSUER) as client:
        response = client.get(expected_return)
        assert response.status_code == 401
        parser = _Links()
        parser.feed(response.text)
        (login_link,) = parser.hrefs
        assert urlsplit(login_link).netloc == "admin.example.test"
        (return_to,) = parse_qs(urlsplit(login_link).query)["redirect"]
        assert return_to == expected_return
        started = client.post(
            f"/api/auth/oauth/{provider}/start", json={"return_to": return_to}
        )
        assert started.status_code == 200, started.text
        provider_query = parse_qs(urlsplit(started.json()["login_url"]).query)
        assert provider_query["redirect_uri"] == [
            f"https://admin.example.test/api/auth/oauth/{provider}/callback"
        ]
        callback = client.get(
            f"/api/auth/oauth/{provider}/callback",
            params={"code": "provider-code", "state": provider_query["state"][0]},
            follow_redirects=False,
        )
    assert callback.status_code == 307
    assert callback.headers["location"] == expected_return


@pytest.mark.parametrize("path", ["/oauth/authorize", "/oauth/connections"])
def test_canonical_mcp_return_preserves_query_without_expanding_provider_callback(
    mcp_login_config, path
):
    target = (
        ISSUER + path + "?state=a%2Bb+%26&resource=https%3A%2F%2Fapi.example.test%2Fmcp"
    )
    assert auth._validate_return_to(target) == target
    assert auth._oauth_callback_url("google", target) == (
        "https://admin.example.test/api/auth/oauth/google/callback"
    )


@pytest.mark.parametrize(
    "target",
    [
        ISSUER + "/",
        ISSUER + "/oauth/token",
        ISSUER + "/api/admin/users",
        ISSUER + "/oauth/authorize/",
        ISSUER + "/oauth/authorize/child",
        ISSUER + "/oauth/connections/id/revoke",
        ISSUER + "/oauth/../oauth/authorize",
        ISSUER + "/%6fauth/authorize",
        ISSUER + "/oauth/authorize#fragment",
        ISSUER + "/oauth/authorize\n",
        "https://api.example.test.evil.test/oauth/authorize",
        "https://user@api.example.test/oauth/authorize",
        "https://api.example.test:444/oauth/authorize",
        "http://api.example.test/oauth/authorize",
        "//api.example.test/oauth/authorize",
    ],
)
def test_mcp_return_rejects_noncanonical_or_unrelated_destinations(
    mcp_login_config, target
):
    assert auth._validate_return_to(target) == "/"


@pytest.mark.parametrize(
    "issuer",
    ["", "http://api.example.test", ISSUER + "/prefix", ISSUER + ":99999"],
)
def test_mcp_return_requires_valid_explicit_issuer(mcp_login_config, issuer):
    mcp_login_config.setenv("CRATE_MCP_OAUTH_ISSUER", issuer)
    assert auth._validate_return_to(ISSUER + "/oauth/authorize?state=retained") == "/"


def test_disabled_oauth_cannot_resume_authorization(mcp_login_config):
    mcp_login_config.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    assert auth._validate_return_to(ISSUER + "/oauth/authorize?state=retained") == "/"


def test_disabled_oauth_can_resume_connection_revocation(mcp_login_config):
    mcp_login_config.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    target = ISSUER + "/oauth/connections"
    assert auth._validate_return_to(target) == target


@pytest.mark.parametrize("allow_localhost", ["false", "true"])
def test_local_mcp_return_requires_explicit_development_opt_in(
    mcp_login_config, allow_localhost
):
    mcp_login_config.setenv("CRATE_MCP_OAUTH_ISSUER", "http://localhost:8585")
    mcp_login_config.setenv("CRATE_MCP_OAUTH_ALLOW_LOCALHOST", allow_localhost)
    target = "http://localhost:8585/oauth/authorize?state=retained"
    assert auth._validate_return_to(target) == (
        target if allow_localhost == "true" else "/"
    )
