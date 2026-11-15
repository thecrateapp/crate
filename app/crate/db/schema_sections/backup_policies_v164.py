"""Backup policies: when the engine copies the database and where (admin backups, BK3).

- `backup_policies`: one row per policy. `schedule_kind` is `daily` (at `daily_at`,
  HH:MM in the server's time zone), `hours` (every `interval_hours`) or `manual`
  (Run now, or the deploy through `make backup-before-upgrade` when
  `run_before_upgrade` is set). An optional window (`window_start`-`window_end`)
  bounds when uploads, verifications and drills may start. Retention is restic's
  `keep_daily`, `keep_weekly` and `keep_monthly`, applied to each destination's own
  repository. `verify_every_days` and `drill_every_days` (0 = off) set the cadence
  of `restic check` and of the restore drill; `drill_destination_id` NULL means
  the drill rotates through the policy's destinations. `last_scheduled_at` is when
  the scheduler last started the policy.
- `backup_policy_destinations`: which destinations a policy writes to, and which
  copies each one receives (`tiers`: daily, weekly, monthly).
- `backup_runs` gains `policy_id` and `destination_id`. Deleting a policy or a
  destination keeps its runs, with the link set to NULL.
"""

V164_SCHEDULE_KINDS = "'daily', 'hours', 'manual'"
V164_COMPRESSIONS = "'auto', 'max', 'off'"
_HHMM = "'^([01][0-9]|2[0-3]):[0-5][0-9]$'"


def create_backup_policies_v164_schema(cur) -> None:
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS backup_policies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            schedule_kind TEXT NOT NULL
                CHECK (schedule_kind IN ({V164_SCHEDULE_KINDS})),
            daily_at TEXT CHECK (daily_at IS NULL OR daily_at ~ {_HHMM}),
            interval_hours INTEGER
                CHECK (interval_hours IS NULL OR interval_hours BETWEEN 1 AND 168),
            window_start TEXT CHECK (window_start IS NULL OR window_start ~ {_HHMM}),
            window_end TEXT CHECK (window_end IS NULL OR window_end ~ {_HHMM}),
            keep_daily INTEGER NOT NULL DEFAULT 7
                CHECK (keep_daily BETWEEN 0 AND 1000),
            keep_weekly INTEGER NOT NULL DEFAULT 4
                CHECK (keep_weekly BETWEEN 0 AND 1000),
            keep_monthly INTEGER NOT NULL DEFAULT 3
                CHECK (keep_monthly BETWEEN 0 AND 1000),
            compression TEXT NOT NULL DEFAULT 'auto'
                CHECK (compression IN ({V164_COMPRESSIONS})),
            verify_every_days INTEGER NOT NULL DEFAULT 7
                CHECK (verify_every_days BETWEEN 0 AND 365),
            verify_read_percent INTEGER NOT NULL DEFAULT 5
                CHECK (verify_read_percent BETWEEN 1 AND 100),
            drill_every_days INTEGER NOT NULL DEFAULT 30
                CHECK (drill_every_days BETWEEN 0 AND 365),
            drill_destination_id UUID REFERENCES backup_destinations(id)
                ON DELETE SET NULL,
            run_before_upgrade BOOLEAN NOT NULL DEFAULT FALSE,
            last_scheduled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (keep_daily + keep_weekly + keep_monthly > 0),
            CHECK ((schedule_kind = 'daily') = (daily_at IS NOT NULL)),
            CHECK ((schedule_kind = 'hours') = (interval_hours IS NOT NULL)),
            CHECK ((window_start IS NULL) = (window_end IS NULL)),
            CHECK (schedule_kind <> 'manual' OR window_start IS NULL)
        )
    """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_policies_name
        ON backup_policies (lower(name))
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backup_policy_destinations (
            policy_id UUID NOT NULL REFERENCES backup_policies(id) ON DELETE CASCADE,
            destination_id UUID NOT NULL
                REFERENCES backup_destinations(id) ON DELETE CASCADE,
            tiers TEXT[] NOT NULL CHECK (
                cardinality(tiers) BETWEEN 1 AND 3
                AND tiers <@ ARRAY['daily', 'weekly', 'monthly']::text[]
            ),
            PRIMARY KEY (policy_id, destination_id)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backup_policy_destinations_destination
        ON backup_policy_destinations (destination_id)
    """)
    cur.execute("""
        ALTER TABLE backup_runs
            ADD COLUMN IF NOT EXISTS policy_id UUID
                REFERENCES backup_policies(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS destination_id UUID
                REFERENCES backup_destinations(id) ON DELETE SET NULL
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backup_runs_destination_started
        ON backup_runs (destination_id, kind, started_at DESC)
        WHERE destination_id IS NOT NULL
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backup_runs_policy_started
        ON backup_runs (policy_id, started_at DESC)
        WHERE policy_id IS NOT NULL
    """)


def drop_backup_policies_v164_schema(cur) -> None:
    cur.execute("DROP INDEX IF EXISTS idx_backup_runs_policy_started")
    cur.execute("DROP INDEX IF EXISTS idx_backup_runs_destination_started")
    cur.execute(
        "ALTER TABLE backup_runs DROP COLUMN IF EXISTS destination_id, "
        "DROP COLUMN IF EXISTS policy_id"
    )
    cur.execute("DROP TABLE IF EXISTS backup_policy_destinations")
    cur.execute("DROP TABLE IF EXISTS backup_policies")


__all__ = [
    "V164_COMPRESSIONS",
    "V164_SCHEDULE_KINDS",
    "create_backup_policies_v164_schema",
    "drop_backup_policies_v164_schema",
]
