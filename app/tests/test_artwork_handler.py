import base64
import io
from pathlib import Path
from unittest.mock import MagicMock

from crate.worker_handlers.artwork import (
    ARTWORK_TASK_HANDLERS,
    _handle_fetch_artwork_all,
    _handle_batch_covers,
    _handle_fetch_cover,
    _handle_apply_cover,
    _handle_upload_image,
    _handle_fetch_album_cover,
    _handle_scan_missing_covers,
    _fetch_deezer_cover,
    _fetch_itunes_cover,
    _fetch_lastfm_cover,
    _search_musicbrainz_cover,
)


def _mock_emit_silence(monkeypatch):
    for name in ("emit_task_event", "emit_progress"):
        monkeypatch.setattr(
            f"crate.worker_handlers.artwork.{name}",
            lambda *args, **kwargs: None,
        )


def _mock_caa(monkeypatch, return_value=None):
    """Mock fetch_cover_from_caa and save_cover in crate.artwork (lazy import source)."""
    monkeypatch.setattr(
        "crate.artwork.fetch_cover_from_caa",
        lambda mbid: return_value,
    )
    monkeypatch.setattr(
        "crate.artwork.save_cover",
        lambda path, data: None,
    )


def _mock_scan_missing(monkeypatch, return_value=None):
    monkeypatch.setattr(
        "crate.artwork.scan_missing_covers",
        lambda lib_path, exts: return_value or [],
    )


class TestHandlerRegistration:
    def test_artwork_task_handlers_registers_all_eight_handlers(self):
        expected = {
            "fetch_cover",
            "fetch_album_cover",
            "fetch_artist_covers",
            "fetch_artwork_all",
            "batch_covers",
            "scan_missing_covers",
            "apply_cover",
            "upload_image",
        }
        assert set(ARTWORK_TASK_HANDLERS.keys()) == expected

    def test_handlers_are_callable(self):
        for name in ARTWORK_TASK_HANDLERS:
            assert callable(ARTWORK_TASK_HANDLERS[name]), f"{name} not callable"


# ── _handle_fetch_cover ──────────────────────────────────────────


class TestHandleFetchCover:
    def test_no_mbid_returns_error(self, monkeypatch):
        _mock_emit_silence(monkeypatch)
        result = _handle_fetch_cover("task-1", {}, {})
        assert result == {"error": "No MBID"}

    def test_caa_not_found_returns_error(self, monkeypatch):
        _mock_emit_silence(monkeypatch)
        _mock_caa(monkeypatch, return_value=None)
        result = _handle_fetch_cover(
            "task-1",
            {"mbid": "fake-mbid", "path": "some/path"},
            {"library_path": "/tmp"},
        )
        assert result == {"error": "No cover found on CAA"}

    def test_saves_cover_when_found(self, monkeypatch, tmp_path):
        _mock_emit_silence(monkeypatch)
        album_dir = tmp_path / "Test Artist" / "Test Album"
        album_dir.mkdir(parents=True)

        saved: list[tuple] = []
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"fake-image-data",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )

        result = _handle_fetch_cover(
            "task-1",
            {"mbid": "real-mbid", "path": str(album_dir)},
            {"library_path": str(tmp_path)},
        )
        assert result["status"] == "saved"
        assert saved == [(album_dir, b"fake-image-data")]

    def test_album_dir_not_found_returns_error(self, monkeypatch):
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"data",
        )
        result = _handle_fetch_cover(
            "task-1",
            {"mbid": "mbid-1", "path": "/nonexistent/path"},
            {"library_path": "/tmp"},
        )
        assert result == {"error": "Album directory not found"}


# ── _handle_batch_covers ─────────────────────────────────────────


