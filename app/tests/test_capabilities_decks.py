"""`capabilities.decks`: the contract Crate Decks degrades against (S2, D13)."""

from __future__ import annotations

import pytest

_ANDROID_AND_SMART_MIX_FLAGS = (
    "CRATE_SMART_MIX_ENABLED",
    "CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED",
    "CRATE_ANDROID_BEATMATCH_ENABLED",
    "CRATE_ANDROID_BASS_HANDOFF_ENABLED",
)
_FEATURE_VOCABULARY = {
    "library_cursor",
    "profiles_batch",
    "beatmatch",
    "bass_handoff",
    "long_beatmatch",
    "cues",
    "stems",
    "stem_upload",
    "local_refinement",
}


@pytest.fixture(autouse=True)
def stem_uploads_on(monkeypatch):
    monkeypatch.setattr("crate.api.capabilities.stem_uploads_enabled", lambda: True)


def test_capabilities_includes_decks_section(test_app, monkeypatch):
    for flag in _ANDROID_AND_SMART_MIX_FLAGS:
        monkeypatch.delenv(flag, raising=False)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    # The test user is an admin, so it may upload stem analyses.
    assert response.json()["decks"] == {
        "available": True,
        "min_client_version": "0.1.0",
        "contract_version": 1,
        "features": ["library_cursor", "stems", "stem_upload", "local_refinement"],
    }


@pytest.mark.parametrize("enabled", [False, True])
def test_decks_features_reflect_settings(test_app, monkeypatch, enabled):
    # Each Decks feature is advertised by the phase that implements its server
    # contract (S3 library_cursor, S4 profiles_batch, S5 beatmatch/bass_handoff/
    # long_beatmatch, S7 cues, Smart Mix Stems ST1 stems/stem_upload, ST3
    # local_refinement); S3 and the Smart Mix Stems features ship so far. In
    # particular, Decks never inherits the Android Smart Mix flags.
    for flag in _ANDROID_AND_SMART_MIX_FLAGS:
        if enabled:
            monkeypatch.setenv(flag, "true")
        else:
            monkeypatch.delenv(flag, raising=False)

    decks = test_app.get("/api/capabilities").json()["decks"]

    assert decks["available"] is True
    assert decks["features"] == [
        "library_cursor",
        "stems",
        "stem_upload",
        "local_refinement",
    ]


def test_decks_capabilities_schema_documents_the_feature_vocabulary(test_app):
    schema = test_app.get("/openapi.json").json()
    components = schema["components"]["schemas"]

    response_properties = components["CapabilitiesResponse"]["properties"]
    assert response_properties["decks"] == {
        "$ref": "#/components/schemas/DecksCapabilities"
    }
    decks = components["DecksCapabilities"]
    assert set(decks["required"]) == {
        "available",
        "min_client_version",
        "contract_version",
        "features",
    }
    assert decks["properties"]["contract_version"]["type"] == "integer"
    assert set(decks["properties"]["features"]["items"]["enum"]) == (
        _FEATURE_VOCABULARY
    )
