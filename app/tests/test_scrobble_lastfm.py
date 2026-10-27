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


def test_lastfm_get_session_strict_logs_provider_diagnostics(monkeypatch, caplog):
    from crate.scrobble import LastfmAuthenticationError, lastfm_get_session_strict

    class Response:
        status_code = 503
        content = b"provider error"

        def json(self):
            return {
                "error": 14,
                "message": "temporary provider response\nfor auth-token api-key api-secret",
            }

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with (
        caplog.at_level("WARNING", logger="crate.scrobble"),
        pytest.raises(LastfmAuthenticationError),
    ):
        lastfm_get_session_strict("api-key", "api-secret", "auth-token")

    assert "status=503" in caplog.text
    assert "error=14" in caplog.text
    assert "message=temporary provider response for [redacted]" in caplog.text
    assert "api-key" not in caplog.text
    assert "api-secret" not in caplog.text
    assert "auth-token" not in caplog.text


def test_lastfm_get_session_logs_one_diagnostic_for_failed_exchange(
    monkeypatch, caplog
):
    from crate.scrobble import lastfm_get_session

    class Response:
        status_code = 502
        content = b"provider error"

        def json(self):
            return {"error": 14, "message": "temporary provider response"}

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with caplog.at_level("WARNING", logger="crate.scrobble"):
        assert lastfm_get_session("api-key", "api-secret", "auth-token") is None

    diagnostics = [
        record
        for record in caplog.records
        if "Last.fm auth.getSession failed" in record.getMessage()
    ]
    assert len(diagnostics) == 1
    assert "status=502" in diagnostics[0].getMessage()
    assert "error=14" in diagnostics[0].getMessage()


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


def test_lastfm_get_auth_token_sanitizes_provider_diagnostics(monkeypatch, caplog):
    from crate.scrobble import lastfm_get_auth_token

    class Response:
        status_code = 502
        content = b"provider error"

        def json(self):
            return {
                "error": 14,
                "token": "provider-token",
                "message": (
                    "temporary provider response\nfor api-key api-secret provider-token "
                    + ("detail " * 80)
                ),
            }

    monkeypatch.setattr(
        "crate.scrobble.requests.get",
        lambda *_args, **_kwargs: Response(),
    )

    with caplog.at_level("WARNING", logger="crate.scrobble"):
        assert lastfm_get_auth_token("api-key", "api-secret") is None

    diagnostics = [
        record
        for record in caplog.records
        if "Last.fm auth.getToken failed" in record.getMessage()
    ]
    assert len(diagnostics) == 1
    message = diagnostics[0].getMessage()
    assert "status=502" in message
    assert "error=14" in message
    assert "message=temporary provider response for [redacted]" in message
    assert len(message.partition("message=")[2]) <= 160
    assert "api-key" not in caplog.text
    assert "api-secret" not in caplog.text
    assert "provider-token" not in caplog.text


def test_lastfm_get_auth_token_does_not_log_request_exception_details(
    monkeypatch, caplog
):
    import requests

    from crate.scrobble import lastfm_get_auth_token

    def raise_connection_error(*_args, **_kwargs):
        raise requests.ConnectionError(
            "failed https://ws.audioscrobbler.com/2.0/?api_key=api-key"
            "&api_sig=signature"
        )

    monkeypatch.setattr("crate.scrobble.requests.get", raise_connection_error)

    with caplog.at_level("WARNING", logger="crate.scrobble"):
        assert lastfm_get_auth_token("api-key", "api-secret") is None

    assert "failure_type=ConnectionError" in caplog.text
    assert "api-key" not in caplog.text
    assert "api_secret" not in caplog.text
    assert "api-secret" not in caplog.text
    assert "signature" not in caplog.text
    assert "audioscrobbler.com" not in caplog.text


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


def _scrobble_with(monkeypatch, *, status_code=200, payload=None, exc=None):
    from crate.scrobble import lastfm_scrobble

    class Response:
        def __init__(self):
            self.status_code = status_code
            self.content = b"{}" if payload is not None else b""

        def json(self):
            return payload

    def fake_post(url, *, data, timeout):
        if exc is not None:
            raise exc
        return Response()

    monkeypatch.setattr("crate.scrobble.requests.post", fake_post)
    return lastfm_scrobble(
        api_key="api-key",
        api_secret="api-secret",
        session_key="session-key",
        artist="Viva Belgrado",
        track="Vals de los Ciegos",
        timestamp=1782000000,
    )


