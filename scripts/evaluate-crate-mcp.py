#!/usr/bin/env python3
"""Run the phase-7 bounded acceptance matrix, sequentially against test services."""

import argparse
import json
from pathlib import Path
import subprocess
import sys
from time import perf_counter
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
GROUPS = {
    "contract": [
        "tests/test_mcp_distribution.py",
        "tests/test_mcp_evaluation_runner.py",
        "tests/test_mcp_restart.py",
        "tests/test_mcp_limits.py",
    ],
    "workflows": [
        "tests/test_agent_actions_workflow.py",
        "tests/test_agent_library_operations.py::test_high_risk_or_global_plans_always_require_exact_human_approval",
        "tests/test_agent_metadata.py::test_track_apply_verifies_audio_and_projects_tags_locks_audit_and_outbox",
        "tests/test_agent_enrichment.py::test_provider_failure_is_recoverable_and_does_not_erase_successful_provider_results",
        "tests/test_agent_analysis_sync.py::TestExactAnalysisOperations::test_approved_requeue_is_pending_until_current_daemon_result_is_verified",
        "tests/test_agent_analysis_sync.py::TestExactSyncOperations::test_album_sync_preserves_identity_and_does_not_widen_scope",
        "tests/test_agent_metadata_portability.py::test_exported_sidecar_rehydrates_missing_metadata_without_importing_dsp_or_audio",
        "tests/test_mcp_operations.py::test_shared_plan_engine_recovers_scheduler_maintenance_after_human_approval",
        "tests/test_agent_runtime_policy.py::test_runtime_plan_records_exact_before_after_and_adoption_is_separate",
        "tests/test_mcp_editorial.py::test_remote_sdk_create_reviews_and_applies_exact_selection",
        "tests/test_mcp_oauth_integration.py::test_two_named_oauth_clients_complete_discovery_consent_mcp_refresh_revoke_over_tcp",
    ],
    "load": ["tests/test_mcp_distribution_load.py"],
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", choices=[*GROUPS, "all"], default="contract")
    parser.add_argument("--list", action="store_true")
    parser.add_argument(
        "--output-dir", type=Path, default=ROOT / ".artifacts/mcp-phase7"
    )
    args = parser.parse_args(argv)
    groups = GROUPS if args.group == "all" else {args.group: GROUPS[args.group]}
    if args.list:
        print(json.dumps(groups, indent=2))
        return 0
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"groups": {}, "complete_feature_suite": False}
    for name, selection in groups.items():
        junit = args.output_dir.resolve() / f"{name}.xml"
        started = perf_counter()
        command = [
            sys.executable,
            "-m",
            "pytest",
            *selection,
            "-q",
            "--tb=short",
            f"--junitxml={junit}",
        ]
        result = subprocess.run(
            command, cwd=ROOT / "app", capture_output=True, text=True
        )
        (args.output_dir / f"{name}.log").write_text(result.stdout + result.stderr)
        cases = ET.parse(junit).findall(".//testcase") if junit.exists() else []
        skipped = sum(case.find("skipped") is not None for case in cases)
        ok = result.returncode == 0 and bool(cases) and skipped == 0
        report["groups"][name] = {
            "passed": ok,
            "cases": len(cases),
            "skipped": skipped,
            "seconds": round(perf_counter() - started, 3),
            "selection": selection,
        }
        print(
            f"{name}: {'PASS' if ok else 'FAIL'} ({len(cases)} cases, {skipped} skipped)",
            flush=True,
        )
        if not ok:
            print(result.stdout[-6000:] + result.stderr[-1000:])
            break
    (args.output_dir / f"report-{args.group}.json").write_text(
        json.dumps(report, indent=2)
    )
    return (
        0
        if len(report["groups"]) == len(groups)
        and all(row["passed"] for row in report["groups"].values())
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
