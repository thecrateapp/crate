from __future__ import annotations

from evaluate_tempo import sample_tracks, summarize, tempo_matches


def _result(bpm, *, stability=0.9, confidence=0.9, downbeat=1000, quality="full"):
    return {
        "ok": True,
        "bpm": bpm,
        "bpm_confidence": confidence,
        "tempo_stability": stability,
        "downbeat_anchor_ms": downbeat,
        "quality": quality,
        "seconds": 1.0,
    }


def test_tempo_match_tolerates_four_percent_and_octaves_only_when_asked() -> None:
    assert tempo_matches(124.0, 120.0, octaves=False)
    assert not tempo_matches(126.0, 120.0, octaves=False)
    assert not tempo_matches(240.0, 120.0, octaves=False)
    assert tempo_matches(240.0, 120.0, octaves=True)
    assert tempo_matches(60.0, 120.0, octaves=True)
    assert tempo_matches(360.0, 120.0, octaves=True)
    assert not tempo_matches(None, 120.0, octaves=True)


def test_sample_caps_tracks_per_artist_and_is_reproducible() -> None:
    candidates = [
        {"path": f"/music/{artist}/{index}.flac", "artist": artist}
        for artist in ("A", "a", "B")
        for index in range(5)
    ]

    first = sample_tracks(candidates, size=10, per_artist=2, seed=7)
    second = sample_tracks(candidates, size=10, per_artist=2, seed=7)

    assert first == second
    assert len(first) == 4
    assert sum(1 for item in first if item["artist"].casefold() == "a") == 2


def test_summary_counts_failures_and_rates_per_analyzer() -> None:
    rows = [
        {"reference_bpm": 120.0, "rust": _result(121.0)},
        {"reference_bpm": 100.0, "rust": _result(200.0, stability=0.1, downbeat=None)},
        {"reference_bpm": 90.0, "rust": {"ok": False, "error": "decode"}},
    ]

    summary = summarize(rows, "rust")

    assert summary["tracks"] == 2
    assert summary["failed"] == 1
    assert summary["acc1"] == 0.5
    assert summary["acc2"] == 1.0
    assert summary["stable_share"] == 0.5
    assert summary["downbeat_share"] == 0.5
