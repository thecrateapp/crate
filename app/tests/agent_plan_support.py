"""Shared helpers for exact human decisions on persisted agent plans."""

from crate.db.repositories import agent_plans


def decide(actor, plan, decision="approved", **overrides):
    args = {
        key: plan[key]
        for key in (
            "plan_version",
            "content_hash",
            "policy_revision",
            "authorization_context_hash",
        )
    }
    return agent_plans.decide_plan(
        actor, plan["plan_id"], decision=decision, **{**args, **overrides}
    )
