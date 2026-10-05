"""API contract tests for session-bound native OAuth account linking."""

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import Request


class TestNativeOAuthLinkApi:
    @pytest.fixture(autouse=True)
    def _isolated_link_store(self):
        from crate.api import native_oauth_link

        native_oauth_link._memory_links.clear()
        with (
            patch.object(native_oauth_link, "_redis_client", return_value=None),
            patch.dict("os.environ", {"CRATE_ENV": "test"}, clear=False),
        ):
            yield
        native_oauth_link._memory_links.clear()

    @staticmethod
    def _request(
        *,
        session_id: str = "session-7",
        user_id: int = 7,
        bearer: str | None = "access-token",
        app_id: str = "listen-tauri",
    ) -> Request:
        headers = [(b"x-crate-app", app_id.encode())]
        if bearer is not None:
            headers.append((b"authorization", f"Bearer {bearer}".encode()))
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/auth/oauth/google/native-link/start",
                "query_string": b"",
                "headers": headers,
                "client": ("127.0.0.1", 12345),
                "scheme": "https",
                "server": ("api.example.com", 443),
            }
        )
        request.state.user = {
            "id": user_id,
            "email": "target@example.test",
            "role": "user",
            "status": "active",
            "session_id": session_id,
        }
        return request

    @staticmethod
    def _active_session(session_id: str = "session-7", user_id: int = 7) -> dict:
        return {
            "id": session_id,
            "user_id": user_id,
            "revoked_at": None,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }

    def test_start_binds_native_link_state_to_user_and_session(self):
        from urllib.parse import parse_qs, urlparse

        from crate.api.auth import native_oauth_link_start
        from crate.api.schemas.auth import NativeOAuthLinkStartRequest

        captured_state: dict[str, Any] = {}
        request = self._request()
        with (
            patch(
                "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
                return_value=True,
            ),
            patch("crate.api.auth._provider_available", return_value=True),
            patch(
                "crate.api.auth._build_oauth_state",
                side_effect=lambda **kwargs: (
                    captured_state.update(kwargs) or "signed-state"
                ),
            ),
            patch(
                "crate.api.auth._parse_oauth_state",
                return_value={"verifier": "provider-verifier"},
            ),
            patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "google-client"}),
        ):
            response = native_oauth_link_start(
                request,
                "google",
                NativeOAuthLinkStartRequest(
                    native_code_challenge="c" * 43,
                    native_state="s" * 43,
                ),
            )

        assert response["provider"] == "google"
        assert response["login_url"].startswith(
            "https://accounts.google.com/o/oauth2/v2/auth?"
        )
        query = parse_qs(urlparse(response["login_url"]).query)
        assert query["prompt"] == ["select_account"]
        assert "access_type" not in query
        assert captured_state["mode"] == "native_link"
        assert captured_state["user_id"] == 7
        assert captured_state["session_id"] == "session-7"
        assert captured_state["native_code_challenge"] == "c" * 43
        assert captured_state["native_state"] == "s" * 43
        assert captured_state["return_to"] == "cratemusic://oauth/link-callback"

    def test_start_requires_bearer_authentication(self):
        from crate.api.auth import native_oauth_link_start
        from crate.api.schemas.auth import NativeOAuthLinkStartRequest
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            native_oauth_link_start(
                self._request(bearer=None),
                "google",
                NativeOAuthLinkStartRequest(
                    native_code_challenge="c" * 43,
                    native_state="s" * 43,
                ),
            )

        assert exc_info.value.status_code == 401

    def test_start_rejects_other_native_app_ids(self):
        from fastapi import HTTPException

        from crate.api.auth import native_oauth_link_start
        from crate.api.schemas.auth import NativeOAuthLinkStartRequest

        with pytest.raises(HTTPException) as exc_info:
            native_oauth_link_start(
                self._request(app_id="listen-android"),
                "google",
                NativeOAuthLinkStartRequest(
                    native_code_challenge="c" * 43,
                    native_state="s" * 43,
                ),
            )

        assert exc_info.value.status_code == 400

    def test_completion_rejects_other_native_app_ids(self):
        from fastapi import HTTPException

        from crate.api.auth import native_oauth_link_complete
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest

        with pytest.raises(HTTPException) as exc_info:
            native_oauth_link_complete(
                self._request(app_id="listen-android"),
                NativeOAuthLinkCompleteRequest(
                    code="handoff-code-token",
                    code_verifier="v" * 64,
                    state="s" * 43,
                ),
            )

        assert exc_info.value.status_code == 400

    def test_callback_stages_provider_identity_without_linking_it(self):
        from crate.api.auth import oauth_callback

        request = self._request()
        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/link-callback",
            "mode": "native_link",
            "verifier": "provider-verifier",
            "user_id": 7,
            "session_id": "session-7",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._clear_failed_login"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch(
                "crate.api.auth._google_userinfo",
                return_value={
                    "id": "google-subject-7",
                    "email": "linked@example.test",
                    "name": "Linked Name",
                    "picture": "https://example.test/avatar.jpg",
                },
            ),
            patch(
                "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
                return_value=True,
            ),
            patch("crate.api.auth.get_user_by_id", return_value={"id": 7}),
            patch(
                "crate.api.auth.issue_native_oauth_link_handoff",
                return_value="opaque-link-code",
            ) as issue_handoff,
            patch("crate.api.auth.get_user_by_external_identity") as find_identity,
            patch("crate.api.auth.upsert_user_external_identity") as upsert_identity,
            patch("crate.api.auth.update_user") as update_user,
            patch("crate.api.auth.update_user_last_login") as update_last_login,
        ):
            response = oauth_callback(
                request,
                "google",
                code="provider-code",
                state="signed-state",
            )

        assert response.headers["location"] == (
            "cratemusic://oauth/link-callback?code=opaque-link-code&state=" + "s" * 43
        )
        assert "linked@example.test" not in response.headers["location"]
        issue_handoff.assert_called_once_with(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state="s" * 43,
            challenge="c" * 43,
        )
        find_identity.assert_not_called()
        upsert_identity.assert_not_called()
        update_user.assert_not_called()
        update_last_login.assert_not_called()

    def test_callback_rejects_revoked_initiating_session(self):
        from crate.api.auth import oauth_callback
        from fastapi import HTTPException

        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/link-callback",
            "mode": "native_link",
            "verifier": "provider-verifier",
            "user_id": 7,
            "session_id": "session-7",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch("crate.api.auth._google_userinfo", return_value={"id": "g-7"}),
            patch("crate.api.auth.get_user_by_id", return_value={"id": 7}),
            patch(
                "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
                return_value=False,
            ),
            patch("crate.api.auth.issue_native_oauth_link_handoff") as issue_handoff,
            pytest.raises(HTTPException) as exc_info,
        ):
            oauth_callback(
                self._request(),
                "google",
                code="provider-code",
                state="signed-state",
            )

        assert exc_info.value.status_code == 401
        issue_handoff.assert_not_called()

    def test_provider_denial_returns_only_native_link_state_to_the_app(self):
        from crate.api.auth import oauth_callback

        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/link-callback",
            "mode": "native_link",
            "verifier": "provider-verifier",
            "user_id": 7,
            "session_id": "session-7",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch("crate.api.auth._google_userinfo") as exchange_provider,
            patch("crate.api.auth.issue_native_oauth_link_handoff") as issue_handoff,
        ):
            response = oauth_callback(
                self._request(),
                "google",
                state="signed-state",
                error="access_denied",
            )

        assert response.headers["location"] == (
            "cratemusic://oauth/link-callback?state=" + "s" * 43 + "&error=cancelled"
        )
        exchange_provider.assert_not_called()
        issue_handoff.assert_not_called()

    def test_native_link_provider_failure_is_not_reported_as_cancellation(self):
        from crate.api.auth import oauth_callback

        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/link-callback",
            "mode": "native_link",
            "verifier": "provider-verifier",
            "user_id": 7,
            "session_id": "session-7",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch("crate.api.auth._google_userinfo") as exchange_provider,
        ):
            response = oauth_callback(
                self._request(),
                "google",
                state="signed-state",
                error="temporarily_unavailable",
            )

        assert response.headers["location"].endswith(
            f"state={'s' * 43}&error=provider_error"
        )
        exchange_provider.assert_not_called()

    def test_native_login_provider_denial_returns_to_the_app(self):
        from crate.api.auth import oauth_callback

        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/callback",
            "mode": "login",
            "verifier": "provider-verifier",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch(
                "crate.api.native_oauth_auth.native_oauth_exchange_enabled",
                return_value=True,
            ),
            patch("crate.api.auth._google_userinfo") as exchange_provider,
        ):
            response = oauth_callback(
                self._request(),
                "google",
                state="signed-state",
                error="access_denied",
            )

        assert response.headers["location"] == (
            "cratemusic://oauth/callback?state=" + "s" * 43 + "&error=cancelled"
        )
        exchange_provider.assert_not_called()

    @pytest.mark.parametrize(
        "provider_error", ["server_error", "temporarily_unavailable"]
    )
    def test_native_login_provider_failure_is_not_reported_as_cancellation(
        self, provider_error: str
    ):
        from crate.api.auth import oauth_callback

        state = {
            "provider": "google",
            "return_to": "cratemusic://oauth/callback",
            "mode": "login",
            "verifier": "provider-verifier",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch(
                "crate.api.native_oauth_auth.native_oauth_exchange_enabled",
                return_value=True,
            ),
            patch("crate.api.auth._google_userinfo") as exchange_provider,
        ):
            response = oauth_callback(
                self._request(),
                "google",
                state="signed-state",
                error=provider_error,
            )

        assert response.headers["location"].endswith(
            f"state={'s' * 43}&error=provider_error"
        )
        exchange_provider.assert_not_called()

    def test_apple_native_user_cancellation_remains_a_cancellation(self):
        from crate.api.auth import oauth_callback

        state = {
            "provider": "apple",
            "return_to": "cratemusic://oauth/callback",
            "mode": "login",
            "verifier": "provider-verifier",
            "app_id": "listen-tauri",
            "native_code_challenge": "c" * 43,
            "native_state": "s" * 43,
        }
        with (
            patch("crate.api.auth._enforce_login_rate_limit"),
            patch("crate.api.auth._parse_oauth_state", return_value=state),
            patch(
                "crate.api.native_oauth_auth.native_oauth_exchange_enabled",
                return_value=True,
            ),
            patch("crate.api.auth._apple_userinfo") as exchange_provider,
        ):
            response = oauth_callback(
                self._request(),
                "apple",
                state="signed-state",
                error="user_cancelled_authorize",
            )

        assert response.headers["location"] == (
            "cratemusic://oauth/callback?state=" + "s" * 43 + "&error=cancelled"
        )
        exchange_provider.assert_not_called()

    def test_completion_rejects_another_session_for_the_same_user(self):
        from crate.api import native_oauth_link
        from crate.api.auth import _pkce_challenge, native_oauth_link_complete
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        verifier = "v" * 64
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state="s" * 43,
            challenge=_pkce_challenge(verifier),
        )
        request = self._request(session_id="session-8")
        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session("session-8"),
            ),
            patch("crate.api.auth._apply_native_oauth_link") as apply_link,
            pytest.raises(HTTPException) as exc_info,
        ):
            native_oauth_link_complete(
                request,
                NativeOAuthLinkCompleteRequest(
                    code=code,
                    code_verifier=verifier,
                    state="s" * 43,
                ),
            )

        assert exc_info.value.status_code == 401
        apply_link.assert_not_called()

    def test_completion_rejects_session_revoked_after_provider_callback(self):
        from crate.api.auth import native_oauth_link_complete
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        request = self._request()
        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value={
                    **self._active_session(),
                    "revoked_at": datetime.now(timezone.utc),
                },
            ),
            patch("crate.api.auth.claim_native_oauth_link_handoff") as claim,
            patch("crate.api.auth._apply_native_oauth_link") as apply_link,
            pytest.raises(HTTPException) as exc_info,
        ):
            native_oauth_link_complete(
                request,
                NativeOAuthLinkCompleteRequest(
                    code="opaque-link-code-123456",
                    code_verifier="v" * 64,
                    state="s" * 43,
                ),
            )

        assert exc_info.value.status_code == 401
        claim.assert_not_called()
        apply_link.assert_not_called()

    def test_completion_is_idempotent_for_same_session_after_token_refresh(self):
        from crate.api import native_oauth_link
        from crate.api.auth import _pkce_challenge, native_oauth_link_complete
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest

        verifier = "v" * 64
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state="s" * 43,
            challenge=_pkce_challenge(verifier),
        )
        body = NativeOAuthLinkCompleteRequest(
            code=code,
            code_verifier=verifier,
            state="s" * 43,
        )
        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch(
                "crate.api.auth.get_user_by_id",
                return_value={"id": 7, "status": "active", "google_id": None},
            ),
            patch("crate.api.auth.get_user_by_external_identity", return_value=None),
            patch("crate.api.auth.get_user_external_identity", return_value=None),
            patch("crate.api.auth.get_user_by_google_id", return_value=None),
            patch("crate.api.auth.link_oauth_user_identity") as link_identity,
        ):
            first = native_oauth_link_complete(
                self._request(bearer="old-access-token"), body
            )
            second = native_oauth_link_complete(
                self._request(bearer="refreshed-access-token"), body
            )

        assert first == {"ok": True}
        assert second == {"ok": True}
        link_identity.assert_called_once_with(
            7,
            "google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            status="linked",
            last_error=None,
            metadata={"email": "linked@example.test"},
            legacy_google_id="google-subject-7",
        )

    def test_google_link_rolls_back_identity_when_legacy_id_update_conflicts(
        self, pg_db
    ):
        from fastapi import HTTPException

        from crate.api.auth import _apply_native_oauth_link
        from crate.api.native_oauth_link import NativeOAuthLinkHandoff

        target_user = pg_db.create_user("native-oauth-link-target@test.com")
        conflicting_user = pg_db.create_user(
            "native-oauth-link-conflict@test.com",
            google_id="google-subject-raced",
        )
        handoff = NativeOAuthLinkHandoff(
            user_id=target_user["id"],
            session_id="session-target",
            provider="google",
            external_user_id="google-subject-raced",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state="s" * 43,
            challenge="c" * 43,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )

        with (
            patch(
                "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
                return_value=True,
            ),
            patch("crate.api.auth.get_user_by_google_id", return_value=None),
            pytest.raises(HTTPException) as exc_info,
        ):
            _apply_native_oauth_link(handoff)

        assert exc_info.value.status_code == 409
        assert pg_db.get_user_external_identity(target_user["id"], "google") is None
        assert pg_db.get_user_by_id(target_user["id"])["google_id"] is None
        assert (
            pg_db.get_user_by_id(conflicting_user["id"])["google_id"]
            == "google-subject-raced"
        )

    def test_completion_restores_claim_after_temporary_store_failure(self):
        from crate.api import native_oauth_link
        from crate.api.auth import _pkce_challenge, native_oauth_link_complete
        from crate.api.native_oauth_link import NativeOAuthLinkUnavailable
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        verifier = "v" * 64
        state = "s" * 43
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state=state,
            challenge=_pkce_challenge(verifier),
        )
        body = NativeOAuthLinkCompleteRequest(
            code=code,
            code_verifier=verifier,
            state=state,
        )
        complete = native_oauth_link.complete_link_handoff
        complete_attempts = 0

        def fail_once(*, code: str, handoff):
            nonlocal complete_attempts
            complete_attempts += 1
            if complete_attempts == 1:
                raise NativeOAuthLinkUnavailable("Redis unavailable")
            return complete(code=code, handoff=handoff)

        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch("crate.api.auth._apply_native_oauth_link"),
            patch(
                "crate.api.auth.complete_native_oauth_link_handoff",
                side_effect=fail_once,
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                native_oauth_link_complete(self._request(), body)

            assert exc_info.value.status_code == 503

            status, restored = native_oauth_link.claim_link_handoff(
                code=code,
                state=state,
                verifier=verifier,
                app_id="listen-tauri",
                user_id=7,
                session_id="session-7",
            )
            assert status == "claimed"
            native_oauth_link.restore_link_handoff(code=code, handoff=restored)

            assert native_oauth_link_complete(self._request(), body) == {"ok": True}

        assert complete_attempts == 2

    def test_completion_recovers_after_restore_also_fails(self, monkeypatch):
        from crate.api import native_oauth_link
        from crate.api.auth import _pkce_challenge, native_oauth_link_complete
        from crate.api.native_oauth_link import NativeOAuthLinkUnavailable
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        now = [100.0]
        monkeypatch.setattr(native_oauth_link, "_claim_now", lambda: now[0])
        verifier = "v" * 64
        state = "s" * 43
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state=state,
            challenge=_pkce_challenge(verifier),
        )
        body = NativeOAuthLinkCompleteRequest(
            code=code,
            code_verifier=verifier,
            state=state,
        )
        complete = native_oauth_link.complete_link_handoff
        complete_attempts = 0

        def fail_once(*, code: str, handoff):
            nonlocal complete_attempts
            complete_attempts += 1
            if complete_attempts == 1:
                raise NativeOAuthLinkUnavailable("Redis unavailable")
            return complete(code=code, handoff=handoff)

        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch("crate.api.auth._apply_native_oauth_link"),
            patch(
                "crate.api.auth.complete_native_oauth_link_handoff",
                side_effect=fail_once,
            ),
            patch(
                "crate.api.auth.restore_native_oauth_link_handoff",
                side_effect=NativeOAuthLinkUnavailable("Redis unavailable"),
            ),
        ):
            with pytest.raises(HTTPException) as first_error:
                native_oauth_link_complete(self._request(), body)
            assert first_error.value.status_code == 503

            with pytest.raises(HTTPException) as pending_error:
                native_oauth_link_complete(self._request(), body)
            assert pending_error.value.status_code == 503
            assert "already being completed" in pending_error.value.detail

            now[0] += native_oauth_link.NATIVE_OAUTH_LINK_CLAIM_TTL_SECONDS + 1
            assert native_oauth_link_complete(self._request(), body) == {"ok": True}

        assert complete_attempts == 2

    def test_completion_rejects_a_handoff_claimed_by_another_request(self):
        from crate.api import native_oauth_link
        from crate.api.auth import _pkce_challenge, native_oauth_link_complete
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        verifier = "v" * 64
        state = "s" * 43
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state=state,
            challenge=_pkce_challenge(verifier),
        )
        status, _handoff = native_oauth_link.claim_link_handoff(
            code=code,
            state=state,
            verifier=verifier,
            app_id="listen-tauri",
            user_id=7,
            session_id="session-7",
        )
        assert status == "claimed"

        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch("crate.api.auth._apply_native_oauth_link") as apply_link,
            patch(
                "crate.api.auth.complete_native_oauth_link_handoff"
            ) as complete_handoff,
            pytest.raises(HTTPException) as exc_info,
        ):
            native_oauth_link_complete(
                self._request(),
                NativeOAuthLinkCompleteRequest(
                    code=code,
                    code_verifier=verifier,
                    state=state,
                ),
            )

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail == "Native OAuth link is already being completed"
        apply_link.assert_not_called()
        complete_handoff.assert_not_called()

    def test_link_conflict_never_autolinks_by_email_or_mutates_identity(self):
        from crate.api.auth import _apply_native_oauth_link
        from crate.api.native_oauth_link import NativeOAuthLinkHandoff
        from fastapi import HTTPException

        handoff = NativeOAuthLinkHandoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="same-email@example.test",
            app_id="listen-tauri",
            state="s" * 43,
            challenge="c" * 43,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
        with (
            patch(
                "crate.api.auth.get_user_by_id",
                return_value={"id": 7, "status": "active", "google_id": None},
            ),
            patch(
                "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
                return_value=True,
            ),
            patch(
                "crate.api.auth.get_user_by_external_identity",
                return_value={"id": 8},
            ),
            patch("crate.api.auth.get_user_external_identity") as find_target_identity,
            patch("crate.api.auth.get_user_by_google_id") as find_legacy_identity,
            patch("crate.api.auth.get_user_by_email") as find_email,
            patch("crate.api.auth.upsert_user_external_identity") as upsert_identity,
            pytest.raises(HTTPException) as exc_info,
        ):
            _apply_native_oauth_link(handoff)

        assert exc_info.value.status_code == 409
        find_target_identity.assert_not_called()
        find_legacy_identity.assert_not_called()
        find_email.assert_not_called()
        upsert_identity.assert_not_called()

    def test_complete_maps_handoff_cleanup_failure_to_service_unavailable(self):
        from crate.api import native_oauth_link
        from crate.api.auth import native_oauth_link_complete
        from crate.api.native_oauth_link import NativeOAuthLinkUnavailable
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        verifier = "v" * 64
        state = "s" * 43
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state=state,
            challenge=native_oauth_link._pkce_challenge(verifier),
        )

        def reject_link(_handoff):
            raise HTTPException(status_code=409, detail="identity conflict")

        def fail_cleanup(*_args, **_kwargs):
            raise NativeOAuthLinkUnavailable("Redis unavailable")

        body = NativeOAuthLinkCompleteRequest(
            code=code,
            code_verifier=verifier,
            state=state,
        )
        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch("crate.api.auth._apply_native_oauth_link", reject_link),
            patch("crate.api.auth.discard_native_oauth_link_handoff", fail_cleanup),
            pytest.raises(HTTPException) as exc_info,
        ):
            native_oauth_link_complete(self._request(), body)

        assert exc_info.value.status_code == 503

    def test_complete_maps_handoff_restore_failure_to_service_unavailable(self):
        from crate.api import native_oauth_link
        from crate.api.auth import native_oauth_link_complete
        from crate.api.native_oauth_link import NativeOAuthLinkUnavailable
        from crate.api.schemas.auth import NativeOAuthLinkCompleteRequest
        from fastapi import HTTPException

        verifier = "v" * 64
        state = "s" * 43
        code = native_oauth_link.issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="google-subject-7",
            external_username="linked@example.test",
            app_id="listen-tauri",
            state=state,
            challenge=native_oauth_link._pkce_challenge(verifier),
        )

        def fail_link(_handoff):
            raise HTTPException(status_code=500, detail="database unavailable")

        def fail_cleanup(*_args, **_kwargs):
            raise NativeOAuthLinkUnavailable("Redis unavailable")

        body = NativeOAuthLinkCompleteRequest(
            code=code,
            code_verifier=verifier,
            state=state,
        )
        with (
            patch(
                "crate.api.native_oauth_auth.get_session",
                return_value=self._active_session(),
            ),
            patch("crate.api.auth._apply_native_oauth_link", fail_link),
            patch("crate.api.auth.restore_native_oauth_link_handoff", fail_cleanup),
            pytest.raises(HTTPException) as exc_info,
        ):
            native_oauth_link_complete(self._request(), body)

        assert exc_info.value.status_code == 503
