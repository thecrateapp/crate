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


def test_worker_binary_is_built_from_the_current_analyzer() -> None:
    # app/Dockerfile copies this committed binary into the x86_64 worker images
    # instead of building tools/crate-cli. A stale binary keeps writing profiles of
    # the previous analyzer, which the store keeps as "unchanged".
    binary = (APP_ROOT / "bin/crate-cli-linux-amd64").read_bytes()
    embedded = {
        match.group().decode()
        for match in re.finditer(rb"smart-mix-audio-v\d+", binary)
    }

    assert embedded == {versions.ANALYZER_VERSION}, (
        "rebuild app/bin/crate-cli-linux-amd64 with `make crate-cli-linux`"
    )


def test_worker_binary_takes_model_beats() -> None:
    # The profile task hands Beat This! beats (SM3-D14) only to a crate-cli whose
    # analyze takes --beats; the same analyzer version built without it would keep
    # its own tracker in every x86_64 worker image. One that takes the beats but not
    # the DBN's bar length (SM3-D16) would phrase 3/4 tracks in bars of four.
    binary = (APP_ROOT / "bin/crate-cli-linux-amd64").read_bytes()

    assert b"downbeats_ms" in binary and b"beatTracker" in binary, (
        "rebuild app/bin/crate-cli-linux-amd64 with `make crate-cli-linux`"
    )
    assert b"beats_per_bar" in binary, (
        "rebuild app/bin/crate-cli-linux-amd64 with `make crate-cli-linux`"
    )


def test_worker_binary_segments_with_harmony_and_timbre() -> None:
    # SM3-D17 kept the analyzer version, so a binary built before it would keep writing
    # v7 phrases from level and band balance only; its analyze help names the novelty.
    binary = (APP_ROOT / "bin/crate-cli-linux-amd64").read_bytes()

    assert b"harmony and timbre novelty" in binary, (
        "rebuild app/bin/crate-cli-linux-amd64 with `make crate-cli-linux`"
    )


def test_worker_binary_floors_the_mfcc_deviation() -> None:
    # The MFCC deviation floor kept the analyzer version too, so a binary built before
    # it would keep splitting near-static loops on noise; its analyze help names it.
    binary = (APP_ROOT / "bin/crate-cli-linux-amd64").read_bytes()

    assert b"MFCC deviation floor" in binary, (
        "rebuild app/bin/crate-cli-linux-amd64 with `make crate-cli-linux`"
    )


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


def test_readers_accept_the_previous_analyzer_while_writers_target_the_new_one() -> (
    None
):
    assert versions.READABLE_ANALYZER_VERSIONS[0] == versions.ANALYZER_VERSION
    assert versions.ANALYZER_VERSION == "smart-mix-audio-v7"
    # v7 only adds structure; v6 and v5 profiles keep serving until the backfill.
    assert "smart-mix-audio-v6" in versions.READABLE_ANALYZER_VERSIONS
    assert "smart-mix-audio-v5" in versions.READABLE_ANALYZER_VERSIONS
    assert len(set(versions.READABLE_ANALYZER_VERSIONS)) == len(
        versions.READABLE_ANALYZER_VERSIONS
    )


def test_rust_structure_constants_match_python() -> None:
    from crate.smart_mix import structure

    source = (REPO_ROOT / "tools/crate-cli/src/structure.rs").read_text()
    rust: dict[str, object] = {}

    def value(expression: str) -> object:
        if expression.startswith("["):
            return tuple(int(item) for item in expression.strip("[]").split(","))
        product = 1.0
        for factor in (part.strip() for part in expression.split("*")):
            product *= float(
                rust[factor] if factor in rust else factor.replace("_", "")
            )
        return product

    for name, expression in re.findall(
        r"^\s*(?:pub )?const ([A-Z0-9_]+): [^=]+= ([^;]+);", source, re.MULTILINE
    ):
        rust[name] = value(expression.strip())
    python = {
        name: entry if isinstance(entry, tuple) else float(entry)
        for name, entry in vars(structure).items()
        if name.isupper()
        and not isinstance(entry, bool)
        and isinstance(entry, int | float | tuple)
    }

    assert set(rust) == set(python)
    for name, expected in python.items():
        assert rust[name] == expected, name


def test_novelty_constants_match_between_python_and_rust() -> None:
    # SM3-D17: both analyzers weigh harmony and timbre alike, over the same windows,
    # with the same floor under each MFCC deviation, and charge the same cost per
    # phrase boundary.
    from crate.smart_mix import structure

    expected = {
        "HARMONY_WEIGHT": 2.0,
        "TIMBRE_WEIGHT": 8.0,
        "MFCC_COEFFICIENTS": 13,
        "MFCC_STD_FLOOR": 1.0,
        "BOUNDARY_COST_DB": 4.0,
        "NOVELTY_WINDOW_BARS": 4,
    }
    source = (REPO_ROOT / "tools/crate-cli/src/structure.rs").read_text()
    rust = {
        name: float(value)
        for name, value in re.findall(
            r"^pub const ([A-Z_]+): [^=]+= ([0-9.]+);", source, re.MULTILINE
        )
        if name in expected
    }

    assert {name: getattr(structure, name) for name in expected} == expected
    assert rust == {name: float(value) for name, value in expected.items()}


def test_rust_model_downbeat_rule_matches_python() -> None:
    # Both analyzers take the bar from Beat This! downbeats with the same rule (SM3-D14).
    from crate.smart_mix import phrase_grid

    source = (REPO_ROOT / "tools/crate-cli/src/beat_tracking.rs").read_text()
    rust = {
        name: float(value)
        for name, value in re.findall(
            r"^pub const (MODEL_DOWNBEAT_[A-Z_]+): [^=]+= ([^;]+);",
            source,
            re.MULTILINE,
        )
    }

    assert rust == {
        "MODEL_DOWNBEAT_TOLERANCE_MS": phrase_grid.MODEL_DOWNBEAT_TOLERANCE_MS,
        "MODEL_DOWNBEAT_MIN_SHARE": phrase_grid.MODEL_DOWNBEAT_MIN_SHARE,
    }


def test_only_phrase_planners_read_the_profile_structure() -> None:
    assert versions.planner_reads_structure(versions.PLANNER_IDENTIFIER) is False
    assert versions.planner_reads_structure("smart-mix-v2") is False
    assert versions.planner_reads_structure("smart-mix-v3") is True


def test_readers_accept_every_profile_schema_up_to_the_current_one() -> None:
    readable = versions.READABLE_PROFILE_VERSIONS
    assert readable[0] == versions.PROFILE_SCHEMA_VERSION
    assert readable[-1] == 1
    assert list(readable) == sorted(set(readable), reverse=True)
    assert len(readable) == versions.PROFILE_SCHEMA_VERSION


# Only the code that measures progress towards the target (backfill claims, coverage
# and the Admin track status) compares a profile with the current schema; readers
# accept every readable one.
TARGET_SCHEMA_MODULES = {
    "app/crate/db/jobs/smart_mix_backfill.py",
    "app/crate/db/queries/smart_mix_admin_tracks.py",
}


def test_profile_readers_never_require_the_exact_current_schema() -> None:
    pattern = re.compile(r"profile_version\s*(?:=|<>|!=)\s*:")
    offenders = sorted(
        str(path.relative_to(REPO_ROOT))
        for path in (REPO_ROOT / "app/crate").rglob("*.py")
        if "migrations" not in path.parts
        and pattern.search(path.read_text())
        and str(path.relative_to(REPO_ROOT)) not in TARGET_SCHEMA_MODULES
    )
    assert offenders == []
