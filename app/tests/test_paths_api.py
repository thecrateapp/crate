"""Contract tests for the Paths API router."""

from unittest.mock import patch

import pytest


def _make_path_payload(**overrides):
    data = {
        "name": "Test Path",
        "origin": {"type": "artist", "value": "7"},
        "destination": {"type": "genre", "value": "post-hardcore"},
        "waypoints": [],
        "step_count": 20,
    }
    data.update(overrides)
    return data


def _make_mock_path(id=1):
    return {
        "id": id,
        "user_id": 1,
        "name": "Test Path",
        "origin_type": "artist",
        "origin_value": "7",
        "origin_label": "Tool",
        "dest_type": "genre",
        "dest_value": "post-hardcore",
        "dest_label": "Post-Hardcore",
        "step_count": 20,
        "tracks": [
            {
                "position": 1,
                "track_id": 42,
                "track_entity_uid": "aaa-bbb-ccc",
                "title": "Schism",
                "artist": "Tool",
                "album": "Lateralus",
                "duration": 414,
                "bliss_distance": 0.12,
            },
        ],
        "created_at": "2024-01-01T00:00:00",
    }


class TestCreatePath:
    """POST /api/paths — create a music path."""

    def test_creates_path(self, test_app):
        result = _make_mock_path()
        with (
            patch("crate.db.paths.resolve_endpoint_label", return_value="Tool"),
            patch(
                "crate.db.paths.create_music_path", return_value=result
            ) as mock_create,
        ):
            resp = test_app.post("/api/paths", json=_make_path_payload())

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 1
        assert data["name"] == "Test Path"
        mock_create.assert_called_once()

    def test_creates_path_with_waypoints(self, test_app):
        result = _make_mock_path()
        payload = _make_path_payload(
            waypoints=[
                {"type": "album", "value": "14"},
                {"type": "track", "value": "42"},
            ]
        )
        with (
            patch("crate.db.paths.resolve_endpoint_label", return_value="Tool"),
            patch(
                "crate.db.paths.create_music_path", return_value=result
            ) as mock_create,
        ):
            resp = test_app.post("/api/paths", json=payload)

        assert resp.status_code == 200
        args = mock_create.call_args[1]
        assert len(args["waypoints"]) == 2
        assert args["waypoints"][0] == {"type": "album", "value": "14"}
        assert args["waypoints"][1] == {"type": "track", "value": "42"}

    def test_auto_generates_name_when_not_provided(self, test_app):
        result = _make_mock_path()
        payload = _make_path_payload()
        del payload["name"]
        with (
            patch(
                "crate.db.paths.resolve_endpoint_label",
                side_effect=["Tool", "Post-Hardcore"],
            ),
            patch(
                "crate.db.paths.create_music_path", return_value=result
            ) as mock_create,
        ):
            resp = test_app.post("/api/paths", json=payload)

        assert resp.status_code == 200
        args = mock_create.call_args[1]
        assert args["name"] == "Tool → Post-Hardcore"

    def test_returns_422_when_computation_fails(self, test_app):
        with (
            patch("crate.db.paths.resolve_endpoint_label", return_value="Tool"),
            patch("crate.db.paths.create_music_path", return_value=None),
        ):
            resp = test_app.post("/api/paths", json=_make_path_payload())

        assert resp.status_code == 422
        assert "bliss vectors" in resp.json()["error"]

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.post("/api/paths", json=_make_path_payload())

    def test_step_count_bounds(self, test_app):
        result = _make_mock_path()
        payload = _make_path_payload(step_count=5)
        with (
            patch("crate.db.paths.resolve_endpoint_label", return_value="Tool"),
            patch(
                "crate.db.paths.create_music_path", return_value=result
            ) as mock_create,
        ):
            resp = test_app.post("/api/paths", json=payload)
            assert resp.status_code == 200
            assert mock_create.call_args[1]["step_count"] == 5

        payload_max = _make_path_payload(step_count=100)
        with (
            patch("crate.db.paths.resolve_endpoint_label", return_value="Tool"),
            patch(
                "crate.db.paths.create_music_path", return_value=result
            ) as mock_create,
        ):
            resp = test_app.post("/api/paths", json=payload_max)
            assert resp.status_code == 200
            assert mock_create.call_args[1]["step_count"] == 100

    def test_rejects_invalid_endpoint_type(self, test_app):
        payload = _make_path_payload(origin={"type": "invalid", "value": "x"})
        with patch("crate.db.paths.create_music_path", return_value=None):
            resp = test_app.post("/api/paths", json=payload)
        assert resp.status_code == 422


class TestListPaths:
    """GET /api/paths — list user's music paths."""

    def test_returns_paths(self, test_app):
        paths = [
            {"id": 1, "name": "Path A", "created_at": "2024-01-01"},
            {"id": 2, "name": "Path B", "created_at": "2024-01-02"},
        ]
        with patch("crate.db.paths.list_music_paths", return_value=paths) as mock_list:
            resp = test_app.get("/api/paths")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["name"] == "Path A"
        assert data[1]["name"] == "Path B"
        mock_list.assert_called_once_with(1)

    def test_returns_empty_list(self, test_app):
        with patch("crate.db.paths.list_music_paths", return_value=[]):
            resp = test_app.get("/api/paths")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.get("/api/paths")


