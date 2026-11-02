from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
OBSERVABILITY = ROOT / "deploy/observability"
RECORDED = re.compile(r"\bcrate:[a-z0-9_]+:[a-z0-9_]+\b")
FAMILY = re.compile(r"\bcrate_[a-z0-9_]+\b")
HISTOGRAM_SUFFIXES = ("_bucket", "_count", "_sum")


def _release():
    spec = importlib.util.spec_from_file_location(
        "_observability_packaging_release", ROOT / "scripts/observability_release.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rules():
    return yaml.safe_load((OBSERVABILITY / "recording-rules.yml").read_text())


def _recorded() -> set[str]:
    return {rule["record"] for group in _rules()["groups"] for rule in group["rules"]}


def _dashboards():
    return sorted((OBSERVABILITY / "grafana/dashboards").glob("app-*.json"))


def _expressions(path: Path) -> list[str]:
    panels = list(json.loads(path.read_text())["panels"])
    expressions = []
    while panels:
        panel = panels.pop()
        panels.extend(panel.get("panels", []))
        expressions.extend(target["expr"] for target in panel.get("targets", []))
    return expressions


def test_every_rule_and_dashboard_file_ships_in_the_monitoring_release():
    release = _release()
    bundled = set(release.BUNDLE_FILES)

    for name in ("recording-rules.yml", "prometheus.yml"):
        assert f"deploy/observability/{name}" in bundled
        assert release.MOUNTED_FILES[f"deploy/observability/{name}"] == (
            "crate-prometheus"
        )
    for path in (OBSERVABILITY / "grafana/dashboards").glob("*.json"):
        assert str(path.relative_to(ROOT)) in bundled, path.name
    assert "deploy/observability/recording-rules.test.yml" not in bundled


def test_application_dashboards_read_only_recorded_series_from_prometheus():
    recorded = _recorded()
    dashboards = _dashboards()
    assert {path.stem for path in dashboards} == {
        "app-overview",
        "app-playback",
        "app-workers",
        "app-telemetry",
    }
    used = set()
    for path in dashboards:
        dashboard = json.loads(path.read_text())
        assert dashboard["uid"] == f"crate-{path.stem}"
        assert dashboard["editable"] is False
        assert "shadow" in dashboard["tags"]
        for panel in dashboard["panels"]:
            assert panel["datasource"] == {
                "type": "prometheus",
                "uid": "crate-prometheus",
            }
            assert panel["fieldConfig"]["defaults"]["noValue"] == "No data"
            assert panel["description"], panel["title"]
        for expression in _expressions(path):
            assert "vector(0)" not in expression
            assert not FAMILY.search(expression), expression
            used |= set(RECORDED.findall(expression))
    assert used <= recorded, used - recorded


def test_every_recorded_series_has_a_reader_and_a_bounded_window():
    used = {
        name
        for path in _dashboards()
        for expression in _expressions(path)
        for name in RECORDED.findall(expression)
    }
    assert _recorded() <= used, _recorded() - used
    for group in _rules()["groups"]:
        assert group["interval"] in {"30s", "60s"}
        for rule in group["rules"]:
            assert "[" not in rule["expr"] or re.search(r"\[(2|5|15)m\]", rule["expr"])


def test_recording_rules_read_only_exported_families():
    from crate.observability.prometheus import EXPORTED_FAMILIES

    exported = {family.name for family in EXPORTED_FAMILIES.values()}
    counters = {
        family.name + "_total"
        for family in EXPORTED_FAMILIES.values()
        if family.kind == "counter"
    }
    histograms = {
        family.name + suffix
        for family in EXPORTED_FAMILIES.values()
        if family.kind == "histogram"
        for suffix in HISTOGRAM_SUFFIXES
    }
    known = exported | counters | histograms
    for group in _rules()["groups"]:
        for rule in group["rules"]:
            unknown = set(FAMILY.findall(rule["expr"])) - known
            assert not unknown, (rule["record"], unknown)


def test_rule_tests_cover_resets_missing_data_idle_traffic_and_lost_collectors():
    tests = yaml.safe_load((OBSERVABILITY / "recording-rules.test.yml").read_text())
    assert tests["rule_files"] == ["recording-rules.yml"]
    names = " ".join(case["name"] for case in tests["tests"])
    for scenario in ("reset", "no data", "idle traffic", "collector"):
        assert scenario in names, scenario


def test_check_script_runs_promtool_offline_and_ci_calls_it():
    script = (ROOT / "scripts/observability-check.sh").read_text()
    assert "--network none" in script
    assert "--read-only" in script
    for command in (
        "check config /etc/prometheus/prometheus.yml",
        "check rules /etc/prometheus/recording-rules.yml",
        "test rules /etc/prometheus/recording-rules.test.yml",
    ):
        assert f"promtool {command}" in script
    workflow = (ROOT / ".github/workflows/test-observability.yml").read_text()
    assert "scripts/observability-check.sh" in workflow
