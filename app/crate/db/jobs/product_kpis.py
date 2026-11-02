"""Daily product KPIs computed by a worker task from rollups and small tables.

Listening KPIs use the listener's local day, like the instance listening
rollups. Event KPIs (signups, engagement, acquisition, federation, streams)
use UTC days. Snapshot KPIs describe the instance when they are computed and
are only written for the current day. A source without data writes no row, so
a missing reading is never stored as zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import text

from crate.db.queries.auth_user_activity import configured_inactive_after_days
from crate.db.tx import read_scope, transaction_scope

BACKFILL_DAYS = 365
STREAM_RETENTION_DAYS = 8
DEVICE_ACTIVE_DAYS = 30
PEER_ACTIVE_DAYS = 7
ACQUISITION_SOURCES = {
    "soulseek_download": "soulseek",
    "tidal_download": "tidal",
    "agent_tidal_download": "tidal",
    "bandcamp_import_purchase": "bandcamp",
    "library_upload": "upload",
    "import_queue_item": "import_queue",
    "federation_import_album": "federation",
}
STREAM_METRICS = {
    "stream.requests": ("streams.requests", 1.0),
    "stream.bytes": ("streams.gib", 1024**3),
    "stream.transcode.completed": ("streams.transcodes_completed", 1.0),
    "stream.transcode.failed": ("streams.transcodes_failed", 1.0),
}


def _label(column: str) -> str:
    return (
        f"CASE WHEN {column} IS NULL OR {column} = '' THEN 'unknown' "
        f"WHEN {column} ~ '^[a-z0-9_-]{{1,24}}$' THEN {column} ELSE 'other' END"
    )


@dataclass(frozen=True)
class KpiQuery:
    kpis: tuple[str, ...]
    sql: str
    snapshot: bool = False
    streams: bool = False


_ACQUISITION_SOURCE = (
    "CASE type "
    + " ".join(
        f"WHEN '{task}' THEN '{source}'" for task, source in ACQUISITION_SOURCES.items()
    )
    + " END"
)
_STREAM_KPI = (
    "CASE name "
    + " ".join(
        f"WHEN '{name}' THEN '{kpi}'" for name, (kpi, _) in STREAM_METRICS.items()
    )
    + " END"
)
_STREAM_SCALE = (
    "CASE name "
    + " ".join(
        f"WHEN '{name}' THEN {scale}" for name, (_, scale) in STREAM_METRICS.items()
    )
    + " END"
)

KPI_QUERIES: tuple[KpiQuery, ...] = (
    KpiQuery(
        (
            "users.daily_listeners",
            "listening.plays",
            "listening.complete_plays",
            "listening.skips",
            "listening.hours",
        ),
        """
        WITH totals AS (
            SELECT COUNT(*) AS listeners,
                   COALESCE(SUM(play_count), 0) AS plays,
                   COALESCE(SUM(complete_play_count), 0) AS completes,
                   COALESCE(SUM(skip_count), 0) AS skips,
                   COALESCE(SUM(minutes_listened), 0) AS minutes
            FROM user_daily_listening
            WHERE day = :day AND play_count > 0
        )
        SELECT metric.kpi, '{}'::jsonb AS dims, metric.value, totals.listeners::int AS sample
        FROM totals CROSS JOIN LATERAL (VALUES
            ('users.daily_listeners', totals.listeners::float8),
            ('listening.plays', totals.plays::float8),
            ('listening.complete_plays', totals.completes::float8),
            ('listening.skips', totals.skips::float8),
            ('listening.hours', totals.minutes / 60.0)
        ) AS metric(kpi, value)
        """,
    ),
    KpiQuery(
        ("users.weekly_listeners", "users.monthly_listeners"),
        """
        SELECT 'users.weekly_listeners' AS kpi, '{}'::jsonb AS dims,
               COUNT(DISTINCT user_id)::float8 AS value, COUNT(DISTINCT user_id)::int AS sample
        FROM user_daily_listening
        WHERE play_count > 0 AND day BETWEEN CAST(:day AS date) - 6 AND CAST(:day AS date)
        UNION ALL
        SELECT 'users.monthly_listeners', '{}'::jsonb,
               COUNT(DISTINCT user_id)::float8, COUNT(DISTINCT user_id)::int
        FROM user_daily_listening
        WHERE play_count > 0 AND day BETWEEN CAST(:day AS date) - 29 AND CAST(:day AS date)
        """,
    ),
    KpiQuery(
        ("listening.unique_tracks", "listening.unique_artists"),
        """
        SELECT 'listening.unique_tracks' AS kpi, '{}'::jsonb AS dims,
               COUNT(DISTINCT entity_key)::float8 AS value, NULL::int AS sample
        FROM instance_track_daily WHERE day = :day
        UNION ALL
        SELECT 'listening.unique_artists', '{}'::jsonb,
               COUNT(DISTINCT artist) FILTER (WHERE artist <> '')::float8, NULL::int
        FROM instance_track_daily WHERE day = :day
        """,
    ),
    KpiQuery(
        ("listening.sessions", "listening.session_minutes_avg"),
        """
        WITH totals AS (
            SELECT COUNT(*) AS sessions, AVG(minutes_listened) AS average,
                   COUNT(DISTINCT user_id) AS users
            FROM user_listening_sessions
            WHERE started_at >= :start AND started_at < :end
        )
        SELECT metric.kpi, '{}'::jsonb AS dims, metric.value, totals.users::int AS sample
        FROM totals CROSS JOIN LATERAL (VALUES
            ('listening.sessions', totals.sessions::float8),
            ('listening.session_minutes_avg', totals.average::float8)
        ) AS metric(kpi, value)
        """,
    ),
    KpiQuery(
        (
            "listening.plays_by_platform",
            "listening.plays_by_source",
            "listening.plays_by_origin",
        ),
        f"""
        WITH events AS (
            SELECT user_id,
                   {_label("app_platform")} AS platform,
                   {_label("play_source_type")} AS source,
                   {_label("content_origin")} AS origin
            FROM user_play_events
            WHERE created_at >= :start AND created_at < :end
        )
        SELECT 'listening.plays_by_platform' AS kpi, jsonb_build_object('platform', platform) AS dims,
               COUNT(*)::float8 AS value, COUNT(DISTINCT user_id)::int AS sample
        FROM events GROUP BY platform
        UNION ALL
        SELECT 'listening.plays_by_source', jsonb_build_object('source', source),
               COUNT(*)::float8, COUNT(DISTINCT user_id)::int
        FROM events GROUP BY source
        UNION ALL
        SELECT 'listening.plays_by_origin', jsonb_build_object('origin', origin),
               COUNT(*)::float8, COUNT(DISTINCT user_id)::int
        FROM events GROUP BY origin
        """,
    ),
    KpiQuery(
        ("users.signups", "users.total", "users.invites_accepted"),
        """
        SELECT 'users.signups' AS kpi, '{}'::jsonb AS dims, COUNT(*)::float8 AS value, NULL::int AS sample
        FROM users WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'users.total', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM users WHERE created_at < :end AND (deleted_at IS NULL OR deleted_at >= :end)
        UNION ALL
        SELECT 'users.invites_accepted', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM auth_invites WHERE accepted_at >= :start AND accepted_at < :end
        """,
    ),
    KpiQuery(
        ("users.retention_w1", "users.retention_w4"),
        """
        WITH cohorts AS (
            SELECT 'users.retention_w1' AS kpi, id,
                   (created_at AT TIME ZONE 'UTC')::date AS signup, 7 AS offset_days
            FROM users
            WHERE deleted_at IS NULL
              AND created_at >= :start - INTERVAL '19 days'
              AND created_at < :start - INTERVAL '12 days'
            UNION ALL
            SELECT 'users.retention_w4', id, (created_at AT TIME ZONE 'UTC')::date, 28
            FROM users
            WHERE deleted_at IS NULL
              AND created_at >= :start - INTERVAL '40 days'
              AND created_at < :start - INTERVAL '33 days'
        )
        SELECT kpi, '{}'::jsonb AS dims,
               AVG(CASE WHEN EXISTS (
                   SELECT 1 FROM user_daily_listening listened
                   WHERE listened.user_id = cohorts.id AND listened.play_count > 0
                     AND listened.day BETWEEN cohorts.signup + cohorts.offset_days
                                          AND cohorts.signup + cohorts.offset_days + 6
               ) THEN 1.0 ELSE 0.0 END)::float8 AS value,
               COUNT(*)::int AS sample
        FROM cohorts GROUP BY kpi
        """,
    ),
    KpiQuery(
        ("users.active",),
        """
        WITH seen AS (
            SELECT user_id, MAX(last_seen_at) AS last_seen FROM sessions GROUP BY user_id
        ), played AS (
            SELECT user_id, ((MAX(day) + 1)::timestamp AT TIME ZONE 'UTC') AS last_played
            FROM user_daily_listening WHERE play_count > 0 GROUP BY user_id
        )
        SELECT 'users.active' AS kpi, '{}'::jsonb AS dims, COUNT(*)::float8 AS value, NULL::int AS sample
        FROM users
        LEFT JOIN seen ON seen.user_id = users.id
        LEFT JOIN played ON played.user_id = users.id
        WHERE users.deleted_at IS NULL
          AND GREATEST(users.last_login, seen.last_seen, played.last_played)
              >= :now - make_interval(days => :inactive_days)
        """,
        snapshot=True,
    ),
    KpiQuery(
        ("devices.active_by_platform",),
        f"""
        SELECT 'devices.active_by_platform' AS kpi,
               jsonb_build_object('platform', {_label("app_platform")}) AS dims,
               COUNT(*)::float8 AS value, COUNT(DISTINCT user_id)::int AS sample
        FROM user_devices
        WHERE revoked_at IS NULL AND last_seen_at >= :now - make_interval(days => :device_days)
        GROUP BY 2
        """,
        snapshot=True,
    ),
    KpiQuery(
        (
            "library.artists",
            "library.albums",
            "library.tracks",
            "library.size_gib",
            "library.played_share_30d",
        ),
        """
        WITH tracks AS (
            SELECT COUNT(*) AS total, COALESCE(SUM(size), 0) AS bytes FROM library_tracks
        ), played AS (
            SELECT COUNT(DISTINCT track_id) AS total FROM instance_track_daily
            WHERE track_id IS NOT NULL AND day >= CAST(:day AS date) - 29
        )
        SELECT 'library.artists' AS kpi, '{}'::jsonb AS dims,
               (SELECT COUNT(*) FROM library_artists)::float8 AS value, NULL::int AS sample
        UNION ALL
        SELECT 'library.albums', '{}'::jsonb, (SELECT COUNT(*) FROM library_albums)::float8, NULL::int
        UNION ALL
        SELECT 'library.tracks', '{}'::jsonb, tracks.total::float8, NULL::int FROM tracks
        UNION ALL
        SELECT 'library.size_gib', '{}'::jsonb, tracks.bytes / 1073741824.0, NULL::int FROM tracks
        UNION ALL
        SELECT 'library.played_share_30d', '{}'::jsonb,
               CASE WHEN tracks.total = 0 THEN 0 ELSE played.total::float8 / tracks.total END,
               NULL::int
        FROM tracks, played
        """,
        snapshot=True,
    ),
    KpiQuery(
        ("federation.active_peers",),
        """
        SELECT 'federation.active_peers' AS kpi, '{}'::jsonb AS dims,
               COUNT(*)::float8 AS value, NULL::int AS sample
        FROM federation_nodes
        WHERE trust_state = 'approved' AND disabled_at IS NULL
          AND last_seen_at >= :now - make_interval(days => :peer_days)
        """,
        snapshot=True,
    ),
    KpiQuery(
        ("library.new_artists",),
        """
        SELECT 'library.new_artists' AS kpi, '{}'::jsonb AS dims,
               COUNT(*)::float8 AS value, NULL::int AS sample
        FROM library_artists WHERE first_seen_at >= :start AND first_seen_at < :end
        """,
    ),
    KpiQuery(
        (
            "acquisition.completed",
            "acquisition.failed",
            "acquisition.minutes_to_complete",
        ),
        f"""
        WITH finished AS (
            SELECT {_ACQUISITION_SOURCE} AS source, status, started_at, updated_at
            FROM tasks
            WHERE type = ANY(:acquisition_types)
              AND status IN ('completed', 'failed')
              AND updated_at >= :start AND updated_at < :end
        )
        SELECT 'acquisition.completed' AS kpi, jsonb_build_object('source', source) AS dims,
               COUNT(*)::float8 AS value, NULL::int AS sample
        FROM finished WHERE status = 'completed' GROUP BY source
        UNION ALL
        SELECT 'acquisition.failed', jsonb_build_object('source', source), COUNT(*)::float8, NULL::int
        FROM finished WHERE status = 'failed' GROUP BY source
        UNION ALL
        SELECT 'acquisition.minutes_to_complete', jsonb_build_object('source', source),
               AVG(EXTRACT(EPOCH FROM updated_at - started_at) / 60.0)::float8, COUNT(*)::int
        FROM finished WHERE status = 'completed' AND started_at IS NOT NULL GROUP BY source
        """,
    ),
    KpiQuery(
        (
            "engagement.likes",
            "engagement.follows",
            "engagement.saved_albums",
            "engagement.playlists_created",
            "engagement.crates_created",
            "engagement.scrobbles_completed",
            "engagement.scrobbles_failed",
        ),
        """
        SELECT 'engagement.likes' AS kpi, '{}'::jsonb AS dims, COUNT(*)::float8 AS value,
               COUNT(DISTINCT user_id)::int AS sample
        FROM user_liked_tracks WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'engagement.follows', '{}'::jsonb, COUNT(*)::float8, COUNT(DISTINCT user_id)::int
        FROM user_follows WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'engagement.saved_albums', '{}'::jsonb, COUNT(*)::float8, COUNT(DISTINCT user_id)::int
        FROM user_saved_albums WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'engagement.playlists_created', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM playlists WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'engagement.crates_created', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM crates WHERE created_at >= :start AND created_at < :end
        UNION ALL
        SELECT 'engagement.scrobbles_completed', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM user_scrobble_dispatches
        WHERE status = 'completed' AND completed_at >= :start AND completed_at < :end
        UNION ALL
        SELECT 'engagement.scrobbles_failed', '{}'::jsonb, COUNT(*)::float8, NULL::int
        FROM user_scrobble_dispatches
        WHERE status = 'failed' AND created_at >= :start AND created_at < :end
        """,
    ),
    KpiQuery(
        ("federation.remote_streams", "federation.import_gib"),
        f"""
        SELECT 'federation.remote_streams' AS kpi,
               jsonb_build_object('direction', {_label("direction")}) AS dims,
               COUNT(*)::float8 AS value, NULL::int AS sample
        FROM federation_stream_tickets
        WHERE used_at >= :start AND used_at < :end
        GROUP BY 2
        UNION ALL
        SELECT 'federation.import_gib', '{{}}'::jsonb,
               COALESCE(SUM(received_bytes), 0) / 1073741824.0, NULL::int
        FROM federation_import_requests
        WHERE completed_at >= :start AND completed_at < :end
          AND status NOT IN ('failed', 'cancelled')
        """,
    ),
    KpiQuery(
        tuple(kpi for kpi, _ in STREAM_METRICS.values()),
        f"""
        SELECT {_STREAM_KPI} AS kpi, '{{}}'::jsonb AS dims,
               SUM(sum_value) / {_STREAM_SCALE} AS value, NULL::int AS sample
        FROM metric_minute_snapshots
        WHERE name = ANY(:stream_names) AND bucket_start >= :start AND bucket_start < :end
        GROUP BY name
        """,
        streams=True,
    ),
)

ALL_KPIS: tuple[str, ...] = tuple(kpi for query in KPI_QUERIES for kpi in query.kpis)


def _bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def _queries_for(day: date, today: date) -> list[KpiQuery]:
    return [
        query
        for query in KPI_QUERIES
        if (not query.snapshot or day == today)
        and (not query.streams or (today - day).days < STREAM_RETENTION_DAYS)
    ]


def compute_product_kpis(
    days: list[date], *, now: datetime | None = None, session=None
) -> int:
    """Recompute the given days; rows of KPIs not computed for a day are kept."""
    reference = now or datetime.now(timezone.utc)
    today = reference.astimezone(timezone.utc).date()

    def _impl(current) -> int:
        current.execute(text("SELECT pg_advisory_xact_lock(hashtext('product_kpis'))"))
        written = 0
        for day in sorted({day for day in days if day <= today}):
            queries = _queries_for(day, today)
            start, end = _bounds(day)
            params = {
                "day": day,
                "start": start,
                "end": end,
                "now": reference,
                "inactive_days": configured_inactive_after_days(),
                "device_days": DEVICE_ACTIVE_DAYS,
                "peer_days": PEER_ACTIVE_DAYS,
                "acquisition_types": list(ACQUISITION_SOURCES),
                "stream_names": list(STREAM_METRICS),
            }
            current.execute(
                text(
                    "DELETE FROM product_kpi_daily WHERE day = :day AND kpi = ANY(:kpis)"
                ),
                {"day": day, "kpis": [kpi for query in queries for kpi in query.kpis]},
            )
            for query in queries:
                result = current.execute(
                    text(
                        f"""
                        INSERT INTO product_kpi_daily (day, kpi, dims, value, sample, computed_at)
                        SELECT :day, kpi_rows.kpi, kpi_rows.dims, kpi_rows.value,
                               kpi_rows.sample, :now
                        FROM ({query.sql}) AS kpi_rows
                        WHERE kpi_rows.value IS NOT NULL
                        """
                    ),
                    params,
                )
                written += result.rowcount or 0
        return written

    if session is not None:
        return _impl(session)
    with transaction_scope() as current:
        return _impl(current)


def product_kpi_days_due(*, now: datetime | None = None, session=None) -> list[date]:
    """Yesterday and today, or every day since the first data when history is empty."""
    reference = now or datetime.now(timezone.utc)
    today = reference.astimezone(timezone.utc).date()
    recent = [today - timedelta(days=1), today]

    def _impl(current) -> list[date]:
        has_history = current.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM product_kpi_daily WHERE day < :yesterday)"
            ),
            {"yesterday": recent[0]},
        ).scalar_one()
        if has_history:
            return recent
        earliest = current.execute(
            text(
                """
                SELECT LEAST(
                    (SELECT MIN(day) FROM user_daily_listening),
                    (SELECT MIN(created_at AT TIME ZONE 'UTC')::date FROM users)
                )
                """
            )
        ).scalar_one()
        first = max(earliest or today, today - timedelta(days=BACKFILL_DAYS))
        return [
            first + timedelta(days=offset) for offset in range((today - first).days + 1)
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "ACQUISITION_SOURCES",
    "ALL_KPIS",
    "BACKFILL_DAYS",
    "KPI_QUERIES",
    "STREAM_METRICS",
    "compute_product_kpis",
    "product_kpi_days_due",
]
