from contextlib import contextmanager
from unittest.mock import patch


class _QueryResult:
    def __init__(self, *, row=None, scalar_value=None):
        self.row = row
        self.scalar_value = scalar_value

    def mappings(self):
        return self

    def first(self):
        return self.row

    def one(self):
        return self.row

    def scalar(self):
        return self.scalar_value


def test_admin_global_catalog_status_reports_serving_mode(monkeypatch):
    from crate.db.queries import admin_global_catalog

    class _Session:
        def __init__(self):
            self.results = iter(
                [
                    _QueryResult(row=None),
                    _QueryResult(scalar_value=0),
                    _QueryResult(scalar_value=0),
                    _QueryResult(
                        row={
                            "active_assertions": 0,
                            "unmapped_assertions": 0,
                            "memberships": 0,
                        }
                    ),
                ]
            )

        def execute(self, *_args, **_kwargs):
            return next(self.results)

    @contextmanager
    def fake_read_scope():
        yield _Session()

    monkeypatch.setattr(admin_global_catalog, "get_global_catalog_counts", dict)
    monkeypatch.setattr(
        admin_global_catalog.global_catalog_state,
        "get_catalog_state",
        lambda: {"status": "backfilling", "last_full_reconcile_at": None},
    )
    monkeypatch.setattr(
        admin_global_catalog,
        "get_core_taxonomy_descriptor",
        lambda: {"taxonomy_id": "crate-core", "version": "1", "digest": "x"},
    )
    monkeypatch.setattr(admin_global_catalog, "read_scope", fake_read_scope)

    status = admin_global_catalog.get_global_catalog_admin_status()

    assert status["serving_mode"] == "local-fallback"


def test_admin_status_counts_only_non_merged_matches_as_ambiguous(monkeypatch):
    from crate.db.queries import admin_global_catalog

    executed_sql: list[str] = []

    class _Session:
        def __init__(self):
            self.results = iter(
                [
                    _QueryResult(row=None),
                    _QueryResult(scalar_value=0),
                    _QueryResult(scalar_value=7),
                    _QueryResult(
                        row={
                            "active_assertions": 0,
                            "unmapped_assertions": 0,
                            "memberships": 0,
                        }
                    ),
                ]
            )

        def execute(self, statement, *_args, **_kwargs):
            executed_sql.append(str(statement))
            return next(self.results)

    @contextmanager
    def fake_read_scope():
        yield _Session()

    monkeypatch.setattr(admin_global_catalog, "get_global_catalog_counts", dict)
    monkeypatch.setattr(
        admin_global_catalog.global_catalog_state,
        "get_catalog_state",
        lambda: {"status": "ready", "last_full_reconcile_at": "2026-07-25"},
    )
    monkeypatch.setattr(
        admin_global_catalog,
        "get_core_taxonomy_descriptor",
        lambda: {"taxonomy_id": "crate-core", "version": "1", "digest": "x"},
    )
    monkeypatch.setattr(admin_global_catalog, "read_scope", fake_read_scope)

    status = admin_global_catalog.get_global_catalog_admin_status()

    ambiguity_query = next(
        query for query in executed_sql if "match_confidence" in query
    )
    assert "match_confidence < 0.900" in ambiguity_query
    assert "source_deleted_at IS NULL" in ambiguity_query
    assert "NOT source_stale" in ambiguity_query
    assert status["ambiguous_candidate_count"] == 7


def test_admin_genre_projection_uses_the_active_assertion_index(pg_db, monkeypatch):
    del pg_db
    from crate.db.queries import admin_global_catalog
    from crate.db.tx import read_scope
    from sqlalchemy import text

    plans = []

    class _PlanRecordingSession:
        def __init__(self, session):
            self.session = session

        def execute(self, statement, *args, **kwargs):
            if "FROM global_catalog_genre_assertions" in str(statement):
                plans.append(
                    self.session.execute(
                        text(f"EXPLAIN (FORMAT JSON) {statement}")
                    ).scalar_one()
                )
            return self.session.execute(statement, *args, **kwargs)

    @contextmanager
    def indexed_scope():
        with read_scope() as session:
            # Prove this request can use an existing partial index, independently
            # of table size and the planner's preference for tiny test fixtures.
            session.execute(text("SET LOCAL enable_seqscan = off"))
            session.execute(text("SET LOCAL jit = off"))
            yield _PlanRecordingSession(session)

    monkeypatch.setattr(admin_global_catalog, "read_scope", indexed_scope)
    admin_global_catalog.get_global_catalog_admin_status()

    def indexes(plan):
        found = {plan["Index Name"]} if "Index Name" in plan else set()
        for child in plan.get("Plans", []):
            found.update(indexes(child))
        return found

    assert len(plans) == 1
    assert indexes(plans[0][0]["Plan"]) & {
        "idx_global_catalog_genre_assertions_active",
        "idx_global_catalog_genre_assertions_source",
    }


