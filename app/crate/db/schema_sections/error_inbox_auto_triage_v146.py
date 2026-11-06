"""Error inbox: remember which digest automatic triage last queued for each issue.

`auto_triage_hash` is the digest the sync pass last queued an automatic triage for,
and `auto_triage_at` when. The pass never queues the same digest twice, whether its
triage was saved or failed, and queues each issue at most once a day: a failure is
retried only by a person (Triage backlog or Investigate), never in a loop. The
daily cap (`triage.daily_max`) counts the issues queued in the last 24 hours.
"""


def create_error_inbox_auto_triage_v146_schema(cur) -> None:
    cur.execute("""
        ALTER TABLE error_issues
            ADD COLUMN IF NOT EXISTS auto_triage_hash TEXT
                CHECK (auto_triage_hash IS NULL OR length(auto_triage_hash) <= 64)
    """)
    cur.execute("""
        ALTER TABLE error_issues
            ADD COLUMN IF NOT EXISTS auto_triage_at TIMESTAMPTZ
    """)


def drop_error_inbox_auto_triage_v146_schema(cur) -> None:
    cur.execute("ALTER TABLE error_issues DROP COLUMN IF EXISTS auto_triage_at")
    cur.execute("ALTER TABLE error_issues DROP COLUMN IF EXISTS auto_triage_hash")


__all__ = [
    "create_error_inbox_auto_triage_v146_schema",
    "drop_error_inbox_auto_triage_v146_schema",
]
