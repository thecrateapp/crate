from datetime import datetime, timezone
from pathlib import Path

from crate.worker_handlers.acquisition import (
    _finalize_upgrade_quarantine,
    _find_cover_art_archive_release_group_cover,
    _find_tidal_preview_tracks,
    _handle_check_new_releases,
    _handle_tidal_download,
    _handle_library_upload,
    _locate_soulseek_download_file,
    _register_new_release,
    _select_soulseek_task_downloads,
)


def test_select_soulseek_task_downloads_scopes_to_expected_full_paths():
    downloads = [
        {
            "username": "peer-a",
            "fullPath": "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
            "filename": "01 - One with the Underdogs.flac",
        },
        {
            "username": "peer-a",
            "fullPath": "music/Terror/Lowest of the Low/01 - Better Off Without You.flac",
            "filename": "01 - Better Off Without You.flac",
        },
        {
            "username": "peer-b",
            "fullPath": "music/Terror/One With The Underdogs/02 - Keep Your Mouth Shut.flac",
            "filename": "02 - Keep Your Mouth Shut.flac",
        },
    ]

    selected = _select_soulseek_task_downloads(
        downloads,
        username="peer-a",
        expected_files=[
            "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
        ],
    )

    assert selected == [downloads[0]]


def test_find_cover_art_archive_release_group_cover_uses_front_endpoint(
    monkeypatch,
):
    cached = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_cache", lambda _key: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.set_cache",
        lambda key, value, ttl=None: cached.append((key, value, ttl)),
    )

    class Response:
        status_code = 307

    def fake_head(url, timeout, allow_redirects):
        assert timeout == 6
        assert allow_redirects is False
        assert url.endswith("/release-group/rg-123/front-500")
        return Response()

    import requests

    monkeypatch.setattr(requests, "head", fake_head)

    url = _find_cover_art_archive_release_group_cover("rg-123")

    assert url == "https://coverartarchive.org/release-group/rg-123/front-500"
    assert cached == [
        (
            "caa:release-group-cover:rg-123",
            "https://coverartarchive.org/release-group/rg-123/front-500",
            86400 * 30,
        )
    ]


def test_register_new_release_uses_tidal_tracklist_when_mb_is_empty(monkeypatch):
    captured: dict = {}
    preview_inputs: list[list[dict]] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_release_match",
        lambda _artist, _title: {
            "tidal_url": "https://tidal.com/album/515000",
            "tidal_id": "515000",
            "cover_url": "https://img.example/cover.jpg",
            "tracks": 10,
            "quality": ["HI_RES_LOSSLESS"],
        },
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_release_group_tracklist", lambda _mbid: []
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
                "url": "https://tidal.com/track/7009",
            }
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_preview_tracks",
        lambda _artist, tracklist: (
            preview_inputs.append(tracklist)
            or {
                "preview_tracks": [],
                "cover_url": "",
                "source_url": "",
                "source_album": "",
                "source_name": "",
                "quality": "",
            }
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.upsert_new_release",
        lambda **kwargs: captured.update(kwargs) or 91,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.merge_new_release_preview_tracks",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._broadcast_release_cache_invalidation",
        lambda _artist: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *_args, **_kwargs: None,
    )

    release_id, processed = _register_new_release(
        "task-release",
        "Converge",
        {
            "title": "Hum Of Hurt",
            "year": "2026",
            "type": "Album",
            "mbid": "rg-hum",
            "first_release_date": "2026-06-05",
        },
        today="2026-05-17",
        known_date="2026-01-01",
        auto_download=False,
    )

    assert (release_id, processed) == (1, False)
    assert preview_inputs[0][0]["title"] == "Hum Of Hurt"
    assert preview_inputs[0][0]["position"] == 9
    assert captured["tracklist"][0]["title"] == "Hum Of Hurt"
    assert captured["tracklist"][0]["source"] == "tidal"
    assert captured["tracks"] == 10


