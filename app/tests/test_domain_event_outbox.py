from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_outbox_migration_has_durable_lease_retry_and_dlq_state():
    migration = (
        ROOT / "app/crate/db/migrations/versions/073_domain_event_outbox.py"
    ).read_text()

    assert 'revision = "073"' in migration
    assert 'down_revision = "072"' in migration
    for token in (
        "domain_event_outbox",
        "event_uid UUID PRIMARY KEY",
        "attempts INTEGER",
        "next_attempt_at TIMESTAMPTZ",
        "lease_expires_at TIMESTAMPTZ",
        "dead_letter",
        "delivered_at TIMESTAMPTZ",
        "DROP TABLE IF EXISTS domain_event_outbox",
    ):
        assert token in migration


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _Session:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), dict(params or {})))
        return _Rows(self.rows)


def test_claim_uses_skip_locked_and_recovers_expired_leases():
    from crate.db.domain_event_outbox import claim_outbox_events

    session = _Session([{"event_uid": "event-1", "attempts": 0}])

    rows = claim_outbox_events(
        "relay-a",
        limit=25,
        lease_seconds=30,
        session=session,
    )

    assert rows == [{"event_uid": "event-1", "attempts": 0}]
    sql, params = session.calls[0]
    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "lease_expires_at <= NOW()" in sql
    assert params == {"worker_id": "relay-a", "limit": 25, "lease_seconds": 30}


def test_retry_delay_is_bounded_exponential():
    from crate.db.domain_event_outbox import retry_delay_seconds

    assert retry_delay_seconds(1) == 1
    assert retry_delay_seconds(2) == 2
    assert retry_delay_seconds(8) == 128
    assert retry_delay_seconds(20) == 300


def test_cleanup_prunes_only_old_delivered_events_in_bounded_batches():
    from crate.db.domain_event_outbox import cleanup_delivered_outbox

    class _Result:
        rowcount = 23

    class _CleanupSession(_Session):
        def execute(self, statement, params=None):
            self.calls.append((str(statement), dict(params or {})))
            return _Result()

    session = _CleanupSession()

    deleted = cleanup_delivered_outbox(
        retention_days=14,
        limit=250,
        session=session,
    )

    assert deleted == 23
    sql, params = session.calls[0]
    assert "status = 'delivered'" in sql
    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "LIMIT :limit" in sql
    assert params == {"retention_days": 14, "limit": 250}


def test_outbox_completion_requires_current_lease_ownership():
    from crate.db.domain_event_outbox import (
        mark_outbox_delivered,
        mark_outbox_failed,
    )

    session = _Session()
    mark_outbox_delivered("event-1", "1-0", 42, worker_id="relay-a", session=session)
    mark_outbox_failed("event-2", "boom", 2, worker_id="relay-a", session=session)

    for sql, params in session.calls:
        assert "status = 'leased'" in sql
        assert "leased_by = :worker_id" in sql
        assert params["worker_id"] == "relay-a"


def test_relay_passes_claim_owner_to_completion(monkeypatch):
    from crate import domain_event_relay

    delivered: list[tuple[str, str]] = []
    monkeypatch.setattr(
        domain_event_relay,
        "claim_outbox_events",
        lambda worker_id, limit: [{"event_uid": "event-1", "attempts": 0}],
    )
    monkeypatch.setattr(
        domain_event_relay,
        "publish_outbox_event",
        lambda event: ("1-0", 1),
    )
    monkeypatch.setattr(
        domain_event_relay,
        "mark_outbox_delivered",
        lambda event_uid, stream_id, sequence, *, worker_id: delivered.append(
            (event_uid, worker_id)
        ),
    )

    domain_event_relay.relay_domain_events(worker_id="relay-a")

    assert delivered == [("event-1", "relay-a")]
