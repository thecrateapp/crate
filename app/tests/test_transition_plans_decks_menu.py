"""The candidate menu and policy limits for Crate Decks (Smart Mix Stems ST3.PR2).

With smart-mix-v3, ``context.source = "decks"`` and ``context.localRefinement`` each
plan also carries ``candidates`` (the v3 menu with each score breakdown) and
``policyLimits`` (the planner policy resolved for the edge), so Decks can refine the
plan locally and validate the result (STEM-D10). Every other response keeps its shape:
the Android and VirtualDJ plans and their cache keys do not change.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace

import pytest

from crate.api import smart_mix
from crate.api.schemas.smart_mix import TransitionEdgeRequest
from crate.smart_mix.evaluation import (
    limit_violations,
    policy_limits,
    policy_violations,
)
from crate.smart_mix.models import TransitionMode, TransitionPlan
from crate.smart_mix.planner import plan_transition, plan_transition_v3
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3
from crate.smart_mix.versions import MEASUREMENT_VERSION
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    profile,
)

PATH = "/api/playback/transition-plans"
DECKS_CONTEXT = {
    "source": "decks",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 12_000,
    "userCueProfile": "auto",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
    "allowLongBeatmatch": True,
}
# What Android sends (player-engine-adapter) and what the VirtualDJ plugin sends.
ANDROID_CONTEXT = {
    "source": "playlist",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 6_000,
    "userCueProfile": "default",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
}
VDJ_CONTEXT = {
    "source": "manual",
    "automatic": False,
    "offline": False,
    "preferredDurationMs": 8_000,
    "userCueProfile": "auto",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
}


def _edge(ctx: dict, **changes) -> dict:
    return {
        "outgoingTrackEntityUid": OUTGOING_UID,
        "incomingTrackEntityUid": INCOMING_UID,
        "context": {**ctx, **changes},
    }


def _profiles():
    return {
        OUTGOING_UID: profile(OUTGOING_UID, layout=OUTGOING_LAYOUT),
        INCOMING_UID: profile(INCOMING_UID, layout=INCOMING_LAYOUT),
    }


@pytest.fixture
def plans(test_app, monkeypatch):
    tracks = _profiles()
    cache: dict[str, dict] = {}
    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        lambda uids, **_kwargs: [tracks.get(uid) for uid in uids],
    )
    monkeypatch.setattr(smart_mix, "get_stem_analyses_by_entity_uids", lambda _u: {})
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_caches",
        lambda keys: {key: cache[key] for key in keys if key in cache},
    )
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", cache.update)
    monkeypatch.setattr(
        "crate.api.smart_mix.android_bass_handoff_enabled", lambda: True
    )

    def post(edge: dict, planner: str = "smart-mix-v3") -> dict:
        response = test_app.post(
            PATH, json={"plannerVersion": planner, "edges": [edge]}
        )
        assert response.status_code == 200, response.text
        return response.json()["plans"][0]

    return post


# --- menu ---------------------------------------------------------------------------


def test_menu_only_for_the_decks_context(plans) -> None:
    flagged = plans(_edge(DECKS_CONTEXT, localRefinement=True))
    unflagged = plans(_edge(DECKS_CONTEXT))
    playlist = plans(_edge(DECKS_CONTEXT, source="playlist", localRefinement=True))
    v2 = plans(_edge(DECKS_CONTEXT, localRefinement=True), planner="smart-mix-v2")

    for plan in (unflagged, playlist, v2):
        assert "candidates" not in plan and "policyLimits" not in plan
    assert "policyLimits" in flagged
    menu = flagged["candidates"]
    assert 2 <= len(menu) <= PLANNER_POLICY_V3.max_candidates
    assert [candidate["index"] for candidate in menu] == list(range(len(menu)))
    served = {key: flagged[key] for key in menu[0]["plan"]}
    assert served == menu[0]["plan"]
    assert set(menu[0]["breakdown"]) >= {
        "alignment",
        "energy",
        "harmonic",
        "stability",
        "bass",
        "position",
    }
    # The menu is the planner's own, candidate by candidate.
    tracks = _profiles()
    expected = plan_transition_v3(
        tracks[OUTGOING_UID],
        tracks[INCOMING_UID],
        smart_mix._transition_context(
            TransitionEdgeRequest.model_validate(_edge(DECKS_CONTEXT)).context
        ),
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )
    assert [c["plan"] for c in menu] == [
        _without_nulls(c.to_plan().to_dict()) for c in expected.candidates
    ]


def _without_nulls(payload: dict) -> dict:
    """The response leaves out nulls (``response_model_exclude_none``)."""
    return {key: value for key, value in payload.items() if value is not None}


def test_the_menu_splits_the_plan_cache_only_for_decks() -> None:
    def key(edge: dict) -> str:
        return smart_mix._plan_cache_key(
            TransitionEdgeRequest.model_validate(edge), None, None, PLANNER_POLICY_V3
        )

    assert key(_edge(DECKS_CONTEXT, localRefinement=True)) != key(_edge(DECKS_CONTEXT))
    assert key(_edge(ANDROID_CONTEXT, localRefinement=True)) == key(
        _edge(ANDROID_CONTEXT)
    )


# --- limits ---------------------------------------------------------------------------


def test_limits_match_the_policy(plans) -> None:
    limits = plans(_edge(DECKS_CONTEXT, localRefinement=True))["policyLimits"]
    policy = PLANNER_POLICY_V3
    tracks = _profiles()
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]

    assert limits == {
        "rulesRevision": policy.rules_revision,
        "beatmatchAllowed": True,
        "tempoAdjustmentAllowed": True,
        "bassHandoffAllowed": True,
        "longBeatmatchAllowed": True,
        "longBeatmatchEligible": True,
        "maximumTempoAdjustment": policy.maximum_tempo_adjustment,
        "minimumTransitionMs": policy.minimum_transition_ms,
        "maximumTransitionMs": policy.maximum_transition_ms,
        "maximumLongBeatmatchMs": policy.maximum_long_beatmatch_ms,
        # Neither profile has an accredited loudness measurement: no boost.
        "maximumBoostDb": policy.maximum_unaccredited_gain_db,
        "maximumCutDb": policy.max_loudness_adjustment_db,
        # Unaccredited decks count as peaking at 0 dBFS.
        "outgoingPeakLimitedGainDb": pytest.approx(
            policy.combined_true_peak_ceiling_dbfs
            - policy.equal_power_midpoint_headroom_db
        ),
        "incomingPeakLimitedGainDb": pytest.approx(
            policy.combined_true_peak_ceiling_dbfs
            - policy.equal_power_midpoint_headroom_db
        ),
        "outgoingEarliestCueMs": min(
            int(outgoing.active_end_ms * policy.minimum_outgoing_body_ratio),
            policy.minimum_outgoing_body_ms,
        ),
        "outgoingLatestEndMs": outgoing.active_end_ms + 1,
        "incomingLatestEndMs": incoming.active_end_ms
        - policy.minimum_incoming_body_ms
        + 1,
        "phraseLengths": list(policy.phrase_lengths),
    }


def _accredited(track):
    return replace(track, measurement_version=MEASUREMENT_VERSION, true_peak_dbfs=-3.0)


@pytest.mark.parametrize(
    "variant",
    ["plain", "accredited", "hot_master", "listen", "no_long_blend", "unstable"],
)
def test_a_plan_keeps_the_limits_exactly_when_it_passes_the_policy(variant) -> None:
    tracks = _profiles()
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    ctx = context()
    if variant == "accredited":
        outgoing, incoming = _accredited(outgoing), _accredited(incoming)
    elif variant == "hot_master":
        outgoing = replace(
            _accredited(outgoing), true_peak_dbfs=3.5, integrated_lufs=-6.0
        )
        incoming = _accredited(incoming)
    elif variant == "listen":
        ctx = context(
            preferred_duration_ms=6_000,
            allow_bass_handoff=False,
            allow_long_beatmatch=False,
        )
    elif variant == "no_long_blend":
        ctx = context(allow_long_beatmatch=False, allow_tempo_adjustment=False)
    elif variant == "unstable":
        outgoing = replace(outgoing, tempo_stability=0.85)
    limits = policy_limits(outgoing, incoming, ctx, PLANNER_POLICY_V3)
    menu = plan_transition_v3(
        outgoing,
        incoming,
        ctx,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    ).candidates
    checked = 0
    for candidate in menu:
        for plan in _perturbed(candidate.to_plan()):
            expected = tuple(
                code
                for code in policy_violations(
                    plan, outgoing, incoming, context=ctx, policy=PLANNER_POLICY_V3
                )
                if code != "track_mismatch"
            )
            assert limit_violations(plan, limits) == expected, plan
            checked += 1
    assert checked > 100


def _perturbed(plan: TransitionPlan) -> list[TransitionPlan]:
    """The plan and plans around every limit: tempo, gains, durations, windows."""
    beatmatch = plan.mode == TransitionMode.BEATMATCH
    variants = [plan]
    for ratio in (0.955, 0.96, 0.9599, 0.999, 1.0005, 1.002, 1.04, 1.0401, 1.05):
        if beatmatch or ratio == 1.0:
            variants.append(replace(plan, incoming_tempo_ratio=ratio))
    variants.append(replace(plan, incoming_tempo_ratio=1.01))
    for gain in (-12.0, -6.0, -6.001, -4.0103, -4.0, -0.5, 0.0, 0.5, 6.0, 6.5):
        variants.append(replace(plan, outgoing_gain_db=gain))
        variants.append(replace(plan, incoming_gain_db=gain))
    for duration in (900, 1_000, 11_999, 12_001, 30_720, 48_000, 48_001, 61_440):
        variants.append(replace(plan, duration_ms=duration))
        variants.append(replace(plan, duration_ms=duration, curve="dj-blend"))
    for shift in (-120_000, -60_000, -1, 1, 2, 30_000, 120_000):
        variants.append(
            replace(plan, outgoing_cue_ms=max(0, plan.outgoing_cue_ms + shift))
        )
        variants.append(
            replace(plan, incoming_cue_ms=max(0, plan.incoming_cue_ms + shift))
        )
    variants.append(replace(plan, bass_handoff="balanced"))
    variants.append(replace(plan, bass_handoff="none"))
    variants.append(replace(plan, mode=TransitionMode.BEATMATCH))
    return variants


def test_no_limits_without_both_profiles(plans, monkeypatch) -> None:
    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        lambda uids, **_kwargs: [
            profile(uid, layout=OUTGOING_LAYOUT) if uid == OUTGOING_UID else None
            for uid in uids
        ],
    )

    plan = plans(_edge(DECKS_CONTEXT, localRefinement=True))

    assert plan["fallbackReason"] == "missing_profile"
    assert "policyLimits" not in plan
    assert len(plan["candidates"]) == 1


# --- other clients ----------------------------------------------------------------------


def _old_cache_key(edge: dict, policy) -> str:
    """The plan cache key before ST3, for profiles that are missing."""
    identity = {
        "plannerVersion": policy.identifier,
        "plannerRules": policy.rules_revision,
        "outgoingTrackEntityUid": edge["outgoingTrackEntityUid"],
        "outgoingProfileRevision": "missing",
        "incomingTrackEntityUid": edge["incomingTrackEntityUid"],
        "incomingProfileRevision": "missing",
        "context": edge["context"],
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("ctx", [ANDROID_CONTEXT, VDJ_CONTEXT], ids=["android", "vdj"])
def test_android_and_vdj_responses_unchanged(plans, ctx) -> None:
    tracks = _profiles()
    edge = _edge(ctx)
    request = TransitionEdgeRequest.model_validate(edge)

    served = plans(edge, planner="smart-mix-v2")
    ignored_flag = plans(_edge(ctx, localRefinement=True), planner="smart-mix-v2")

    expected = plan_transition(
        tracks[OUTGOING_UID],
        tracks[INCOMING_UID],
        smart_mix._transition_context(request.context),
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        policy=PLANNER_POLICY,
    ).to_dict()
    assert served == _without_nulls(expected)
    assert ignored_flag == served
    assert smart_mix._plan_cache_key(request, None, None) == _old_cache_key(
        edge, PLANNER_POLICY
    )


def test_vdj_access_tokens_get_the_same_plans(plans, monkeypatch) -> None:
    session = plans(_edge(VDJ_CONTEXT), planner="smart-mix-v2")
    monkeypatch.setattr("crate.api.auth.vdj_enabled", lambda: True)

    async def resolve(self, request):
        return {
            "id": 9,
            "role": "user",
            "auth_type": "access_token",
            "token_type": "access_token",
            "scopes": ["vdj.smart_mix.read"],
        }

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve)

    assert plans(_edge(VDJ_CONTEXT), planner="smart-mix-v2") == session
    assert plans(_edge(VDJ_CONTEXT, localRefinement=True), planner="smart-mix-v2") == (
        session
    )
