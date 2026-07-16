from unittest.mock import patch

import pytest


def test_catalog_search_endpoint_returns_search_shape(test_app):
    payload = {
        "artists": [{"name": "Rival Schools", "global_uid": "artist-1"}],
        "albums": [],
        "tracks": [],
    }

    with patch("crate.api.catalog.search_global_catalog", return_value=payload):
        response = test_app.get("/api/catalog/search?q=rival&limit=10")

    assert response.status_code == 200
    assert response.json() == payload


def test_catalog_search_endpoint_does_not_include_source_metadata_by_default(test_app):
    captured = {}

    def fake_search(query: str, limit: int, include_sources: bool = False):
        captured["include_sources"] = include_sources
        return {"artists": [], "albums": [], "tracks": []}

    with patch("crate.api.catalog.search_global_catalog", side_effect=fake_search):
        response = test_app.get("/api/catalog/search?q=rival")

    assert response.status_code == 200
    assert captured["include_sources"] is False


def test_catalog_search_endpoint_uses_global_search_without_a_mode_switch(test_app):
    payload = {
        "artists": [{"name": "High Vis"}],
        "albums": [],
        "tracks": [],
    }

    with patch(
        "crate.api.catalog.search_global_catalog", return_value=payload
    ) as search:
        response = test_app.get("/api/catalog/search?q=high&limit=7")

    assert response.status_code == 200
    assert response.json() == payload
    search.assert_called_once_with("high", limit=7, include_sources=False)


@pytest.mark.parametrize("status", ["cold", "backfilling", "failed"])
def test_catalog_search_uses_local_fallback_before_first_reconciliation(
    test_app, status
):
    payload = {
        "artists": [{"id": 7, "name": "High Vis", "slug": "high-vis"}],
        "albums": [],
        "tracks": [],
    }
    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            return_value={"status": status, "last_full_reconcile_at": None},
        ),
        patch(
            "crate.api.catalog.search_local_library", return_value=payload
        ) as local_search,
        patch("crate.api.catalog.search_global_catalog") as global_search,
        patch("crate.api.catalog.record_later") as record_metric,
    ):
        response = test_app.get(
            "/api/catalog/search?q=high&limit=7&include_sources=true"
        )

    assert response.status_code == 200
    assert response.json() == payload
    assert response.headers["X-Crate-Catalog-Mode"] == "local-fallback"
    local_search.assert_called_once_with("high", 7)
    global_search.assert_not_called()
    record_metric.assert_called_once_with(
        "catalog.search.serving_mode", 1, tags={"mode": "local-fallback"}
    )


@pytest.mark.parametrize(
    ("status", "expected_mode"),
    [
        ("backfilling", "global-refreshing"),
        ("failed", "global-degraded"),
    ],
)
def test_catalog_search_keeps_global_catalog_live_after_first_reconciliation(
    test_app, status, expected_mode
):
    payload = {"artists": [], "albums": [], "tracks": []}
    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            return_value={
                "status": status,
                "last_full_reconcile_at": "2026-07-15T20:00:00+00:00",
            },
        ),
        patch(
            "crate.api.catalog.search_global_catalog", return_value=payload
        ) as global_search,
        patch("crate.api.catalog.search_local_library") as local_search,
    ):
        response = test_app.get("/api/catalog/search?q=high&limit=7")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == expected_mode
    global_search.assert_called_once_with("high", limit=7, include_sources=False)
    local_search.assert_not_called()


def test_catalog_search_falls_back_locally_when_state_lookup_fails(test_app):
    payload = {"artists": [], "albums": [], "tracks": []}
    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            side_effect=RuntimeError("state unavailable"),
        ),
        patch(
            "crate.api.catalog.search_local_library", return_value=payload
        ) as local_search,
    ):
        response = test_app.get("/api/catalog/search?q=high")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == "local-fallback"
    local_search.assert_called_once_with("high", 20)
