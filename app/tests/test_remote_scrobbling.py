from __future__ import annotations

from unittest.mock import patch

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.scrobble import ScrobbleResult


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

    with patch(
        "crate.scrobble.scrobble_play_event",
        return_value={"lastfm": ScrobbleResult("accepted")},
    ) as scrobble:
        assert dispatch_scrobble_play_event(event_id) == "completed"
        assert dispatch_scrobble_play_event(event_id) == "completed"

    scrobble.assert_called_once_with(
        1,
        artist="High Vis",
        track="0151",
        album="Blending",
        timestamp=1784023200,
        done=frozenset(),
    )


def _local_event(client_event_id: str = "evt-local-dispatch") -> int:
    from crate.db.repositories.user_library import record_play_event

    return record_play_event(
        1,
        client_event_id=client_event_id,
        title="Vals de los Ciegos",
        artist="Viva Belgrado",
        album="Bellavista",
        started_at="2026-10-24T10:00:00+00:00",
        ended_at="2026-10-24T10:04:00+00:00",
        played_seconds=240,
        track_duration_seconds=240,
    )


def _dispatch_row(event_id: int) -> dict:
    with read_scope() as session:
        return dict(
            session.execute(
                text(
                    "SELECT status, attempts, last_error, provider_results "
                    "FROM user_scrobble_dispatches WHERE event_id = :id"
                ),
                {"id": event_id},
            )
            .mappings()
            .one()
        )


def test_a_rejected_scrobble_is_not_reported_as_completed(pg_db):
    from crate.scrobble import dispatch_scrobble_play_event

    event_id = _local_event()
    with patch(
        "crate.scrobble.scrobble_play_event",
        return_value={"lastfm": ScrobbleResult("failed", "lastfm error 9")},
    ):
        assert dispatch_scrobble_play_event(event_id) == "failed"

    row = _dispatch_row(event_id)
    assert row["status"] == "failed"
    assert row["last_error"] == "lastfm: failed (lastfm error 9)"
    assert row["provider_results"]["lastfm"]["outcome"] == "failed"


def test_an_ignored_scrobble_is_skipped_and_never_resent(pg_db):
    from crate.scrobble import dispatch_scrobble_play_event

    event_id = _local_event()
    with patch(
        "crate.scrobble.scrobble_play_event",
        return_value={"lastfm": ScrobbleResult("ignored", "lastfm ignored 3")},
    ) as scrobble:
        assert dispatch_scrobble_play_event(event_id) == "skipped"
        assert dispatch_scrobble_play_event(event_id) == "skipped"

    scrobble.assert_called_once()
    assert _dispatch_row(event_id)["status"] == "skipped"


def test_a_retry_only_resends_providers_without_a_final_answer(pg_db):
    import pytest

    from crate.scrobble import ScrobbleRetryError, dispatch_scrobble_play_event

    event_id = _local_event()
    with patch(
        "crate.scrobble.scrobble_play_event",
        side_effect=[
            {
                "lastfm": ScrobbleResult("accepted"),
                "listenbrainz": ScrobbleResult("retryable", "http 503"),
            },
            {"listenbrainz": ScrobbleResult("accepted")},
        ],
    ) as scrobble:
        with pytest.raises(ScrobbleRetryError):
            dispatch_scrobble_play_event(event_id)
        assert _dispatch_row(event_id)["status"] == "failed"

        assert dispatch_scrobble_play_event(event_id) == "completed"

    assert scrobble.call_args_list[1].kwargs["done"] == frozenset({"lastfm"})
    row = _dispatch_row(event_id)
    assert row["status"] == "completed"
    assert row["attempts"] == 2
    assert {
        provider: result["outcome"]
        for provider, result in row["provider_results"].items()
    } == {"lastfm": "accepted", "listenbrainz": "accepted"}


def test_a_user_without_linked_providers_is_skipped(pg_db):
    from crate.scrobble import dispatch_scrobble_play_event

    event_id = _local_event()
    with patch("crate.scrobble.scrobble_play_event", return_value={}):
        assert dispatch_scrobble_play_event(event_id) == "skipped"


def test_an_invalid_lastfm_session_asks_the_user_to_reconnect(pg_db, monkeypatch):
    from crate.db.repositories.auth_identities import (
        get_user_external_identity,
        upsert_user_external_identity,
    )
    from crate.scrobble import scrobble_play_event

    upsert_user_external_identity(
        1,
        "lastfm",
        external_user_id="crate-test",
        external_username="crate-test",
        status="linked",
        metadata={"session_key": "stored-session"},
    )
    monkeypatch.setenv("LASTFM_APIKEY", "api-key")
    monkeypatch.setenv("LASTFM_API_SECRET", "api-secret")
    monkeypatch.setattr(
        "crate.scrobble.lastfm_scrobble",
        lambda **_kwargs: ScrobbleResult("failed", "lastfm error 9"),
    )

    results = scrobble_play_event(1, artist="Repion", track="Mar de fondo")

    assert results["lastfm"].outcome == "failed"
    identity = get_user_external_identity(1, "lastfm")
    assert identity["status"] == "error"
    assert "reconnect" in identity["last_error"]


def test_an_unfinished_play_long_enough_for_lastfm_queues_a_scrobble(pg_db):
    from crate.db.repositories.user_library import record_play_event

    with (
        patch("crate.actors.scrobble_play_event_actor.send") as send,
        patch(
            "crate.db.repositories.user_library_playback_writes._schedule_stats_refresh"
        ),
    ):
        eligible = record_play_event(
            1,
            client_event_id="evt-android-half",
            title="Mar de fondo",
            artist="Repion",
            started_at="2026-10-25T16:40:00+00:00",
            ended_at="2026-10-25T16:42:00+00:00",
            played_seconds=120,
            track_duration_seconds=200,
            completion_ratio=0.6,
            was_skipped=True,
        )
        record_play_event(
            1,
            client_event_id="evt-android-short",
            title="Mar de fondo",
            artist="Repion",
            started_at="2026-10-25T16:45:00+00:00",
            ended_at="2026-10-25T16:45:20+00:00",
            played_seconds=20,
            track_duration_seconds=200,
            completion_ratio=0.1,
            was_skipped=True,
        )

    send.assert_called_once_with(eligible)
