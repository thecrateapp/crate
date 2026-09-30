import hashlib

import pytest
from sqlalchemy.exc import IntegrityError


def test_lastfm_get_session_returns_key_and_username(monkeypatch):
    from crate.scrobble import lastfm_get_session

    captured = {}

    class Response:
        status_code = 200
        content = b"{}"

        def json(self):
            return {
                "session": {
                    "key": "lastfm-session-key",
                    "name": "diego",
                    "subscriber": "0",
                }
            }

    def fake_get(url, *, params, timeout):
        captured["url"] = url
        captured["params"] = params
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("crate.scrobble.requests.get", fake_get)

    session = lastfm_get_session("api-key", "api-secret", "auth-token")

    assert session is not None
    assert session.key == "lastfm-session-key"
    assert session.username == "diego"
    assert session.subscriber is False
    assert captured["url"] == "https://ws.audioscrobbler.com/2.0/"
    assert captured["params"]["method"] == "auth.getSession"
    assert captured["params"]["format"] == "json"
    expected_signature = hashlib.md5(
        b"api_keyapi-keymethodauth.getSessiontokenauth-tokenapi-secret"
    ).hexdigest()
    assert captured["params"]["api_sig"] == expected_signature


def test_lastfm_get_auth_token_returns_token_and_signs_request(monkeypatch):
    from crate.scrobble import lastfm_get_auth_token

    captured = {}

    class Response:
        status_code = 200
        content = b'{"token":"a"}'

        def json(self):
            return {"token": "a" * 32}

    def fake_get(url, *, params, timeout):
        captured["url"] = url
        captured["params"] = params
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("crate.scrobble.requests.get", fake_get)

    token = lastfm_get_auth_token("api-key", "api-secret")

    assert token == "a" * 32
    assert captured["url"] == "https://ws.audioscrobbler.com/2.0/"
    assert captured["params"]["method"] == "auth.getToken"
    assert captured["params"]["api_key"] == "api-key"
    assert captured["params"]["format"] == "json"
    expected_signature = hashlib.md5(
        b"api_keyapi-keymethodauth.getTokenapi-secret"
    ).hexdigest()
    assert captured["params"]["api_sig"] == expected_signature


def test_lastfm_get_auth_token_rejects_malformed_response(monkeypatch):
    from crate.scrobble import lastfm_get_auth_token

    class Response:
        status_code = 200
        content = b'{"token":"invalid"}'

        def json(self):
            return {"token": "invalid"}

    monkeypatch.setattr(
        "crate.scrobble.requests.get", lambda *_args, **_kwargs: Response()
    )

    assert lastfm_get_auth_token("api-key", "api-secret") is None


@pytest.mark.parametrize(
    ("error_code", "retryable"),
    [
        (8, True),
        (14, True),
        (15, False),
        (29, True),
        (None, True),
        ("unknown", True),
    ],
)
def test_lastfm_get_session_strict_classifies_provider_errors(
    monkeypatch, error_code, retryable
):
    from crate.scrobble import (
        LastfmAuthenticationError,
        lastfm_get_session_strict,
    )

    class Response:
        status_code = 200
        content = b"{}"

        def json(self):
            return {"error": error_code, "message": "provider response"}

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with pytest.raises(LastfmAuthenticationError) as exc_info:
        lastfm_get_session_strict("api-key", "api-secret", "auth-token")

    assert exc_info.value.retryable is retryable


@pytest.mark.parametrize("status_code", [408, 429])
def test_lastfm_get_session_strict_retries_transient_http_statuses(
    monkeypatch, status_code
):
    from crate.scrobble import LastfmAuthenticationError, lastfm_get_session_strict

    class Response:
        content = b'{"error":15,"message":"authorization pending"}'

        def __init__(self):
            self.status_code = status_code

        def json(self):
            return {"error": 15, "message": "authorization pending"}

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with pytest.raises(LastfmAuthenticationError) as exc_info:
        lastfm_get_session_strict("api-key", "api-secret", "auth-token")

    assert exc_info.value.retryable is True


def test_lastfm_get_session_strict_retries_success_without_session_or_error(
    monkeypatch,
):
    from crate.scrobble import LastfmAuthenticationError, lastfm_get_session_strict

    class Response:
        status_code = 200
        content = b'{"message":"temporary provider failure"}'

        def json(self):
            return {"message": "temporary provider failure"}

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with pytest.raises(LastfmAuthenticationError) as exc_info:
        lastfm_get_session_strict("api-key", "api-secret", "auth-token")

    assert exc_info.value.retryable is True


def test_lastfm_get_session_strict_treats_network_errors_as_retryable(monkeypatch):
    import requests
    from crate.scrobble import LastfmAuthenticationError, lastfm_get_session_strict

    def fail(*_args, **_kwargs):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr("crate.scrobble.requests.get", fail)

    with pytest.raises(LastfmAuthenticationError) as exc_info:
        lastfm_get_session_strict("api-key", "api-secret", "auth-token")

    assert exc_info.value.retryable is True


def test_connect_lastfm_stores_username_not_blank_or_session_prefix(
    test_app, monkeypatch
):
    from crate.scrobble import LastfmSession

    captured = {}

    monkeypatch.setenv("LASTFM_APIKEY", "api-key")
    monkeypatch.setenv("LASTFM_API_SECRET", "api-secret")
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session",
        lambda *_args: LastfmSession(
            key="lastfm-session-key",
            username="diego",
            subscriber=False,
        ),
    )

    def fake_upsert(**kwargs):
        captured.update(kwargs)
        return {}

    monkeypatch.setattr("crate.api.me.upsert_user_external_identity", fake_upsert)

    resp = test_app.post("/api/me/scrobble/lastfm", json={"token": "auth-token"})

    assert resp.status_code == 200
    assert captured["provider"] == "lastfm"
    assert captured["external_user_id"] == "diego"
    assert captured["external_username"] == "diego"
    assert captured["metadata"] == {
        "session_key": "lastfm-session-key",
        "username": "diego",
        "subscriber": False,
    }


def test_connect_lastfm_conflict_returns_409_without_raw_db_error(
    test_app, monkeypatch
):
    from crate.scrobble import LastfmSession

    monkeypatch.setenv("LASTFM_APIKEY", "api-key")
    monkeypatch.setenv("LASTFM_API_SECRET", "api-secret")
    monkeypatch.setattr(
        "crate.scrobble.lastfm_get_session",
        lambda *_args: LastfmSession(key="lastfm-session-key", username="diego"),
    )

    def fake_upsert(**_kwargs):
        raise IntegrityError("statement", {"metadata_json": "secret"}, None)

    monkeypatch.setattr("crate.api.me.upsert_user_external_identity", fake_upsert)

    resp = test_app.post("/api/me/scrobble/lastfm", json={"token": "auth-token"})

    assert resp.status_code == 409
    assert resp.json() == {
        "detail": "This Last.fm account is already linked to another Crate user"
    }
