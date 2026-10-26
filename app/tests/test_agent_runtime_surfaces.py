"""Task snapshots expose cancellation and configured admission truthfully."""

from unittest.mock import Mock

import pytest

from crate.api.schemas.analytics import ActivityLiveResponse
import crate.db.admin_tasks_surface as admin_tasks_surface
from crate.worker_handlers import compute_dir_hash

REQUESTED_AT = "2026-10-16T10:00:00Z"
ACKNOWLEDGED_AT = "2026-10-16T10:00:03Z"


def _task(*, status="running", acknowledged_at=None):
    return {
        "id": "maintenance-1",
        "type": "quality_check",
        "status": status,
        "progress": '{"phase":"checking"}',
        "params": '{"scope":"global"}',
        "created_at": REQUESTED_AT,
        "updated_at": REQUESTED_AT,
        "cancellation_requested_at": REQUESTED_AT,
        "cancellation_acknowledged_at": acknowledged_at,
    }


@pytest.mark.parametrize(
    ("status", "acknowledged_at"),
    [("running", None), ("delegated", None), ("cancelled", ACKNOWLEDGED_AT)],
)
def test_task_serialization_preserves_actual_status_and_cancellation_evidence(
    status,
    acknowledged_at,
):
    serialized = admin_tasks_surface.serialize_task_surface(
        _task(status=status, acknowledged_at=acknowledged_at)
    )

    assert serialized["status"] == status
    assert serialized["cancellation_requested_at"] == REQUESTED_AT
    assert serialized["cancellation_acknowledged_at"] == acknowledged_at
    assert serialized["progress"] == {"phase": "checking"}
    assert serialized["params"] == {"scope": "global"}


@pytest.mark.parametrize("has_worker_snapshot", [True, False])
def test_task_surface_keeps_configured_admission_separate_from_process_slots(
    monkeypatch,
    has_worker_snapshot,
):
    worker_state = {
        "engine": "dramatiq",
        "running_tasks": [_task()],
        "pending_tasks": [],
        "recent_tasks": [],
        "worker_slots": {"max": 32, "active": 1},
        "queue_breakdown": {"running": {"maintenance": 1}, "pending": {}},
        "db_heavy_gate": {"active": 0, "pending": 0, "blocking": False},
        "systems": {"postgres": True, "watcher": True},
    }
    live = Mock(return_value=worker_state if has_worker_snapshot else None)
    activity = Mock(return_value={**worker_state, "running_count": 1})
    history = Mock(return_value=[_task()])
    policy = Mock(
        return_value={
            "policy": {"max_running": 7},
            "configured_revision": 9,
            "effective_revision": 8,
        }
    )
    monkeypatch.setattr(admin_tasks_surface, "get_worker_live_state", live)
    monkeypatch.setattr(admin_tasks_surface, "get_task_activity_snapshot", activity)
    monkeypatch.setattr(admin_tasks_surface, "list_tasks", history)
    monkeypatch.setattr(
        "crate.db.queries.agent_runtime_policy.read_runtime_policy_state", policy
    )

    surface = admin_tasks_surface.build_tasks_surface_payload(limit=11)

    assert surface["live"]["admission_policy"] == {
        "max_running": 7,
        "configured_revision": 9,
        "effective_revision": 8,
    }
    assert surface["live"]["worker_slots"] == {
        "max": 32 if has_worker_snapshot else admin_tasks_surface.DEFAULT_MAX_WORKERS,
        "active": 1,
    }
    assert surface["history"][0]["status"] == "running"
    assert surface["history"][0]["cancellation_requested_at"] == REQUESTED_AT
    assert surface["history"][0]["cancellation_acknowledged_at"] is None
    live.assert_called_once_with()
    history.assert_called_once_with(limit=11)
    policy.assert_called_once_with()
    if has_worker_snapshot:
        activity.assert_not_called()
    else:
        activity.assert_called_once_with(
            running_limit=25, pending_limit=25, recent_limit=10
        )


@pytest.mark.parametrize("effective_revision", [None, 8])
def test_activity_response_retains_configured_and_effective_admission_revisions(
    effective_revision,
):
    admission = {
        "max_running": 7,
        "configured_revision": 9,
        "effective_revision": effective_revision,
    }
    response = ActivityLiveResponse.model_validate(
        {
            "worker_slots": {"max": 32, "active": 1},
            "systems": {"postgres": True, "watcher": True},
            "admission_policy": admission,
        }
    ).model_dump(mode="json")

    assert response["admission_policy"] == admission
    assert response["worker_slots"] == {"max": 32, "active": 1}


def test_audio_directory_hash_preserves_legacy_md5_and_ignores_unrelated_files(
    tmp_path,
):
    (tmp_path / "02.mp3").write_bytes(b"mp3")
    disc = tmp_path / "disc1"
    disc.mkdir()
    (disc / "01.FLAC").write_bytes(b"audio")
    (tmp_path / "cover.jpg").write_bytes(b"cover")

    before = compute_dir_hash(tmp_path)
    (tmp_path / "cover.jpg").write_bytes(b"replacement artwork")
    (disc / "notes.txt").write_text("Unrelated metadata")

    assert before == "4276b5e0c36d2f98fffa049c1e4388cf"
    assert compute_dir_hash(tmp_path) == before
