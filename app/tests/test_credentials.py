import json
from datetime import datetime, timezone

import pytest
from cryptography.fernet import Fernet
from crate import credentials
from crate.db.repositories.credential_secrets import insert_credential_secret


def test_ai_secret_strong_guard_rotation_legacy_and_bounded_rewrap(pg_db, monkeypatch):
    monkeypatch.delenv("CRATE_CREDENTIAL_KEY", raising=False)
    monkeypatch.setenv("JWT_SECRET", "legacy-test-key")
    with pytest.raises(credentials.CredentialSecretError):
        credentials.store_secret(
            "ai_provider", {"api_key": "private"}, require_strong_key=True
        )
    legacy = credentials.store_secret("ai_provider", {"api_key": "legacy"})
    first = Fernet.generate_key().decode()
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", first)
    assert credentials.load_secret(legacy)["api_key"] == "legacy"
    one = credentials.store_secret(
        "ai_provider", {"api_key": "one"}, require_strong_key=True
    )
    second = Fernet.generate_key().decode()
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", second)
    monkeypatch.setenv("CRATE_CREDENTIAL_PREVIOUS_KEYS", first)
    assert credentials.load_secret(one, scope="ai_provider")["api_key"] == "one"
    cursor = None
    scanned = rewrapped = 0
    while True:
        batch = credentials.rewrap_secrets(limit=1, after_ref=cursor)
        assert batch["scanned"] <= 1
        scanned += batch["scanned"]
        rewrapped += batch["rewrapped"]
        cursor = batch["next_cursor"]
        if cursor is None:
            break
    assert scanned == rewrapped == 2
    monkeypatch.delenv("CRATE_CREDENTIAL_PREVIOUS_KEYS")
    monkeypatch.setenv("JWT_SECRET", "unrelated")
    assert credentials.load_secret(legacy)["api_key"] == "legacy"
    assert credentials.load_secret(one)["api_key"] == "one"
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", "invalid")
    with pytest.raises(credentials.CredentialSecretError):
        credentials.store_secret("ai_provider", {}, require_strong_key=True)


def test_credentials_accept_explicit_and_database_jwt_legacy_keys(pg_db, monkeypatch):
    from crate.db.repositories.settings import set_setting

    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("CRATE_CREDENTIAL_KEY", raising=False)
    set_setting("jwt_secret", "database-root")
    legacy = credentials.store_secret("test", {"value": "old"})
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    assert credentials.load_secret(legacy) == {"value": "old"}
    previous = Fernet.generate_key()
    insert_credential_secret(
        secret_ref="test:previous",
        scope="test",
        ciphertext=Fernet(previous).encrypt(json.dumps({"a": 1}).encode()).decode(),
        expires_at=None,
        now=datetime.now(timezone.utc),
    )
    monkeypatch.setenv("CRATE_CREDENTIAL_PREVIOUS_KEYS", previous.decode())
    assert credentials.load_secret("test:previous") == {"a": 1}


def test_credential_repository_reads_rollback(monkeypatch):
    from contextlib import contextmanager
    from crate.db.repositories import credential_secrets

    called = []

    class Result:
        def mappings(self):
            return self

        def first(self):
            return None

    class Session:
        def execute(self, *args):
            return Result()

    @contextmanager
    def scope():
        called.append("read")
        yield Session()

    monkeypatch.setattr(credential_secrets, "read_scope", scope)
    assert credential_secrets.get_credential_secret("missing") is None
    assert called == ["read"]
