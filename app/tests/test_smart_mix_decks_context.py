"""The ``decks`` context of the Smart Mix planner (Crate Decks S5, F6.S-PR1).

``context.source = "decks"`` plans like ``playlist``, but its bass handoff follows
Crate Decks' own switch (the one ``capabilities.decks.features`` advertises as
``bass_handoff``), never the Android flag. Every other client's plans and cache keys
do not change.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from crate.api import capabilities, smart_mix
from crate.api.schemas.smart_mix import TransitionEdgeRequest
from crate.config import decks_bass_handoff_enabled, decks_beatmatch_enabled
from crate.smart_mix.models import TransitionContext
from crate.smart_mix.planner import plan_transition
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
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
        if on:
            monkeypatch.setenv(name, "true")
        else:
            monkeypatch.delenv(name, raising=False)


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


def _old_cache_key(edge: dict, policy, *, bass_allowed: bool) -> str:
    """The plan cache key before S5, for profiles that are missing.

    The key keeps ``allowBassHandoff`` only when the server allows it.
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
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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

    assert len(set(responses)) == 1
    assert json.loads(responses[0])["plans"][0] == _without_nulls(expected)
    request = TransitionEdgeRequest.model_validate(edge)
    for policy in (PLANNER_POLICY, PLANNER_POLICY_V3):
        old = _old_cache_key(edge, policy, bass_allowed=android_bass)
        assert smart_mix._plan_cache_key(request, None, None, policy) == old


# --- switches -----------------------------------------------------------------------


@pytest.mark.parametrize("value", ["true", "1", None])
def test_decks_switches_read_their_own_environment(monkeypatch, value) -> None:
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

    on = value is not None
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
        if on:
            monkeypatch.setenv(name, "true")
        else:
            monkeypatch.delenv(name, raising=False)

    assert (
        capabilities.decks_beatmatch_available(),
        capabilities.decks_bass_handoff_available(),
    ) == expected