class TestGetPath:
    """GET /api/paths/{path_id} — get a music path with tracks."""

    def test_returns_path(self, test_app):
        result = _make_mock_path()
        with patch("crate.db.paths.get_music_path", return_value=result) as mock_get:
            resp = test_app.get("/api/paths/1")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 1
        assert data["name"] == "Test Path"
        assert len(data["tracks"]) == 1
        assert data["tracks"][0]["title"] == "Schism"
        mock_get.assert_called_once_with(1, 1)

    def test_path_not_found(self, test_app):
        with patch("crate.db.paths.get_music_path", return_value=None):
            resp = test_app.get("/api/paths/999")

        assert resp.status_code == 404
        assert resp.json()["error"] == "Not found"

    def test_path_not_found_returns_404_not_200(self, test_app):
        with patch("crate.db.paths.get_music_path", return_value=None):
            resp = test_app.get("/api/paths/999")

        assert resp.status_code == 404

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.get("/api/paths/1")


class TestDeletePath:
    """DELETE /api/paths/{path_id} — delete a music path."""

    def test_deletes_path(self, test_app):
        with patch("crate.db.paths.delete_music_path", return_value=True) as mock_del:
            resp = test_app.delete("/api/paths/1")

        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"
        mock_del.assert_called_once_with(1, 1)

    def test_path_not_found(self, test_app):
        with patch("crate.db.paths.delete_music_path", return_value=False):
            resp = test_app.delete("/api/paths/999")

        assert resp.status_code == 404
        assert resp.json()["error"] == "Not found"

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.delete("/api/paths/1")


class TestRegeneratePath:
    """POST /api/paths/{path_id}/regenerate — recompute a path."""

    def test_regenerates_path(self, test_app):
        result = _make_mock_path(id=3)
        with patch(
            "crate.db.paths.regenerate_music_path", return_value=result
        ) as mock_regen:
            resp = test_app.post("/api/paths/3/regenerate")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 3
        mock_regen.assert_called_once_with(3, 1)

    def test_regeneration_fails(self, test_app):
        with patch("crate.db.paths.regenerate_music_path", return_value=None):
            resp = test_app.post("/api/paths/3/regenerate")

        assert resp.status_code == 404
        assert "Not found or computation failed" in resp.json()["error"]

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.post("/api/paths/1/regenerate")


class TestPreviewPath:
    """POST /api/paths/preview — preview a path without saving."""

    def test_previews_path(self, test_app):
        result = {
            "tracks": [
                {
                    "position": 1,
                    "track_id": 42,
                    "title": "Schism",
                    "bliss_distance": 0.12,
                },
            ],
            "total_distance": 0.12,
        }
        with patch(
            "crate.db.paths.preview_music_path", return_value=result
        ) as mock_preview:
            resp = test_app.post(
                "/api/paths/preview",
                json={
                    "origin": {"type": "artist", "value": "7"},
                    "destination": {"type": "artist", "value": "9"},
                    "step_count": 10,
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["tracks"]) == 1
        assert data["tracks"][0]["title"] == "Schism"
        mock_preview.assert_called_once()

    def test_preview_with_waypoints(self, test_app):
        result = {"tracks": [], "total_distance": 0}
        with patch(
            "crate.db.paths.preview_music_path", return_value=result
        ) as mock_preview:
            resp = test_app.post(
                "/api/paths/preview",
                json={
                    "origin": {"type": "artist", "value": "7"},
                    "destination": {"type": "genre", "value": "metalcore"},
                    "waypoints": [{"type": "album", "value": "14"}],
                    "step_count": 20,
                },
            )

        assert resp.status_code == 200
        args = mock_preview.call_args[1]
        assert len(args["waypoints"]) == 1
        assert args["waypoints"][0] == {"type": "album", "value": "14"}

    def test_preview_computation_fails(self, test_app):
        with patch("crate.db.paths.preview_music_path", return_value=None):
            resp = test_app.post(
                "/api/paths/preview",
                json={
                    "origin": {"type": "artist", "value": "7"},
                    "destination": {"type": "artist", "value": "9"},
                    "step_count": 20,
                },
            )

        assert resp.status_code == 422
        assert "bliss vectors" in resp.json()["error"]

    def test_requires_auth(self, test_app):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                test_app.post(
                    "/api/paths/preview",
                    json={
                        "origin": {"type": "artist", "value": "7"},
                        "destination": {"type": "artist", "value": "9"},
                        "step_count": 20,
                    },
                )

    def test_step_count_validation(self, test_app):
        resp = test_app.post(
            "/api/paths/preview",
            json={
                "origin": {"type": "artist", "value": "7"},
                "destination": {"type": "artist", "value": "9"},
                "step_count": 4,
            },
        )
        assert resp.status_code == 422

        resp = test_app.post(
            "/api/paths/preview",
            json={
                "origin": {"type": "artist", "value": "7"},
                "destination": {"type": "artist", "value": "9"},
                "step_count": 101,
            },
        )
        assert resp.status_code == 422


class TestPathsAuth:
    """Auth requirements across all path endpoints."""

    @pytest.mark.parametrize(
        "method,url",
        [
            ("GET", "/api/paths"),
            ("POST", "/api/paths"),
            ("GET", "/api/paths/1"),
            ("DELETE", "/api/paths/1"),
            ("POST", "/api/paths/1/regenerate"),
            ("POST", "/api/paths/preview"),
        ],
    )
    def test_all_path_endpoints_require_auth(self, test_app, method, url):
        with patch(
            "crate.api.paths._require_auth", side_effect=Exception("unauthorized")
        ):
            with pytest.raises(Exception, match="unauthorized"):
                if method == "GET":
                    test_app.get(url)
                elif method == "DELETE":
                    test_app.delete(url)
                elif method == "POST" and url == "/api/paths/preview":
                    test_app.post(
                        url,
                        json={
                            "origin": {"type": "artist", "value": "7"},
                            "destination": {"type": "artist", "value": "9"},
                            "step_count": 20,
                        },
                    )
                else:
                    test_app.post(
                        url, json=_make_path_payload() if url == "/api/paths" else {}
                    )
