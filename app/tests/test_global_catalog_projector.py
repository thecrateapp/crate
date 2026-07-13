def test_projector_refreshes_ops_for_global_catalog_reconcile_event(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000100-0",
                "event_type": "global_catalog.reconcile.completed",
                "scope": "global_catalog",
                "subject_key": "run-1",
                "payload_json": {"mode": "incremental"},
            }
        ],
    )
    monkeypatch.setattr(
        projector,
        "get_cached_ops_snapshot",
        lambda fresh=False: calls["ops"].append(fresh) or {"status": {}},
    )
    monkeypatch.setattr(
        projector,
        "get_cached_home_discovery",
        lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {},
    )
    monkeypatch.setattr(
        projector,
        "list_recent_home_user_ids",
        lambda window_minutes=30, limit=10: [3, 4],
    )
    monkeypatch.setattr(
        projector,
        "global_catalog_surface_enabled",
        lambda surface: surface == "home",
    )
    monkeypatch.setattr(
        projector,
        "mark_domain_events_processed",
        lambda event_ids: calls["processed"].append(event_ids),
    )

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 1, "ops_refreshes": 1, "home_refreshes": 2}
    assert calls["ops"] == [True]
    assert calls["home"] == [(3, True), (4, True)]
    assert calls["processed"] == [["1682349000100-0"]]


def test_projector_refreshes_home_for_global_source_changed(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000200-0",
                "event_type": "global_catalog.source.changed",
                "scope": "global_catalog",
                "subject_key": "artist-global-1",
                "payload_json": {
                    "node_uid": "node-b",
                    "entity_type": "artist",
                    "global_entity_uid": "artist-global-1",
                    "facet": "artist_info",
                    "reason": "manifest_revision_changed",
                },
            }
        ],
    )
    monkeypatch.setattr(
        projector,
        "get_cached_ops_snapshot",
        lambda fresh=False: calls["ops"].append(fresh) or {"status": {}},
    )
    monkeypatch.setattr(
        projector,
        "get_cached_home_discovery",
        lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {},
    )
    monkeypatch.setattr(
        projector,
        "list_recent_home_user_ids",
        lambda window_minutes=30, limit=10: [7],
    )
    monkeypatch.setattr(
        projector,
        "global_catalog_surface_enabled",
        lambda surface: surface == "home",
    )
    monkeypatch.setattr(
        projector,
        "mark_domain_events_processed",
        lambda event_ids: calls["processed"].append(event_ids),
    )

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 1, "ops_refreshes": 1, "home_refreshes": 1}
    assert calls["ops"] == [True]
    assert calls["home"] == [(7, True)]
    assert calls["processed"] == [["1682349000200-0"]]
