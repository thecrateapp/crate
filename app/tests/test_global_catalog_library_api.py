from unittest.mock import patch


def test_catalog_routes_return_retryable_warming_error_until_ready(test_app):
    with patch(
        "crate.api.catalog.get_catalog_state",
        return_value={"status": "backfilling"},
    ):
        response = test_app.get("/api/catalog/me/artists")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "3"
    assert response.json() == {"detail": "catalog_warming"}


def test_catalog_me_artists_returns_user_global_follows(
    test_app,
):
    global_artists = [
        {
            "artist_name": "Rival Schools",
            "global_artist_uid": "artist-global",
            "artist_id": None,
            "artist_entity_uid": None,
            "artist_slug": None,
            "created_at": "2026-07-10T10:00:00+00:00",
            "album_count": 1,
            "track_count": 10,
            "has_photo": False,
            "photo_url": "/api/catalog/artists/artist-global/photo",
        }
    ]

    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            return_value={"status": "ready"},
        ),
        patch(
            "crate.api.catalog.list_user_global_artist_follows",
            return_value=global_artists,
        ) as mocked,
    ):
        response = test_app.get("/api/catalog/me/artists")

    assert response.status_code == 200
    assert response.json() == global_artists
    mocked.assert_called_once()


def test_catalog_me_albums_returns_user_global_saves(
    test_app,
):
    global_albums = [
        {
            "saved_at": "2026-07-10T10:00:00+00:00",
            "id": None,
            "global_album_uid": "album-global",
            "global_artist_uid": "artist-global",
            "album_entity_uid": None,
            "slug": None,
            "artist": "Rival Schools",
            "artist_id": None,
            "artist_entity_uid": None,
            "artist_slug": None,
            "name": "Pedals",
            "year": "2011",
            "has_cover": True,
            "track_count": 10,
            "total_duration": 2400,
            "cover_url": "/api/catalog/albums/album-global/cover",
        }
    ]

    with (
        patch(
            "crate.api.catalog.get_catalog_state",
            return_value={"status": "ready"},
        ),
        patch(
            "crate.api.catalog.list_user_global_album_saves",
            return_value=global_albums,
        ) as mocked,
    ):
        response = test_app.get("/api/catalog/me/albums")

    assert response.status_code == 200
    assert response.json() == global_albums
    mocked.assert_called_once()


def test_legacy_saved_albums_route_keeps_remote_only_saves_visible(test_app):
    remote_album = {
        "saved_at": "2026-07-10T10:00:00+00:00",
        "id": None,
        "global_album_uid": "album-global",
        "global_artist_uid": "artist-global",
        "album_entity_uid": None,
        "slug": None,
        "artist": "Rival Schools",
        "artist_id": None,
        "artist_entity_uid": None,
        "artist_slug": None,
        "name": "Pedals",
        "year": "2011",
        "has_cover": False,
        "track_count": 10,
        "total_duration": 2400,
        "cover_url": None,
    }

    with patch("crate.api.me.get_saved_albums", return_value=[remote_album]):
        response = test_app.get("/api/me/albums")

    assert response.status_code == 200
    assert response.json() == [remote_album]


def test_me_library_counts_always_use_global_refs(test_app):
    global_counts = {
        "followed_artists": 3,
        "saved_albums": 4,
        "liked_tracks": 5,
        "playlists": 2,
    }

    with (
        patch(
            "crate.api.me.get_user_global_library_counts",
            return_value=global_counts,
        ) as global_mock,
    ):
        response = test_app.get("/api/me")

    assert response.status_code == 200
    assert response.json() == global_counts
    global_mock.assert_called_once_with(1)
