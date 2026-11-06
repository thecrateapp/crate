"""Server side of AI Assisted Mixing (SM3-D4, D5, D9, D10).

The plan API, capabilities and the refinement task share these pieces:

- the gate: the admin switch (`smart_mix_ai_enabled`, off by default), whether
  the genre may be sent (`smart_mix_ai_send_genre`), the availability and
  fingerprint of `smart_mix.transition.refine`, and a budget marker. It is
  cached in Redis (``crate.db.cache_store``) so a cached plan request reads no
  PostgreSQL for it;
- the refinement key of an edge (``crate.smart_mix.refinement.refinement_key``
  with this prompt's version and schema);
- the cache entry the plan API serves for a stored refinement;
- ``RefinementBatch``: the refinements of one plan request (SM3-D4). It keys
  the edges, maps what the cache holds, reads the table once for keys Redis
  missed, and queues the rest with ``accept_action`` and ``create_task_dedup``
  (64 per user and minute). Nothing here calls a model.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from crate.ai.consumers import accept_action
from crate.ai.contracts import AIConfigurationError
from crate.ai.runtime import action_availability
from crate.db.cache_settings import get_setting
from crate.db.cache_store import (
    SMART_MIX_REFINEMENT_PENDING_TTL_SECONDS,
    consume_smart_mix_refinement_quota,
    delete_smart_mix_refinement_gate,
    get_smart_mix_refinement_gate,
    record_smart_mix_refinement_reads,
    set_smart_mix_refined_plan_caches,
    set_smart_mix_refinement_budget_marker,
    set_smart_mix_refinement_gate,
    smart_mix_refinement_budget_exhausted,
)
from crate.db.repositories.smart_mix_refinements import get_many as get_refinements
from crate.db.repositories.tasks import create_task_dedup
from crate.llm.prompts.smart_mix_transition import PROMPT_VERSION, SCHEMA_FINGERPRINT
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.refinement import refinement_key

REFINE_ACTION = "smart_mix.transition.refine"
REFINE_TASK = "smart_mix_refine_transition"
# Access tokens (`crv_`) need this scope too, so a plugin cannot spend on AI
# unless the user allowed it when creating the token (design §7).
REFINE_SCOPE = "vdj.smart_mix.ai"
REFINEMENT_ENQUEUE_LIMIT = 64
REFINEMENT_ENQUEUE_WINDOW_SECONDS = 60
# The first edges of a batch are the next transitions to play.
PRIORITY_EDGES = 2
ENABLED_SETTING = "smart_mix_ai_enabled"
SEND_GENRE_SETTING = "smart_mix_ai_send_genre"
# Providers that run on the operator's own server (SM3-D11).
LOCAL_PROVIDERS = frozenset({"ollama"})
_MIN_BUDGET_MARKER_SECONDS = 60

GateReason = Literal["disabled", "no_model", "budget"]


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


def gate_reason(gate: Mapping[str, Any]) -> GateReason | None:
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


def provider_kind(provider: str | None) -> Literal["local", "cloud"]:
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


@dataclass(frozen=True, slots=True)
class RefinementRequest:
    """One edge of a plan request that asked for ``aiRefinement``."""

    position: int
    outgoing_track_entity_uid: str
    incoming_track_entity_uid: str
    outgoing_profile_revision: str | None
    incoming_profile_revision: str | None
    context: Mapping[str, Any]
    # Manual skips and albums have a single plan: nothing to choose.
    single_candidate: bool


def refinement_response(entry: Mapping[str, Any]) -> dict[str, Any]:
    """The API ``refinement`` of a cached entry."""
    status = entry.get("status")
    if status == "ready":
        return {
            "status": "ready",
            "plan": entry["plan"],
            "source": "ai",
            "modelLabel": entry.get("modelLabel"),
            "reason": entry.get("reason"),
            "confidence": entry.get("confidence"),
            "promptVersion": entry.get("promptVersion"),
            "candidateIndex": entry.get("candidateIndex"),
        }
    if status == "pending":
        return {"status": "pending"}
    if status == "rejected":
        return _unavailable("rejected")
    return _unavailable(str(entry.get("reasonCode") or "failed"))


def _unavailable(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "reasonCode": reason}


class RefinementBatch:
    """The refinements of one plan request (SM3-D4).

    Construction keys the eligible edges from the cached gate; ``keys`` go into
    the same ``mget`` as the plans; ``resolve`` turns what the cache returned
    into responses, reads the table once for the keys Redis missed and queues
    the rest.
    """

    def __init__(
        self,
        requests: Sequence[RefinementRequest],
        *,
        actor_id: int | None,
        access_reason: str | None,
    ) -> None:
        self.requests = {request.position: request for request in requests}
        self.actor_id = actor_id
        self.statuses: dict[int, dict[str, Any]] = {}
        self.keys: dict[int, str] = {}
        self.gate: dict[str, Any] = {}
        reason = access_reason
        if reason is None:
            self.gate = refinement_gate()
            reason = gate_reason(self.gate)
        for request in requests:
            if reason is not None:
                self.statuses[request.position] = _unavailable(reason)
            elif (
                request.outgoing_profile_revision is None
                or request.incoming_profile_revision is None
            ):
                self.statuses[request.position] = _unavailable("missing_profile")
            elif request.single_candidate:
                self.statuses[request.position] = _unavailable("single_candidate")
            else:
                self.keys[request.position] = self._key(
                    request, str(self.gate["fingerprint"])
                )

    def _key(self, request: RefinementRequest, fingerprint: str) -> str:
        assert request.outgoing_profile_revision is not None
        assert request.incoming_profile_revision is not None
        return edge_refinement_key(
            outgoing_track_entity_uid=request.outgoing_track_entity_uid,
            incoming_track_entity_uid=request.incoming_track_entity_uid,
            outgoing_profile_revision=request.outgoing_profile_revision,
            incoming_profile_revision=request.incoming_profile_revision,
            context=request.context,
            config_fingerprint=fingerprint,
            send_genre=bool(self.gate.get("send_genre", True)),
        )

    def resolve(self, cached: Mapping[str, Mapping[str, Any]]) -> dict[int, dict]:
        served: list[str] = []
        missed: list[int] = []
        for position, key in self.keys.items():
            entry = cached.get(key)
            if entry is None:
                missed.append(position)
                continue
            self.statuses[position] = refinement_response(entry)
            if entry.get("status") == "ready":
                served.append(key)
        if missed:
            stored = get_refinements([self.keys[position] for position in missed])
            entries = {key: refined_cache_entry(row) for key, row in stored.items()}
            if entries:
                set_smart_mix_refined_plan_caches(entries)
            for position in missed:
                entry = entries.get(self.keys[position])
                if entry is not None:
                    self.statuses[position] = refinement_response(entry)
                    if entry["status"] == "ready":
                        served.append(self.keys[position])
            queued = [
                position for position in missed if self.keys[position] not in entries
            ]
            if queued:
                self._enqueue(queued)
        if served:
            record_smart_mix_refinement_reads(served)
        return self.statuses

    def _enqueue(self, positions: list[int]) -> None:
        try:
            acceptance = accept_action(REFINE_ACTION)
        except AIConfigurationError:
            invalidate_refinement_gate()
            for position in positions:
                self.statuses[position] = _unavailable("no_model")
            return
        fingerprint = str(acceptance["fingerprint"])
        if fingerprint != self.gate.get("fingerprint"):
            # The configuration changed since the gate was cached: key these
            # edges with what was accepted, and refresh the gate.
            invalidate_refinement_gate()
            for position in positions:
                self.keys[position] = self._key(self.requests[position], fingerprint)
        allowed = (
            len(positions)
            if self.actor_id is None
            else consume_smart_mix_refinement_quota(
                self.actor_id,
                len(positions),
                limit=REFINEMENT_ENQUEUE_LIMIT,
                window_seconds=REFINEMENT_ENQUEUE_WINDOW_SECONDS,
            )
        )
        order = {position: rank for rank, position in enumerate(sorted(self.requests))}
        pending: dict[str, dict[str, Any]] = {}
        for rank, position in enumerate(positions):
            if rank >= allowed:
                self.statuses[position] = _unavailable("rate_limited")
                continue
            request = self.requests[position]
            key = self.keys[position]
            create_task_dedup(
                REFINE_TASK,
                {
                    "refinement_key": key,
                    "outgoing_track_entity_uid": request.outgoing_track_entity_uid,
                    "incoming_track_entity_uid": request.incoming_track_entity_uid,
                    "outgoing_profile_revision": request.outgoing_profile_revision,
                    "incoming_profile_revision": request.incoming_profile_revision,
                    "context": dict(request.context),
                    "send_genre": bool(self.gate.get("send_genre", True)),
                    "ai_acceptance": acceptance,
                    "actor_user_id": self.actor_id,
                },
                dedup_key=f"smart-mix-refine:{key}",
                priority=0 if order[position] < PRIORITY_EDGES else 1,
                actor_user_id=self.actor_id,
            )
            pending[key] = {"status": "pending"}
            self.statuses[position] = {"status": "pending"}
        if pending:
            set_smart_mix_refined_plan_caches(
                pending, ttl_seconds=SMART_MIX_REFINEMENT_PENDING_TTL_SECONDS
            )


__all__ = [
    "ENABLED_SETTING",
    "LOCAL_PROVIDERS",
    "PRIORITY_EDGES",
    "REFINEMENT_ENQUEUE_LIMIT",
    "REFINE_ACTION",
    "REFINE_SCOPE",
    "REFINE_TASK",
    "RefinementBatch",
    "RefinementRequest",
    "SEND_GENRE_SETTING",
    "edge_refinement_key",
    "gate_reason",
    "invalidate_refinement_gate",
    "mark_budget_exhausted",
    "provider_kind",
    "read_refinement_gate",
    "refined_cache_entry",
    "refinement_gate",
    "refinement_response",
]
