from __future__ import annotations


def test_cold_home_discovery_builds_a_snapshot(monkeypatch):
    from crate.db import home_discovery_surface

    expected = {
        "suggested_albums": [{"album_name": "Newest release"}],
        "snapshot": {"version": 42},
    }
    builds: list[dict] = []

    monkeypatch.setattr(
        home_discovery_surface, "get_ui_snapshot", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        home_discovery_surface,
        "_schedule_home_refresh",
        lambda _user_id: None,
    )

    def build_snapshot(**kwargs):
        builds.append(kwargs)
        return expected

    monkeypatch.setattr(
        home_discovery_surface,
        "get_or_build_ui_snapshot",
        build_snapshot,
    )

    payload = home_discovery_surface.get_cached_home_discovery(7)

    assert payload == expected
    assert builds[0]["scope"] == "home:discovery"
    assert builds[0]["subject_key"] == "7"
    assert builds[0]["fresh"] is True


def test_cold_home_section_builds_the_requested_view_all_payload(monkeypatch):
    from crate.db import home_section_surface

    expected = {
        "id": "suggested-albums",
        "title": "Suggested new albums for you",
        "subtitle": "Recent releases from the artists you already care about.",
        "items": [{"album_name": "Newest release"}],
    }

    monkeypatch.setattr(home_section_surface, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(home_section_surface, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        home_section_surface,
        "_schedule_home_refresh",
        lambda _user_id: None,
    )
    monkeypatch.setattr(
        home_section_surface,
        "get_cached_home_discovery",
        lambda _user_id: {"suggested_albums": []},
    )
    monkeypatch.setattr(
        home_section_surface,
        "get_home_section",
        lambda _user_id, _section_id, _limit: expected,
    )

    assert (
        home_section_surface.get_cached_home_section(
            7,
            "suggested-albums",
            limit=42,
        )
        == expected
    )
