"""Instagram handle on user profiles."""

import pytest

from crate.api.schemas.auth import UpdateProfileRequest, normalize_instagram_handle
from tests.conftest import PG_AVAILABLE


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("diego.trecedoce", "diego.trecedoce"),
        ("@diego.trecedoce", "diego.trecedoce"),
        ("  @diego_13  ", "diego_13"),
        ("https://www.instagram.com/diego.trecedoce/", "diego.trecedoce"),
        ("instagram.com/diego.trecedoce?igsh=abc", "diego.trecedoce"),
        ("", ""),
    ],
)
def test_normalize_instagram_handle(raw, expected):
    assert normalize_instagram_handle(raw) == expected


@pytest.mark.parametrize("raw", ["diego trecedoce", "diego!", "a" * 31])
def test_update_profile_rejects_invalid_instagram_handles(raw):
    with pytest.raises(ValueError):
        UpdateProfileRequest(instagram_handle=raw)


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_profile_stores_and_clears_the_instagram_handle(pg_db, test_app):
    saved = test_app.put(
        "/api/auth/profile", json={"instagram_handle": "@diego.trecedoce"}
    )
    assert saved.status_code == 200

    me = test_app.get("/api/auth/me")
    assert me.json()["instagram_handle"] == "diego.trecedoce"

    cleared = test_app.put("/api/auth/profile", json={"instagram_handle": ""})
    assert cleared.status_code == 200
    assert test_app.get("/api/auth/me").json()["instagram_handle"] is None
