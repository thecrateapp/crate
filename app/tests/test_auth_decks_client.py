"""Crate Decks as a first-class native client (S1).

Decks identifies itself with ``X-Crate-App: decks/<version>``. It gets the same
session policy as Listen (refresh token, 1 h access token, 30-day session) but
no cookies, and its native OAuth app ID is ``crate-decks`` with an RFC 8252
loopback callback on ``http://127.0.0.1:<port>/callback``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException, Request

LOOPBACK_CALLBACK = "http://127.0.0.1:53682/callback"
CHALLENGE = "c" * 43
STATE = "s" * 43
LISTEN_APP_IDS = (
    "listen-web",
    "listen-android",
    "listen-ios",
    "listen-native",
    "listen-tauri",
)
_USER = {
    "id": 7,
    "email": "dj@test.com",
    "name": "DJ",
    "avatar": None,
    "role": "user",
    "roles": ["user"],
    "username": "dj",
    "status": "active",
    "password_hash": "$2b$12$irrelevant",
}


@pytest.fixture(autouse=True)
def _native_oauth_environment(monkeypatch):
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.setenv("NATIVE_OAUTH_EXCHANGE_ENABLED", "true")
    monkeypatch.setenv("DOMAIN", "lespedants.org")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-client")


@pytest.fixture(autouse=True)
def _clear_login_failures():
    from crate.api import auth as auth_api

    auth_api._login_failure_memory.clear()
    yield
    auth_api._login_failure_memory.clear()


def _request(
    *,
    app: str | None = None,
    path: str = "/api/auth/oauth/google/start",
    query: bytes = b"",
) -> Request:
    headers = [(b"host", b"api.lespedants.org"), (b"user-agent", b"CrateDecks/0.1")]
    if app is not None:
        headers.append((b"x-crate-app", app.encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "query_string": query,
            "headers": headers,
            "client": ("203.0.113.9", 50000),
            "server": ("api.lespedants.org", 443),
            "scheme": "https",
        }
    )


def _set_cookie_headers(response) -> list[str]:
    return response.headers.get_list("set-cookie")


def _login(test_app, headers: dict[str, str]) -> tuple[Any, dict[str, Any]]:
    captured: dict[str, Any] = {}

    def fake_create_session(session_id, user_id, expires_at, **kwargs):
        captured["expires_at"] = expires_at
        captured["kwargs"] = kwargs
        return {"id": session_id, "expires_at": expires_at}

    with (
        patch("crate.api.auth.get_user_by_email", return_value=dict(_USER)),
        patch("crate.api.auth.get_setting", return_value=None),
        patch("crate.api.auth.verify_password", return_value=True),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.create_session", side_effect=fake_create_session),
        patch("crate.api.auth.create_jwt", return_value="access-token") as create_jwt,
        patch(
            "crate.api.auth.create_refresh_jwt", return_value="refresh-token"
        ) as create_refresh,
    ):
        before = datetime.now(timezone.utc)
        response = test_app.post(
            "/api/auth/login",
            json={"email": "dj@test.com", "password": "secret-pass"},
            headers=headers,
        )
    captured["before"] = before
    captured["access_hours"] = create_jwt.call_args.kwargs["expires_in_hours"]
    captured["refresh_called"] = create_refresh.called
    return response, captured


# ── Password login and refresh ───────────────────────────────────


@pytest.mark.parametrize("app_header", ["decks/0.1.0", "Decks/1.2.3-beta.1+linux"])
def test_login_with_decks_app_header_returns_refresh_token(test_app, app_header):
    from crate.auth import LISTEN_ACCESS_TOKEN_EXPIRY_HOURS

    response, captured = _login(
        test_app, {"X-Crate-App": app_header, "X-Device-Label": "Booth laptop"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token"] == "access-token"
    assert body["refresh_token"] == "refresh-token"
    assert captured["access_hours"] == LISTEN_ACCESS_TOKEN_EXPIRY_HOURS
    session_expiry = datetime.fromisoformat(captured["expires_at"])
    assert session_expiry - captured["before"] >= timedelta(days=30) - timedelta(
        seconds=5
    )
    assert captured["kwargs"]["app_id"] == app_header
    assert captured["kwargs"]["device_fingerprint"].startswith("ua:")
    # Decks is a bearer-only native client: tokens travel in the body only.
    assert _set_cookie_headers(response) == []


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Crate-App": "decks"},
        {"X-Crate-App": "decks/"},
        {"X-Crate-App": "decks/0.1.0 extra"},
        {"X-Crate-App": "decks/<script>"},
        {"X-Crate-App": "mixxx/2.5.0"},
        {"X-Crate-App": "crate-deck"},
        {"X-Crate-App": "virtualdj"},
    ],
)
def test_login_without_known_app_header_does_not_return_refresh_token(
    test_app, headers
):
    from crate.auth import JWT_EXPIRY_HOURS

    response, captured = _login(test_app, headers)

    assert response.status_code == 200
    assert response.json()["refresh_token"] is None
    assert captured["refresh_called"] is False
    assert captured["access_hours"] == JWT_EXPIRY_HOURS
    assert any(
        cookie.startswith("crate_session=") for cookie in _set_cookie_headers(response)
    )


@pytest.mark.parametrize("session_app_id", ["decks/0.1.0", "crate-decks"])
def test_refresh_with_decks_token_rotates(test_app, session_app_id):
    from crate.auth import LISTEN_ACCESS_TOKEN_EXPIRY_HOURS

    expires_at = datetime.now(timezone.utc) + timedelta(days=29)
    session = {
        "id": "decks-session",
        "user_id": 7,
        "expires_at": expires_at,
        "revoked_at": None,
        "app_id": session_app_id,
        "device_label": "Booth laptop",
        "device_fingerprint": "ua:abc",
    }
    with (
        patch(
            "crate.api.auth.verify_refresh_jwt",
            return_value={"user_id": 7, "sid": "decks-session"},
        ),
        patch("crate.api.auth.get_session", return_value=session),
        patch("crate.api.auth.get_user_by_id", return_value=dict(_USER)),
        patch("crate.api.auth.touch_session", return_value=session),
        patch("crate.api.auth.create_jwt", return_value="new-access") as create_jwt,
        patch(
            "crate.api.auth.create_refresh_jwt", return_value="new-refresh"
        ) as create_refresh,
    ):
        response = test_app.post(
            "/api/auth/refresh",
            json={"refresh_token": "old-refresh"},
            headers={"X-Crate-App": "decks/0.1.0"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["token"] == "new-access"
    assert body["refresh_token"] == "new-refresh"
    assert body["session"]["id"] == "decks-session"
    create_refresh.assert_called_once_with(7, "decks-session", expires_at)
    assert (
        create_jwt.call_args.kwargs["expires_in_hours"]
        == LISTEN_ACCESS_TOKEN_EXPIRY_HOURS
    )
    assert _set_cookie_headers(response) == []


def test_register_with_decks_app_header_returns_refresh_token(test_app):
    with (
        patch("crate.api.auth.count_users", return_value=0),
        patch("crate.api.auth.get_setting", return_value=None),
        patch("crate.api.auth.get_user_by_email", return_value=None),
        patch("crate.api.auth.hash_password", return_value="hashed"),
        patch("crate.api.auth.create_user", return_value=dict(_USER)),
        patch("crate.api.auth.update_user_last_login"),
        patch(
            "crate.api.auth.create_session",
            side_effect=lambda session_id, user_id, expires_at, **_: {
                "id": session_id,
                "expires_at": expires_at,
            },
        ),
        patch("crate.api.auth.create_jwt", return_value="access-token"),
        patch("crate.api.auth.create_refresh_jwt", return_value="refresh-token"),
    ):
        response = test_app.post(
            "/api/auth/register",
            json={"email": "dj@test.com", "password": "secret-pass"},
            headers={"X-Crate-App": "decks/0.1.0"},
        )

    assert response.status_code == 201
    assert response.json()["refresh_token"] == "refresh-token"
    assert _set_cookie_headers(response) == []


# ── Client identification helpers ────────────────────────────────


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("decks/0.1.0", True),
        ("DECKS/0.1.0", True),
        (" decks/2.0.0-rc.1+build.5 ", True),
        ("crate-decks", True),
        ("Crate-Decks", True),
        ("decks/" + "1" * 64, True),
        ("decks/" + "1" * 65, False),
        ("decks/", False),
        ("decks", False),
        ("decks/.1", False),
        ("decks/0.1.0/extra", False),
        ("listen-tauri", False),
        ("", False),
        (None, False),
    ],
)
def test_is_decks_app_id(value, expected):
    from crate.api.native_oauth_auth import is_decks_app_id

    assert is_decks_app_id(value) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("decks/0.1.0", "crate-decks"),
        ("crate-decks", "crate-decks"),
        ("listen-android", "listen-android"),
        ("Listen-Web", "Listen-Web"),
        (None, None),
    ],
)
def test_native_binding_app_id_only_canonicalises_decks(value, expected):
    from crate.api.native_oauth_auth import native_binding_app_id

    assert native_binding_app_id(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("crate-decks", True),
        ("decks/0.1.0", True),
        ("listen-tauri", True),
        ("listen-android", True),
        ("listen-web", False),
        ("virtualdj", False),
        (None, False),
    ],
)
def test_is_native_app_id(value, expected):
    from crate.api.native_oauth_auth import is_native_app_id

    assert is_native_app_id(value) is expected


# ── Native OAuth: start ──────────────────────────────────────────


def _start(request: Request, *, return_to, challenge=CHALLENGE, state=STATE):
    from crate.api.auth import oauth_start
    from crate.api.schemas.auth import OAuthStartRequest

    captured: dict[str, Any] = {}
    with (
        patch("crate.api.auth._provider_available", return_value=True),
        patch(
            "crate.api.auth._build_oauth_state",
            side_effect=lambda **kwargs: captured.update(kwargs) or "state-token",
        ),
        patch(
            "crate.api.auth._parse_oauth_state",
            return_value={"verifier": "provider-verifier"},
        ),
    ):
        result = oauth_start(
            request,
            "google",
            OAuthStartRequest(
                return_to=return_to,
                native_code_challenge=challenge,
                native_state=state,
            ),
        )
    return result, captured


@pytest.mark.parametrize(
    ("header", "query", "return_to"),
    [
        ("decks/0.1.0", b"", LOOPBACK_CALLBACK),
        ("crate-decks", b"", "http://127.0.0.1:1/callback"),
        (None, b"app_id=crate-decks", "http://127.0.0.1:65535/callback"),
    ],
)
def test_native_oauth_accepts_crate_decks_loopback_redirect(header, query, return_to):
    result, captured = _start(_request(app=header, query=query), return_to=return_to)

    assert captured["app_id"] == "crate-decks"
    assert captured["return_to"] == return_to
    assert captured["native_code_challenge"] == CHALLENGE
    assert captured["native_state"] == STATE
    provider_query = parse_qs(urlparse(result["login_url"]).query)
    # The provider callback stays on the registered Listen origin; the loopback
    # URL is only where Crate sends the one-time code afterwards.
    assert provider_query["redirect_uri"] == [
        "https://listen.lespedants.org/api/auth/oauth/google/callback"
    ]


@pytest.mark.parametrize(
    "return_to",
    [
        "http://localhost:53682/callback",
        "http://127.0.0.2:53682/callback",
        "https://evil.example/callback",
        "http://127.0.0.1.evil.com/callback",
        "http://127.0.0.1.evil.com:53682/callback",
        "https://127.0.0.1:53682/callback",
        "http://127.0.0.1/callback",
        "http://127.0.0.1:0/callback",
        "http://127.0.0.1:65536/callback",
        "http://127.0.0.1:053682/callback",
        "http://127.0.0.1:53682/callback/",
        "http://127.0.0.1:53682/other",
        "http://127.0.0.1:53682/callback?next=https://evil.example",
        "http://127.0.0.1:53682/callback#fragment",
        "http://user@127.0.0.1:53682/callback",
        "http://[::1]:53682/callback",
        "cratemusic://oauth/callback",
        "/auth/callback",
        None,
    ],
)
def test_native_oauth_rejects_crate_decks_non_loopback_redirect(return_to):
    with pytest.raises(HTTPException) as exc_info:
        _start(_request(app="decks/0.1.0"), return_to=return_to)

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize(
    ("challenge", "state"),
    [
        (None, None),
        (None, STATE),
        (CHALLENGE, None),
        ("c" * 42, STATE),
        ("c" * 44, STATE),
        (CHALLENGE, "short"),
        (CHALLENGE, "s" * 257),
    ],
)
def test_native_oauth_requires_pkce_for_crate_decks(challenge, state):
    with pytest.raises(HTTPException) as exc_info:
        _start(
            _request(app="decks/0.1.0"),
            return_to=LOOPBACK_CALLBACK,
            challenge=challenge,
            state=state,
        )

    assert exc_info.value.status_code == 400


def test_native_oauth_for_crate_decks_honours_the_exchange_kill_switch(monkeypatch):
    monkeypatch.setenv("NATIVE_OAUTH_EXCHANGE_ENABLED", "false")

    with pytest.raises(HTTPException) as exc_info:
        _start(_request(app="decks/0.1.0"), return_to=LOOPBACK_CALLBACK)

    assert exc_info.value.status_code == 503


# ── Native OAuth: provider callback ──────────────────────────────


def _decks_state(**overrides) -> dict[str, Any]:
    return {
        "provider": "google",
        "return_to": LOOPBACK_CALLBACK,
        "mode": "login",
        "verifier": "provider-verifier",
        "app_id": "crate-decks",
        "native_code_challenge": CHALLENGE,
        "native_state": STATE,
        **overrides,
    }


def test_native_oauth_callback_sends_only_a_code_to_the_decks_loopback():
    from crate.api.auth import oauth_callback

    with (
        patch("crate.api.auth._parse_oauth_state", return_value=_decks_state()),
        patch(
            "crate.api.auth._google_userinfo",
            return_value={"id": "google-dj", "email": "dj@test.com", "name": "DJ"},
        ),
        patch("crate.api.auth.get_user_by_external_identity", return_value=dict(_USER)),
        patch(
            "crate.api.auth.issue_native_oauth_handoff", return_value="one-time-code"
        ) as issue_handoff,
        patch("crate.api.auth.update_user_last_login") as update_last_login,
        patch("crate.api.auth._create_login_session") as create_session,
    ):
        response = oauth_callback(
            _request(path="/api/auth/oauth/google/callback"),
            "google",
            code="provider-code",
            state="state-token",
        )

    assert response.headers["location"] == (
        f"{LOOPBACK_CALLBACK}?code=one-time-code&state={STATE}"
    )
    issue_handoff.assert_called_once_with(
        user_id=7, app_id="crate-decks", state=STATE, challenge=CHALLENGE
    )
    update_last_login.assert_not_called()
    create_session.assert_not_called()


def test_native_oauth_denied_callback_returns_the_error_to_the_decks_loopback():
    from crate.api.auth import oauth_callback

    with patch("crate.api.auth._parse_oauth_state", return_value=_decks_state()):
        response = oauth_callback(
            _request(path="/api/auth/oauth/google/callback"),
            "google",
            state="state-token",
            error="access_denied",
        )

    assert response.headers["location"] == (
        f"{LOOPBACK_CALLBACK}?state={STATE}&error=cancelled"
    )


def test_native_oauth_callback_never_redirects_decks_to_a_tampered_callback():
    from crate.api.auth import oauth_callback

    with (
        patch(
            "crate.api.auth._parse_oauth_state",
            return_value=_decks_state(return_to="http://localhost:53682/callback"),
        ),
        patch("crate.api.auth.issue_native_oauth_handoff") as issue_handoff,
        pytest.raises(HTTPException) as exc_info,
    ):
        oauth_callback(
            _request(path="/api/auth/oauth/google/callback"),
            "google",
            state="state-token",
            error="access_denied",
        )

    assert exc_info.value.status_code == 400
    issue_handoff.assert_not_called()


# ── Native OAuth: exchange ───────────────────────────────────────


def _exchange(request: Request, handoff_app_id: str):
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id=handoff_app_id,
        state=STATE,
        challenge=CHALLENGE,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token", code_verifier="v" * 43, state=STATE
    )
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange", return_value=None
        ) as get_completed,
        patch("crate.api.auth.consume_native_oauth_handoff", return_value=handoff),
        patch("crate.api.auth.get_user_by_id", return_value=dict(_USER)),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.get_session", return_value=None),
        patch(
            "crate.api.auth._create_login_session",
            return_value=(
                "access-token",
                {"id": "decks-session", "expires_at": None},
                "refresh-token",
            ),
        ) as create_session,
        patch("crate.api.auth.complete_native_oauth_exchange"),
    ):
        payload = native_oauth_exchange(request, body)
    return payload, create_session, get_completed


def test_native_exchange_issues_a_refresh_session_for_crate_decks():
    payload, create_session, get_completed = _exchange(
        _request(app="decks/0.1.0", path="/api/auth/native/exchange"),
        handoff_app_id="crate-decks",
    )

    assert payload["token"] == "access-token"
    assert payload["refresh_token"] == "refresh-token"
    assert get_completed.call_args.kwargs["app_id"] == "crate-decks"
    assert create_session.call_args.kwargs["app_id"] == "decks/0.1.0"


@pytest.mark.parametrize(
    ("header", "handoff_app_id"),
    [("decks/0.1.0", "listen-tauri"), ("listen-tauri", "crate-decks")],
)
def test_native_exchange_rejects_a_handoff_for_another_client(header, handoff_app_id):
    with pytest.raises(HTTPException) as exc_info:
        _exchange(
            _request(app=header, path="/api/auth/native/exchange"),
            handoff_app_id=handoff_app_id,
        )

    assert exc_info.value.status_code == 401


# ── Listen regression ────────────────────────────────────────────


@pytest.mark.parametrize("app_id", LISTEN_APP_IDS)
def test_listen_clients_unchanged(test_app, app_id):
    from crate.auth import LISTEN_ACCESS_TOKEN_EXPIRY_HOURS

    response, captured = _login(test_app, {"X-Crate-App": app_id})

    assert response.status_code == 200
    assert response.json()["refresh_token"] == "refresh-token"
    assert captured["access_hours"] == LISTEN_ACCESS_TOKEN_EXPIRY_HOURS
    assert captured["kwargs"]["app_id"] == app_id
    cookies = _set_cookie_headers(response)
    assert any(
        cookie.startswith("crate_session_listen=access-token") for cookie in cookies
    )
    assert any(
        cookie.startswith("crate_refresh_listen=refresh-token") for cookie in cookies
    )


@pytest.mark.parametrize(
    "app_id", ["listen-android", "listen-ios", "listen-native", "listen-tauri"]
)
def test_native_listen_clients_cannot_use_the_decks_loopback(app_id):
    with pytest.raises(HTTPException) as exc_info:
        _start(_request(app=app_id), return_to=LOOPBACK_CALLBACK)

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize("app_id", ["listen-android", "listen-ios", "listen-native"])
def test_native_listen_start_keeps_its_custom_scheme_contract(app_id):
    _result, captured = _start(
        _request(app=app_id), return_to="cratemusic://oauth/callback"
    )

    assert captured["app_id"] == app_id
    assert captured["return_to"] == "cratemusic://oauth/callback"
