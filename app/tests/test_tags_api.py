"""Contract tests for the Tags API router."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestAlbumTagsByID:
    """PUT /api/albums/{album_id}/tags — update album tags by DB ID."""

    def test_enqueues_update_task(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Lateralus")
            ),
            patch(
                "crate.api.tags.library_path",
                return_value=Path("/tmp/test_crate_library"),
            ),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="tag-task-1"
            ) as mock_create,
        ):
            mock_dir = MagicMock()
            mock_dir.is_dir.return_value = True
            mock_safe.return_value = mock_dir

            resp = test_app.put(
                "/api/albums/7/tags",
                json={
                    "artist": "Tool",
                    "album": "Lateralus",
                    "date": "2001",
                    "genre": "Progressive Metal",
                },
            )

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "tag-task-1"
        mock_create.assert_called_once()
        params = mock_create.call_args[0][1]
        assert params["album_fields"]["artist"] == "Tool"
        assert params["album_fields"]["album"] == "Lateralus"
        assert params["album_fields"]["date"] == "2001"
        assert params["album_fields"]["genre"] == "Progressive Metal"

    def test_enqueues_with_track_tags(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Lateralus")
            ),
            patch(
                "crate.api.tags.library_path",
                return_value=Path("/tmp/test_crate_library"),
            ),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="tag-task-2"
            ) as mock_create,
        ):
            mock_dir = MagicMock()
            mock_dir.is_dir.return_value = True
            mock_safe.return_value = mock_dir

            resp = test_app.put(
                "/api/albums/7/tags",
                json={
                    "artist": "Tool",
                    "tracks": {"01 - The Grudge.flac": {"title": "The Grudge"}},
                },
            )

        assert resp.status_code == 200
        params = mock_create.call_args[0][1]
        assert params["track_tags"] == {"01 - The Grudge.flac": {"title": "The Grudge"}}

    def test_album_not_found(self, test_app):
        with patch("crate.api.tags.album_names_from_id", return_value=None):
            resp = test_app.put("/api/albums/999/tags", json={})

        assert resp.status_code == 404

    def test_album_dir_not_found(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Lateralus")
            ),
            patch(
                "crate.api.tags.library_path",
                return_value=Path("/tmp/test_crate_library"),
            ),
            patch("crate.api.tags.safe_path") as mock_safe,
        ):
            mock_dir = MagicMock()
            mock_dir.is_dir.return_value = False
            mock_safe.return_value = mock_dir

            resp = test_app.put("/api/albums/7/tags", json={})

        assert resp.status_code == 404

    def test_requires_admin(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Lateralus")
            ),
            patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")),
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put("/api/albums/1/tags", json={})

    def test_updates_only_supplied_fields(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Opiate")
            ),
            patch(
                "crate.api.tags.library_path",
                return_value=Path("/tmp/test_crate_library"),
            ),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="tag-task-3"
            ) as mock_create,
        ):
            mock_dir = MagicMock()
            mock_dir.is_dir.return_value = True
            mock_safe.return_value = mock_dir

            resp = test_app.put(
                "/api/albums/7/tags",
                json={"genre": "Alternative Metal"},
            )

        assert resp.status_code == 200
        params = mock_create.call_args[0][1]
        assert "genre" in params["album_fields"]
        assert "artist" not in params["album_fields"]


class TestAlbumTagsByEntityUID:
    """PUT /api/albums/by-entity/{album_entity_uid}/tags — update album tags by entity UID."""

    def test_enqueues_update_task(self, test_app):
        uid = "123e4567-e89b-12d3-a456-426614174000"
        with (
            patch(
                "crate.api.tags.album_names_from_entity_uid",
                return_value=("Tool", "Aenima"),
            ),
            patch(
                "crate.api.tags.library_path",
                return_value=Path("/tmp/test_crate_library"),
            ),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="tag-task-e1"
            ) as mock_create,
        ):
            mock_dir = MagicMock()
            mock_dir.is_dir.return_value = True
            mock_safe.return_value = mock_dir

            resp = test_app.put(
                f"/api/albums/by-entity/{uid}/tags",
                json={"album": "Aenima", "date": "1996"},
            )

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "tag-task-e1"
        params = mock_create.call_args[0][1]
        assert params["artist_folder"] == "Tool"
        assert params["album_folder"] == "Aenima"

    def test_entity_uid_not_found(self, test_app):
        uid = "123e4567-e89b-12d3-a456-426614174999"
        with patch("crate.api.tags.album_names_from_entity_uid", return_value=None):
            resp = test_app.put(f"/api/albums/by-entity/{uid}/tags", json={})

        assert resp.status_code == 404

    def test_requires_admin(self, test_app):
        uid = "123e4567-e89b-12d3-a456-426614174000"
        with (
            patch(
                "crate.api.tags.album_names_from_entity_uid",
                return_value=("Tool", "Aenima"),
            ),
            patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")),
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put(f"/api/albums/by-entity/{uid}/tags", json={})


class TestTrackTagsByID:
    """PUT /api/tracks/{track_id}/tags — update track tags by DB ID."""

    def test_enqueues_update_task(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/Artist/Album/01 - Track.flac",
            ),
            patch("crate.api.tags.library_path", return_value=Path("/music")),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="track-tag-1"
            ) as mock_create,
        ):
            mock_file = MagicMock()
            mock_file.is_file.return_value = True
            mock_safe.return_value = mock_file

            resp = test_app.put(
                "/api/tracks/42/tags",
                json={"title": "New Title", "artist": "New Artist"},
            )

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "track-tag-1"
        params = mock_create.call_args[0][1]
        assert params["filepath"] == "Artist/Album/01 - Track.flac"
        assert params["tags"] == {"title": "New Title", "artist": "New Artist"}

    def test_enqueues_with_empty_tags(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/Artist/Album/01.flac",
            ),
            patch("crate.api.tags.library_path", return_value=Path("/music")),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="track-tag-2"
            ) as mock_create,
        ):
            mock_file = MagicMock()
            mock_file.is_file.return_value = True
            mock_safe.return_value = mock_file

            resp = test_app.put("/api/tracks/42/tags", json={})

        assert resp.status_code == 200
        params = mock_create.call_args[0][1]
        assert params["filepath"] == "Artist/Album/01.flac"
        assert params["tags"] == {}

    def test_track_not_found_in_db(self, test_app):
        with patch("crate.api.tags.get_track_path_by_id", return_value=None):
            resp = test_app.put("/api/tracks/999/tags", json={})

        assert resp.status_code == 404

    def test_file_not_found_on_disk(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/Artist/Album/01.flac",
            ),
            patch("crate.api.tags.library_path", return_value=Path("/music")),
            patch("crate.api.tags.safe_path") as mock_safe,
        ):
            mock_file = MagicMock()
            mock_file.is_file.return_value = False
            mock_safe.return_value = mock_file

            resp = test_app.put("/api/tracks/42/tags", json={})

        assert resp.status_code == 404

    def test_path_traversal_blocked(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/../../etc/passwd",
            ),
            patch("crate.api.tags.library_path", return_value=Path("/music")),
            patch("crate.api.tags.safe_path", return_value=None),
        ):
            resp = test_app.put("/api/tracks/42/tags", json={})

        assert resp.status_code == 404

    def test_requires_admin(self, test_app):
        with patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put("/api/tracks/1/tags", json={})

    def test_handles_music_prefix_path(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/Artist/Album/Track.flac",
            ),
            patch("crate.api.tags.library_path", return_value=Path("/data/library")),
            patch("crate.api.tags.safe_path") as mock_safe,
            patch(
                "crate.api.tags.create_task", return_value="track-tag-3"
            ) as mock_create,
        ):
            mock_file = MagicMock()
            mock_file.is_file.return_value = True
            mock_safe.return_value = mock_file

            resp = test_app.put(
                "/api/tracks/42/tags",
                json={"title": "Track"},
            )

        assert resp.status_code == 200
        params = mock_create.call_args[0][1]
        assert params["filepath"] == "Artist/Album/Track.flac"


class TestTagsAuth:
    """Auth requirements for all tag endpoints."""

    def test_album_tags_by_id_requires_admin(self, test_app):
        with (
            patch(
                "crate.api.tags.album_names_from_id", return_value=("Tool", "Lateralus")
            ),
            patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")),
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put("/api/albums/1/tags", json={})

    def test_album_tags_by_entity_uid_requires_admin(self, test_app):
        uid = "123e4567-e89b-12d3-a456-426614174000"
        with (
            patch(
                "crate.api.tags.album_names_from_entity_uid",
                return_value=("Tool", "Aenima"),
            ),
            patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")),
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put(f"/api/albums/by-entity/{uid}/tags", json={})

    def test_track_tags_requires_admin(self, test_app):
        with (
            patch(
                "crate.api.tags.get_track_path_by_id",
                return_value="/music/Artist/Album/Track.flac",
            ),
            patch("crate.api.tags._require_admin", side_effect=Exception("forbidden")),
        ):
            with pytest.raises(Exception, match="forbidden"):
                test_app.put("/api/tracks/1/tags", json={})
