"""Server side of AI Assisted Mixing (SM3-D4, D5, D9, D10).

The plan API, capabilities and the refinement task share these pieces:

- the gate: the admin switch (`smart_mix_ai_enabled`, off by default), whether
  the genre may be sent (`smart_mix_ai_send_genre`), the availability and
  fingerprint of `smart_mix.transition.refine`, and a budget marker. It is
  cached in Redis (``crate.db.cache_store``) so a cached plan request reads no
  PostgreSQL for it;
- the refinement key of an edge (``crate.smart_mix.refinement.refinement_key``
  with this prompt's version and schema);
- the cache entry the plan API serves for a stored refinement.

Nothing here calls a model.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from crate.ai.runtime import action_availability
from crate.db.cache_settings import get_setting
from crate.db.cache_store import (
    delete_smart_mix_refinement_gate,
    get_smart_mix_refinement_gate,
    set_smart_mix_refinement_budget_marker,
    set_smart_mix_refinement_gate,
    smart_mix_refinement_budget_exhausted,
)
from crate.llm.prompts.smart_mix_transition import PROMPT_VERSION, SCHEMA_FINGERPRINT
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.refinement import refinement_key

REFINE_ACTION = "smart_mix.transition.refine"
ENABLED_SETTING = "smart_mix_ai_enabled"
SEND_GENRE_SETTING = "smart_mix_ai_send_genre"
# Providers that run on the operator's own server (SM3-D11).
LOCAL_PROVIDERS = frozenset({"ollama"})
_MIN_BUDGET_MARKER_SECONDS = 60


def refinement_gate() -> dict[str, Any]:
    """The server switches of AI refinement, from the cache when it has them."""
    cached = get_smart_mix_refinement_gate()
    if cached is not None:
        return cached
    gate = read_refinement_gate()
    set_smart_mix_refinement_gate(gate)
    return gate


def read_refinement_gate() -> dict[str, Any]:
    enabled = get_setting(ENABLED_SETTING, "false") == "true"
    send_genre = get_setting(SEND_GENRE_SETTING, "true") == "true"
    availability: Mapping[str, Any] = (
        action_availability(REFINE_ACTION)
        if enabled
        else {"available": False, "error_code": None}
    )
    fingerprint = availability.get("fingerprint")
    return {
        "enabled": enabled,
        "send_genre": send_genre,
        "available": bool(availability.get("available")),
        "error_code": availability.get("error_code"),
        "fingerprint": fingerprint,
        "provider": availability.get("provider"),
        "model_id": availability.get("model_id"),
        "budget_exhausted": bool(fingerprint)
        and smart_mix_refinement_budget_exhausted(str(fingerprint)),
    }


def gate_reason(gate: Mapping[str, Any]) -> str | None:
    """Why the gate refuses refinements, as a closed reason code, or None."""
    if not gate.get("enabled"):
        return "disabled"
    if not gate.get("available") or not gate.get("fingerprint"):
        return "no_model"
    if gate.get("budget_exhausted"):
        return "budget"
    return None


def invalidate_refinement_gate() -> None:
    delete_smart_mix_refinement_gate()


def mark_budget_exhausted(fingerprint: str, *, now: datetime | None = None) -> None:
    """The provider refused the daily budget: no refinement queues until UTC midnight."""
    current = now or datetime.now(UTC)
    midnight = datetime.combine(
        current.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC
    )
    seconds = max(_MIN_BUDGET_MARKER_SECONDS, int((midnight - current).total_seconds()))
    set_smart_mix_refinement_budget_marker(fingerprint, seconds)
    invalidate_refinement_gate()


def provider_kind(provider: str | None) -> str:
    return "local" if provider in LOCAL_PROVIDERS else "cloud"


def edge_refinement_key(
    *,
    outgoing_track_entity_uid: str,
    incoming_track_entity_uid: str,
    outgoing_profile_revision: str,
    incoming_profile_revision: str,
    context: Mapping[str, Any],
    config_fingerprint: str,
    send_genre: bool,
) -> str:
    """The refinement key of a v3 edge with the current prompt and schema."""
    return refinement_key(
        planner_identifier=PLANNER_POLICY_V3.identifier,
        rules_revision=PLANNER_POLICY_V3.rules_revision,
        outgoing_track_entity_uid=outgoing_track_entity_uid,
        incoming_track_entity_uid=incoming_track_entity_uid,
        outgoing_profile_revision=outgoing_profile_revision,
        incoming_profile_revision=incoming_profile_revision,
        context=context,
        prompt_version=PROMPT_VERSION,
        schema_fingerprint=SCHEMA_FINGERPRINT,
        config_fingerprint=config_fingerprint,
        send_genre=send_genre,
    )


def refined_cache_entry(stored: Mapping[str, Any]) -> dict[str, Any]:
    """What the plan API serves for a stored refinement (a table row)."""
    if stored["status"] == "ready":
        return {
            "status": "ready",
            "plan": stored["plan"],
            "candidateIndex": stored["candidate_index"],
            "reason": stored["reason"],
            "confidence": stored["confidence"],
            "modelLabel": stored["model_label"],
            "promptVersion": stored["prompt_version"],
        }
    return {"status": stored["status"], "code": stored["outcome_code"]}


__all__ = [
    "ENABLED_SETTING",
    "LOCAL_PROVIDERS",
    "REFINE_ACTION",
    "SEND_GENRE_SETTING",
    "edge_refinement_key",
    "gate_reason",
    "invalidate_refinement_gate",
    "mark_budget_exhausted",
    "provider_kind",
    "read_refinement_gate",
    "refined_cache_entry",
    "refinement_gate",
]
