from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.services import playlists


_USER = {"id": 7, "username": "diego", "role": "user"}
_PLAYLIST = {
    "id": 12,
    "name": "Heavy rotation",
    "description": "Favorites",
    "user_id": 7,
    "scope": "user",
    "visibility": "private",
    "track_count": 1,
    "total_duration": 94.8,
    "created_at": datetime(2026, 9, 1, tzinfo=UTC),
    "updated_at": datetime(2026, 9, 2, tzinfo=UTC),
    "cover_path": "12.webp",
    "generation_mode": "static",
}
_TRACK_ID = "gt-33333333-3333-4333-8333-333333333333"
_TRACK = {
    "global_track_uid": "33333333-3333-4333-8333-333333333333",
    "global_artist_uid": "11111111-1111-4111-8111-111111111111",
    "global_album_uid": "22222222-2222-4222-8222-222222222222",
    "title": "Concubine",
    "artist": "Converge",
    "album": "Jane Doe",
    "duration": 94,
    "format": "flac",
    "has_cover": True,
}


def test_list_playlists_only_serializes_playlists_visible_to_user():
    private = {**_PLAYLIST, "id": 12}
    with (
        patch(
            "crate.subsonic.services.playlists.get_open_subsonic_playlists",
            return_value=[private],
        ) as load,
        patch(
            "crate.subsonic.services.playlists.playlist_cover_abspath",
            return_value=MagicMock(is_file=MagicMock(return_value=True)),
        ),
    ):
        result = playlists.list_playlists(_USER)

    assert [item["id"] for item in result] == ["pl-12"]
    assert result[0] == {
        "id": "pl-12",
        "name": "Heavy rotation",
        "comment": "Favorites",
        "public": False,
        "songCount": 1,
        "duration": 94,
        "created": "2026-09-01T00:00:00+00:00",
        "changed": "2026-09-02T00:00:00+00:00",
        "coverArt": "pl-12",
        "owner": "diego",
        "readonly": False,
    }

    load.assert_called_once_with(user_id=7, is_admin=False)


def test_list_playlists_rejects_non_admin_username_override():
    with pytest.raises(OpenSubsonicError) as error:
        playlists.list_playlists(_USER, username="other")

    assert error.value.code == ErrorCode.NOT_AUTHORIZED


def test_list_playlists_admin_can_select_another_user():
    admin = {"id": 1, "username": "admin", "role": "admin"}
    target = {"id": 19, "username": "other", "role": "user"}
    with (
        patch(
            "crate.subsonic.services.playlists.get_user_by_username",
            return_value=target,
        ) as lookup,
        patch(
            "crate.subsonic.services.playlists.get_open_subsonic_playlists",
            return_value=[],
        ) as load,
    ):
        assert playlists.list_playlists(admin, username="other") == []

    lookup.assert_called_once_with("other")
    load.assert_called_once_with(user_id=19, is_admin=False)


def test_get_playlist_returns_ordered_songs_and_playlist_artwork():
    with (
        patch(
            "crate.subsonic.services.playlists.get_playlist_record",
            return_value=_PLAYLIST,
        ),
        patch("crate.subsonic.services.playlists.can_view_playlist", return_value=True),
        patch(
            "crate.subsonic.services.playlists.get_playlist_tracks",
            return_value=[_TRACK, {**_TRACK, "duration": 21}],
        ),
        patch(
            "crate.subsonic.services.playlists.playlist_cover_abspath",
            return_value=MagicMock(is_file=MagicMock(return_value=True)),
        ),
    ):
        result = playlists.get_playlist(_USER, "pl-12")

    assert result["id"] == "pl-12"
    assert result["coverArt"] == "pl-12"
    assert result["entry"][0]["id"] == "gt-33333333-3333-4333-8333-333333333333"
    assert result["entry"][0]["title"] == "Concubine"
    assert result["songCount"] == 2
    assert result["duration"] == 115


def test_get_playlist_hides_private_playlist_from_other_users():
    with (
        patch(
            "crate.subsonic.services.playlists.get_playlist_record",
            return_value=_PLAYLIST,
        ),
        patch(
            "crate.subsonic.services.playlists.can_view_playlist", return_value=False
        ),
    ):
        with pytest.raises(OpenSubsonicError) as error:
            playlists.get_playlist({"id": 8, "role": "user"}, "pl-12")

    assert error.value.code == ErrorCode.NOT_FOUND