def _scrobbles(accepted: str, ignored: str, code: str = "0") -> dict:
    return {
        "scrobbles": {
            "@attr": {"accepted": accepted, "ignored": ignored},
            "scrobble": {"ignoredMessage": {"code": code, "#text": ""}},
        }
    }


def test_lastfm_scrobble_reports_an_accepted_scrobble(monkeypatch):
    result = _scrobble_with(monkeypatch, payload=_scrobbles("1", "0"))

    assert result.outcome == "accepted"


def test_lastfm_scrobble_does_not_read_a_zero_string_as_accepted(monkeypatch):
    result = _scrobble_with(monkeypatch, payload=_scrobbles("0", "1", code="3"))

    assert result.outcome == "ignored"
    assert result.detail == "lastfm ignored 3"


@pytest.mark.parametrize(
    ("payload", "status_code", "outcome"),
    [
        ({"error": 9, "message": "Invalid session key"}, 403, "failed"),
        ({"error": 11, "message": "Service Offline"}, 200, "retryable"),
        ({"error": 16, "message": "Temporarily unavailable"}, 200, "retryable"),
        ({"error": 29, "message": "Rate limit exceeded"}, 429, "retryable"),
        (None, 503, "retryable"),
        (None, 400, "failed"),
    ],
)
def test_lastfm_scrobble_classifies_provider_errors(
    monkeypatch, payload, status_code, outcome
):
    result = _scrobble_with(monkeypatch, status_code=status_code, payload=payload)

    assert result.outcome == outcome


def test_lastfm_scrobble_treats_a_timeout_as_retryable(monkeypatch):
    import requests

    result = _scrobble_with(monkeypatch, exc=requests.Timeout("slow"))

    assert result.outcome == "retryable"


def _listenbrainz_post(monkeypatch, *, status_code=200, exc=None):
    class Response:
        def __init__(self):
            self.status_code = status_code

    def fake_post(url, *, json, headers, timeout):
        if exc is not None:
            raise exc
        return Response()

    monkeypatch.setattr("crate.scrobble.requests.post", fake_post)


@pytest.mark.parametrize(
    ("status_code", "outcome", "detail"),
    [
        (200, "accepted", ""),
        (429, "retryable", "http 429"),
        (503, "retryable", "http 503"),
        (401, "failed", "http 401"),
    ],
)
def test_listenbrainz_scrobble_classifies_the_provider_answer(
    monkeypatch, status_code, outcome, detail
):
    from crate.scrobble import listenbrainz_scrobble

    _listenbrainz_post(monkeypatch, status_code=status_code)

    result = listenbrainz_scrobble(
        token="lb-token", artist="Viva Belgrado", track="Vals de los Ciegos"
    )

    assert result.outcome == outcome
    assert result.detail == detail


def test_listenbrainz_scrobble_treats_a_timeout_as_retryable(monkeypatch):
    import requests

    from crate.scrobble import listenbrainz_scrobble

    _listenbrainz_post(monkeypatch, exc=requests.Timeout("slow"))

    result = listenbrainz_scrobble(
        token="lb-token", artist="Viva Belgrado", track="Vals de los Ciegos"
    )

    assert result.outcome == "retryable"
    assert result.detail == "transport Timeout"


@pytest.mark.parametrize(("status_code", "expected"), [(200, True), (503, False)])
def test_listenbrainz_now_playing_reports_success_as_a_bool(
    monkeypatch, status_code, expected
):
    from crate.scrobble import listenbrainz_now_playing

    _listenbrainz_post(monkeypatch, status_code=status_code)

    assert (
        listenbrainz_now_playing(
            token="lb-token", artist="Viva Belgrado", track="Vals de los Ciegos"
        )
        is expected
    )


@pytest.mark.parametrize(
    ("played", "duration", "completed", "eligible"),
    [
        (120, 240, False, True),
        (119, 240, False, False),
        (240, 600, False, True),
        (239, 600, False, False),
        (224.9, 46.7, False, True),
        (30, 30, True, False),
        (10, None, True, True),
        (200, None, False, False),
        (240, None, False, True),
    ],
)
def test_scrobble_eligibility_follows_the_lastfm_rule(
    played, duration, completed, eligible
):
    from crate.db.repositories.user_library_playback_writes import scrobble_eligible

    assert (
        scrobble_eligible(
            played_seconds=played,
            track_duration_seconds=duration,
            was_completed=completed,
        )
        is eligible
    )
