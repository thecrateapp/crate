from typing import Any, cast

from crate.api import browse_artist
from crate.api.browse_album import _pre_release_album_payload
from crate.api.browse_album import api_album_by_artist_slug
import crate.db.releases as release_queries


def test_pre_release_album_payload_keeps_full_tracklist_with_availability(
    monkeypatch,
):
    monkeypatch.setattr("crate.api.browse_album._require_auth", lambda _request: {})
    monkeypatch.setattr(
        "crate.api.browse_album.get_artist_release_track_matches",
        lambda _artist: {
            "get to it": [
                {
                    "id": 321,
                    "entity_uid": "track-entity",
                    "storage_id": "track-storage",
                    "filename": "01 - Get To It.flac",
                    "title": "Get To It",
                    "artist": "Quicksand",
                    "album": "Get to It & Regenerate",
                    "track_number": 1,
                    "disc_number": 1,
                    "format": "flac",
                    "bitrate": 1411000,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                    "duration": 164,
                    "size": 12_000_000,
                    "genre": "post-hardcore",
                    "path": "Quicksand/Get to It & Regenerate/01.flac",
                    "rating": 0,
                }
            ]
        },
    )

    payload = _pre_release_album_payload(
        cast(Any, object()),
        {
            "id": 12,
            "entity_uid": "artist-entity",
            "slug": "quicksand",
            "name": "Quicksand",
        },
        {
            "id": 46,
            "artist_name": "Quicksand",
            "album_title": "Bring On The Psychics",
            "release_date": "2026-07-17",
            "release_type": "Album",
            "status": "detected",
            "cover_url": "https://img.example/cover.jpg",
            "source_url": "https://tidal.com/album/preview",
            "mb_release_group_id": "rg-123",
            "tracklist_json": [
                {"position": 1, "title": "Get To It", "duration": 164},
                {"position": 2, "title": "Regenerate", "duration": 180},
            ],
            "preview_tracks_json": [
                {
                    "position": 2,
                    "title": "Regenerate",
                    "source_url": "https://tidal.com/track/2",
                }
            ],
        },
    )

    assert payload["is_pre_release"] is True
    assert payload["id"] == -46
    assert payload["track_count"] == 2
    assert payload["playable_track_count"] == 1
    assert payload["tracks"][0]["id"] == 321
    assert payload["tracks"][0]["is_available"] is True
    assert payload["tracks"][1]["tags"]["title"] == "Regenerate"
    assert payload["tracks"][1]["is_available"] is False
    assert payload["tracks"][1]["source_url"] == "https://tidal.com/track/2"


def test_album_slug_route_prefers_pre_release_payload_over_local_partial_album(
    monkeypatch,
):
    monkeypatch.setattr(
        "crate.api.browse_album.get_library_artist_by_slug",
        lambda _slug: {"id": 7, "slug": "converge", "name": "Converge"},
    )
    monkeypatch.setattr(
        "crate.api.browse_album.find_upcoming_release_by_artist_album_slug",
        lambda _artist, _album_slug: {
            "id": 91,
            "artist_name": "Converge",
            "album_title": "Hum Of Hurt",
        },
    )

    called_local_album = False

    def _local_album(*_args, **_kwargs):
        nonlocal called_local_album
        called_local_album = True
        return {"id": 5}

    monkeypatch.setattr("crate.api.browse_album.api_album", _local_album)
    monkeypatch.setattr(
        "crate.api.browse_album._pre_release_album_payload",
        lambda _request, _artist, release: {
            "id": -release["id"],
            "is_pre_release": True,
        },
    )

    payload = api_album_by_artist_slug(cast(Any, object()), "converge", "hum-of-hurt")

    assert payload == {"id": -91, "is_pre_release": True}
    assert called_local_album is False


def test_find_upcoming_release_matches_artist_prefixed_album_slug(monkeypatch):
    monkeypatch.setattr(
        release_queries,
        "get_upcoming_releases_for_artist",
        lambda _artist: [{"id": 91, "album_title": "Hum Of Hurt"}],
    )

    release = release_queries.find_upcoming_release_by_artist_album_slug(
        "Converge",
        "converge-hum-of-hurt",
    )

    assert release and release["id"] == 91


