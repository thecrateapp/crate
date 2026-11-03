import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def reference():
    spec = importlib.util.spec_from_file_location(
        "metric_reference", ROOT / "scripts/metric_reference.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_metrics_reference_page_is_current(reference):
    assert reference.OUTPUT.read_text() == reference.render(), (
        "Regenerate it with: python3 scripts/metric_reference.py"
    )


def test_every_catalogue_metric_belongs_to_one_described_family(reference):
    from crate.observability.metric_catalog import METRIC_CATALOG

    families = {prefix for prefix, _title, _body in reference.FAMILIES}
    used = {reference.family_for(name)[0] for name in METRIC_CATALOG}

    assert used == families


def test_surfaces_come_from_the_code_that_reads_them(reference):
    shown = reference.surfaces()

    assert "Stack map" in shown["api.request.client"]
    assert "System Health" in shown["playback.intent.count"]
    assert "System Health" in shown["api.request.latency"]
