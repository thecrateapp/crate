"""Smart Mix playlists over HTTP and in playlist responses (STEM-D2, design §5)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, text

from crate.db.cache_settings import set_setting
from crate.db.repositories.playlists_create import create_playlist
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.stems import (
    ESTIMATED_STEM_SECONDS_PER_TRACK,
    STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
)
from tests.test_smart_mix_playlists_repository import (
    _analysed,
    _fill,
    _jobs,
    _playlist,
    _profiled,
    _tracks,
    _user,
)

# The test client's session is user 1, an admin (tests/conftest.py).
ME = 1


def _url(playlist_id: int | str = "") -> str:
    return f"/api/smart-mix/playlists/{playlist_id}".rstrip("/")


def _as_user(monkeypatch, user_id: int, role: str = "user") -> None:
    async def resolve(self, request):
        del self, request
        return {"id": user_id, "email": f"{user_id}@test.local", "role": role}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve)


def _count_statements():
    from crate.db.engine import get_engine

    statements: list[str] = []

    def capture(_conn, _cursor, statement, *_args) -> None:
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    return statements, lambda: event.remove(engine, "before_cursor_execute", capture)


def test_put_toggles_and_returns_the_state(pg_db, test_app, monkeypatch) -> None:
    del pg_db
    playlist_id = _playlist(ME, _tracks("api-toggle", 2))

    on = test_app.put(_url(playlist_id), json={"enabled": True})

    assert on.status_code == 200, on.text
    body = on.json()
    assert body["playlistId"] == playlist_id
    assert body["enabled"] is True
    assert body["revision"] == 1
    assert body["enabledAt"] and body["lastUsedAt"] and body["updatedAt"]
    assert body["disabledAt"] is None
    assert set(_jobs()) == set(_tracks_of(playlist_id))

    off = test_app.put(_url(playlist_id), json={"enabled": False}).json()
    assert (off["enabled"], off["revision"]) == (False, 2)
    assert off["disabledAt"] is not None

    # The body is strict, the playlist must exist, and only its owner may toggle it.
    assert test_app.put(_url(playlist_id), json={}).status_code == 422
    assert (
        test_app.put(_url(playlist_id), json={"enabled": True, "x": 1}).status_code
        == 422
    )
    assert test_app.put(_url(999_999), json={"enabled": True}).status_code == 404
    _as_user(monkeypatch, _user("api-toggle-other"))
    assert test_app.put(_url(playlist_id), json={"enabled": True}).status_code == 403


def test_put_answers_409_over_a_limit(pg_db, test_app) -> None:
    del pg_db
    playlist_id = _playlist(ME, _tracks("api-limit", 3))
    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "2")

    response = test_app.put(_url(playlist_id), json={"enabled": True})

    assert response.status_code == 409
    assert "2" in response.json()["detail"]
    assert _jobs() == {}


def _tracks_of(playlist_id: int) -> list[int]:
    with read_scope() as session:
        return list(
            session.execute(
                text(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = :id "
                    "AND track_id IS NOT NULL ORDER BY position"
                ),
                {"id": playlist_id},
            ).scalars()
        )


def _uid(track_id: int) -> str:
    with read_scope() as session:
        return session.execute(
            text("SELECT entity_uid::text FROM library_tracks WHERE id = :id"),
            {"id": track_id},
        ).scalar_one()


def test_status_lists_per_track_states(pg_db, test_app, monkeypatch) -> None:
    del pg_db
    ready, running, failed, waiting = _tracks("api-status", 4)
    for track_id in (ready, running, failed, waiting):
        _profiled(track_id)
    _analysed(ready)
    playlist_id = _playlist(ME, [ready, running, failed, waiting, ready])
    assert test_app.put(_url(playlist_id), json={"enabled": True}).status_code == 200
    now = datetime.now(UTC)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_stem_jobs
                SET state = CASE track_id WHEN :running THEN 'analyzing'
                                          ELSE 'failed' END,
                    attempts = CASE track_id WHEN :running THEN 1 ELSE 3 END
                WHERE track_id IN (:running, :failed)
                """
            ),
            {"running": running, "failed": failed},
        )

    status = test_app.get(_url(playlist_id))

    assert status.status_code == 200, status.text
    body = status.json()
    assert body["playlistId"] == playlist_id and body["enabled"] is True
    assert body["total"] == 4
    assert body["counts"] == {"pending": 1, "analyzing": 1, "ready": 1, "failed": 1}
    assert body["tracks"] == [
        # Separated before the playlist was turned on: no job, nothing attempted.
        {
            "trackId": ready,
            "trackEntityUid": _uid(ready),
            "state": "ready",
            "attempts": 0,
        },
        {
            "trackId": running,
            "trackEntityUid": _uid(running),
            "state": "analyzing",
            "attempts": 1,
        },
        {
            "trackId": failed,
            "trackEntityUid": _uid(failed),
            "state": "failed",
            "attempts": 3,
        },
        {
            "trackId": waiting,
            "trackEntityUid": _uid(waiting),
            "state": "pending",
            "attempts": 0,
        },
    ]
    # No separation measured yet: the estimate per track (four minutes, ST2.PR2).
    assert body["estimatedSecondsLeft"] == 2 * ESTIMATED_STEM_SECONDS_PER_TRACK

    # Once tracks were separated, their measured time replaces the estimate.
    other = _tracks("api-status-history", 2)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_jobs
                    (track_id, state, attempts, started_at, finished_at)
                SELECT track_id, 'ready', 1, CAST(:started AS TIMESTAMPTZ),
                       CAST(:started AS TIMESTAMPTZ) + seconds * INTERVAL '1 second'
                FROM unnest(CAST(:tracks AS BIGINT[]), CAST(:seconds AS INTEGER[]))
                    AS item(track_id, seconds)
                """
            ),
            {
                "tracks": other,
                "seconds": [100, 200],
                "started": now - timedelta(hours=1),
            },
        )
    assert test_app.get(_url(playlist_id)).json()["estimatedSecondsLeft"] == 300

    # A playlist that is not a Smart Mix playlist has no work.
    plain = _playlist(ME, [waiting], name="Plain")
    off = test_app.get(_url(plain)).json()
    assert off["enabled"] is False and off["revision"] is None
    assert (off["total"], off["tracks"], off["estimatedSecondsLeft"]) == (0, [], None)

    # Its owner and collaborators read it; others do not.
    assert test_app.get(_url(999_999)).status_code == 404
    _as_user(monkeypatch, _user("api-status-other"))
    assert test_app.get(_url(playlist_id)).status_code == 403


def test_status_reads_stay_bounded(pg_db, test_app) -> None:
    del pg_db
    playlist_id = _playlist(ME, _tracks("api-status-queries", 20))
    assert test_app.put(_url(playlist_id), json={"enabled": True}).status_code == 200

    statements, stop = _count_statements()
    try:
        assert test_app.get(_url(playlist_id)).status_code == 200
        status_statements = list(statements)
        statements.clear()
        assert test_app.get(_url()).status_code == 200
        list_statements = list(statements)
    finally:
        stop()

    assert len(status_statements) <= 2, status_statements
    assert len(list_statements) <= 1, list_statements


def test_list_returns_changes_since_a_revision(pg_db, test_app, monkeypatch) -> None:
    del pg_db
    first = _playlist(ME, _tracks("api-sync-first", 1))
    second = _playlist(ME, _tracks("api-sync-second", 1))
    test_app.put(_url(first), json={"enabled": True})
    test_app.put(_url(second), json={"enabled": True})
    test_app.put(_url(first), json={"enabled": False})

    everything = test_app.get(_url()).json()
    assert everything["revision"] == 3
    assert [(p["playlistId"], p["enabled"]) for p in everything["playlists"]] == [
        (second, True),
        (first, False),
    ]
    changed = test_app.get(_url(), params={"sinceRevision": 2}).json()
    assert changed["revision"] == 3
    assert [p["playlistId"] for p in changed["playlists"]] == [first]
    # Nothing new: the cursor stays where the client is.
    assert test_app.get(_url(), params={"sinceRevision": 3}).json() == {
        "revision": 3,
        "playlists": [],
    }
    assert test_app.get(_url(), params={"sinceRevision": -1}).status_code == 422
    # Each user syncs their own Smart Mix playlists.
    _as_user(monkeypatch, _user("api-sync-other"))
    assert test_app.get(_url()).json() == {"revision": 0, "playlists": []}


def test_playlist_responses_carry_the_smart_mix_summary_without_extra_queries_per_playlist(
    pg_db, test_app
) -> None:
    del pg_db
    analysed, waiting = _tracks("api-summary", 2)
    _profiled(analysed)
    _analysed(analysed)
    smart = _playlist(ME, [analysed, waiting], name="Smart Mix set")
    assert test_app.put(_url(smart), json={"enabled": True}).status_code == 200
    plain = _playlist(ME, [analysed], name="Plain")
    off = {"enabled": False, "ready": 0, "total": 0}

    statements, stop = _count_statements()
    try:
        listed = test_app.get("/api/playlists")
        few = len(statements)
        for n in range(3):
            _playlist(ME, [waiting], name=f"More {n}")
        statements.clear()
        relisted = test_app.get("/api/playlists")
        many = len(statements)
    finally:
        stop()

    assert listed.status_code == relisted.status_code == 200
    by_id = {p["id"]: p for p in listed.json()}
    assert by_id[smart]["smartMix"] == {"enabled": True, "ready": 1, "total": 2}
    assert by_id[plain]["smartMix"] == off
    assert {p["smartMix"]["enabled"] for p in relisted.json()} == {True, False}
    assert many == few

    detail = test_app.get(f"/api/playlists/{smart}").json()
    assert detail["smartMix"] == {"enabled": True, "ready": 1, "total": 2}
    page = test_app.get("/api/me/playlists-page").json()
    page_by_id = {p["id"]: p for p in page["playlists"]}
    assert page_by_id[smart]["smartMix"]["enabled"] is True
    assert page_by_id[plain]["smartMix"] == off


def test_smart_mix_summary_is_only_for_owners_and_collaborators(
    pg_db, test_app, monkeypatch
) -> None:
    del pg_db
    owner = _user("api-summary-owner")
    playlist_id = create_playlist(name="Public", user_id=owner, visibility="public")
    _fill(playlist_id, _tracks("api-summary-public", 1))
    _as_user(monkeypatch, owner)
    assert test_app.put(_url(playlist_id), json={"enabled": True}).status_code == 200
    assert test_app.get(f"/api/playlists/{playlist_id}").json()["smartMix"] == {
        "enabled": True,
        "ready": 0,
        "total": 1,
    }

    _as_user(monkeypatch, _user("api-summary-listener"))
    seen = test_app.get(f"/api/playlists/{playlist_id}").json()
    assert seen["access"] == "public"
    assert seen["smartMix"] is None


def test_adding_tracks_to_an_enabled_playlist_queues_them(pg_db, test_app) -> None:
    del pg_db
    first, added, extra = _tracks("api-add", 3)
    smart = _playlist(ME, [first])
    plain = _playlist(ME, [first], name="Plain")
    assert test_app.put(_url(smart), json={"enabled": True}).status_code == 200

    response = test_app.post(
        f"/api/playlists/{smart}/tracks", json={"tracks": [{"track_id": added}]}
    )
    assert response.status_code == 200, response.text
    assert set(_jobs()) == {first, added}

    # Other playlists queue nothing.
    test_app.post(
        f"/api/playlists/{plain}/tracks", json={"tracks": [{"track_id": extra}]}
    )
    assert set(_jobs()) == {first, added}

    # A Smart Mix playlist does not grow past its limit.
    set_setting(STEM_MAX_TRACKS_PER_PLAYLIST_SETTING, "2")
    refused = test_app.post(
        f"/api/playlists/{smart}/tracks", json={"tracks": [{"track_id": extra}]}
    )
    assert refused.status_code == 409
    assert _tracks_of(smart) == [first, added]


@pytest.mark.parametrize("spec", ["/openapi.json", "/openapi-crate.json"])
def test_openapi_types_the_smart_mix_playlist_routes(test_app, spec: str) -> None:
    schema = test_app.get(spec).json()
    components = schema["components"]["schemas"]
    listing = schema["paths"]["/api/smart-mix/playlists"]["get"]
    item = schema["paths"]["/api/smart-mix/playlists/{playlist_id}"]
    status, toggle = item["get"], item["put"]

    for operation in (listing, status, toggle):
        assert operation["tags"] == ["smart-mix"]
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert listing["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixPlaylistsResponse"
    }
    assert [parameter["name"] for parameter in listing["parameters"]] == [
        "sinceRevision"
    ]
    assert status["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixPlaylistStatusResponse"
    }
    assert toggle["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixPlaylistUpdateRequest"
    }
    assert toggle["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixPlaylistResponse"
    }
    assert {"401", "403", "404", "409", "422"} <= set(toggle["responses"])
    states = components["SmartMixTrackStateResponse"]["properties"]["state"]["enum"]
    assert states == ["pending", "analyzing", "ready", "failed"]
    if spec == "/openapi.json":
        summary = components["PlaylistSummaryResponse"]["properties"]["smartMix"]
        assert summary["anyOf"][0] == {
            "$ref": "#/components/schemas/PlaylistSmartMixResponse"
        }
        assert set(components["PlaylistSmartMixResponse"]["required"]) == {
            "enabled",
            "ready",
            "total",
        }


def test_admins_set_both_limits_in_the_smart_mix_settings(pg_db, test_app) -> None:
    del pg_db
    from crate.api.settings import _get_smart_mix_settings

    defaults = _get_smart_mix_settings()
    assert defaults["stem_max_tracks_per_playlist"] == 300
    assert defaults["stem_max_tracks_per_user"] is None

    assert (
        test_app.put(
            "/api/settings/smart-mix",
            json={"stem_max_tracks_per_playlist": 50, "stem_max_tracks_per_user": 400},
        ).status_code
        == 200
    )
    assert test_app.get("/api/settings").json()["smart_mix"] == {
        **defaults,
        "stem_max_tracks_per_playlist": 50,
        "stem_max_tracks_per_user": 400,
    }
    # Omitting a key keeps it; null turns the per-user limit off.
    test_app.put("/api/settings/smart-mix", json={"stem_uploads_enabled": True})
    assert _get_smart_mix_settings()["stem_max_tracks_per_user"] == 400
    test_app.put("/api/settings/smart-mix", json={"stem_max_tracks_per_user": None})
    assert _get_smart_mix_settings()["stem_max_tracks_per_user"] is None
    assert _get_smart_mix_settings()["stem_max_tracks_per_playlist"] == 50

    for invalid in (
        {"stem_max_tracks_per_playlist": 0},
        {"stem_max_tracks_per_user": 0},
        {"stem_max_tracks_per_playlist": None},
    ):
        assert (
            test_app.put("/api/settings/smart-mix", json=invalid).status_code == 422
        ), invalid


@pytest.mark.parametrize("operation", ["update", "replace"])
def test_opensubsonic_clients_get_an_error_over_a_limit(
    monkeypatch, operation: str
) -> None:
    from crate.db.repositories.smart_mix_playlists import SmartMixPlaylistLimitError
    from crate.subsonic.errors import OpenSubsonicError
    from crate.subsonic.services import playlists

    def over_limit(*_args, **_kwargs):
        raise SmartMixPlaylistLimitError("playlist", max_tracks=300, tracks=301)

    monkeypatch.setattr(playlists, "update_subsonic_playlist", over_limit)
    monkeypatch.setattr(playlists, "replace_subsonic_playlist", over_limit)
    user = {"id": ME, "role": "user"}

    with pytest.raises(OpenSubsonicError) as raised:
        if operation == "update":
            playlists.update_playlist(user, "pl-7")
        else:
            playlists.create_playlist(user, playlist_id="pl-7")

    assert raised.value.code == 0
    assert "300" in raised.value.message
