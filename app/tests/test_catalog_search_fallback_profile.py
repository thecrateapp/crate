from tests.load.catalog_search_fallback_profile import (
    evaluate_gate,
    payload_is_valid,
    percentile,
)
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_catalog_search_profile_percentile_uses_nearest_rank():
    assert percentile([1.0, 2.0, 3.0, 4.0, 100.0], 0.95) == 100.0


def test_catalog_search_profile_gate_enforces_latency_and_errors():
    passing = {
        "p95_ms": 299.0,
        "p99_ms": 799.0,
        "errors": [],
        "invalid_payloads": 0,
    }

    assert evaluate_gate(passing) == []

    failing = {
        "p95_ms": 301.0,
        "p99_ms": 800.0,
        "errors": ["timeout"],
        "invalid_payloads": 1,
    }
    assert evaluate_gate(failing) == [
        "search fallback p95 exceeds 300 ms",
        "search fallback p99 is not below 800 ms",
        "search fallback returned errors",
        "search fallback returned invalid payloads",
    ]


def test_catalog_search_profile_validates_the_search_contract():
    assert payload_is_valid({"artists": [], "albums": [], "tracks": []}) is True
    assert payload_is_valid({"artists": [], "albums": []}) is False
    assert payload_is_valid({"artists": {}, "albums": [], "tracks": []}) is False


def test_catalog_search_capacity_gate_is_exposed_and_documented():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    documentation = (ROOT / "docs/technical/federation-capacity.md").read_text(
        encoding="utf-8"
    )

    assert "dev-catalog-search-capacity-test:" in makefile
    assert "--enforce-slo" in makefile
    assert "p95" in documentation
    assert "300 ms" in documentation
    assert "100K" in documentation
