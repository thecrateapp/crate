"""Contract tests for the Subsonic API router.

Regressions in the Subsonic API break third-party integrations (Symfonium,
DSub, play:Sub, Ultrasonic, etc.). These tests verify every endpoint's
response shape, auth behavior, and error handling.
"""

from contextlib import contextmanager
import hashlib
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

_GLOBAL_ARTIST_UID = "11111111-1111-4111-8111-111111111111"
_GLOBAL_ALBUM_UID = "22222222-2222-4222-8222-222222222222"
_GLOBAL_TRACK_UID = "33333333-3333-4333-8333-333333333333"
_FAKE_GLOBAL_ARTISTS = [
    {
        "global_artist_uid": f"00000000-0000-4000-8000-{artist['id']:012d}",
        "name": artist["name"],
        "album_count": artist["album_count"],
    }
    for artist in _FAKE_ARTISTS
]
_FAKE_GLOBAL_ALBUM = {
    **_FAKE_ALBUM,
    "global_artist_uid": _GLOBAL_ARTIST_UID,
    "global_album_uid": _GLOBAL_ALBUM_UID,
}
_FAKE_GLOBAL_TRACK = {
    **_FAKE_TRACK,
    "global_artist_uid": _GLOBAL_ARTIST_UID,
    "global_album_uid": _GLOBAL_ALBUM_UID,
    "global_track_uid": _GLOBAL_TRACK_UID,
    "track_number": _FAKE_TRACK["track"],
    "disc_number": _FAKE_TRACK["disc"],
}


# ── Auth helpers ─────────────────────────────────────────────────────

_SUBSONIC_BASE = "/rest"


@contextmanager
def _subsonic_auth_ok():
    """Mock subsonic auth functions to authenticate successfully."""
    with patch("crate.subsonic.auth.authenticate", return_value=_FAKE_USER):
        yield


@contextmanager
def _subsonic_auth_fail():
    """Mock subsonic auth functions so authentication fails."""
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError

    with patch(
        "crate.subsonic.auth.authenticate",
        side_effect=OpenSubsonicError(ErrorCode.INVALID_CREDENTIALS, "invalid"),
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


class TestSubsonicRealAuth:
    """OpenSubsonic auth uses its dedicated credential, not Crate login."""

    @contextmanager
    def _credential(self, user):
        with (
            patch(
                "crate.subsonic.auth.get_user_subsonic_credential_by_identity",
                return_value=user,
            ),
            patch(
                "crate.subsonic.auth.load_secret",
                return_value={"secret": "dedicated-secret"},
            ),
        ):
            yield

    def test_ping_view_accepts_dedicated_plain_password(self, test_app):
        user = {
            **_FAKE_USER,
            "status": "active",
            "deleted_at": None,
            "suspended_at": None,
            "secret_ref": "opensubsonic:opaque-ref",
            "subsonic_token": None,
        }
        with self._credential(user):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/ping.view",
                params={"u": "admin", "p": "dedicated-secret"},
            )

        assert resp.status_code == 200
        _subsonic_ok_response(resp)

    def test_ping_view_accepts_hex_encoded_dedicated_password(self, test_app):
        user = {
            **_FAKE_USER,
            "status": "active",
            "deleted_at": None,
            "suspended_at": None,
            "secret_ref": "opensubsonic:opaque-ref",
            "subsonic_token": None,
        }
        encoded = "enc:" + "dedicated-secret".encode().hex()
        with self._credential(user):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/ping.view",
                params={"u": "admin", "p": encoded},
            )

        assert resp.status_code == 200
        _subsonic_ok_response(resp)

    def test_ping_view_rejects_main_crate_password(self, test_app):
        user = {
            **_FAKE_USER,
            "status": "active",
            "deleted_at": None,
            "suspended_at": None,
            "secret_ref": "opensubsonic:opaque-ref",
            "subsonic_token": None,
        }
        with self._credential(user):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/ping.view",
                params={"u": "admin", "p": "crate-login-password"},
            )

        assert resp.status_code == 200
        _subsonic_error_response(resp, code=40)

    def test_ping_view_accepts_token_auth_for_sso_only_user(self, test_app):
        salt = "substreamer-salt"
        subsonic_token = "generated-subsonic-token"
        token = hashlib.md5(("dedicated-secret" + salt).encode()).hexdigest()
        user = {
            **_FAKE_USER,
            "status": "active",
            "deleted_at": None,
            "suspended_at": None,
            "secret_ref": "opensubsonic:opaque-ref",
            "subsonic_token": subsonic_token,
        }

        with self._credential(user):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/ping.view",
                params={"u": "admin", "t": token, "s": salt},
            )

        assert resp.status_code == 200
        _subsonic_ok_response(resp)

    def test_missing_credentials_returns_unsupported_mechanism_error(self, test_app):
        resp = test_app.get(f"{_SUBSONIC_BASE}/ping.view")

        assert resp.status_code == 200
        _subsonic_error_response(resp, code=42)

    def test_invalid_api_key_preserves_standard_error_code_on_catalog_routes(
        self, test_app
    ):
        from crate.subsonic.errors import ErrorCode, OpenSubsonicError

        with patch(
            "crate.subsonic.auth.authenticate",
            side_effect=OpenSubsonicError(ErrorCode.INVALID_API_KEY, "Invalid API key"),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getArtists", params={"apiKey": "invalid"}
            )

        assert resp.status_code == 200
        _subsonic_error_response(resp, code=44)

    def test_get_license_ignores_unsupported_format_without_breaking_auth(
        self, test_app
    ):
        user = {
            **_FAKE_USER,
            "status": "active",
            "deleted_at": None,
            "suspended_at": None,
            "secret_ref": "opensubsonic:opaque-ref",
            "subsonic_token": None,
        }
        with self._credential(user):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getLicense.view",
                params={"u": "admin", "p": "dedicated-secret", "f": "json"},
            )

        assert resp.status_code == 200
        assert resp.headers.get("content-type", "").startswith("application/json")
        _subsonic_ok_response(resp)