def test_admin_genre_projection_excludes_invalidated_history(pg_db):
    import uuid

    from crate.db.queries.admin_global_catalog import get_global_catalog_admin_status
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from sqlalchemy import text

    pg_db.upsert_artist(
        {"name": "Status Genre Artist", "entity_uid": str(uuid.uuid4())}
    )
    pg_db.set_artist_genres(
        "Status Genre Artist",
        [("rock", 0.8, "test"), ("unmapped-status-label", 0.6, "test")],
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1
    assert get_global_catalog_admin_status()["genre_projection"] == {
        "active_assertions": 2,
        "unmapped_assertions": 1,
        "memberships": 1,
    }

    pg_db.set_artist_genres("Status Genre Artist", [("jazz", 0.7, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1
    with read_scope() as session:
        history = session.execute(
            text(
                "SELECT COUNT(*) FROM global_catalog_genre_assertions "
                "WHERE invalidated_at IS NOT NULL"
            )
        ).scalar_one()
    assert history == 2
    assert get_global_catalog_admin_status()["genre_projection"] == {
        "active_assertions": 1,
        "unmapped_assertions": 0,
        "memberships": 1,
    }


def test_duplicate_candidates_exclude_sources_already_on_same_canonical(monkeypatch):
    from crate.db.queries import admin_global_catalog

    executed_sql: list[str] = []

    class _Rows:
        def mappings(self):
            return self

        def all(self):
            return []

    class _Session:
        def execute(self, statement, *_args, **_kwargs):
            executed_sql.append(str(statement))
            return _Rows()

    @contextmanager
    def fake_read_scope():
        yield _Session()

    monkeypatch.setattr(admin_global_catalog, "read_scope", fake_read_scope)

    assert admin_global_catalog.list_global_catalog_duplicate_candidates() == []
    query = executed_sql[0]
    assert "COUNT(DISTINCT global_entity_uid) > 1" in query
    assert "source_deleted_at IS NULL" in query
    assert "NOT source_stale" in query


def test_admin_global_catalog_status_endpoint(test_app):
    with patch(
        "crate.api.admin_global_catalog.get_global_catalog_admin_status",
        return_value={
            "enabled": True,
            "counts": {"artists": 1, "albums": 2, "tracks": 3, "sources": 4},
            "last_run": None,
            "stale_peer_count": 0,
            "ambiguous_candidate_count": 0,
        },
    ):
        response = test_app.get("/api/admin/global-catalog/status")

    assert response.status_code == 200
    assert response.json()["counts"]["tracks"] == 3


def test_admin_global_catalog_reconcile_enqueues_task(test_app):
    with patch(
        "crate.api.admin_global_catalog.create_task_dedup",
        return_value="task-global",
    ) as mocked:
        response = test_app.post(
            "/api/admin/global-catalog/reconcile",
            json={"mode": "full"},
        )

    assert response.status_code == 200
    assert response.json() == {"task_id": "task-global", "status": "queued"}
    mocked.assert_called_once_with(
        "global_catalog_reconcile_full",
        {"triggered_by": "admin"},
        dedup_key="global-catalog:full",
    )


def test_admin_global_catalog_decision_records_admin_user(test_app):
    with patch(
        "crate.api.admin_global_catalog.record_match_decision",
        return_value={"decision_id": "decision-1", "decision_type": "force_merge"},
    ) as mocked:
        response = test_app.post(
            "/api/admin/global-catalog/decisions",
            json={
                "entity_type": "album",
                "decision_type": "force_merge",
                "source_a": {"match_key": "album:a"},
                "source_b": {"match_key": "album:b"},
                "target_global_uid": "00000000-0000-0000-0000-000000000001",
                "reason": "same release",
            },
        )

    assert response.status_code == 200
    assert response.json()["decision_id"] == "decision-1"
    assert mocked.call_args.kwargs["admin_user_id"] == 1
