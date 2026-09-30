from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _isolated_link_store():
    from crate.api import native_oauth_link

    native_oauth_link._memory_links.clear()
    with (
        patch.object(native_oauth_link, "_redis_client", return_value=None),
        patch.dict("os.environ", {"CRATE_ENV": "test"}, clear=False),
    ):
        yield
    native_oauth_link._memory_links.clear()


def _issue_link():
    from crate.api import native_oauth_link

    verifier = "v" * 64
    code = native_oauth_link.issue_link_handoff(
        user_id=7,
        session_id="session-7",
        provider="google",
        external_user_id="provider-user-7",
        external_username="diego@example.test",
        app_id="listen-tauri",
        state="s" * 43,
        challenge=native_oauth_link._pkce_challenge(verifier),
    )
    return code, verifier


def _claim(code: str, verifier: str, *, session_id: str = "session-7"):
    from crate.api import native_oauth_link

    return native_oauth_link.claim_link_handoff(
        code=code,
        state="s" * 43,
        verifier=verifier,
        app_id="listen-tauri",
        user_id=7,
        session_id=session_id,
    )


def test_memory_fallback_fails_closed_in_production(monkeypatch) -> None:
    from crate.api.native_oauth_link import (
        NativeOAuthLinkUnavailable,
        issue_link_handoff,
    )

    monkeypatch.setenv("CRATE_ENV", "production")
    monkeypatch.setenv("DOMAIN", "localhost")

    with pytest.raises(NativeOAuthLinkUnavailable):
        issue_link_handoff(
            user_id=7,
            session_id="session-7",
            provider="google",
            external_user_id="provider-user-7",
            external_username=None,
            app_id="listen-tauri",
            state="s" * 43,
            challenge="c" * 43,
        )


def test_native_oauth_link_handoff_is_pkce_and_session_bound() -> None:
    code, verifier = _issue_link()

    from crate.api.native_oauth_link import InvalidNativeOAuthLink

    with pytest.raises(InvalidNativeOAuthLink, match="binding is invalid"):
        _claim(code, verifier, session_id="another-session")

    status, handoff = _claim(code, verifier)
    assert status == "claimed"
    assert handoff.user_id == 7
    assert handoff.session_id == "session-7"
    assert handoff.provider == "google"
    assert handoff.external_user_id == "provider-user-7"


def test_native_oauth_link_claim_is_single_use_but_completion_is_idempotent() -> None:
    from crate.api import native_oauth_link

    code, verifier = _issue_link()
    first_status, handoff = _claim(code, verifier)
    second_status, second_handoff = _claim(code, verifier)
    assert first_status == "claimed"
    assert second_status == "in_progress"
    assert second_handoff == handoff

    native_oauth_link.complete_link_handoff(code=code, handoff=handoff)
    completed_status, completed_handoff = _claim(code, verifier)
    assert completed_status == "completed"
    assert completed_handoff == handoff


def test_native_oauth_link_claim_can_retry_after_claim_lease_expires(
    monkeypatch,
) -> None:
    from crate.api import native_oauth_link

    now = [100.0]
    monkeypatch.setattr(native_oauth_link, "_claim_now", lambda: now[0])
    code, verifier = _issue_link()

    first_status, handoff = _claim(code, verifier)
    second_status, _pending_handoff = _claim(code, verifier)
    assert first_status == "claimed"
    assert second_status == "in_progress"

    now[0] += native_oauth_link.NATIVE_OAUTH_LINK_CLAIM_TTL_SECONDS + 1
    retry_status, retry_handoff = _claim(code, verifier)

    assert retry_status == "claimed"
    assert retry_handoff == handoff


def test_invalid_native_oauth_link_proof_does_not_consume_valid_handoff() -> None:
    from crate.api import native_oauth_link

    code, verifier = _issue_link()

    with pytest.raises(native_oauth_link.InvalidNativeOAuthLink):
        native_oauth_link.claim_link_handoff(
            code=code,
            state="wrong-state-0123456789",
            verifier=verifier,
            app_id="listen-tauri",
            user_id=7,
            session_id="session-7",
        )

    status, _handoff = _claim(code, verifier)
    assert status == "claimed"


def test_expired_native_oauth_link_is_rejected() -> None:
    from crate.api import native_oauth_link

    code = "expired-link-code"
    expired = native_oauth_link.NativeOAuthLinkHandoff(
        user_id=7,
        session_id="session-7",
        provider="google",
        external_user_id="provider-user-7",
        external_username=None,
        app_id="listen-tauri",
        state="s" * 43,
        challenge=native_oauth_link._pkce_challenge("v" * 64),
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    native_oauth_link._memory_links[native_oauth_link.link_handoff_key(code)] = (
        native_oauth_link._serialize(expired)
    )

    with pytest.raises(native_oauth_link.InvalidNativeOAuthLink):
        _claim(code, "v" * 64)
