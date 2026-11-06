"""The Smart Mix refinement prompt: numbers and structure only (SM4.PR1, SM3-D6)."""

from __future__ import annotations

import json
import re

import pytest
from pydantic import ValidationError

from crate.ai.runtime import estimated_input_tokens
from crate.llm.prompts.smart_mix_transition import (
    PROMPT_VERSION,
    SCHEMA_FINGERPRINT,
    SYSTEM_PROMPT,
    SmartMixRefinementResponse,
    build_refinement_input,
    render_refinement_prompt,
)
from crate.smart_mix.candidates import plan_transition_candidates
from crate.smart_mix.models import PHRASE_KINDS
from crate.smart_mix.policy import PLANNER_POLICY_V3
from tests.smart_mix_candidate_cases import (
    INCOMING_LAYOUT,
    INCOMING_UID,
    OUTGOING_LAYOUT,
    OUTGOING_UID,
    context,
    profile,
)

POLICY = PLANNER_POLICY_V3
TITLE = "Midnight Secret Title"
ARTIST = "Private Artist Name"
PATH = "/music/Private Artist Name/Album/01 Midnight Secret Title.flac"
HISTORY = [
    {"mode": "beatmatch", "durationBars": 32, "deltaEnergy": -0.12},
    {"mode": "adaptive", "durationBars": 0, "deltaEnergy": 0.3},
    {"mode": "beatmatch", "durationBars": 16, "deltaEnergy": 0.05},
]
# Every string the input may hold: closed vocabularies, Camelot keys and slugs.
ALLOWED_STRING = re.compile(
    r"^(?:\d{1,2}[AB]|[a-z0-9]+(?:-[a-z0-9]+)*|[0-9]+|sm3-refine-\d+)$"
)


def _edge(*, outgoing_layout=OUTGOING_LAYOUT, incoming_layout=INCOMING_LAYOUT, **kw):
    outgoing = profile(
        OUTGOING_UID,
        layout=outgoing_layout,
        vocals=[120] * len(outgoing_layout),
        **kw,
    )
    incoming = profile(
        INCOMING_UID,
        layout=incoming_layout,
        vocals=[30] * len(incoming_layout),
        **kw,
    )
    ctx = context()
    candidates = plan_transition_candidates(
        outgoing,
        incoming,
        ctx,
        POLICY,
        outgoing_track_entity_uid=OUTGOING_UID,
        incoming_track_entity_uid=INCOMING_UID,
    )
    return outgoing, incoming, ctx, candidates


def _input(*, send_genre=True, genres=("progressive-house", "techno"), **edge):
    outgoing, incoming, ctx, candidates = _edge(**edge)
    return build_refinement_input(
        outgoing,
        incoming,
        candidates,
        policy=POLICY,
        context=ctx,
        genres=genres,
        send_genre=send_genre,
        set_history=HISTORY,
    )


def _values(value):
    """Every string value of a JSON document (keys aside)."""
    if isinstance(value, dict):
        for item in value.values():
            yield from _values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _values(item)
    elif isinstance(value, str):
        yield value


def test_input_contains_no_titles_artists_uids_paths():
    outgoing, incoming, _ctx, candidates = _edge()
    payload = _input()
    prompt = render_refinement_prompt(payload)
    forbidden = {
        OUTGOING_UID,
        INCOMING_UID,
        OUTGOING_UID.split("-")[0],
        INCOMING_UID.split("-")[0],
        outgoing.profile_revision,
        incoming.profile_revision,
        outgoing.source_revision,
        incoming.source_revision,
        TITLE,
        ARTIST,
        PATH,
        "/music",
    }

    assert json.loads(prompt) == payload
    for text in (prompt, SYSTEM_PROMPT):
        for value in forbidden:
            assert value not in text
    values = list(_values(payload))
    assert values, "the input carries some labels"
    for key in _keys(payload):
        assert re.fullmatch(r"[a-z][A-Za-z]*", key), key
    for value in values:
        assert ALLOWED_STRING.match(value), value
    kinds = {
        phrase["kind"] for side in ("out", "in") for phrase in payload[side]["phrases"]
    }
    assert kinds <= set(PHRASE_KINDS)
    assert payload["v"] == PROMPT_VERSION
    assert len(payload["candidates"]) == len(candidates)


def _keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _keys(item)


def test_genre_omitted_when_binding_disallows():
    allowed = _input(send_genre=True)
    withheld = _input(send_genre=False)
    unknown = _input(send_genre=True, genres=(None, None))

    assert (allowed["out"]["genre"], allowed["in"]["genre"]) == (
        "progressive-house",
        "techno",
    )
    for payload in (withheld, unknown):
        assert "genre" not in set(_keys(payload))
        assert "techno" not in render_refinement_prompt(payload)
    # Everything else is the same input.
    for side in ("out", "in"):
        allowed[side].pop("genre")
    assert allowed == withheld


def test_input_size_within_budget():
    # The longest edge the menu can produce: six 32-bar phrases shown on each side
    # (and the widened window), voice on every phrase, eight candidates, three
    # history entries and long genre slugs.
    long = (("peak", 32, 0.8),) * 12
    outgoing, incoming, ctx, candidates = _edge(
        outgoing_layout=long, incoming_layout=long, duration_ms=900_000
    )
    payload = build_refinement_input(
        outgoing,
        incoming,
        candidates,
        policy=POLICY,
        context=ctx,
        genres=("progressive-melodic-techno", "progressive-melodic-techno"),
        send_genre=True,
        set_history=HISTORY,
    )
    prompt = render_refinement_prompt(payload)
    schema = SmartMixRefinementResponse.model_json_schema()
    shown = sum(phrase["bars"] for phrase in payload["out"]["phrases"])

    assert len(candidates) == POLICY.max_candidates
    assert shown >= 6 * 32
    # The runtime's own admission bound: one token per byte plus 1,024 of framing.
    assert estimated_input_tokens(prompt, SYSTEM_PROMPT, schema) < 6_000


def test_response_schema_forbids_extra():
    valid = {
        "candidate_index": 1,
        "outgoing_phrase_shift": 0,
        "incoming_phrase_shift": -1,
        "length_step": 1,
        "bass_handoff": "keep",
        "reason": "Mix out of the outro into the intro.",
        "confidence": 0.8,
        "notes": ["vocals do not overlap"],
    }
    parsed = SmartMixRefinementResponse.model_validate(valid)
    assert parsed.candidate_index == 1

    schema = SmartMixRefinementResponse.model_json_schema()
    assert schema["additionalProperties"] is False
    with pytest.raises(ValidationError):
        SmartMixRefinementResponse.model_validate({**valid, "duration_ms": 12_000})
    for field, value in (
        ("outgoing_phrase_shift", 2),
        ("length_step", -2),
        ("bass_handoff", "full"),
        ("reason", "x" * 241),
        ("confidence", 1.5),
        ("notes", ["a"] * 5),
        ("notes", ["x" * 121]),
        ("candidate_index", -1),
    ):
        with pytest.raises(ValidationError):
            SmartMixRefinementResponse.model_validate({**valid, field: value})
    assert re.fullmatch(r"[0-9a-f]{64}", SCHEMA_FINGERPRINT)
