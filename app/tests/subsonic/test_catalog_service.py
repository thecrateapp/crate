from crate.subsonic.services import catalog


_ARTIST_UID = "11111111-1111-4111-8111-111111111111"
_ALBUM_UID = "22222222-2222-4222-8222-222222222222"
_TRACK_UID = "33333333-3333-4333-8333-333333333333"


def test_legacy_local_artist_id_returns_stable_global_id(monkeypatch):
    artist = {
        "id": 7,
        "global_artist_uid": _ARTIST_UID,
        "name": "Converge",
        "album_count": 1,
    }
    album = {
        "id": 4,
        "global_album_uid": _ALBUM_UID,
        "global_artist_uid": _ARTIST_UID,
        "name": "Jane Doe",
        "artist": "Converge",
        "artist_id": 7,
        "year": 2001,
        "track_count": 1,
        "duration": 94,
        "created": "2024-02-03T04:05:06Z",
    }
    monkeypatch.setattr(
        catalog, "get_global_artist_by_local_id", lambda _: artist, raising=False
    )
    monkeypatch.setattr(catalog, "list_global_artist_albums", lambda _: [album])

    result = catalog.artist_detail("ar-7")

    assert result is not None
    assert result["id"] == f"ga-{_ARTIST_UID}"
    assert result["album"][0]["id"] == f"gal-{_ALBUM_UID}"


def test_legacy_local_album_and_track_ids_return_stable_global_ids(monkeypatch):
    album = {
        "id": 4,
        "global_album_uid": _ALBUM_UID,
        "global_artist_uid": _ARTIST_UID,
        "name": "Jane Doe",
        "artist": "Converge",
        "year": 2001,
        "track_count": 1,
        "duration": 94,
        "has_cover": True,
        "created": "2024-02-03T04:05:06Z",
    }
    song = {
        "id": 8,
        "global_track_uid": _TRACK_UID,
        "global_album_uid": _ALBUM_UID,
        "global_artist_uid": _ARTIST_UID,
        "title": "Concubine",
        "artist": "Converge",
        "album": "Jane Doe",
        "track_number": 1,
        "disc_number": 1,
        "year": 2001,
        "duration": 94,
        "format": "flac",
        "has_cover": True,
        "path": "Converge/Jane Doe/Concubine",
    }
    monkeypatch.setattr(
        catalog, "get_global_album_by_local_id", lambda _: album, raising=False
    )
    monkeypatch.setattr(catalog, "list_global_album_tracks", lambda _: [song])
    monkeypatch.setattr(
        catalog, "get_global_track_by_local_id", lambda _: song, raising=False
    )

    album_result = catalog.album_detail("al-4")
    song_result = catalog.song_detail("8")

    assert album_result is not None
    assert album_result["id"] == f"gal-{_ALBUM_UID}"
    assert album_result["song"][0]["id"] == f"gt-{_TRACK_UID}"
    assert song_result is not None
    assert song_result["id"] == f"gt-{_TRACK_UID}"
