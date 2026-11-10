from unittest.mock import patch

import pytest


def test_admin_federation_sync_all_catalogs_enqueues_all_peer_task(test_app):
    with (
        patch(
            "crate.db.repositories.tasks.create_task", return_value="duplicate"
        ) as serial,
        patch(
            "crate.db.repositories.tasks.create_task_dedup", return_value="task-fed"
        ) as task,
        patch("crate.api.admin_federation.repo.record_audit_event") as audit,
    ):
        response = test_app.post("/api/admin/federation/sync-catalog")

    assert response.status_code == 200
    assert response.json() == {"task_id": "task-fed", "status": "queued"}
    task.assert_called_once_with(
        "federation_sync_catalog",
        {"triggered_by": "admin"},
        dedup_key="federation:sync:all",
    )
    serial.assert_not_called()
    audit.assert_called_once()
    assert audit.call_args.kwargs["event_type"] == "catalog.sync_all.queued"
    assert audit.call_args.kwargs["status"] == "queued"
    assert audit.call_args.kwargs["metadata"] == {"task_id": "task-fed"}


@pytest.mark.parametrize("peer_uid", [None, "11111111-1111-4111-8111-111111111111"])
def test_admin_catalog_sync_reports_an_existing_task_without_duplicating(
    test_app, peer_uid
):
    url = (
        "/api/admin/federation/sync-catalog"
        if peer_uid is None
        else f"/api/admin/federation/nodes/{peer_uid}/sync-catalog"
    )
    with (
        patch(
            "crate.db.repositories.tasks.create_task", return_value="duplicate"
        ) as serial,
        patch(
            "crate.db.repositories.tasks.create_task_dedup", return_value=None
        ) as task,
        patch(
            "crate.api.admin_federation.repo.get_peer",
            return_value={"trust_state": "approved", "disabled_at": None},
        ),
        patch("crate.api.admin_federation.repo.record_audit_event"),
    ):
        response = test_app.post(url)

    assert response.status_code == 200
    assert response.json() == {"task_id": None, "status": "already_running"}
    assert task.call_args.kwargs["dedup_key"] == f"federation:sync:{peer_uid or 'all'}"
    serial.assert_not_called()
