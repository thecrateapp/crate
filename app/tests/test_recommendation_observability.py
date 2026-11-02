from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime

import pytest

from crate import music_paths, radio_engine
from crate.observability import recommendations
from crate.observability.metric_catalog import canonical_metric
from crate.observability.metric_catalog_data import LABEL_VALUES
from crate.recommendation_policy import RECOMMENDATION_RULES_REVISION
from tests.test_radio_continuation_contract import (
    SESSION_ID,
    SESSION_KEY,
    MemoryRedis,
)
from tests.test_radio_rotation_edges import _history, _row, _state


@pytest.fixture
def recorded(monkeypatch):
    calls: list[tuple[str, float, dict]] = []
    monkeypatch.setattr(
        recommendations,
        "record_later",
        lambda name, value, tags: calls.append((name, value, tags)),
    )
    return calls


def _named(calls, name):
    return [(value, tags) for metric, value, tags in calls if metric == name]


@pytest.fixture
def redis(monkeypatch):
    memory = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: memory)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *args: None)
    memory.setex(
        SESSION_KEY,
        86400,
        json.dumps(
            {"id": SESSION_ID, "user_id": 42, "track_count": 20, "seed_type": "artist"}
        ),
    )
    return memory


def _tracks(count, *, vectors=True):
    return [
        {
            "track_id": index,
            "distance": 0.1 * index,
            "bliss_vector": [0.1] * 20 if vectors else None,
        }
        for index in range(1, count + 1)
    ]


def test_a_generated_batch_records_outcome_latency_fill_and_coverage(
    recorded, redis, monkeypatch
):
    from crate.radio_continuation import next_batch

    def generate(session, count):
        recommendations.note_radio_relaxation("none")
        recommendations.note_radio_relaxation("artist_batch")
        return _tracks(2) + _tracks(1, vectors=False)

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)

    next_batch(SESSION_ID, user_id=42, batch_index=1, count=6)

    assert _named(recorded, "radio.batch.count") == [
        (
            1.0,
            {
                "stage": "next",
                "outcome": "ok",
                "source": "generated",
                "profile": "contextual",
            },
        )
    ]
    tags = {"stage": "next", "profile": "contextual"}
    assert _named(recorded, "radio.batch.fill") == [(0.5, tags)]
    assert [entry[1] for entry in _named(recorded, "radio.batch.ms")] == [tags]
    assert _named(recorded, "radio.batch.relaxation") == [
        (1.0, {"profile": "contextual", "level": "none"}),
        (1.0, {"profile": "contextual", "level": "artist_batch"}),
    ]
    assert _named(recorded, "radio.batch.vectors") == [
        (2.0, {"profile": "contextual", "coverage": "present"}),
        (1.0, {"profile": "contextual", "coverage": "missing"}),
    ]
    assert _named(recorded, "radio.batch.distance") == [
        (pytest.approx(0.1), {"profile": "contextual"})
    ]


def test_a_replayed_batch_is_not_counted_as_new_generation(
    recorded, redis, monkeypatch
):
    from crate.radio_continuation import next_batch

    monkeypatch.setattr(radio_engine, "_generate_batch", lambda *args: _tracks(1))
    next_batch(SESSION_ID, user_id=42, batch_index=1, count=5)
    recorded.clear()

    next_batch(SESSION_ID, user_id=42, batch_index=1, count=5)

    assert recorded == [
        (
            "radio.batch.count",
            1.0,
            {"stage": "next", "outcome": "ok", "source": "replayed", "profile": "none"},
        )
    ]


def test_real_exhaustion_and_a_lost_session_are_told_apart(
    recorded, redis, monkeypatch
):
    from crate.radio_continuation import next_batch

    monkeypatch.setattr(
        radio_engine,
        "_advance_radio",
        lambda session, count: {"tracks": [], "exhausted": True},
    )
    next_batch(SESSION_ID, user_id=42, batch_index=1)
    next_batch(SESSION_ID, user_id=7, batch_index=2)

    counts = [tags for _value, tags in _named(recorded, "radio.batch.count")]
    assert counts == [
        {
            "stage": "next",
            "outcome": "exhausted",
            "source": "generated",
            "profile": "contextual",
        },
        {
            "stage": "next",
            "outcome": "exhausted",
            "source": "replayed",
            "profile": "none",
        },
    ]
    assert not [tags for _value, tags in _named(recorded, "radio.batch.distance")], (
        "an empty batch has no affinity reading, not a zero"
    )


def test_a_generation_error_is_counted_and_still_raised(recorded, redis, monkeypatch):
    from crate.radio_continuation import next_batch

    def fail(session, count):
        raise RuntimeError("candidate query failed")

    monkeypatch.setattr(radio_engine, "_generate_batch", fail)

    with pytest.raises(RuntimeError):
        next_batch(SESSION_ID, user_id=42, batch_index=1)

    assert _named(recorded, "radio.batch.count") == [
        (
            1.0,
            {
                "stage": "next",
                "outcome": "error",
                "source": "generated",
                "profile": "contextual",
            },
        )
    ]
    assert not _named(recorded, "radio.batch.fill")


def test_a_failing_metric_never_breaks_the_batch(redis, monkeypatch):
    from crate.radio_continuation import next_batch

    def broken(*args):
        raise OSError("metrics down")

    monkeypatch.setattr(recommendations, "record_later", broken)
    monkeypatch.setattr(radio_engine, "_generate_batch", lambda *args: _tracks(1))

    assert next_batch(SESSION_ID, user_id=42, batch_index=1)["status"] == "ok"


