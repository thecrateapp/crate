from __future__ import annotations


def test_prepare_metrics_are_aggregate_only(monkeypatch):
    from crate.federation import playback_prepare

    recorded: list[tuple[str, float, dict[str, str]]] = []
    monkeypatch.setattr(
        playback_prepare,
        "record_later",
        lambda name, value, tags: recorded.append((name, value, tags)),
        raising=False,
    )

    playback_prepare.record_playback_prepare_request("balanced")
    for status in ("ready", "preparing", "unavailable", "rate_limited"):
        playback_prepare.record_playback_prepare_result(status, "balanced")
    playback_prepare.record_remote_playback_delivery(
        requested_policy="balanced",
        effective_policy="balanced",
        cache_hit=True,
        transcoded=True,
    )
    playback_prepare.record_remote_playback_delivery(
        requested_policy="data_saver",
        effective_policy="original",
        cache_hit=False,
        transcoded=False,
    )
    playback_prepare.record_remote_playback_delivery(
        requested_policy="original",
        effective_policy="original",
        cache_hit=False,
        transcoded=False,
    )

    assert [name for name, _value, _tags in recorded] == [
        "federation.playback.prepare.requested",
        "federation.playback.prepare.ready",
        "federation.playback.prepare.preparing",
        "federation.playback.prepare.unavailable",
        "federation.playback.prepare.rate_limited",
        "federation.playback.prepare.ready_before_play",
        "federation.playback.prepare.fallback_original",
    ]
    assert recorded[0][2] == {
        "origin": "remote",
        "requested_policy": "balanced",
        "effective_policy": "balanced",
    }
    assert recorded[-1][2] == {
        "origin": "remote",
        "requested_policy": "data_saver",
        "effective_policy": "original",
    }
    assert {tag for _name, _value, tags in recorded for tag in tags} == {
        "origin",
        "requested_policy",
        "effective_policy",
    }
