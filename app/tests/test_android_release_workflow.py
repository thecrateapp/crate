from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/build-android.yml"


def test_android_ci_only_builds_and_publishes_end_user_artifacts_for_tags() -> None:
    workflow = WORKFLOW.read_text()

    assert "assembleDebug" not in workflow
    assert "assembleDebugAndroidTest" not in workflow
    assert "outputs/apk/debug" not in workflow
    assert "Build debug APK" not in workflow

    for step_name in (
        "Locate Android release artifacts",
        "Prepare published release artifacts",
        "Upload signed APK build artifact",
    ):
        step = workflow[workflow.index(f"- name: {step_name}") :]
        step = step[: step.index("\n      - name:", 1)]
        assert "if: startsWith(github.ref, 'refs/tags/v')" in step


def test_android_tag_build_keeps_signed_apk_and_aab_release_outputs() -> None:
    workflow = WORKFLOW.read_text()

    assert "Build signed release APK and AAB" in workflow
    assert "bundleRelease assembleRelease lintRelease" in workflow
    assert "app/build/outputs/apk/release" in workflow
    assert "app/build/outputs/bundle/release" in workflow
    assert "Attach signed Android artifacts to GitHub Release" in workflow
