"""M10: self-service account data export (worker task, archive content, expiry)."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from sqlalchemy import text

from crate.auth import hash_password
from crate.db.queries.user_data_export import (
    USER_DATA_EXPORT_SECTIONS,
    get_latest_user_data_export,
    get_user_data_export,
)
from crate.db.repositories.access_tokens import create_access_token
from crate.db.repositories.auth_sessions import create_session
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.user_data_exports import queue_user_data_export
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.account_data_v168 import (
    create_account_data_v168_schema,
    drop_account_data_v168_schema,
)
from crate.db.tx import transaction_scope
from crate.download_cache import cached_download_artifact_path
from crate.user_data_export import (
    USER_DATA_EXPORT_KIND,
    user_data_export_filename,
    write_user_data_export_zip,
)
from crate.worker_handlers.user_data_export import (
    USER_DATA_EXPORT_TASK_HANDLERS,
    _handle_cleanup_user_data_exports,
    _handle_export_user_data,
)
from tests.conftest import PG_AVAILABLE
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.168_account_data"

pg = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_account_data_v168_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "168" and migration.down_revision == "167"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_account_data_v168_schema(expected)
    assert downgrade.statements == expected.statements


def test_handlers_are_registered():
    assert set(USER_DATA_EXPORT_TASK_HANDLERS) == {
        "export_user_data",
        "cleanup_user_data_exports",
    }


def test_zip_writer_streams_sections_and_manifest(tmp_path):
    path = tmp_path / "export.zip"
    rows = {
        "profile": [{"id": 7, "created_at": datetime(2026, 1, 2, tzinfo=timezone.utc)}],
        "play_events": [],
    }

    counts = write_user_data_export_zip(
        path,
        user_id=7,
        generated_at=datetime(2026, 11, 18, tzinfo=timezone.utc),
        sections=["profile", "play_events"],
        rows_for=lambda section: rows[section],
    )

    assert counts == {"profile": 1, "play_events": 0}
    with zipfile.ZipFile(path) as archive:
        assert json.loads(archive.read("profile.json")) == [
            {"id": 7, "created_at": "2026-01-02T00:00:00+00:00"}
        ]
        assert json.loads(archive.read("play_events.json")) == []
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["user_id"] == 7
    assert manifest["sections"] == counts


def test_zip_writer_stops_when_cancelled(tmp_path):
    result = write_user_data_export_zip(
        tmp_path / "export.zip",
        user_id=7,
        generated_at=datetime.now(timezone.utc),
        sections=["profile"],
        rows_for=lambda _section: [],
        should_stop=lambda: True,
    )

    assert result is None


def test_export_handler_skips_rows_that_are_not_pending(monkeypatch):
    monkeypatch.setattr(
        "crate.worker_handlers.user_data_export.get_user_data_export",
        lambda *_args, **_kwargs: {"id": "a" * 32, "status": "ready"},
    )

    result = _handle_export_user_data(
        "task-1", {"export_id": "a" * 32, "user_id": 3}, {}
    )

    assert result == {"status": "skipped", "reason": "ready"}


def test_export_handler_rejects_malformed_ids():
    with pytest.raises(ValueError):
        _handle_export_user_data("task-1", {"export_id": "../x", "user_id": 3}, {})


def _seed_user(email: str, *, artist: str, play_title: str) -> int:
    user = create_user(
        email, name=email.split("@")[0], password_hash=hash_password("pw-secret-123")
    )
    user_id = int(user["id"])
    now = datetime.now(timezone.utc)
    create_session(
        f"sess-{user_id}",
        user_id,
        now + timedelta(days=1),
        user_agent="pytest",
        app_id="listen",
    )
    create_access_token(user_id=user_id, name="Decks", scopes=["vdj.catalog.read"])
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (:user_id, :artist, now())
                """
            ),
            {"user_id": user_id, "artist": artist},
        )
        session.execute(
            text(
                """
                INSERT INTO user_play_events (user_id, title, artist, started_at, ended_at, created_at)
                VALUES (:user_id, :title, :artist, now(), now(), now())
                """
            ),
            {"user_id": user_id, "title": play_title, "artist": artist},
        )
        session.execute(
            text(
                """
                INSERT INTO user_external_identities
                    (user_id, provider, external_username, status, metadata_json, created_at, updated_at)
                VALUES (:user_id, 'lastfm', :username, 'linked',
                        CAST(:metadata AS jsonb), now(), now())
                """
            ),
            {
                "user_id": user_id,
                "username": f"{artist}-fan",
                "metadata": json.dumps({"session_key": f"LASTFM-SECRET-{user_id}"}),
            },
        )
        playlist_id = session.execute(
            text(
                """
                INSERT INTO playlists (name, user_id, scope, created_at, updated_at)
                VALUES (:name, :user_id, 'user', now(), now())
                RETURNING id
                """
            ),
            {"name": f"{artist} favourites", "user_id": user_id},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks (playlist_id, position, title, artist, added_at)
                VALUES (:playlist_id, 1, :title, :artist, now())
                """
            ),
            {"playlist_id": playlist_id, "title": play_title, "artist": artist},
        )
    return user_id


@pytest.fixture
def export_cache(monkeypatch, tmp_path) -> Path:
    root = tmp_path / "download-cache"
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(root))
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", MagicMock()
    )
    return root


def _read_archive(path: Path) -> dict[str, object]:
    with zipfile.ZipFile(path) as archive:
        return {
            name.removesuffix(".json"): json.loads(archive.read(name))
            for name in archive.namelist()
        }


@pg
def test_export_contains_only_the_users_own_data_and_no_secrets(pg_db, export_cache):
    del pg_db
    owner_id = _seed_user("owner@export.test", artist="Low", play_title="Words")
    _seed_user("other@export.test", artist="Slint", play_title="Nosferatu Man")

    export, created = queue_user_data_export(owner_id)
    assert created is True
    result = _handle_export_user_data(
        "task-export", {"export_id": export["id"], "user_id": owner_id}, {}
    )

    assert result["export_id"] == export["id"]
    stored = get_user_data_export(export["id"], user_id=owner_id)
    assert stored is not None and stored["status"] == "ready"
    assert stored["expires_at"] > datetime.now(timezone.utc)
    path = cached_download_artifact_path(
        USER_DATA_EXPORT_KIND, export["id"], stored["filename"]
    )
    archive = _read_archive(path)

    assert set(archive) == {name for name, _sql in USER_DATA_EXPORT_SECTIONS} | {
        "manifest"
    }
    assert archive["profile"][0]["email"] == "owner@export.test"
    assert [row["artist_name"] for row in archive["followed_artists"]] == ["Low"]
    assert [row["title"] for row in archive["play_events"]] == ["Words"]
    assert [row["name"] for row in archive["playlists"]] == ["Low favourites"]
    assert [row["title"] for row in archive["playlist_tracks"]] == ["Words"]
    assert archive["connected_accounts"][0]["external_username"] == "Low-fan"
    assert archive["access_tokens"][0]["name"] == "Decks"
    assert archive["sessions"][0]["user_agent"] == "pytest"

    raw = json.dumps(archive)
    for forbidden in (
        "password_hash",
        "token_digest",
        "subsonic_token",
        "LASTFM-SECRET",
        "sess-",
        "Slint",
        "Nosferatu Man",
        "other@export.test",
    ):
        assert forbidden not in raw


@pg
def test_queue_reuses_a_pending_export(pg_db, export_cache):
    del pg_db
    user_id = int(create_user("pending@export.test")["id"])

    first, first_created = queue_user_data_export(user_id)
    second, second_created = queue_user_data_export(user_id)

    assert first_created is True and second_created is False
    assert second["id"] == first["id"]
    assert get_latest_user_data_export(user_id)["status"] == "pending"


@pg
def test_new_export_supersedes_the_previous_archive(pg_db, export_cache):
    del pg_db
    user_id = int(create_user("supersede@export.test")["id"])
    first, _ = queue_user_data_export(user_id)
    _handle_export_user_data("t1", {"export_id": first["id"], "user_id": user_id}, {})
    first_path = cached_download_artifact_path(
        USER_DATA_EXPORT_KIND,
        first["id"],
        user_data_export_filename(first["created_at"]),
    )
    assert first_path.is_file()

    second, _ = queue_user_data_export(user_id)
    result = _handle_export_user_data(
        "t2", {"export_id": second["id"], "user_id": user_id}, {}
    )

    assert result["superseded"] == 1
    assert not first_path.exists()
    assert get_user_data_export(first["id"])["status"] == "expired"
    assert get_user_data_export(second["id"])["status"] == "ready"


@pg
def test_cleanup_expires_old_exports_and_removes_their_files(pg_db, export_cache):
    del pg_db
    user_id = int(create_user("expiry@export.test")["id"])
    export, _ = queue_user_data_export(user_id)
    _handle_export_user_data("t1", {"export_id": export["id"], "user_id": user_id}, {})
    stored = get_user_data_export(export["id"])
    path = cached_download_artifact_path(
        USER_DATA_EXPORT_KIND, export["id"], stored["filename"]
    )
    assert path.is_file()

    assert _handle_cleanup_user_data_exports("c0", {}, {})["expired"] == 0
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE user_data_exports SET expires_at = now() - interval '1 minute'"
                " WHERE id = :id"
            ),
            {"id": export["id"]},
        )

    result = _handle_cleanup_user_data_exports("c1", {}, {})

    assert result["expired"] == 1
    assert not path.exists()
    assert get_user_data_export(export["id"])["status"] == "expired"


@pg
def test_cleanup_for_a_user_removes_every_export_of_that_user(pg_db, export_cache):
    del pg_db
    user_id = int(create_user("deleted@export.test")["id"])
    other_id = int(create_user("kept@export.test")["id"])
    mine, _ = queue_user_data_export(user_id)
    theirs, _ = queue_user_data_export(other_id)
    _handle_export_user_data("t1", {"export_id": mine["id"], "user_id": user_id}, {})
    _handle_export_user_data("t2", {"export_id": theirs["id"], "user_id": other_id}, {})

    result = _handle_cleanup_user_data_exports("c1", {"user_id": user_id}, {})

    assert result["expired"] == 1
    assert get_user_data_export(mine["id"])["status"] == "expired"
    assert get_user_data_export(theirs["id"])["status"] == "ready"


@pg
def test_stale_pending_exports_are_marked_failed(pg_db, export_cache):
    del pg_db
    user_id = int(create_user("stale@export.test")["id"])
    export, _ = queue_user_data_export(user_id)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE user_data_exports SET created_at = now() - interval '2 hours'"
                " WHERE id = :id"
            ),
            {"id": export["id"]},
        )

    result = _handle_cleanup_user_data_exports("c1", {}, {})

    assert result["stale_failed"] == 1
    assert get_user_data_export(export["id"])["status"] == "failed"
    assert (
        _handle_export_user_data(
            "late", {"export_id": export["id"], "user_id": user_id}, {}
        )["reason"]
        == "failed"
    )
