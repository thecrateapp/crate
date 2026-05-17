"""Contract tests for the Tasks API router."""

from unittest.mock import patch

import pytest


class TestListTasks:
    """GET /api/tasks — list background tasks."""

    def test_list_tasks_returns_all(self, test_app):
        snapshot = {
            "history": [
                {
                    "id": "t1",
                    "type": "scan",
                    "status": "completed",
                    "progress": "",
                    "error": None,
                    "result": {"issues": 5},
                    "params": {"only": "naming"},
                    "priority": 2,
                    "pool": "default",
                    "created_at": "2024-01-01T00:00:00",
                    "started_at": "2024-01-01T00:00:01",
                    "updated_at": "2024-01-01T00:01:00",
                },
                {
                    "id": "t2",
                    "type": "library_sync",
                    "status": "running",
                    "progress": "",
                    "error": None,
                    "result": None,
                    "params": {},
                    "priority": 1,
                    "pool": "fast",
                    "created_at": "2024-01-02T00:00:00",
                    "updated_at": "2024-01-02T00:00:30",
                },
            ]
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["id"] == "t1"
        assert data[1]["id"] == "t2"

    def test_list_tasks_filter_by_status_completed(self, test_app):
        snapshot = {
            "history": [
                {
                    "id": "t1",
                    "type": "scan",
                    "status": "completed",
                    "progress": "",
                    "result": None,
                },
                {
                    "id": "t2",
                    "type": "sync",
                    "status": "failed",
                    "progress": "",
                    "result": None,
                },
                {
                    "id": "t3",
                    "type": "import",
                    "status": "cancelled",
                    "progress": "",
                    "result": None,
                },
            ]
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks?status=completed")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "t1"

    def test_list_tasks_filter_by_status_running(self, test_app):
        snapshot = {
            "history": [
                {"id": "t1", "type": "scan", "status": "running"},
                {"id": "t2", "type": "sync", "status": "delegated"},
                {"id": "t3", "type": "import", "status": "completing"},
                {"id": "t4", "type": "other", "status": "completed"},
            ]
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks?status=running")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 3
        statuses = {t["status"] for t in data}
        assert statuses == {"running", "delegated", "completing"}

    def test_list_tasks_filter_by_status_no_match(self, test_app):
        snapshot = {"history": [{"id": "t1", "type": "scan", "status": "completed"}]}
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks?status=running")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_tasks_requires_auth(self, test_app):
        with patch(
            "crate.api.tasks._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.get("/api/tasks")

    def test_list_tasks_returns_task_fields(self, test_app):
        snapshot = {
            "history": [
                {
                    "id": "t1",
                    "type": "scan",
                    "status": "completed",
                    "progress": "",
                    "error": "something went wrong",
                    "result": {"key": "value"},
                    "params": {"only": "naming"},
                    "priority": 3,
                    "pool": "heavy",
                    "created_at": "2024-01-01T00:00:00",
                    "started_at": "2024-01-01T00:00:01",
                    "updated_at": "2024-01-01T00:01:00",
                },
            ]
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks")

        assert resp.status_code == 200
        task = resp.json()[0]
        assert task["id"] == "t1"
        assert task["type"] == "scan"
        assert task["status"] == "completed"
        assert task["error"] == "something went wrong"
        assert task["result"] == {"key": "value"}
        assert task["params"] == {"only": "naming"}
        assert task["priority"] == 3
        assert task["pool"] == "heavy"
        assert task["created_at"] == "2024-01-01T00:00:00"
        assert task["started_at"] == "2024-01-01T00:00:01"
        assert task["updated_at"] == "2024-01-01T00:01:00"

    def test_list_tasks_empty_history(self, test_app):
        snapshot = {"history": []}
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks")

        assert resp.status_code == 200
        assert resp.json() == []


class TestAdminTasksSnapshot:
    """GET /api/admin/tasks-snapshot — canonical admin tasks snapshot."""

    def test_returns_snapshot_payload(self, test_app):
        snapshot = {
            "snapshot": {
                "scope": "ops:tasks",
                "subject_key": "surface:100",
                "version": 2,
                "stale": False,
                "generation_ms": 8,
            },
            "live": {
                "engine": "dramatiq",
                "running_tasks": [],
                "pending_tasks": [],
                "recent_tasks": [],
                "worker_slots": {"max": 3, "active": 0},
                "queue_breakdown": {
                    "running": {"fast": 0, "default": 0, "heavy": 0},
                    "pending": {"fast": 0, "default": 0, "heavy": 0},
                },
                "db_heavy_gate": {"active": 0, "pending": 0, "blocking": False},
                "systems": {"postgres": True, "watcher": True},
            },
            "history": [
                {
                    "id": "t99",
                    "type": "scan",
                    "status": "running",
                    "progress": "",
                    "result": None,
                }
            ],
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/tasks-snapshot")

        assert resp.status_code == 200
        data = resp.json()
        assert data["snapshot"]["scope"] == "ops:tasks"
        assert data["live"]["engine"] == "dramatiq"
        assert len(data["history"]) == 1
        assert data["history"][0]["id"] == "t99"

    def test_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.get("/api/admin/tasks-snapshot")

    def test_accepts_limit_param(self, test_app):
        snapshot = {
            "snapshot": {
                "scope": "ops:tasks",
                "subject_key": "surface:50",
                "version": 1,
                "stale": False,
                "generation_ms": 8,
            },
            "live": {
                "worker_slots": {"max": 3, "active": 0},
                "systems": {"postgres": True, "watcher": True},
            },
            "history": [
                {"id": "a", "type": "scan", "status": "completed"},
                {"id": "b", "type": "sync", "status": "running"},
            ],
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/tasks-snapshot?limit=50")
            assert resp.status_code == 200

    def test_accepts_fresh_param(self, test_app):
        snapshot = {
            "snapshot": {
                "scope": "ops:tasks",
                "subject_key": "surface:100",
                "version": 1,
                "stale": False,
                "generation_ms": 8,
            },
            "live": {
                "worker_slots": {"max": 3, "active": 0},
                "systems": {"postgres": True, "watcher": True},
            },
            "history": [],
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/tasks-snapshot?fresh=true")
            assert resp.status_code == 200


class TestGetTaskDetail:
    """GET /api/tasks/{task_id} — get a single task."""

    def test_returns_task(self, test_app):
        mock_task = {
            "id": "t1",
            "type": "scan",
            "status": "running",
            "progress": '{"scanner": "naming", "done": 42}',
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01T00:00:00",
            "updated_at": "2024-01-01T00:01:00",
        }
        with patch("crate.api.tasks.get_task", return_value=mock_task):
            resp = test_app.get("/api/tasks/t1")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "t1"
        assert data["type"] == "scan"
        assert data["status"] == "running"
        assert data["progress"] == {"scanner": "naming", "done": 42}

    def test_progress_plain_string(self, test_app):
        mock_task = {
            "id": "t1",
            "type": "scan",
            "status": "running",
            "progress": "scanning files...",
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with patch("crate.api.tasks.get_task", return_value=mock_task):
            resp = test_app.get("/api/tasks/t1")

        assert resp.status_code == 200
        assert resp.json()["progress"] == "scanning files..."

    def test_progress_none(self, test_app):
        mock_task = {
            "id": "t1",
            "type": "scan",
            "status": "pending",
            "progress": None,
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with patch("crate.api.tasks.get_task", return_value=mock_task):
            resp = test_app.get("/api/tasks/t1")

        assert resp.status_code == 200
        assert resp.json()["progress"] is None

    def test_task_not_found(self, test_app):
        with patch("crate.api.tasks.get_task", return_value=None):
            resp = test_app.get("/api/tasks/nonexistent")

        assert resp.status_code == 404
        assert resp.json()["error"] == "Task not found"

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.tasks._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.get("/api/tasks/t1")


class TestCancelTask:
    """POST /api/tasks/{task_id}/cancel — cancel a task."""

    def test_cancels_pending_task(self, test_app):
        mock_task = {
            "id": "t1",
            "type": "scan",
            "status": "pending",
            "progress": "",
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.update_task") as mock_update,
            patch("crate.api.tasks.cancel_media_worker_job"),
        ):
            resp = test_app.post("/api/tasks/t1/cancel")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "cancelled"
        assert data["id"] == "t1"
        mock_update.assert_called_once_with("t1", status="cancelled")

    def test_cancels_running_task(self, test_app):
        mock_task = {
            "id": "t2",
            "type": "scan",
            "status": "running",
            "progress": "",
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.update_task") as mock_update,
            patch("crate.api.tasks.cancel_media_worker_job"),
        ):
            resp = test_app.post("/api/tasks/t2/cancel")

        assert resp.status_code == 200
        mock_update.assert_called_once_with("t2", status="cancelled")

    def test_rejects_completed_task(self, test_app):
        mock_task = {
            "id": "t3",
            "type": "scan",
            "status": "completed",
            "progress": "",
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.update_task") as mock_update,
        ):
            resp = test_app.post("/api/tasks/t3/cancel")

        assert resp.status_code == 400
        assert "Cannot cancel" in resp.json()["error"]
        mock_update.assert_not_called()

    def test_rejects_cancelled_task(self, test_app):
        mock_task = {
            "id": "t4",
            "type": "scan",
            "status": "cancelled",
            "progress": "",
            "error": None,
            "result": None,
            "params": {},
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.update_task") as mock_update,
        ):
            resp = test_app.post("/api/tasks/t4/cancel")

        assert resp.status_code == 400
        mock_update.assert_not_called()

    def test_task_not_found(self, test_app):
        with (
            patch("crate.api.tasks.get_task", return_value=None),
            patch("crate.api.tasks.update_task") as mock_update,
        ):
            resp = test_app.post("/api/tasks/nonexistent/cancel")

        assert resp.status_code == 404
        assert resp.json()["error"] == "Task not found"
        mock_update.assert_not_called()

    def test_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/tasks/t1/cancel")


class TestTaskEnqueue:
    """POST /api/tasks/sync-library, /api/tasks/backfill-*, etc."""

    def test_enqueue_sync_library(self, test_app):
        with (
            patch("crate.api.tasks.list_tasks", return_value=[]),
            patch("crate.api.tasks.create_task", return_value="sync123"),
        ):
            resp = test_app.post("/api/tasks/sync-library")

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "sync123"
        assert resp.json()["status"] == "started"

    def test_enqueue_sync_library_already_running(self, test_app):
        with patch("crate.api.tasks.list_tasks", side_effect=[[{"id": "x"}], []]):
            resp = test_app.post("/api/tasks/sync-library")

        assert resp.status_code == 409

    def test_enqueue_sync_library_already_pending(self, test_app):
        with patch("crate.api.tasks.list_tasks", side_effect=[[], [{"id": "p"}]]):
            resp = test_app.post("/api/tasks/sync-library")

        assert resp.status_code == 409

    def test_enqueue_backfill_fingerprints(self, test_app):
        with (
            patch("crate.api.tasks.list_tasks", return_value=[]),
            patch("crate.api.tasks.create_task", return_value="fp123"),
        ):
            resp = test_app.post("/api/tasks/backfill-track-fingerprints")

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "fp123"

    def test_enqueue_backfill_fingerprints_already_running(self, test_app):
        with patch("crate.api.tasks.list_tasks", side_effect=[[{"id": "x"}], []]):
            resp = test_app.post("/api/tasks/backfill-track-fingerprints")

        assert resp.status_code == 409

    def test_enqueue_backfill_similarities(self, test_app):
        with (
            patch("crate.api.tasks.list_tasks", return_value=[]),
            patch("crate.api.tasks.create_task", return_value="sim123"),
        ):
            resp = test_app.post("/api/tasks/backfill-similarities")

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "sim123"

    def test_enqueue_sync_shows(self, test_app):
        with (
            patch("crate.api.tasks.list_tasks", return_value=[]),
            patch("crate.api.tasks.create_task", return_value="shows123"),
        ):
            resp = test_app.post("/api/tasks/sync-shows")

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "shows123"

    def test_enqueue_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/tasks/sync-library")


class TestTaskCleanByStatus:
    """POST /api/tasks/clean/{status} — delete tasks by status."""

    def test_clean_completed(self, test_app):
        with patch(
            "crate.api.tasks.delete_tasks_by_status", return_value=5
        ) as mock_del:
            resp = test_app.post("/api/tasks/clean/completed")

        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] == 5
        assert data["status"] == "completed"
        mock_del.assert_called_once_with("completed")

    def test_clean_cancelled(self, test_app):
        with patch(
            "crate.api.tasks.delete_tasks_by_status", return_value=3
        ) as mock_del:
            resp = test_app.post("/api/tasks/clean/cancelled")

        assert resp.status_code == 200
        assert resp.json()["deleted"] == 3
        mock_del.assert_called_once_with("cancelled")

    def test_clean_failed(self, test_app):
        with patch(
            "crate.api.tasks.delete_tasks_by_status", return_value=2
        ) as mock_del:
            resp = test_app.post("/api/tasks/clean/failed")

        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        mock_del.assert_called_once_with("failed")

    def test_clean_invalid_status(self, test_app):
        resp = test_app.post("/api/tasks/clean/pending")

        assert resp.status_code == 400
        assert "Status must be one of" in resp.json()["detail"]

    def test_clean_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/tasks/clean/completed")


class TestTaskCleanup:
    """POST /api/tasks/cleanup — delete old finished tasks."""

    def test_cleanup_default_days(self, test_app):
        with (
            patch(
                "crate.api.tasks.delete_old_finished_tasks", return_value=10
            ) as mock_del,
        ):
            resp = test_app.post("/api/tasks/cleanup")

        assert resp.status_code == 200
        assert resp.json()["deleted"] == 10
        mock_del.assert_called_once()

    def test_cleanup_custom_days(self, test_app):
        with (
            patch(
                "crate.api.tasks.delete_old_finished_tasks", return_value=3
            ) as mock_del,
        ):
            resp = test_app.post("/api/tasks/cleanup", json={"older_than_days": 30})

        assert resp.status_code == 200
        assert resp.json()["deleted"] == 3
        mock_del.assert_called_once()

    def test_cleanup_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/tasks/cleanup")


class TestTaskRetry:
    """POST /api/tasks/retry — retry a failed task."""

    def test_retry_success(self, test_app):
        mock_task = {
            "id": "t-fail",
            "type": "scan",
            "status": "failed",
            "progress": "",
            "params": {"only": "naming"},
            "error": "something broke",
            "result": None,
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.create_task", return_value="t-retry") as mock_create,
        ):
            resp = test_app.post("/api/tasks/retry", json={"task_id": "t-fail"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["task_id"] == "t-retry"
        assert data["original_id"] == "t-fail"
        mock_create.assert_called_once_with("scan", {"only": "naming"})

    def test_retry_with_string_params(self, test_app):
        mock_task = {
            "id": "t-fail",
            "type": "enrich",
            "status": "failed",
            "progress": "",
            "params": '{"artist": "Tool"}',
            "error": None,
            "result": None,
            "created_at": "2024-01-01",
            "updated_at": "2024-01-01",
        }
        with (
            patch("crate.api.tasks.get_task", return_value=mock_task),
            patch("crate.api.tasks.create_task", return_value="t-retry") as mock_create,
        ):
            resp = test_app.post("/api/tasks/retry", json={"task_id": "t-fail"})

        assert resp.status_code == 200
        mock_create.assert_called_once_with("enrich", {"artist": "Tool"})

    def test_retry_no_task_id(self, test_app):
        resp = test_app.post("/api/tasks/retry", json={"task_id": ""})

        assert resp.status_code == 400
        assert resp.json()["error"] == "task_id required"

    def test_retry_task_not_found(self, test_app):
        with patch("crate.api.tasks.get_task", return_value=None):
            resp = test_app.post("/api/tasks/retry", json={"task_id": "nope"})

        assert resp.status_code == 404
        assert resp.json()["error"] == "Task not found"

    def test_retry_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/tasks/retry", json={"task_id": "t1"})


class TestWorkerCancelAll:
    """POST /api/worker/cancel-all — cancel all pending and running tasks."""

    def test_cancel_all(self, test_app):
        running = [{"id": "r1", "type": "scan"}]
        pending = [{"id": "p1", "type": "sync"}, {"id": "p2", "type": "import"}]
        with (
            patch("crate.api.tasks.list_tasks", side_effect=[running, pending]),
            patch("crate.api.tasks.update_task") as mock_update,
            patch("crate.api.tasks.cancel_media_worker_job") as mock_cancel_job,
        ):
            resp = test_app.post("/api/worker/cancel-all")

        assert resp.status_code == 200
        assert resp.json()["cancelled"] == 3
        assert mock_update.call_count == 3
        assert mock_cancel_job.call_count == 3

    def test_cancel_all_none(self, test_app):
        with (
            patch("crate.api.tasks.list_tasks", return_value=[]),
            patch("crate.api.tasks.update_task") as mock_update,
        ):
            resp = test_app.post("/api/worker/cancel-all")

        assert resp.status_code == 200
        assert resp.json()["cancelled"] == 0
        mock_update.assert_not_called()

    def test_cancel_all_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/worker/cancel-all")


class TestWorkerSlots:
    """POST /api/worker/slots — update worker slot limits."""

    def test_set_slots(self, test_app):
        with (
            patch("crate.api.tasks.get_setting", return_value=None),
            patch("crate.api.tasks.set_setting") as mock_set_setting,
        ):
            resp = test_app.post("/api/worker/slots", json={"slots": 5, "min_slots": 3})

        assert resp.status_code == 200
        data = resp.json()
        assert data["max_slots"] == 5
        assert data["min_slots"] == 2
        assert mock_set_setting.call_count == 2

    def test_set_slots_out_of_range(self, test_app):
        resp = test_app.post("/api/worker/slots", json={"slots": 0})

        assert resp.status_code == 400
        assert "1-10" in resp.json()["error"]

    def test_set_slots_too_high(self, test_app):
        resp = test_app.post("/api/worker/slots", json={"slots": 11})

        assert resp.status_code == 400

    def test_set_min_slots_out_of_range(self, test_app):
        resp = test_app.post("/api/worker/slots", json={"min_slots": 100})

        assert resp.status_code == 400

    def test_set_slots_returns_defaults_when_not_set(self, test_app):
        with (
            patch("crate.api.tasks.get_setting", return_value=None),
            patch("crate.api.tasks.set_setting"),
        ):
            resp = test_app.post("/api/worker/slots", json={})

        assert resp.status_code == 200
        assert resp.json()["max_slots"] == 5
        assert resp.json()["min_slots"] == 2

    def test_set_slots_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/worker/slots", json={"slots": 5})


class TestWorkerRestart:
    """POST /api/worker/restart — restart worker container."""

    def test_restart_success(self, test_app):
        with patch("crate.api.tasks.restart_container", return_value=True):
            resp = test_app.post("/api/worker/restart")

        assert resp.status_code == 200
        assert resp.json()["status"] == "restarting"

    def test_restart_failure(self, test_app):
        with patch("crate.api.tasks.restart_container", return_value=False):
            resp = test_app.post("/api/worker/restart")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Restart failed"

    def test_restart_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/worker/restart")


class TestWorkerSchedules:
    """GET /api/worker/schedules, POST /api/worker/schedules."""

    def test_get_schedules(self, test_app):
        schedules = {"library_sync": 1800, "enrich_artists": 86400}
        with (
            patch("crate.api.tasks.get_schedules", return_value=schedules),
            patch("crate.api.tasks.get_setting", return_value=None),
        ):
            resp = test_app.get("/api/worker/schedules")

        assert resp.status_code == 200
        data = resp.json()
        assert "library_sync" in data
        assert data["library_sync"]["interval_seconds"] == 1800
        assert data["library_sync"]["enabled"] is True

    def test_get_schedules_disabled(self, test_app):
        schedules = {"old_job": 0}
        with (
            patch("crate.api.tasks.get_schedules", return_value=schedules),
            patch("crate.api.tasks.get_setting", return_value=None),
        ):
            resp = test_app.get("/api/worker/schedules")

        assert resp.status_code == 200
        assert resp.json()["old_job"]["enabled"] is False
        assert resp.json()["old_job"]["interval_human"] == "disabled"

    def test_update_schedules(self, test_app):
        current = {"library_sync": 1800, "enrich_artists": 86400}
        with (
            patch("crate.api.tasks.get_schedules", return_value=current),
            patch("crate.api.tasks.set_schedules") as mock_set,
        ):
            resp = test_app.post(
                "/api/worker/schedules",
                json={"library_sync": 3600, "new_task": 7200},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["schedules"]["library_sync"] == 3600
        assert data["schedules"]["new_task"] == 7200
        assert data["schedules"]["enrich_artists"] == 86400
        mock_set.assert_called_once()

    def test_update_schedules_requires_admin(self, test_app):
        with patch(
            "crate.api.tasks._require_admin", side_effect=Exception("forbidden")
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.post("/api/worker/schedules", json={})


class TestWorkerStatus:
    """GET /api/worker/status — worker status."""

    def test_returns_snapshot_data(self, test_app):
        with (
            patch(
                "crate.db.ops_snapshot.get_cached_ops_snapshot",
                return_value={
                    "live": {
                        "engine": "dramatiq",
                        "running_tasks": [
                            {"id": "r1", "type": "scan", "pool": "default"}
                        ],
                        "pending_tasks": [
                            {"id": "p1", "type": "sync", "pool": "default"}
                        ],
                    }
                },
            ),
        ):
            resp = test_app.get("/api/worker/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["engine"] == "dramatiq"
        assert data["running"] == 1
        assert data["pending"] == 1

    def test_falls_back_to_list_tasks(self, test_app):
        running = [{"id": "r1", "type": "scan", "pool": "default"}]
        pending = [{"id": "p1", "type": "sync", "pool": "default"}]
        with (
            patch(
                "crate.db.ops_snapshot.get_cached_ops_snapshot",
                side_effect=Exception("no snapshot"),
            ),
            patch("crate.api.tasks.list_tasks", side_effect=[running, pending]),
            patch("crate.api.tasks.get_cache", return_value={}),
        ):
            resp = test_app.get("/api/worker/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] == 1
        assert data["pending"] == 1

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.tasks._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.get("/api/worker/status")
