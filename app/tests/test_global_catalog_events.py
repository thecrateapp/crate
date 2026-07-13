def test_reconciliation_emits_batch_domain_events(monkeypatch):
    from crate.federation import global_reconciliation

    events: list[tuple[str, dict, str, str]] = []

    class FakeTx:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(global_reconciliation, "iter_local_sources", lambda **_: [])
    monkeypatch.setattr(global_reconciliation, "transaction_scope", lambda: FakeTx())
    monkeypatch.setattr(global_reconciliation, "_insert_run", lambda *_, **__: None)
    monkeypatch.setattr(global_reconciliation, "_complete_run", lambda *_, **__: None)
    monkeypatch.setattr(
        global_reconciliation,
        "append_domain_event",
        lambda event_type, payload=None, scope=None, subject_key=None, session=None: events.append(
            (event_type, payload or {}, scope or "", subject_key or "")
        ),
    )

    result = global_reconciliation.reconcile_local_catalog()

    assert result["status"] == "completed"
    assert [event[0] for event in events] == [
        "global_catalog.reconcile.started",
        "global_catalog.reconcile.completed",
    ]
    assert all(event[2] == "global_catalog" for event in events)


def test_reconciliation_failure_emits_failed_event(monkeypatch):
    from crate.federation import global_reconciliation

    events: list[tuple[str, dict, str, str]] = []

    def broken_sources(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(global_reconciliation, "iter_local_sources", broken_sources)
    monkeypatch.setattr(
        global_reconciliation,
        "append_domain_event",
        lambda event_type, payload=None, scope=None, subject_key=None, session=None: events.append(
            (event_type, payload or {}, scope or "", subject_key or "")
        ),
    )

    try:
        global_reconciliation.reconcile_local_catalog()
    except RuntimeError:
        pass

    assert events[-1][0] == "global_catalog.reconcile.failed"
    assert events[-1][1]["error"] == "boom"


def test_peer_health_change_invalidates_remote_source_cache(monkeypatch):
    from crate.federation import health

    invalidations: list[tuple[str, str | None]] = []
    events: list[tuple[str, bool, int]] = []
    source_events: list[dict] = []
    updates: list[dict] = []

    monkeypatch.setattr(health, "fetch_descriptor", lambda *_, **__: None)
    monkeypatch.setattr(
        health.repo,
        "update_peer",
        lambda node_uid, **kwargs: updates.append({"node_uid": node_uid, **kwargs}),
    )
    monkeypatch.setattr(
        health,
        "invalidate_source_cache",
        lambda node_uid, remote_entity_uid=None: (
            invalidations.append((node_uid, remote_entity_uid)) or 2
        ),
    )
    monkeypatch.setattr(
        health,
        "emit_peer_health_changed",
        lambda node_uid, healthy, latency_ms: events.append(
            (node_uid, healthy, latency_ms)
        ),
    )
    monkeypatch.setattr(
        health,
        "emit_global_catalog_source_changed",
        lambda **kwargs: source_events.append(kwargs),
    )

    result = health.poll_peer(
        {
            "node_uid": "node-b",
            "api_base_url": "https://node-b.test",
            "health_json": {"healthy": True},
        }
    )

    assert result["healthy"] is False
    assert invalidations == [("node-b", None)]
    assert events and events[0][0] == "node-b"
    assert events[0][1] is False
    assert source_events == [
        {
            "node_uid": "node-b",
            "reason": "peer_unhealthy",
        }
    ]
    assert updates[0]["node_uid"] == "node-b"


def test_global_source_changed_event_uses_global_catalog_scope(monkeypatch):
    from crate.federation.events import emit_global_catalog_source_changed

    events: list[dict] = []

    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event",
        lambda event_type, payload, **kwargs: (
            events.append({"event_type": event_type, "payload": payload, **kwargs}) or 1
        ),
    )

    emit_global_catalog_source_changed(
        node_uid="node-b",
        reason="manifest_revision_changed",
        entity_type="artist",
        remote_entity_uid="artist-remote-1",
        global_entity_uid="3776db13-c0ea-51f1-9e73-125497aeb4d7",
        facet="artist_info",
    )

    assert events == [
        {
            "event_type": "global_catalog.source.changed",
            "payload": {
                "node_uid": "node-b",
                "reason": "manifest_revision_changed",
                "entity_type": "artist",
                "remote_entity_uid": "artist-remote-1",
                "global_entity_uid": "3776db13-c0ea-51f1-9e73-125497aeb4d7",
                "facet": "artist_info",
                "changed_at": events[0]["payload"]["changed_at"],
            },
            "scope": "global_catalog",
            "subject_key": "3776db13-c0ea-51f1-9e73-125497aeb4d7",
        }
    ]


def test_tombstone_catalog_item_invalidates_remote_source_cache(monkeypatch):
    from crate.federation import catalog

    invalidations: list[tuple[str, str | None]] = []
    source_events: list[dict] = []

    class FakeSession:
        def execute(self, *_args, **_kwargs):
            return None

    class FakeTx:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(catalog, "transaction_scope", lambda: FakeTx())
    monkeypatch.setattr(
        catalog,
        "invalidate_source_cache",
        lambda node_uid, remote_entity_uid=None: (
            invalidations.append((node_uid, remote_entity_uid)) or 1
        ),
    )
    monkeypatch.setattr(
        catalog,
        "emit_global_catalog_source_changed",
        lambda **kwargs: source_events.append(kwargs),
    )

    catalog.tombstone_catalog_item(
        "node-b",
        "remote-track-1",
        "track",
        reason="deleted",
    )

    assert invalidations == [("node-b", "remote-track-1")]
    assert source_events == [
        {
            "node_uid": "node-b",
            "reason": "manifest_tombstone",
            "entity_type": "track",
            "remote_entity_uid": "remote-track-1",
        }
    ]
