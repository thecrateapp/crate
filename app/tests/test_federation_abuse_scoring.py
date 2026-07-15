from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _observation(kind: str, *, count: int = 1, age_seconds: int = 0) -> dict:
    return {
        "observation_type": kind,
        "severity": "medium",
        "count": count,
        "last_seen_at": NOW - timedelta(seconds=age_seconds),
    }


def test_abuse_score_is_deterministic_explainable_and_capped():
    from crate.federation.abuse import RISK_ALGORITHM_VERSION, score_observations

    result = score_observations(
        [
            _observation("invalid_signature", count=2),
            _observation("nonce_replay"),
            _observation("quota_denial", count=20),
        ],
        now=NOW,
    )

    assert result.algorithm_version == RISK_ALGORITHM_VERSION
    assert result.score == 100
    assert [item["type"] for item in result.inputs] == [
        "invalid_signature",
        "nonce_replay",
        "quota_denial",
    ]


def test_abuse_score_decays_with_time():
    from crate.federation.abuse import score_observations

    recent = score_observations([_observation("invalid_signature")], now=NOW)
    old = score_observations(
        [_observation("invalid_signature", age_seconds=3600)], now=NOW
    )

    assert old.score == pytest.approx(recent.score / 2, abs=0.01)


def test_unknown_signal_has_no_score_and_does_not_raise():
    from crate.federation.abuse import score_observations

    result = score_observations([_observation("new_unknown_signal")], now=NOW)

    assert result.score == 0
    assert result.inputs == []


@pytest.mark.parametrize(
    ("score", "expected"),
    [(49.99, None), (50, "throttle"), (79.99, "throttle"), (80, "deny")],
)
def test_temporary_action_recommendation_has_bounded_ttl(score, expected):
    from crate.federation.abuse import recommended_action

    action = recommended_action(score, capability="federation.stream.play")

    assert (action.action_type if action else None) == expected
    if action:
        assert 60 <= action.ttl_seconds <= 3600


def test_default_evaluation_is_observe_only(monkeypatch):
    import crate.federation.abuse as abuse

    monkeypatch.setattr(
        abuse.risk_repo,
        "list_recent_observations",
        lambda **_kwargs: [_observation("nonce_replay", count=10)],
    )
    monkeypatch.setattr(abuse.risk_repo, "save_snapshot", lambda **kwargs: kwargs)
    created: list[dict] = []
    monkeypatch.setattr(
        abuse.risk_repo,
        "create_temporary_action",
        lambda **kwargs: created.append(kwargs),
    )

    result = abuse.evaluate_peer_risk(
        "11111111-1111-4111-8111-111111111111",
        now=NOW,
    )

    assert result.score == 100
    assert created == []
