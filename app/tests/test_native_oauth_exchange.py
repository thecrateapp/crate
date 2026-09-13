import json
from datetime import datetime, timedelta, timezone
from unittest.mock import ANY, patch

import pytest
from fastapi import HTTPException, Request


class _AtomicRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.expirations: dict[str, int] = {}

    def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value.encode()
        self.expirations[key] = ex
        return True

    def getdel(self, key: str) -> bytes | None:
        return self.values.pop(key, None)

    def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    def delete(self, key: str) -> None:
        self.values.pop(key, None)

    def eval(
        self,
        _script: str,
        _num_keys: int,
        handoff_key: str,
        pending_key: str,
        ttl_seconds: int,
    ) -> list[int | bytes]:
        if pending_key in self.values:
            return [2]
        raw = self.values.get(handoff_key)
        if raw is None:
            return [0]
        self.values[pending_key] = raw
        self.expirations[pending_key] = int(ttl_seconds)
        self.values.pop(handoff_key, None)
        return [1, raw]


class _UnavailableRedis:
    def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        raise ConnectionError("redis unavailable")

    def getdel(self, key: str) -> bytes | None:
        raise ConnectionError("redis unavailable")


class _WriteThenUnavailableRedis(_AtomicRedis):
    def set(self, key: str, value: str, *, ex: int, nx: bool = False) -> bool:
        stored = super().set(key, value, ex=ex, nx=nx)
        if key.endswith(":result"):
            raise ConnectionError("redis response lost after write")
        return stored


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
        native_oauth.complete_exchange(
            code=code,
            handoff=handoff,
            payload={"token": "jwt-token"},
        )

        with pytest.raises(native_oauth.InvalidNativeOAuthHandoff):
            native_oauth.consume_handoff(
                code=code,
                state="state-token",
                verifier=verifier,
            )


def test_native_exchange_session_id_is_stable_and_does_not_embed_the_code() -> None:
    from crate.api import native_oauth

    first = native_oauth.exchange_session_id("one-time-secret-code")

    assert first == native_oauth.exchange_session_id("one-time-secret-code")
    assert first != native_oauth.exchange_session_id("another-code")
    assert "one-time-secret-code" not in first


def test_native_handoff_replays_a_completed_exchange_idempotently() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    with (
        patch.object(native_oauth, "_redis_client", return_value=redis),
        patch.object(native_oauth.secrets, "token_urlsafe", return_value="raw-code"),
    ):
        code = native_oauth.issue_handoff(
            user_id=7,
            app_id="listen-tauri",
            state="state-token",
            challenge=native_oauth.pkce_challenge(verifier),
        )
        handoff = native_oauth.consume_handoff(
            code=code,
            state="state-token",
            verifier=verifier,
        )
        native_oauth.complete_exchange(
            code=code,
            handoff=handoff,
            payload={"token": "jwt-token"},
        )

        assert native_oauth.get_completed_exchange(
            code=code,
            state="state-token",
            verifier=verifier,
            app_id="listen-tauri",
        ) == {"token": "jwt-token"}


def test_native_exchange_result_survives_the_full_handoff_retry_window() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    handoff = native_oauth.NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token",
        challenge=native_oauth.pkce_challenge(verifier),
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=native_oauth.NATIVE_OAUTH_HANDOFF_TTL_SECONDS),
    )

    with patch.object(native_oauth, "_redis_client", return_value=redis):
        native_oauth.complete_exchange(
            code="raw-code",
            handoff=handoff,
            payload={"token": "jwt-token"},
        )

    assert (
        redis.expirations[native_oauth.exchange_result_key("raw-code")]
        == native_oauth.NATIVE_OAUTH_HANDOFF_TTL_SECONDS
    )


def test_native_exchange_accepts_a_write_when_only_the_redis_response_is_lost() -> None:
    from crate.api import native_oauth

    redis = _WriteThenUnavailableRedis()
    verifier = "v" * 43
    handoff = native_oauth.NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token",
        challenge=native_oauth.pkce_challenge(verifier),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
    )

    with patch.object(native_oauth, "_redis_client", return_value=redis):
        native_oauth.complete_exchange(
            code="raw-code",
            handoff=handoff,
            payload={"token": "jwt-token"},
        )

        assert native_oauth.get_completed_exchange(
            code="raw-code",
            state="state-token",
            verifier=verifier,
            app_id="listen-tauri",
        ) == {"token": "jwt-token"}


def test_native_handoff_can_be_restored_after_exchange_failure() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    with (
        patch.object(native_oauth, "_redis_client", return_value=redis),
        patch.object(native_oauth.secrets, "token_urlsafe", return_value="raw-code"),
    ):
        code = native_oauth.issue_handoff(
            user_id=7,
            app_id="listen-tauri",
            state="state-token",
            challenge=native_oauth.pkce_challenge(verifier),
        )
        handoff = native_oauth.consume_handoff(
            code=code,
            state="state-token",
            verifier=verifier,
        )
        native_oauth.restore_handoff(code=code, handoff=handoff)

        assert (
            native_oauth.consume_handoff(
                code=code,
                state="state-token",
                verifier=verifier,
            )
            == handoff
        )


