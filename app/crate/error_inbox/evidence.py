"""Sentry evidence for an investigation: events per release and tag distribution.

Design §7.1: an investigation reads what the triage reads plus how the issue's
events spread over releases and over the allowlisted tags. Sentry keeps those
counts, so the investigation task asks for them once, right before the model call,
and stores nothing.

Only documented, organization-scoped calls are made (Retrieve Tag Details, one per
key): `release` first, then the allowlisted tags the digest carries. Values go
through the digest's scrubbing. The reads stop at the first Sentry error or after
`EVIDENCE_BUDGET_SECONDS`, and the investigation still runs on the digest alone
when Sentry is not configured or unreachable. Issue titles, culprits and
permalinks are never read here.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from crate.error_inbox.config import (
    ErrorTrackingConfig,
    ErrorTrackingConfigError,
    load_config,
    load_sentry_token,
)
from crate.error_inbox.digest import TAG_ALLOWLIST, sanitize_text
from crate.error_inbox.sentry_client import (
    SentryAPIError,
    SentryClient,
    SentryNotFoundError,
)

EVIDENCE_BUDGET_SECONDS = 20.0
EVIDENCE_TIMEOUT_SECONDS = 5.0
MAX_RELEASES = 10
MAX_VALUES_PER_TAG = 5
MAX_VALUE_LENGTH = 100

ClientFactory = Callable[[ErrorTrackingConfig, str], SentryClient]


@dataclass
class Evidence:
    """`data` goes to the prompt; `status` and `error_code` to the task result."""

    status: str = "skipped"
    error_code: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        keys = ["release"] if "events_by_release" in self.data else []
        keys.extend(self.data.get("tag_distribution") or {})
        return {"status": self.status, "error_code": self.error_code, "keys": keys}


def evidence_keys(digest: Mapping[str, Any]) -> list[str]:
    """`release`, then the allowlisted tags present on the latest event."""
    tags = digest.get("tags")
    present = tags if isinstance(tags, Mapping) else {}
    return ["release"] + [
        key for key in TAG_ALLOWLIST if key != "release" and key in present
    ]


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def _releases(detail: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "release": sanitize_text(item["value"], MAX_VALUE_LENGTH),
            "events": item["count"],
            "first_seen": _iso(item.get("first_seen")),
            "last_seen": _iso(item.get("last_seen")),
        }
        for item in detail["top"][:MAX_RELEASES]
    ]


def _distribution(detail: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "events": detail.get("total"),
        "distinct_values": detail.get("unique"),
        "top": [
            {
                "value": sanitize_text(item["value"], MAX_VALUE_LENGTH),
                "events": item["count"],
            }
            for item in detail["top"][:MAX_VALUES_PER_TAG]
        ],
    }


def collect_evidence(
    client: SentryClient,
    external_id: str,
    digest: Mapping[str, Any],
    *,
    clock: Callable[[], float] = time.monotonic,
    budget: float = EVIDENCE_BUDGET_SECONDS,
) -> Evidence:
    deadline = clock() + budget
    evidence = Evidence(status="complete")
    distribution: dict[str, Any] = {}
    for key in evidence_keys(digest):
        if clock() >= deadline:
            evidence.status = "partial"
            evidence.error_code = "EVIDENCE_BUDGET_EXHAUSTED"
            break
        try:
            detail = client.tag_values(external_id, key)
        except SentryNotFoundError:
            continue
        except SentryAPIError as error:
            evidence.status = "partial"
            evidence.error_code = error.code
            break
        if key == "release":
            evidence.data["events_by_release"] = _releases(detail)
        else:
            distribution[key] = _distribution(detail)
    if distribution:
        evidence.data["tag_distribution"] = distribution
    if evidence.status == "partial" and not evidence.data:
        evidence.status = "unavailable"
    return evidence


def fetch_evidence(
    external_id: str,
    digest: Mapping[str, Any],
    *,
    client_factory: ClientFactory | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> Evidence:
    """Read the evidence with the stored Sentry connection; never raises for Sentry."""
    try:
        config = load_config()
        if config is None:
            return Evidence(
                status="skipped", error_code="ERROR_TRACKING_NOT_CONFIGURED"
            )
        token = load_sentry_token(config)
    except ErrorTrackingConfigError as error:
        return Evidence(status="unavailable", error_code=error.code)
    factory = client_factory or (
        lambda config, token: SentryClient(
            config, token, timeout=EVIDENCE_TIMEOUT_SECONDS
        )
    )
    try:
        with factory(config, token) as client:
            return collect_evidence(client, external_id, digest, clock=clock)
    except SentryAPIError as error:
        return Evidence(status="unavailable", error_code=error.code)


__all__ = [
    "EVIDENCE_BUDGET_SECONDS",
    "EVIDENCE_TIMEOUT_SECONDS",
    "Evidence",
    "collect_evidence",
    "evidence_keys",
    "fetch_evidence",
]
