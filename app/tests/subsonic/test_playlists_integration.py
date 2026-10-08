"""PostgreSQL-backed OpenSubsonic playlist round-trip coverage."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_track(pg_db, *, title: str, filename: str) -> dict:
    artist = "OpenSubsonic Playlist Fixture"
    album = "OpenSubsonic Playlist Album"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": album,
            "path": "/music/opensubsonic-playlist-fixture/album",
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    path = f"/music/opensubsonic-playlist-fixture/album/{filename}"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": filename,
            "title": title,
            "track_number": int(filename[:2]),
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": path,
        }
    )
    return pg_db.get_library_track_by_path(path)


def test_playlist_crud_round_trips_through_native_repositories(pg_db):
    from crate.db.queries.subsonic_user_queries import get_user_by_username
    from crate.db.repositories.playlists_collection_reads import get_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.subsonic_playlist_mutations import (
        PlaylistMutationError,
        update_subsonic_playlist,
    )
    from crate.subsonic.services.playlists import (
        create_playlist,
        delete_playlist,
        get_playlist as get_subsonic_playlist,
        list_playlists,
        update_playlist,
    )

    user = get_user_by_username("admin")
    assert user is not None
    regular_user = {**user, "role": "user"}
    first = _seed_track(pg_db, title="First track", filename="01-first.flac")
    second = _seed_track(pg_db, title="Second track", filename="02-second.flac")

    playlist = create_playlist(
        regular_user, name="OpenSubsonic Set", song_ids=[str(first["id"])]
    )
    playlist_id = playlist["id"]
    numeric_playlist_id = int(playlist_id.removeprefix("pl-"))

    listed = list_playlists(regular_user)
    assert any(item["id"] == playlist_id for item in listed)
    assert playlist["songCount"] == 1
    assert playlist["duration"] == 180
    assert playlist["entry"][0]["title"] == "First track"

    with pytest.raises(PlaylistMutationError, match="not-authorized"):
        update_subsonic_playlist(
            numeric_playlist_id,
            user_id=999999,
            is_admin=False,
            fields={"name": "Unauthorized"},
            remove_indexes=[],
            tracks_to_add=[],
        )
    with pytest.raises(PlaylistMutationError, match="invalid-index"):
        update_subsonic_playlist(
            numeric_playlist_id,
            user_id=int(regular_user["id"]),
            is_admin=False,
            fields={"name": "Invalid removal"},
            remove_indexes=[1],
            tracks_to_add=[],
        )

    update_playlist(
        regular_user,
        playlist_id,
        name="Updated Set",
        comment="Changed through OpenSubsonic",
        public=True,
        song_ids_to_add=[str(second["id"])],
        song_indexes_to_remove=[0],
    )

    updated = get_subsonic_playlist(regular_user, playlist_id)
    native_tracks = get_playlist_tracks(numeric_playlist_id)
    assert updated["name"] == "Updated Set"
    assert updated["comment"] == "Changed through OpenSubsonic"
    assert updated["public"] is True
    assert [song["title"] for song in updated["entry"]] == ["Second track"]
    assert [track["title"] for track in native_tracks] == ["Second track"]
    assert native_tracks[0]["source"] == "manual"

    replaced = create_playlist(
        regular_user, playlist_id=playlist_id, song_ids=[str(first["id"])]
    )
    assert [song["title"] for song in replaced["entry"]] == ["First track"]

    delete_playlist(regular_user, playlist_id)
    assert get_playlist(numeric_playlist_id) is None
