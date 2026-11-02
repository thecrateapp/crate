from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from types import SimpleNamespace

import pytest

from tests.test_metric_minute_integrity import _minute_store, _snapshot


def _persisted_bucket_starts():
    from sqlalchemy import select

    from crate.db.orm.metrics import MetricMinuteSnapshot
    from crate.db.tx import read_scope

    with read_scope() as session:
        return set(session.execute(select(MetricMinuteSnapshot.bucket_start)).scalars())


@pytest.fixture
def retention_clock(monkeypatch):
    from crate import metrics

    now = datetime.now(timezone.utc).replace(second=20, microsecond=0)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz is not None else now.replace(tzinfo=None)

    monkeypatch.setattr(metrics, "datetime", FrozenDatetime)
    monkeypatch.setattr(
        metrics,
        "time",
        SimpleNamespace(time=lambda: now.timestamp(), monotonic=time.monotonic),
    )
    return metrics, now


@pytest.mark.parametrize("requested_limit", [None, 5000])
def test_prune_history_calls_one_bounded_batch_at_eight_day_utc_cutoff(
    monkeypatch, retention_clock, requested_limit
):
    from crate.db.repositories import management, metric_minutes

    metrics, now = retention_clock
    calls = []

    def delete_batch(before, limit=1000, *, session=None):
        calls.append((before, limit))
        return 17

    def no_redis_or_legacy(*_args, **_kwargs):
        pytest.fail("Metric retention must only touch PostgreSQL v2 minutes")

    monkeypatch.setattr(
        metric_minutes, "delete_metric_minute_snapshots_before", delete_batch
    )
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", no_redis_or_legacy)
    monkeypatch.setattr(management, "upsert_metric_rollup", no_redis_or_legacy)

    deleted = (
        metrics.prune_history()
        if requested_limit is None
        else metrics.prune_history(limit=requested_limit)
    )

    assert deleted == 17
    assert calls == [
        (now.replace(second=0) - timedelta(days=8), requested_limit or 1000)
    ]
    assert calls[0][0].utcoffset() == timedelta(0)


def test_prune_history_keeps_the_entire_eight_day_boundary_minute_and_legacy_history(
    pg_db, retention_clock
):
    from crate.db.queries.management import query_metric_rollups
    from crate.db.repositories.management import upsert_metric_rollup

    metrics, now = retention_clock
    repository, queries = _minute_store()
    cutoff = now.replace(second=0) - timedelta(days=8)
    recent = now.replace(second=0) - timedelta(days=1)
    assert now - cutoff == timedelta(days=8, seconds=20)
    buckets = [cutoff - timedelta(minutes=offset) for offset in (3, 2, 1)]
    buckets.extend([cutoff, recent])
    snapshots = [
        dict(
            _snapshot(),
            bucket_start=bucket,
            last_observed_at=bucket + timedelta(seconds=30),
        )
        for bucket in buckets
    ]
    repository.upsert_metric_minute_snapshots(snapshots)
    history_status = queries.get_metric_history_status()
    upsert_metric_rollup(
        name="api.requests",
        tags_json="{}",
        period="hour",
        bucket_start=(cutoff - timedelta(days=1)).isoformat(),
        count=100,
        sum_value=100.0,
        min_value=1.0,
        max_value=1.0,
        avg_value=1.0,
    )

    assert metrics.prune_history(limit=2) == 2
    assert _persisted_bucket_starts() == {cutoff - timedelta(minutes=1), cutoff, recent}
    assert metrics.prune_history(limit=2) == 1
    assert metrics.prune_history(limit=2) == 0

    assert _persisted_bucket_starts() == {cutoff, recent}
    assert query_metric_rollups(name="api.requests")[0]["count"] == 100
    final_status = queries.get_metric_history_status()
    assert {
        key: value for key, value in final_status.items() if key != "retention"
    } == {key: value for key, value in history_status.items() if key != "retention"}
    assert final_status["retention"]["backlog"] is False


def test_prune_history_propagates_database_failure_instead_of_reporting_zero(
    monkeypatch, retention_clock
):
    from crate.db.repositories import metric_minutes

    metrics, _now = retention_clock

    def database_failure(*_args, **_kwargs):
        raise RuntimeError("Injected metric retention database failure")

    monkeypatch.setattr(
        metric_minutes, "delete_metric_minute_snapshots_before", database_failure
    )

    with pytest.raises(
        RuntimeError, match="Injected metric retention database failure"
    ):
        metrics.prune_history()


def test_retention_delete_uses_short_timeouts_and_restores_caller_settings(pg_db):
    from sqlalchemy import event, text

    from crate.db.tx import transaction_scope

    repository, _queries = _minute_store()
    repository.upsert_metric_minute_snapshots([_snapshot()])
    observed_timeouts = []

    def observe_delete(_connection, cursor, statement, _parameters, _context, _many):
        if "DELETE FROM metric_minute_snapshots" in statement:
            cursor.execute("SHOW statement_timeout")
            statement_timeout = cursor.fetchone()[0]
            cursor.execute("SHOW lock_timeout")
            observed_timeouts.append((statement_timeout, cursor.fetchone()[0]))

    with transaction_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '15min'"))
        session.execute(text("SET LOCAL lock_timeout = '2s'"))
        connection = session.connection()
        event.listen(connection, "before_cursor_execute", observe_delete)
        try:
            deleted = repository.delete_metric_minute_snapshots_before(
                datetime.now(timezone.utc), session=session
            )
        finally:
            event.remove(connection, "before_cursor_execute", observe_delete)

        assert deleted == 1
        assert observed_timeouts == [("500ms", "50ms")]
        assert session.execute(text("SHOW statement_timeout")).scalar_one() == "15min"
        assert session.execute(text("SHOW lock_timeout")).scalar_one() == "2s"


def test_retention_lock_timeout_rolls_back_savepoint_and_keeps_caller_usable(pg_db):
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError

    from crate.db.tx import transaction_scope

    repository, _queries = _minute_store()
    with transaction_scope() as locker:
        locker.execute(
            text("LOCK TABLE metric_minute_snapshots IN ACCESS EXCLUSIVE MODE")
        )
        with transaction_scope() as caller:
            caller.execute(text("SET LOCAL statement_timeout = '15min'"))
            caller.execute(text("SET LOCAL lock_timeout = '2s'"))

            with pytest.raises(OperationalError) as failed:
                repository.delete_metric_minute_snapshots_before(
                    datetime.now(timezone.utc), session=caller
                )

            error = failed.value.orig
            sqlstate = getattr(error, "sqlstate", None) or getattr(
                error, "pgcode", None
            )
            assert sqlstate == "55P03"
            assert caller.execute(text("SELECT 1")).scalar_one() == 1
            assert (
                caller.execute(text("SHOW statement_timeout")).scalar_one() == "15min"
            )
            assert caller.execute(text("SHOW lock_timeout")).scalar_one() == "2s"
