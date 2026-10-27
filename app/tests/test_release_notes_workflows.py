from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
RELEASE_STEPS = {
    "build-android.yml": "Attach signed Android artifacts to GitHub Release",
    "build-desktop.yml": "Attach desktop artifacts to GitHub Release",
    "build-installer.yml": "Attach the installer to the GitHub Release",
}
BODY_PATH = "docs/releases/${{ github.ref_name }}.md"


def _release_steps() -> list[tuple[str, dict]]:
    found = []
    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        jobs = yaml.safe_load(workflow.read_text()).get("jobs", {})
        for job in jobs.values():
            for step in job.get("steps", []):
                if str(step.get("uses", "")).startswith("softprops/action-gh-release"):
                    found.append((workflow.name, step))
    return found


def test_every_release_upload_reads_the_shared_release_notes() -> None:
    steps = _release_steps()

    assert {(name, step["name"]) for name, step in steps} == set(RELEASE_STEPS.items())
    for name, step in steps:
        options = step["with"]
        assert options.get("body_path") == BODY_PATH, name
        assert not options.get("append_body"), name
        assert not options.get("generate_release_notes"), name


def test_release_notes_exist_for_v3() -> None:
    notes = (ROOT / "docs/releases/v3.0.0.md").read_text()

    assert notes.startswith("# Crate 3.0.0\n")
    assert "docs/technical/upgrade-v2-to-v3.md" in notes
    assert (ROOT / "docs/technical/upgrade-v2-to-v3.md").is_file()
