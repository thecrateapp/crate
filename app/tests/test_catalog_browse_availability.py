from unittest.mock import patch


def _cold_state() -> dict:
    return {"status": "backfilling", "last_full_reconcile_at": None}


def test_catalog_genres_uses_local_library_during_first_backfill(test_app):
    local_items = [
        {
            "canonical_slug": "post-punk",
            "canonical_name": "post-punk",
            "entity_count": 8,
            "artist_count": 3,
            "album_count": 5,
            "track_count": 0,
        }
    ]
    with (
        patch("crate.api.catalog.get_catalog_state", return_value=_cold_state()),
        patch(
            "crate.api.catalog.list_local_catalog_genres", return_value=local_items
        ) as local_list,
        patch("crate.api.catalog.list_global_catalog_genres") as global_list,
    ):
        response = test_app.get("/api/catalog/genres")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == "local-fallback"
    assert response.json()["items"] == local_items
    local_list.assert_called_once_with()
    global_list.assert_not_called()


def test_catalog_genre_detail_uses_local_library_during_first_backfill(test_app):
    local_detail = {
        "id": 4,
        "name": "post-punk",
        "slug": "post-punk",
        "artists": [{"artist_name": "High Vis"}],
        "albums": [],
    }
    with (
        patch("crate.api.catalog.get_catalog_state", return_value=_cold_state()),
        patch(
            "crate.api.catalog.get_local_catalog_genre_detail",
            return_value=local_detail,
        ) as local_get,
        patch("crate.api.catalog.get_global_genre_detail") as global_get,
    ):
        response = test_app.get("/api/catalog/genres/post-punk")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == "local-fallback"
    assert response.json()["artists"][0]["artist_name"] == "High Vis"
    local_get.assert_called_once_with("post-punk")
    global_get.assert_not_called()


def test_catalog_decade_uses_local_library_during_first_backfill(test_app):
    local_page = {
        "items": [{"id": 7, "slug": "high-vis", "name": "High Vis"}],
        "total": 1,
        "page": 1,
        "per_page": 50,
    }
    with (
        patch("crate.api.catalog.get_catalog_state", return_value=_cold_state()),
        patch(
            "crate.api.catalog.get_local_decade_artists", return_value=local_page
        ) as local_get,
        patch("crate.api.catalog.get_global_decade_artists") as global_get,
    ):
        response = test_app.get("/api/catalog/artists?decade=2020s&page=1&per_page=50")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == "local-fallback"
    assert response.json() == local_page
    local_get.assert_called_once_with(
        decade_start=2020,
        decade_end=2029,
        page=1,
        per_page=50,
    )
    global_get.assert_not_called()


def test_catalog_browse_keeps_last_global_snapshot_during_refresh(test_app):
    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            return_value={
                "status": "backfilling",
                "last_full_reconcile_at": "2026-07-15T20:00:00+00:00",
            },
        ),
        patch(
            "crate.api.catalog.list_global_catalog_genres", return_value=[]
        ) as global_list,
        patch("crate.api.catalog.list_local_catalog_genres") as local_list,
    ):
        response = test_app.get("/api/catalog/genres")

    assert response.status_code == 200
    assert response.headers["X-Crate-Catalog-Mode"] == "global-refreshing"
    global_list.assert_called_once_with()
    local_list.assert_not_called()
