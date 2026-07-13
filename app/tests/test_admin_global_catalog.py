from unittest.mock import patch


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
