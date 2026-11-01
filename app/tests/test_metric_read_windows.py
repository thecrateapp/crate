from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from crate.db.queries import metric_minutes as queries
from crate.db.repositories import metric_minutes as repository
from tests.test_metric_minute_integrity import _snapshot


NOW = datetime(2026, 10, 31, 12, 34, 45, tzinfo=timezone.utc)
MINUTE = NOW.replace(second=0)


@pytest.fixture(autouse=True)
def metric_read_clock(monkeypatch):
    monkeypatch.setattr(queries, "_now", lambda: NOW, raising=False)


def _row(bucket, *, name="api.requests", tags=None, count=1, value=1.0):
    return dict(
        _snapshot(),
        name=name,
        tags=tags or {},
        bucket_start=bucket,
        count=count,
        revision=count,
        sum_value=count * value,
        min_value=value,
        max_value=value,
        last_value=value,
        last_observed_at=bucket + timedelta(seconds=30),
    )


def _read(reader, **kwargs):
    if reader == "single":
        return queries.query_metric_minute_snapshots("api.requests", **kwargs)
    return queries.query_metric_minute_series(["api.requests"], **kwargs)[
        "api.request.count"
    ]


def test_reader_always_limits_history_to_last_eight_days_and_current_minute(pg_db):
    boundary = MINUTE - timedelta(days=8)
    repository.upsert_metric_minute_snapshots(
        [
            _row(MINUTE - timedelta(days=9)),
            _row(boundary),
            _row(MINUTE),
            _row(MINUTE + timedelta(minutes=1)),
        ]
    )

    rows = queries.query_metric_minute_snapshots(
        "api.requests", period="minute", limit=12000
    )

    assert [row["bucket_start"] for row in rows] == [MINUTE, boundary]


@pytest.mark.parametrize("window_minutes", [15, 60, 1440, 10080])
def test_explicit_windows_have_inclusive_minute_boundaries(pg_db, window_minutes):
    start = MINUTE - timedelta(minutes=window_minutes)
    repository.upsert_metric_minute_snapshots(
        [
            _row(start - timedelta(minutes=1), count=100),
            _row(start, count=2),
            _row(MINUTE, count=3),
            _row(MINUTE + timedelta(minutes=1), count=100),
        ]
    )

    rows = queries.query_metric_minute_snapshots(
        "api.requests", period="minute", start=start, end=MINUTE, limit=12000
    )

    assert [row["bucket_start"] for row in rows] == [MINUTE, start]
    assert sum(row["count"] for row in rows) == 5


def test_daily_aggregation_is_utc_even_when_session_timezone_is_madrid(pg_db):
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    repository.upsert_metric_minute_snapshots([_row(MINUTE)])
    with transaction_scope() as session:
        session.execute(text("SET LOCAL TIME ZONE 'Europe/Madrid'"))

        rows = queries.query_metric_minute_snapshots(
            "api.requests", period="day", session=session
        )

    assert rows[0]["bucket_start"].isoformat() == "2026-10-31T00:00:00+00:00"
    assert rows[0]["last_observed_at"].utcoffset() == timedelta(0)


def test_batch_uses_one_select_and_aggregates_dimensions_before_per_family_limit(pg_db):
    from sqlalchemy import event

    from crate.db.repositories.management import upsert_metric_rollup
    from crate.db.tx import transaction_scope

    repository.upsert_metric_minute_snapshots(
        [
            _row(MINUTE, name="worker.queue.wait", tags={"queue": "default"}, count=3),
            _row(
                MINUTE, name="worker.queue.wait", tags={"queue": "playback"}, value=9.0
            ),
            _row(MINUTE - timedelta(minutes=1), name="worker.queue.wait", value=100.0),
            _row(MINUTE, tags={"method": "GET"}, count=2),
            _row(MINUTE, tags={"method": "POST"}, value=5.0),
            _row(MINUTE - timedelta(minutes=1), count=100),
        ]
    )
    upsert_metric_rollup(
        name="api.requests",
        tags_json="{}",
        period="minute",
        bucket_start=MINUTE.isoformat(),
        count=100,
        sum_value=100.0,
        min_value=1.0,
        max_value=1.0,
        avg_value=1.0,
    )
    selects = []

    def count_select(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            "metric_minute_snapshots" in statement
            and statement.lstrip().upper().startswith(("SELECT", "WITH"))
        ):
            selects.append(statement)

    with transaction_scope() as session:
        connection = session.connection()
        event.listen(connection, "before_cursor_execute", count_select)
        try:
            result = queries.query_metric_minute_series(
                ["api.requests", "worker.queue.wait", "api.request.count"],
                period="minute",
                start=MINUTE - timedelta(minutes=5),
                end=MINUTE,
                limit=1,
                session=session,
            )
        finally:
            event.remove(connection, "before_cursor_execute", count_select)

    assert len(selects) == 1
    assert set(result) == {"api.request.count", "worker.queue.wait"}
    queue = result["worker.queue.wait"]
    requests = result["api.request.count"]
    assert len(queue) == len(requests) == 1
    assert (queue[0]["count"], queue[0]["sum_value"], queue[0]["avg_value"]) == (
        4,
        12.0,
        3.0,
    )
    assert (requests[0]["count"], requests[0]["sum_value"]) == (3, 7.0)
    assert requests[0]["avg_value"] == pytest.approx(7.0 / 3)
    assert queue == queries.query_metric_minute_snapshots(
        "worker.queue.wait",
        period="minute",
        start=MINUTE - timedelta(minutes=5),
        end=MINUTE,
        limit=1,
    )


