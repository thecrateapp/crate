import re
from pathlib import Path
from typing import get_args

import pytest
from crate.api.schemas.smart_mix import (
    CompatibleTracksResponse,
    TransitionPlanBatchRequest,
    TransitionPlanBatchResponse,
    TransitionPlanResponse,
)
from crate.smart_mix import versions
from crate.smart_mix.policy import PLANNER_POLICY

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
VERSION_LITERAL_OWNERS = {
    APP_ROOT / "crate/smart_mix/policy.py",
    APP_ROOT / "crate/smart_mix/versions.py",
    APP_ROOT / "crate/api/schemas/smart_mix.py",
    APP_ROOT / "crate/api/smart_mix.py",
}


def _literal_values(model, field_name: str) -> tuple:
    return get_args(model.model_fields[field_name].annotation)


def test_planner_wire_literals_match_the_planner_identity() -> None:
    assert _literal_values(TransitionPlanBatchRequest, "planner_version") == (
        versions.PLANNER_IDENTIFIER,
    )
    assert _literal_values(TransitionPlanBatchResponse, "planner_version") == (
        versions.PLANNER_IDENTIFIER,
    )
    assert _literal_values(CompatibleTracksResponse, "planner_version") == (
        versions.PLANNER_IDENTIFIER,
    )
    assert _literal_values(TransitionPlanResponse, "planner_version") == (
        versions.PLANNER_POLICY_VERSION,
    )


def test_version_strings_are_not_duplicated_outside_their_owners() -> None:
    pattern = re.compile(r"[\"']smart-mix-(?:audio-)?v\d+[\"']")
    offenders = [
        str(path.relative_to(APP_ROOT))
        for path in (APP_ROOT / "crate").rglob("*.py")
        if path not in VERSION_LITERAL_OWNERS
        and "migrations" not in path.parts
        and pattern.search(path.read_text())
    ]

    assert offenders == []


def test_rust_analyzer_version_matches_python() -> None:
    source = (REPO_ROOT / "tools/crate-cli/src/mix_profile.rs").read_text()
    match = re.search(r'pub const ANALYZER_VERSION: &str = "([^"]+)";', source)

    assert match is not None
    assert match.group(1) == versions.ANALYZER_VERSION
    assert source.count(f'"{versions.ANALYZER_VERSION}"') == 1


def test_rust_beat_grid_format_matches_python() -> None:
    source = (REPO_ROOT / "tools/crate-cli/src/mix_profile.rs").read_text()

    assert f'pub const FORMAT_NAME: &str = "{versions.BEAT_GRID_FORMAT}";' in source


@pytest.mark.parametrize(
    "identifier",
    [
        "API_CONTRACT_VERSION",
        "PROFILE_SCHEMA_VERSION",
        "ANALYZER_VERSION",
        "MEASUREMENT_VERSION",
        "BEAT_GRID_FORMAT",
        "PLANNER_IDENTIFIER",
        "PLANNER_POLICY_VERSION",
        "PLANNER_POLICY.rules_revision",
    ],
)
def test_operator_reference_versions_match_implemented_contract(identifier):
    document = (REPO_ROOT / "docs/technical/smart-mix-operations.md").read_text()
    rows = {}
    for line in document.splitlines():
        if line.startswith("|"):
            cells = [cell.strip().strip("`") for cell in line.split("|")[1:-1]]
            if len(cells) >= 2:
                rows[cells[0]] = cells[1]
    expected = (
        PLANNER_POLICY.rules_revision
        if identifier == "PLANNER_POLICY.rules_revision"
        else getattr(versions, identifier)
    )
    assert rows[identifier] == str(expected)
