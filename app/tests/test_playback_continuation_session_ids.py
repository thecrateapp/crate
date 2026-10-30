"""Token descriptors validate both radio kinds before creating credentials."""

from datetime import UTC, datetime

import pytest
from crate.api import smart_mix

SESSION_ID = "123e4567-e89b-42d3-a456-426614174042"


@pytest.fixture
def issued_tokens(monkeypatch):
    issued = []
    monkeypatch.setattr(
        smart_mix,
        "_require_auth",
        lambda _request: {"id": 42, "session_id": "interactive-session"},
    )

    def issue(**kwargs):
        issued.append(kwargs)
        return {"token": "crv_test", "expires_at": datetime(2099, 1, 1, tzinfo=UTC)}

    monkeypatch.setattr(smart_mix, "issue_playback_continuation_token", issue)
    return issued


def _descriptor(kind, session_id):
    descriptor = {"kind": kind, "sessionId": session_id}
    if kind == "seeded_radio":
        descriptor.update(seedType="album", seedId="12")
    return descriptor


@pytest.mark.parametrize("kind", ["seeded_radio", "shaped_radio"])
def test_token_rejects_internal_redis_keys_for_both_radio_kinds(
    test_app, issued_tokens, kind
):
    response = test_app.post(
        "/api/playback/continuation-token",
        json={"descriptor": _descriptor(kind, f"{SESSION_ID}:batch:1")},
    )

    assert response.status_code == 422
    assert issued_tokens == []


@pytest.mark.parametrize("kind", ["seeded_radio", "shaped_radio"])
def test_token_canonicalizes_uppercase_session_uuids_for_both_radio_kinds(
    test_app, issued_tokens, kind
):
    response = test_app.post(
        "/api/playback/continuation-token",
        json={"descriptor": _descriptor(kind, SESSION_ID.upper())},
    )

    assert response.status_code == 200
    assert response.json()["token"] == "crv_test"
    assert issued_tokens[0]["descriptor"] == _descriptor(kind, SESSION_ID)


def test_token_keeps_a_valid_shaped_session_and_its_owner(test_app, issued_tokens):
    descriptor = _descriptor("shaped_radio", SESSION_ID)

    response = test_app.post(
        "/api/playback/continuation-token", json={"descriptor": descriptor}
    )

    assert response.status_code == 200
    assert issued_tokens == [
        {"user_id": 42, "session_id": "interactive-session", "descriptor": descriptor}
    ]


def test_legacy_seeded_descriptor_without_an_indexed_session_still_issues_a_token(
    test_app, issued_tokens
):
    descriptor = {"kind": "seeded_radio", "seedType": "album", "seedId": "12"}

    response = test_app.post(
        "/api/playback/continuation-token", json={"descriptor": descriptor}
    )

    assert response.status_code == 200
    assert issued_tokens[0]["descriptor"] == descriptor
