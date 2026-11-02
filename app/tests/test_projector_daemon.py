import pytest


@pytest.mark.parametrize("relay_failed", [False, True])
@pytest.mark.parametrize("projection_failed", [False, True])
def test_projector_loop_runs_bounded_outbox_retention(
    monkeypatch, relay_failed, projection_failed
):
    from crate import domain_event_relay, projector, projector_daemon
    from crate.db import domain_event_outbox, home_warming

    cleaned: list[tuple[int, int]] = []
    readiness = []
    monkeypatch.setattr("crate.role_readiness.progress", readiness.append)
    monkeypatch.setattr(
        domain_event_relay,
        "relay_domain_events",
        lambda **_kwargs: {"claimed": 0, "delivered": 0, "failed": int(relay_failed)},
    )
    monkeypatch.setattr(
        projector,
        "process_domain_events",
        lambda **_kwargs: {"processed": 0, "failed": int(projection_failed)},
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
    assert readiness == ([] if relay_failed or projection_failed else ["projector"])


def test_projector_loop_reports_iteration_failures(monkeypatch):
    from crate import domain_event_relay, projector_daemon

    captured: list[tuple[Exception, str]] = []
    monkeypatch.setattr(
        domain_event_relay,
        "relay_domain_events",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("redis unavailable")),
    )
    monkeypatch.setattr(
        "crate.observability.sentry.capture_background_exception",
        lambda error, operation: captured.append((error, operation)),
        raising=False,
    )

    class _StopAfterOneIteration:
        stopped = False

        def is_set(self):
            return self.stopped

        def wait(self, _interval):
            self.stopped = True

    projector_daemon.run_projector_loop(_StopAfterOneIteration())

    assert len(captured) == 1
    assert str(captured[0][0]) == "redis unavailable"
    assert captured[0][1] == "projector.iteration"


@pytest.mark.parametrize(
    ("processed", "expected"),
    [({"processed": 3}, 3), (RuntimeError("projection failed"), None)],
)
def test_projector_publishes_live_activity_with_processed_events(
    monkeypatch, processed, expected
):
    from crate import domain_event_relay, projector, projector_daemon
    from crate.db import domain_event_outbox
    from crate.observability import live_activity

    published = []
    monkeypatch.setattr(
        domain_event_relay, "relay_domain_events", lambda **_kwargs: {"failed": 0}
    )
    monkeypatch.setattr(domain_event_outbox, "cleanup_delivered_outbox", lambda: 0)

    def process(**_kwargs):
        if isinstance(processed, Exception):
            raise processed
        return processed

    monkeypatch.setattr(projector, "process_domain_events", process)
    monkeypatch.setattr(
        live_activity,
        "publish_if_watched",
        lambda sampler, *, events: published.append((sampler, events)),
    )

    class _StopAfterTwoIterations:
        calls = 0

        def is_set(self):
            return self.calls >= 2

        def wait(self, _interval):
            self.calls += 1

    projector_daemon.run_projector_loop(
        _StopAfterTwoIterations(), home_warm_interval_seconds=0
    )

    assert [events for _sampler, events in published] == [expected, expected]
    assert published[0][0] is published[1][0]


def test_live_activity_failures_never_stop_the_projector(monkeypatch):
    from crate import domain_event_relay, projector, projector_daemon
    from crate.db import domain_event_outbox
    from crate.observability import live_activity

    projections = []
    monkeypatch.setattr(
        domain_event_relay, "relay_domain_events", lambda **_kwargs: {"failed": 0}
    )
    monkeypatch.setattr(domain_event_outbox, "cleanup_delivered_outbox", lambda: 0)
    monkeypatch.setattr(
        projector,
        "process_domain_events",
        lambda **_kwargs: projections.append(1) or {"processed": 0},
    )

    def broken(_sampler, *, events):
        raise ConnectionError("redis unavailable")

    monkeypatch.setattr(live_activity, "publish_if_watched", broken)

    class _StopAfterTwoIterations:
        calls = 0

        def is_set(self):
            return self.calls >= 2

        def wait(self, _interval):
            self.calls += 1

    projector_daemon.run_projector_loop(
        _StopAfterTwoIterations(), home_warm_interval_seconds=0
    )

    assert projections == [1, 1]
