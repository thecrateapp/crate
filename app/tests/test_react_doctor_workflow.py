from pathlib import Path


WORKFLOW = (
    Path(__file__).resolve().parents[2] / ".github/workflows/react-doctor.yml"
).read_text(encoding="utf-8")


def test_react_doctor_action_is_immutable_and_least_privileged() -> None:
    assert "millionco/react-doctor@013f7373f91a3b9e68bd1dc7d4d354f4b041b117" in WORKFLOW
    assert 'commit-status: "false"' in WORKFLOW
    assert "statuses: write" not in WORKFLOW
    assert "pull-requests: write" in WORKFLOW
    assert "issues: write" in WORKFLOW
