"""The finite evaluation must never count skipped database work as a pass."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace


def test_runner_rejects_successful_pytest_exit_when_database_cases_are_skipped(
    tmp_path, monkeypatch
):
    path = Path(__file__).resolve().parents[2] / "scripts/evaluate-crate-mcp.py"
    spec = importlib.util.spec_from_file_location("crate_mcp_evaluation_runner", path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)

    def skipped(command, **_kwargs):
        junit = Path(
            next(
                arg.split("=", 1)[1] for arg in command if arg.startswith("--junitxml=")
            )
        )
        junit.write_text(
            '<testsuites><testsuite><testcase name="database"><skipped/></testcase></testsuite></testsuites>'
        )
        assert command[3:] != []
        assert "tests/test_mcp_distribution.py" in command
        return SimpleNamespace(returncode=0, stdout="1 skipped", stderr="")

    monkeypatch.setattr(runner.subprocess, "run", skipped)
    assert runner.main(["--group", "contract", "--output-dir", str(tmp_path)]) == 1
    report = json.loads((tmp_path / "report-contract.json").read_text())
    assert report["groups"]["contract"]["passed"] is False
    assert report["groups"]["contract"]["skipped"] == 1
