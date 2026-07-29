from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_makefile_builds_an_explicit_local_smart_mix_debug_apk() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")

    assert "cap-android-smart-mix-artifacts:" in makefile
    target = makefile.split("cap-android-smart-mix-artifacts:", 1)[1].split(
        "\n\n",
        1,
    )[0]
    assert 'VITE_CRATE_SMART_MIX_LOCAL_TEST="true"' in target
    assert (
        'VITE_CRATE_SMART_MIX_LOCAL_CROSSFADE_MS="$(CAP_SMART_MIX_CROSSFADE_MS)"'
    ) in target
    assert "CAP_SMART_MIX_API_URL ?= https://api.dev.lespedants.org" in makefile
    assert 'VITE_API_URL="$(CAP_SMART_MIX_API_URL)"' in target
    assert "assembleDebug" in target


def test_release_build_explicitly_disables_local_smart_mix_override() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    target = makefile.split("cap-android-release:", 1)[1].split("\n\n", 1)[0]

    assert 'VITE_CRATE_SMART_MIX_LOCAL_TEST="false"' in target
