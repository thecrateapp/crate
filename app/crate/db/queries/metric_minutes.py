"""Indexed metric-minute reads; aggregation precedes pagination."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.observability.metric_catalog import canonical_metric


def _utc(value):
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(parsed, datetime):
        raise ValueError("Invalid metric time bound")
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _bounds(period: str, start, end, limit: int):
    now = _now().astimezone(timezone.utc).replace(second=0, microsecond=0)
    requested_start = (
        _utc(start).astimezone(timezone.utc) if start is not None else None
    )
    requested_end = _utc(end).astimezone(timezone.utc) if end is not None else now
    if requested_start is not None and requested_start > requested_end:
        raise ValueError("Metric window start exceeds end")
    end = min(now, requested_end.replace(second=0, microsecond=0))
    if period == "day":
        bin_start = end.replace(hour=0, minute=0)
        step = timedelta(days=1)
    elif period == "hour":
        bin_start = end.replace(minute=0)
        step = timedelta(hours=1)
    else:
        bin_start, step = end, timedelta(minutes=1)
    start = (
        requested_start.replace(second=0, microsecond=0)
        if requested_start is not None
        else bin_start - (limit - 1) * step
    )
    return max(start, now - timedelta(days=8)), end


def _read_series(
    names, period, start, end, limit, *, tags=None, session=None, with_coverage=False
):
    if period not in {"minute", "hour", "day"}:
        raise ValueError("Invalid metric period")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 12000:
        raise ValueError("Invalid metric row limit")
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
        raise ValueError("Metric names must be a list of configured names")
    canonical = list(
        dict.fromkeys(canonical_metric(name).definition.name for name in names)
    )
    if len(canonical) > 32 or len(canonical) * limit > 12000:
        raise ValueError("Metric series read exceeds row budget")
    result = {name: [] for name in canonical}
    if not canonical:
        return {"series": result, "collection": {}} if with_coverage else result
    start, end = _bounds(period, start, end, limit)
    if start > end:
        return {"series": result, "collection": {}} if with_coverage else result
    conditions = [
        "name = ANY(:names)",
        "bucket_start >= :start",
        "bucket_start <= :end",
    ]
    params = {
        "names": canonical,
        "period": period,
        "limit": limit,
        "start": start,
        "end": end,
        "first_name": min(canonical),
    }
    if tags is not None:
        conditions.append("tags_json @> CAST(:tags AS jsonb)")
        params["tags"] = json.dumps(
            dict(canonical_metric(canonical[0], tags).tags), sort_keys=True
        )
    statement = text(
        """
        WITH aggregated AS (
            SELECT name, date_trunc(:period, bucket_start, 'UTC') AS bucket_start,
                   SUM(count)::bigint AS count, SUM(sum_value) AS sum_value,
                   MIN(min_value) AS min_value, MAX(max_value) AS max_value,
                   SUM(sum_value) / NULLIF(SUM(count), 0) AS avg_value,
                   BOOL_OR(source_gap) AS source_gap,
                   MAX(last_observed_at) AS last_observed_at
            FROM metric_minute_snapshots
            WHERE """
        + " AND ".join(conditions)
        + """
            GROUP BY name, date_trunc(:period, bucket_start, 'UTC')
        ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY bucket_start DESC) AS position
            FROM aggregated
        )
        SELECT requested.name, bucket_start, count, sum_value, min_value, max_value, avg_value,
               source_gap, last_observed_at,
               CASE WHEN requested.name = :first_name AND (position = 1 OR position IS NULL)
                    THEN (SELECT value FROM settings WHERE key = 'metrics_v2_collection_state')
                    ELSE NULL END AS collection_state
        FROM unnest(CAST(:names AS text[])) AS requested(name)
        LEFT JOIN ranked ON ranked.name = requested.name AND position <= :limit
        ORDER BY requested.name, bucket_start DESC
    """
    )

    def _impl(current):
        collection = {}
        for row in current.execute(statement, params).mappings():
            item = dict(row)
            name = item.pop("name")
            state = item.pop("collection_state")
            if state:
                collection = json.loads(state)
            if item["bucket_start"] is None:
                continue
            item["bucket_start"] = item["bucket_start"].astimezone(timezone.utc)
            item["last_observed_at"] = item["last_observed_at"].astimezone(timezone.utc)
            result[name].append(item)
        return {"series": result, "collection": collection} if with_coverage else result

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def query_metric_minute_series(
    names: list[str],
    period: str = "hour",
    start=None,
    end=None,
    limit: int = 168,
    *,
    session=None,
) -> dict[str, list[dict]]:
    """Read bounded windows for at most 32 families in one aggregation query."""
    return _read_series(names, period, start, end, limit, session=session)


def query_metric_minute_series_snapshot(
    names: list[str],
    period: str = "hour",
    start=None,
    end=None,
    limit: int = 168,
    *,
    session=None,
) -> dict:
    """Read series and durable source coverage together, including empty gaps."""
    return _read_series(
        names, period, start, end, limit, session=session, with_coverage=True
    )


def query_metric_minute_snapshots(
    name: str,
    period: str = "hour",
    start=None,
    end=None,
    limit: int = 168,
    *,
    tags: dict | None = None,
    session=None,
) -> list[dict]:
    """Aggregate dimensions before pagination over a bounded UTC window."""
    canonical = canonical_metric(name).definition.name
    return _read_series([name], period, start, end, limit, tags=tags, session=session)[
        canonical
    ]


def get_metric_history_status(*, session=None) -> dict:
    """Read the durable v2 cutover, independent of minute retention."""

    def _impl(current):
        settings = {
            key: value
            for key, value in current.execute(
                text("""
            SELECT key, value FROM settings
            WHERE key IN ('metrics_v2_cutover_at', 'metrics_v2_collection_state', 'metrics_v2_retention_state')
        """)
            )
        }
        value = settings.get("metrics_v2_cutover_at")
        cutover = _utc(value).isoformat() if value else None
        collection = json.loads(settings.get("metrics_v2_collection_state", "{}"))
        availability = "available" if cutover else "empty"
        if cutover and collection.get("checked_at"):
            if (_now() - _utc(collection["checked_at"])).total_seconds() > 600:
                availability = "stale"
            elif collection.get("gaps"):
                availability = "partial"
        return {
            "source": "postgresql_v2",
            "availability": availability,
            "cutover_at": cutover,
            "legacy_status": "unverified",
            "legacy_combined": False,
            "retention_days": 8,
            "collection": collection,
            "retention": json.loads(settings.get("metrics_v2_retention_state", "{}")),
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "query_metric_minute_snapshots",
    "query_metric_minute_series",
    "query_metric_minute_series_snapshot",
    "get_metric_history_status",
]
