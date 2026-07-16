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

    monkeypatch.setattr(admin_global_catalog, "get_global_catalog_counts", lambda: {})
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
        dedup_key="manual:global_catalog_reconcile_full",
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
