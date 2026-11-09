"""The stems layer in the transition-plan batch (Smart Mix Stems, ST3.PR1).

smart-mix-v3 reads the stem analyses of the batch's tracks once, keys each plan on the
analyses that apply to both tracks of its edge, and attaches the stems layer to the
profiles it plans with. ``stemsUsed`` appears only when the layer scored a plan, so v3
plans without stems and every smart-mix-v2 plan keep their shape.

Since STEM-G1 (rules revision 3) the layer scores only edges of the beatmatch family:
the batch reads the album genres of the tracks of edges with stems on both, once, and
both tracks' genre beatmatch priors must be at least 0.5.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from crate.api import smart_mix
from crate.api.schemas.smart_mix import TransitionEdgeRequest
from crate.smart_mix.models import TrackMixProfile
from crate.smart_mix.phrase_grid import phrase_spans_ms
from crate.smart_mix.policy import PLANNER_POLICY, PLANNER_POLICY_V3
from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis
from tests.smart_mix_candidate_cases import profile

PATH = "/api/playback/transition-plans"
OUTGOING_UID = "33333333-3333-4333-8333-333333333333"
INCOMING_UID = "44444444-4444-4444-8444-444444444444"
REVISIONS = {OUTGOING_UID: "a" * 64, INCOMING_UID: "b" * 64}
# The tie of test_candidates_stems: from the outgoing outro into the incoming intro or
# its build. YAMNet hears no voice on either; the vocal stem hears it on the intro.
OUT_LAYOUT = (
    ("intro", 16, 0.5),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 8, 0.5),
)
IN_LAYOUT = (
    ("intro", 8, 0.5),
    ("build", 8, 0.5),
    ("peak", 32, 0.8),
    ("break", 16, 0.5),
    ("peak", 32, 0.8),
    ("outro", 16, 0.45),
)
YAMNET = {
    OUTGOING_UID: (20, 160, 20, 160, 170),
    INCOMING_UID: (20, 20, 160, 20, 160, 10),
}
TECHNO = {"techno": 1.0}
IN_FAMILY = {OUTGOING_UID: 0.95, INCOMING_UID: 0.95}
STEM_VOCALS = {OUTGOING_UID: {1, 3, 4}, INCOMING_UID: {0, 2, 4}}


def _profiles() -> dict[str, TrackMixProfile]:
    return {
        uid: profile(
            uid, layout=layout, vocals=YAMNET[uid], source_revision=REVISIONS[uid]
        )
        for uid, layout in ((OUTGOING_UID, OUT_LAYOUT), (INCOMING_UID, IN_LAYOUT))
    }


def _analysis(
    uid: str, *, revision: str | None = None, level: int = 220
) -> StemAnalysis:
    """Vocals at ``level`` on the phrases of STEM_VOCALS and silence elsewhere."""
    track = _profiles()[uid]
    assert track.phrases is not None
    windows = -(-track.duration_ms // 250)
    # Without a beat grid the last phrase runs to the end of the track, as in
    # stem_phrase_layer.
    spans = [
        (start, end if start < end <= track.duration_ms else track.duration_ms)
        for start, end in phrase_spans_ms(track.phrases, ())
    ]
    voiced = [spans[index] for index in STEM_VOCALS[uid]]

    def byte(window: int) -> int:
        centre = window * 250 + 125
        return level if any(a <= centre < b for a, b in voiced) else 0

    vocals = bytes(byte(window) for window in range(windows))
    return StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/2026.11.9",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision=revision or REVISIONS[uid],
        hop_ms=250,
        levels={
            "drums": bytes(windows),
            "bass": bytes(windows),
            "other": bytes([150]) * windows,
            "vocals": vocals,
        },
        duration_ms=track.duration_ms,
    )


def _edge(planner_context: dict | None = None) -> dict:
    return {
        "outgoingTrackEntityUid": OUTGOING_UID,
        "incomingTrackEntityUid": INCOMING_UID,
        "context": planner_context
        or {
            "source": "playlist",
            "automatic": True,
            "offline": False,
            "preferredDurationMs": 12_000,
            "userCueProfile": "auto",
            "allowBeatmatch": True,
            "allowTempoAdjustment": True,
            "allowBassHandoff": True,
            "allowLongBeatmatch": True,
        },
    }


@pytest.fixture
def batch(test_app, monkeypatch):
    """The plan batch over fake reads: profiles, stem analyses and the plan cache."""
    state = {
        "analyses": {},
        "reads": [],
        "stem_reads": [],
        "plans": {},
        "genres": {uid: TECHNO for uid in REVISIONS},
        "genre_reads": [],
    }
    tracks = _profiles()

    def profiles(entity_uids, **kwargs):
        state["reads"].append(kwargs)
        return [tracks.get(uid) for uid in entity_uids]

    def analyses(entity_uids):
        state["stem_reads"].append(list(entity_uids))
        return {
            uid: list(state["analyses"][uid])
            for uid in entity_uids
            if uid in state["analyses"]
        }

    monkeypatch.setattr(smart_mix, "get_track_mix_profiles_by_entity_uids", profiles)
    monkeypatch.setattr(smart_mix, "get_stem_analyses_by_entity_uids", analyses)

    def genres(entity_uids):
        state["genre_reads"].append(list(entity_uids))
        return {
            uid: state["genres"][uid] for uid in entity_uids if uid in state["genres"]
        }

    monkeypatch.setattr(smart_mix, "get_track_album_genres", genres)
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_caches",
        lambda keys: {
            key: state["plans"][key] for key in keys if key in state["plans"]
        },
    )
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", state["plans"].update)

    def post(planner: str = "smart-mix-v3") -> dict:
        response = test_app.post(
            PATH, json={"plannerVersion": planner, "edges": [_edge()]}
        )
        assert response.status_code == 200, response.text
        return response.json()["plans"][0]

    state["post"] = post
    return state


def _incoming_phrase_starts() -> list[int]:
    track = _profiles()[INCOMING_UID]
    assert track.phrases is not None
    return [phrase.start_ms for phrase in track.phrases]


def test_stems_used_only_with_stems_on_both_tracks(batch) -> None:
    intro, build = _incoming_phrase_starts()[:2]

    plain = batch["post"]()
    batch["plans"].clear()
    batch["analyses"] = {OUTGOING_UID: [_analysis(OUTGOING_UID)]}
    one_side = batch["post"]()
    batch["plans"].clear()
    batch["analyses"][INCOMING_UID] = [_analysis(INCOMING_UID)]
    both = batch["post"]()

    assert "stemsUsed" not in plain and "stemsUsed" not in one_side
    assert one_side == plain
    assert plain["incomingCueMs"] == intro
    # The vocal stems move the mix off the incoming intro, where they collide.
    assert both["stemsUsed"] is True
    assert both["structureUsed"] is True
    assert both["incomingCueMs"] == build


def test_a_stale_or_mismatched_analysis_does_not_apply(batch) -> None:
    batch["analyses"] = {
        OUTGOING_UID: [_analysis(OUTGOING_UID)],
        INCOMING_UID: [_analysis(INCOMING_UID, revision="c" * 64)],
    }
    stale = batch["post"]()
    batch["plans"].clear()
    track = _profiles()[INCOMING_UID]
    longer = _analysis(INCOMING_UID).model_copy(
        update={"duration_ms": round(track.duration_ms * 1.05)}
    )
    batch["analyses"][INCOMING_UID] = [longer]
    mismatched = batch["post"]()

    assert "stemsUsed" not in stale and "stemsUsed" not in mismatched


def test_the_structure_is_read_with_the_grid_only_for_edges_with_stems(batch) -> None:
    batch["post"]()
    without = list(batch["reads"])
    batch["plans"].clear()
    batch["reads"].clear()
    batch["analyses"] = {uid: [_analysis(uid)] for uid in REVISIONS}
    batch["post"]()

    assert without == [{"include_structure": False}, {"include_structure": True}]
    assert batch["reads"] == [
        {"include_structure": False},
        {"include_structure": True, "include_beat_grid": True},
    ]
    assert batch["stem_reads"] == [[OUTGOING_UID, INCOMING_UID]] * 2


def test_a_cached_plan_follows_the_stem_analysis(batch) -> None:
    batch["analyses"] = {uid: [_analysis(uid)] for uid in REVISIONS}
    first = batch["post"]()
    cached = len(batch["plans"])
    again = batch["post"]()
    batch["analyses"][INCOMING_UID] = [_analysis(INCOMING_UID, level=200)]
    changed = batch["post"]()

    assert again == first
    assert cached == 1
    # Another analysis of the same file is another key: the plan is computed again.
    assert len(batch["plans"]) == 2
    assert changed["stemsUsed"] is True


def test_the_cache_key_carries_stems_only_when_both_tracks_have_them() -> None:
    edge = TransitionEdgeRequest.model_validate(_edge())
    tracks = _profiles()
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    both = {uid: _analysis(uid) for uid in REVISIONS}
    one = {OUTGOING_UID: both[OUTGOING_UID]}
    other = {**both, INCOMING_UID: _analysis(INCOMING_UID, level=200)}

    def key(policy, stems=None) -> str:
        return smart_mix._plan_cache_key(
            edge, outgoing, incoming, policy, stems=stems, genre_priors=IN_FAMILY
        )

    assert key(PLANNER_POLICY_V3, one) == key(PLANNER_POLICY_V3)
    assert key(PLANNER_POLICY_V3, both) != key(PLANNER_POLICY_V3)
    assert key(PLANNER_POLICY_V3, other) != key(PLANNER_POLICY_V3, both)
    # The stems layer off: no stems in the key.
    off = replace(PLANNER_POLICY_V3, stems_layer=False)
    assert key(off, both) == key(off)


def test_v2_never_reads_stems_and_keeps_its_cache_key(batch) -> None:
    edge = TransitionEdgeRequest.model_validate(_edge())
    tracks = _profiles()
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    both = {uid: _analysis(uid) for uid in REVISIONS}
    batch["analyses"] = {uid: [analysis] for uid, analysis in both.items()}

    plan = batch["post"]("smart-mix-v2")

    assert batch["stem_reads"] == []
    assert batch["genre_reads"] == []
    assert "stemsUsed" not in plan and "structureUsed" not in plan
    assert smart_mix._plan_cache_key(
        edge, outgoing, incoming, PLANNER_POLICY, stems=both
    ) == smart_mix._plan_cache_key(edge, outgoing, incoming, PLANNER_POLICY)


# --- the mix-type gate (STEM-G1) -----------------------------------------------------


@pytest.mark.parametrize(
    "genres",
    [
        {OUTGOING_UID: TECHNO, INCOMING_UID: {"rock": 1.0}},
        {OUTGOING_UID: {"punk": 0.6, "hardcore": 0.4}, INCOMING_UID: TECHNO},
        {OUTGOING_UID: TECHNO},
        {},
    ],
    ids=["rock", "punk", "unknown", "none"],
)
def test_outside_the_beatmatch_family_the_plan_ignores_stems(batch, genres) -> None:
    plain = batch["post"]()
    batch["plans"].clear()
    batch["analyses"] = {uid: [_analysis(uid)] for uid in REVISIONS}
    batch["genres"] = genres

    gated = batch["post"]()

    assert gated == plain
    assert "stemsUsed" not in gated
    assert batch["genre_reads"] == [[OUTGOING_UID, INCOMING_UID]]


def test_in_the_family_the_stems_layer_scores_the_plan(batch) -> None:
    batch["analyses"] = {uid: [_analysis(uid)] for uid in REVISIONS}
    batch["genres"] = {
        OUTGOING_UID: {"house": 0.7, "disco": 0.3},
        INCOMING_UID: {"drum and bass": 1.0},
    }

    plan = batch["post"]()

    assert plan["stemsUsed"] is True
    assert plan["incomingCueMs"] == _incoming_phrase_starts()[1]


def test_genres_are_read_only_for_edges_with_stems_on_both_tracks(batch) -> None:
    batch["post"]()
    batch["plans"].clear()
    batch["analyses"] = {OUTGOING_UID: [_analysis(OUTGOING_UID)]}
    batch["post"]()

    assert batch["genre_reads"] == []


def test_the_cache_key_follows_the_gate() -> None:
    edge = TransitionEdgeRequest.model_validate(_edge())
    tracks = _profiles()
    outgoing, incoming = tracks[OUTGOING_UID], tracks[INCOMING_UID]
    both = {uid: _analysis(uid) for uid in REVISIONS}

    def key(priors=None, stems=None) -> str:
        return smart_mix._plan_cache_key(
            edge,
            outgoing,
            incoming,
            PLANNER_POLICY_V3,
            stems=stems,
            genre_priors=priors,
        )

    rock = {OUTGOING_UID: 0.95, INCOMING_UID: 0.15}
    # Outside the family the key is the key without stems, as the plan is.
    assert key(rock, both) == key() == key(None, both)
    assert key(IN_FAMILY, both) != key()
    # A track whose genre moves into the family changes the key.
    assert key(rock, both) != key(IN_FAMILY, both)
