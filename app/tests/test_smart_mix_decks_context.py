"""The ``decks`` context of the Smart Mix planner (Crate Decks S5, F6.S-PR1).

``context.source = "decks"`` plans like ``playlist`` with two differences: its bass
handoff follows Crate Decks' own switch (the one ``capabilities.decks.features``
advertises as ``bass_handoff``), never the Android flag, and ``context.assist``
(Decks' assist mode) raises the long-beatmatch ceiling to
``policy.assist_maximum_long_beatmatch_ms``. Tempo limits, the plan format and every
other client's plans and cache keys do not change.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace

import pytest

from crate.api import capabilities, smart_mix
from crate.api.schemas.smart_mix import (
    TransitionEdgeRequest,
    TransitionPlanResponse,
)
from crate.config import decks_bass_handoff_enabled, decks_beatmatch_enabled
from crate.smart_mix.evaluation import policy_limits, policy_violations
from crate.smart_mix.models import (
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
)
from crate.smart_mix.planner import plan_transition, plan_transition_v3
from crate.smart_mix.policy import (
    PLANNER_POLICY,
    PLANNER_POLICY_V3,
    long_beatmatch_ceiling_ms,
)
from crate.smart_mix.refinement import context_from_payload
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    profile,
)

PATH = "/api/playback/transition-plans"
DECKS_SWITCHES = (
    "CRATE_SMART_MIX_ENABLED",
    "CRATE_DECKS_BEATMATCH_ENABLED",
    "CRATE_DECKS_BASS_HANDOFF_ENABLED",
)
ANDROID_BASS_SWITCH = "CRATE_ANDROID_BASS_HANDOFF_ENABLED"
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
# What Android's player engine adapter sends, per queue source.
ANDROID_CONTEXT = {
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 6_000,
    "userCueProfile": "default",
    "allowBeatmatch": True,
    "allowTempoAdjustment": True,
    "allowBassHandoff": True,
}
# 32 bars of 4/4 at the cases' 125 BPM: past the AutoDJ ceiling, within assist's.
THIRTY_TWO_BARS_MS = 61_440
SIXTEEN_BARS_MS = 30_720


def _edge(ctx: dict, **changes) -> dict:
    return {
        "outgoingTrackEntityUid": OUTGOING_UID,
        "incomingTrackEntityUid": INCOMING_UID,
        "context": {**ctx, **changes},
    }


def _profiles(**incoming_overrides):
    return {
        OUTGOING_UID: profile(OUTGOING_UID, layout=OUTGOING_LAYOUT),
        INCOMING_UID: profile(
            INCOMING_UID, layout=INCOMING_LAYOUT, **incoming_overrides
        ),
    }


def _switches(monkeypatch, *, decks: bool, decks_bass: bool, android_bass: bool):
    for name, on in (
        ("CRATE_SMART_MIX_ENABLED", True),
        ("CRATE_DECKS_BEATMATCH_ENABLED", decks),
        ("CRATE_DECKS_BASS_HANDOFF_ENABLED", decks_bass),
        (ANDROID_BASS_SWITCH, android_bass),
    ):
        # Explicit: the Decks switches default to on.
        monkeypatch.setenv(name, "true" if on else "false")


@pytest.fixture
def tracks():
    return _profiles()


@pytest.fixture
def post(test_app, monkeypatch, tracks):
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

    def send(edge: dict, planner: str = "smart-mix-v2"):
        response = test_app.post(
            PATH, json={"plannerVersion": planner, "edges": [edge]}
        )
        assert response.status_code == 200, response.text
        return response

    return send


def _plan(response) -> dict:
    return response.json()["plans"][0]


def _without_nulls(payload: dict) -> dict:
    """The response leaves out nulls (``response_model_exclude_none``)."""
    return {key: value for key, value in payload.items() if value is not None}


def _old_cache_key(
    edge: dict, policy, *, bass_allowed: bool, limits: bool = False
) -> str:
    """The plan cache key before S5, for profiles that are missing.

    The key keeps ``allowBassHandoff`` only when the server allows it. ``limits``
    adds the marker of decks plans, which carry ``policyLimits`` since S5.
    """
    ctx = dict(edge["context"])
    if not bass_allowed:
        ctx.pop("allowBassHandoff", None)
    identity = {
        "plannerVersion": policy.identifier,
        "plannerRules": policy.rules_revision,
        "outgoingTrackEntityUid": edge["outgoingTrackEntityUid"],
        "outgoingProfileRevision": "missing",
        "incomingTrackEntityUid": edge["incomingTrackEntityUid"],
        "incomingProfileRevision": "missing",
        "context": ctx,
    }
    if limits:
        identity["policyLimits"] = True
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _decks_context(**changes) -> TransitionContext:
    return replace(context(source="decks"), **changes)


# --- bass handoff ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("decks_bass", "android_bass"),
    [(True, False), (False, True), (True, True), (False, False)],
)
@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
def test_decks_context_enables_bass_handoff_independent_of_android_flag(
    test_app, post, monkeypatch, decks_bass, android_bass, planner
) -> None:
    _switches(monkeypatch, decks=True, decks_bass=decks_bass, android_bass=android_bass)

    plan = _plan(post(_edge(DECKS_CONTEXT), planner))
    features = test_app.get("/api/capabilities").json()["decks"]["features"]

    assert plan["mode"] == "beatmatch"
    assert plan["bassHandoff"] == ("balanced" if decks_bass else "none")
    # The planner and the capability Decks reads never disagree.
    assert ("bass_handoff" in features) is decks_bass


def test_decks_bass_handoff_needs_decks_beatmatch_and_the_request(
    post, monkeypatch
) -> None:
    _switches(monkeypatch, decks=False, decks_bass=True, android_bass=True)
    assert _plan(post(_edge(DECKS_CONTEXT)))["bassHandoff"] == "none"

    _switches(monkeypatch, decks=True, decks_bass=True, android_bass=False)
    assert _plan(post(_edge(DECKS_CONTEXT)))["bassHandoff"] == "balanced"
    unasked = _edge(DECKS_CONTEXT, allowBassHandoff=False)
    assert _plan(post(unasked))["bassHandoff"] == "none"


# --- Android --------------------------------------------------------------------------


@pytest.mark.parametrize("android_bass", [True, False], ids=["bass", "no_bass"])
@pytest.mark.parametrize(
    "source", ["playlist", "radio", "shuffle", "infinite", "album", "manual"]
)
def test_android_behaviour_unchanged(post, monkeypatch, source, android_bass) -> None:
    tracks = _profiles()
    edge = _edge({**ANDROID_CONTEXT, "source": source})
    expected = plan_transition(
        tracks[OUTGOING_UID],
        tracks[INCOMING_UID],
        TransitionContext(
            source=source,
            automatic=True,
            offline=False,
            preferred_duration_ms=6_000,
            user_cue_profile="default",
            allow_beatmatch=True,
            allow_tempo_adjustment=True,
            allow_bass_handoff=android_bass,
        ),
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        policy=PLANNER_POLICY,
    ).to_dict()

    responses = []
    for decks in (False, True):
        _switches(monkeypatch, decks=decks, decks_bass=decks, android_bass=android_bass)
        responses.append(post(edge).content)
        # Android never sends assist; if a client did, the server ignores it.
        responses.append(post(_edge(edge["context"], assist=True)).content)

    assert len(set(responses)) == 1
    assert json.loads(responses[0])["plans"][0] == _without_nulls(expected)
    request = TransitionEdgeRequest.model_validate(edge)
    with_assist = TransitionEdgeRequest.model_validate(
        _edge(edge["context"], assist=True)
    )
    for policy in (PLANNER_POLICY, PLANNER_POLICY_V3):
        old = _old_cache_key(edge, policy, bass_allowed=android_bass)
        assert smart_mix._plan_cache_key(request, None, None, policy) == old
        assert smart_mix._plan_cache_key(with_assist, None, None, policy) == old
    assert "assist" not in smart_mix._cache_context(with_assist.context)


@pytest.mark.parametrize("decks_bass", [True, False], ids=["bass", "no_bass"])
def test_decks_cache_key_splits_only_on_assist(monkeypatch, decks_bass) -> None:
    _switches(monkeypatch, decks=True, decks_bass=decks_bass, android_bass=False)
    edge = _edge(DECKS_CONTEXT)
    request = TransitionEdgeRequest.model_validate(edge)
    explicit_off = TransitionEdgeRequest.model_validate(
        _edge(DECKS_CONTEXT, assist=False)
    )
    assisted = TransitionEdgeRequest.model_validate(_edge(DECKS_CONTEXT, assist=True))

    for policy in (PLANNER_POLICY, PLANNER_POLICY_V3):
        # Decks plans cached before they carried policyLimits are never served.
        expected = _old_cache_key(edge, policy, bass_allowed=decks_bass, limits=True)
        assert expected != _old_cache_key(edge, policy, bass_allowed=decks_bass)
        assert smart_mix._plan_cache_key(request, None, None, policy) == expected
        assert smart_mix._plan_cache_key(explicit_off, None, None, policy) == expected
        assert smart_mix._plan_cache_key(assisted, None, None, policy) != expected
    # The refinement worker rebuilds the planner context from the cache context.
    assert context_from_payload(smart_mix._cache_context(assisted.context)).assist
    assert not context_from_payload(smart_mix._cache_context(request.context)).assist


# --- tempo ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("incoming_bpm", "beatmatch"),
    [(125.0, True), (128.0, True), (131.0, False)],
    ids=["same", "within_4_percent", "past_4_percent"],
)
def test_tempo_limits_unchanged_for_decks(incoming_bpm, beatmatch) -> None:
    tracks = _profiles(bpm=incoming_bpm)
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    playlist = context()
    contexts = (
        playlist,
        _decks_context(),
        _decks_context(assist=True),
    )

    v2 = [
        plan_transition(outgoing, incoming, ctx, policy=PLANNER_POLICY)
        for ctx in contexts
    ]
    v3 = [
        plan_transition_v3(outgoing, incoming, ctx, policy=PLANNER_POLICY_V3)
        for ctx in contexts
    ]

    for plans in (v2, [planned.plan for planned in v3]):
        modes = {plan.mode for plan in plans}
        ratios = {plan.incoming_tempo_ratio for plan in plans}
        assert len(ratios) == 1
        if beatmatch:
            assert modes == {TransitionMode.BEATMATCH}
        else:
            assert modes == {TransitionMode.ADAPTIVE}
            assert ratios == {1.0}
            assert {plan.fallback_reason for plan in plans} == {
                TransitionFallbackReason.INCOMPATIBLE_TEMPO
            }
    for planned in v3:
        for candidate in planned.candidates:
            ratio = candidate.to_plan().incoming_tempo_ratio
            assert abs(ratio - 1.0) <= PLANNER_POLICY_V3.maximum_tempo_adjustment
    for policy in (PLANNER_POLICY, PLANNER_POLICY_V3):
        base = policy_limits(outgoing, incoming, _decks_context(), policy).to_dict()
        assisted = policy_limits(
            outgoing, incoming, _decks_context(assist=True), policy
        ).to_dict()
        assert assisted["maximumTempoAdjustment"] == policy.maximum_tempo_adjustment
        # The assist mode moves the long-blend ceiling and nothing else.
        assert {key for key in base if base[key] != assisted[key]} == {
            "maximumLongBeatmatchMs"
        }


# --- assist ---------------------------------------------------------------------------


def test_assist_context_allows_longer_duration(tracks) -> None:
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    autodj = _decks_context()
    assist = _decks_context(assist=True)

    v2_autodj = plan_transition(outgoing, incoming, autodj, policy=PLANNER_POLICY)
    v2_assist = plan_transition(outgoing, incoming, assist, policy=PLANNER_POLICY)

    # AutoDJ keeps Android's 48 s ceiling: 32 bars at 125 BPM do not fit, 16 do.
    assert v2_autodj.duration_ms == SIXTEEN_BARS_MS
    assert v2_assist.duration_ms == THIRTY_TWO_BARS_MS
    assert v2_assist.duration_ms > PLANNER_POLICY.maximum_long_beatmatch_ms
    assert v2_assist.mode == TransitionMode.BEATMATCH
    assert v2_assist.curve == "dj-blend"
    assert (
        policy_violations(
            v2_assist, outgoing, incoming, context=assist, policy=PLANNER_POLICY
        )
        == ()
    )
    # The same plan breaks the AutoDJ ceiling.
    assert "duration_out_of_range" in policy_violations(
        v2_assist, outgoing, incoming, context=autodj, policy=PLANNER_POLICY
    )

    def longest(ctx: TransitionContext) -> int:
        planned = plan_transition_v3(outgoing, incoming, ctx, policy=PLANNER_POLICY_V3)
        return max(c.to_plan().duration_ms for c in planned.candidates)

    assert longest(autodj) <= PLANNER_POLICY_V3.maximum_long_beatmatch_ms
    assert longest(assist) == THIRTY_TWO_BARS_MS
    # Durations stay capped in bars: never past the longest phrase length.
    assert longest(assist) <= PLANNER_POLICY_V3.assist_maximum_long_beatmatch_ms


@pytest.mark.parametrize(
    "changes",
    [
        {"source": "playlist"},
        {"allow_long_beatmatch": False},
        {"allow_beatmatch": False},
    ],
    ids=["other_source", "no_long_blend", "no_beatmatch"],
)
def test_assist_changes_nothing_else(tracks, changes) -> None:
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    base = _decks_context(**changes)
    assisted = replace(base, assist=True)

    for planner, policy in (
        (plan_transition, PLANNER_POLICY),
        (lambda *args, **kw: plan_transition_v3(*args, **kw).plan, PLANNER_POLICY_V3),
    ):
        assert planner(outgoing, incoming, assisted, policy=policy) == planner(
            outgoing, incoming, base, policy=policy
        )


def test_assist_reaches_the_planner_through_the_api(post) -> None:
    autodj = _plan(post(_edge(DECKS_CONTEXT)))
    assist = _plan(post(_edge(DECKS_CONTEXT, assist=True)))
    v3_assist = _plan(
        post(_edge(DECKS_CONTEXT, assist=True, localRefinement=True), "smart-mix-v3")
    )

    assert autodj["durationMs"] == SIXTEEN_BARS_MS
    assert assist["durationMs"] == THIRTY_TWO_BARS_MS
    assert v3_assist["policyLimits"]["maximumLongBeatmatchMs"] == (
        PLANNER_POLICY_V3.assist_maximum_long_beatmatch_ms
    )
    assert max(c["plan"]["durationMs"] for c in v3_assist["candidates"]) == (
        THIRTY_TWO_BARS_MS
    )


# --- policy limits on every decks plan -------------------------------------------------


@pytest.mark.parametrize("assist", [False, True], ids=["autodj", "assist"])
@pytest.mark.parametrize("local_refinement", [False, True], ids=["plain", "local"])
@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
def test_every_decks_plan_carries_policy_limits(
    post, tracks, planner, local_refinement, assist
) -> None:
    edge = _edge(DECKS_CONTEXT, assist=assist, localRefinement=local_refinement)
    plan = _plan(post(edge, planner))
    policy = PLANNER_POLICY_V3 if planner == "smart-mix-v3" else PLANNER_POLICY
    request = TransitionEdgeRequest.model_validate(edge)

    limits = plan["policyLimits"]
    assert limits["maximumLongBeatmatchMs"] == (96_000 if assist else 48_000)
    # The same limits localRefinement served before, from the same ceiling.
    assert (
        limits
        == policy_limits(
            tracks[OUTGOING_UID],
            tracks[INCOMING_UID],
            smart_mix._transition_context(request.context),
            policy,
        ).to_dict()
    )
    assert ("candidates" in plan) is (planner == "smart-mix-v3" and local_refinement)


@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
def test_no_decks_limits_without_both_profiles(post, tracks, planner) -> None:
    del tracks[INCOMING_UID]

    plan = _plan(post(_edge(DECKS_CONTEXT, assist=True), planner))

    assert plan["fallbackReason"] == "missing_profile"
    assert "policyLimits" not in plan


@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
@pytest.mark.parametrize(
    "source", ["playlist", "radio", "shuffle", "infinite", "album", "manual"]
)
def test_other_sources_carry_no_policy_limits(post, source, planner) -> None:
    edge = _edge({**ANDROID_CONTEXT, "source": source})
    policy = PLANNER_POLICY_V3 if planner == "smart-mix-v3" else PLANNER_POLICY
    served = post(edge, planner).content
    flagged = _edge(edge["context"], assist=True, localRefinement=True)

    assert "policyLimits" not in json.loads(served)["plans"][0]
    # The flags only decks reads change neither the bytes nor the cache key.
    assert post(flagged, planner).content == served
    for request in (edge, flagged):
        assert smart_mix._plan_cache_key(
            TransitionEdgeRequest.model_validate(request), None, None, policy
        ) == _old_cache_key(edge, policy, bass_allowed=False)


# --- plan format ----------------------------------------------------------------------

_V2_PLAN_FIELDS = {
    "plannerVersion",
    "outgoingTrackEntityUid",
    "incomingTrackEntityUid",
    "mode",
    "durationMs",
    "outgoingCueMs",
    "incomingCueMs",
    "incomingTempoRatio",
    "beatPhaseOffsetMs",
    "handoffProgress",
    "outgoingGainDb",
    "incomingGainDb",
    "curve",
    "bassHandoff",
    "confidence",
}


def test_plan_schema_unchanged(test_app, post, monkeypatch) -> None:
    _switches(monkeypatch, decks=True, decks_bass=True, android_bass=True)
    android = _plan(post(_edge({**ANDROID_CONTEXT, "source": "playlist"})))
    decks = _plan(post(_edge(DECKS_CONTEXT)))
    assist = _plan(post(_edge(DECKS_CONTEXT, assist=True)))
    v3_android = _plan(
        post(_edge({**ANDROID_CONTEXT, "source": "playlist"}), "smart-mix-v3")
    )
    v3_assist = _plan(post(_edge(DECKS_CONTEXT, assist=True), "smart-mix-v3"))

    assert set(android) == _V2_PLAN_FIELDS
    # Decks plans add only the limits applied to them (2026-11-15).
    for plan in (decks, assist):
        assert set(plan) == _V2_PLAN_FIELDS | {"policyLimits"}
    for plan in (android, decks, assist, v3_android, v3_assist):
        TransitionPlanResponse.model_validate(plan)
    assert set(v3_assist) == set(v3_android) | {"policyLimits"}
    assert assist["plannerVersion"] == v3_assist["plannerVersion"] == 2

    schema = test_app.get("/openapi.json").json()["components"]["schemas"]
    plan_schema = schema["TransitionPlanResponse"]["properties"]
    assert "assist" not in plan_schema
    assert plan_schema["incomingTempoRatio"]["minimum"] == 0.94
    assert plan_schema["incomingTempoRatio"]["maximum"] == 1.06
    # durationMs had no upper bound, so the assist mode's long blends fit as they are.
    assert "maximum" not in plan_schema["durationMs"]
    request = schema["TransitionContextRequest"]["properties"]
    assert request["assist"]["type"] == "boolean"
    assert request["assist"]["default"] is False
    assert request["preferredDurationMs"]["maximum"] == 12_000


# --- policy, model and switches -------------------------------------------------------


def test_long_beatmatch_ceiling_follows_the_context() -> None:
    policy = PLANNER_POLICY
    base = policy.maximum_long_beatmatch_ms
    ceiling = policy.assist_maximum_long_beatmatch_ms

    assert base == 48_000
    assert ceiling > base
    assert long_beatmatch_ceiling_ms(policy, None) == base
    assert long_beatmatch_ceiling_ms(policy, _decks_context()) == base
    assert long_beatmatch_ceiling_ms(policy, _decks_context(assist=True)) == ceiling
    assert long_beatmatch_ceiling_ms(policy, replace(context(), assist=True)) == base
    # A ceiling set below AutoDJ's never shortens the assist mode's blends.
    lower = replace(policy, assist_maximum_long_beatmatch_ms=30_000)
    assert long_beatmatch_ceiling_ms(lower, _decks_context(assist=True)) == base
    # v3 shares v2's limits.
    assert PLANNER_POLICY_V3.assist_maximum_long_beatmatch_ms == ceiling


def test_transition_context_serializes_assist_only_when_on() -> None:
    assert "assist" not in _decks_context().to_dict()
    assert _decks_context(assist=True).to_dict()["assist"] is True
    assert context_from_payload(_decks_context(assist=True).to_dict()).assist
    assert not context_from_payload(_decks_context().to_dict()).assist


@pytest.mark.parametrize(
    ("value", "on"), [("true", True), ("1", True), ("false", False), (None, True)]
)
def test_decks_switches_read_their_own_environment(monkeypatch, value, on) -> None:
    for name in (
        *DECKS_SWITCHES,
        "CRATE_ANDROID_BEATMATCH_ENABLED",
        ANDROID_BASS_SWITCH,
    ):
        monkeypatch.setenv(name, "true")
    for name in ("CRATE_DECKS_BEATMATCH_ENABLED", "CRATE_DECKS_BASS_HANDOFF_ENABLED"):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    # Unset means on (Diego, 2026-11-15).
    assert decks_beatmatch_enabled() is on
    assert decks_bass_handoff_enabled() is on


@pytest.mark.parametrize(
    ("smart_mix_on", "beatmatch", "bass", "expected"),
    [
        (True, True, True, (True, True)),
        (True, True, False, (True, False)),
        (True, False, True, (False, False)),
        (False, True, True, (False, False)),
    ],
)
def test_decks_capability_chain(monkeypatch, smart_mix_on, beatmatch, bass, expected):
    for name, on in zip(DECKS_SWITCHES, (smart_mix_on, beatmatch, bass), strict=True):
        monkeypatch.setenv(name, "true" if on else "false")

    assert (
        capabilities.decks_beatmatch_available(),
        capabilities.decks_bass_handoff_available(),
    ) == expected