def test_native_handoff_reports_an_exchange_already_in_progress() -> None:
    from crate.api import native_oauth

    redis = _AtomicRedis()
    verifier = "v" * 43
    with (
        patch.object(native_oauth, "_redis_client", return_value=redis),
        patch.object(native_oauth.secrets, "token_urlsafe", return_value="raw-code"),
    ):
        code = native_oauth.issue_handoff(
            user_id=7,
            app_id="listen-tauri",
            state="state-token",
            challenge=native_oauth.pkce_challenge(verifier),
        )
        native_oauth.consume_handoff(
            code=code,
            state="state-token",
            verifier=verifier,
        )

        with pytest.raises(native_oauth.NativeOAuthExchangePending):
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


def test_native_handoff_translates_active_redis_write_failure() -> None:
    from crate.api import native_oauth

    with patch.object(
        native_oauth,
        "_redis_client",
        return_value=_UnavailableRedis(),
    ):
        with pytest.raises(native_oauth.NativeOAuthUnavailable):
            native_oauth.issue_handoff(
                user_id=7,
                app_id="listen-android",
                state="state-token",
                challenge=native_oauth.pkce_challenge("v" * 43),
            )


def test_native_handoff_translates_active_redis_read_failure() -> None:
    from crate.api import native_oauth

    with patch.object(
        native_oauth,
        "_redis_client",
        return_value=_UnavailableRedis(),
    ):
        with pytest.raises(native_oauth.NativeOAuthUnavailable):
            native_oauth.consume_handoff(
                code="handoff-code",
                state="state-token",
                verifier="v" * 43,
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
        patch("crate.api.auth.get_session", return_value=None),
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


def test_native_exchange_replays_completed_response_without_new_session() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value={"token": "existing-token"},
        ),
        patch("crate.api.auth.consume_native_oauth_handoff") as consume_handoff,
        patch("crate.api.auth._create_login_session") as create_session,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        payload = native_oauth_exchange(_request(app_id="listen-tauri"), body)

    assert payload == {"token": "existing-token"}
    consume_handoff.assert_not_called()
    create_session.assert_not_called()


def test_native_exchange_restores_handoff_when_session_creation_fails() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token-value",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    user = {
        "id": 7,
        "email": "user@example.com",
        "role": "user",
        "status": "active",
    }
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value=None,
        ),
        patch(
            "crate.api.auth.consume_native_oauth_handoff",
            return_value=handoff,
        ),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.get_session", return_value=None),
        patch(
            "crate.api.auth._create_login_session",
            side_effect=RuntimeError("database unavailable"),
        ),
        patch("crate.api.auth.restore_native_oauth_handoff") as restore_handoff,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(RuntimeError, match="database unavailable"):
            native_oauth_exchange(_request(app_id="listen-tauri"), body)

    restore_handoff.assert_called_once_with(code=body.code, handoff=handoff)


def test_native_exchange_deletes_session_and_restores_handoff_when_result_cache_fails() -> (
    None
):
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff, NativeOAuthUnavailable
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token-value",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    user = {
        "id": 7,
        "email": "user@example.com",
        "role": "user",
        "status": "active",
    }
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value=None,
        ),
        patch(
            "crate.api.auth.consume_native_oauth_handoff",
            return_value=handoff,
        ),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.get_session", return_value=None),
        patch(
            "crate.api.auth.native_oauth_exchange_session_id",
            return_value="session-id",
        ),
        patch(
            "crate.api.auth._create_login_session",
            return_value=("jwt-token", {"id": "session-id"}, "refresh-token"),
        ),
        patch("crate.api.auth.secrets.token_urlsafe", return_value="session-id"),
        patch(
            "crate.api.auth._auth_login_payload",
            return_value={"token": "jwt-token"},
        ),
        patch(
            "crate.api.auth.complete_native_oauth_exchange",
            side_effect=NativeOAuthUnavailable("redis unavailable"),
        ),
        patch("crate.api.auth.delete_session") as delete_session,
        patch("crate.api.auth.restore_native_oauth_handoff") as restore_handoff,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            native_oauth_exchange(_request(app_id="listen-tauri"), body)

    assert exc_info.value.status_code == 503
    delete_session.assert_called_once_with("session-id")
    restore_handoff.assert_called_once_with(code=body.code, handoff=handoff)


