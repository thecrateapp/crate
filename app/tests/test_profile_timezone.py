"""IANA timezone on user profiles, used to bucket listening stats."""

import pytest

from crate.api.schemas.auth import UpdateProfileRequest, normalize_timezone
from tests.conftest import PG_AVAILABLE


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Europe/Madrid", "Europe/Madrid"),
        ("  America/New_York ", "America/New_York"),
        ("UTC", "UTC"),
        ("", ""),
    ],
)
def test_normalize_timezone(raw, expected):
    assert normalize_timezone(raw) == expected


@pytest.mark.parametrize("raw", ["Madrid", "GMT+2", "Europe/Atlantis", "../etc"])
def test_update_profile_rejects_unknown_timezones(raw):
    with pytest.raises(ValueError):
        UpdateProfileRequest(timezone=raw)


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_profile_stores_and_clears_the_timezone(pg_db, test_app):
    saved = test_app.put("/api/auth/profile", json={"timezone": "Europe/Madrid"})
    assert saved.status_code == 200
    assert test_app.get("/api/auth/me").json()["timezone"] == "Europe/Madrid"

    cleared = test_app.put("/api/auth/profile", json={"timezone": ""})
    assert cleared.status_code == 200
    assert test_app.get("/api/auth/me").json()["timezone"] is None
