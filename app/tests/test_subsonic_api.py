"""Contract tests for the Subsonic API router.

Regressions in the Subsonic API break third-party integrations (Symfonium,
DSub, play:Sub, Ultrasonic, etc.). These tests verify every endpoint's
response shape, auth behavior, and error handling.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

# ── Synthetic test data ──────────────────────────────────────────────

_FAKE_USER = {
    "id": 1,
    "email": "admin@cratemusic.app",
    "username": "admin",
    "role": "admin",
    "password_hash": "$2b$12$...",
}

_FAKE_ARTISTS = [
    {"id": 1, "name": "Converge", "album_count": 10},
    {"id": 2, "name": "Birds In Row", "album_count": 4},
    {"id": 3, "name": "Radiohead", "album_count": 9},
]

_FAKE_ALBUM = {
    "id": 1,
    "name": "Jane Doe",
    "artist": "Converge",
    "artist_id": 1,
    "year": "2001",
    "track_count": 12,
    "duration": 2700,
    "has_cover": 1,
}

_FAKE_TRACK = {
    "id": 1,
    "title": "Concubine",
    "artist": "Converge",
    "album": "Jane Doe",
    "album_id": 1,
    "artist_id": 1,
    "track": 1,
    "disc": 1,
    "year": "2001",
    "duration": 94.0,
    "bitrate": 320,
    "format": "flac",
    "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
    "has_cover": 1,
    "track_number": 1,
    "disc_number": 1,
}

_FAKE_TRACK_BASIC = {
    "id": 1,
    "title": "Concubine",
    "artist": "Converge",
    "album": "Jane Doe",
    "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
}


# ── Auth helpers ─────────────────────────────────────────────────────

_SUBSONIC_BASE = "/rest"


@contextmanager
def _subsonic_auth_ok():
    """Mock subsonic auth functions to authenticate successfully."""
    with (
        patch("crate.api.subsonic.get_user_by_email", return_value=_FAKE_USER),
        patch("crate.api.subsonic.get_user_by_username", return_value=_FAKE_USER),
        patch("crate.api.subsonic.verify_password", return_value=True),
    ):
        yield


@contextmanager
def _subsonic_auth_fail():
    """Mock subsonic auth functions so authentication fails."""
    with (
        patch("crate.api.subsonic.get_user_by_email", return_value=None),
        patch("crate.api.subsonic.get_user_by_username", return_value=None),
    ):
        yield


def _subsonic_error_response(resp, code=None):
    """Extract the subsonic-response envelope and assert it's a failure."""
    data = resp.json()
    sr = data["subsonic-response"]
    assert sr["status"] == "failed"
    assert "error" in sr
    if code is not None:
        assert sr["error"]["code"] == code
    return sr


def _subsonic_ok_response(resp):
    """Extract the subsonic-response envelope and assert it's success."""
    data = resp.json()
    sr = data["subsonic-response"]
    assert sr["status"] == "ok"
    assert sr["version"] == "1.16.1"
    assert sr["type"] == "Crate"
    return sr


# ── System endpoints ─────────────────────────────────────────────────


