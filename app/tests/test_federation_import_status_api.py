from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _request(user_id: int, role: str = "user") -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": user_id, "email": f"user-{user_id}@example.test", "role": role}
        )
    )


def test_import_status_is_visible_to_request_owner(monkeypatch):
    from crate.api import federation_remote
    from crate.federation import imports

    monkeypatch.setattr(
        imports,
        "get_import_request",
        lambda _request_id: {
            "request_id": "request-1",
            "requested_by_user_id": 7,
            "status": "downloading",
            "received_bytes": 25,
            "expected_bytes": 100,
            "metadata_json": {"task_id": "task-1", "private": "not-exposed"},
            "node_uid": "node-b",
        },
    )

    result = federation_remote.get_remote_import_status(
        "request-1",
        _request(7),  # type: ignore[arg-type]
    )

    assert result == {
        "request_id": "request-1",
        "status": "downloading",
        "task_id": "task-1",
        "expected_bytes": 100,
        "received_bytes": 25,
        "failure_reason": None,
    }


def test_import_status_rejects_other_users(monkeypatch):
    from crate.api import federation_remote
    from crate.federation import imports

    monkeypatch.setattr(
        imports,
        "get_import_request",
        lambda _request_id: {
            "request_id": "request-1",
            "requested_by_user_id": 8,
            "status": "awaiting_approval",
            "metadata_json": {},
        },
    )

    with pytest.raises(HTTPException) as exc:
        federation_remote.get_remote_import_status(
            "request-1",
            _request(7),  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 404


def test_import_request_retry_returns_existing_task_id(monkeypatch):
    from crate.api import federation_remote
    from crate.federation import global_source_resolver, imports

    monkeypatch.setattr(
        global_source_resolver,
        "resolve_global_source",
        lambda **_kwargs: {
            "kind": "remote",
            "node_uid": "node-b",
            "remote_entity_uid": "album-remote-1",
            "source_payload": {"title": "Pedals"},
        },
    )
    monkeypatch.setattr(
        federation_remote,
        "_get_peer",
        lambda _node_uid: {
            "node_uid": "node-b",
            "default_grant_preset": "trusted_library",
            "trust_state": "approved",
        },
    )
    monkeypatch.setattr(imports, "can_request_import", lambda _peer: (True, None))
    monkeypatch.setattr(
        imports,
        "create_import_request",
        lambda **_kwargs: {
            "request_id": "request-1",
            "status": "downloading",
            "metadata_json": {"task_id": "task-1"},
        },
    )

    result = federation_remote.request_global_album_import(
        "00000000-0000-0000-0000-000000000001",
        _request(7, "admin"),  # type: ignore[arg-type]
    )

    assert result["task_id"] == "task-1"
    assert result["status"] == "downloading"


def test_repeated_admin_approval_does_not_enqueue_a_second_task(monkeypatch):
    from crate.api import admin_federation
    from crate.db.repositories import tasks
    from crate.federation import imports

    existing = {
        "request_id": "request-1",
        "node_uid": "node-b",
        "remote_entity_uid": "album-1",
        "title": "Album",
        "status": "approved",
        "metadata_json": {"task_id": "task-1"},
    }
    monkeypatch.setattr(admin_federation, "require_permission", lambda *_args: None)
    monkeypatch.setattr(imports, "get_import_request", lambda _rid: existing)
    monkeypatch.setattr(
        imports,
        "approve_import_request",
        lambda *_args, **_kwargs: pytest.fail("approval was repeated"),
    )
    monkeypatch.setattr(
        tasks,
        "create_task",
        lambda *_args, **_kwargs: pytest.fail("duplicate task was enqueued"),
    )

    result = admin_federation.approve_import_endpoint(
        "request-1",
        _request(1, "admin"),  # type: ignore[arg-type]
    )

    assert result["metadata_json"]["task_id"] == "task-1"
