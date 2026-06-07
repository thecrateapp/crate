from __future__ import annotations

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_track(pg_db, *, title: str, filename: str) -> dict:
    artist = "Smart Override Artist"
    album = "Smart Override Album"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": album,
            "path": "/music/smart-override-artist/smart-override-album",
            "track_count": 4,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    path = f"/music/smart-override-artist/smart-override-album/{filename}"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": filename,
            "title": title,
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": path,
        }
    )
    return pg_db.get_library_track_by_path(path)


def test_regenerate_playlist_tracks_preserves_manual_locks_and_exclusions(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
        remove_playlist_track,
    )

    manual = _seed_track(pg_db, title="Manual Keep", filename="01-manual.flac")
    excluded = _seed_track(pg_db, title="Removed Once", filename="02-removed.flac")
    fallback = _seed_track(pg_db, title="Fallback", filename="03-fallback.flac")

    playlist_id = create_playlist(
        "Smart Override Playlist",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "random"},
        scope="system",
        generation_mode="smart",
    )

    add_playlist_tracks(
        playlist_id,
        [{"track_id": manual["id"], "source": "manual", "locked": True}],
    )
    first_count = regenerate_playlist_tracks(
        playlist_id,
        [{"track_id": excluded["id"]}, {"track_id": fallback["id"]}],
        target_count=2,
    )
    first_tracks = get_playlist_tracks(playlist_id)

    assert first_count == 2
    assert [track["title"] for track in first_tracks] == [
        "Manual Keep",
        "Removed Once",
    ]
    assert first_tracks[0]["source"] == "manual"
    assert first_tracks[0]["locked"] is True

    remove_playlist_track(playlist_id, 2, record_exclusion=True)
    second_count = regenerate_playlist_tracks(
        playlist_id,
        [{"track_id": excluded["id"]}, {"track_id": fallback["id"]}],
        target_count=2,
    )
    second_tracks = get_playlist_tracks(playlist_id)

    assert second_count == 2
    assert [track["title"] for track in second_tracks] == [
        "Manual Keep",
        "Fallback",
    ]
    assert second_tracks[1]["source"] == "generated"
    assert second_tracks[1]["locked"] is False


def test_reorder_playlist_can_lock_curated_track_order(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        reorder_playlist,
    )

    first = _seed_track(pg_db, title="First", filename="10-first.flac")
    second = _seed_track(pg_db, title="Second", filename="11-second.flac")
    playlist_id = create_playlist("Manual Reorder Playlist", scope="system")

    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "generated"},
            {"track_id": second["id"], "source": "generated"},
        ],
    )
    tracks = get_playlist_tracks(playlist_id)

    reorder_playlist(
        playlist_id,
        [tracks[1]["id"], tracks[0]["id"]],
        lock_tracks=True,
    )

    reordered = get_playlist_tracks(playlist_id)
    assert [track["title"] for track in reordered] == ["Second", "First"]
    assert [track["locked"] for track in reordered] == [True, True]
