from __future__ import annotations

import hashlib
from contextlib import contextmanager

from crate.db.repositories import subsonic_credentials as repository


class _Session:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params))


@contextmanager
def _scope(session=None):
    yield session


def test_rotation_locks_and_atomically_replaces_api_key(monkeypatch):
    session = _Session()
    revoked = []
    stored = []
    upserts = []
    monkeypatch.setattr(repository, "optional_scope", _scope)
    monkeypatch.setattr(
        repository,
        "get_user_subsonic_credential_by_user_id",
        lambda _user_id, session=None: {"secret_ref": "opensubsonic:old"},
    )
    monkeypatch.setattr(
        "crate.credentials.revoke_secret", lambda ref, session=None: revoked.append(ref)
    )
    monkeypatch.setattr(
        "crate.credentials.store_secret",
        lambda scope, payload, session=None: (
            stored.append((scope, payload)) or "opensubsonic:new"
        ),
    )
    monkeypatch.setattr(
        repository,
        "upsert_user_subsonic_credential",
        lambda **data: upserts.append(data),
    )

    repository.rotate_user_subsonic_credential(17, "one-time-api-key", session=session)

    assert "pg_advisory_xact_lock" in session.statements[0][0]
    assert revoked == ["opensubsonic:old"]
    assert stored == [("opensubsonic", {"secret": "one-time-api-key"})]
    assert upserts[0]["user_id"] == 17
    assert upserts[0]["secret_ref"] == "opensubsonic:new"
    assert (
        upserts[0]["api_key_digest"] == hashlib.sha256(b"one-time-api-key").hexdigest()
    )


def test_revoke_removes_lookup_and_revokes_secret(monkeypatch):
    session = _Session()
    deleted = []
    revoked = []
    monkeypatch.setattr(repository, "optional_scope", _scope)
    monkeypatch.setattr(
        repository,
        "get_user_subsonic_credential_by_user_id",
        lambda _user_id, session=None: {"secret_ref": "opensubsonic:old"},
    )
    monkeypatch.setattr(
        "crate.credentials.revoke_secret", lambda ref, session=None: revoked.append(ref)
    )
    monkeypatch.setattr(
        repository,
        "delete_user_subsonic_credential",
        lambda user_id, session=None: deleted.append(user_id),
    )

    assert repository.revoke_user_subsonic_credential(17, session=session) is True
    assert "pg_advisory_xact_lock" in session.statements[0][0]
    assert revoked == ["opensubsonic:old"]
    assert deleted == [17]


def test_revoke_without_existing_credential_is_idempotent(monkeypatch):
    monkeypatch.setattr(repository, "optional_scope", _scope)
    monkeypatch.setattr(
        repository,
        "get_user_subsonic_credential_by_user_id",
        lambda _user_id, session=None: None,
    )

    assert repository.revoke_user_subsonic_credential(17, session=_Session()) is False