def test_relaxing_the_consecutive_artist_rule_is_recorded(recorded, monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    row = _row(1, "Seed")
    monkeypatch.setattr(radio_engine, "_load_radio_graphs", lambda **k: ({}, {}, {}))
    monkeypatch.setattr(
        radio_engine, "_seeded_radio_candidate_rows", lambda *a, **k: [deepcopy(row)]
    )
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history([row])
    )
    state = _state()
    state.update(recent_artists=["Seed", "Seed"], used_track_ids=[1])
    radio_engine._apply_buffer_context(state, [])

    with recommendations.observe_radio_batch("next", 1) as observation:
        recommendations.note_radio_generated("contextual")
        tracks = radio_engine._generate_batch(state, 1)
        observation["result"] = {"status": "ok", "tracks": tracks}

    assert [track["track_id"] for track in tracks] == [1]
    assert _named(recorded, "radio.batch.relaxation") == [
        (1.0, {"profile": "contextual", "level": "consecutive"})
    ]


def test_relaxation_outside_an_observed_batch_is_ignored(recorded):
    recommendations.note_radio_relaxation("none")

    assert recorded == []


@pytest.mark.parametrize(
    ("plan", "outcome"),
    [
        (None, "unresolved"),
        ({"tracks": [], "is_partial": True, "generated_step_count": 0}, "empty"),
        (
            {
                "tracks": [{}] * 3,
                "is_partial": True,
                "generated_step_count": 3,
                "warnings": [
                    {"code": "insufficient_tracks"},
                    {"code": "repeated_artist", "position": 1},
                    {"code": "repeated_artist", "position": 2},
                ],
            },
            "partial",
        ),
        (
            {"tracks": [{}] * 4, "is_partial": False, "generated_step_count": 4},
            "complete",
        ),
    ],
)
def test_music_path_plans_report_completeness_once_per_plan(
    recorded, monkeypatch, plan, outcome
):
    monkeypatch.setattr(
        music_paths, "_plan_music_path", lambda *args, **kwargs: ("scene", plan)
    )

    assert (
        music_paths.build_music_path_plan("artist", "1", "artist", "2", step_count=4)
        is plan
    )

    assert _named(recorded, "paths.plan.count") == [
        (1.0, {"engine": "scene", "outcome": outcome})
    ]
    assert len(_named(recorded, "paths.plan.ms")) == 1
    fill = _named(recorded, "paths.plan.fill")
    warnings = _named(recorded, "paths.plan.warnings")
    if plan is None:
        assert fill == [] and warnings == []
    else:
        assert fill == [(plan["generated_step_count"] / 4, {"engine": "scene"})]
    if outcome == "partial":
        assert warnings == [
            (1.0, {"engine": "scene", "code": "insufficient_tracks"}),
            (1.0, {"engine": "scene", "code": "repeated_artist"}),
        ]


def test_every_path_warning_and_relaxation_level_is_catalogued():
    assert set(recommendations.PATH_WARNING_CODES) == set(
        LABEL_VALUES["path_warning_code"]
    )
    assert set(recommendations.RELAXATION_LEVELS) == set(
        LABEL_VALUES["radio_relaxation"]
    )
    assert (
        str(RECOMMENDATION_RULES_REVISION)
        in LABEL_VALUES["recommendation_rules_revision"]
    )


def test_recommendation_labels_never_carry_identities():
    series = canonical_metric(
        "radio.batch.count",
        {
            "stage": "next",
            "outcome": "ok",
            "source": "generated",
            "profile": "contextual",
            "session_id": SESSION_ID,
            "user_id": "42",
        },
    )

    assert dict(series.tags) == {
        "stage": "next",
        "outcome": "ok",
        "source": "generated",
        "profile": "contextual",
    }


def test_early_skips_publish_a_ratio_only_when_plays_exist(monkeypatch):
    from crate.worker_handlers import recommendation_skips

    windows, samples = [], []

    def counts(since, until, *, early_seconds):
        windows.append((since, until, early_seconds))
        return {
            "radio": {"delivered": 40, "early_skips": 10},
            "path": {"delivered": 0, "early_skips": 0},
        }

    monkeypatch.setattr(recommendation_skips, "get_early_skip_counts", counts)
    monkeypatch.setattr(
        recommendation_skips,
        "record",
        lambda name, value, tags: samples.append((name, value, tags)),
    )

    summary = recommendation_skips.publish_early_skips(
        datetime(2026, 11, 2, 14, 37, tzinfo=UTC)
    )

    assert windows == [
        (
            datetime(2026, 11, 1, 14, tzinfo=UTC),
            datetime(2026, 11, 2, 14, tzinfo=UTC),
            30.0,
        )
    ]
    revision = str(RECOMMENDATION_RULES_REVISION)
    assert samples == [
        (
            "recommendations.early_skip.sample",
            40,
            {"surface": "radio", "rules_revision": revision},
        ),
        (
            "recommendations.early_skip.ratio",
            0.25,
            {"surface": "radio", "rules_revision": revision},
        ),
        (
            "recommendations.early_skip.sample",
            0,
            {"surface": "path", "rules_revision": revision},
        ),
    ]
    assert summary["window_end"] == "2026-11-02T14:00:00+00:00"