def test_native_exchange_does_not_revoke_a_reused_session_when_result_cache_fails() -> (
    None
):
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import NativeOAuthHandoff, NativeOAuthUnavailable
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token-value",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    user = {
        "id": 7,
        "email": "user@example.com",
        "role": "user",
        "status": "active",
    }
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value=None,
        ),
        patch(
            "crate.api.auth.consume_native_oauth_handoff",
            return_value=handoff,
        ),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.get_session", return_value=None),
        patch(
            "crate.api.auth.native_oauth_exchange_session_id",
            return_value="new-session",
        ),
        patch(
            "crate.api.auth._create_login_session",
            return_value=("jwt-token", {"id": "existing-session"}, "refresh-token"),
        ) as create_session,
        patch("crate.api.auth.secrets.token_urlsafe", return_value="new-session"),
        patch(
            "crate.api.auth._auth_login_payload",
            return_value={"token": "jwt-token"},
        ),
        patch(
            "crate.api.auth.complete_native_oauth_exchange",
            side_effect=NativeOAuthUnavailable("redis unavailable"),
        ),
        patch("crate.api.auth.revoke_session") as revoke_session,
        patch("crate.api.auth.restore_native_oauth_handoff") as restore_handoff,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            native_oauth_exchange(_request(app_id="listen-tauri"), body)

    assert exc_info.value.status_code == 503
    create_session.assert_called_once_with(
        user,
        ANY,
        app_id="listen-tauri",
        session_id="new-session",
    )
    revoke_session.assert_not_called()
    restore_handoff.assert_called_once_with(code=body.code, handoff=handoff)


def test_native_exchange_does_not_revoke_when_result_write_is_ambiguous() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import (
        NativeOAuthCompletionUnknown,
        NativeOAuthHandoff,
    )
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token-value",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    user = {
        "id": 7,
        "email": "user@example.com",
        "role": "user",
        "status": "active",
    }
    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value=None,
        ),
        patch(
            "crate.api.auth.consume_native_oauth_handoff",
            return_value=handoff,
        ),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login"),
        patch("crate.api.auth.get_session", return_value=None),
        patch(
            "crate.api.auth.native_oauth_exchange_session_id",
            return_value="new-session",
        ),
        patch(
            "crate.api.auth._create_login_session",
            return_value=("jwt-token", {"id": "new-session"}, "refresh-token"),
        ),
        patch("crate.api.auth.secrets.token_urlsafe", return_value="new-session"),
        patch(
            "crate.api.auth._auth_login_payload",
            return_value={"token": "jwt-token"},
        ),
        patch(
            "crate.api.auth.complete_native_oauth_exchange",
            side_effect=NativeOAuthCompletionUnknown("redis response lost"),
        ),
        patch("crate.api.auth.revoke_session") as revoke_session,
        patch("crate.api.auth.restore_native_oauth_handoff") as restore_handoff,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            native_oauth_exchange(_request(app_id="listen-tauri"), body)

    assert exc_info.value.status_code == 503
    revoke_session.assert_not_called()
    restore_handoff.assert_called_once_with(code=body.code, handoff=handoff)


def test_native_exchange_reuses_session_after_ambiguous_result_write() -> None:
    from crate.api.auth import native_oauth_exchange
    from crate.api.native_oauth import (
        NativeOAuthCompletionUnknown,
        NativeOAuthHandoff,
    )
    from crate.api.schemas.auth import NativeOAuthExchangeRequest

    handoff = NativeOAuthHandoff(
        user_id=7,
        app_id="listen-tauri",
        state="state-token-value",
        challenge="challenge",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    body = NativeOAuthExchangeRequest(
        code="handoff-code-token",
        code_verifier="v" * 43,
        state="state-token-value",
    )
    user = {
        "id": 7,
        "email": "user@example.com",
        "role": "user",
        "status": "active",
    }
    requested_session_ids: list[str] = []

    def create_login_session(*_args, session_id: str, **_kwargs):
        requested_session_ids.append(session_id)
        return (
            f"jwt-{session_id}",
            {"id": session_id},
            f"refresh-{session_id}",
        )

    with (
        patch(
            "crate.api.auth.get_completed_native_oauth_exchange",
            return_value=None,
        ),
        patch(
            "crate.api.auth.consume_native_oauth_handoff",
            return_value=handoff,
        ),
        patch("crate.api.auth.get_user_by_id", return_value=user),
        patch("crate.api.auth.update_user_last_login"),
        patch(
            "crate.api.auth.get_session",
            side_effect=[None, {"id": "already-created"}],
        ),
        patch(
            "crate.api.auth._create_login_session",
            side_effect=create_login_session,
        ),
        patch(
            "crate.api.auth._auth_login_payload",
            side_effect=lambda _user, token, _session, _refresh: {"token": token},
        ),
        patch(
            "crate.api.auth.complete_native_oauth_exchange",
            side_effect=[
                NativeOAuthCompletionUnknown("redis response lost"),
                None,
            ],
        ),
        patch("crate.api.auth.restore_native_oauth_handoff") as restore_handoff,
        patch("crate.api.auth.revoke_session") as revoke_session,
        patch.dict(
            "os.environ",
            {"NATIVE_OAUTH_EXCHANGE_ENABLED": "true"},
            clear=False,
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            native_oauth_exchange(_request(app_id="listen-tauri"), body)
        payload = native_oauth_exchange(_request(app_id="listen-tauri"), body)

    assert exc_info.value.status_code == 503
    assert payload["token"].startswith("jwt-")
    assert requested_session_ids[0] == requested_session_ids[1]
    restore_handoff.assert_called_once_with(code=body.code, handoff=handoff)
    revoke_session.assert_not_called()
