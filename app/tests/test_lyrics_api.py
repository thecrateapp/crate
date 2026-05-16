"""Contract tests for the Lyrics API endpoints."""

from unittest.mock import patch


async def _unauthenticated(self, request):
    return None


class TestLyricsAPI:
    def test_get_lyrics_returns_synced_and_plain(self, test_app):
        payload = {
            "syncedLyrics": "[00:01.00]Hello world",
            "plainLyrics": "Hello world",
        }
        with patch("crate.api.lyrics.get_or_fetch_lyrics", return_value=payload):
            resp = test_app.get("/api/lyrics?artist=Radiohead&title=Creep")
        assert resp.status_code == 200
        assert resp.json()["syncedLyrics"] == "[00:01.00]Hello world"
        assert resp.json()["plainLyrics"] == "Hello world"

    def test_get_lyrics_synced_only(self, test_app):
        payload = {"syncedLyrics": "[00:01.00]Hello", "plainLyrics": None}
        with patch("crate.api.lyrics.get_or_fetch_lyrics", return_value=payload):
            resp = test_app.get("/api/lyrics?artist=Radiohead&title=Creep")
        assert resp.status_code == 200
        assert resp.json()["syncedLyrics"] == "[00:01.00]Hello"
        assert resp.json()["plainLyrics"] is None

    def test_get_lyrics_plain_only(self, test_app):
        payload = {"syncedLyrics": None, "plainLyrics": "Plain text lyrics"}
        with patch("crate.api.lyrics.get_or_fetch_lyrics", return_value=payload):
            resp = test_app.get("/api/lyrics?artist=Radiohead&title=Creep")
        assert resp.status_code == 200
        assert resp.json()["syncedLyrics"] is None
        assert resp.json()["plainLyrics"] == "Plain text lyrics"

    def test_get_lyrics_missing_returns_none(self, test_app):
        payload = {"syncedLyrics": None, "plainLyrics": None}
        with patch("crate.api.lyrics.get_or_fetch_lyrics", return_value=payload):
            resp = test_app.get("/api/lyrics?artist=Unknown&title=Nowhere")
        assert resp.status_code == 200
        assert resp.json()["syncedLyrics"] is None
        assert resp.json()["plainLyrics"] is None

    def test_get_lyrics_missing_artist_returns_400(self, test_app):
        resp = test_app.get("/api/lyrics?artist=&title=Creep")
        assert resp.status_code == 400

    def test_get_lyrics_missing_title_returns_400(self, test_app):
        resp = test_app.get("/api/lyrics?artist=Radiohead&title=")
        assert resp.status_code == 400

    def test_get_lyrics_missing_both_params_returns_400(self, test_app):
        resp = test_app.get("/api/lyrics")
        assert resp.status_code == 400

    def test_get_lyrics_whitespace_only_params_returns_400(self, test_app):
        resp = test_app.get("/api/lyrics?artist=+++&title=+++")
        assert resp.status_code == 400

    def test_get_lyrics_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/lyrics?artist=Radiohead&title=Creep")
        assert resp.status_code == 401

    def test_get_lyrics_passes_artist_and_title_to_fetcher(self, test_app):
        with patch(
            "crate.api.lyrics.get_or_fetch_lyrics",
            return_value={"syncedLyrics": None, "plainLyrics": None},
        ) as mock_fetch:
            test_app.get("/api/lyrics?artist=Converge&title=Jane+Doe")
        mock_fetch.assert_called_once_with("Converge", "Jane Doe")
