"""Migration 158 adds the server's stem files (Smart Mix Stems, STEM-D6)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.smart_mix_stem_files_v158 import (
    create_smart_mix_stem_files_v158_schema,
    drop_smart_mix_stem_files_v158_schema,
)
from crate.db.tx import read_scope, transaction_scope
from tests.test_agent_access_migration import RecordingExecutor
from tests.test_smart_mix_playlists_migration import _constraints
from tests.test_smart_mix_repository import _create_track

MIGRATION = "crate.db.migrations.versions.158_smart_mix_stem_files"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_smart_mix_stem_files_v158_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "158" and migration.down_revision == "157"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_smart_mix_stem_files_v158_schema(expected)
    assert downgrade.statements == expected.statements
    assert downgrade.statements == ["DROP TABLE IF EXISTS track_stem_files"]


def test_one_file_per_track_deleted_with_it(pg_db):
    del pg_db

    assert _constraints("track_stem_files", "p") == ["PRIMARY KEY (track_id)"]
    assert _constraints("track_stem_files", "f") == [
        "FOREIGN KEY (track_id) REFERENCES library_tracks(id) ON DELETE CASCADE"
    ]
    track_id, _uid = _create_track("stem-file-cascade")
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_files (
                    track_id, path, bytes, separator_model, separator_version,
                    source_revision
                ) VALUES (
                    :track_id, 'ab/1.mp4', 10, 'htdemucs', 'htdemucs-onnx-1', :rev
                )
                """
            ),
            {"track_id": track_id, "rev": "a" * 64},
        )
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id = :id"), {"id": track_id}
        )
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM track_stem_files")).scalar() == 0
        )


@pytest.mark.parametrize(
    "path, size",
    [("/stems/ab/1.mp4", 10), ("../music/a.mp4", 10), ("ab/1.mp4", 0)],
)
def test_paths_are_relative_and_files_not_empty(pg_db, path: str, size: int):
    del pg_db
    track_id, _uid = _create_track(f"stem-file-check-{size}-{len(path)}")

    with pytest.raises(IntegrityError):
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO track_stem_files (
                        track_id, path, bytes, separator_model, separator_version,
                        source_revision
                    ) VALUES (
                        :track_id, :path, :size, 'htdemucs', 'htdemucs-onnx-1', :rev
                    )
                    """
                ),
                {"track_id": track_id, "path": path, "size": size, "rev": "a" * 64},
            )
