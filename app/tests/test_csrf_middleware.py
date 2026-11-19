from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from crate.api.auth import AuthMiddleware
from crate.api.csrf import CookieCsrfMiddleware

ALLOWED_ORIGIN = "https://admin.lespedants.org"
FOREIGN_ORIGIN = "https://evil.example"
COOKIE_USER = {"id": 1, "email": "cookie@test", "role": "admin"}
BEARER_USER = {"id": 2, "email": "bearer@test", "role": "user"}


def _resolve_token_user(self, token: str):
    return {"cookie-jwt": COOKIE_USER, "bearer-jwt": BEARER_USER}.get(token)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(AuthMiddleware, "_resolve_token_user", _resolve_token_user)
    app = FastAPI()

    @app.api_route("/api/thing", methods=["GET", "POST", "DELETE"])
    def thing(request: Request):
        user = request.state.user
        return {"email": user["email"] if user else None}

    app.add_middleware(CookieCsrfMiddleware, allowed_origins=[ALLOWED_ORIGIN])
    app.add_middleware(AuthMiddleware)
    return TestClient(app)


def _cookie_client(client: TestClient) -> TestClient:
    client.cookies.set("crate_session", "cookie-jwt")
    return client


@pytest.mark.parametrize(
    ("method", "headers", "expected_status"),
    [
        ("POST", {"Origin": FOREIGN_ORIGIN}, 403),
        ("DELETE", {"Origin": FOREIGN_ORIGIN}, 403),
        ("POST", {"Origin": "null"}, 403),
        ("POST", {"Sec-Fetch-Site": "cross-site"}, 403),
        ("POST", {"Origin": ALLOWED_ORIGIN}, 200),
        ("POST", {"Origin": f"{ALLOWED_ORIGIN}/"}, 200),
        ("POST", {"Origin": ALLOWED_ORIGIN, "Sec-Fetch-Site": "same-site"}, 200),
        ("POST", {"Sec-Fetch-Site": "same-origin"}, 200),
        ("POST", {}, 200),
        ("GET", {"Origin": FOREIGN_ORIGIN}, 200),
    ],
)
def test_cookie_authenticated_requests(client, method, headers, expected_status):
    response = _cookie_client(client).request(method, "/api/thing", headers=headers)

    assert response.status_code == expected_status
    if expected_status == 403:
        assert response.json() == {"detail": "Cross-site request rejected"}
    else:
        assert response.json() == {"email": "cookie@test"}


def test_bearer_requests_from_other_origins_are_not_affected(client):
    response = _cookie_client(client).post(
        "/api/thing",
        headers={"Origin": FOREIGN_ORIGIN, "Authorization": "Bearer bearer-jwt"},
    )

    assert response.status_code == 200
    assert response.json() == {"email": "bearer@test"}


@pytest.fixture
def proxy_client(client, monkeypatch):
    monkeypatch.setenv("FORWARD_AUTH_SECRET", "proxy-secret")
    return TestClient(
        client.app,
        client=("172.18.0.5", 50000),
        headers={"Remote-User": "proxy@test", "X-Forward-Auth-Secret": "proxy-secret"},
    )


@pytest.mark.parametrize(
    ("method", "headers", "expected_status"),
    [
        ("POST", {"Origin": FOREIGN_ORIGIN}, 403),
        ("PUT", {"Origin": FOREIGN_ORIGIN}, 403),
        ("PATCH", {"Origin": FOREIGN_ORIGIN}, 403),
        ("DELETE", {"Origin": FOREIGN_ORIGIN}, 403),
        ("POST", {"Sec-Fetch-Site": "cross-site"}, 403),
        ("POST", {"Origin": ALLOWED_ORIGIN}, 200),
        ("POST", {"Sec-Fetch-Site": "same-origin"}, 200),
        ("GET", {"Origin": FOREIGN_ORIGIN}, 200),
    ],
)
def test_proxy_authenticated_requests(proxy_client, method, headers, expected_status):
    response = proxy_client.request(method, "/api/thing", headers=headers)

    assert response.status_code == expected_status
    if expected_status == 403:
        assert response.json() == {"detail": "Cross-site request rejected"}
    else:
        assert response.json() == {"email": "proxy@test"}


def test_proxy_headers_without_the_secret_are_not_checked(proxy_client):
    response = proxy_client.post(
        "/api/thing",
        headers={"Origin": FOREIGN_ORIGIN, "X-Forward-Auth-Secret": "wrong"},
    )

    assert response.status_code == 200
    assert response.json() == {"email": None}


def test_bearer_requests_through_the_proxy_are_not_affected(proxy_client):
    response = proxy_client.post(
        "/api/thing",
        headers={"Origin": FOREIGN_ORIGIN, "Authorization": "Bearer bearer-jwt"},
    )

    assert response.status_code == 200
    assert response.json() == {"email": "bearer@test"}


def test_unauthenticated_requests_are_left_to_the_route(client):
    client.cookies.set("crate_session", "expired-jwt")

    response = client.post("/api/thing", headers={"Origin": FOREIGN_ORIGIN})

    assert response.status_code == 200
    assert response.json() == {"email": None}


def test_app_rejects_cross_origin_cookie_mutations(monkeypatch):
    monkeypatch.setenv("DOMAIN", "lespedants.org")
    monkeypatch.setattr(AuthMiddleware, "_resolve_token_user", _resolve_token_user)
    with patch("crate.db.init_db"):
        from crate.api import create_app

        client = TestClient(create_app())
    client.cookies.set("crate_session", "cookie-jwt")

    rejected = client.post(
        "/api/stack/container/crate-api/restart",
        headers={"Origin": FOREIGN_ORIGIN},
    )
    assert rejected.status_code == 403
    assert rejected.json() == {"detail": "Cross-site request rejected"}

    with patch("crate.api.auth.revoke_session"):
        allowed = client.post(
            "/api/auth/logout", headers={"Origin": "https://listen.lespedants.org"}
        )
    assert allowed.status_code == 200
