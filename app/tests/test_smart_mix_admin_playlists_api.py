"""GET /api/admin/smart-mix/playlists: every user's Smart Mix playlists, their stem
work and the stem files' quota, for the admin's Analysis panel (ST2.PR4)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from crate.db.cache_settings import set_setting
from crate.db.tx import transaction_scope
from crate.smart_mix.stems import (
    ESTIMATED_STEM_SECONDS_PER_TRACK,
    STEM_MAX_TRACKS_PER_USER_SETTING,
    STEM_QUOTA_SETTING,
    STEM_UPLOADS_SETTING,
)
from tests.test_smart_mix_playlists_api import _as_user, _count_statements
from tests.test_smart_mix_playlists_repository import (
    _analysed,
    _playlist,
    _profiled,
    _tracks,
    _user,
)
from tests.test_smart_mix_track_stems_api import _job, _stem_file

URL = "/api/admin/smart-mix/playlists"


def _set_state(playlist_id: int, *, enabled: bool) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO smart_mix_playlists (
                    playlist_id, user_id, enabled, enabled_at, disabled_at, revision,
                    updated_at
                )
                SELECT id, user_id, :enabled, NOW() - INTERVAL '2 days',
                       CASE WHEN :enabled THEN NULL ELSE NOW() END, 1, NOW()
                FROM playlists WHERE id = :playlist_id
                """
            ),
            {"playlist_id": playlist_id, "enabled": enabled},
        )


def _title(track_id: int, title: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET title = :title WHERE id = :id"),
            {"id": track_id, "title": title},
        )


def _scenario() -> dict:
    owner, other = _user("admin-sm-owner"), _user("admin-sm-other")
    ready, failed, running, waiting, shared, parked = _tracks("admin-sm", 6)
    for track_id in (ready, failed, running, waiting, shared, parked):
        _profiled(track_id)
    _analysed(ready)
    _analysed(shared)
    _title(failed, "Assimilate")
    _job(
        failed,
        state="failed",
        attempts=3,
        last_error="ffmpeg could not decode Assimilate.flac",
        started_at="2026-11-09T01:44:00+00:00",
        finished_at="2026-11-09T01:47:00+00:00",
    )
    _job(running, state="analyzing", attempts=1, started_at="2026-11-09T03:00:00+00:00")
    _job(waiting)
    _stem_file(ready, size=1_000)
    _stem_file(shared, size=2_000)
    # A file of a track that only a playlist turned off holds goes first.
    _stem_file(parked, size=4_000)
    warehouse = _playlist(
        owner, [ready, failed, running, waiting, shared], name="Warehouse 03:00"
    )
    _set_state(warehouse, enabled=True)
    cold = _playlist(other, [shared], name="Cold Waves B2B")
    _set_state(cold, enabled=True)
    coche = _playlist(other, [parked, shared], name="PARA EL COCHE")
    _set_state(coche, enabled=False)
    _playlist(owner, [ready], name="Not Smart Mix")
    return {
        "owner": owner,
        "other": other,
        "warehouse": warehouse,
        "cold": cold,
        "coche": coche,
        "failed": failed,
    }


def test_lists_every_users_smart_mix_playlists_with_their_stem_work(
    pg_db, test_app
) -> None:
    del pg_db
    s = _scenario()

    response = test_app.get(URL)

    assert response.status_code == 200, response.text
    playlists = {p["playlistId"]: p for p in response.json()["playlists"]}
    assert set(playlists) == {s["warehouse"], s["cold"], s["coche"]}
    warehouse = playlists[s["warehouse"]]
    assert warehouse["name"] == "Warehouse 03:00"
    assert warehouse["owner"] == {"id": s["owner"], "username": "admin-sm-owner"}
    assert warehouse["enabled"] is True
    assert warehouse["enabledAt"] and warehouse["disabledAt"] is None
    assert warehouse["total"] == 5
    assert warehouse["counts"] == {
        "pending": 1,
        "analyzing": 1,
        "ready": 2,
        "failed": 1,
    }
    assert warehouse["estimatedSecondsLeft"] == 2 * ESTIMATED_STEM_SECONDS_PER_TRACK
    assert warehouse["failures"] == [
        {
            "trackId": s["failed"],
            "title": "Assimilate",
            "artist": "Stems Artist admin-sm",
            "attempts": 3,
            "lastError": "ffmpeg could not decode Assimilate.flac",
            "finishedAt": warehouse["failures"][0]["finishedAt"],
        }
    ]
    assert warehouse["failures"][0]["finishedAt"].startswith("2026-11-09T01:47:00")
    assert (warehouse["fileBytes"], warehouse["files"]) == (3_000, 2)

    cold = playlists[s["cold"]]
    assert cold["counts"] == {"pending": 0, "analyzing": 0, "ready": 1, "failed": 0}
    assert cold["estimatedSecondsLeft"] is None
    assert cold["failures"] == []

    # Turned off: its tracks still count, its work does not.
    coche = playlists[s["coche"]]
    assert (coche["enabled"], coche["total"]) == (False, 2)
    assert coche["disabledAt"] is not None
    assert coche["counts"] == {"pending": 0, "analyzing": 0, "ready": 0, "failed": 0}
    assert (coche["fileBytes"], coche["files"]) == (6_000, 2)
    # Playlists that are on come first.
    assert [p["enabled"] for p in response.json()["playlists"]] == [True, True, False]


