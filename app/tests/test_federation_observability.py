from __future__ import annotations

from pathlib import Path
import re
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    ("local_node", "peers", "expected"),
    [
        (None, [], "unconfigured_singleton"),
        ({"capabilities_json": {"catalog.search": False}}, [], "disabled"),
        ({"capabilities_json": {"catalog.search": True}}, [], "healthy_singleton"),
        (
            {"capabilities_json": {"catalog.search": True}},
            [{"health_json": {"healthy": True}, "disabled_at": None}],
            "healthy",
        ),
        (
            {"capabilities_json": {"catalog.search": True}},
            [
                {"health_json": {"healthy": True}, "disabled_at": None},
                {"health_json": {"healthy": False}, "disabled_at": None},
            ],
            "degraded",
        ),
        (
            {"capabilities_json": {"catalog.search": True}},
            [{"health_json": {"healthy": False}, "disabled_at": None}],
            "unavailable",
        ),
    ],
)
def test_health_distinguishes_legitimate_singleton_and_peer_failure(
    monkeypatch, local_node, peers, expected
):
    from crate.federation import health

    monkeypatch.setattr(health.repo, "get_local_node", lambda: local_node)
    monkeypatch.setattr(health.repo, "list_peers", lambda **_kwargs: peers)

    assert health.federation_health_snapshot()["state"] == expected


def test_federation_metric_tags_reject_secrets_urls_and_unbounded_reasons():
    from crate.metrics import federation_metric_tags

    tags = federation_metric_tags(
        peer_uid="11111111-1111-4111-8111-111111111111",
        reason_code="signature_invalid",
    )
    assert tags == {
        "peer_uid": "11111111-1111-4111-8111-111111111111",
        "reason_code": "signature_invalid",
    }

    with pytest.raises(ValueError):
        federation_metric_tags(
            peer_uid="https://peer.example/?token=secret",
            reason_code="anything-from-upstream",
        )


def test_admin_health_returns_snapshot_for_unconfigured_node(monkeypatch):
    from crate.api import admin_federation

    monkeypatch.setattr(
        "crate.federation.health.federation_health_snapshot",
        lambda: {"state": "unconfigured_singleton", "ok": True},
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 1, "role": "admin", "permissions": ["federation.nodes.view"]}
        )
    )

    assert admin_federation.get_federation_health(request) == {
        "state": "unconfigured_singleton",
        "ok": True,
    }


def test_slo_document_defines_windows_alerts_and_runbooks():
    document = (ROOT / "docs/technical/federation-slos.md").read_text()
    for text in (
        "99.5%",
        "p95",
        "5 minutes",
        "Alert window",
        "Runbook",
        "cardinality",
    ):
        assert text in document


def test_slo_document_local_runbook_links_resolve():
    source = ROOT / "docs/technical/federation-slos.md"
    for target in re.findall(r"\[[^]]+]\(([^)]+)\)", source.read_text()):
        if "://" in target:
            continue
        relative_path, _, anchor = target.partition("#")
        destination = source.parent / relative_path
        assert destination.is_file(), target
        if anchor:
            headings = {
                re.sub(r"[^a-z0-9 -]", "", line.lstrip("# ").lower()).replace(" ", "-")
                for line in destination.read_text().splitlines()
                if line.startswith("#")
            }
            assert anchor in headings, target


def test_slo_and_runbook_cover_zero_downtime_catalog_reads():
    slos = (ROOT / "docs/technical/federation-slos.md").read_text()
    runbook = (ROOT / "docs/technical/federation-operations-runbook.md").read_text()

    for text in (
        "catalog.search.serving_mode",
        "local-fallback",
        "global-refreshing",
        "p95 at or below 300 ms",
    ):
        assert text in slos
    for text in (
        "Catalog warming or reconciliation failure",
        "X-Crate-Catalog-Mode",
        "make dev-catalog-search-capacity-test",
        "local reads remain available",
    ):
        assert text in runbook


def test_playback_prepare_runbook_documents_containment_and_slos():
    slos = (ROOT / "docs/technical/playback-slos.md").read_text()
    runbook = (ROOT / "docs/technical/federation-operations-runbook.md").read_text()
    gates = (ROOT / "docs/technical/playback-release-gates.md").read_text()

    for text in (
        "ready_before_play",
        "fallback_original",
        "prepare saturation",
        "federation.playback.prepare",
    ):
        assert text in slos
    for text in (
        "Playback preparation incident",
        "federation:playback-prepare:peer:",
        "federation:playback-prepare:global",
        "normal stream tickets remain available",
    ):
        assert text in runbook
    for text in (
        "two remote tracks",
        "four reservations per peer",
        "twenty reservations per owner",
        "fallback-original ratio",
    ):
        assert text in gates
