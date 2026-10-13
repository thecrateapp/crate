"""Opt-in timing baseline for listening projections and the stats dashboard.

Run with ``CRATE_STATS_BENCH=1`` (and optionally ``CRATE_STATS_BENCH_EVENTS``)::

    CRATE_STATS_BENCH=1 ../.venv/bin/python -m pytest tests/test_stats_projection_bench.py -s -q
"""

from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager

import pytest
from sqlalchemy import event

from tests.conftest import PG_AVAILABLE
from tests.stats_history import seed_listening_history

pytestmark = [
    pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available"),
    pytest.mark.skipif(
        os.environ.get("CRATE_STATS_BENCH") != "1",
        reason="set CRATE_STATS_BENCH=1 to run the stats timing baseline",
    ),
]


@contextmanager
def _measure(label: str, results: dict):
    from crate.db.engine import get_engine

    statements = 0

    def _count(*_args, **_kwargs):
        nonlocal statements
        statements += 1

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", _count)
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        event.remove(engine, "before_cursor_execute", _count)
        results[label] = {"ms": elapsed_ms, "queries": statements}


def _mark_recent_day_dirty() -> None:
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_listening_dirty_days (user_id, day)
                SELECT 1, MAX(day) FROM user_daily_listening WHERE user_id = 1
                """
            )
        )


def test_stats_projection_baseline(pg_db):
    from crate.db.repositories.user_library_aggregate_runner import (
        recompute_user_listening_aggregates,
        refresh_user_listening_aggregates,
    )
    from crate.db.user_stats_dashboard_surface import build_user_stats_dashboard

    events = int(os.environ.get("CRATE_STATS_BENCH_EVENTS", "100000"))
    results: dict = {"events": events}
    with _measure("seed", results):
        seed_listening_history(events=events, days=4 * 365)
    with _measure("rebuild_projections", results):
        recompute_user_listening_aggregates(1)
    _mark_recent_day_dirty()
    with _measure("incremental_refresh_one_day", results):
        refresh_user_listening_aggregates(1)
    for window in ("30d", "365d", "all_time"):
        with _measure(f"dashboard_{window}", results):
            payload = build_user_stats_dashboard(
                user_id=1,
                window=window,
                month=None,
                tracks_limit=12,
                artists_limit=10,
                albums_limit=12,
                genres_limit=10,
                replay_limit=36,
            )
        results[f"dashboard_{window}"]["payload_kb"] = round(
            len(json.dumps(payload, default=str)) / 1024
        )
    print("\nSTATS_BENCH " + json.dumps(results))
