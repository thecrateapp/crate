import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Request


class _AtomicRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}

    def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value.encode()
        return True

    def getdel(self, key: str) -> bytes | None:
        return self.values.pop(key, None)


def _request(
    *,
    method: str = "POST",
    path: str = "/api/auth/native/exchange",
    app_id: str = "listen-android",
) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "query_string": b"",
            "headers": [(b"x-crate-app", app_id.encode())],
            "client": ("127.0.0.1", 12345),
            "scheme": "https",
            "server": ("api.example.com", 443),
        }
    )


def test_native_handoff_is_hashed_bound_and_single_use() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    challenge = native_oauth.pkce_challenge(verifier)

    with (
        patch.object(native_oauth, "_redis_client", return_value=redis),
        patch.object(native_oauth.secrets, "token_urlsafe", return_value="raw-code"),
    ):
        code = native_oauth.issue_handoff(
            user_id=7,
            app_id="listen-android",
            state="state-token",
            challenge=challenge,
        )
        stored_key = next(iter(redis.values))
        stored_payload = json.loads(redis.values[stored_key])
        handoff = native_oauth.consume_handoff(
            code=code,
            state="state-token",
            verifier=verifier,
        )

        assert code == "raw-code"
        assert "raw-code" not in stored_key
        assert stored_payload["user_id"] == 7
        assert "token" not in stored_payload
        assert "refresh_token" not in stored_payload
        assert handoff.user_id == 7
        assert handoff.app_id == "listen-android"

        with pytest.raises(native_oauth.InvalidNativeOAuthHandoff):
            native_oauth.consume_handoff(
                code=code,
                state="state-token",
                verifier=verifier,
            )


@pytest.mark.parametrize(
    ("state", "verifier"),
    [
        ("wrong-state", "v" * 43),
        ("state-token", "w" * 43),
    ],
)
def test_native_handoff_rejects_wrong_binding(state: str, verifier: str) -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    correct_verifier = "v" * 43
    with (
        patch.object(native_oauth, "_redis_client", return_value=redis),
        patch.object(native_oauth.secrets, "token_urlsafe", return_value="raw-code"),
    ):
        code = native_oauth.issue_handoff(
            user_id=7,
            app_id="listen-android",
            state="state-token",
            challenge=native_oauth.pkce_challenge(correct_verifier),
        )
        with pytest.raises(native_oauth.InvalidNativeOAuthHandoff):
            native_oauth.consume_handoff(
                code=code,
                state=state,
                verifier=verifier,
            )


def test_native_handoff_rejects_expired_record() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    expired = {
        "user_id": 7,
        "app_id": "listen-android",
        "state": "state-token",
        "challenge": native_oauth.pkce_challenge(verifier),
        "expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
    }
    redis.values[native_oauth.handoff_key("raw-code")] = json.dumps(expired).encode()

    with patch.object(native_oauth, "_redis_client", return_value=redis):
        with pytest.raises(native_oauth.InvalidNativeOAuthHandoff):
            native_oauth.consume_handoff(
                code="raw-code",
                state="state-token",
                verifier=verifier,
            )


def test_native_handoff_fails_closed_without_redis_in_production() -> None:
    from crate.api import native_oauth

    with (
        patch.object(native_oauth, "_redis_client", return_value=None),
        patch.dict(
            "os.environ",
            {"DOMAIN": "lespedants.org", "CRATE_ENV": "production"},
            clear=False,
        ),
    ):
        with pytest.raises(native_oauth.NativeOAuthUnavailable):
            native_oauth.issue_handoff(
                user_id=7,
                app_id="listen-android",
                state="state-token",
                challenge=native_oauth.pkce_challenge("v" * 43),
            )


def test_native_exchange_creates_session_only_after_consumption() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    user = {
        "id": 7,
        "email": "user@example.com",
        "name": "User",
        "avatar": None,
        "role": "user",
        "roles": ["user"],
        "status": "active",
    }
    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-android",
        state="state-token",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )

    with (
        patch("crate.api.auth.consume_native_oauth_handoff", return_value=handoff),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login") as update_last_login,
        patch(
            "crate.api.auth._create_login_session",
            return_value=("jwt-token", {"id": "session-id"}, "refresh-token"),
        ) as create_session,
        patch(
            "crate.api.auth._auth_login_payload",
            return_value={"token": "jwt-token"},
        ),
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        payload = native_oauth_exchange(_request(), body)

    assert payload == {"token": "jwt-token"}
    update_last_login.assert_called_once_with(7)
    create_session.assert_called_once()


def test_native_exchange_rejects_app_mismatch_without_session() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-ios",
        state="state-token",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )

    with (
        patch("crate.api.auth.consume_native_oauth_handoff", return_value=handoff),
        patch("crate.api.auth._create_login_session") as create_session,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            native_oauth_exchange(_request(), body)

    assert exc_info.value.status_code == 401
    create_session.assert_not_called()