def test_pre_release_album_payload_uses_tidal_tracklist_fallback(monkeypatch):
    monkeypatch.setattr("crate.api.browse_album._require_auth", lambda _request: {})
    monkeypatch.setattr(
        "crate.api.browse_album.get_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.api.browse_album.set_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.api.browse_album.get_artist_release_track_matches",
        lambda _artist: {
            "hum of hurt": [
                {
                    "id": 901,
                    "entity_uid": "track-hum",
                    "storage_id": "storage-hum",
                    "filename": "09 - Hum Of Hurt.flac",
                    "title": "Hum Of Hurt",
                    "artist": "Converge",
                    "album": "Hum Of Hurt",
                    "track_number": 9,
                    "disc_number": 1,
                    "format": "flac",
                    "bitrate": 1411000,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                    "duration": 180,
                    "size": 12_000_000,
                    "genre": "hardcore",
                    "path": "Converge/Hum Of Hurt/09.flac",
                    "rating": 0,
                }
            ],
            "i wont let you go": [
                {
                    "id": 902,
                    "entity_uid": "track-live",
                    "storage_id": "storage-live",
                    "filename": "05 - I Won't Let You Go (Live).flac",
                    "title": "I Won't Let You Go (Live in Orlando, FL 3/14/2022)",
                    "artist": "Converge",
                    "album": "Live in Orlando, FL 3/14/2022",
                    "track_number": 5,
                    "disc_number": 1,
                    "format": "flac",
                    "bitrate": 1411000,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                    "duration": 180,
                    "size": 12_000_000,
                    "genre": "hardcore",
                    "path": "Converge/Live/05.flac",
                    "rating": 0,
                }
            ],
        },
    )

    from crate import tidal as tidal_mod

    monkeypatch.setattr(
        tidal_mod,
        "get_album_tracks",
        lambda album_id: [
            {
                "id": "7009",
                "title": "Hum Of Hurt",
                "display_title": "Hum Of Hurt",
                "track_number": 9,
                "volume_number": 1,
                "duration": 180,
                "url": f"https://tidal.com/track/{album_id}-9",
            }
        ],
    )

    payload = _pre_release_album_payload(
        cast(Any, object()),
        {
            "id": 7,
            "entity_uid": "artist-entity",
            "slug": "converge",
            "name": "Converge",
        },
        {
            "id": 91,
            "artist_name": "Converge",
            "album_title": "Hum Of Hurt",
            "release_date": "2026-06-05",
            "tracks": 10,
            "tidal_id": "515000",
            "tracklist_json": [],
            "preview_tracks_json": [],
        },
    )

    assert payload["is_pre_release"] is True
    assert payload["track_count"] == 10
    assert payload["playable_track_count"] == 1
    assert payload["tracks"][0]["id"] == 901
    assert payload["tracks"][0]["tags"]["tracknumber"] == "9"


