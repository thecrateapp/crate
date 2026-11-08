"""Ranked candidates of the Smart Mix profile backfill.

Ranking the whole library takes seconds, and a pass only claims the few free
slots of the night window, so the claim ranks the claimable tracks into this
table and later passes read its head in claim order, checking each row is still
claimable. `promotion` marks Python profiles that only a Rust analysis would
improve (claimed after everything else) and `priority` is the stored tier: 3
favorites and collections, 4 listening history, 5 the rest. The play queue and
supplied offline IDs are ranked on every pass and never stored.

It is a cache the claim rebuilds, so it is unlogged: a crash empties it and the
next claim ranks again.
"""

SMART_MIX_BACKFILL_CANDIDATES_STATEMENTS = (
    """
    CREATE UNLOGGED TABLE IF NOT EXISTS smart_mix_backfill_candidates (
        track_id INTEGER PRIMARY KEY,
        promotion BOOLEAN NOT NULL,
        priority SMALLINT NOT NULL CHECK (priority BETWEEN 3 AND 5)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_smart_mix_backfill_candidates_order
        ON smart_mix_backfill_candidates (promotion, priority, track_id)
    """,
)


def create_smart_mix_backfill_candidates_v155_schema(cur) -> None:
    for statement in SMART_MIX_BACKFILL_CANDIDATES_STATEMENTS:
        cur.execute(statement)


def drop_smart_mix_backfill_candidates_v155_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS smart_mix_backfill_candidates")


__all__ = [
    "SMART_MIX_BACKFILL_CANDIDATES_STATEMENTS",
    "create_smart_mix_backfill_candidates_v155_schema",
    "drop_smart_mix_backfill_candidates_v155_schema",
]