@pytest.mark.parametrize("reader", ["single", "batch"])
def test_offset_bounds_are_converted_to_utc_and_floored_to_inclusive_minutes(
    pg_db, reader
):
    start = MINUTE - timedelta(minutes=15)
    repository.upsert_metric_minute_snapshots(
        [
            _row(start - timedelta(minutes=1), count=100),
            _row(start, count=2),
            _row(MINUTE, count=3),
            _row(MINUTE + timedelta(minutes=1), count=100),
        ]
    )
    offset = timezone(timedelta(hours=2))

    rows = _read(
        reader,
        period="minute",
        limit=12000,
        start=start.astimezone(offset).replace(second=37).isoformat(),
        end=MINUTE.astimezone(offset).replace(second=59).isoformat(),
    )

    assert [row["bucket_start"].isoformat() for row in rows] == [
        MINUTE.isoformat(),
        start.isoformat(),
    ]
    assert sum(row["count"] for row in rows) == 5


@pytest.mark.parametrize("reader", ["single", "batch"])
def test_equal_bounds_allow_reading_one_inclusive_minute_bucket(pg_db, reader):
    bucket = MINUTE - timedelta(minutes=5)
    repository.upsert_metric_minute_snapshots([_row(bucket, count=2)])
    bound = bucket + timedelta(seconds=20)

    rows = _read(reader, period="minute", start=bound, end=bound)

    assert [row["bucket_start"] for row in rows] == [bucket]
    assert rows[0]["count"] == 2


@pytest.mark.parametrize("reader", ["single", "batch"])
def test_explicit_bounds_are_clamped_to_retention_and_current_minute(pg_db, reader):
    boundary = MINUTE - timedelta(days=8)
    repository.upsert_metric_minute_snapshots(
        [
            _row(MINUTE - timedelta(days=9)),
            _row(boundary),
            _row(MINUTE),
            _row(MINUTE + timedelta(minutes=1)),
        ]
    )

    rows = _read(
        reader,
        period="minute",
        limit=12000,
        start=MINUTE - timedelta(days=30),
        end=MINUTE + timedelta(days=1),
    )

    assert [row["bucket_start"] for row in rows] == [MINUTE, boundary]


@pytest.mark.parametrize("reader", ["single", "batch"])
@pytest.mark.parametrize(
    "bounds",
    [
        (MINUTE - timedelta(days=10), MINUTE - timedelta(days=9)),
        (MINUTE + timedelta(hours=1), MINUTE + timedelta(hours=2)),
    ],
)
def test_valid_ranges_outside_retained_history_return_no_rows(pg_db, reader, bounds):
    repository.upsert_metric_minute_snapshots([_row(bounds[0])])

    assert _read(reader, start=bounds[0], end=bounds[1]) == []


@pytest.mark.parametrize("reader", ["single", "batch"])
@pytest.mark.parametrize(
    "bounds",
    [
        (MINUTE, MINUTE - timedelta(minutes=1)),
        (MINUTE + timedelta(seconds=50), MINUTE + timedelta(seconds=10)),
    ],
)
def test_reversed_original_bounds_are_rejected_before_minute_flooring(reader, bounds):
    with pytest.raises(ValueError):
        _read(reader, start=bounds[0], end=bounds[1])


@pytest.mark.parametrize("reader", ["single", "batch"])
@pytest.mark.parametrize(
    "invalid", [{"period": "week"}, {"limit": 0}, {"limit": 12001}, {"limit": True}]
)
def test_reader_rejects_unbounded_or_invalid_granularity_arguments(reader, invalid):
    with pytest.raises(ValueError):
        _read(reader, **invalid)


