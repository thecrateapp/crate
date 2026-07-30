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
    assert "CAP_DEBUG_SERVER_URL := https://api.dev.lespedants.org" in makefile
    assert 'VITE_CRATE_FIXED_SERVER_URL="$(CAP_DEBUG_SERVER_URL)"' in target
    assert 'VITE_CRATE_OAUTH_SCHEME="cratemusic-dbg"' in target
    assert "assembleDebug" in target


def test_makefile_builds_a_prod_pinned_smart_mix_debug_apk() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")

    assert "CAP_SMART_MIX_PROD_API_URL := https://api.lespedants.org" in makefile
    assert "cap-android-smart-mix-prod-artifacts:" in makefile
    target = makefile.split(
        "cap-android-smart-mix-prod-artifacts:",
        1,
    )[1].split("\n\n", 1)[0]
    assert 'VITE_CRATE_FIXED_SERVER_URL="$(CAP_SMART_MIX_PROD_API_URL)"' in target
    assert 'VITE_CRATE_OAUTH_SCHEME="cratemusic-dbg"' in target
    assert 'VITE_CRATE_SMART_MIX_LOCAL_TEST="true"' in target
    assert (
        'VITE_CRATE_SMART_MIX_LOCAL_CROSSFADE_MS="$(CAP_SMART_MIX_CROSSFADE_MS)"'
    ) in target
    assert "assembleDebug" in target
    assert "crate-smart-mix-prod-debug-" in target


def test_android_debug_is_a_parallel_install_with_distinct_identity() -> None:
    gradle = (ROOT / "app/listen/android/app/build.gradle").read_text(encoding="utf-8")
    manifest = (ROOT / "app/listen/android/app/src/main/AndroidManifest.xml").read_text(
        encoding="utf-8"
    )

    debug = gradle.split("debug {", 1)[1].split("\n        }", 1)[0]
    assert 'applicationIdSuffix ".debug"' in debug
    assert '"app_name", "Crate DBG"' in debug
    assert '"title_activity_main", "Crate DBG"' in debug
    assert '"package_name", "app.cratemusic.crate.debug"' in debug
    assert 'crateOAuthScheme: "cratemusic-dbg"' in debug
    assert 'android:scheme="${crateOAuthScheme}"' in manifest


def test_release_build_explicitly_disables_local_smart_mix_override() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    target = makefile.split("cap-android-release:", 1)[1].split("\n\n", 1)[0]

    assert 'VITE_CRATE_SMART_MIX_LOCAL_TEST="false"' in target
    assert 'VITE_CRATE_FIXED_SERVER_URL=""' in target
    assert 'VITE_CRATE_OAUTH_SCHEME="cratemusic"' in target
