import heapq
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/test-backend.yml"
TEST_REQUIREMENTS = ROOT / "app/requirements-test.txt"
DURATIONS = ROOT / "app/tests/.test_durations"


def test_backend_ci_runs_eight_balanced_database_shards() -> None:
    workflow = WORKFLOW.read_text()

    assert "cancel-in-progress: true" in workflow
    assert "shard: [1, 2, 3, 4, 5, 6, 7, 8]" in workflow
    assert "--splits 8" in workflow
    assert "--group ${{ matrix.shard }}" in workflow
    assert "--splitting-algorithm least_duration" in workflow
    assert (
        "--durations-path=${{ github.workspace }}/app/tests/.test_durations" in workflow
    )
    assert "timeout-minutes: 20" in workflow


def test_backend_ci_combines_raw_coverage_before_enforcing_threshold() -> None:
    workflow = WORKFLOW.read_text()

    assert "COVERAGE_FILE: .coverage.${{ matrix.shard }}" in workflow
    assert "python-coverage-${{ matrix.shard }}" in workflow
    assert "path: app/.coverage.${{ matrix.shard }}" in workflow
    assert "include-hidden-files: true" in workflow
    assert "actions/download-artifact@v4" in workflow
    assert "python -m coverage combine coverage-data" in workflow
    assert "python -m coverage report --fail-under=50" in workflow
    assert workflow.count("--fail-under=50") == 1
    assert workflow.count("codecov/codecov-action@v5") == 1


def test_backend_ci_keeps_quality_checks_outside_database_shards() -> None:
    workflow = WORKFLOW.read_text()

    assert "quality:" in workflow
    assert "pyright==1.1.411" in workflow
    assert "ruff==0.15.22" in workflow
    assert "python -m pyright" in workflow
    assert "python -m ruff check crate tests" in workflow
    assert "python -m ruff format --check crate tests" in workflow


def test_backend_ci_has_duration_aware_test_dependency_and_baseline() -> None:
    requirements = TEST_REQUIREMENTS.read_text()
    durations = json.loads(DURATIONS.read_text())

    assert "pytest-split" in requirements
    assert len(durations) >= 3_000
    assert all(node_id.startswith("tests/") for node_id in durations)


def test_backend_ci_duration_baseline_balances_eight_shards() -> None:
    durations = json.loads(DURATIONS.read_text())
    groups = [(0.0, index) for index in range(8)]
    heapq.heapify(groups)

    for _node_id, duration in sorted(
        durations.items(), key=lambda item: (-item[1], item[0])
    ):
        total, index = heapq.heappop(groups)
        heapq.heappush(groups, (total + duration, index))

    totals = [total for total, _index in groups]
    assert max(totals) / min(totals) <= 1.05
