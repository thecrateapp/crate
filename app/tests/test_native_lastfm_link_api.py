"""API contract tests for session-bound native Last.fm linking."""

import base64
import hashlib
import re

import pytest
from fastapi import HTTPException, Request


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _request(*, user_id: int = 7, session_id: str = "session-7") -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/me/scrobble/lastfm/native/start",
            "query_string": b"",
            "headers": [
                (b"x-crate-app", b"listen-tauri"),
                (b"authorization", b"Bearer access-token"),
            ],
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


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch):
    from crate.api import native_lastfm_link

    native_lastfm_link._memory_links.clear()
    monkeypatch.setattr(native_lastfm_link, "_redis_client", lambda: None)
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.setenv("NATIVE_OAUTH_EXCHANGE_ENABLED", "1")
    monkeypatch.setenv("LASTFM_APIKEY", "api-key")
    monkeypatch.setenv("LASTFM_API_SECRET", "api-secret")
    monkeypatch.setattr(
        "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
        lambda _user_id, _session_id: True,
    )
    yield
    native_lastfm_link._memory_links.clear()


def test_start_returns_browser_authorization_url_and_opaque_flow_id(monkeypatch):
    from crate.api.me import native_lastfm_link_start
    from crate.api.schemas.me import NativeLastfmLinkStartRequest

    verifier = "v" * 64
    monkeypatch.setattr("crate.scrobble.lastfm_get_auth_token", lambda *_args: "a" * 32)

    response = native_lastfm_link_start(
        _request(),
        NativeLastfmLinkStartRequest(
            code_challenge=_challenge(verifier),
            state="s" * 43,
        ),
    )

    assert response["authorization_url"].startswith("https://www.last.fm/api/auth/?")
    assert "api_key=api-key" in response["authorization_url"]
    assert "token=" + "a" * 32 in response["authorization_url"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", response["flow_id"])
    assert "provider_token" not in response


def test_start_rejects_missing_feature_flag_or_session(monkeypatch):
    from crate.api.me import native_lastfm_link_start
    from crate.api.schemas.me import NativeLastfmLinkStartRequest

    monkeypatch.setenv("NATIVE_OAUTH_EXCHANGE_ENABLED", "0")
    with pytest.raises(HTTPException) as disabled:
        native_lastfm_link_start(
            _request(),
            NativeLastfmLinkStartRequest(
                code_challenge="c" * 43,
                state="s" * 43,
            ),
        )
    assert disabled.value.status_code == 503

    monkeypatch.setenv("NATIVE_OAUTH_EXCHANGE_ENABLED", "1")
    monkeypatch.setattr(
        "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
        lambda _user_id, _session_id: False,
    )
    with pytest.raises(HTTPException) as expired:
        native_lastfm_link_start(
            _request(),
            NativeLastfmLinkStartRequest(
                code_challenge="c" * 43,
                state="s" * 43,
            ),
        )
    assert expired.value.status_code == 401


def test_complete_exchanges_token_and_stores_session_only_on_server(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    exchanged = []
    stored = []
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict",
        lambda *_args: (
            exchanged.append(True)
            or LastfmSession(
                key="lastfm-session-key",
                username="diego",
                subscriber=False,
            )
        ),
    )
    monkeypatch.setattr(
        "crate.api.me.get_user_by_external_identity", lambda *_args: None
    )
    monkeypatch.setattr("crate.api.me.get_user_external_identity", lambda *_args: None)
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity",
        lambda **kwargs: stored.append(kwargs),
    )

    response = native_lastfm_link_complete(
        _request(),
        NativeLastfmLinkCompleteRequest(
            flow_id=code,
            state=state,
            code_verifier=verifier,
        ),
    )

    assert response == {"ok": True, "username": "diego"}
    assert exchanged == [True]
    assert stored[0]["provider"] == "lastfm"
    assert stored[0]["external_user_id"] == "diego"
    assert stored[0]["metadata"]["session_key"] == "lastfm-session-key"


