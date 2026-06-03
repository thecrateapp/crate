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
    assert captured["params"]["api_sig"]


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
