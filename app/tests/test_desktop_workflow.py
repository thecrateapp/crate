from pathlib import Path


ROOT = Path(__file__).parents[2]
WORKFLOW = ROOT / ".github/workflows/build-desktop.yml"


def test_desktop_matrix_executes_locked_rust_tests_before_bundling() -> None:
    workflow = WORKFLOW.read_text()

    test_step = (
        "cargo test --locked --manifest-path app/listen-desktop/src-tauri/Cargo.toml"
    )
    assert test_step in workflow
    assert workflow.index(test_step) < workflow.index("Build macOS tester bundles")