def test_pre_release_album_payload_prefers_musicbrainz_tracklist_fallback(
    monkeypatch,
):
    monkeypatch.setattr("crate.api.browse_album._require_auth", lambda _request: {})
    monkeypatch.setattr(
        "crate.api.browse_album.get_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.api.browse_album.set_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.api.browse_album.get_artist_release_track_matches",
        lambda _artist: {
            "hum of hurt": [
                {
                    "id": 901,
                    "entity_uid": "track-hum",
                    "storage_id": "storage-hum",
                    "filename": "09 - Hum Of Hurt.flac",
                    "title": "Hum Of Hurt",
                    "artist": "Converge",
                    "album": "Hum Of Hurt",
                    "track_number": 9,
                    "disc_number": 1,
                    "format": "flac",
                    "bitrate": 1411000,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                    "duration": 180,
                    "size": 12_000_000,
                    "genre": "hardcore",
                    "path": "Converge/Hum Of Hurt/09.flac",
                    "rating": 0,
                }
            ]
        },
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_release_group_tracklist",
        lambda _mbid: [
            {"position": 1, "title": "Slip the Noose", "duration": 104},
            {"position": 5, "title": "I Won't Let You Go", "duration": 177},
            {"position": 9, "title": "Hum Of Hurt", "duration": 180},
        ],
    )

    from crate import tidal as tidal_mod

    monkeypatch.setattr(
        tidal_mod,
        "get_album_tracks",
        lambda _album_id: [
            {
                "id": "7009",
                "title": "Hum Of Hurt",
                "display_title": "Hum Of Hurt",
                "track_number": 9,
                "volume_number": 1,
                "duration": 180,
            }
        ],
    )

    payload = _pre_release_album_payload(
        cast(Any, object()),
        {
            "id": 7,
            "entity_uid": "artist-entity",
            "slug": "converge",
            "name": "Converge",
        },
        {
            "id": 91,
            "artist_name": "Converge",
            "album_title": "Hum Of Hurt",
            "release_date": "2026-06-05",
            "tracks": 10,
            "tidal_id": "515000",
            "mb_release_group_id": "rg-hum",
            "tracklist_json": [],
            "preview_tracks_json": [],
        },
    )

    assert payload["track_count"] == 10
    assert [track["tags"]["title"] for track in payload["tracks"]] == [
        "Slip the Noose",
        "I Won't Let You Go",
        "Hum Of Hurt",
    ]
    assert payload["playable_track_count"] == 1


def test_artist_payload_marks_matching_local_album_as_pre_release(monkeypatch):
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {})
    monkeypatch.setattr(browse_artist, "has_library_data", lambda: True)
    monkeypatch.setattr(
        browse_artist,
        "get_library_artist",
        lambda _name: {
            "id": 7,
            "entity_uid": "artist-entity",
            "slug": "converge",
            "name": "Converge",
            "track_count": 1,
            "total_size": 10,
            "folder_name": "Converge",
            "primary_format": "flac",
            "popularity": None,
            "popularity_score": None,
            "popularity_confidence": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(
        browse_artist,
        "get_library_albums",
        lambda _artist: [
            {
                "id": 5,
                "entity_uid": "album-entity",
                "slug": "converge-hum-of-hurt",
                "name": "Hum Of Hurt",
                "track_count": 1,
                "formats": ["flac"],
                "total_size": 12_000_000,
                "year": "2026",
                "has_cover": False,
                "musicbrainz_albumid": None,
                "popularity": None,
                "popularity_score": None,
                "popularity_confidence": None,
            }
        ],
    )
    monkeypatch.setattr(browse_artist, "get_album_quality_map", lambda _ids: {})
    monkeypatch.setattr(browse_artist, "get_artist_top_genres", lambda _artist: [])
    monkeypatch.setattr(browse_artist, "get_artist_genre_profile", lambda _artist: [])
    monkeypatch.setattr(
        browse_artist, "build_genre_profile", lambda _items, limit=8: []
    )
    monkeypatch.setattr(browse_artist, "get_artist_issue_count", lambda _artist: 0)
    monkeypatch.setattr(
        browse_artist,
        "get_upcoming_releases_for_artist",
        lambda _artist: [
            {
                "id": 91,
                "artist_name": "Converge",
                "album_title": "Hum Of Hurt",
                "release_date": "2026-11-01",
                "status": "detected",
                "release_type": "Album",
                "cover_url": "https://img.example/hum.jpg",
                "source_url": "https://tidal.com/album/91",
                "tidal_url": "",
                "mb_release_group_id": "rg-hum",
                "tracks": 10,
                "tracklist_json": [],
            }
        ],
    )

    payload = browse_artist.api_artist(cast(Any, object()), "Converge")

    assert len(payload["albums"]) == 1
    album = payload["albums"][0]
    assert album["id"] == 5
    assert album["slug"] == "hum-of-hurt"
    assert album["is_pre_release"] is True
    assert album["tracks"] == 10
    assert album["cover_url"] == "https://img.example/hum.jpg"
    assert album["release_date"] == "2026-11-01"
