from __future__ import annotations

from unittest.mock import patch

from crate.db.queries.vdj_catalog import list_vdj_folders


async def _catalog_user(_middleware, _request):
    return {
        "id": 7,
        "email": "dj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read"],
    }


async def _media_only_user(_middleware, _request):
    return {
        "id": 7,
        "email": "dj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.media.read"],
    }


def test_vdj_catalog_lists_root_folders(test_app):
    folders = [
        {"id": "crate:artists", "name": "Artists"},
        {"id": "crate:albums", "name": "Albums"},
    ]
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _catalog_user),
        patch("crate.api.vdj_catalog.list_vdj_folders", return_value=folders),
    ):
        response = test_app.get("/api/vdj/catalog/folders")

    assert response.status_code == 200
    assert response.json() == {
        "folders": folders,
        "tracks": [],
        "next_cursor": None,
    }


def test_vdj_catalog_omits_flat_artist_and_album_collections():
    folder_ids = {folder["id"] for folder in list_vdj_folders()}

    assert folder_ids == {
        "crate:playlists",
        "crate:genres",
        "crate:moods",
        "crate:recently-played",
    }


def test_vdj_catalog_folder_returns_bounded_page(test_app):
    page = {
        "folders": [],
        "tracks": [
            {
                "entity_uid": "track-1",
                "title": "Noah",
                "artist": "Birds In Row",
                "album": "Gris Klein",
                "path": None,
                "duration": 193.5,
                "year": "2022",
                "genre": "post-hardcore",
                "bpm": 95.0,
                "audio_key": "F#",
                "audio_scale": "minor",
                "has_cover": True,
                "cover_url": "/api/vdj/albums/3/cover?size=512",
            }
        ],
        "next_cursor": "cursor-1",
    }
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _catalog_user),
        patch(
            "crate.api.vdj_catalog.get_vdj_folder_page",
            return_value=page,
        ) as get_page,
    ):
        response = test_app.get(
            "/api/vdj/catalog/folders/crate:artists?cursor=cursor-0&limit=37"
        )

    assert response.status_code == 200
    assert response.json() == page
    get_page.assert_called_once_with(
        "crate:artists",
        user_id=7,
        cursor="cursor-0",
        limit=37,
    )


def test_vdj_catalog_requires_catalog_scope(test_app):
    with patch(
        "crate.api.auth.AuthMiddleware.resolve_user",
        _media_only_user,
    ):
        response = test_app.get("/api/vdj/catalog/folders")

    assert response.status_code == 403
    assert "vdj.catalog.read" in response.json()["detail"]