def test_register_new_release_downloads_on_release_day(monkeypatch):
    queued: list[dict] = []
    downloading: list[int] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_release_match",
        lambda _artist, _title: {
            "tidal_url": "https://tidal.com/album/777",
            "tidal_id": "777",
            "cover_url": "https://img.example/release.jpg",
            "tracks": 8,
            "quality": "LOSSLESS",
        },
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_release_group_tracklist",
        lambda _mbid: [{"title": "Released Today", "position": 1}],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._get_tidal_release_tracklist",
        lambda _tidal_id: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_preview_tracks",
        lambda _artist, _tracklist: {
            "preview_tracks": [],
            "cover_url": "",
            "source_url": "",
            "source_album": "",
            "source_name": "",
            "quality": "",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.upsert_new_release",
        lambda **_kwargs: 77,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.merge_new_release_preview_tracks",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._broadcast_release_cache_invalidation",
        lambda _artist: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.mark_release_downloading",
        lambda release_id: downloading.append(release_id),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_setting",
        lambda key, default="": "max" if key == "tidal_quality" else default,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.create_task_dedup",
        lambda task_type, params, dedup_key=None: (
            queued.append(
                {"task_type": task_type, "params": params, "dedup_key": dedup_key}
            )
            or "task-download"
        ),
    )

    added_count, should_stop = _register_new_release(
        "task-release",
        "Sparta",
        {
            "title": "Released Today",
            "year": "2026",
            "type": "Album",
            "mbid": "rg-today",
            "first_release_date": "2026-05-29",
        },
        today="2026-05-29",
        known_date="2026-05-29",
        auto_download=True,
    )

    assert (added_count, should_stop) == (1, False)
    assert downloading == [77]
    assert queued[0]["task_type"] == "tidal_download"
    assert queued[0]["params"]["url"] == "https://tidal.com/album/777"
    assert queued[0]["params"]["new_release_id"] == 77


