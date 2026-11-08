"""Migration 155 stores the ranked candidates of the Smart Mix backfill."""

from importlib import import_module

from sqlalchemy import text

from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.smart_mix_backfill_candidates_v155 import (
    create_smart_mix_backfill_candidates_v155_schema,
    drop_smart_mix_backfill_candidates_v155_schema,
)
from crate.db.tx import read_scope
from tests.test_agent_access_migration import RecordingExecutor

MIGRATION = "crate.db.migrations.versions.155_smart_mix_backfill_candidates"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_smart_mix_backfill_candidates_v155_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "155" and migration.down_revision == "154"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_smart_mix_backfill_candidates_v155_schema(expected)
    assert (
        downgrade.statements
        == expected.statements
        == ["DROP TABLE IF EXISTS smart_mix_backfill_candidates"]
    )


def test_the_candidates_are_an_unlogged_cache_read_in_claim_order(pg_db):
    del pg_db
    with read_scope() as session:
        persistence = session.execute(
            text(
                "SELECT relpersistence FROM pg_class "
                "WHERE relname = 'smart_mix_backfill_candidates'"
            )
        ).scalar_one()
        indexes = dict(
            session.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE tablename = 'smart_mix_backfill_candidates'"
                )
            ).all()
        )

    # A crash empties an unlogged table; the next claim ranks again.
    assert persistence == "u"
    order_index = indexes["idx_smart_mix_backfill_candidates_order"]
    assert "(promotion, priority, track_id)" in order_index
