"""Migration 157 adds Smart Mix playlists and per-track stem jobs (STEM-D2)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.smart_mix_playlists_v157 import (
    create_smart_mix_playlists_v157_schema,
    drop_smart_mix_playlists_v157_schema,
)
from crate.db.tx import read_scope, transaction_scope
from tests.test_agent_access_migration import RecordingExecutor
from tests.test_smart_mix_repository import _create_track

MIGRATION = "crate.db.migrations.versions.157_smart_mix_playlists"
TABLES = (
    "smart_mix_playlist_revisions",
    "smart_mix_playlists",
    "track_stem_jobs",
)


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_smart_mix_playlists_v157_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "157" and migration.down_revision == "156"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_smart_mix_playlists_v157_schema(expected)
    assert downgrade.statements == expected.statements
    assert downgrade.statements == [
        "DROP TABLE IF EXISTS track_stem_jobs",
        "DROP TABLE IF EXISTS smart_mix_playlists",
        "DROP TABLE IF EXISTS smart_mix_playlist_revisions",
    ]


def _constraints(table: str, kind: str) -> list[str]:
    with read_scope() as session:
        return list(
            session.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = CAST(:table AS regclass) AND contype = :kind "
                    "ORDER BY 1"
                ),
                {"table": table, "kind": kind},
            ).scalars()
        )


def test_keys_follow_the_design(pg_db):
    del pg_db

    assert _constraints("smart_mix_playlist_revisions", "p") == [
        "PRIMARY KEY (user_id)"
    ]
    assert _constraints("smart_mix_playlist_revisions", "f") == [
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
    ]
    # One row per playlist, deleted with it (STEM-D2: 1:1 with playlists).
    assert _constraints("smart_mix_playlists", "p") == ["PRIMARY KEY (playlist_id)"]
    assert _constraints("smart_mix_playlists", "f") == [
        "FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE",
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    ]
    # Work is per track: a track in two playlists has one job.
    assert _constraints("track_stem_jobs", "p") == ["PRIMARY KEY (track_id)"]
    assert _constraints("track_stem_jobs", "f") == [
        "FOREIGN KEY (track_id) REFERENCES library_tracks(id) ON DELETE CASCADE"
    ]


def test_a_job_has_one_of_four_states(pg_db):
    del pg_db
    track_id, _uid = _create_track("stem-job-state")

    with pytest.raises(IntegrityError):
        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO track_stem_jobs (track_id, state) "
                    "VALUES (:track_id, 'queued')"
                ),
                {"track_id": track_id},
            )


def test_tables_exist_after_migrating(pg_db):
    del pg_db
    with read_scope() as session:
        present = set(
            session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_name = ANY(:tables)"
                ),
                {"tables": list(TABLES)},
            ).scalars()
        )
    assert present == set(TABLES)
