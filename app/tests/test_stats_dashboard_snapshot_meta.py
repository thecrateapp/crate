"""The dashboard routes must keep the snapshot block so cold payloads poll."""

from unittest.mock import patch

import pytest


@pytest.mark.parametrize(
    "path",
    [
        "/api/me/stats/dashboard",
        "/api/users/testadmin/stats/dashboard",
        "/api/stats/dashboard",
    ],
)
def test_cold_dashboard_keeps_pending_snapshot(pg_db, test_app, path):
    with patch(
        "crate.api.social.get_public_user_profile_by_username",
        return_value={"id": 1, "username": "testadmin", "display_name": "Test Admin"},
    ):
        response = test_app.get(path)

    assert response.status_code == 200
    snapshot = response.json()["snapshot"]
    assert snapshot["pending"] is True
    assert snapshot["version"] == 0
