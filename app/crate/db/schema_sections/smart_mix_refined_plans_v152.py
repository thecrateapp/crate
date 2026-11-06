"""Stored Smart Mix refinements (SM4.PR2, design §6, SM3-D5).

One row per refinement key: the hash of the planner, its rules, both profile
revisions, the normalized context, the prompt version and schema, and the
accepted AI configuration. It is the source of truth behind the Redis cache, so
a transition is paid once per combination. Rows hold the validated plan and the
model's choice, never the prompt or the raw answer.

`status` is `ready` (validated plan), `rejected` (the validation discarded the
answer) or `failed` (the call failed after it was sent); `outcome_code` is the
closed code of the last two. The edge indexes serve invalidation when a profile
is recomputed; `last_read_at` serves the 180-day retention.
"""

SMART_MIX_REFINED_PLANS_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS smart_mix_refined_plans (
        refinement_key TEXT PRIMARY KEY
            CHECK (refinement_key ~ '^[0-9a-f]{64}$'),
        from_entity_uid UUID NOT NULL,
        to_entity_uid UUID NOT NULL,
        from_profile_revision TEXT NOT NULL,
        to_profile_revision TEXT NOT NULL,
        planner_identifier TEXT NOT NULL,
        rules_revision INTEGER NOT NULL,
        prompt_version TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        model_label TEXT CHECK (model_label IS NULL OR char_length(model_label) <= 200),
        status TEXT NOT NULL CHECK (status IN ('ready', 'rejected', 'failed')),
        outcome_code TEXT CHECK (outcome_code IS NULL OR char_length(outcome_code) <= 64),
        candidate_index INTEGER CHECK (candidate_index IS NULL OR candidate_index >= 0),
        adjustments JSONB,
        plan JSONB,
        deterministic_plan_hash TEXT,
        reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 240),
        confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
        latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((status = 'ready') = (plan IS NOT NULL)),
        CHECK ((status = 'ready') = (outcome_code IS NULL))
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_smart_mix_refined_plans_edge
        ON smart_mix_refined_plans (from_entity_uid, to_entity_uid)
    """,
    # Invalidation also looks rows up by the incoming track.
    """
    CREATE INDEX IF NOT EXISTS idx_smart_mix_refined_plans_to
        ON smart_mix_refined_plans (to_entity_uid)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_smart_mix_refined_plans_last_read
        ON smart_mix_refined_plans (last_read_at)
    """,
)


def create_smart_mix_refined_plans_v152_schema(cur) -> None:
    for statement in SMART_MIX_REFINED_PLANS_STATEMENTS:
        cur.execute(statement)


def drop_smart_mix_refined_plans_v152_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS smart_mix_refined_plans")


__all__ = [
    "SMART_MIX_REFINED_PLANS_STATEMENTS",
    "create_smart_mix_refined_plans_v152_schema",
    "drop_smart_mix_refined_plans_v152_schema",
]
