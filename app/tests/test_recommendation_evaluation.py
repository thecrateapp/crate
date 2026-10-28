"""Behavioral checks for the offline baseline, without pinning today's ranking."""

import json
import os
import random
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest
from crate import queue_engine, radio_engine

from tests.recommendation_evaluation import (
    coherence_metrics,
    evaluate_snapshot,
    generate_snapshot_batch,
    overlap_metrics,
)

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "recommendations"


@pytest.fixture
def small_snapshot():
    vector = [0.2] * 20
    return {
        "schema_version": 1,
        "name": "small-offline-example",
        "reference_day": "2026-10-28",
        "provenance": {"catalog_revision": "example", "engine_revision": "example"},
        "batch_size": 2,
        "initial_session": {
            "id": "synthetic",
            "user_id": 0,
            "mode": "seeded",
            "seed_type": "artist",
            "seed_value": "synthetic-seed",
            "seed_label": "High Vis",
            "created_at": "2026-10-28T00:00:00+00:00",
            "seed_vector": vector,
            "initial_target": vector,
            "current_target": vector,
            "seed_artists": ["High Vis"],
            "seed_genres": [],
            "seed_track_ids": [99],
            "queue_intent": {"profile": "contextual", "genres": []},
            "used_track_ids": [],
            "used_titles": [],
            "used_song_keys": [],
            "used_artist_counts": {},
            "recent_artists": [],
            "recent_tracks": [],
            "liked_vectors": [],
            "disliked_vectors": [],
            "track_count": 0,
        },
        "candidate_rows": [
            {
                "id": track_id,
                "artist": artist,
                "title": title,
                "bliss_vector": [value] * 20,
                "radio_source": source,
            }
            for track_id, artist, title, value, source in (
                (1, "Home Front", "Games of Power", 0.8, "similar"),
                (2, "Ditz", "Ded Wurst", 0.7, "similar"),
                (3, "Pearl Jam", "Live Rarity", 0.2, "bliss"),
                (99, "High Vis", "Seed Track", 0.2, "seed"),
            )
        ],
        "graphs": {
            "similarity": {"high vis": {"home front": 1.0, "ditz": 0.52}},
            "genres": {
                "high vis": {"post-punk": 1.0},
                "home front": {"post-punk": 1.0},
                "ditz": {"post-punk": 1.0},
                "pearl jam": {"grunge": 1.0},
            },
            "shared_members": {"high vis": ["ditz"]},
        },
    }


def test_snapshot_generation_uses_real_contextual_ranking_and_seed_exclusion(
    small_snapshot,
):
    result = generate_snapshot_batch(small_snapshot, session_id="baseline-a")

    assert {track["artist"] for track in result["tracks"]} == {"Home Front", "Ditz"}
    assert all(track["track_id"] != 99 for track in result["tracks"])
    assert all("distance" in track for track in result["tracks"])


def test_repeated_run_is_reproducible_and_inputs_are_isolated(small_snapshot):
    original = deepcopy(small_snapshot)
    first = evaluate_snapshot(small_snapshot)
    second = evaluate_snapshot(small_snapshot)

    assert first == second
    assert small_snapshot == original
    first["sessions"][0]["tracks"][0]["title"] = "Changed by the caller"
    first["provenance"]["engine_revision"] = "Changed by the caller"
    assert evaluate_snapshot(small_snapshot) == second
    assert small_snapshot == original


def test_report_compares_consecutive_fixed_days(small_snapshot):
    report = evaluate_snapshot(small_snapshot)

    assert [session["reference_day"] for session in report["sessions"]] == [
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
    ]
    for session in report["sessions"]:
        replay = generate_snapshot_batch(
            small_snapshot,
            session_id=session["session_id"],
            reference_day=session["reference_day"],
        )
        assert [track["track_id"] for track in replay["tracks"]] == [
            track["track_id"] for track in session["tracks"]
        ]
        assert replay["generation_seed"] == session["generation_seed"]


def test_independent_sessions_on_the_same_day_have_distinct_generation_seeds(
    small_snapshot,
):
    first = generate_snapshot_batch(small_snapshot, session_id="baseline-a")
    second = generate_snapshot_batch(small_snapshot, session_id="baseline-b")

    assert first["reference_day"] == second["reference_day"] == "2026-10-28"
    assert first["generation_seed"] != second["generation_seed"]


def test_generation_uses_explicit_clock_and_session_without_global_randomness(
    monkeypatch, small_snapshot
):
    expected = evaluate_snapshot(small_snapshot)
    state = random.getstate()

    def unexpected(*_args, **_kwargs):
        pytest.fail(
            "The baseline used the host clock or an implicit session identifier"
        )

    class HostDate:
        today = staticmethod(unexpected)

    class HostDatetime:
        now = staticmethod(unexpected)

    monkeypatch.setattr(queue_engine, "date", HostDate)
    monkeypatch.setattr(radio_engine, "datetime", HostDatetime)
    monkeypatch.setattr(radio_engine.uuid, "uuid4", unexpected)
    monkeypatch.setenv("TZ", "Pacific/Kiritimati")
    monkeypatch.setenv("USER", "another-host-user")

    assert evaluate_snapshot(small_snapshot) == expected
    assert random.getstate() == state
    assert len({row["generation_seed"] for row in expected["sessions"]}) == 3
    next_day = deepcopy(small_snapshot)
    next_day["reference_day"] = "2026-10-29"
    assert (
        generate_snapshot_batch(next_day, session_id="baseline-a")["generation_seed"]
        != (expected["sessions"][0]["generation_seed"])
    )


