def test_relay_isolates_poison_event_and_continues_batch(monkeypatch):
    import crate.domain_event_relay as relay

    events = [
        {"event_uid": "poison", "attempts": 2, "event_type": "bad"},
        {"event_uid": "healthy", "attempts": 0, "event_type": "good"},
    ]
    delivered: list[tuple[str, str, int]] = []
    failed: list[tuple[str, str, int]] = []

    monkeypatch.setattr(relay, "claim_outbox_events", lambda *_args, **_kwargs: events)

    def publish(event):
        if event["event_uid"] == "poison":
            raise ValueError("malformed payload")
        return "12-0", 12

    monkeypatch.setattr(relay, "publish_outbox_event", publish)
    monkeypatch.setattr(
        relay,
        "mark_outbox_delivered",
        lambda event_uid, stream_id, sequence, *, worker_id: delivered.append(
            (event_uid, stream_id, sequence)
        ),
    )
    monkeypatch.setattr(
        relay,
        "mark_outbox_failed",
        lambda event_uid, error, attempts, *, worker_id: failed.append(
            (event_uid, error, attempts)
        ),
    )

    result = relay.relay_domain_events(limit=10, worker_id="relay-a")

    assert result == {"claimed": 2, "delivered": 1, "failed": 1}
    assert delivered == [("healthy", "12-0", 12)]
    assert failed == [("poison", "malformed payload", 3)]


def test_relay_passes_stable_event_uid_to_idempotent_publisher(monkeypatch):
    import crate.domain_event_relay as relay

    event = {
        "event_uid": "stable-event",
        "attempts": 0,
        "event_type": "library.changed",
        "payload_json": {"id": 1},
    }
    published: list[dict] = []
    monkeypatch.setattr(relay, "claim_outbox_events", lambda *_args, **_kwargs: [event])
    monkeypatch.setattr(
        relay,
        "publish_outbox_event",
        lambda value: published.append(value) or ("1-0", 1),
    )
    monkeypatch.setattr(relay, "mark_outbox_delivered", lambda *_args, **_kwargs: None)

    relay.relay_domain_events(limit=1, worker_id="relay-b")

    assert published == [event]