def test_the_overview_counts_distinct_tracks_quota_use_and_settings(
    pg_db, test_app
) -> None:
    del pg_db
    _scenario()
    set_setting(STEM_QUOTA_SETTING, "20")
    set_setting(STEM_MAX_TRACKS_PER_USER_SETTING, "900")
    set_setting(STEM_UPLOADS_SETTING, "false")

    overview = test_app.get(URL).json()["overview"]

    assert (overview["playlistsOn"], overview["playlistsOff"]) == (2, 1)
    # The shared track counts once across the playlists that are on.
    assert overview["tracks"] == 5
    assert overview["counts"] == {
        "pending": 1,
        "analyzing": 1,
        "ready": 2,
        "failed": 1,
    }
    assert overview["secondsPerTrack"] == ESTIMATED_STEM_SECONDS_PER_TRACK
    assert overview["estimatedSecondsLeft"] == 2 * ESTIMATED_STEM_SECONDS_PER_TRACK
    assert overview["serverSeparator"] == "htdemucs-onnx-1"
    assert overview["storage"] == {
        "usedBytes": 7_000,
        "files": 3,
        "evictableBytes": 4_000,
    }
    assert overview["settings"] == {
        "maxTracksPerPlaylist": 300,
        "maxTracksPerUser": 900,
        "quotaGib": 20,
        "uploadsEnabled": False,
    }


def test_an_instance_without_smart_mix_playlists_reads_empty(pg_db, test_app) -> None:
    del pg_db

    body = test_app.get(URL).json()

    assert body["playlists"] == []
    overview = body["overview"]
    assert (overview["playlistsOn"], overview["playlistsOff"], overview["tracks"]) == (
        0,
        0,
        0,
    )
    assert overview["estimatedSecondsLeft"] is None
    assert overview["serverSeparator"] is None
    assert overview["storage"] == {"usedBytes": 0, "files": 0, "evictableBytes": 0}
    assert overview["settings"] == {
        "maxTracksPerPlaylist": 300,
        "maxTracksPerUser": None,
        "quotaGib": 50,
        "uploadsEnabled": True,
    }


def test_only_analysis_managers_read_it(pg_db, test_app, monkeypatch) -> None:
    del pg_db
    _as_user(monkeypatch, _user("admin-sm-listener"))
    assert test_app.get(URL).status_code == 403
    _as_user(monkeypatch, _user("admin-sm-librarian"), role="librarian")
    assert test_app.get(URL).status_code == 200


def test_the_listing_is_bounded(pg_db, test_app) -> None:
    del pg_db
    owner = _user("admin-sm-bounded")
    for n in range(4):
        _set_state(_playlist(owner, _tracks(f"admin-sm-bounded-{n}", 2)), enabled=True)

    statements, stop = _count_statements()
    try:
        limited = test_app.get(URL, params={"limit": 2})
    finally:
        stop()

    assert limited.status_code == 200
    assert len(limited.json()["playlists"]) == 2
    assert limited.json()["overview"]["playlistsOn"] == 4
    assert len(statements) <= 2, statements
    assert test_app.get(URL, params={"limit": 0}).status_code == 422
    assert test_app.get(URL, params={"limit": 501}).status_code == 422


@pytest.mark.parametrize("spec", ["/openapi.json", "/openapi-admin-system.json"])
def test_openapi_types_the_admin_listing(test_app, spec: str) -> None:
    schema = test_app.get(spec).json()
    operation = schema["paths"]["/api/admin/smart-mix/playlists"]["get"]

    assert operation["tags"] == ["admin"]
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixAdminPlaylistsResponse"
    }
    assert [parameter["name"] for parameter in operation["parameters"]] == ["limit"]