@pytest.mark.parametrize("boundary", ["database", "redis", "persistence"])
def test_generation_rejects_external_io(monkeypatch, small_snapshot, boundary):
    real_generate = radio_engine._generate_batch

    def generate_with_accidental_io(session, count, **kwargs):
        tracks = real_generate(session, count, **kwargs)
        if boundary == "database":
            from crate.db.tx import read_scope

            with read_scope():
                pass
        elif boundary == "redis":
            radio_engine._redis()
        else:
            radio_engine._save_session(session)
        return tracks

    monkeypatch.setattr(radio_engine, "_generate_batch", generate_with_accidental_io)

    with pytest.raises(AssertionError, match="database/Redis I/O"):
        generate_snapshot_batch(small_snapshot, session_id="baseline-a")


def test_overlap_compares_canonical_songs_separately_from_position():
    left = [
        {"track_id": 1, "artist": "Converge", "title": "Concubine"},
        {"track_id": 2, "artist": "Citizen", "title": "The Summer"},
    ]
    right = [
        {"track": {"id": "remote:2", "artist": "Citizen", "title": "The Summer"}},
        {"track_id": 501, "artist": "CONVERGE", "title": "Concubine (Live)"},
    ]

    assert overlap_metrics(left, right) == {
        "shared_song_count": 2,
        "identity_jaccard": 1.0,
        "same_position_count": 0,
        "same_position_ratio": 0.0,
    }
    assert overlap_metrics(left, left[:1]) == {
        "shared_song_count": 1,
        "identity_jaccard": 0.5,
        "same_position_count": 1,
        "same_position_ratio": 0.5,
    }
    assert overlap_metrics(left, [{"artist": "Other", "title": "Concubine"}]) == {
        "shared_song_count": 0,
        "identity_jaccard": 0.0,
        "same_position_count": 0,
        "same_position_ratio": 0.0,
    }


def test_overlap_rejects_missing_canonical_identity():
    with pytest.raises(ValueError, match="canonical artist/title"):
        overlap_metrics([{"track_id": 1}], [{"track_id": 1}])


def test_coherence_reports_metadata_coverage_and_artist_diversity(small_snapshot):
    small_snapshot["graphs"]["genres"] = {
        "high vis": {"offline-genre-a": 1.0},
        "home front": {"offline-genre-a": 0.5},
        "ditz": {"offline-genre-b": 1.0},
    }
    tracks = [
        {"artist": "Home Front"},
        {"artist": "Home Front"},
        {"artist": "Ditz"},
        {"artist": "Missing metadata"},
    ]

    metrics = coherence_metrics(small_snapshot, tracks)

    assert metrics["mean_seed_genre_overlap"] == pytest.approx(1 / 3)
    assert metrics["genre_metadata_track_count"] == 3
    assert metrics["genre_metadata_coverage"] == 0.75
    assert metrics["seed_genre_coverage"] == 1.0
    assert metrics["unique_artist_count"] == 3
    assert metrics["unique_artist_ratio"] == 0.75


def test_coherence_without_seed_metadata_is_unknown(small_snapshot):
    del small_snapshot["graphs"]["genres"]["high vis"]

    metrics = coherence_metrics(small_snapshot, [{"artist": "Home Front"}])

    assert metrics["mean_seed_genre_overlap"] is None
    assert metrics["genre_metadata_coverage"] == 1.0
    assert metrics["seed_genre_coverage"] == 0.0


def test_empty_batches_have_no_comparable_genre_or_position(small_snapshot):
    assert overlap_metrics([], [])["same_position_ratio"] == 0.0
    metrics = coherence_metrics(small_snapshot, [])
    assert metrics["mean_seed_genre_overlap"] is None
    assert metrics["genre_metadata_coverage"] == 0.0
    assert metrics["unique_artist_count"] == 0


@pytest.mark.parametrize("name", ["citizen", "concubine"])
def test_sanitized_baselines_are_reproducible_without_pinning_rankings(name):
    snapshot = json.loads((_FIXTURE_DIR / f"{name}.json").read_text())
    original = deepcopy(snapshot)

    report = evaluate_snapshot(snapshot)

    assert report == evaluate_snapshot(snapshot)
    assert snapshot == original
    assert report["candidate_count"] > snapshot["batch_size"]
    for session in report["sessions"]:
        assert len(session["tracks"]) == snapshot["batch_size"]
        assert (
            len({queue_engine.candidate_song_key(track) for track in session["tracks"]})
            == (snapshot["batch_size"])
        )
        assert 0.0 < session["coherence"]["genre_metadata_coverage"] <= 1.0


def test_report_cli_reproduces_results_across_processes_and_host_settings():
    command = [sys.executable, "-m", "tests.recommendation_evaluation"]
    app_dir = Path(__file__).resolve().parents[1]
    reports = []
    for hash_seed, time_zone in (("1", "UTC"), ("2", "Pacific/Honolulu")):
        output = subprocess.check_output(
            command,
            cwd=app_dir,
            env={**os.environ, "PYTHONHASHSEED": hash_seed, "TZ": time_zone},
            text=True,
        )
        reports.append(json.loads(output))

    assert reports[0] == reports[1]
    assert [report["name"] for report in reports[0]] == ["citizen", "concubine"]
    assert all(len(report["sessions"]) == 3 for report in reports[0])


def test_completed_listen_scenario_rotates_and_remains_reproducible(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    snapshot = json.loads((_FIXTURE_DIR / "citizen.json").read_text())
    report = evaluate_snapshot(snapshot, simulate_listens=True)
    assert report == evaluate_snapshot(snapshot, simulate_listens=True)
    assert report["listening_scenario"] == "completed batches between sessions"
    assert report["overlap"][0]["shared_song_count"] < snapshot["batch_size"]
