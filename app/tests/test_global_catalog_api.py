from unittest.mock import patch


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
