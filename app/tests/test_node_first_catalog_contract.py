from __future__ import annotations


def test_startup_bootstraps_one_local_node_without_env_flag(monkeypatch):
    from crate.federation import bootstrap

    created: dict[str, object] = {}
    node = {
        "node_uid": "a3b37ea1-6365-4a33-a7bb-153e41936527",
        "active_key_id": "key-1",
    }

    monkeypatch.setattr(bootstrap.repo, "get_local_node", lambda: None)
    monkeypatch.setattr(bootstrap, "ensure_keys_dir", lambda: None)
    monkeypatch.setattr(bootstrap, "generate_key_id", lambda: "key-1")
    monkeypatch.setattr(
        bootstrap, "generate_ed25519_key_pair", lambda: (object(), object())
    )
    monkeypatch.setattr(bootstrap, "store_private_key", lambda *_args: None)
    monkeypatch.setattr(bootstrap, "public_key_to_base64", lambda _key: "public")

    def ensure_local_node(**kwargs):
        created["ensure"] = kwargs
        return node

    def update_local_node(node_uid, **kwargs):
        created["update"] = {"node_uid": node_uid, **kwargs}

    monkeypatch.setattr(bootstrap.repo, "ensure_local_node", ensure_local_node)
    monkeypatch.setattr(bootstrap.repo, "update_local_node", update_local_node)

    result = bootstrap.bootstrap_federation_identity()

    assert result == node
    assert created["ensure"]["active_key_id"] == "key-1"
    assert created["update"]["node_uid"] == node["node_uid"]


def test_zero_approved_peers_syncs_without_a_network_call(monkeypatch):
    from crate.worker_handlers import federation

    monkeypatch.setattr(federation.repo, "list_peers", lambda trust_state: [])
    monkeypatch.setattr(
        federation,
        "_sync_single_peer_catalog",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("zero peers must not make a network request")
        ),
    )

    result = federation._handle_catalog_sync("task-1", {}, {})

    assert result == {"peers": 0, "synced": 0, "results": []}


def test_federation_policy_has_no_instance_enabled_switch():
    from crate.federation import policy

    assert not hasattr(policy, "FEDERATION_ENABLED")
    assert not hasattr(policy, "is_federation_enabled")
    assert not hasattr(policy, "require_federation_enabled")


def test_cold_single_node_queues_a_catalog_backfill_on_startup(monkeypatch):
    from crate import api
    from crate.db.repositories import global_catalog_state, tasks

    queued: dict[str, object] = {}
    monkeypatch.setattr(
        global_catalog_state, "get_catalog_state", lambda: {"status": "cold"}
    )
    monkeypatch.setattr(
        tasks,
        "create_task_dedup",
        lambda *args, **kwargs: queued.update({"args": args, "kwargs": kwargs}),
    )

    api._queue_global_catalog_bootstrap()

    assert queued["args"] == (
        "global_catalog_reconcile_full",
        {"triggered_by": "api_startup"},
    )
    assert queued["kwargs"] == {"dedup_key": "bootstrap:global-catalog"}


def test_ready_node_without_user_ref_projection_queues_a_catalog_backfill(monkeypatch):
    from crate import api
    from crate.db.repositories import global_catalog_state, tasks

    queued: dict[str, object] = {}
    monkeypatch.setattr(
        global_catalog_state,
        "get_catalog_state",
        lambda: {"status": "ready", "user_refs_backfilled_at": None},
    )
    monkeypatch.setattr(
        tasks,
        "create_task_dedup",
        lambda *args, **kwargs: queued.update({"args": args, "kwargs": kwargs}),
    )

    api._queue_global_catalog_bootstrap()

    assert queued["args"] == (
        "global_catalog_reconcile_full",
        {"triggered_by": "api_startup"},
    )
    assert queued["kwargs"] == {"dedup_key": "bootstrap:global-catalog"}


def test_ready_node_with_an_older_user_ref_backfill_queues_a_catalog_backfill(
    monkeypatch,
):
    from crate import api
    from crate.db.repositories import global_catalog_state, tasks
    from crate.db.repositories.global_user_library import (
        USER_LIBRARY_REFS_BACKFILL_VERSION,
    )

    queued: dict[str, object] = {}
    monkeypatch.setattr(
        global_catalog_state,
        "get_catalog_state",
        lambda: {
            "status": "ready",
            "user_refs_backfilled_at": "2026-07-13T10:00:00+00:00",
            "user_refs_backfill_version": USER_LIBRARY_REFS_BACKFILL_VERSION - 1,
        },
    )
    monkeypatch.setattr(
        tasks,
        "create_task_dedup",
        lambda *args, **kwargs: queued.update({"args": args, "kwargs": kwargs}),
    )

    api._queue_global_catalog_bootstrap()

    assert queued["args"] == (
        "global_catalog_reconcile_full",
        {"triggered_by": "api_startup"},
    )
    assert queued["kwargs"] == {"dedup_key": "bootstrap:global-catalog"}
