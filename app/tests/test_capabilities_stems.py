"""`smart_mix.stems` and the Decks stem features in /api/capabilities (STEM-D4, D8)."""

from __future__ import annotations

import pytest


@pytest.fixture
def uploads(monkeypatch):
    from crate.api import capabilities

    state = {"enabled": True, "reads": 0}

    def enabled() -> bool:
        state["reads"] += 1
        if isinstance(state["enabled"], Exception):
            raise state["enabled"]
        return bool(state["enabled"])

    monkeypatch.setattr(capabilities, "stem_uploads_enabled", enabled)
    monkeypatch.setattr(capabilities, "get_smart_mix_structure_percent", lambda: None)
    return state


def _as_role(monkeypatch, role: str | None) -> None:
    async def resolve(self, request):
        del self, request
        if role is None:
            return None
        return {"id": 7, "email": f"{role}@test.local", "role": role}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve)


def _capabilities(test_app) -> dict:
    response = test_app.get("/api/capabilities")
    assert response.status_code == 200
    return response.json()


def test_smart_mix_stems_follows_smart_mix(test_app, monkeypatch, uploads) -> None:
    del uploads
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    # Smart Mix playlists can be turned on (ST2.PR1); without a stems directory the
    # API serves no stem files (ST2.PR3).
    assert _capabilities(test_app)["smart_mix"]["stems"] == {
        "available": True,
        "playlists": True,
        "storage": False,
    }

    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    assert _capabilities(test_app)["smart_mix"]["stems"] == {
        "available": False,
        "playlists": False,
        "storage": False,
    }


@pytest.mark.parametrize("smart_mix", [False, True])
def test_decks_reads_stems_and_a_contributor_may_upload(
    test_app, monkeypatch, uploads, smart_mix
) -> None:
    if smart_mix:
        monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    else:
        monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)

    features = _capabilities(test_app)["decks"]["features"]

    assert features == [
        "library_cursor",
        "profiles_batch",
        "stems",
        "stem_upload",
        "local_refinement",
    ]
    assert uploads["reads"] == 1


@pytest.mark.parametrize("role", ["user", "librarian", "ops", None])
def test_no_stem_upload_without_the_contribute_permission(
    test_app, monkeypatch, uploads, role
) -> None:
    _as_role(monkeypatch, role)

    assert _capabilities(test_app)["decks"]["features"] == [
        "library_cursor",
        "profiles_batch",
        "stems",
        "local_refinement",
    ]
    # The setting is only read for a user who could upload.
    assert uploads["reads"] == 0


def test_no_stem_upload_while_uploads_are_off(test_app, uploads) -> None:
    uploads["enabled"] = False

    assert _capabilities(test_app)["decks"]["features"] == [
        "library_cursor",
        "profiles_batch",
        "stems",
        "local_refinement",
    ]


def test_an_unreadable_setting_hides_stem_upload(test_app, uploads) -> None:
    uploads["enabled"] = RuntimeError("database unavailable")

    assert _capabilities(test_app)["decks"]["features"] == [
        "library_cursor",
        "profiles_batch",
        "stems",
        "local_refinement",
    ]


def test_the_stems_capability_is_documented(test_app) -> None:
    components = test_app.get("/openapi.json").json()["components"]["schemas"]

    smart_mix = components["SmartMixCapabilities"]
    assert "stems" in smart_mix["required"]
    assert smart_mix["properties"]["stems"] == {
        "$ref": "#/components/schemas/SmartMixStemsCapabilities"
    }
    stems = components["SmartMixStemsCapabilities"]
    assert set(stems["required"]) == {"available", "playlists", "storage"}
    assert all(
        stems["properties"][name]["type"] == "boolean"
        for name in ("available", "playlists", "storage")
    )


@pytest.mark.parametrize(
    "stems_dir, quota, storage",
    [
        ("/stems", "50", True),
        ("/stems", None, True),
        ("/stems", "0", False),
        (None, "50", False),
    ],
)
def test_storage_follows_the_stems_directory_and_the_quota(
    test_app, monkeypatch, uploads, stems_dir, quota, storage
) -> None:
    del uploads
    from crate.api import capabilities

    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    if stems_dir is None:
        monkeypatch.delenv("CRATE_STEMS_DIR", raising=False)
    else:
        monkeypatch.setenv("CRATE_STEMS_DIR", stems_dir)
    monkeypatch.setattr(
        capabilities,
        "get_setting",
        lambda key, default=None: (
            quota if key == "smart_mix_stem_quota_gib" else default
        ),
    )

    assert _capabilities(test_app)["smart_mix"]["stems"]["storage"] is storage
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED")
    assert _capabilities(test_app)["smart_mix"]["stems"]["storage"] is False
