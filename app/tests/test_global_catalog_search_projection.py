from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]


def test_search_document_migration_defines_resumable_indexed_projection():
    migration = (
        ROOT / "app/crate/db/migrations/versions/074_global_catalog_search_documents.py"
    ).read_text()

    assert 'revision = "074"' in migration
    assert 'down_revision = "073"' in migration
    assert "global_catalog_search_documents" in migration
    assert "global_catalog_search_projection_state" in migration
    assert "'refreshing'" in migration
    assert "'degraded'" in migration
    assert "GENERATED ALWAYS AS" in migration
    assert "USING gin(search_vector)" in migration
    assert "gin_trgm_ops" in migration
    assert "PRIMARY KEY (entity_type, global_entity_uid)" in migration
    assert "DROP TABLE IF EXISTS global_catalog_search_documents" in migration


class _MappingsResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _SearchSession:
    def __init__(self, rows):
        self.rows = rows
        self.executions = []

    def execute(self, statement, params):
        self.executions.append((str(statement), params))
        return _MappingsResult(self.rows)


def test_global_search_uses_one_materialized_query(monkeypatch):
    from crate.db.queries import global_catalog

    rows = [
        {
            "entity_type": "artist",
            "payload_json": {
                "name": "High Vis",
                "global_artist_uid": "artist-1",
                "availability": {"healthy": True},
            },
            "source_count": 2,
            "projection_ready": True,
        },
        {
            "entity_type": "__projection__",
            "payload_json": {},
            "source_count": 0,
            "projection_ready": True,
        },
    ]
    session = _SearchSession(rows)

    @contextmanager
    def fake_scope():
        yield session

    monkeypatch.setattr(global_catalog, "read_scope", fake_scope)

    result = global_catalog.search_global_catalog(
        "High Vis", limit=12, include_sources=True
    )

    assert len(session.executions) == 1
    sql, params = session.executions[0]
    assert "global_catalog_search_documents" in sql
    assert "ROW_NUMBER() OVER" in sql
    assert params["limit"] == 12
    assert result == {
        "artists": [
            {
                "name": "High Vis",
                "global_artist_uid": "artist-1",
                "availability": {"healthy": True},
                "source_count": 2,
            }
        ],
        "albums": [],
        "tracks": [],
    }


def test_global_search_uses_compatibility_query_while_projection_warms(monkeypatch):
    from crate.db.queries import global_catalog

    session = _SearchSession(
        [
            {
                "entity_type": "__projection__",
                "payload_json": {},
                "source_count": 0,
                "projection_ready": False,
            }
        ]
    )

    @contextmanager
    def fake_scope():
        yield session

    expected = {"artists": [{"name": "Local"}], "albums": [], "tracks": []}
    monkeypatch.setattr(global_catalog, "read_scope", fake_scope)
    monkeypatch.setattr(
        global_catalog,
        "_search_global_catalog_legacy",
        lambda *args, **kwargs: expected,
    )

    assert global_catalog.search_global_catalog("Local") == expected
    assert len(session.executions) == 1


def test_search_projection_upsert_carries_human_routes_and_health(monkeypatch):
    from crate.db import global_catalog_search_projection as projection

    class Session:
        def __init__(self):
            self.calls = []

        def execute(self, statement, params):
            self.calls.append((str(statement), params))
            return SimpleNamespace(rowcount=1)

    session = Session()
    projection.upsert_global_catalog_search_document(
        "artist", "11111111-1111-4111-8111-111111111111", session=session
    )

    assert len(session.calls) == 1
    sql, params = session.calls[0]
    assert "global_catalog_search_documents" in sql
    assert "public_slug" in sql
    assert "has_healthy_source" in sql
    assert "ON CONFLICT (entity_type, global_entity_uid)" in sql
    assert params["global_entity_uids"] == ["11111111-1111-4111-8111-111111111111"]


def test_search_projection_batch_upserts_all_entities_in_one_statement():
    from crate.db import global_catalog_search_projection as projection

    class Session:
        def __init__(self):
            self.calls = []

        def execute(self, statement, params):
            self.calls.append((str(statement), params))

    session = Session()
    uids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
    ]

    projection.upsert_global_catalog_search_documents("track", uids, session=session)

    assert len(session.calls) == 1
    sql, params = session.calls[0]
    assert "ANY(CAST(:global_entity_uids AS uuid[]))" in sql
    assert params == {"global_entity_uids": uids}


def test_search_projection_cursor_is_json_serializable():
    from crate.db.global_catalog_search_projection import next_search_projection_cursor

    cursor = next_search_projection_cursor(
        "artist", "11111111-1111-4111-8111-111111111111", completed_kind=True
    )

    assert json.loads(json.dumps(cursor)) == {
        "entity_type": "album",
        "after_uid": None,
    }


def test_search_projection_status_reads_singleton_state(monkeypatch):
    from crate.db import global_catalog_search_projection as projection

    class _Result:
        def scalar_one_or_none(self):
            return "refreshing"

    class _Session:
        def execute(self, statement):
            assert "global_catalog_search_projection_state" in str(statement)
            return _Result()

    class _Scope:
        def __enter__(self):
            return _Session()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(projection, "read_scope", _Scope)

    assert projection.get_global_catalog_search_projection_status() == "refreshing"
