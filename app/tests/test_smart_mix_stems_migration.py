"""Migration 156 stores stem analyses per track and producer (Smart Mix Stems)."""

from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.smart_mix_stems_v156 import (
    create_smart_mix_stems_v156_schema,
    drop_smart_mix_stems_v156_schema,
)
from crate.db.tx import read_scope, transaction_scope
from tests.test_agent_access_migration import RecordingExecutor
from tests.test_smart_mix_repository import _create_track

MIGRATION = "crate.db.migrations.versions.156_smart_mix_stems"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_smart_mix_stems_v156_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "156" and migration.down_revision == "155"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_smart_mix_stems_v156_schema(expected)
    assert (
        downgrade.statements
        == expected.statements
        == ["DROP TABLE IF EXISTS track_stem_signals"]
    )


def test_one_row_per_track_and_producer_kind(pg_db):
    del pg_db
    with read_scope() as session:
        primary_key = session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'track_stem_signals'::regclass AND contype = 'p'"
            )
        ).scalar_one()
        foreign_keys = (
            session.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = 'track_stem_signals'::regclass AND contype = 'f' "
                    "ORDER BY 1"
                )
            )
            .scalars()
            .all()
        )

    assert primary_key == "PRIMARY KEY (track_id, producer_kind)"
    assert foreign_keys == [
        "FOREIGN KEY (contributed_by) REFERENCES users(id) ON DELETE SET NULL",
        "FOREIGN KEY (track_id) REFERENCES library_tracks(id) ON DELETE CASCADE",
    ]


def _insert(track_id: int, **values) -> None:
    row = {
        "producer_kind": "decks",
        "producer": "crate-decks/0.4.0",
        "contributed_by": None,
        "levels": b"\x01\x02",
        "vocals": b"\x01\x02",
        **values,
    }
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_signals (
                    track_id, producer_kind, producer, separator_model,
                    separator_version, source_revision, hop_ms, drums_levels,
                    bass_levels, other_levels, vocals_levels, duration_ms,
                    contributed_by
                ) VALUES (
                    :track_id, :producer_kind, :producer, 'htdemucs',
                    'htdemucs-onnx-1', :revision, 250, :levels, :levels, :levels,
                    :vocals, 500, :contributed_by
                )
                """
            ),
            {"track_id": track_id, "revision": "a" * 64, **row},
        )


@pytest.mark.parametrize(
    "values",
    [
        # A Decks upload cannot pass for the server's own analysis.
        {"producer": "crate-server/2026.11.8"},
        {"producer_kind": "android", "producer": "crate-android/1.0"},
        # Only uploads name a contributor.
        {
            "producer_kind": "server",
            "producer": "crate-server/2026.11.8",
            "contributed_by": 1,
        },
        {"vocals": b"\x01"},
        {"levels": b"", "vocals": b""},
    ],
)
def test_the_table_rejects_inconsistent_rows(pg_db, values):
    del pg_db
    track_id, _uid = _create_track("stems-check")

    with pytest.raises(IntegrityError):
        _insert(track_id, **values)