def test_complete_replay_is_idempotent_and_does_not_exchange_token_again(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import (
        complete_link_handoff,
        claim_link_handoff,
        issue_link_handoff,
        save_resolved_session,
    )
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    _status, handoff = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )
    handoff = save_resolved_session(
        code=code,
        handoff=handoff,
        session_key="lastfm-session-key",
        username="diego",
        subscriber=False,
    )
    complete_link_handoff(code=code, handoff=handoff)
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict", lambda *_args: pytest.fail()
    )
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity", lambda **_kwargs: pytest.fail()
    )

    response = native_lastfm_link_complete(
        _request(),
        NativeLastfmLinkCompleteRequest(
            flow_id=code,
            state=state,
            code_verifier=verifier,
        ),
    )

    assert response == {"ok": True, "username": "diego"}


def test_complete_rejects_other_session_without_mutating_identity(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity", lambda **_kwargs: pytest.fail()
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(
            _request(session_id="other-session"),
            NativeLastfmLinkCompleteRequest(
                flow_id=code,
                state=state,
                code_verifier=verifier,
            ),
        )

    assert exc_info.value.status_code == 401


def test_complete_preserves_resolved_session_for_database_retry(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    exchanges = []
    upserts = []
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict",
        lambda *_args: (
            exchanges.append(True)
            or LastfmSession(key="lastfm-session-key", username="diego")
        ),
    )

    def fail_once(**_kwargs):
        upserts.append(True)
        if len(upserts) == 1:
            raise RuntimeError("database temporarily unavailable")

    monkeypatch.setattr(
        "crate.api.me.get_user_by_external_identity", lambda *_args: None
    )
    monkeypatch.setattr("crate.api.me.get_user_external_identity", lambda *_args: None)
    monkeypatch.setattr("crate.api.me.upsert_user_external_identity", fail_once)
    body = NativeLastfmLinkCompleteRequest(
        flow_id=code,
        state=state,
        code_verifier=verifier,
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(_request(), body)
    assert exc_info.value.status_code == 500

    response = native_lastfm_link_complete(_request(), body)

    assert response == {"ok": True, "username": "diego"}
    assert exchanges == [True]
    assert upserts == [True, True]


def test_complete_rejects_revoked_session_without_mutating_identity(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    monkeypatch.setattr(
        "crate.api.native_oauth_auth.native_oauth_link_session_is_valid",
        lambda _user_id, _session_id: False,
    )
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity", lambda **_kwargs: pytest.fail()
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(
            _request(),
            NativeLastfmLinkCompleteRequest(
                flow_id=code,
                state=state,
                code_verifier=verifier,
            ),
        )

    assert exc_info.value.status_code == 401


def test_complete_keeps_unapproved_token_for_retry(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmAuthenticationError, LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    exchanges = []

    def exchange(*_args):
        exchanges.append(True)
        if len(exchanges) == 1:
            raise LastfmAuthenticationError(retryable=True)
        return LastfmSession(key="lastfm-session-key", username="diego")

    monkeypatch.setattr("crate.scrobble.lastfm_get_session_strict", exchange)
    monkeypatch.setattr(
        "crate.api.me.get_user_by_external_identity", lambda *_args: None
    )
    monkeypatch.setattr("crate.api.me.get_user_external_identity", lambda *_args: None)
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity", lambda **_kwargs: None
    )
    body = NativeLastfmLinkCompleteRequest(
        flow_id=code,
        state=state,
        code_verifier=verifier,
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(_request(), body)
    assert exc_info.value.status_code == 503

    response = native_lastfm_link_complete(_request(), body)

    assert response == {"ok": True, "username": "diego"}
    assert exchanges == [True, True]


def test_complete_discards_an_expired_lastfm_token(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmAuthenticationError

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )

    def expired(*_args):
        raise LastfmAuthenticationError(retryable=False)

    monkeypatch.setattr("crate.scrobble.lastfm_get_session_strict", expired)
    body = NativeLastfmLinkCompleteRequest(
        flow_id=code,
        state=state,
        code_verifier=verifier,
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(_request(), body)
    assert exc_info.value.status_code == 400

    with pytest.raises(HTTPException) as consumed:
        native_lastfm_link_complete(_request(), body)
    assert consumed.value.status_code == 401


def test_complete_rejects_lastfm_identity_already_linked_to_another_user(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict",
        lambda *_args: LastfmSession(
            key="lastfm-session-key",
            username="already-linked",
        ),
    )
    monkeypatch.setattr(
        "crate.api.me.get_user_by_external_identity",
        lambda *_args: {"id": 8},
    )
    monkeypatch.setattr(
        "crate.api.me.upsert_user_external_identity", lambda **_kwargs: pytest.fail()
    )

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(
            _request(),
            NativeLastfmLinkCompleteRequest(
                flow_id=code,
                state=state,
                code_verifier=verifier,
            ),
        )

    assert exc_info.value.status_code == 409


def test_cancel_discards_only_the_matching_native_flow():
    from crate.api.me import native_lastfm_link_cancel, native_lastfm_link_complete
    from crate.api.native_lastfm_link import issue_link_handoff
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    body = NativeLastfmLinkCompleteRequest(
        flow_id=code,
        state=state,
        code_verifier=verifier,
    )

    assert native_lastfm_link_cancel(_request(), body) == {"ok": True}
    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(_request(), body)
    assert exc_info.value.status_code == 401


def test_cancel_after_completion_preserves_idempotent_result():
    from crate.api.me import native_lastfm_link_cancel, native_lastfm_link_complete
    from crate.api.native_lastfm_link import (
        claim_link_handoff,
        complete_link_handoff,
        issue_link_handoff,
        save_resolved_session,
    )
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    _status, handoff = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )
    handoff = save_resolved_session(
        code=code,
        handoff=handoff,
        session_key="lastfm-session-key",
        username="diego",
        subscriber=False,
    )
    complete_link_handoff(code=code, handoff=handoff)
    body = NativeLastfmLinkCompleteRequest(
        flow_id=code,
        state=state,
        code_verifier=verifier,
    )

    assert native_lastfm_link_cancel(_request(), body) == {"ok": True}
    assert native_lastfm_link_complete(_request(), body) == {
        "ok": True,
        "username": "diego",
    }


def test_complete_maps_cleanup_store_failure_to_service_unavailable(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import (
        NativeLastfmLinkUnavailable,
        issue_link_handoff,
    )
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict",
        lambda *_args: LastfmSession(key="lastfm-session-key", username="diego"),
    )

    def reject_link(**_kwargs):
        raise HTTPException(status_code=409, detail="identity conflict")

    def fail_cleanup(*_args, **_kwargs):
        raise NativeLastfmLinkUnavailable("Redis unavailable")

    monkeypatch.setattr("crate.api.me._apply_native_lastfm_link", reject_link)
    monkeypatch.setattr("crate.api.me.discard_native_lastfm_link_handoff", fail_cleanup)

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(
            _request(),
            NativeLastfmLinkCompleteRequest(
                flow_id=code,
                state=state,
                code_verifier=verifier,
            ),
        )

    assert exc_info.value.status_code == 503


def test_complete_maps_restore_store_failure_to_service_unavailable(monkeypatch):
    from crate.api.me import native_lastfm_link_complete
    from crate.api.native_lastfm_link import (
        NativeLastfmLinkUnavailable,
        issue_link_handoff,
    )
    from crate.api.schemas.me import NativeLastfmLinkCompleteRequest
    from crate.scrobble import LastfmSession

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="a" * 32,
    )
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session_strict",
        lambda *_args: LastfmSession(key="lastfm-session-key", username="diego"),
    )

    def fail_link(**_kwargs):
        raise HTTPException(status_code=500, detail="database unavailable")

    def fail_cleanup(*_args, **_kwargs):
        raise NativeLastfmLinkUnavailable("Redis unavailable")

    monkeypatch.setattr("crate.api.me._apply_native_lastfm_link", fail_link)
    monkeypatch.setattr("crate.api.me.restore_native_lastfm_link_handoff", fail_cleanup)

    with pytest.raises(HTTPException) as exc_info:
        native_lastfm_link_complete(
            _request(),
            NativeLastfmLinkCompleteRequest(
                flow_id=code,
                state=state,
                code_verifier=verifier,
            ),
        )

    assert exc_info.value.status_code == 503