class TestSubsonicSystem:
    """Ping, getLicense, getMusicFolders, getUser."""

    def test_ping_authenticated(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/ping?u=admin&p=admin")
            assert resp.status_code == 200
            _subsonic_ok_response(resp)

    def test_ping_wrong_credentials(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/ping?u=bad&p=bad")
            assert resp.status_code == 200
            _subsonic_error_response(resp, code=40)

    def test_ping_response_is_json(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/ping?u=admin&p=admin")
            assert resp.headers.get("content-type", "").startswith("application/json")

    def test_ping_missing_credentials(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/ping")
            assert resp.status_code == 200
            _subsonic_error_response(resp, code=40)

    def test_get_license_authenticated(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getLicense?u=admin&p=admin")
            assert resp.status_code == 200
            sr = _subsonic_ok_response(resp)
            assert sr["license"]["valid"] is True
            assert "licenseExpires" in sr["license"]

    def test_get_license_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getLicense?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)

    def test_get_music_folders(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getMusicFolders?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            mfs = sr["musicFolders"]["musicFolder"]
            assert len(mfs) == 1
            assert mfs[0]["id"] == 1
            assert mfs[0]["name"] == "Music"

    def test_get_user(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getUser?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            user = sr["user"]
            assert user["username"] == "admin"
            assert user["email"] == "admin@cratemusic.app"
            assert user["streamRole"] is True
            assert user["adminRole"] is True
            assert "scrobblingEnabled" in user


# ── Browse endpoints ─────────────────────────────────────────────────


class TestSubsonicBrowse:
    """getArtists, getArtist, getAlbum, getSong."""

    def test_get_artists_with_index_grouping(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.get_all_artists_sorted", return_value=_FAKE_ARTISTS
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtists?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            indexes = sr["artists"]["index"]
            assert isinstance(indexes, list)
            artists = [a for idx in indexes for a in idx["artist"]]
            assert len(artists) == 3
            # Sorted alphabetically
            assert artists[0]["name"] == "Birds In Row"
            assert artists[1]["name"] == "Converge"
            assert artists[2]["name"] == "Radiohead"
            assert "ignoredArticles" in sr["artists"]

    def test_get_artists_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtists?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)

    def test_get_artist_by_id(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_artist_by_id", return_value=_FAKE_ARTISTS[0]),
            patch(
                "crate.api.subsonic.get_albums_by_artist_name",
                return_value=[_FAKE_ALBUM],
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=ar-1")
            sr = _subsonic_ok_response(resp)
            a = sr["artist"]
            assert a["name"] == "Converge"
            assert a["id"] == "ar-1"
            assert a["albumCount"] == 1
            assert len(a["album"]) == 1
            assert a["album"][0]["name"] == "Jane Doe"

    def test_get_artist_by_raw_id(self, test_app):
        """Artist id without the 'ar-' prefix should also work."""
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_artist_by_id", return_value=_FAKE_ARTISTS[1]),
            patch("crate.api.subsonic.get_albums_by_artist_name", return_value=[]),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=2")
            sr = _subsonic_ok_response(resp)
            assert sr["artist"]["name"] == "Birds In Row"

    def test_get_artist_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_artist_by_id", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_album_with_songs(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_album_with_artist", return_value=_FAKE_ALBUM),
            patch(
                "crate.api.subsonic.get_tracks_by_album_id",
                return_value=[_FAKE_TRACK],
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbum?u=admin&p=admin&id=al-1")
            sr = _subsonic_ok_response(resp)
            album = sr["album"]
            assert album["name"] == "Jane Doe"
            assert album["artist"] == "Converge"
            assert album["id"] == "al-1"
            assert len(album["song"]) == 1
            song = album["song"][0]
            assert song["title"] == "Concubine"
            assert song["type"] == "music"
            assert song["suffix"] == "flac"
            assert song["contentType"] == "audio/flac"

    def test_get_album_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_album_with_artist", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbum?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_song(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_full", return_value=_FAKE_TRACK),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=1")
            sr = _subsonic_ok_response(resp)
            song = sr["song"]
            assert song["id"] == "1"
            assert song["title"] == "Concubine"
            assert song["artist"] == "Converge"
            assert song["album"] == "Jane Doe"
            assert song["suffix"] == "flac"
            assert song["contentType"] == "audio/flac"

    def test_get_song_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_full", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_song_mp3_content_type(self, test_app):
        mp3_track = {**_FAKE_TRACK, "format": "mp3"}
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_full", return_value=mp3_track),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=1")
            sr = _subsonic_ok_response(resp)
            assert sr["song"]["contentType"] == "audio/mpeg"
            assert sr["song"]["suffix"] == "mp3"


# ── Album lists ──────────────────────────────────────────────────────


class TestSubsonicAlbumList2:
    """getAlbumList2 with sorting strategies."""

    def test_album_list_default_order(self, test_app):
        albums = [_FAKE_ALBUM]
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_album_list", return_value=albums),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbumList2?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            al = sr["albumList2"]["album"]
            assert len(al) == 1
            assert al[0]["name"] == "Jane Doe"
            assert al[0]["artist"] == "Converge"

    def test_album_list_with_type_and_pagination(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_album_list", return_value=[]),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getAlbumList2?u=admin&p=admin"
                "&type=newest&size=5&offset=0"
            )
            sr = _subsonic_ok_response(resp)
            assert sr["albumList2"]["album"] == []

    def test_album_list_with_random_type(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_album_list", return_value=[_FAKE_ALBUM]),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getAlbumList2?u=admin&p=admin&type=random"
            )
            sr = _subsonic_ok_response(resp)
            assert len(sr["albumList2"]["album"]) == 1

    def test_album_list_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbumList2?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)


# ── Search ───────────────────────────────────────────────────────────


class TestSubsonicSearch:
    """search3 endpoint."""

    def test_search_returns_all_categories(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.search_artists",
                return_value=[{"id": 1, "name": "Converge"}],
            ),
            patch(
                "crate.api.subsonic.search_albums",
                return_value=[_FAKE_ALBUM],
            ),
            patch(
                "crate.api.subsonic.search_tracks",
                return_value=[_FAKE_TRACK],
            ),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/search3?u=admin&p=admin&query=converge"
            )
            sr = _subsonic_ok_response(resp)
            result = sr["searchResult3"]
            assert len(result["artist"]) == 1
            assert len(result["album"]) == 1
            assert len(result["song"]) == 1
            assert result["artist"][0]["name"] == "Converge"
            assert result["song"][0]["title"] == "Concubine"

    def test_search_empty_query(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.search_artists", return_value=[]),
            patch("crate.api.subsonic.search_albums", return_value=[]),
            patch("crate.api.subsonic.search_tracks", return_value=[]),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/search3?u=admin&p=admin&query=")
            sr = _subsonic_ok_response(resp)
            result = sr["searchResult3"]
            assert result["artist"] == []
            assert result["album"] == []
            assert result["song"] == []

    def test_search_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/search3?u=bad&p=bad&query=test")
            _subsonic_error_response(resp, code=40)


# ── Stubs ────────────────────────────────────────────────────────────


class TestSubsonicStubs:
    """getPlaylists, getStarred2, getRandomSongs."""

    def test_playlists_returns_empty_list(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getPlaylists?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            assert sr["playlists"]["playlist"] == []

    def test_playlists_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getPlaylists?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)

    def test_starred2_returns_empty_lists(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getStarred2?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            assert sr["starred2"]["artist"] == []
            assert sr["starred2"]["album"] == []
            assert sr["starred2"]["song"] == []

    def test_random_songs(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.get_random_tracks",
                return_value=[_FAKE_TRACK],
            ),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getRandomSongs?u=admin&p=admin&size=5"
            )
            sr = _subsonic_ok_response(resp)
            songs = sr["randomSongs"]["song"]
            assert len(songs) == 1
            assert songs[0]["title"] == "Concubine"
            assert songs[0]["type"] == "music"

    def test_random_songs_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getRandomSongs?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)

    def test_random_songs_empty(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_random_tracks", return_value=[]),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getRandomSongs?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            assert sr["randomSongs"]["song"] == []


# ── Stream & Cover Art ───────────────────────────────────────────────


class TestSubsonicStream:
    """stream endpoint."""

    def test_stream_serves_file(self, test_app, tmp_path):
        test_file = tmp_path / "01 - Test.flac"
        test_file.write_bytes(b"fake audio data")
        track_data = {"id": 1, "path": "01 - Test.flac", "format": "flac"}

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.get_track_path_and_format", return_value=track_data
            ),
            patch("crate.api.subsonic.library_path", return_value=tmp_path),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=1")
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "audio/flac"
            assert "Cache-Control" in resp.headers

    def test_stream_track_not_in_db(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_path_and_format", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=999")
            assert resp.status_code == 404

    def test_stream_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=bad&p=bad&id=1")
            _subsonic_error_response(resp, code=40)

    def test_stream_absolute_path_serves(self, test_app, tmp_path):
        test_file = tmp_path / "track.flac"
        test_file.write_bytes(b"fake audio")
        track_data = {"id": 1, "path": str(test_file), "format": "flac"}

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.get_track_path_and_format", return_value=track_data
            ),
            patch("crate.api.subsonic.library_path", return_value=tmp_path),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=1")
            assert resp.status_code == 200

    def test_stream_file_missing_on_disk(self, test_app, tmp_path):
        track_data = {"id": 1, "path": "nonexistent.flac", "format": "flac"}

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.get_track_path_and_format", return_value=track_data
            ),
            patch("crate.api.subsonic.library_path", return_value=tmp_path),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=1")
            assert resp.status_code == 404


class TestSubsonicCoverArt:
    """getCoverArt endpoint."""

    def test_cover_art_album(self, test_app):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "image/jpeg"}

        with (
            _subsonic_auth_ok(),
            patch("crate.api.browse_album.api_cover_by_id", return_value=mock_response),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=al-1")
            assert resp.status_code == 200

    def test_cover_art_artist(self, test_app):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "image/jpeg"}

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.browse_artist.api_artist_photo_by_id",
                return_value=mock_response,
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=ar-1")
            assert resp.status_code == 200

    def test_cover_art_invalid_prefix(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=xx-1")
            assert resp.status_code == 404

    def test_cover_art_no_id(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=")
            assert resp.status_code == 404

    def test_cover_art_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getCoverArt?u=bad&p=bad&id=al-1")
            _subsonic_error_response(resp, code=40)


# ── Scrobble ─────────────────────────────────────────────────────────


class TestSubsonicScrobble:
    """scrobble endpoint (GET and POST)."""

    def test_scrobble_submission_get(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_basic", return_value=_FAKE_TRACK_BASIC),
            patch("crate.db.repositories.user_library.record_play"),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=1&submission=true"
            )
            _subsonic_ok_response(resp)

    def test_scrobble_now_playing(self, test_app):
        """submission=false is a 'now playing' notification — no play recorded."""
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_basic", return_value=_FAKE_TRACK_BASIC),
            patch("crate.db.repositories.user_library.record_play") as mock_record,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=1&submission=false"
            )
            _subsonic_ok_response(resp)
            mock_record.assert_not_called()

    def test_scrobble_submission_post(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_basic", return_value=_FAKE_TRACK_BASIC),
            patch("crate.db.repositories.user_library.record_play"),
        ):
            resp = test_app.post(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=1&submission=true"
            )
            _subsonic_ok_response(resp)

    def test_scrobble_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/scrobble?u=bad&p=bad&id=1")
            _subsonic_error_response(resp, code=40)

    def test_scrobble_track_not_found_still_ok(self, test_app):
        """When track doesn't exist, scrobble still returns ok (no crash)."""
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.get_track_basic", return_value=None),
            patch("crate.db.repositories.user_library.record_play") as mock_record,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=999&submission=true"
            )
            _subsonic_ok_response(resp)
            mock_record.assert_not_called()