class TestHandleBatchCovers:
    def test_empty_albums_list(self, monkeypatch):
        _mock_emit_silence(monkeypatch)
        result = _handle_batch_covers(
            "task-1", {"albums": []}, {"library_path": "/tmp"}
        )
        assert result == {"results": []}

    def test_no_mbid_records_error(self, monkeypatch):
        _mock_emit_silence(monkeypatch)
        result = _handle_batch_covers(
            "task-1",
            {"albums": [{"path": "some/path"}]},
            {"library_path": "/tmp"},
        )
        assert result["results"] == [{"path": "some/path", "error": "No MBID"}]

    def test_missing_directory_records_error(self, monkeypatch, tmp_path):
        _mock_emit_silence(monkeypatch)
        result = _handle_batch_covers(
            "task-1",
            {"albums": [{"mbid": "mb-1", "path": "nonexistent"}]},
            {"library_path": str(tmp_path)},
        )
        assert result["results"] == [{"path": "nonexistent", "error": "Not found"}]

    def test_fetches_and_saves_covers(self, monkeypatch, tmp_path):
        _mock_emit_silence(monkeypatch)
        album_dir = tmp_path / "Test Artist" / "Test Album"
        album_dir.mkdir(parents=True)

        saved: list[tuple] = []
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"image-bytes",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )

        result = _handle_batch_covers(
            "task-1",
            {"albums": [{"mbid": "mb-1", "path": str(album_dir)}]},
            {"library_path": str(tmp_path)},
        )
        assert result["results"] == [{"path": str(album_dir), "status": "fetched"}]
        assert saved == [(album_dir, b"image-bytes")]

    def test_caa_not_found_records_error(self, monkeypatch, tmp_path):
        _mock_emit_silence(monkeypatch)
        album_dir = tmp_path / "Test" / "Album"
        album_dir.mkdir(parents=True)
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: None,
        )
        result = _handle_batch_covers(
            "task-1",
            {"albums": [{"mbid": "mb-1", "path": str(album_dir)}]},
            {"library_path": str(tmp_path)},
        )
        assert result["results"] == [
            {"path": str(album_dir), "error": "Not found on CAA"}
        ]


# ── _handle_apply_cover ──────────────────────────────────────────


class TestHandleApplyCover:
    def test_no_album_path_returns_error(self):
        result = _handle_apply_cover("task-1", {}, {})
        assert result == {"error": "No album path"}

    def test_directory_not_found_returns_error(self, tmp_path):
        result = _handle_apply_cover(
            "task-1",
            {"path": str(tmp_path / "nonexistent")},
            {},
        )
        assert result == {"error": "Album directory not found"}

    def test_caa_apply_success(self, monkeypatch, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        saved: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"data",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )

        result = _handle_apply_cover(
            "task-1",
            {
                "path": str(album_dir),
                "source": "coverartarchive",
                "mbid": "mbid-1",
                "artist": "Band",
                "album": "Album",
            },
            {},
        )
        assert result["applied"] is True
        assert saved == [(album_dir, b"data")]

    def test_unavailable_source_returns_error(self, monkeypatch, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: None,
        )

        result = _handle_apply_cover(
            "task-1",
            {
                "path": str(album_dir),
                "source": "coverartarchive",
                "mbid": "mbid-1",
            },
            {},
        )
        assert result == {"error": "Failed to fetch cover"}

    def test_deezer_source_fetches_cover(self, monkeypatch, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        saved: list[tuple] = []
        mock_search = MagicMock()
        mock_search.status_code = 200
        mock_search.json.return_value = {
            "data": [{"cover_xl": "https://example.com/cover.jpg"}]
        }
        mock_img = MagicMock()
        mock_img.status_code = 200
        mock_img.content = b"cover-image"

        def fake_get(url, **kwargs):
            if "search" in url:
                return mock_search
            return mock_img

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )

        with monkeypatch.context() as m:
            m.setattr("requests.get", fake_get)
            result = _handle_apply_cover(
                "task-1",
                {
                    "path": str(album_dir),
                    "source": "deezer",
                    "artist": "Band",
                    "album": "Album",
                },
                {},
            )

        assert result["applied"] is True
        assert saved == [(album_dir, b"cover-image")]


# ── _handle_upload_image ─────────────────────────────────────────


