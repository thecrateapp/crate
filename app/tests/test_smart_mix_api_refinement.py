"""`refinement` in the transition plan API (SM4.PR3, SM3-D4, design §7)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from crate import smart_mix_ai
from crate.api import smart_mix
from tests.smart_mix_candidate_cases import INCOMING_LAYOUT, OUTGOING_LAYOUT, profile

PATH = "/api/playback/transition-plans"
FINGERPRINT = "a" * 64
GATE = {
    "enabled": True,
    "send_genre": True,
    "available": True,
    "error_code": None,
    "fingerprint": FINGERPRINT,
    "provider": "ollama",
    "model_id": "qwen3.8:27b",
    "budget_exhausted": False,
}
REFINED_PLAN = {
    "plannerVersion": 2,
    "outgoingTrackEntityUid": "11111111-1111-4111-8111-111111111111",
    "incomingTrackEntityUid": "22222222-2222-4222-8222-222222222222",
    "mode": "beatmatch",
    "durationMs": 15360,
    "outgoingCueMs": 184800,
    "incomingCueMs": 480,
    "incomingTempoRatio": 1.0,
    "beatPhaseOffsetMs": 0,
    "handoffProgress": 0.5,
    "outgoingGainDb": 0.0,
    "incomingGainDb": 0.0,
    "curve": "dj-blend",
    "bassHandoff": "balanced",
    "confidence": 0.9,
    "fallbackReason": None,
}


def _edge(outgoing: str, incoming: str, *, refine: bool = True, **context) -> dict:
    return {
        "outgoingTrackEntityUid": outgoing,
        "incomingTrackEntityUid": incoming,
        "context": {
            "source": "playlist",
            "automatic": True,
            "offline": False,
            "preferredDurationMs": 12_000,
            "userCueProfile": "auto",
            "allowBeatmatch": True,
            "allowTempoAdjustment": True,
            **({"aiRefinement": True} if refine else {}),
            **context,
        },
    }


def _uids(count: int) -> list[str]:
    return [str(uuid.uuid4()) for _ in range(count)]


@pytest.fixture
def env(test_app, monkeypatch):
    state = SimpleNamespace(
        plans={},
        refined={},
        table={},
        table_reads=[],
        tasks=[],
        reads=[],
        accepted=0,
        quota={},
        limit=64,
        gate=dict(GATE),
        gate_reads=0,
        missing=set(),
    )

    def profiles(entity_uids, **kwargs):
        layout = OUTGOING_LAYOUT if kwargs.get("include_structure") else None
        return [
            None
            if uid in state.missing
            else profile(uid, layout=layout or INCOMING_LAYOUT)
            for uid in entity_uids
        ]

    def combined(plan_keys, refinement_keys):
        return (
            {key: state.plans[key] for key in plan_keys if key in state.plans},
            {
                key: state.refined[key]
                for key in refinement_keys
                if key in state.refined
            },
        )

    def gate():
        state.gate_reads += 1
        return dict(state.gate)

    def get_many(keys):
        state.table_reads.append(list(keys))
        return {key: state.table[key] for key in keys if key in state.table}

    def create_task_dedup(task_type, params, *, dedup_key, priority, actor_user_id):
        if any(task["dedup_key"] == dedup_key for task in state.tasks):
            return None
        state.tasks.append(
            {
                "type": task_type,
                "params": params,
                "dedup_key": dedup_key,
                "priority": priority,
                "actor": actor_user_id,
            }
        )
        return f"task-{len(state.tasks)}"

    def accept(action_id):
        state.accepted += 1
        assert action_id == smart_mix_ai.REFINE_ACTION
        return {"action_id": action_id, "fingerprint": FINGERPRINT}

    def quota(user_id, count, *, limit, window_seconds):
        assert (limit, window_seconds) == (64, 60)
        used = state.quota.get(user_id, 0)
        state.quota[user_id] = used + count
        return max(0, min(count, state.limit - used))

    monkeypatch.setattr(smart_mix, "get_track_mix_profiles_by_entity_uids", profiles)
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_caches",
        lambda keys: {key: state.plans[key] for key in keys if key in state.plans},
    )
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", state.plans.update)
    monkeypatch.setattr(smart_mix, "get_smart_mix_plan_and_refinement_caches", combined)
    monkeypatch.setattr(smart_mix_ai, "refinement_gate", gate)
    monkeypatch.setattr(smart_mix_ai, "get_refinements", get_many)
    monkeypatch.setattr(smart_mix_ai, "create_task_dedup", create_task_dedup)
    monkeypatch.setattr(smart_mix_ai, "accept_action", accept)
    monkeypatch.setattr(
        smart_mix_ai,
        "set_smart_mix_refined_plan_caches",
        lambda entries, **kwargs: state.refined.update(entries),
    )
    monkeypatch.setattr(
        smart_mix_ai, "record_smart_mix_refinement_reads", state.reads.append
    )
    monkeypatch.setattr(smart_mix_ai, "consume_smart_mix_refinement_quota", quota)
    state.client = test_app
    return state


def _post(env, edges, planner="smart-mix-v3"):
    response = env.client.post(PATH, json={"plannerVersion": planner, "edges": edges})
    assert response.status_code == 200, response.text
    return response.json()["plans"]


def test_without_flag_no_refinement_field(env):
    outgoing, incoming = _uids(2)
    [plain] = _post(env, [_edge(outgoing, incoming, refine=False)])

    assert "refinement" not in plain
    assert env.gate_reads == 0 and env.tasks == []
    # The flag does not split the deterministic plan cache.
    flagged = _post(env, [_edge(outgoing, incoming)])[0]
    assert len(env.plans) == 1
    assert {k: v for k, v in flagged.items() if k != "refinement"} == plain


def test_pending_enqueues_once_dedup(env):
    uids = _uids(4)
    history = [{"mode": "beatmatch", "durationBars": 16, "deltaEnergy": -0.1}]
    edges = [
        _edge(uids[0], uids[1], setHistory=history),
        _edge(uids[1], uids[2]),
        _edge(uids[2], uids[3]),
    ]

    plans = _post(env, edges)

    assert [plan["refinement"] for plan in plans] == [{"status": "pending"}] * 3
    assert env.accepted == 1
    assert [task["priority"] for task in env.tasks] == [0, 0, 1]
    first = env.tasks[0]
    assert first["type"] == "smart_mix_refine_transition"
    assert first["actor"] == 1
    params = first["params"]
    key = params["refinement_key"]
    assert first["dedup_key"] == f"smart-mix-refine:{key}"
    assert params["ai_acceptance"] == {
        "action_id": smart_mix_ai.REFINE_ACTION,
        "fingerprint": FINGERPRINT,
    }
    assert params["outgoing_track_entity_uid"] == uids[0]
    assert params["outgoing_profile_revision"] == f"profile-{uids[0]}"
    assert params["context"]["setHistory"] == history
    assert "aiRefinement" not in params["context"]
    assert params["send_genre"] is True and params["actor_user_id"] == 1
    assert key == smart_mix_ai.edge_refinement_key(
        outgoing_track_entity_uid=uids[0],
        incoming_track_entity_uid=uids[1],
        outgoing_profile_revision=f"profile-{uids[0]}",
        incoming_profile_revision=f"profile-{uids[1]}",
        context=params["context"],
        config_fingerprint=FINGERPRINT,
        send_genre=True,
    )
    assert env.refined[key] == {"status": "pending"}

    # Polling the same edges reads the pending markers: no table read, no task.
    env.table_reads.clear()
    again = _post(env, edges)
    assert [plan["refinement"] for plan in again] == [{"status": "pending"}] * 3
    assert len(env.tasks) == 3 and env.table_reads == []


def test_ready_served_from_cache(env):
    outgoing, incoming = _uids(2)
    _post(env, [_edge(outgoing, incoming)])
    [task] = env.tasks
    key = task["params"]["refinement_key"]
    env.refined[key] = {
        "status": "ready",
        "plan": {
            **REFINED_PLAN,
            "outgoingTrackEntityUid": outgoing,
            "incomingTrackEntityUid": incoming,
        },
        "candidateIndex": 2,
        "reason": "Long blend from the outro into the intro.",
        "confidence": 0.82,
        "modelLabel": "qwen3.8:27b",
        "promptVersion": "sm3-refine-3",
    }
    env.table_reads.clear()

    [plan] = _post(env, [_edge(outgoing, incoming)])

    refinement = plan["refinement"]
    assert refinement["status"] == "ready"
    assert refinement["source"] == "ai"
    assert refinement["plan"]["durationMs"] == 15360
    assert refinement["plan"]["bassHandoff"] == "balanced"
    assert refinement["candidateIndex"] == 2
    assert refinement["modelLabel"] == "qwen3.8:27b"
    assert refinement["promptVersion"] == "sm3-refine-3"
    assert refinement["confidence"] == 0.82
    assert refinement["reason"].startswith("Long blend")
    assert "reasonCode" not in refinement
    assert env.table_reads == [] and len(env.tasks) == 1
    assert env.reads == [[key]]

    # A refinement the validation rejected leaves the client on the plan.
    env.refined[key] = {"status": "rejected", "code": "low_confidence"}
    [rejected] = _post(env, [_edge(outgoing, incoming)])
    assert rejected["refinement"] == {"status": "unavailable", "reasonCode": "rejected"}


def test_table_serves_refinements_redis_lost(env):
    outgoing, incoming = _uids(2)
    _post(env, [_edge(outgoing, incoming)])
    key = env.tasks[0]["params"]["refinement_key"]
    env.refined.clear()
    env.table_reads.clear()
    env.table[key] = {
        "status": "failed",
        "outcome_code": "AI_PROVIDER_TIMEOUT",
        "plan": None,
        "candidate_index": None,
        "reason": None,
        "confidence": None,
        "model_label": "qwen3.8:27b",
        "prompt_version": "sm3-refine-3",
    }

    [plan] = _post(env, [_edge(outgoing, incoming)])

    assert plan["refinement"] == {"status": "unavailable", "reasonCode": "failed"}
    assert env.table_reads == [[key]]
    assert env.refined[key] == {"status": "failed", "code": "AI_PROVIDER_TIMEOUT"}
    assert len(env.tasks) == 1


def test_unavailable_when_disabled(env):
    uids = _uids(3)
    env.gate.update(enabled=False, available=False, fingerprint=None)

    plans = _post(env, [_edge(uids[0], uids[1]), _edge(uids[1], uids[2])])

    assert [plan["refinement"] for plan in plans] == [
        {"status": "unavailable", "reasonCode": "disabled"}
    ] * 2
    env.gate.update(enabled=True)
    [plan] = _post(env, [_edge(uids[0], uids[1])])
    assert plan["refinement"] == {"status": "unavailable", "reasonCode": "no_model"}
    assert env.tasks == [] and env.table_reads == [] and env.accepted == 0

    # Edges the planner cannot choose for are not sent either.
    env.gate = dict(GATE)
    env.missing = {uids[2]}
    missing, manual, album = _post(
        env,
        [
            _edge(uids[1], uids[2]),
            _edge(uids[0], uids[1], automatic=False),
            _edge(uids[1], uids[0], source="album"),
        ],
    )
    assert missing["refinement"]["reasonCode"] == "missing_profile"
    assert manual["refinement"]["reasonCode"] == "single_candidate"
    assert album["refinement"]["reasonCode"] == "single_candidate"
    assert env.tasks == []


def test_unavailable_when_budget_exhausted(env):
    outgoing, incoming = _uids(2)
    env.gate.update(budget_exhausted=True)

    [plan] = _post(env, [_edge(outgoing, incoming)])

    assert plan["refinement"] == {"status": "unavailable", "reasonCode": "budget"}
    assert env.tasks == [] and env.accepted == 0


def test_access_token_needs_ai_scope(env, monkeypatch):
    outgoing, incoming = _uids(2)
    monkeypatch.setattr("crate.api.auth.vdj_enabled", lambda: True)

    def token(scopes):
        async def resolve(self, request):
            return {
                "id": 9,
                "role": "user",
                "auth_type": "access_token",
                "token_type": "access_token",
                "scopes": scopes,
            }

        monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve)

    token(["vdj.smart_mix.read"])
    [plan] = _post(env, [_edge(outgoing, incoming)])
    assert plan["refinement"] == {
        "status": "unavailable",
        "reasonCode": "scope_missing",
    }
    assert env.tasks == []

    token(["vdj.smart_mix.read", "vdj.smart_mix.ai"])
    [plan] = _post(env, [_edge(outgoing, incoming)])
    assert plan["refinement"] == {"status": "pending"}
    assert env.tasks[0]["actor"] == 9

    # A session without the permission (a role without library.view).
    async def ops(self, request):
        return {"id": 3, "role": "ops", "email": "ops@test.com"}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", ops)
    response = env.client.post(
        PATH,
        json={"plannerVersion": "smart-mix-v3", "edges": [_edge(incoming, outgoing)]},
    )
    assert response.status_code == 200
    assert response.json()["plans"][0]["refinement"] == {
        "status": "unavailable",
        "reasonCode": "permission_denied",
    }


def test_rate_limit_per_user(env):
    uids = _uids(6)
    env.limit = 3
    edges = [_edge(uids[i], uids[i + 1]) for i in range(5)]

    plans = _post(env, edges)

    statuses = [plan["refinement"] for plan in plans]
    assert statuses[:3] == [{"status": "pending"}] * 3
    assert statuses[3:] == [{"status": "unavailable", "reasonCode": "rate_limited"}] * 2
    assert len(env.tasks) == 3
    assert smart_mix_ai.REFINEMENT_ENQUEUE_LIMIT == 64


def test_v2_ignores_ai_flag(env):
    outgoing, incoming = _uids(2)

    [plan] = _post(env, [_edge(outgoing, incoming)], planner="smart-mix-v2")

    assert "refinement" not in plan and "structureUsed" not in plan
    assert env.gate_reads == 0 and env.tasks == []


def test_hot_path_query_count(pg_db, test_app, monkeypatch):
    """Cached: no PostgreSQL beyond the plan's own profile read; a Redis miss: one."""
    from crate.db.repositories.smart_mix import upsert_track_mix_profile
    from crate.db.repositories.smart_mix_refinements import save
    from tests.sql_statements import recorded_statements
    from tests.test_smart_mix_repository import _create_track

    del pg_db
    tracks = [_create_track(name) for name in ("hot-out", "hot-in")]
    for (track_id, uid), layout in zip(tracks, (OUTGOING_LAYOUT, INCOMING_LAYOUT)):
        upsert_track_mix_profile(track_id, profile(uid, layout=layout))
    outgoing, incoming = (uid for _id, uid in tracks)
    plans, refined = {}, {}
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_caches",
        lambda keys: {key: plans[key] for key in keys if key in plans},
    )
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", plans.update)
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_and_refinement_caches",
        lambda plan_keys, keys: (
            {key: plans[key] for key in plan_keys if key in plans},
            {key: refined[key] for key in keys if key in refined},
        ),
    )
    monkeypatch.setattr(smart_mix_ai, "refinement_gate", lambda: dict(GATE))
    monkeypatch.setattr(
        smart_mix_ai,
        "set_smart_mix_refined_plan_caches",
        lambda entries, **kwargs: refined.update(entries),
    )
    monkeypatch.setattr(
        smart_mix_ai, "record_smart_mix_refinement_reads", lambda k: None
    )
    monkeypatch.setattr(
        smart_mix_ai,
        "create_task_dedup",
        lambda *a, **k: pytest.fail("a stored refinement must not be queued"),
    )
    plain = _edge(outgoing, incoming, refine=False)
    flagged = _edge(outgoing, incoming)
    key = smart_mix_ai.edge_refinement_key(
        outgoing_track_entity_uid=outgoing,
        incoming_track_entity_uid=incoming,
        outgoing_profile_revision=f"profile-{outgoing}",
        incoming_profile_revision=f"profile-{incoming}",
        context=smart_mix._refinement_context(
            smart_mix.TransitionEdgeRequest.model_validate(flagged).context
        ),
        config_fingerprint=FINGERPRINT,
        send_genre=True,
    )
    save(
        {
            "refinement_key": key,
            "from_entity_uid": outgoing,
            "to_entity_uid": incoming,
            "from_profile_revision": f"profile-{outgoing}",
            "to_profile_revision": f"profile-{incoming}",
            "planner_identifier": "smart-mix-v3",
            "rules_revision": 1,
            "prompt_version": "sm3-refine-3",
            "config_fingerprint": FINGERPRINT,
            "model_label": "qwen3.8:27b",
            "status": "ready",
            "outcome_code": None,
            "candidate_index": 1,
            "adjustments": {},
            "plan": {
                **REFINED_PLAN,
                "outgoingTrackEntityUid": outgoing,
                "incomingTrackEntityUid": incoming,
            },
            "deterministic_plan_hash": "d" * 64,
            "reason": "Blend.",
            "confidence": 0.8,
            "latency_ms": 900,
        }
    )

    def post(edge) -> tuple[dict, list[str]]:
        with recorded_statements() as statements:
            response = test_app.post(
                PATH, json={"plannerVersion": "smart-mix-v3", "edges": [edge]}
            )
        assert response.status_code == 200, response.text
        return response.json()["plans"][0], statements

    post(plain)  # warm the plan cache
    _plan, baseline = post(plain)
    missed, from_table = post(flagged)
    hit, from_cache = post(flagged)

    assert missed["refinement"]["status"] == hit["refinement"]["status"] == "ready"
    assert len(baseline) == 1  # the profile revisions behind the plan keys
    assert len(from_cache) == len(baseline)
    assert len(from_table) == len(baseline) + 1
    assert "smart_mix_refined_plans" in from_table[-1]
    assert "ANY(" in from_table[-1]
