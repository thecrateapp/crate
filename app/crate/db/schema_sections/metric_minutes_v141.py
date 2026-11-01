"""Absolute, revisioned metric observations at minute resolution."""


def create_metric_minute_snapshots_v141_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS metric_minute_snapshots (
            series_id TEXT NOT NULL,
            name TEXT NOT NULL,
            tags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            bucket_start TIMESTAMPTZ NOT NULL,
            source_id TEXT NOT NULL,
            revision BIGINT NOT NULL CHECK (revision > 0),
            count BIGINT NOT NULL CHECK (count > 0),
            sum_value DOUBLE PRECISION NOT NULL,
            min_value DOUBLE PRECISION NOT NULL,
            max_value DOUBLE PRECISION NOT NULL,
            last_value DOUBLE PRECISION NOT NULL,
            last_observed_at TIMESTAMPTZ NOT NULL,
            source_gap BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (series_id, bucket_start)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_metric_minutes_name_bucket
        ON metric_minute_snapshots (name, bucket_start DESC)
        INCLUDE (count, sum_value, min_value, max_value, last_observed_at, source_gap)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_metric_minutes_retention
        ON metric_minute_snapshots (bucket_start, series_id)
    """)


__all__ = ["create_metric_minute_snapshots_v141_schema"]
