"""OAuth from Admin for Drive and Dropbox destinations (admin backups, BK2)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text

from crate.backups import oauth
from crate.backups.destinations import create_destination, get_destination
from crate.backups.destinations import load_destination_secrets
from crate.backups.oauth import (
    OAuthError,
    OAuthStateError,
    complete_authorization,
    consume_state,
    exchange_code,
    start_authorization,
)
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.tx import transaction_scope

REDIRECT = "https://admin.example.org/api/admin/backups/oauth/callback"
CLIENT_SECRET = "gdrive-client-secret-never-shown"
ACCESS_TOKEN = "ya29.access-token-never-shown"
REFRESH_TOKEN = "1//refresh-token-never-shown"


@pytest.fixture(autouse=True)
def memory_store(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("CRATE_ENV", "test")
    oauth._memory_states.clear()
    yield
    oauth._memory_states.clear()


def _drive(**config) -> dict:
    return create_destination(
        kind="gdrive",
        name="Drive",
        config={"client_id": "123.apps.googleusercontent.com", **config},
        secrets={"client_secret": CLIENT_SECRET},
    )


def _state_of(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def _token_endpoint(calls: list, *, payload: dict | None = None, status: int = 200):
    def post(url, data):
        calls.append((url, dict(data)))
        return status, payload if payload is not None else {
            "access_token": ACCESS_TOKEN,
            "refresh_token": REFRESH_TOKEN,
            "expires_in": 3599,
            "token_type": "Bearer",
            "scope": "https://www.googleapis.com/auth/drive.file",
        }

    return post


def test_drive_asks_only_for_drive_file_with_pkce(pg_db):
    del pg_db
    destination = _drive()

    url = start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)

    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    params = _state_of(url)
    assert params["scope"] == "https://www.googleapis.com/auth/drive.file"
    assert params["client_id"] == "123.apps.googleusercontent.com"
    assert params["redirect_uri"] == REDIRECT
    assert params["code_challenge_method"] == "S256"
    assert params["access_type"] == "offline" and params["prompt"] == "consent"
    assert len(params["state"]) >= 40
    # Neither the client secret nor the verifier reach the browser.
    assert CLIENT_SECRET not in url
    stored = next(iter(oauth._memory_states.values()))
    assert json.loads(stored)["verifier"] not in url


def test_a_good_callback_stores_the_token_encrypted(pg_db):
    del pg_db
    destination = _drive()
    url = start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
    calls: list = []

    view = complete_authorization(
        state=_state_of(url)["state"],
        code="auth-code",
        user_id=7,
        post=_token_endpoint(calls),
    )

    (token_url, sent) = calls[0]
    assert token_url == "https://oauth2.googleapis.com/token"
    assert sent["code"] == "auth-code" and sent["client_secret"] == CLIENT_SECRET
    assert sent["redirect_uri"] == REDIRECT
    assert len(sent["code_verifier"]) >= 43
    assert view["missing_secrets"] == [] and "token" in view["secrets_set"]
    assert view["status"] == "untested"
    serialized = json.dumps(view, default=str)
    assert ACCESS_TOKEN not in serialized and REFRESH_TOKEN not in serialized

    row = get_backup_destination(destination["id"])
    assert row is not None
    token = json.loads(load_destination_secrets(row).credentials["token"])
    assert token["refresh_token"] == REFRESH_TOKEN
    assert token["access_token"] == ACCESS_TOKEN
    assert token["expiry"].endswith("Z")
    with transaction_scope() as session:
        everything = "\n".join(
            session.execute(
                text(
                    "SELECT ciphertext FROM credential_secrets UNION ALL "
                    "SELECT config_json::text FROM backup_destinations"
                )
            ).scalars()
        )
    assert REFRESH_TOKEN not in everything and ACCESS_TOKEN not in everything


def test_a_state_works_once(pg_db):
    del pg_db
    destination = _drive()
    state = _state_of(
        start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
    )["state"]
    complete_authorization(state=state, code="c", user_id=7, post=_token_endpoint([]))

    with pytest.raises(OAuthStateError):
        complete_authorization(
            state=state, code="c", user_id=7, post=_token_endpoint([])
        )


@pytest.mark.parametrize(
    "state, user_id",
    [
        ("forged-state-that-was-never-issued-by-crate", 7),
        ("short", 7),
    ],
)
def test_unknown_states_are_refused_before_any_exchange(pg_db, state, user_id):
    del pg_db
    _drive()
    calls: list = []
    with pytest.raises(OAuthStateError):
        complete_authorization(
            state=state, code="c", user_id=user_id, post=_token_endpoint(calls)
        )
    assert calls == []


def test_a_state_is_bound_to_the_admin_who_started_it(pg_db):
    del pg_db
    destination = _drive()
    state = _state_of(
        start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
    )["state"]
    calls: list = []

    with pytest.raises(OAuthStateError):
        complete_authorization(
            state=state, code="c", user_id=8, post=_token_endpoint(calls)
        )
    assert calls == []
    # The refused attempt burnt the state: it cannot be replayed by its owner either.
    with pytest.raises(OAuthStateError):
        consume_state(state, user_id=7)
    stored = get_destination(destination["id"])
    assert stored is not None and "token" not in stored["secrets_set"]


def test_expired_states_are_refused(pg_db, monkeypatch):
    del pg_db
    destination = _drive()
    real_now = datetime.now(timezone.utc)

    class Past(datetime):
        @classmethod
        def now(cls, tz=None):
            return real_now - timedelta(seconds=oauth.STATE_TTL_SECONDS + 5)

    monkeypatch.setattr(oauth, "datetime", Past)
    state = _state_of(
        start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
    )["state"]
    monkeypatch.setattr(oauth, "datetime", datetime)

    with pytest.raises(OAuthStateError, match="expired"):
        consume_state(state, user_id=7)


def test_a_token_without_refresh_or_scope_is_refused():
    provider = oauth.OAUTH_PROVIDERS["gdrive"]
    common = dict(
        code="c",
        verifier="v" * 43,
        redirect_uri=REDIRECT,
        client_id="i",
        client_secret="s",
    )
    with pytest.raises(OAuthError, match="refresh token"):
        exchange_code(
            provider,
            post=_token_endpoint([], payload={"access_token": "a", "expires_in": 10}),
            **common,
        )
    with pytest.raises(OAuthError, match="drive.file"):
        exchange_code(
            provider,
            post=_token_endpoint(
                [],
                payload={
                    "access_token": "a",
                    "refresh_token": "r",
                    "scope": "https://www.googleapis.com/auth/drive",
                },
            ),
            **common,
        )
    with pytest.raises(OAuthError, match="refused"):
        exchange_code(
            provider, post=_token_endpoint([], status=400, payload={}), **common
        )


def test_connecting_needs_an_oauth_client(pg_db, monkeypatch):
    del pg_db
    destination = create_destination(kind="dropbox", name="Dropbox")
    with pytest.raises(OAuthError, match="client"):
        start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)

    monkeypatch.setenv("CRATE_BACKUP_DROPBOX_CLIENT_ID", "app-key")
    monkeypatch.setenv("CRATE_BACKUP_DROPBOX_CLIENT_SECRET", "app-secret")
    url = start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
    params = _state_of(url)
    assert url.startswith("https://www.dropbox.com/oauth2/authorize?")
    assert params["client_id"] == "app-key"
    assert params["token_access_type"] == "offline"
    assert "app-secret" not in url


def test_other_kinds_do_not_connect_through_oauth(pg_db):
    del pg_db
    local = create_destination(kind="local", name="Volume", config={"path": "restic"})
    with pytest.raises(OAuthError):
        start_authorization(local["id"], user_id=7, redirect_uri=REDIRECT)


def test_production_never_keeps_states_in_memory(pg_db, monkeypatch):
    del pg_db
    destination = _drive()
    monkeypatch.setenv("CRATE_ENV", "production")
    with pytest.raises(OAuthError, match="unavailable"):
        start_authorization(destination["id"], user_id=7, redirect_uri=REDIRECT)