# ── Browse endpoints ─────────────────────────────────────────────────


class TestSubsonicBrowse:
    """getArtists, getArtist, getAlbum, getSong."""

    def test_get_artists_with_index_grouping(self, test_app):
        artists = [dict(artist) for artist in _FAKE_GLOBAL_ARTISTS]
        artists[1]["has_photo"] = True
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.subsonic.services.catalog.list_global_artists",
                return_value=artists,
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
            assert artists[0]["coverArt"] == ("ga-00000000-0000-4000-8000-000000000002")
            assert "coverArt" not in artists[1]
            assert "ignoredArticles" in sr["artists"]

    def test_get_artists_unauthorized(self, test_app):
        with _subsonic_auth_fail():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtists?u=bad&p=bad")
            _subsonic_error_response(resp, code=40)

    def test_get_artist_by_id(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.subsonic.services.catalog.artist_detail",
                return_value={
                    "id": f"ga-{_GLOBAL_ARTIST_UID}",
                    "name": "Converge",
                    "albumCount": 1,
                    "coverArt": f"ga-{_GLOBAL_ARTIST_UID}",
                    "album": [{"name": "Jane Doe"}],
                },
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=ar-1")
            sr = _subsonic_ok_response(resp)
            a = sr["artist"]
            assert a["name"] == "Converge"
            assert a["id"] == f"ga-{_GLOBAL_ARTIST_UID}"
            assert a["albumCount"] == 1
            assert a["coverArt"] == f"ga-{_GLOBAL_ARTIST_UID}"
            assert len(a["album"]) == 1
            assert a["album"][0]["name"] == "Jane Doe"

    def test_get_artist_by_raw_id_is_rejected(self, test_app):
        with _subsonic_auth_ok():
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=2")

        _subsonic_error_response(resp, code=70)

    def test_get_artist_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.subsonic.services.catalog.artist_detail", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getArtist?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_album_with_songs(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.subsonic.services.catalog.album_detail",
                return_value={
                    "id": f"gal-{_GLOBAL_ALBUM_UID}",
                    "name": "Jane Doe",
                    "artist": "Converge",
                    "song": [
                        {
                            "id": f"gt-{_GLOBAL_TRACK_UID}",
                            "title": "Concubine",
                            "type": "music",
                            "suffix": "flac",
                            "contentType": "audio/flac",
                        }
                    ],
                },
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbum?u=admin&p=admin&id=al-1")
            sr = _subsonic_ok_response(resp)
            album = sr["album"]
            assert album["name"] == "Jane Doe"
            assert album["artist"] == "Converge"
            assert album["id"] == f"gal-{_GLOBAL_ALBUM_UID}"
            assert len(album["song"]) == 1
            song = album["song"][0]
            assert song["title"] == "Concubine"
            assert song["type"] == "music"
            assert song["suffix"] == "flac"
            assert song["contentType"] == "audio/flac"

    def test_get_album_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.subsonic.services.catalog.album_detail", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getAlbum?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_song(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.subsonic.services.catalog.song_detail",
                return_value={
                    "id": f"gt-{_GLOBAL_TRACK_UID}",
                    "title": "Concubine",
                    "artist": "Converge",
                    "album": "Jane Doe",
                    "suffix": "flac",
                    "contentType": "audio/flac",
                },
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=1")
            sr = _subsonic_ok_response(resp)
            song = sr["song"]
            assert song["id"] == f"gt-{_GLOBAL_TRACK_UID}"
            assert song["title"] == "Concubine"
            assert song["artist"] == "Converge"
            assert song["album"] == "Jane Doe"
            assert song["suffix"] == "flac"
            assert song["contentType"] == "audio/flac"

    def test_get_song_not_found(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.subsonic.services.catalog.song_detail", return_value=None),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=999")
            _subsonic_error_response(resp, code=70)

    def test_get_song_mp3_content_type(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.subsonic.services.catalog.song_detail",
                return_value={
                    "id": f"gt-{_GLOBAL_TRACK_UID}",
                    "contentType": "audio/mpeg",
                    "suffix": "mp3",
                },
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getSong?u=admin&p=admin&id=1")
            sr = _subsonic_ok_response(resp)
            assert sr["song"]["contentType"] == "audio/mpeg"
            assert sr["song"]["suffix"] == "mp3"


# ── Album lists ──────────────────────────────────────────────────────


class TestSubsonicAlbumList2:
    """getAlbumList2 with sorting strategies."""

    def test_album_list_default_order(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.list_global_albums",
                return_value=[_FAKE_GLOBAL_ALBUM],
            ),
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
            patch("crate.api.subsonic.legacy.list_global_albums", return_value=[]),
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
            patch(
                "crate.api.subsonic.legacy.list_global_albums",
                return_value=[_FAKE_GLOBAL_ALBUM],
            ),
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
                "crate.api.subsonic.legacy.search_global_catalog",
                return_value={
                    "artists": [
                        {
                            "global_artist_uid": _GLOBAL_ARTIST_UID,
                            "name": "Converge",
                        }
                    ],
                    "albums": [_FAKE_GLOBAL_ALBUM],
                    "tracks": [_FAKE_GLOBAL_TRACK],
                },
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
            patch(
                "crate.api.subsonic.legacy.search_global_catalog",
                return_value={"artists": [], "albums": [], "tracks": []},
            ),
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
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.get_starred_global_tracks", return_value=[]
            ),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/getStarred2?u=admin&p=admin")
            sr = _subsonic_ok_response(resp)
            assert sr["starred2"]["artist"] == []
            assert sr["starred2"]["album"] == []
            assert sr["starred2"]["song"] == []

    def test_random_songs(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.get_random_global_tracks",
                return_value=[_FAKE_GLOBAL_TRACK],
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
            patch(
                "crate.api.subsonic.legacy.get_random_global_tracks", return_value=[]
            ),
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
                "crate.api.subsonic.legacy.get_track_path_and_format",
                return_value=track_data,
            ),
            patch("crate.api.subsonic.legacy.library_path", return_value=tmp_path),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=1")
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "audio/flac"
            assert "Cache-Control" in resp.headers

    def test_stream_track_not_in_db(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.get_track_path_and_format", return_value=None
            ),
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
                "crate.api.subsonic.legacy.get_track_path_and_format",
                return_value=track_data,
            ),
            patch("crate.api.subsonic.legacy.library_path", return_value=tmp_path),
        ):
            resp = test_app.get(f"{_SUBSONIC_BASE}/stream?u=admin&p=admin&id=1")
            assert resp.status_code == 200

    def test_stream_file_missing_on_disk(self, test_app, tmp_path):
        track_data = {"id": 1, "path": "nonexistent.flac", "format": "flac"}

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.get_track_path_and_format",
                return_value=track_data,
            ),
            patch("crate.api.subsonic.legacy.library_path", return_value=tmp_path),
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
            patch(
                "crate.api.browse_album.api_cover_by_id", return_value=mock_response
            ) as cover,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=al-1&size=512"
            )
            assert resp.status_code == 200
            cover.assert_called_once_with(1, size=512)

    def test_cover_art_artist(self, test_app):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "image/jpeg"}

        def serve_photo(request, _artist_id, *, size=None, **_kwargs):
            assert request.state.user == _FAKE_USER
            assert size == 512
            return mock_response

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.browse_artist.api_artist_photo_by_id",
                side_effect=serve_photo,
            ) as photo,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=ar-1&size=512"
            )
            assert resp.status_code == 200
            assert photo.call_args.kwargs["size"] == 512

    def test_cover_art_rejects_oversized_image_requests(self, test_app):
        with _subsonic_auth_ok():
            response = test_app.get(
                f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=al-1&size=2049"
            )

        assert response.status_code == 422

    def test_playlist_cover_art_is_authorized_and_uses_variant_delivery(self, test_app):
        from fastapi import Response

        image = Response(b"playlist-cover", media_type="image/webp")
        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.serve_playlist_cover",
                return_value=image,
            ) as serve,
        ):
            response = test_app.get(
                f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=pl-7&size=384"
            )

        assert response.status_code == 200
        assert response.content == b"playlist-cover"
        serve.assert_called_once_with(7, user=_FAKE_USER, size=384)

    def test_private_playlist_cover_is_not_visible_to_another_user(self, test_app):
        from fastapi import Response

        with (
            _subsonic_auth_ok(),
            patch(
                "crate.api.subsonic.legacy.serve_playlist_cover",
                return_value=Response(status_code=404),
            ) as serve,
        ):
            response = test_app.get(
                f"{_SUBSONIC_BASE}/getCoverArt?u=admin&p=admin&id=pl-7"
            )

        assert response.status_code == 404
        serve.assert_called_once_with(7, user=_FAKE_USER, size=None)

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
            patch("crate.api.subsonic.legacy.get_track_full", return_value=_FAKE_TRACK),
            patch(
                "crate.playback_provenance.resolve_local_content_provenance",
                return_value=("local", None),
            ),
            patch("crate.db.repositories.user_library.record_play_event"),
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=1&submission=true"
            )
            _subsonic_ok_response(resp)

    def test_scrobble_now_playing(self, test_app):
        """submission=false is a 'now playing' notification — no play recorded."""
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.legacy.get_track_full", return_value=_FAKE_TRACK),
            patch(
                "crate.db.repositories.user_library.record_play_event"
            ) as mock_record,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=1&submission=false"
            )
            _subsonic_ok_response(resp)
            mock_record.assert_not_called()

    def test_scrobble_submission_post(self, test_app):
        with (
            _subsonic_auth_ok(),
            patch("crate.api.subsonic.legacy.get_track_full", return_value=_FAKE_TRACK),
            patch(
                "crate.playback_provenance.resolve_local_content_provenance",
                return_value=("local", None),
            ),
            patch("crate.db.repositories.user_library.record_play_event"),
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
            patch("crate.api.subsonic.legacy.get_track_full", return_value=None),
            patch(
                "crate.db.repositories.user_library.record_play_event"
            ) as mock_record,
        ):
            resp = test_app.get(
                f"{_SUBSONIC_BASE}/scrobble?u=admin&p=admin&id=999&submission=true"
            )
            _subsonic_ok_response(resp)
            mock_record.assert_not_called()
