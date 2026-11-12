"""Backup destinations keep their secrets in the credential store only (BK2)."""

from __future__ import annotations

import json
import logging

import pytest
from sqlalchemy import text

from crate.backups import destinations
from crate.backups.destinations import (
    DestinationError,
    DestinationNotFound,
    create_destination,
    delete_destination,
    get_destination,
    list_destinations,
    load_destination_secrets,
    update_destination,
)
from crate.credentials import CredentialSecretError, load_secret
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.tx import transaction_scope

ACCESS_SECRET = "r2-secret-access-key-never-shown"
OTHER_SECRET = "a-replacement-secret-key-never-shown"


def _dump_everything() -> str:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT row_to_json(d)::text FROM backup_destinations d "
                "UNION ALL SELECT ciphertext FROM credential_secrets"
            )
        ).scalars()
        return "\n".join(rows)


def _s3(name: str = "R2") -> dict:
    return create_destination(
        kind="s3",
        name=name,
        config={
            "endpoint": "https://acc.r2.cloudflarestorage.com",
            "bucket": "crate-backups",
            "region": "auto",
        },
        secrets={"access_key_id": "AKID", "secret_access_key": ACCESS_SECRET},
    )


def _assert_public(view: dict, *secrets: str) -> None:
    serialized = json.dumps(view, default=str)
    for secret in secrets:
        assert secret not in serialized
    assert "secret_ref" not in view and "repo_password_ref" not in view
    assert "ref" not in json.dumps(sorted(view))


def test_creating_a_destination_encrypts_its_secrets(pg_db, caplog):
    del pg_db
    caplog.set_level(logging.DEBUG)

    view = _s3()

    _assert_public(view, ACCESS_SECRET)
    assert view["secrets_set"] == ["access_key_id", "secret_access_key"]
    assert view["missing_secrets"] == []
    assert view["location"] == "https://acc.r2.cloudflarestorage.com/crate-backups"
    assert view["status"] == "untested"
    # Neither the table nor the credential store holds a secret in clear.
    assert ACCESS_SECRET not in _dump_everything()
    assert ACCESS_SECRET not in caplog.text

    row = get_backup_destination(view["id"])
    assert row is not None
    secrets = load_destination_secrets(row)
    assert secrets.credentials["secret_access_key"] == ACCESS_SECRET
    # Crate generates the repository password: long, random and per destination.
    assert len(secrets.repository_password) >= 40
    other = load_destination_secrets(get_backup_destination(_s3("Wasabi")["id"]) or {})
    assert other.repository_password != secrets.repository_password
    assert secrets.repository_password not in _dump_everything()


def test_an_existing_repository_password_can_be_imported(pg_db):
    del pg_db
    imported = "the-bk0-sidecar-restic-password-0123456789"
    view = create_destination(
        kind="local",
        name="Volume",
        config={"path": "restic"},
        repository_password=imported,
    )
    row = get_backup_destination(view["id"])
    assert row is not None
    assert load_destination_secrets(row).repository_password == imported
    with pytest.raises(DestinationError):
        create_destination(
            kind="local",
            name="Short",
            config={"path": "x"},
            repository_password="short",
        )


def test_sftp_destinations_get_a_generated_key_pair(pg_db):
    del pg_db
    view = create_destination(
        kind="sftp",
        name="Storage Box",
        config={
            "host": "u1.your-storagebox.de",
            "port": 23,
            "user": "u1",
            "path": "crate",
        },
    )
    public_key = view["config"]["public_key"]
    assert public_key.startswith("ssh-ed25519 ")
    assert view["secrets_set"] == ["private_key"]
    row = get_backup_destination(view["id"])
    assert row is not None
    private = load_destination_secrets(row).credentials["private_key"]
    _assert_public(view, private)
    # The key pair is Crate's: a client can neither send nor replace it.
    with pytest.raises(DestinationError):
        update_destination(view["id"], secrets={"private_key": "mine"})
    with pytest.raises(DestinationError):
        update_destination(view["id"], config={"public_key": "ssh-ed25519 AAAA x"})
    with pytest.raises(DestinationError):
        create_destination(
            kind="sftp",
            name="Mine",
            config={"host": "h", "user": "u", "path": "p"},
            secrets={"private_key": "mine"},
        )