def test_register_new_release_queues_each_preview_source(monkeypatch):
    queued: list[dict] = []
    captured: dict = {}
    cleared_preview_urls: list[tuple[int, list[str]]] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_release_match",
        lambda _artist, _title: {
            "tidal_url": "",
            "tidal_id": "",
            "cover_url": "",
            "tracks": 0,
            "quality": "",
        },
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_release_group_tracklist",
        lambda _mbid: [
            {"title": "Cryogen", "position": 1},
            {"title": "The Wow! Signal", "position": 2},
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_tidal_preview_tracks",
        lambda _artist, _tracklist: {
            "preview_tracks": [
                {
                    "title": "Cryogen",
                    "album": "Cryogen",
                    "source_url": "https://tidal.com/album/1",
                },
                {
                    "title": "The Wow! Signal",
                    "album": "The Wow! Signal",
                    "source_url": "https://tidal.com/album/2",
                },
            ],
            "cover_url": "https://img.example/cover.jpg",
            "source_url": "https://tidal.com/album/1",
            "source_album": "Cryogen",
            "source_name": "tidal",
            "quality": "HI_RES_LOSSLESS",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.upsert_new_release",
        lambda **kwargs: captured.update(kwargs) or 91,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.merge_new_release_preview_tracks",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._queue_release_preview_download",
        lambda release_id, **kwargs: (
            queued.append({"release_id": release_id, **kwargs}) or f"task-{len(queued)}"
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.clear_new_release_preview_source_url",
        lambda release_id, urls: (
            cleared_preview_urls.append((release_id, urls)) or True
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._broadcast_release_cache_invalidation",
        lambda _artist: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *_args, **_kwargs: None,
    )

    _register_new_release(
        "task-release",
        "Muse",
        {
            "title": "The Wow! Signal",
            "year": "2026",
            "type": "Album",
            "mbid": "rg-wow",
            "first_release_date": "2026-06-05",
        },
        today="2026-05-17",
        known_date="2026-01-01",
        auto_download=False,
    )

    assert [item["source_url"] for item in queued] == [
        "https://tidal.com/album/1",
        "https://tidal.com/album/2",
    ]
    assert [item["source_album"] for item in queued] == [
        "Cryogen",
        "The Wow! Signal",
    ]
    assert captured["source_url"] == ""
    assert captured["source_name"] == ""
    assert cleared_preview_urls == [
        (91, ["https://tidal.com/album/1", "https://tidal.com/album/2"])
    ]


def test_find_tidal_preview_tracks_uses_album_url_from_track_search(monkeypatch):
    from crate import tidal as tidal_mod

    monkeypatch.setattr(
        tidal_mod,
        "search",
        lambda *_args, **_kwargs: {
            "tracks": [
                {
                    "id": "9001",
                    "title": "The Wow! Signal",
                    "artist": "Muse",
                    "album": "The Wow! Signal",
                    "album_id": "515052476",
                    "album_cover": "https://img.example/wow.jpg",
                    "album_url": "http://www.tidal.com/album/515052476",
                    "url": "https://tidal.com/track/9001",
                    "quality": ["HI_RES_LOSSLESS"],
                    "duration": 210,
                }
            ]
        },
    )

    result = _find_tidal_preview_tracks(
        "Muse",
        [{"title": "The Wow! Signal", "position": 2, "duration": 210}],
    )

    assert result["source_url"] == "https://tidal.com/album/515052476"
    assert result["cover_url"] == "https://img.example/wow.jpg"
    assert result["quality"] == "HI_RES_LOSSLESS"
    assert result["preview_tracks"] == [
        {
            "source": "tidal",
            "id": "9001",
            "title": "The Wow! Signal",
            "duration": 210,
            "position": 2,
            "url": "https://tidal.com/track/9001",
            "source_url": "https://tidal.com/album/515052476",
            "album": "The Wow! Signal",
            "quality": ["HI_RES_LOSSLESS"],
        }
    ]


def test_new_release_upsert_preserves_manual_cover_and_existing_previews(pg_db):
    from sqlalchemy import text

    from crate.db.releases import (
        clear_new_release_preview_source_url,
        merge_new_release_preview_tracks,
        update_new_release_cover,
        upsert_new_release,
    )
    from crate.db.tx import read_scope, transaction_scope

    release_id = upsert_new_release(
        artist_name="Quicksand",
        album_title="Bring On The Psychics",
        cover_url="https://img.example/original.jpg",
        cover_source="tidal",
        release_date="2026-07-17",
        tracklist=[{"title": "Get To It"}],
        preview_tracks=[{"id": "old", "title": "Get To It"}],
    )
    update_new_release_cover(
        release_id,
        cover_url=f"/api/albums/-{release_id}/cover",
        cover_source="manual",
    )

    same_release_id = upsert_new_release(
        artist_name="Quicksand",
        album_title="Bring On The Psychics",
        cover_url="",
        cover_source="",
        release_date="2026-07-17",
        tracklist=[],
        preview_tracks=[{"id": "new", "title": "Regenerate"}],
    )
    merge_new_release_preview_tracks(
        same_release_id,
        [{"id": "new", "title": "Regenerate"}],
        cover_url="https://img.example/tidal.jpg",
    )

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT cover_url, cover_source, tracklist_json, preview_tracks_json
                    FROM new_releases
                    WHERE id = :id
                    """
                ),
                {"id": release_id},
            )
            .mappings()
            .one()
        )

    assert same_release_id == release_id
    assert row["cover_url"] == f"/api/albums/-{release_id}/cover"
    assert row["cover_source"] == "manual"
    assert row["tracklist_json"] == [{"title": "Get To It"}]
    assert row["preview_tracks_json"] == [
        {"id": "old", "title": "Get To It"},
        {"id": "new", "title": "Regenerate"},
    ]

    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE new_releases SET source_url = :url, source_name = 'tidal' WHERE id = :id"
            ),
            {"id": release_id, "url": "https://tidal.com/album/preview"},
        )

    assert clear_new_release_preview_source_url(
        release_id,
        ["https://tidal.com/album/preview"],
    )

    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT source_url, source_name FROM new_releases WHERE id = :id"),
                {"id": release_id},
            )
            .mappings()
            .one()
        )

    assert row["source_url"] is None
    assert row["source_name"] is None


def test_upcoming_pre_release_queries_use_strict_future_filter(monkeypatch):
    from crate.db.releases import get_new_releases, get_upcoming_releases_for_artist

    captured_sql: list[str] = []

    class FakeRows:
        def mappings(self):
            return self

        def all(self):
            return []

    class FakeSession:
        def execute(self, statement, _params):
            captured_sql.append(str(statement))
            return FakeRows()

    class FakeScope:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr("crate.db.releases.read_scope", lambda: FakeScope())

    get_new_releases(upcoming=True)
    get_upcoming_releases_for_artist("Sparta")

    assert all("nr.release_date > :today" in sql for sql in captured_sql)
    assert all("nr.release_date >= :today" not in sql for sql in captured_sql)


def test_check_new_releases_skips_recently_checked_artists(monkeypatch):
    checked_at = datetime.now(timezone.utc)
    mb_calls: list[str] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_library_artists",
        lambda per_page=10000: (
            [
                {
                    "name": "Quicksand",
                    "mbid": "mbid-quicksand",
                    "latest_release_date": "2026-01-01",
                    "new_releases_checked_at": checked_at,
                }
            ],
            1,
        ),
    )
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_artist_releases",
        lambda mbid: mb_calls.append(mbid) or [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_setting",
        lambda *_args, **_kwargs: "false",
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress",
        lambda *_args, **_kwargs: None,
    )

    result = _handle_check_new_releases("task-releases", {}, {})

    assert result == {"checked": 0, "skipped_recent": 1, "new_releases": 0}
    assert mb_calls == []


def test_check_new_releases_force_ignores_recent_cursor(monkeypatch):
    checked_at = datetime.now(timezone.utc)
    marked: list[str] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_library_artists",
        lambda per_page=10000: (
            [
                {
                    "name": "Quicksand",
                    "mbid": "mbid-quicksand",
                    "latest_release_date": "2026-01-01",
                    "new_releases_checked_at": checked_at,
                }
            ],
            1,
        ),
    )
    monkeypatch.setattr("crate.musicbrainz_ext.get_artist_releases", lambda _mbid: [])
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.get_setting",
        lambda *_args, **_kwargs: "false",
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.mark_artist_new_releases_checked",
        lambda name, checked_at=None: marked.append(name),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress",
        lambda *_args, **_kwargs: None,
    )

    result = _handle_check_new_releases("task-releases", {"force": True}, {})

    assert result == {"checked": 1, "skipped_recent": 0, "new_releases": 0}
    assert marked == ["Quicksand"]


def test_locate_soulseek_download_file_prefers_exact_path_suffix(tmp_path):
    root = tmp_path / "soulseek"
    wanted = root / "incoming" / "music" / "Terror" / "One With The Underdogs"
    other = root / "incoming" / "music" / "Terror" / "Lowest of the Low"
    wanted.mkdir(parents=True)
    other.mkdir(parents=True)

    wanted_file = wanted / "01 - Intro.flac"
    other_file = other / "01 - Intro.flac"
    wanted_file.write_bytes(b"a")
    other_file.write_bytes(b"b")

    match = _locate_soulseek_download_file(
        root,
        {
            "directory": "music/Terror/One With The Underdogs",
            "fullPath": "music/Terror/One With The Underdogs/01 - Intro.flac",
            "filename": "01 - Intro.flac",
        },
    )

    assert isinstance(match, Path)
    assert match == wanted_file


def test_library_upload_syncs_each_album_and_emits_grouped_completion(
    monkeypatch, tmp_path
):
    staging_dir = tmp_path / "staging"
    raw_dir = staging_dir / "raw"
    extracted_dir = staging_dir / "extracted"
    grouped_dir = staging_dir / "grouped"
    raw_dir.mkdir(parents=True)
    extracted_dir.mkdir()
    grouped_dir.mkdir()

    source_a = extracted_dir / "terror-a"
    source_b = extracted_dir / "terror-b"
    source_a.mkdir()
    source_b.mkdir()

    library_root = tmp_path / "library"
    album_a = library_root / "Terror" / "One With The Underdogs"
    album_b = library_root / "Terror" / "Lowest of the Low"
    album_a.mkdir(parents=True)
    album_b.mkdir(parents=True)
    (album_a / "01 - Intro.flac").write_bytes(b"a")
    (album_b / "01 - Better Off Without You.flac").write_bytes(b"b")

    imported = {
        str(source_a): {"status": "imported", "dest": str(album_a)},
        str(source_b): {"status": "imported", "dest": str(album_b)},
    }

    class FakeQueue:
        def __init__(self, config):
            self.config = config

        def import_item(self, source_path):
            return imported[source_path]

    sync_calls: list[tuple[Path, str]] = []

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_artist(self, artist_dir):
            raise AssertionError(
                "library_upload should sync albums individually, not whole artists"
            )

        def sync_album(self, album_dir, artist_name):
            sync_calls.append((album_dir, artist_name))
            return {}

    completed_events: list[dict] = []
    invalidated_artists: list[str] = []

    monkeypatch.setattr("crate.importer.ImportQueue", FakeQueue)
    monkeypatch.setattr("crate.library_sync.LibrarySync", FakeSync)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_album_dirs_recursive",
        lambda root, extensions: [source_a, source_b],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._group_loose_audio_files",
        lambda raw, grouped, ext: 0,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._uploaded_album_already_in_library",
        lambda album_dir: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._seed_uploaded_library",
        lambda user_id, imported_albums: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._record_uploaded_library_contributions",
        lambda **kwargs: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_item_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._emit_acquisition_completed_for_albums",
        lambda **kwargs: completed_events.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._broadcast_release_cache_invalidation",
        lambda artist_name: invalidated_artists.append(artist_name),
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)

    result = _handle_library_upload(
        "task-upload-1",
        {"staging_dir": str(staging_dir), "uploader_user_id": 1},
        {"library_path": str(library_root), "audio_extensions": [".flac", ".mp3"]},
    )

    assert result["success"] is True
    assert sync_calls == [(album_a, "Terror"), (album_b, "Terror")]
    assert completed_events == [
        {
            "task_id": "task-upload-1",
            "source": "upload",
            "entity_type": "album",
            "moved_albums": [
                {
                    "artist": "Terror",
                    "album": "One With The Underdogs",
                    "album_id": None,
                    "path": str(album_a),
                    "moved": 1,
                },
                {
                    "artist": "Terror",
                    "album": "Lowest of the Low",
                    "album_id": None,
                    "path": str(album_b),
                    "moved": 1,
                },
            ],
        }
    ]
    assert invalidated_artists == ["Terror"]


def test_library_upload_skips_albums_that_already_exist(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    raw_dir = staging_dir / "raw"
    extracted_dir = staging_dir / "extracted"
    grouped_dir = staging_dir / "grouped"
    raw_dir.mkdir(parents=True)
    extracted_dir.mkdir()
    grouped_dir.mkdir()

    source_album = extracted_dir / "existing-album"
    source_album.mkdir()

    class FakeQueue:
        def __init__(self, config):
            self.config = config

        def import_item(self, source_path):
            raise AssertionError("Existing uploads must not be merged into library")

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_album(self, album_dir, artist_name):
            raise AssertionError("Skipped uploads must not be synced")

    monkeypatch.setattr("crate.importer.ImportQueue", FakeQueue)
    monkeypatch.setattr("crate.library_sync.LibrarySync", FakeSync)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_album_dirs_recursive",
        lambda root, extensions: [source_album],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._group_loose_audio_files",
        lambda raw, grouped, ext: 0,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._uploaded_album_already_in_library",
        lambda album_dir: {
            "artist": "Terror",
            "album": "One With The Underdogs",
            "album_id": 123,
            "path": "/music/Terror/One With The Underdogs",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._seed_uploaded_library",
        lambda user_id, imported_albums: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._record_uploaded_library_contributions",
        lambda **kwargs: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_item_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)

    result = _handle_library_upload(
        "task-upload-skip",
        {"staging_dir": str(staging_dir), "uploader_user_id": 1},
        {"library_path": str(tmp_path / "library"), "audio_extensions": [".flac"]},
    )

    assert result["success"] is True
    assert result["albums_imported"] == 0
    assert result["skipped_existing_uploads"] == [
        {
            "source_path": str(source_album),
            "reason": "already_in_library",
            "artist": "Terror",
            "album": "One With The Underdogs",
            "album_id": 123,
            "path": "/music/Terror/One With The Underdogs",
        }
    ]


def test_library_upload_skips_duplicate_albums_in_same_upload(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    raw_dir = staging_dir / "raw"
    extracted_dir = staging_dir / "extracted"
    grouped_dir = staging_dir / "grouped"
    raw_dir.mkdir(parents=True)
    extracted_dir.mkdir()
    grouped_dir.mkdir()

    first_album = extracted_dir / "first"
    second_album = extracted_dir / "second"
    first_album.mkdir()
    second_album.mkdir()

    library_root = tmp_path / "library"
    imported_album = library_root / "Terror" / "Duplicate"
    imported_album.mkdir(parents=True)
    (imported_album / "01 - Track.flac").write_bytes(b"a")
    imported_paths: list[str] = []

    class FakeQueue:
        def __init__(self, config):
            self.config = config

        def import_item(self, source_path):
            imported_paths.append(source_path)
            return {"status": "imported", "dest": str(imported_album)}

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_album(self, album_dir, artist_name):
            return {}

    monkeypatch.setattr("crate.importer.ImportQueue", FakeQueue)
    monkeypatch.setattr("crate.library_sync.LibrarySync", FakeSync)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_album_dirs_recursive",
        lambda root, extensions: [first_album, second_album],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._uploaded_album_identity",
        lambda album_dir: ("Terror", "Duplicate"),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._uploaded_album_already_in_library",
        lambda album_dir: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._group_loose_audio_files",
        lambda raw, grouped, ext: 0,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._seed_uploaded_library",
        lambda user_id, imported_albums: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._record_uploaded_library_contributions",
        lambda **kwargs: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._emit_acquisition_completed_for_albums",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_item_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)

    result = _handle_library_upload(
        "task-upload-duplicates",
        {"staging_dir": str(staging_dir), "uploader_user_id": 1},
        {"library_path": str(library_root), "audio_extensions": [".flac"]},
    )

    assert imported_paths == [str(first_album)]
    assert result["albums_imported"] == 1
    assert result["skipped_existing_uploads"] == [
        {
            "source_path": str(second_album),
            "artist": "Terror",
            "album": "Duplicate",
            "reason": "duplicate_in_upload",
        }
    ]


def test_tidal_download_task_raises_when_inner_returns_error(monkeypatch, tmp_path):
    library_root = tmp_path / "library"
    library_root.mkdir()
    status_updates: list[dict] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._tidal_download_inner",
        lambda *args, **kwargs: {
            "error": "Partial Tidal download: got 0/4 tracks",
            "phase": "download",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.update_tidal_download",
        lambda download_id, **kwargs: status_updates.append(
            {"download_id": download_id, **kwargs}
        ),
    )

    try:
        _handle_tidal_download(
            "task-tidal-1",
            {
                "url": "https://tidal.com/album/123",
                "download_id": 99,
                "quality": "max",
            },
            {"library_path": str(library_root)},
        )
    except RuntimeError as exc:
        assert "Partial Tidal download: got 0/4 tracks" in str(exc)
        assert "phase: download" in str(exc)
    else:
        raise AssertionError(
            "Expected _handle_tidal_download to raise for error results"
        )

    assert status_updates == [
        {"download_id": 99, "status": "downloading", "task_id": "task-tidal-1"},
        {
            "download_id": 99,
            "status": "failed",
            "error": "Partial Tidal download: got 0/4 tracks (phase: download)",
        },
    ]


def test_finalize_upgrade_unquarantines_in_place_replacement(monkeypatch):
    calls: list[tuple[str, int]] = []
    events: list[dict] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.unquarantine_album",
        lambda album_id: calls.append(("unquarantine", album_id)) or True,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.delete_quarantined_album",
        lambda album_id: calls.append(("delete", album_id)) or {"id": album_id},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda _task_id, _event, payload: events.append(payload),
    )

    _finalize_upgrade_quarantine(
        task_id="task-upgrade",
        upgrade_album_id=42,
        original_album_path="/music/artist/album",
        moved_albums=[{"path": "/music/artist/album"}],
    )

    assert calls == [("unquarantine", 42)]
    assert "in-place" in events[0]["message"]


def test_finalize_upgrade_deletes_old_row_for_relocated_replacement(monkeypatch):
    calls: list[tuple[str, int]] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.unquarantine_album",
        lambda album_id: calls.append(("unquarantine", album_id)) or True,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.delete_quarantined_album",
        lambda album_id: calls.append(("delete", album_id)) or {"id": album_id},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *_args, **_kwargs: None,
    )

    _finalize_upgrade_quarantine(
        task_id="task-upgrade",
        upgrade_album_id=42,
        original_album_path="/music/artist/old-album",
        moved_albums=[{"path": "/music/artist/new-album"}],
    )

    assert calls == [("delete", 42)]