class TestHandleUploadImage:
    def test_no_data_returns_error(self):
        result = _handle_upload_image("task-1", {}, {})
        assert result == {"error": "No image data"}

    def test_unknown_image_type_returns_error(self, tmp_path):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()
        result = _handle_upload_image(
            "task-1",
            {"type": "unknown", "data_b64": data_b64},
            {"library_path": str(tmp_path)},
        )
        assert "Unknown image type" in result["error"]

    def test_cover_upload_saves_jpeg(self, monkeypatch, tmp_path):
        from PIL import Image

        img = Image.new("RGB", (100, 50), color="red")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()

        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_album",
            lambda artist, album: {"id": 1, "path": str(album_dir)},
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.set_album_has_cover",
            lambda album_id: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.start_scan",
            lambda: None,
        )
        import requests as _requests

        monkeypatch.setattr(_requests, "post", lambda *args, **kwargs: MagicMock())

        result = _handle_upload_image(
            "task-1",
            {
                "type": "cover",
                "artist": "Band",
                "album": "Album",
                "data_b64": data_b64,
            },
            {"library_path": str(tmp_path)},
        )

        assert result["type"] == "cover"
        assert result["width"] == 100
        assert result["height"] == 50
        assert (album_dir / "cover.jpg").exists()

    def test_album_not_found_returns_error(self, monkeypatch, tmp_path):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_album",
            lambda artist, album: None,
        )

        result = _handle_upload_image(
            "task-1",
            {
                "type": "cover",
                "artist": "Nobody",
                "album": "Nothing",
                "data_b64": data_b64,
            },
            {"library_path": str(tmp_path)},
        )
        assert result == {"error": "Album not found"}

    def test_artist_photo_saves_jpeg(self, monkeypatch, tmp_path):
        from PIL import Image

        img = Image.new("RGB", (200, 200), color="blue")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()

        artist_dir = tmp_path / "ArtistName"
        artist_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_artist",
            lambda name: {"id": 5, "entity_uid": "ArtistName"},
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.resolve_artist_dir",
            lambda lib, row, fallback_name, existing_only: artist_dir,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.set_artist_has_photo",
            lambda artist: None,
        )
        import requests as _requests

        monkeypatch.setattr(_requests, "post", lambda *args, **kwargs: MagicMock())

        result = _handle_upload_image(
            "task-1",
            {
                "type": "artist_photo",
                "artist": "ArtistName",
                "data_b64": data_b64,
            },
            {"library_path": str(tmp_path)},
        )

        assert result["type"] == "artist_photo"
        assert (artist_dir / "artist.jpg").exists()

    def test_artist_directory_not_found_returns_error(self, monkeypatch, tmp_path):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_artist",
            lambda name: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.resolve_artist_dir",
            lambda lib, row, fallback_name, existing_only: None,
        )

        result = _handle_upload_image(
            "task-1",
            {
                "type": "artist_photo",
                "artist": "Nobody",
                "data_b64": data_b64,
            },
            {"library_path": str(tmp_path)},
        )
        assert result == {"error": "Artist directory not found"}

    def test_background_image_saves_jpeg(self, monkeypatch, tmp_path):
        from PIL import Image

        img = Image.new("RGB", (300, 150), color="green")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()

        artist_dir = tmp_path / "ArtistBg"
        artist_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_artist",
            lambda name: {"id": 10},
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.resolve_artist_dir",
            lambda lib, row, fallback_name, existing_only: artist_dir,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.touch_artist_artwork",
            lambda artist: None,
        )
        import requests as _requests

        monkeypatch.setattr(_requests, "post", lambda *args, **kwargs: MagicMock())

        result = _handle_upload_image(
            "task-1",
            {
                "type": "background",
                "artist": "ArtistBg",
                "data_b64": data_b64,
            },
            {"library_path": str(tmp_path)},
        )

        assert result["type"] == "background"
        assert (artist_dir / "background.jpg").exists()

    def test_path_traversal_blocked(self, monkeypatch, tmp_path):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, "PNG")
        data_b64 = base64.b64encode(buf.getvalue()).decode()
        outside_dir = tmp_path / "outside"
        outside_dir.mkdir()

        monkeypatch.setattr(
            "crate.worker_handlers.artwork.get_library_artist",
            lambda name: {"id": 5, "entity_uid": "ArtistName"},
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.resolve_artist_dir",
            lambda lib, row, fallback_name, existing_only: outside_dir,
        )

        lib_dir = tmp_path / "library"
        lib_dir.mkdir()

        try:
            _handle_upload_image(
                "task-1",
                {
                    "type": "artist_photo",
                    "artist": "ArtistName",
                    "data_b64": data_b64,
                },
                {"library_path": str(lib_dir)},
            )
        except ValueError as exc:
            assert "Path traversal blocked" in str(exc)
        else:
            raise AssertionError("Expected ValueError for path traversal")


