"""Crate Decks plans read the signed-in user's corrections (F8.SM).

A plan Decks requests (``context.source = "decks"``) uses the user's BPM, beat grid
and key corrections (S7) on top of the shared profiles; Listen, Android continuation
and VirtualDJ keep the shared profiles. Corrected plans are cached under their own
keys, so no user is served another user's plan; uncorrected edges keep today's keys.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from crate.api import smart_mix
from crate.api.schemas.smart_mix import TransitionEdgeRequest
from crate.db.queries.decks_cues import DecksBatchRead
from crate.smart_mix.evaluation import policy_limits
from crate.smart_mix.planner import plan_transition_v3
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3
from crate.smart_mix.user_corrections import UserCorrection, apply_user_correction
from tests.conftest import PG_AVAILABLE
from tests.smart_mix_candidate_cases import (
    ANCHOR_MS,
    BEAT_MS,
    BPM,
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
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
}
CORRECTED_USER = 1
OTHER_USER = 2
# The analysis doubts the incoming tempo; the user confirmed it at 125 BPM.
CONFIRMED_TEMPO = {
    "entity_uid": INCOMING_UID,
    "revision": 3,
    "bpm": BPM,
    "beat_grid_format": None,
    "beat_grid_ms": None,
    "key": None,
}


def _edge(**changes) -> dict:
    return {
        "outgoingTrackEntityUid": OUTGOING_UID,
        "incomingTrackEntityUid": INCOMING_UID,
        "context": {**DECKS_CONTEXT, **changes},
    }


def _shared_profiles(structure: bool = True):
    return {
        OUTGOING_UID: profile(
            OUTGOING_UID, layout=OUTGOING_LAYOUT if structure else None
        ),
        INCOMING_UID: profile(
            INCOMING_UID,
            layout=INCOMING_LAYOUT if structure else None,
            bpm_confidence=0.5,
        ),
    }


def _user(user_id: int):
    async def resolve(self, request):
        del self, request
        return {
            "id": user_id,
            "email": f"user{user_id}@test.com",
            "role": "admin",
            "username": f"user{user_id}",
            "name": f"User {user_id}",
        }

    return resolve


@pytest.fixture
def env(test_app, monkeypatch):
    tracks = _shared_profiles()
    bare = _shared_profiles(structure=False)
    cache: dict[str, dict] = {}
    stored: dict[int, dict[str, dict]] = {
        CORRECTED_USER: {INCOMING_UID: CONFIRMED_TEMPO}
    }
    reads: list[tuple[int, list[str]]] = []

    def profiles(uids, **kwargs):
        source = tracks if kwargs.get("include_structure") else bare
        return [source.get(uid) for uid in uids]

    def corrections(user_id, uids, *, session=None):
        del session
        reads.append((user_id, list(uids)))
        found = stored.get(user_id, {})
        return DecksBatchRead(
            found={uid: found[uid] for uid in uids if uid in found},
            server_time=datetime(2026, 11, 18, tzinfo=UTC),
        )

    monkeypatch.setattr(smart_mix, "get_track_mix_profiles_by_entity_uids", profiles)
    monkeypatch.setattr(smart_mix, "get_decks_corrections", corrections)
    monkeypatch.setattr(smart_mix, "get_stem_analyses_by_entity_uids", lambda _u: {})
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_caches",
        lambda keys: {key: cache[key] for key in keys if key in cache},
    )
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", cache.update)

    class Env:
        def __init__(self) -> None:
            self.cache = cache
            self.stored = stored
            self.reads = reads
            self.tracks = tracks

        def post(
            self,
            edges: list[dict],
            *,
            user: int = CORRECTED_USER,
            planner: str = "smart-mix-v3",
        ) -> list[dict]:
            with patch("crate.api.auth.AuthMiddleware.resolve_user", _user(user)):
                response = test_app.post(
                    PATH, json={"plannerVersion": planner, "edges": edges}
                )
            assert response.status_code == 200, response.text
            return response.json()["plans"]

    return Env()


def _corrected(base, row: dict):
    return apply_user_correction(base, UserCorrection.from_row(row))


def _expected(edge: dict, outgoing, incoming, planner: str) -> dict:
    request = TransitionEdgeRequest.model_validate(edge)
    serialized = smart_mix._plan_edge(
        request,
        outgoing=outgoing,
        incoming=incoming,
        policy=smart_mix._planner_policy(planner),
    )
    return json.loads(
        smart_mix.TransitionPlanResponse.model_validate(serialized).model_dump_json(
            by_alias=True, exclude_none=True
        )
    )


# --- the user's plans -----------------------------------------------------------------


@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
def test_a_decks_plan_reads_the_users_correction(env, planner) -> None:
    [plan] = env.post([_edge()], planner=planner)

    # The analysis alone is not sure enough of the incoming tempo to beatmatch; the
    # user's confirmed BPM lifts the confidence.
    assert plan["mode"] == "beatmatch"
    assert "fallbackReason" not in plan
    # smart-mix-v2 plans on the profiles read without their structure.
    tracks = _shared_profiles(structure=planner == "smart-mix-v3")
    assert plan == _expected(
        _edge(),
        tracks[OUTGOING_UID],
        _corrected(tracks[INCOMING_UID], CONFIRMED_TEMPO),
        planner,
    )
    assert env.reads == [(CORRECTED_USER, [OUTGOING_UID, INCOMING_UID])]


def test_a_corrected_tempo_changes_the_tempo_ratio(env) -> None:
    env.stored[CORRECTED_USER][INCOMING_UID] = {**CONFIRMED_TEMPO, "bpm": 123.0}

    [plan] = env.post([_edge()])
    [other] = env.post([_edge()], user=OTHER_USER)

    assert plan["incomingTempoRatio"] == pytest.approx(BPM / 123.0, abs=1e-3)
    assert other["fallbackReason"] == "low_confidence"
    assert other["incomingTempoRatio"] == 1.0


@pytest.mark.parametrize("first", [CORRECTED_USER, OTHER_USER])
def test_no_user_is_served_another_users_plan(env, first) -> None:
    second = OTHER_USER if first == CORRECTED_USER else CORRECTED_USER

    plans = {first: env.post([_edge()], user=first)[0]}
    plans[second] = env.post([_edge()], user=second)[0]
    # Served again, now from the cache.
    again = {user: env.post([_edge()], user=user)[0] for user in (first, second)}

    assert plans == again
    assert plans[CORRECTED_USER]["mode"] == "beatmatch"
    assert plans[OTHER_USER]["fallbackReason"] == "low_confidence"
    assert len(env.cache) == 2


def test_a_different_correction_is_a_different_plan(env) -> None:
    env.stored[OTHER_USER] = {INCOMING_UID: {**CONFIRMED_TEMPO, "bpm": 123.0}}

    mine = env.post([_edge()], user=CORRECTED_USER)[0]
    theirs = env.post([_edge()], user=OTHER_USER)[0]

    assert mine["incomingTempoRatio"] == 1.0
    assert theirs["incomingTempoRatio"] == pytest.approx(BPM / 123.0, abs=1e-3)
    assert len(env.cache) == 2


def test_a_cleared_correction_is_the_shared_plan(env) -> None:
    env.stored[OTHER_USER] = {
        INCOMING_UID: {**CONFIRMED_TEMPO, "bpm": None, "revision": 4}
    }

    cleared = env.post([_edge()], user=OTHER_USER)[0]
    shared = env.post([_edge()], user=3)[0]

    assert cleared == shared
    assert cleared["fallbackReason"] == "low_confidence"
    assert len(env.cache) == 1


# --- the shared plans ---------------------------------------------------------------


@pytest.mark.parametrize(
    "changes",
    [
        {"source": "playlist"},
        {"source": "radio"},
        # What the VirtualDJ plugin sends.
        {"source": "manual", "automatic": False},
    ],
)
def test_other_sources_keep_the_shared_profile(env, changes) -> None:
    [plan] = env.post([_edge(**changes)])

    tracks = env.tracks
    assert plan == _expected(
        _edge(**changes), tracks[OUTGOING_UID], tracks[INCOMING_UID], "smart-mix-v3"
    )
    assert env.reads == []


def test_the_continuation_keeps_the_shared_profile(env, test_app, monkeypatch) -> None:
    async def continuation_user(self, request):
        del self, request
        return {
            "id": CORRECTED_USER,
            "email": "listener@example.com",
            "role": "user",
            "auth_type": "access_token",
            "access_token_id": 21,
            "token_type": "playback_continuation",
            "session_id": None,
            "scopes": ["playback.continuation"],
        }

    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda token_id: {"kind": "shaped_radio", "sessionId": "radio-1"},
    )
    monkeypatch.setattr(
        smart_mix,
        "continuation_radio_tracks",
        lambda descriptor, **_kwargs: (
            [
                {
                    "track_id": 7,
                    "track_entity_uid": INCOMING_UID,
                    "track_path": "/music/incoming.flac",
                    "title": "Song",
                    "artist": "Band",
                    "duration": 240.0,
                }
            ],
            False,
        ),
    )
    with patch("crate.api.auth.AuthMiddleware.resolve_user", continuation_user):
        response = test_app.post(
            "/api/playback/continuation",
            json={
                "plannerVersion": "smart-mix-v3",
                "afterTrackEntityUid": OUTGOING_UID,
                "context": DECKS_CONTEXT,
            },
        )

    assert response.status_code == 200, response.text
    [plan] = response.json()["plans"]
    assert plan["fallbackReason"] == "low_confidence"
    assert env.reads == []


def test_one_read_for_the_decks_edges_of_a_batch(env) -> None:
    third = "33333333-3333-4333-8333-333333333333"
    env.tracks[third] = profile(third, layout=INCOMING_LAYOUT)
    edges = [
        _edge(),
        {
            **_edge(),
            "outgoingTrackEntityUid": INCOMING_UID,
            "incomingTrackEntityUid": third,
        },
        # The same pair from Listen: the same track, the shared profile.
        _edge(source="playlist"),
    ]

    decks, decks_next, playlist = env.post(edges)

    assert env.reads == [(CORRECTED_USER, [OUTGOING_UID, INCOMING_UID, third])]
    assert decks["mode"] == "beatmatch"
    assert playlist["fallbackReason"] == "low_confidence"
    assert decks_next["outgoingTrackEntityUid"] == INCOMING_UID


# --- cache keys ---------------------------------------------------------------------


def _todays_key(edge: dict, outgoing, incoming, policy) -> str:
    """The plan cache key of a decks edge before F8.SM."""
    identity = {
        "plannerVersion": policy.identifier,
        "plannerRules": policy.rules_revision,
        "outgoingTrackEntityUid": edge["outgoingTrackEntityUid"],
        "outgoingProfileRevision": outgoing.profile_revision,
        "incomingTrackEntityUid": edge["incomingTrackEntityUid"],
        "incomingProfileRevision": incoming.profile_revision,
        "context": smart_mix._cache_context(
            TransitionEdgeRequest.model_validate(edge).context
        ),
        "policyLimits": True,
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("planner", ["smart-mix-v2", "smart-mix-v3"])
def test_uncorrected_edges_keep_their_cache_key(env, planner) -> None:
    policy = smart_mix._planner_policy(planner)
    tracks = env.tracks

    env.post([_edge()], user=OTHER_USER, planner=planner)

    assert list(env.cache) == [
        _todays_key(_edge(), tracks[OUTGOING_UID], tracks[INCOMING_UID], policy)
    ]


def test_a_correction_keys_the_plan_by_its_content() -> None:
    edge = TransitionEdgeRequest.model_validate(_edge())
    tracks = _shared_profiles(structure=False)
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    mine = UserCorrection.from_row(CONFIRMED_TEMPO)

    def key(corrections) -> str:
        return smart_mix._plan_cache_key(
            edge, outgoing, incoming, PLANNER_POLICY_V3, corrections=corrections
        )

    assert key((None, None)) == smart_mix._plan_cache_key(
        edge, outgoing, incoming, PLANNER_POLICY_V3
    )
    assert key((None, mine)) != key((None, None))
    assert key((mine, None)) != key((None, mine))
    # The revision alone does not key the plan: two users' revisions collide.
    assert key((None, UserCorrection.from_row({**CONFIRMED_TEMPO, "revision": 9}))) == (
        key((None, mine))
    )
    assert key((None, UserCorrection.from_row({**CONFIRMED_TEMPO, "bpm": 124.0}))) != (
        key((None, mine))
    )
    # v2 keys it the same way.
    assert smart_mix._plan_cache_key(
        edge, outgoing, incoming, PLANNER_POLICY, corrections=(None, mine)
    ) != smart_mix._plan_cache_key(edge, outgoing, incoming, PLANNER_POLICY)


# --- the menu and the limits --------------------------------------------------------


def test_the_menu_and_the_limits_come_from_the_corrected_profiles(env) -> None:
    # The user moved the incoming grid 40 ms later, at the analysed tempo.
    grid = [ANCHOR_MS + 40 + index * BEAT_MS for index in range(500)]
    env.stored[CORRECTED_USER][INCOMING_UID] = {
        **CONFIRMED_TEMPO,
        "beat_grid_format": "delta-ms-v1",
        "beat_grid_ms": grid,
        "key": "9A",
    }
    edge = _edge(localRefinement=True, allowLongBeatmatch=True)

    [plan] = env.post([edge])
    [shared] = env.post([edge], user=OTHER_USER)

    tracks = env.tracks
    incoming = _corrected(
        tracks[INCOMING_UID], env.stored[CORRECTED_USER][INCOMING_UID]
    )
    assert incoming.phrases[0].start_ms == ANCHOR_MS + 40
    context = smart_mix._transition_context(
        TransitionEdgeRequest.model_validate(edge).context
    )
    expected = plan_transition_v3(
        tracks[OUTGOING_UID],
        incoming,
        context,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
        policy=PLANNER_POLICY_V3,
    )
    assert [candidate["plan"] for candidate in plan["candidates"]] == [
        {
            key: value
            for key, value in candidate.to_plan().to_dict().items()
            if value is not None
        }
        for candidate in expected.candidates
    ]
    assert plan["candidates"] != shared["candidates"]
    assert {candidate["plan"]["incomingCueMs"] for candidate in plan["candidates"]} <= (
        {phrase.start_ms for phrase in incoming.phrases}
        | {plan["incomingCueMs"]}
        | {c.to_plan().incoming_cue_ms for c in expected.candidates}
    )
    # The limits keep their rules, now over the corrected profiles.
    assert (
        plan["policyLimits"]
        == policy_limits(
            tracks[OUTGOING_UID], incoming, context, PLANNER_POLICY_V3
        ).to_dict()
    )


# --- AI refinement ---------------------------------------------------------------------


def test_corrected_edges_are_not_refined() -> None:
    tracks = _shared_profiles(structure=False)
    user = {"id": CORRECTED_USER, "auth_type": "access_token", "scopes": []}
    edges = [
        TransitionEdgeRequest.model_validate(_edge(aiRefinement=True)),
        TransitionEdgeRequest.model_validate(
            _edge(aiRefinement=True, source="playlist")
        ),
    ]
    edge_profiles = [
        (edge, tracks[OUTGOING_UID], tracks[INCOMING_UID]) for edge in edges
    ]
    corrections = {INCOMING_UID: UserCorrection.from_row(CONFIRMED_TEMPO)}

    batch = smart_mix._refinement_batch(edge_profiles, user, corrections)
    uncorrected = smart_mix._refinement_batch(edge_profiles, user, {})

    # The decks edge is corrected and left out; the playlist edge is not.
    assert batch is not None and set(batch.requests) == {1}
    assert uncorrected is not None and set(uncorrected.requests) == {0, 1}
    assert smart_mix._refinement_batch(edge_profiles[:1], user, corrections) is None


# --- with the database ----------------------------------------------------------------


@contextmanager
def _as_user(user_id: int):
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _user(user_id)):
        yield


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_the_stored_correction_reaches_the_plan(pg_db, test_app, monkeypatch) -> None:
    del pg_db
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.decks_cues import put_decks_correction
    from tests.test_smart_mix_repository import _create_track

    _id, outgoing_uid = _create_track("decks-sm-outgoing")
    _id, incoming_uid = _create_track("decks-sm-incoming")
    owner = int(create_user("decks-sm-owner@test.com")["id"])
    other = int(create_user("decks-sm-other@test.com")["id"])
    stored = put_decks_correction(
        owner,
        incoming_uid,
        base_revision=0,
        bpm=BPM,
        beat_grid_ms=None,
        key=None,
        client_id=None,
    )
    assert stored.status == "stored"
    tracks = {
        outgoing_uid: profile(outgoing_uid, layout=OUTGOING_LAYOUT),
        incoming_uid: profile(incoming_uid, layout=INCOMING_LAYOUT, bpm_confidence=0.5),
    }
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
    edge = {
        "outgoingTrackEntityUid": outgoing_uid,
        "incomingTrackEntityUid": incoming_uid,
        "context": DECKS_CONTEXT,
    }

    def plan(user_id: int) -> dict:
        with _as_user(user_id):
            response = test_app.post(
                PATH, json={"plannerVersion": "smart-mix-v3", "edges": [edge]}
            )
        assert response.status_code == 200, response.text
        return response.json()["plans"][0]

    assert plan(owner)["mode"] == "beatmatch"
    assert plan(other)["fallbackReason"] == "low_confidence"