@pytest.mark.parametrize(
    "case", ["too_many_names", "too_many_result_rows", "unknown_name"]
)
def test_batch_enforces_closed_name_and_total_result_budgets(case):
    from crate.observability.metric_catalog import METRIC_CATALOG

    if case == "too_many_names":
        names, limit = sorted(METRIC_CATALOG)[:33], 1
    elif case == "too_many_result_rows":
        names, limit = ["api.requests", "worker.queue.wait"], 6001
    else:
        names, limit = ["unregistered.metric"], 1

    with pytest.raises(ValueError):
        queries.query_metric_minute_series(names, limit=limit)


def test_batch_deduplicates_aliases_before_enforcing_name_budget(pg_db):
    repository.upsert_metric_minute_snapshots([_row(MINUTE, count=2)])

    result = queries.query_metric_minute_series(
        ["api.requests", "api.request.count"] * 33, period="minute", limit=1
    )

    assert set(result) == {"api.request.count"}
    assert result["api.request.count"][0]["count"] == 2


def test_batch_accepts_exact_name_and_total_result_budget_boundaries(pg_db):
    from crate.observability.metric_catalog import METRIC_CATALOG

    names = sorted(METRIC_CATALOG)[:32]

    result = queries.query_metric_minute_series(names, limit=375)

    assert set(result) == set(names)
    assert all(rows == [] for rows in result.values())


def test_empty_batch_is_a_noop():
    assert queries.query_metric_minute_series([]) == {}


def test_single_series_retains_its_dimension_filter_after_batch_core_migration(pg_db):
    repository.upsert_metric_minute_snapshots(
        [
            _row(MINUTE, name="worker.queue.wait", tags={"queue": "default"}, count=3),
            _row(
                MINUTE, name="worker.queue.wait", tags={"queue": "playback"}, value=9.0
            ),
        ]
    )

    filtered = queries.query_metric_minute_snapshots(
        "worker.queue.wait", period="minute", tags={"queue": "default"}
    )
    unfiltered = queries.query_metric_minute_series(
        ["worker.queue.wait"], period="minute"
    )["worker.queue.wait"]

    assert (
        filtered[0]["count"],
        filtered[0]["sum_value"],
        filtered[0]["avg_value"],
    ) == (3, 3.0, 1.0)
    assert (
        unfiltered[0]["count"],
        unfiltered[0]["sum_value"],
        unfiltered[0]["avg_value"],
    ) == (4, 12.0, 3.0)


@pytest.mark.parametrize(
    ("period", "limit", "expected_start"),
    [
        ("minute", 1, MINUTE),
        ("hour", 1, MINUTE.replace(minute=0)),
        ("hour", 2, MINUTE.replace(minute=0) - timedelta(hours=1)),
        ("day", 1, MINUTE.replace(hour=0, minute=0)),
        ("day", 2, MINUTE.replace(hour=0, minute=0) - timedelta(days=1)),
        ("day", 20, MINUTE - timedelta(days=8)),
    ],
)
def test_default_sql_window_only_reads_bins_the_result_can_represent(
    pg_db, period, limit, expected_start
):
    from sqlalchemy import event

    from crate.db.tx import transaction_scope

    bound_values = []

    def capture_bounds(_connection, _cursor, statement, parameters, _context, _many):
        if "metric_minute_snapshots" not in statement:
            return
        for value in parameters.values():
            if isinstance(value, datetime):
                bound_values.append(value.astimezone(timezone.utc))
            elif isinstance(value, str):
                try:
                    parsed = datetime.fromisoformat(value)
                except ValueError:
                    continue
                if parsed.tzinfo is not None:
                    bound_values.append(parsed.astimezone(timezone.utc))

    with transaction_scope() as session:
        connection = session.connection()
        event.listen(connection, "before_cursor_execute", capture_bounds)
        try:
            assert (
                queries.query_metric_minute_snapshots(
                    "api.requests", period=period, limit=limit, session=session
                )
                == []
            )
        finally:
            event.remove(connection, "before_cursor_execute", capture_bounds)

    assert expected_start in bound_values
    assert MINUTE in bound_values


def test_metric_window_index_covers_the_aggregate_columns_in_real_postgresql(pg_db):
    from sqlalchemy import inspect

    from crate.db.tx import read_scope

    with read_scope() as session:
        indexes = inspect(session.connection()).get_indexes("metric_minute_snapshots")

    matching = [
        index for index in indexes if index["name"] == "idx_metric_minutes_name_bucket"
    ]
    assert len(matching) == 1
    index = matching[0]
    assert index["column_names"] == ["name", "bucket_start"]
    included = index.get(
        "include_columns",
        index.get("dialect_options", {}).get("postgresql_include", []),
    )
    assert set(included) == {
        "count",
        "sum_value",
        "min_value",
        "max_value",
        "last_observed_at",
        "source_gap",
    }
