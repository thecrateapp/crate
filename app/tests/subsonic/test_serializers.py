from __future__ import annotations

import json
from pathlib import Path

import pytest

from crate.subsonic.protocol import render_response
from crate.subsonic.serializers import (
    serialize_album,
    serialize_artist,
    serialize_artist_indexes,
    serialize_music_folders,
    serialize_song,
    serialize_user,
)


_GOLDEN = json.loads(
    Path(__file__).with_name("fixtures").joinpath("media_serializers.json").read_text()
)
_ARTIST_UID = "11111111-1111-4111-8111-111111111111"
_ALBUM_UID = "22222222-2222-4222-8222-222222222222"
_TRACK_UID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def global_artist():
    return {
        "global_artist_uid": _ARTIST_UID,
        "name": "Converge",
        "album_count": 1,
        "internal_catalog_key": "not-public",
    }


@pytest.fixture
def global_album():
    return {
        "global_album_uid": _ALBUM_UID,
        "global_artist_uid": _ARTIST_UID,
        "name": "Jane Doe",
        "artist": "Converge",
        "year": "2001",
        "track_count": 1,
        "duration": 94,
        "created": "2024-02-03T04:05:06Z",
        "has_cover": True,
        "internal_catalog_key": "not-public",
    }


@pytest.fixture
def global_song():
    return {
        "global_track_uid": _TRACK_UID,
        "global_album_uid": _ALBUM_UID,
        "global_artist_uid": _ARTIST_UID,
        "title": "Concubine",
        "artist": "Converge",
        "album": "Jane Doe",
        "track_number": 1,
        "disc_number": 1,
        "year": "2001",
        "duration": 94,
        "bitrate": 320,
        "format": "FLAC",
        "path": "Converge/Jane Doe/Concubine",
        "has_cover": True,
        "size": 42_000_000,
        "created": "2001-09-04T00:00:00Z",
        "internal_catalog_key": "not-public",
    }


def test_media_serializers_match_json_and_xml_golden_fixtures(
    global_artist, global_album, global_song
):
    payloads = {
        "musicFolders": serialize_music_folders(),
        "user": serialize_user(
            {
                "username": "diego",
                "email": "diego@example.test",
                "role": "admin",
                "password_hash": "must-not-escape",
            }
        ),
        "artists": serialize_artist_indexes([global_artist]),
        "artist": serialize_artist(global_artist, albums=[global_album]),
        "album": serialize_album(global_album, songs=[global_song]),
        "song": serialize_song(global_song),
    }

    assert payloads == _GOLDEN["json"]
    for name, payload in payloads.items():
        response = render_response({name: payload}, response_format="xml")
        assert response.body.decode() == _GOLDEN["xml"][name]


def test_global_song_has_parent_directory_flag_and_album_creation_date(
    global_album, global_song
):
    album = serialize_album(global_album)
    song = serialize_song(global_song)

    assert album["created"] == "2024-02-03T04:05:06Z"
    assert song["parent"] == album["id"]
    assert song["isDir"] is False


def test_song_serializer_does_not_emit_unrecognized_internal_fields(global_song):
    song = serialize_song(global_song)

    assert "internal_catalog_key" not in song
    assert set(song).issubset(
        {
            "id",
            "parent",
            "isDir",
            "title",
            "album",
            "artist",
            "track",
            "year",
            "coverArt",
            "size",
            "contentType",
            "suffix",
            "duration",
            "bitRate",
            "path",
            "discNumber",
            "created",
            "starred",
            "albumId",
            "artistId",
            "type",
        }
    )
