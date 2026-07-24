from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.conftest import PG_AVAILABLE


USER = {
    "id": 41,
    "email": "listener@example.test",
    "username": "listener",
    "role": "user",
    "password_hash": "unused",
}
ARTIST_UID = "11111111-1111-4111-8111-111111111111"
ALBUM_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"


def _auth():
    return patch("crate.api.subsonic._subsonic_auth", return_value=USER)


def _track() -> dict:
    return {
        "global_track_uid": TRACK_UID,
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "title": "Marigold",
        "artist": "High Vis",
        "album": "Blending",
        "track_number": 1,
        "disc_number": 1,
        "duration": 228,
        "bitrate": 320,
        "format": "flac",
        "year": "2022",
        "has_cover": True,
    }


def test_global_browse_uses_typed_canonical_ids(test_app):
    with (
        _auth(),
        patch(
            "crate.api.subsonic.list_global_artists",
            return_value=[
                {
                    "global_artist_uid": ARTIST_UID,
                    "name": "High Vis",
                    "album_count": 1,
                }
            ],
        ),
    ):
        response = test_app.get("/rest/getArtists?u=listener&p=secret")

    assert response.status_code == 200
    artist = response.json()["subsonic-response"]["artists"]["index"][0]["artist"][0]
    assert artist == {
        "id": f"ga-{ARTIST_UID}",
        "name": "High Vis",
        "albumCount": 1,
    }


def test_global_album_detail_contains_global_song_ids(test_app):
    album = {
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "name": "Blending",
        "artist": "High Vis",
        "year": "2022",
        "track_count": 1,
        "duration": 228,
        "has_cover": True,
    }
    with (
        _auth(),
        patch("crate.api.subsonic.get_global_album", return_value=album),
        patch("crate.api.subsonic.list_global_album_tracks", return_value=[_track()]),
    ):
        response = test_app.get(
            f"/rest/getAlbum?u=listener&p=secret&id=gal-{ALBUM_UID}"
        )

    body = response.json()["subsonic-response"]["album"]
    assert body["id"] == f"gal-{ALBUM_UID}"
    assert body["artistId"] == f"ga-{ARTIST_UID}"
    assert body["song"][0]["id"] == f"gt-{TRACK_UID}"


def test_global_search_applies_server_side_caps(test_app):
    with (
        _auth(),
        patch(
            "crate.api.subsonic.search_global_catalog",
            return_value={"artists": [], "albums": [], "tracks": []},
        ) as search,
    ):
        response = test_app.get(
            "/rest/search3?u=listener&p=secret&query=vis"
            "&artistCount=100&albumCount=100&songCount=200"
        )

    assert response.status_code == 200
    search.assert_called_once_with(
        "vis", artist_limit=100, album_limit=100, track_limit=200
    )


def test_legacy_local_track_id_remains_accepted(test_app):
    local = {
        "id": 9,
        "title": "Talk For Hours",
        "artist": "High Vis",
        "album": "Blending",
        "album_id": 2,
        "artist_id": 3,
        "track_number": 2,
        "disc_number": 1,
        "year": "2022",
        "duration": 190,
        "bitrate": 320,
        "format": "flac",
        "path": "High Vis/Blending/02.flac",
        "has_cover": True,
    }
    with _auth(), patch("crate.api.subsonic.get_track_full", return_value=local):
        response = test_app.get("/rest/getSong?u=listener&p=secret&id=9")

    assert response.json()["subsonic-response"]["song"]["id"] == "9"


def test_wrong_global_id_type_returns_stable_subsonic_error(test_app):
    with _auth():
        response = test_app.get(f"/rest/getSong?u=listener&p=secret&id=gal-{ALBUM_UID}")

    error = response.json()["subsonic-response"]
    assert error["status"] == "failed"
    assert error["error"] == {
        "code": 70,
        "message": "Invalid Subsonic entity ID",
    }


def test_starred_tracks_are_read_from_global_likes(test_app):
    starred = {**_track(), "starred": "2026-07-14T10:00:00+00:00"}
    with (
        _auth(),
        patch(
            "crate.api.subsonic.get_starred_global_tracks", return_value=[starred]
        ) as query,
    ):
        response = test_app.get("/rest/getStarred2?u=listener&p=secret")

    query.assert_called_once_with(USER["id"])
    song = response.json()["subsonic-response"]["starred2"]["song"][0]
    assert song["id"] == f"gt-{TRACK_UID}"
    assert song["starred"] == starred["starred"]


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_global_adapter_reads_singleton_catalog_without_duplicates(pg_db):
    pg_db.upsert_artist({"name": "High Vis", "has_photo": 1})
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "year": "2022",
            "track_count": 1,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Talk For Hours.flac",
            "title": "Talk For Hours",
            "path": "/music/High Vis/Blending/01 - Talk For Hours.flac",
            "duration": 190.0,
            "format": "flac",
        }
    )

    from crate.db.queries.subsonic_global import (
        list_global_album_tracks,
        list_global_artist_albums,
        list_global_artists,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    reconcile_local_catalog()

    artists = list_global_artists()
    high_vis = [artist for artist in artists if artist["name"] == "High Vis"]
    assert len(high_vis) == 1
    albums = list_global_artist_albums(high_vis[0]["global_artist_uid"])
    assert [album["name"] for album in albums] == ["Blending"]
    tracks = list_global_album_tracks(albums[0]["global_album_uid"])
    assert [track["title"] for track in tracks] == ["Talk For Hours"]
