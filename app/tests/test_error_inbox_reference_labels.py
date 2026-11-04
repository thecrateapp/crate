"""Shape of the Error Inbox reference labels (E0), the set E2 measures its triage against."""

import json
from collections import Counter
from pathlib import Path

LABELS_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "error_inbox"
    / "reference_labels.json"
)
CLASSIFICATIONS = {
    "bug",
    "infrastructure",
    "external_dependency",
    "client_environment",
    "noise",
}
SEVERITIES = {"critical", "high", "medium", "low"}
DECISIONS = {"fix", "filter", "fingerprint", "reload", "resolve"}


def _labels() -> list[dict]:
    return json.loads(LABELS_PATH.read_text(encoding="utf-8"))["labels"]


def test_reference_labels_use_the_inbox_enums():
    for label in _labels():
        assert set(label) == {
            "short_id",
            "group",
            "classification",
            "severity",
            "duplicate_of",
            "decision",
        }
        assert label["short_id"].startswith("CRATE-")
        assert label["classification"] in CLASSIFICATIONS
        assert label["severity"] in SEVERITIES
        assert label["decision"] in DECISIONS


def test_reference_labels_have_unique_ids_and_resolvable_duplicates():
    labels = _labels()
    ids = [label["short_id"] for label in labels]
    assert len(ids) == len(set(ids)) == 79
    by_id = {label["short_id"]: label for label in labels}
    for label in labels:
        duplicate_of = label["duplicate_of"]
        if duplicate_of is None:
            continue
        assert duplicate_of != label["short_id"]
        # A duplicate points at the root of its group, which is not itself a duplicate.
        assert by_id[duplicate_of]["duplicate_of"] is None


def test_reference_labels_exclude_performance_issues():
    groups = Counter(label["group"] for label in _labels())
    assert "G10" not in groups
    assert groups["G2"] == 47
