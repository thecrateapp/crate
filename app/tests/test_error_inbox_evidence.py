"""Sentry evidence for an investigation: which calls, in which order, within budget.

The client talks to a fake Sentry behind `httpx.MockTransport`; nothing reaches the
network and no database is needed.
"""

from __future__ import annotations

import httpx

from crate.error_inbox.config import parse_config
from crate.error_inbox.evidence import collect_evidence, evidence_keys
from crate.error_inbox.sentry_client import SentryClient
from tests.error_inbox_fakes import ORGANIZATION, FakeSentry, tag_detail

CONFIG = parse_config({"organization": ORGANIZATION, "environments": ["production"]})
DIGEST = {
    "tags": {
        "service": "api",
        "runtime": "CPython 3.13",
        "release": "crate-b",
        "unlisted": "never read",
    }
}


def _client(fake: FakeSentry) -> SentryClient:
    return SentryClient(CONFIG, "sntrys_token", transport=httpx.MockTransport(fake))


def test_reads_release_then_the_allowlisted_tags_of_the_digest():
    assert evidence_keys(DIGEST) == ["release", "service", "runtime"]
    assert evidence_keys({}) == ["release"]

    fake = FakeSentry()
    fake.tags["7"] = {
        "release": tag_detail("release", ("crate-b", 30), ("crate-a", 2)),
        "service": tag_detail("service", ("api", 31), ("worker", 1)),
        # A value with a library path and an address: scrubbed like the digest.
        "runtime": tag_detail("runtime", ("/music/Artist/a.flac from 10.0.0.4", 3)),
    }

    evidence = collect_evidence(_client(fake), "7", DIGEST)

    assert fake.tag_keys() == ["release", "service", "runtime"]
    assert evidence.summary() == {
        "status": "complete",
        "error_code": None,
        "keys": ["release", "service", "runtime"],
    }
    assert evidence.data["events_by_release"] == [
        {
            "release": "crate-b",
            "events": 30,
            "first_seen": "2026-11-01T10:00:00+00:00",
            "last_seen": "2026-11-04T08:00:00+00:00",
        },
        {
            "release": "crate-a",
            "events": 2,
            "first_seen": "2026-11-01T10:00:00+00:00",
            "last_seen": "2026-11-04T08:00:00+00:00",
        },
    ]
    assert evidence.data["tag_distribution"]["service"] == {
        "events": 32,
        "distinct_values": 2,
        "top": [{"value": "api", "events": 31}, {"value": "worker", "events": 1}],
    }
    [runtime] = evidence.data["tag_distribution"]["runtime"]["top"]
    assert runtime["value"] == "/music/<path>"


def test_a_missing_tag_is_skipped_and_an_error_stops_the_reads():
    fake = FakeSentry()
    fake.tags["7"] = {"release": tag_detail("release", ("crate-b", 3))}
    fake.fail = lambda request: (
        httpx.Response(429) if request.url.path.endswith("/runtime/") else None
    )

    evidence = collect_evidence(_client(fake), "7", DIGEST)

    # `service` answered 404 and was skipped; the rate limit stopped the reads.
    assert fake.tag_keys() == ["release", "service", "runtime"]
    assert evidence.status == "partial"
    assert evidence.error_code == "SENTRY_RATE_LIMITED"
    assert evidence.summary()["keys"] == ["release"]

    down = FakeSentry()
    down.fail = lambda request: httpx.Response(503)
    nothing = collect_evidence(_client(down), "7", DIGEST)
    assert (nothing.status, nothing.error_code, nothing.data) == (
        "unavailable",
        "SENTRY_SERVER",
        {},
    )
    assert down.tag_keys() == ["release"]


def test_reads_stop_when_the_budget_is_spent():
    fake = FakeSentry()
    fake.tags["7"] = {"release": tag_detail("release", ("crate-b", 3))}
    ticks = iter([0.0, 0.0, 25.0])

    evidence = collect_evidence(
        _client(fake), "7", DIGEST, clock=lambda: next(ticks), budget=20.0
    )

    assert fake.tag_keys() == ["release"]
    assert (evidence.status, evidence.error_code) == (
        "partial",
        "EVIDENCE_BUDGET_EXHAUSTED",
    )
    assert "events_by_release" in evidence.data
