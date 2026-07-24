from unittest.mock import patch


def test_admin_federation_sync_all_catalogs_enqueues_all_peer_task(test_app):
    with (
        patch(
            "crate.db.repositories.tasks.create_task", return_value="task-fed"
        ) as task,
        patch("crate.api.admin_federation.repo.record_audit_event") as audit,
    ):
        response = test_app.post("/api/admin/federation/sync-catalog")

    assert response.status_code == 200
    assert response.json() == {"task_id": "task-fed", "status": "queued"}
    task.assert_called_once_with(
        "federation_sync_catalog",
        {"triggered_by": "admin"},
    )
    audit.assert_called_once()
    assert audit.call_args.kwargs["event_type"] == "catalog.sync_all.queued"
    assert audit.call_args.kwargs["status"] == "queued"
    assert audit.call_args.kwargs["metadata"] == {"task_id": "task-fed"}
