"""Contract tests for personal user API endpoints."""

from unittest.mock import patch


class TestMeLocationAPI:
    def test_update_location_invalidates_show_dependent_cache(self, test_app):
        with (
            patch("crate.api.me.update_user_location") as update_location,
            patch("crate.api.me.broadcast_invalidation") as broadcast,
        ):
            resp = test_app.put(
                "/api/me/location",
                json={
                    "city": "Milan",
                    "latitude": 45.4641943,
                    "longitude": 9.1896346,
                    "show_radius_km": 200,
                },
            )

        assert resp.status_code == 200
        update_location.assert_called_once_with(
            1,
            city="Milan",
            latitude=45.4641943,
            longitude=9.1896346,
            show_radius_km=200,
        )
        broadcast.assert_called_once_with("shows", "upcoming")