def test_update_playlist_removes_zero_based_indices_in_descending_order():
    with (
        patch("crate.subsonic.services.playlists.update_subsonic_playlist") as update,
    ):
        playlists.update_playlist(
            _USER,
            "pl-12",
            name="New name",
            comment="Updated",
            public=True,
            song_indexes_to_remove=[0, 2],
        )

    update.assert_called_once_with(
        12,
        user_id=7,
        is_admin=False,
        fields={"name": "New name", "description": "Updated", "visibility": "public"},
        remove_indexes=[0, 2],
        tracks_to_add=[],
    )


def test_create_playlist_rejects_unresolvable_song_before_writing():
    with (
        patch(
            "crate.subsonic.services.playlists.catalog.song_detail", return_value=None
        ),
        patch("crate.subsonic.services.playlists.create_subsonic_playlist") as create,
    ):
        with pytest.raises(OpenSubsonicError) as error:
            playlists.create_playlist(_USER, name="Bad playlist", song_ids=[_TRACK_ID])

    assert error.value.code == ErrorCode.NOT_FOUND
    create.assert_not_called()


def test_create_playlist_marks_added_songs_as_manual():
    result = {"id": "pl-12", "name": "Set"}

    with (
        patch(
            "crate.subsonic.services.playlists.catalog.song_detail", return_value=_TRACK
        ),
        patch(
            "crate.subsonic.services.playlists.create_subsonic_playlist",
            return_value=12,
        ) as create,
        patch("crate.subsonic.services.playlists.get_playlist", return_value=result),
    ):
        assert (
            playlists.create_playlist(_USER, name="Set", song_ids=[_TRACK_ID]) == result
        )

    create.assert_called_once_with(
        "Set",
        7,
        [
            {
                "global_track_uid": "33333333-3333-4333-8333-333333333333",
                "source": "manual",
            }
        ],
    )


def test_create_playlist_with_existing_id_replaces_tracks_as_manual():
    result = {"id": "pl-12", "name": "Set"}

    with (
        patch(
            "crate.subsonic.services.playlists.catalog.song_detail", return_value=_TRACK
        ),
        patch("crate.subsonic.services.playlists.replace_subsonic_playlist") as replace,
        patch("crate.subsonic.services.playlists.get_playlist", return_value=result),
    ):
        assert (
            playlists.create_playlist(_USER, playlist_id="pl-12", song_ids=[_TRACK_ID])
            == result
        )

    replace.assert_called_once_with(
        12,
        user_id=7,
        is_admin=False,
        name=None,
        tracks=[
            {
                "global_track_uid": "33333333-3333-4333-8333-333333333333",
                "source": "manual",
            }
        ],
    )


def test_update_playlist_rejects_out_of_range_indices_without_mutation():
    with (
        patch(
            "crate.subsonic.services.playlists.update_subsonic_playlist",
            side_effect=playlists.PlaylistMutationError("invalid-index"),
        ) as update,
    ):
        with pytest.raises(OpenSubsonicError) as error:
            playlists.update_playlist(
                _USER, "pl-12", name="Changed", song_indexes_to_remove=[1]
            )

    assert error.value.code == ErrorCode.NOT_FOUND
    update.assert_called_once()


def test_delete_playlist_requires_owner_and_does_not_remove_other_users_playlist():
    with (
        patch(
            "crate.subsonic.services.playlists.delete_subsonic_playlist",
            side_effect=playlists.PlaylistMutationError("not-authorized"),
        ) as delete,
    ):
        with pytest.raises(OpenSubsonicError) as error:
            playlists.delete_playlist({"id": 99, "role": "user"}, "pl-12")

    assert error.value.code == ErrorCode.NOT_AUTHORIZED
    delete.assert_called_once_with(12, user_id=99, is_admin=False)


def test_mutation_returns_not_found_when_playlist_lock_finds_no_row():
    with (
        patch(
            "crate.subsonic.services.playlists.update_subsonic_playlist",
            side_effect=playlists.PlaylistMutationError("not-found"),
        ) as update,
    ):
        with pytest.raises(OpenSubsonicError) as error:
            playlists.update_playlist(_USER, "pl-404", name="Missing")

    assert error.value.code == ErrorCode.NOT_FOUND
    update.assert_called_once()


def test_playlist_mutation_locks_row_before_loading_it():
    from crate.db.repositories.playlists_mutate import lock_playlist

    session = MagicMock()
    session.execute.return_value.first.return_value = (12,)

    assert lock_playlist(12, session=session)

    statement = str(session.execute.call_args.args[0])
    assert "FOR UPDATE" in statement
    assert session.execute.call_args.args[1] == {"playlist_id": 12}
