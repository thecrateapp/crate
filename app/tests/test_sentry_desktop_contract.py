from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_tauri_native_process_initializes_sentry() -> None:
    manifest = (ROOT / "app/listen-desktop/src-tauri/Cargo.toml").read_text()
    source = (ROOT / "app/listen-desktop/src-tauri/src/lib.rs").read_text()

    assert 'sentry = { version = "0.44.0"' in manifest
    assert "mod observability;" in source
    assert 'observability::init_sentry("listen-tauri-native")' in source


def test_desktop_release_build_embeds_native_sentry_configuration() -> None:
    workflow = yaml.safe_load(
        (ROOT / ".github/workflows/build-desktop.yml").read_text()
    )
    steps = workflow["jobs"]["build-desktop"]["steps"]

    for step_name in ("Build macOS tester bundles", "Build desktop bundles"):
        step = next(step for step in steps if step.get("name") == step_name)
        assert step["env"]["SENTRY_DSN"] == "${{ vars.SENTRY_LISTEN_DSN }}"
        assert step["env"]["SENTRY_ENVIRONMENT"] == "production"
        assert step["env"]["SENTRY_RELEASE"] == "crate-${{ github.sha }}"
