from __future__ import annotations

from unittest.mock import patch

from sqlalchemy import text

from crate.db.tx import read_scope


def _play_event_payload(**overrides):
    payload = {
        "client_event_id": "evt-remote-001",
        "global_track_uid": "11111111-1111-4111-8111-111111111111",
        "track_path": "remote-track",
        "title": "0151",
        "artist": "High Vis",
        "album": "Blending",
        "started_at": "2026-07-14T10:00:00Z",
        "ended_at": "2026-07-14T10:03:00Z",
        "played_seconds": 180,
        "track_duration_seconds": 180,
        "completion_ratio": 1,
        "was_completed": True,
    }
    payload.update(overrides)
    return payload


def test_remote_scrobbling_preference_api_defaults_off_and_updates(test_app):
    with (
        patch("crate.api.me.get_remote_scrobbling_enabled", side_effect=[False, True]),
        patch(
            "crate.api.me.set_remote_scrobbling_enabled", return_value=True
        ) as update,
    ):
        initial = test_app.get("/api/me/scrobble/preferences")
        changed = test_app.put(
            "/api/me/scrobble/preferences",
            json={"remote_scrobbling_enabled": True},
        )

    assert initial.status_code == 200
    assert initial.json() == {"remote_scrobbling_enabled": False}
    assert changed.status_code == 200
    assert changed.json() == {"remote_scrobbling_enabled": True}
    update.assert_called_once_with(1, True)


def test_play_event_uses_signed_playback_provenance(test_app):
    with (
        patch(
            "crate.api.me.verify_playback_session",
            return_value=type(
                "Claims",
                (),
                {
                    "content_origin": "remote",
                    "source_node_uid": "22222222-2222-4222-8222-222222222222",
                },
            )(),
        ) as verify,
        patch("crate.api.me.record_play_event", return_value=91) as record,
    ):
        response = test_app.post(
            "/api/me/play-events",
            json=_play_event_payload(playback_session="signed-session"),
        )

    assert response.status_code == 200
    verify.assert_called_once_with(
        "signed-session",
        user_id=1,
        global_track_uid="11111111-1111-4111-8111-111111111111",
    )
    assert record.call_args.kwargs["content_origin"] == "remote"
    assert (
        record.call_args.kwargs["source_node_uid"]
        == "22222222-2222-4222-8222-222222222222"
    )


def test_remote_play_scrobble_is_opt_in_and_dispatch_is_idempotent(pg_db):
    from crate.db.repositories.user_library import record_play_event
    from crate.scrobble import dispatch_scrobble_play_event

    event_id = record_play_event(
        1,
        client_event_id="evt-remote-dispatch",
        global_track_uid=None,
        title="0151",
        artist="High Vis",
        album="Blending",
        started_at="2026-07-14T10:00:00+00:00",
        ended_at="2026-07-14T10:03:00+00:00",
        played_seconds=180,
        was_completed=True,
        content_origin="remote",
        source_node_uid="22222222-2222-4222-8222-222222222222",
    )

    with patch("crate.scrobble.scrobble_play_event") as scrobble:
        assert dispatch_scrobble_play_event(event_id) == "skipped"
        scrobble.assert_not_called()

    with read_scope() as session:
        status = session.execute(
            text("SELECT status FROM user_scrobble_dispatches WHERE event_id = :id"),
            {"id": event_id},
        ).scalar_one()
    assert status == "skipped"


def test_opted_in_remote_play_scrobbles_only_once(pg_db):
    from crate.db.repositories.user_library import record_play_event
    from crate.db.repositories.users import set_remote_scrobbling_enabled
    from crate.scrobble import dispatch_scrobble_play_event

    set_remote_scrobbling_enabled(1, True)
    event_id = record_play_event(
        1,
        client_event_id="evt-remote-enabled",
        title="0151",
        artist="High Vis",
        album="Blending",
        started_at="2026-07-14T10:00:00+00:00",
        ended_at="2026-07-14T10:03:00+00:00",
        played_seconds=180,
        was_completed=True,
        content_origin="remote",
        source_node_uid="22222222-2222-4222-8222-222222222222",
    )

    with patch("crate.scrobble.scrobble_play_event") as scrobble:
        assert dispatch_scrobble_play_event(event_id) == "completed"
        assert dispatch_scrobble_play_event(event_id) == "completed"

    scrobble.assert_called_once_with(
        1,
        artist="High Vis",
        track="0151",
        album="Blending",
        timestamp=1784023200,
    )
