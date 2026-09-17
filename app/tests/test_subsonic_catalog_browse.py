from unittest.mock import patch

from crate.subsonic.services import catalog


def test_genres_projects_canonical_name_and_catalog_counts():
    with patch(
        "crate.subsonic.services.catalog.list_global_catalog_genres",
        return_value=[
            {"canonical_name": "Post-rock", "track_count": 40, "album_count": 9},
            {"canonical_name": "", "track_count": 1, "album_count": 1},
        ],
    ):
        assert catalog.genres() == [
            {"value": "Post-rock", "songCount": 40, "albumCount": 9}
        ]


def test_music_directory_root_projects_artists_as_directories():
    with patch(
        "crate.subsonic.services.catalog.list_global_artists",
        return_value=[
            {
                "global_artist_uid": "11111111-1111-4111-8111-111111111111",
                "name": "Converge",
                "album_count": 10,
                "has_photo": True,
            }
        ],
    ):
        directory = catalog.music_directory("1")

    assert directory["id"] == "1"
    assert directory["child"] == [
        {
            "id": "ga-11111111-1111-4111-8111-111111111111",
            "parent": "1",
            "isDir": True,
            "title": "Converge",
            "artist": "Converge",
            "artistId": "ga-11111111-1111-4111-8111-111111111111",
            "albumCount": 10,
            "coverArt": "ga-11111111-1111-4111-8111-111111111111",
        }
    ]


def test_music_directory_artist_projects_albums_as_directories():
    artist_id = "ga-11111111-1111-4111-8111-111111111111"
    with patch(
        "crate.subsonic.services.catalog.artist_detail",
        return_value={
            "id": artist_id,
            "name": "Converge",
            "album": [
                {
                    "id": "gal-22222222-2222-4222-8222-222222222222",
                    "name": "Jane Doe",
                    "artist": "Converge",
                    "artistId": artist_id,
                    "year": 2001,
                    "coverArt": "gal-22222222-2222-4222-8222-222222222222",
                }
            ],
        },
    ):
        directory = catalog.music_directory(artist_id)

    assert directory["name"] == "Converge"
    assert directory["child"][0]["isDir"] is True
    assert directory["child"][0]["parent"] == artist_id
    assert directory["child"][0]["title"] == "Jane Doe"


def test_music_directory_album_returns_song_children():
    album_id = "gal-22222222-2222-4222-8222-222222222222"
    song = {"id": "gt-33333333-3333-4333-8333-333333333333", "title": "Concubine"}
    with patch(
        "crate.subsonic.services.catalog.album_detail",
        return_value={
            "id": album_id,
            "name": "Jane Doe",
            "artistId": "ga-artist",
            "song": [song],
        },
    ):
        directory = catalog.music_directory(album_id)

    assert directory["name"] == "Jane Doe"
    assert directory["parent"] == "ga-artist"
    assert directory["child"] == [song]
