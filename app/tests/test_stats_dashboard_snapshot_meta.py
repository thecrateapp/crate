"""The dashboard routes must keep the snapshot block in every state.

Cold payloads carry a pending block so Listen polls. Warm and stale payloads carry the stored
``ui_snapshots`` row, whose ``built_at`` and ``stale_after`` are TIMESTAMPTZ datetimes; the
response model must serialise them instead of failing validation with a 500.
"""

from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import text

_ROUTES = [
    "/api/me/stats/dashboard",
    "/api/users/testadmin/stats/dashboard",
    "/api/stats/dashboard",
]


def _get(test_app, path: str):
    with patch(
        "crate.api.social.get_public_user_profile_by_username",
        return_value={"id": 1, "username": "testadmin", "display_name": "Test Admin"},
    ):
        # The social route defaults albums_limit to 10; Listen always sends 14, which is
        # also the default the refresh functions store under.
        return test_app.get(f"{path}?window=30d&albums_limit=14")


def _store_snapshot(path: str) -> None:
    if path == "/api/stats/dashboard":
        from crate.db.instance_stats_dashboard_surface import (
            refresh_instance_stats_dashboard_snapshot,
        )

        refresh_instance_stats_dashboard_snapshot(window="30d")
        return
    from crate.db.user_stats_dashboard_surface import (
        refresh_user_stats_dashboard_snapshot,
    )

    refresh_user_stats_dashboard_snapshot(1, window="30d")


def _age_snapshots(seconds: int) -> None:
    """Move every stored snapshot back in time, keeping stale_after after built_at."""
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE ui_snapshots
                SET built_at = built_at - make_interval(secs => :seconds),
                    stale_after = stale_after - make_interval(secs => :seconds)
                WHERE scope LIKE 'stats:dashboard%'
                """
            ),
            {"seconds": seconds},
        )


def _assert_iso_with_timezone(value: object) -> datetime:
    assert isinstance(value, str), value
    parsed = datetime.fromisoformat(value)
    assert parsed.tzinfo is not None, value
    return parsed


@pytest.mark.parametrize("path", _ROUTES)
def test_cold_dashboard_keeps_pending_snapshot(pg_db, test_app, path):
    response = _get(test_app, path)

    assert response.status_code == 200
    snapshot = response.json()["snapshot"]
    assert snapshot["pending"] is True
    assert snapshot["version"] == 0


@pytest.mark.parametrize("path", _ROUTES)
def test_warm_dashboard_serialises_snapshot_timestamps(pg_db, test_app, path):
    _store_snapshot(path)

    response = _get(test_app, path)

    assert response.status_code == 200, response.text[:400]
    snapshot = response.json()["snapshot"]
    assert snapshot["version"] >= 1
    assert snapshot["stale"] is False
    assert snapshot["pending"] is False
    built_at = _assert_iso_with_timezone(snapshot["built_at"])
    stale_after = _assert_iso_with_timezone(snapshot["stale_after"])
    assert stale_after > built_at


@pytest.mark.parametrize("path", _ROUTES)
def test_stale_dashboard_serialises_snapshot_timestamps(pg_db, test_app, path):
    _store_snapshot(path)
    _age_snapshots(600)

    response = _get(test_app, path)

    assert response.status_code == 200, response.text[:400]
    snapshot = response.json()["snapshot"]
    assert snapshot["version"] >= 1
    assert snapshot["stale"] is True
    built_at = _assert_iso_with_timezone(snapshot["built_at"])
    stale_after = _assert_iso_with_timezone(snapshot["stale_after"])
    assert stale_after > built_at
