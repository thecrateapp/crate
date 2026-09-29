"""Tests for short-lived native Last.fm authorization flows."""

import base64
import hashlib
import os
from unittest.mock import patch

import pytest


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@pytest.fixture(autouse=True)
def isolated_store():
    from crate.api import native_lastfm_link

    native_lastfm_link._memory_links.clear()
    with (
        patch.object(native_lastfm_link, "_redis_client", return_value=None),
        patch.dict(os.environ, {"CRATE_ENV": "test"}, clear=False),
    ):
        yield
    native_lastfm_link._memory_links.clear()


def _issue():
    from crate.api.native_lastfm_link import issue_link_handoff

    verifier = "v" * 64
    state = "s" * 43
    code = issue_link_handoff(
        user_id=7,
        session_id="session-7",
        state=state,
        challenge=_challenge(verifier),
        provider_token="lastfm-provider-token",
    )
    return code, state, verifier


def test_native_lastfm_handoff_stores_only_a_digest_of_the_opaque_code():
    from crate.api import native_lastfm_link
    from crate.api.native_lastfm_link import link_handoff_key

    code, _state, _verifier = _issue()
    stored_keys = tuple(native_lastfm_link._memory_links)

    assert code not in link_handoff_key(code)
    assert stored_keys == (link_handoff_key(code),)


def test_native_lastfm_handoff_binds_state_verifier_user_and_session():
    from crate.api.native_lastfm_link import (
        InvalidNativeLastfmLink,
        claim_link_handoff,
    )

    code, state, verifier = _issue()

    with pytest.raises(InvalidNativeLastfmLink):
        claim_link_handoff(
            code=code,
            state="x" * 43,
            verifier=verifier,
            user_id=7,
            session_id="session-7",
        )

    with pytest.raises(InvalidNativeLastfmLink):
        claim_link_handoff(
            code=code,
            state=state,
            verifier="x" * 64,
            user_id=7,
            session_id="session-7",
        )

    _status, handoff = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )

    assert handoff.provider_token == "lastfm-provider-token"


def test_native_lastfm_handoff_persists_resolved_session_for_retry_and_replay():
    from crate.api.native_lastfm_link import (
        claim_link_handoff,
        complete_link_handoff,
        save_resolved_session,
    )

    code, state, verifier = _issue()
    _status, handoff = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )
    resolved = save_resolved_session(
        code=code,
        handoff=handoff,
        session_key="lastfm-session-key",
        username="diego",
        subscriber=False,
    )
    complete_link_handoff(code=code, handoff=resolved)

    status, replay = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )

    assert status == "completed"
    assert replay.username == "diego"
    assert replay.session_key is None


def test_native_lastfm_handoff_can_restore_resolved_session_after_store_failure():
    from crate.api.native_lastfm_link import (
        claim_link_handoff,
        restore_link_handoff,
        save_resolved_session,
    )

    code, state, verifier = _issue()
    _status, handoff = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )
    resolved = save_resolved_session(
        code=code,
        handoff=handoff,
        session_key="lastfm-session-key",
        username="diego",
        subscriber=False,
    )
    restore_link_handoff(code=code, handoff=resolved)

    _status, retry = claim_link_handoff(
        code=code,
        state=state,
        verifier=verifier,
        user_id=7,
        session_id="session-7",
    )

    assert retry.session_key == "lastfm-session-key"
    assert retry.provider_token is None


def test_native_lastfm_handoff_rejects_other_user_or_session():
    from crate.api.native_lastfm_link import (
        InvalidNativeLastfmLink,
        claim_link_handoff,
    )

    code, state, verifier = _issue()

    with pytest.raises(InvalidNativeLastfmLink):
        claim_link_handoff(
            code=code,
            state=state,
            verifier=verifier,
            user_id=8,
            session_id="session-7",
        )
