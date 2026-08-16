from __future__ import annotations


def test_featured_artist_endpoint_updates_state_and_invalidates(monkeypatch, test_app):
    from crate.api import browse_artist

    invalidations: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        browse_artist,
        "set_artist_featured",
        lambda artist_id, is_featured: {
            "status": "updated",
            "is_featured": is_featured,
            "featured_devices": ("desktop", "mobile"),
        },
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )
    monkeypatch.setattr(
        "crate.api.cache_events.wait_for_cache_invalidation", lambda: True
    )

    response = test_app.patch(
        "/api/artists/7/featured",
        json={"is_featured": True},
    )

    assert response.status_code == 200
    assert response.json() == {
        "artist_id": 7,
        "is_featured": True,
        "featured_devices": ["desktop", "mobile"],
        "featured_eligible": True,
    }
    assert ("home", "library", "browse:artists", "artist:7") in invalidations


def test_featured_artist_endpoint_returns_conflict_when_hero_is_not_ready(
    monkeypatch, test_app
):
    from crate.api import browse_artist

    monkeypatch.setattr(
        browse_artist,
        "set_artist_featured",
        lambda _artist_id, _is_featured: {
            "status": "rejected",
            "reason": "approved_hero_required",
        },
    )

    response = test_app.patch(
        "/api/artists/7/featured",
        json={"is_featured": True},
    )

    assert response.status_code == 409
    assert response.json() == {
        "error": "approved_hero_required",
        "reason": "approved_hero_required",
    }