# ── _handle_fetch_album_cover ─────────────────────────────────────


class TestHandleFetchAlbumCover:
    def test_directory_not_found(self):
        result = _handle_fetch_album_cover(
            "task-1",
            {"artist": "A", "album": "B", "path": "/nonexistent"},
            {},
        )
        assert result == {"error": "Album directory not found"}

    def test_already_has_cover(self, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)
        (album_dir / "cover.jpg").write_bytes(b"existing")

        result = _handle_fetch_album_cover(
            "task-1",
            {"path": str(album_dir)},
            {},
        )
        assert result == {"status": "already_has_cover"}

    def test_already_has_folder_jpg(self, tmp_path):
        album_dir = tmp_path / "Band" / "Album2"
        album_dir.mkdir(parents=True)
        (album_dir / "folder.jpg").write_bytes(b"existing")

        result = _handle_fetch_album_cover(
            "task-1",
            {"path": str(album_dir)},
            {},
        )
        assert result == {"status": "already_has_cover"}

    def test_already_has_cover_png(self, tmp_path):
        album_dir = tmp_path / "Band" / "Album3"
        album_dir.mkdir(parents=True)
        (album_dir / "cover.png").write_bytes(b"existing")

        result = _handle_fetch_album_cover(
            "task-1",
            {"path": str(album_dir)},
            {},
        )
        assert result == {"status": "already_has_cover"}

    def test_finds_from_caa_when_mbid_present(self, monkeypatch, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"caa-image",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.set_album_has_cover",
            lambda album_id: None,
        )

        result = _handle_fetch_album_cover(
            "task-1",
            {
                "artist": "Band",
                "album": "Album",
                "path": str(album_dir),
                "mbid": "real-mbid",
            },
            {},
        )
        assert result["status"] == "found"
        assert result["source"] == "coverartarchive"

    def test_not_found_returns_sources_tried(self, monkeypatch, tmp_path):
        album_dir = tmp_path / "Band" / "Album"
        album_dir.mkdir(parents=True)

        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: None,
        )
        monkeypatch.setattr(
            "crate.artwork.extract_embedded_cover",
            lambda path: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork._fetch_deezer_cover",
            lambda artist, album: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork._fetch_itunes_cover",
            lambda artist, album: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork._fetch_lastfm_cover",
            lambda artist, album: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork._search_musicbrainz_cover",
            lambda artist, album: None,
        )

        result = _handle_fetch_album_cover(
            "task-1",
            {
                "artist": "Band",
                "album": "Album",
                "path": str(album_dir),
            },
            {},
        )
        assert result["status"] == "not_found"
        assert len(result["sources_tried"]) == 6


# ── _handle_fetch_artwork_all ─────────────────────────────────────


