"""Absolute metric snapshots. Legacy metric_rollups are never modified here."""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import optional_scope
from crate.observability.metric_catalog import canonical_metric

COLLECTION_STATE_KEY = "metrics_v2_collection_state"


def persist_metric_collection(
    snapshots: list[dict],
    *,
    source_id: str,
    checked_at: datetime,
    dropped_samples: int = 0,
    pending_buckets: int = 0,
    oldest_pending_at: float | None = None,
    buffer_ttl_seconds: int = 7200,
    session=None,
) -> dict:
    """Commit source coverage and absolute observations in the same transaction."""
    checked_at = _utc(checked_at)
    if not source_id or len(source_id) > 160:
        raise ValueError("Invalid metric source generation")
    gap_detected = False
    with optional_scope(session) as current:
        current.execute(
            text("""
            INSERT INTO settings (key, value) VALUES (:key, '{}')
            ON CONFLICT (key) DO NOTHING
        """),
            {"key": COLLECTION_STATE_KEY},
        )
        raw = current.execute(
            text("""
            SELECT value FROM settings WHERE key = :key FOR UPDATE
        """),
            {"key": COLLECTION_STATE_KEY},
        ).scalar_one()
        previous = json.loads(raw)
        previous_at = _utc(previous["checked_at"]) if previous else None
        gaps = previous.get("gaps", [])
        if previous_at is None or checked_at >= previous_at:
            changed = previous_at is not None and (
                previous["source_id"] != source_id
                or dropped_samples != previous.get("dropped_samples", 0)
                or checked_at - previous_at > timedelta(seconds=buffer_ttl_seconds)
            )
            if changed or (not previous and snapshots):
                gap_detected = True
                beginning = previous_at or min(
                    _utc(row["bucket_start"]) for row in snapshots
                )
                if previous.get("oldest_pending_at") is not None:
                    beginning = min(
                        beginning,
                        datetime.fromtimestamp(
                            previous["oldest_pending_at"], tz=timezone.utc
                        ),
                    )
                beginning = max(beginning, checked_at - timedelta(days=8))
                gaps = [
                    *gaps,
                    [
                        beginning.replace(second=0, microsecond=0).isoformat(),
                        checked_at.replace(second=0, microsecond=0).isoformat(),
                    ],
                ]
            cutoff = checked_at - timedelta(days=8)
            merged = []
            for beginning, ending in sorted(gaps):
                if _utc(ending) < cutoff:
                    continue
                if merged and _utc(beginning) <= _utc(merged[-1][1]) + timedelta(
                    minutes=1
                ):
                    merged[-1][1] = max(merged[-1][1], ending)
                else:
                    merged.append([beginning, ending])
            if len(merged) > 128:
                merged = [[merged[0][0], merged[-128][1]], *merged[-127:]]
            state = {
                "source_id": source_id,
                "checked_at": checked_at.isoformat(),
                "dropped_samples": dropped_samples,
                "gaps": merged,
                "pending_buckets": pending_buckets,
                "oldest_pending_at": oldest_pending_at,
            }
            current.execute(
                text("UPDATE settings SET value = :value WHERE key = :key"),
                {"key": COLLECTION_STATE_KEY, "value": json.dumps(state)},
            )
            gaps = merged
        prepared = []
        for row in snapshots:
            bucket = _utc(row["bucket_start"])
            gap = any(_utc(start) <= bucket <= _utc(end) for start, end in gaps)
            prepared.append({**row, "source_gap": bool(row.get("source_gap")) or gap})
        return {
            "written": upsert_metric_minute_snapshots(prepared, session=current)
            if prepared
            else 0,
            "gap_detected": gap_detected,
        }


