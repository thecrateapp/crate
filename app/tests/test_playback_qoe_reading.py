from crate.observability.playback_qoe import (
    MINIMUM_ATTEMPTS,
    SUMMARY_SPECS,
    derive_playback_qoe,
)


def _entry(total: float = 0, availability: str = "available", avg: float | None = None):
    count = 1 if total else 0
    return {
        "availability": availability,
        "count": count,
        "sum": total,
        "avg": avg if avg is not None else total,
    }


def _summary(**totals):
    summary = {key: _entry() for key in SUMMARY_SPECS}
    summary.update(
        playback_stall_ms=_entry(),
        playback_stalls=_entry(),
        playback_recoveries=_entry(),
        playback_startup_ms=_entry(),
    )
    for key, value in totals.items():
        summary[key] = value if isinstance(value, dict) else _entry(value)
    return summary


def test_a_full_window_yields_success_and_stall_ratios():
    reading = derive_playback_qoe(
        _summary(
            playback_intents=40,
            playback_started=38,
            playback_failed=2,
            playback_cancelled=3,
            playback_active_ms=990_000,
            playback_stall_ms=10_000,
            playback_payload_v2=6,
            playback_startup_ms=_entry(1, avg=420.0),
        )
    )

    assert reading["availability"] == "available"
    assert reading["attempts"] == 40
    assert reading["start_success_ratio"] == 0.95
    assert reading["stall_ratio"] == 0.01
    assert reading["startup_avg_ms"] == 420.0
    assert reading["caveats"] == []


def test_cancelled_attempts_are_not_failures():
    reading = derive_playback_qoe(
        _summary(
            playback_started=20,
            playback_failed=0,
            playback_cancelled=15,
            playback_payload_v2=3,
        )
    )

    assert reading["attempts"] == 20
    assert reading["start_success_ratio"] == 1.0


def test_a_small_window_reports_an_insufficient_sample():
    reading = derive_playback_qoe(
        _summary(playback_started=MINIMUM_ATTEMPTS - 1, playback_payload_v2=1)
    )

    assert reading["availability"] == "insufficient_sample"
    assert reading["start_success_ratio"] == 1.0


def test_losses_legacy_clients_and_unverified_events_make_it_partial():
    reading = derive_playback_qoe(
        _summary(
            playback_started=30,
            playback_payload_v2=4,
            playback_payload_v1=2,
            playback_client_loss=5,
            playback_telemetry_unverified=1,
        )
    )

    assert reading["availability"] == "partial"
    assert reading["caveats"] == [
        "legacy_clients",
        "client_losses",
        "unverified_events",
    ]


def test_missing_sources_and_absent_clients_are_not_zero():
    unavailable = derive_playback_qoe(
        _summary(playback_started={"availability": "unavailable"})
    )
    empty = derive_playback_qoe(_summary())
    stale = derive_playback_qoe(
        _summary(
            playback_started=30,
            playback_payload_v2=2,
            playback_intents=_entry(30, availability="stale"),
        )
    )

    assert unavailable["availability"] == "unavailable"
    assert unavailable["start_success_ratio"] is None
    assert empty["availability"] == "empty"
    assert empty["stall_ratio"] is None
    assert stale["availability"] == "stale"
