"""Deterministic Crate priority for error inbox issues (design §5)."""

from __future__ import annotations

import pytest

from crate.error_inbox.priority import CRITICAL_SCORE, crate_score, is_critical


def _issue(**overrides):
    issue = {
        "level": "error",
        "substatus": "ongoing",
        "service": "api",
        "users_24h": 0,
        "events_24h": 0,
        "sentry_priority": None,
    }
    issue.update(overrides)
    return issue


@pytest.mark.parametrize(
    ("issue", "expected"),
    [
        (_issue(level="fatal", substatus="escalating", service="readplane"), 80),
        (_issue(level="warning", service="crate-docs"), 5),
        (_issue(substatus="new", service="worker-playback"), 55),
        (_issue(substatus="regressed", service="worker-maintenance"), 55),
        (_issue(substatus="new", service="projector"), 50),
        (_issue(service="crate-listen"), 40),
        (_issue(service="crate-media-worker"), 35),
        (_issue(level="info", service="crate-admin", sentry_priority="high"), 20),
        (
            _issue(
                level="info", service="crate-cast-receiver", sentry_priority="medium"
            ),
            10,
        ),
        (_issue(level="debug", service="some-new-runtime"), 0),
    ],
)
def test_score_table(issue, expected):
    assert crate_score(issue) == expected


def test_fatal_escalating_streaming_is_critical():
    issue = _issue(level="fatal", substatus="escalating", service="readplane")

    assert crate_score(issue) >= CRITICAL_SCORE
    assert is_critical(issue)


def test_warning_docs_is_low():
    issue = _issue(level="warning", service="crate-docs", events_24h=3)

    assert crate_score(issue) == 11
    assert not is_critical(issue)


def test_users_weight_is_logarithmic():
    scores = [crate_score(_issue(users_24h=users)) for users in (0, 1, 3, 7, 15)]

    assert scores == [40, 46, 52, 58, 64]


def test_events_weight_is_logarithmic():
    scores = [crate_score(_issue(events_24h=events)) for events in (0, 1, 3, 7)]

    assert scores == [40, 43, 46, 49]


def test_missing_counts_and_unknown_values_score_zero():
    assert crate_score({"level": "error"}) == 25
    assert crate_score({"level": "error", "substatus": "archived_forever"}) == 25
    assert crate_score({"level": "error", "users_24h": None, "events_24h": None}) == 25


def test_triage_critical_overrides_score():
    issue = _issue(level="warning", service="crate-admin")

    assert crate_score(issue) < CRITICAL_SCORE
    assert not is_critical(issue)
    assert is_critical(issue, {"severity": "critical", "confidence": 0.6})
    assert not is_critical(issue, {"severity": "critical", "confidence": 0.59})
    assert not is_critical(issue, {"severity": "high", "confidence": 0.99})
