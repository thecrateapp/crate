"""Migration 163 adds backup_destinations, where backups go (admin backups, BK2)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.credentials import store_secret
from crate.db.queries.backup_destinations import (
    get_backup_destination,
    list_backup_destinations,
)
from crate.db.repositories.backup_destinations import (
    delete_backup_destination,
    insert_backup_destination,
    mark_recovery_kit_downloaded,
    confirm_recovery_kit,
    record_destination_check,
    update_backup_destination,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.backup_destinations_v163 import (
    create_backup_destinations_v163_schema,
    drop_backup_destinations_v163_schema,
)
from crate.db.tx import transaction_scope
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.163_backup_destinations"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_backup_destinations_v163_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "163" and migration.down_revision == "162"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_backup_destinations_v163_schema(expected)
    assert (
        downgrade.statements
        == expected.statements
        == ["DROP TABLE IF EXISTS backup_destinations"]
    )


def _refs():
    return (
        store_secret("backup_destination", {"access_key_id": "AK"}),
        store_secret("backup_repository", {"password": "pw"}),
    )


def test_a_destination_keeps_only_references_to_its_secrets(pg_db):
    del pg_db
    secret_ref, password_ref = _refs()

    created = insert_backup_destination(
        kind="s3",
        name="R2",
        config={"bucket": "crate", "endpoint": "https://r2.example"},
        secret_ref=secret_ref,
        repo_password_ref=password_ref,
    )
    row = get_backup_destination(created["id"])
    assert row is not None
    assert (row["kind"], row["name"], row["status"], row["enabled"]) == (
        "s3",
        "R2",
        "untested",
        True,
    )
    assert row["config"] == {"bucket": "crate", "endpoint": "https://r2.example"}
    assert (row["secret_ref"], row["repo_password_ref"]) == (secret_ref, password_ref)
    with transaction_scope() as session:
        stored = session.execute(
            text("SELECT config_json::text FROM backup_destinations")
        ).scalar_one()
    assert "AK" not in stored and "pw" not in stored


def test_destinations_update_check_and_delete(pg_db):
    del pg_db
    secret_ref, password_ref = _refs()
    created = insert_backup_destination(
        kind="local",
        name="Volume",
        config={"path": "restic"},
        secret_ref=None,
        repo_password_ref=password_ref,
    )
    other = insert_backup_destination(
        kind="s3",
        name="Bucket",
        config={},
        secret_ref=secret_ref,
        repo_password_ref=store_secret("backup_repository", {"password": "x"}),
    )

    updated = update_backup_destination(
        created["id"], name="Disk", config={"path": "disk"}, enabled=False
    )
    assert updated is not None
    assert (updated["name"], updated["config"], updated["enabled"]) == (
        "Disk",
        {"path": "disk"},
        False,
    )
    # A changed configuration has to be tested again.
    assert updated["status"] == "untested"

    assert record_destination_check(
        created["id"],
        status="ok",
        error=None,
        snapshot_count=3,
        repository_bytes=4096,
        initialized=True,
    )
    checked = get_backup_destination(created["id"])
    assert checked is not None
    assert (checked["status"], checked["snapshot_count"]) == ("ok", 3)
    assert checked["repository_bytes"] == 4096
    assert checked["last_checked_at"] is not None
    assert checked["repository_initialized_at"] is not None
    assert record_destination_check(
        created["id"], status="failing", error="e" * 5000
    )
    failing = get_backup_destination(created["id"])
    assert failing is not None
    assert failing["status"] == "failing" and len(failing["last_error"]) == 2000
    # A failed check keeps what the last good one learnt about the repository.
    assert failing["snapshot_count"] == 3

    assert [row["name"] for row in list_backup_destinations()] == ["Bucket", "Disk"]

    assert mark_recovery_kit_downloaded([created["id"], other["id"]]) == 2
    assert confirm_recovery_kit() == 2
    confirmed = get_backup_destination(other["id"])
    assert confirmed is not None and confirmed["recovery_kit_confirmed_at"]

    deleted = delete_backup_destination(created["id"])
    assert deleted is not None and deleted["repo_password_ref"] == password_ref
    assert get_backup_destination(created["id"]) is None
    assert delete_backup_destination(created["id"]) is None
    assert get_backup_destination("not-a-uuid") is None


def test_names_are_unique_whatever_their_case(pg_db):
    del pg_db
    _, password_ref = _refs()
    insert_backup_destination(
        kind="local",
        name="Volume",
        config={},
        secret_ref=None,
        repo_password_ref=password_ref,
    )
    with pytest.raises(IntegrityError):
        insert_backup_destination(
            kind="local",
            name="volume",
            config={},
            secret_ref=None,
            repo_password_ref=password_ref,
        )


@pytest.mark.parametrize(
    "columns, values",
    [
        ("kind, name, repo_password_ref", "'ftp', 'x', 'missing'"),
        ("kind, name, repo_password_ref", "'local', '', 'missing'"),
        ("kind, name, repo_password_ref, status", "'local', 'x', 'missing', 'odd'"),
        ("kind, name, repo_password_ref, config_json", "'local', 'x', 'missing', '[]'"),
        # Secrets live in the credential store: refs must point at it.
        ("kind, name, repo_password_ref", "'local', 'x', 'missing'"),
    ],
)
def test_the_table_checks_its_values(pg_db, columns, values):
    del pg_db

    with pytest.raises(IntegrityError):
        with transaction_scope() as session:
            session.execute(
                text(f"INSERT INTO backup_destinations ({columns}) VALUES ({values})")
            )