def _utc(value) -> datetime:
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(parsed, datetime) or parsed.tzinfo is None:
        raise ValueError("Metric timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def _snapshot(raw: dict) -> dict:
    series = canonical_metric(raw["name"], raw.get("tags"))
    bucket = _utc(raw["bucket_start"])
    if bucket.second or bucket.microsecond:
        raise ValueError("Metric buckets must be aligned to a minute")
    revision, count = raw["revision"], raw["count"]
    if (
        not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision < 1
        or not isinstance(count, int)
        or isinstance(count, bool)
        or count < 1
    ):
        raise ValueError("Metric count and revision must be positive integers")
    source_id = raw["source_id"]
    if not isinstance(source_id, str) or not source_id or len(source_id) > 160:
        raise ValueError("Invalid metric source generation")
    values = {
        key: float(raw[key])
        for key in ("sum_value", "min_value", "max_value", "last_value")
    }
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError("Metric values must be finite")
    if values["min_value"] > values["max_value"]:
        raise ValueError("Metric minimum exceeds maximum")
    return {
        "series_id": series.series_id,
        "name": series.definition.name,
        "tags_json": dict(series.tags),
        "bucket_start": bucket.isoformat(),
        "source_id": source_id,
        "revision": revision,
        "count": count,
        **values,
        "last_observed_at": _utc(raw["last_observed_at"]).isoformat(),
        "source_gap": bool(raw.get("source_gap", False)),
    }


def upsert_metric_minute_snapshots(snapshots: list[dict], *, session=None) -> int:
    """Replace a series/minute only with a newer revision of the same source."""
    rows: dict[tuple[str, str], dict] = {}
    for raw in snapshots:
        row = _snapshot(raw)
        key = row["series_id"], row["bucket_start"]
        previous = rows.get(key)
        if previous is None:
            rows[key] = row
        else:
            previous["source_gap"] |= row["source_gap"]
            if previous["source_id"] != row["source_id"]:
                previous["source_gap"] = True
            elif row["revision"] > previous["revision"]:
                row["source_gap"] |= previous["source_gap"]
                rows[key] = row
    if not rows:
        return 0
    statement = text("""
        INSERT INTO metric_minute_snapshots AS stored
            (series_id, name, tags_json, bucket_start, source_id, revision, count,
             sum_value, min_value, max_value, last_value, last_observed_at, source_gap)
        SELECT series_id, name, tags_json, bucket_start, source_id, revision, count,
               sum_value, min_value, max_value, last_value, last_observed_at, source_gap
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS incoming (
            series_id TEXT, name TEXT, tags_json JSONB, bucket_start TIMESTAMPTZ,
            source_id TEXT, revision BIGINT, count BIGINT, sum_value DOUBLE PRECISION,
            min_value DOUBLE PRECISION, max_value DOUBLE PRECISION,
            last_value DOUBLE PRECISION, last_observed_at TIMESTAMPTZ, source_gap BOOLEAN
        )
        ORDER BY series_id, bucket_start
        ON CONFLICT (series_id, bucket_start) DO UPDATE SET
            revision = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                            THEN EXCLUDED.revision ELSE stored.revision END,
            count = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                         THEN EXCLUDED.count ELSE stored.count END,
            sum_value = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                             THEN EXCLUDED.sum_value ELSE stored.sum_value END,
            min_value = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                             THEN EXCLUDED.min_value ELSE stored.min_value END,
            max_value = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                             THEN EXCLUDED.max_value ELSE stored.max_value END,
            last_value = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                              THEN EXCLUDED.last_value ELSE stored.last_value END,
            last_observed_at = CASE WHEN stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision
                                   THEN EXCLUDED.last_observed_at ELSE stored.last_observed_at END,
            source_gap = stored.source_gap OR EXCLUDED.source_gap
                         OR stored.source_id <> EXCLUDED.source_id,
            updated_at = CURRENT_TIMESTAMP
        WHERE (stored.source_id = EXCLUDED.source_id AND EXCLUDED.revision > stored.revision)
           OR (stored.source_id <> EXCLUDED.source_id AND NOT stored.source_gap)
           OR (EXCLUDED.source_gap AND NOT stored.source_gap)
        RETURNING series_id
    """)
    with optional_scope(session) as current:
        changed = len(
            current.execute(
                statement, {"rows": json.dumps(list(rows.values()), allow_nan=False)}
            ).all()
        )
        current.execute(
            text("""
                INSERT INTO settings (key, value)
                VALUES ('metrics_v2_cutover_at', :cutover)
                ON CONFLICT (key) DO NOTHING
            """),
            {"cutover": min(row["bucket_start"] for row in rows.values())},
        )
        return changed


def delete_metric_minute_snapshots_before(
    before, limit: int = 1000, *, session=None
) -> int:
    """Delete one bounded retention batch, allowing concurrent maintenance."""
    cutoff = _utc(before)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 5000:
        raise ValueError("Metric retention batch must contain 1 to 5000 rows")
    with optional_scope(session) as current:
        with current.begin_nested():
            original = current.execute(
                text(
                    "SELECT current_setting('statement_timeout'), current_setting('lock_timeout')"
                )
            ).one()
            current.execute(text("SET LOCAL statement_timeout = '500ms'"))
            current.execute(text("SET LOCAL lock_timeout = '50ms'"))
            rows = current.execute(
                text("""
                WITH expired AS (
                    SELECT series_id, bucket_start
                    FROM metric_minute_snapshots
                    WHERE bucket_start < :before
                    ORDER BY bucket_start, series_id
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                DELETE FROM metric_minute_snapshots AS stored
                USING expired
                WHERE stored.series_id = expired.series_id
                  AND stored.bucket_start = expired.bucket_start
                RETURNING stored.series_id
            """),
                {"before": cutoff, "limit": limit},
            ).all()
            oldest = current.execute(
                text("""
                SELECT bucket_start FROM metric_minute_snapshots
                WHERE bucket_start < :before ORDER BY bucket_start, series_id LIMIT 1
            """),
                {"before": cutoff},
            ).scalar_one_or_none()
            current.execute(
                text("""
                INSERT INTO settings (key, value) VALUES ('metrics_v2_retention_state', :value)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """),
                {
                    "value": json.dumps(
                        {
                            "checked_at": datetime.now(timezone.utc).isoformat(),
                            "deleted": len(rows),
                            "batch_limit": limit,
                            "backlog": oldest is not None,
                            "oldest_pending_at": oldest.isoformat() if oldest else None,
                        }
                    )
                },
            )
            current.execute(
                text(
                    "SELECT set_config('statement_timeout', :statement, true), set_config('lock_timeout', :lock, true)"
                ),
                {"statement": original[0], "lock": original[1]},
            )
    return len(rows)


__all__ = [
    "upsert_metric_minute_snapshots",
    "delete_metric_minute_snapshots_before",
    "persist_metric_collection",
]