class TestHandleFetchArtworkAll:
    def test_empty_library(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        _mock_emit_silence(monkeypatch)
        _mock_scan_missing(monkeypatch, return_value=[])

        result = _handle_fetch_artwork_all("task-1", {}, {"library_path": str(lib)})
        assert result["total"] == 0
        assert result["fetched"] == 0
        assert result["failed"] == 0

    def test_fetches_covers_when_present(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        missing = [
            {
                "artist": "Band",
                "album": "Album",
                "mbid": "mbid-1",
                "path": str(lib / "Band" / "Album"),
            }
        ]
        saved: list[tuple] = []

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: missing,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"image-data",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )

        result = _handle_fetch_artwork_all("task-1", {}, {"library_path": str(lib)})
        assert result["fetched"] == 1
        assert result["failed"] == 0
        assert len(saved) == 1

    def test_skips_albums_without_mbid(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        missing = [
            {
                "artist": "Band",
                "album": "Album",
                "mbid": None,
                "path": str(lib / "Band" / "Album"),
            }
        ]
        fetch_called: list[str] = []

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: missing,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: fetch_called.append(mbid),
        )

        result = _handle_fetch_artwork_all("task-1", {}, {"library_path": str(lib)})
        assert result["fetched"] == 0
        assert fetch_called == []

    def test_marks_failed_when_caa_empty(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        missing = [
            {
                "artist": "Band",
                "album": "Album",
                "mbid": "mbid-1",
                "path": str(lib / "Band" / "Album"),
            }
        ]

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: missing,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: None,
        )

        result = _handle_fetch_artwork_all("task-1", {}, {"library_path": str(lib)})
        assert result["fetched"] == 0
        assert result["failed"] == 1


# ── _handle_scan_missing_covers ───────────────────────────────────


class TestHandleScanMissingCovers:
    def test_no_missing_covers(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: [],
        )

        result = _handle_scan_missing_covers("task-1", {}, {"library_path": str(lib)})
        assert result["total_missing"] == 0
        assert result["found"] == 0
        assert result["not_found"] == 0

    def test_finds_cover_on_caa(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        album_path = lib / "Band" / "Album"
        album_path.mkdir(parents=True)
        missing = [
            {
                "artist": "Band",
                "album": "Album",
                "mbid": "mbid-1",
                "path": str(album_path),
            }
        ]
        saved: list[tuple] = []

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: missing,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"image",
        )
        monkeypatch.setattr(
            "crate.artwork.extract_embedded_cover",
            lambda path: None,
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.set_cache",
            lambda key, val: None,
        )
        for name in (
            "_fetch_deezer_cover",
            "_fetch_itunes_cover",
            "_fetch_lastfm_cover",
            "_search_musicbrainz_cover",
        ):
            monkeypatch.setattr(
                f"crate.worker_handlers.artwork.{name}",
                lambda *a, **kw: None,
            )

        result = _handle_scan_missing_covers("task-1", {}, {"library_path": str(lib)})
        assert result["found"] == 1
        assert result["not_found"] == 0

    def test_auto_apply_saves_cover(self, monkeypatch, tmp_path):
        lib = tmp_path / "library"
        lib.mkdir()

        album_path = lib / "Band" / "Album"
        album_path.mkdir(parents=True)
        missing = [
            {
                "artist": "Band",
                "album": "Album",
                "mbid": "mbid-1",
                "path": str(album_path),
            }
        ]
        saved: list[tuple] = []

        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.artwork.scan_missing_covers",
            lambda lib_path, exts: missing,
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"image",
        )
        monkeypatch.setattr(
            "crate.artwork.save_cover",
            lambda path, data: saved.append((path, data)),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.artwork.set_cache",
            lambda key, val: None,
        )
        for name in (
            "_fetch_deezer_cover",
            "_fetch_itunes_cover",
            "_fetch_lastfm_cover",
            "_search_musicbrainz_cover",
        ):
            monkeypatch.setattr(
                f"crate.worker_handlers.artwork.{name}",
                lambda *a, **kw: None,
            )
        monkeypatch.setattr(
            "crate.artwork.extract_embedded_cover",
            lambda path: None,
        )

        result = _handle_scan_missing_covers(
            "task-1",
            {"auto_apply": True},
            {"library_path": str(lib)},
        )
        assert result["found"] == 1
        assert len(saved) == 1
        assert saved[0][0] == Path(album_path)


# ── Cover fetcher helpers ──────────────────────────────────────────


class TestFetchDeezerCover:
    def test_returns_none_when_api_fails(self, monkeypatch):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        monkeypatch.setattr("requests.get", lambda url, **kwargs: mock_resp)
        assert _fetch_deezer_cover("Artist", "Album") is None

    def test_returns_image_when_found(self, monkeypatch):
        mock_search = MagicMock()
        mock_search.status_code = 200
        mock_search.json.return_value = {
            "data": [
                {"cover_xl": "https://e-cdns-images.dzcdn.net/images/cover/xl.jpg"}
            ]
        }
        mock_img = MagicMock()
        mock_img.status_code = 200
        mock_img.content = b"x" * 2000

        calls: list[str] = []

        def fake_get(url, **kwargs):
            calls.append(url)
            if "search" in url:
                return mock_search
            return mock_img

        monkeypatch.setattr("requests.get", fake_get)
        result = _fetch_deezer_cover("Artist", "Album")
        assert result == b"x" * 2000

    def test_returns_none_when_image_too_small(self, monkeypatch):
        mock_search = MagicMock()
        mock_search.status_code = 200
        mock_search.json.return_value = {
            "data": [{"cover_xl": "https://example.com/small.jpg"}]
        }
        mock_img = MagicMock()
        mock_img.status_code = 200
        mock_img.content = b"x" * 500

        def fake_get(url, **kwargs):
            if "search" in url:
                return mock_search
            return mock_img

        monkeypatch.setattr("requests.get", fake_get)
        assert _fetch_deezer_cover("Artist", "Album") is None