def test_updates_replace_secrets_and_revoke_the_old_ones(pg_db, caplog):
    del pg_db
    caplog.set_level(logging.DEBUG)
    view = _s3()
    old_ref = (get_backup_destination(view["id"]) or {})["secret_ref"]

    renamed = update_destination(
        view["id"], name="Cloudflare R2", config={"prefix": "pg"}
    )
    assert renamed["name"] == "Cloudflare R2"
    assert renamed["config"]["prefix"] == "pg"
    # Same secrets: no new payload.
    assert (get_backup_destination(view["id"]) or {})["secret_ref"] == old_ref

    replaced = update_destination(
        view["id"], secrets={"secret_access_key": OTHER_SECRET}
    )
    _assert_public(replaced, OTHER_SECRET, ACCESS_SECRET)
    row = get_backup_destination(view["id"])
    assert row is not None and row["secret_ref"] != old_ref
    assert load_destination_secrets(row).credentials == {
        "access_key_id": "AKID",
        "secret_access_key": OTHER_SECRET,
    }
    with pytest.raises(CredentialSecretError):
        load_secret(old_ref)
    # A required secret cannot be removed.
    with pytest.raises(DestinationError):
        update_destination(view["id"], secrets={"secret_access_key": None})
    assert OTHER_SECRET not in caplog.text and ACCESS_SECRET not in caplog.text


def test_oauth_tokens_can_be_removed_to_disconnect(pg_db):
    del pg_db
    token = json.dumps({"access_token": "at-123", "refresh_token": "rt-456"})
    view = create_destination(
        kind="gdrive",
        name="Drive",
        config={"client_id": "cid.apps.googleusercontent.com"},
        secrets={"client_secret": "client-secret-xyz", "token": token},
    )
    assert view["missing_secrets"] == []
    assert view["config"]["path"] == "crate-backups"
    _assert_public(view, "at-123", "rt-456", "client-secret-xyz")

    disconnected = update_destination(view["id"], secrets={"token": None})
    assert disconnected["secrets_set"] == ["client_secret"]
    assert disconnected["missing_secrets"] == ["token"]


def test_a_moved_sftp_server_forgets_its_pinned_host_key(pg_db):
    del pg_db
    view = create_destination(
        kind="sftp",
        name="Box",
        config={
            "host": "old.example",
            "user": "u",
            "path": "p",
            "known_hosts": "old.example ssh-ed25519 AAAA",
        },
    )
    kept = update_destination(view["id"], config={"path": "q"})
    assert kept["config"]["known_hosts"] == "old.example ssh-ed25519 AAAA"
    moved = update_destination(view["id"], config={"host": "new.example"})
    assert moved["config"]["known_hosts"] == ""
    assert moved["config"]["public_key"] == view["config"]["public_key"]


def test_deleting_revokes_every_secret(pg_db):
    del pg_db
    view = _s3()
    row = get_backup_destination(view["id"])
    assert row is not None

    deleted = delete_destination(view["id"])
    assert deleted["id"] == view["id"]
    for ref in (row["secret_ref"], row["repo_password_ref"]):
        with pytest.raises(CredentialSecretError):
            load_secret(ref)
    assert get_destination(view["id"]) is None
    with pytest.raises(DestinationNotFound):
        delete_destination(view["id"])
    with pytest.raises(DestinationNotFound):
        update_destination(view["id"], name="x")


def test_listing_never_carries_secrets(pg_db):
    del pg_db
    _s3()
    create_destination(kind="local", name="Volume", config={"path": "restic"})

    listed = list_destinations()
    assert [d["name"] for d in listed] == ["R2", "Volume"]
    for view in listed:
        _assert_public(view, ACCESS_SECRET)


def test_a_failed_insert_leaves_no_live_secret(pg_db, monkeypatch):
    del pg_db
    _s3()
    stored: list[str] = []
    real = destinations.store_secret

    def recording(scope, payload, **kwargs):
        ref = real(scope, payload, **kwargs)
        stored.append(ref)
        return ref

    monkeypatch.setattr(destinations, "store_secret", recording)
    with pytest.raises(Exception):
        _s3("r2")  # same name, other case: the unique index refuses it
    assert len(stored) == 2
    for ref in stored:
        with pytest.raises(CredentialSecretError):
            load_secret(ref)
