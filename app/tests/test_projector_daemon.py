def test_projector_loop_runs_bounded_outbox_retention(monkeypatch):
    from crate import domain_event_relay, projector, projector_daemon
    from crate.db import domain_event_outbox
    from crate.db import home_warming

    cleaned: list[tuple[int, int]] = []
    monkeypatch.setattr(
        domain_event_relay,
        "relay_domain_events",
        lambda **_kwargs: {"claimed": 0, "delivered": 0, "failed": 0},
    )
    monkeypatch.setattr(
        projector,
        "process_domain_events",
        lambda **_kwargs: {"processed": 0},
    )
    monkeypatch.setattr(
        home_warming,
        "warm_recent_home_discovery_snapshots",
        lambda: 0,
    )
    monkeypatch.setattr(
        domain_event_outbox,
        "cleanup_delivered_outbox",
        lambda retention_days=7, limit=1000: (
            cleaned.append((retention_days, limit)) or 0
        ),
        raising=False,
    )

    class _StopAfterOneIteration:
        stopped = False

        def is_set(self):
            return self.stopped

        def wait(self, _interval):
            self.stopped = True

    projector_daemon.run_projector_loop(
        _StopAfterOneIteration(),
        home_warm_interval_seconds=0,
        outbox_cleanup_interval_seconds=60,
    )

    assert cleaned == [(7, 1000)]