class TestFetchItunesCover:
    def test_returns_none_when_api_fails(self, monkeypatch):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        monkeypatch.setattr("requests.get", lambda url, **kwargs: mock_resp)
        assert _fetch_itunes_cover("Artist", "Album") is None

    def test_returns_image_when_found(self, monkeypatch):
        mock_search = MagicMock()
        mock_search.status_code = 200
        mock_search.json.return_value = {
            "results": [{"artworkUrl100": "https://example.com/100x100bb.jpg"}]
        }
        mock_img = MagicMock()
        mock_img.status_code = 200
        mock_img.content = b"y" * 2000

        def fake_get(url, **kwargs):
            if "search" in url:
                return mock_search
            return mock_img

        monkeypatch.setattr("requests.get", fake_get)
        result = _fetch_itunes_cover("Artist", "Album")
        assert result == b"y" * 2000

    def test_skips_results_without_artwork_url(self, monkeypatch):
        mock_search = MagicMock()
        mock_search.status_code = 200
        mock_search.json.return_value = {"results": [{"artworkUrl100": ""}]}
        monkeypatch.setattr("requests.get", lambda url, **kwargs: mock_search)
        assert _fetch_itunes_cover("Artist", "Album") is None


class TestFetchLastfmCover:
    def test_returns_none_when_no_album_data(self, monkeypatch):
        monkeypatch.setattr(
            "crate.popularity._lastfm_get",
            lambda method, **kwargs: None,
        )
        assert _fetch_lastfm_cover("Artist", "Album") is None

    def test_returns_image_when_found(self, monkeypatch):
        monkeypatch.setattr(
            "crate.popularity._lastfm_get",
            lambda method, **kwargs: {
                "album": {
                    "image": [
                        {"#text": "", "size": "small"},
                        {
                            "#text": "https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg",
                            "size": "extralarge",
                        },
                    ]
                }
            },
        )
        mock_img = MagicMock()
        mock_img.status_code = 200
        mock_img.content = b"z" * 2000
        monkeypatch.setattr("requests.get", lambda url, **kwargs: mock_img)
        result = _fetch_lastfm_cover("Artist", "Album")
        assert result == b"z" * 2000

    def test_skips_noimage_urls(self, monkeypatch):
        monkeypatch.setattr(
            "crate.popularity._lastfm_get",
            lambda method, **kwargs: {
                "album": {
                    "image": [
                        {"#text": "https://example.com/noimage.png", "size": "large"},
                    ]
                }
            },
        )
        assert _fetch_lastfm_cover("Artist", "Album") is None


class TestSearchMusicBrainzCover:
    def test_returns_none_when_no_releases(self, monkeypatch):
        monkeypatch.setattr(
            "musicbrainzngs.search_releases",
            lambda **kwargs: {"release-list": []},
        )
        assert _search_musicbrainz_cover("Artist", "Album") is None

    def test_returns_image_from_caa(self, monkeypatch):
        monkeypatch.setattr(
            "musicbrainzngs.search_releases",
            lambda **kwargs: {"release-list": [{"id": "mbid-found"}]},
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: b"mb-image" if mbid == "mbid-found" else None,
        )
        monkeypatch.setattr("time.sleep", lambda s: None)

        result = _search_musicbrainz_cover("Artist", "Album")
        assert result == b"mb-image"

    def test_returns_none_when_caa_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            "musicbrainzngs.search_releases",
            lambda **kwargs: {"release-list": [{"id": "mbid-empty"}]},
        )
        monkeypatch.setattr(
            "crate.artwork.fetch_cover_from_caa",
            lambda mbid: None,
        )
        monkeypatch.setattr("time.sleep", lambda s: None)

        assert _search_musicbrainz_cover("Artist", "Album") is None

    def test_returns_none_on_exception(self, monkeypatch):
        monkeypatch.setattr(
            "musicbrainzngs.search_releases",
            lambda **kwargs: (_ for _ in ()).throw(RuntimeError("api down")),
        )
        assert _search_musicbrainz_cover("Artist", "Album") is None
