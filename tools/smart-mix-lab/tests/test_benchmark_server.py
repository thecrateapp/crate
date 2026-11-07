from __future__ import annotations

import pytest

from benchmark_server import (
    UnsafeDatabaseError,
    check_isolated_dsn,
    measure,
    percentile,
    summarize,
)


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://crate:crate@crate-postgres:5432/crate",
        "postgresql://crate:crate@localhost:5432/crate",
        "postgresql://crate:crate@95.216.3.27:5432/crate_test",
        "mysql://crate@localhost/crate_test",
    ],
)
def test_production_looking_databases_are_refused(dsn: str) -> None:
    with pytest.raises(UnsafeDatabaseError):
        check_isolated_dsn(dsn)


def test_loopback_test_database_is_accepted() -> None:
    env = check_isolated_dsn("postgresql://crate:secret@127.0.0.1:55432/crate_test")

    assert env == {
        "CRATE_POSTGRES_USER": "crate",
        "CRATE_POSTGRES_PASSWORD": "secret",
        "CRATE_POSTGRES_HOST": "127.0.0.1",
        "CRATE_POSTGRES_PORT": "55432",
        "CRATE_POSTGRES_DB": "crate_test",
    }


def test_explicit_override_allows_another_isolated_host() -> None:
    env = check_isolated_dsn(
        "postgresql://crate:crate@bench-db:5432/crate", allow_non_test=True
    )

    assert env["CRATE_POSTGRES_HOST"] == "bench-db"


def test_percentiles_use_nearest_rank() -> None:
    samples = [float(value) for value in range(1, 101)]

    assert percentile(samples, 0.5) == 51.0
    assert percentile(samples, 0.95) == 95.0
    assert summarize(samples)["samples"] == 100


def test_measure_runs_warmup_outside_the_samples() -> None:
    calls: list[int] = []

    samples = measure(calls.append, warmup=3, iterations=5, concurrency=2)

    assert len(samples) == 5
    assert sorted(calls) == list(range(8))


def test_structured_fixture_profiles_are_valid_v7_profiles() -> None:
    from datetime import UTC, datetime

    from benchmark_server import structure_values
    from crate.smart_mix.models import (
        VOCAL_THRESHOLD,
        MixProfileQuality,
        TrackMixProfile,
        mix_profile_draft_from_payload,
    )

    for track_id, duration_ms, bpm in ((1, 300_000, 81.0), (77, 151_000, 169.0)):
        values = structure_values(track_id, duration_ms, bpm)
        draft = mix_profile_draft_from_payload(
            {
                "duration_ms": duration_ms,
                "bpm": bpm,
                "vocal_detector": "yamnet-2",
                **values,
            }
        )
        profile = TrackMixProfile(
            track_entity_uid="lab",
            profile_version=1,
            profile_revision="lab",
            analyzer="crate-rust",
            analyzer_version="smart-mix-audio-v7",
            source_revision="lab",
            duration_ms=duration_ms,
            quality=MixProfileQuality.FULL,
            analyzed_at=datetime(2026, 11, 6, tzinfo=UTC),
            bpm=bpm,
            phrases=draft.phrases,
            energy_curve=draft.energy_curve,
            vocal_presence=draft.vocal_presence,
            vocal_detector="yamnet-2",
            structure_confidence=draft.structure_confidence,
        )

        phrases = profile.phrases or ()
        assert len(phrases) >= 5
        assert phrases[0].kind == "intro" and phrases[-1].kind == "outro"
        assert phrases[-1].start_ms + 32 * 60_000 / bpm <= duration_ms - 16_000
        voices = profile.vocal_presence or b""
        assert any(value >= VOCAL_THRESHOLD for value in voices)
        assert any(value < VOCAL_THRESHOLD for value in voices)


def test_dj_context_asks_for_the_whole_v3_menu() -> None:
    from benchmark_server import _edges, parse_args

    [edge] = _edges(["a", "b"], start=0, count=1, context="dj")
    args = parse_args(
        [
            "--dsn",
            "postgresql://crate:crate@localhost/crate_test",
            "--output",
            "out.json",
            "--planner",
            "smart-mix-v3",
            "--context",
            "dj",
            "--edge-order",
            "sequential",
        ]
    )

    assert edge["context"]["allowLongBeatmatch"] is True
    assert edge["context"]["allowBassHandoff"] is True
    assert (
        _edges(["a", "b"], start=0, count=1)[0]["context"].get("allowLongBeatmatch")
        is None
    )
    assert (args.planner, args.context, args.edge_order) == (
        "smart-mix-v3",
        "dj",
        "sequential",
    )
