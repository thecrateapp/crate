from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

USER = {
    "id": 1,
    "email": "listener@example.test",
    "username": "listener",
    "role": "user",
}

TRACK = {
    "id": 1,
    "title": "Song One",
    "artist": "Artist",
    "album": "Album",
    "duration": 180,
    "format": "flac",
}


@contextmanager
def _auth_ok():
    with patch("crate.subsonic.auth.authenticate", return_value=USER):
        yield


@contextmanager
def _auth_fail():
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError

    with patch(
        "crate.subsonic.auth.authenticate",
        side_effect=OpenSubsonicError(ErrorCode.INVALID_CREDENTIALS, "invalid"),
    ):
        yield


def _ok(response):
    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "ok"


def test_scrobble_accepts_repeated_ids_and_times_and_is_retry_safe(test_app):
    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.playback.get_track_full",
            side_effect=[
                TRACK,
                {**TRACK, "id": 2, "title": "Song Two"},
                TRACK,
                {**TRACK, "id": 2, "title": "Song Two"},
            ],
        ),
        patch(
            "crate.playback_provenance.resolve_local_content_provenance",
            return_value=("local", None),
        ),
        patch("crate.subsonic.services.playback.record_play_event") as record,
    ):
        url = (
            "/rest/scrobble?u=listener&p=secret&id=1&id=2&submission=true"
            "&time=1784023200000&time=1784023260000"
        )
        first = test_app.get(url)
        second = test_app.get(url)

    _ok(first)
    _ok(second)
    assert record.call_count == 4
    first_ids = [call.kwargs["client_event_id"] for call in record.call_args_list[:2]]
    retry_ids = [call.kwargs["client_event_id"] for call in record.call_args_list[2:]]
    assert first_ids == retry_ids
    assert record.call_args_list[0].kwargs["ended_at"] == "2026-07-14T10:00:00+00:00"
    assert record.call_args_list[1].kwargs["ended_at"] == "2026-07-14T10:01:00+00:00"
    assert record.call_args_list[0].kwargs["play_source_type"] == "subsonic"
    assert record.call_args_list[0].kwargs["app_platform"] == "subsonic"


def test_scrobble_skips_malformed_items_but_records_valid_entries(test_app):
    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.playback.get_track_full",
            return_value=TRACK,
        ) as get_track,
        patch(
            "crate.playback_provenance.resolve_local_content_provenance",
            return_value=("local", None),
        ),
        patch("crate.subsonic.services.playback.record_play_event") as record,
    ):
        response = test_app.get(
            "/rest/scrobble?u=listener&p=secret&id=bad&id=1&id=2&submission=true"
            "&time=not-a-timestamp&time=1784023200000&time=not-a-timestamp"
        )

    _ok(response)
    get_track.assert_called_once_with(1)
    record.assert_called_once()
    assert record.call_args.kwargs["track_id"] == 1


def test_scrobble_form_post_authenticates_and_reads_repeated_body_fields(test_app):
    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.playback.get_track_full",
            side_effect=[TRACK, {**TRACK, "id": 2}],
        ),
        patch(
            "crate.playback_provenance.resolve_local_content_provenance",
            return_value=("local", None),
        ),
        patch("crate.subsonic.services.playback.record_play_event") as record,
    ):
        response = test_app.post(
            "/rest/scrobble",
            content=(
                "u=listener&p=secret&id=1&id=2&submission=true"
                "&time=1784023200000&time=1784023260000"
            ),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    _ok(response)
    assert record.call_count == 2


def test_scrobble_now_playing_updates_shared_ephemeral_state(test_app):
    with (
        _auth_ok(),
        patch("crate.subsonic.services.playback.get_track_full", return_value=TRACK),
        patch("crate.subsonic.services.playback.set_cache") as set_cache,
        patch("crate.subsonic.services.playback.record_play_event") as record,
    ):
        response = test_app.get(
            "/rest/scrobble?u=listener&p=secret&id=1&submission=false"
        )

    _ok(response)
    record.assert_not_called()
    key, payload = set_cache.call_args.args
    assert key == "now_playing:1"
    assert payload["title"] == "Song One"
    assert payload["device_type"] == "subsonic"
    assert set_cache.call_args.kwargs["ttl"] >= 180


def test_get_now_playing_returns_active_entries(test_app):
    expected = [
        {
            "id": "1",
            "title": "Song One",
            "isDir": False,
            "username": "listener",
            "minutesAgo": 0,
            "playerId": 1,
            "state": "playing",
        }
    ]
    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.playback.get_now_playing_entries",
            return_value=expected,
        ),
    ):
        response = test_app.get("/rest/getNowPlaying?u=listener&p=secret")

    _ok(response)
    assert response.json()["subsonic-response"]["nowPlaying"]["entry"] == expected


def test_now_playing_projection_combines_shared_presence_and_catalog_metadata():
    from crate.subsonic.global_ids import decode_subsonic_id
    from crate.subsonic.services import playback

    now = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
    payload = {
        "track_id": 1,
        "title": "Song One",
        "started_at": "2026-09-17T11:59:00+00:00",
        "heartbeat_at": "2026-09-17T11:59:30+00:00",
        "expires_at": "2026-09-17T12:05:00+00:00",
        "app_platform": "Open Subsonic",
    }
    entity_id = decode_subsonic_id("1", expected_kind="track")
    with (
        patch.object(playback, "_read_active_now_playing", return_value=[(1, payload)]),
        patch.object(playback, "_get_usernames", return_value={1: "listener"}),
        patch.object(
            playback, "_track_for_subsonic_id", return_value=(entity_id, TRACK)
        ) as track_lookup,
    ):
        entries = playback.get_now_playing_entries(now=now)

    assert len(entries) == 1
    assert entries[0]["username"] == "listener"
    assert entries[0]["title"] == "Song One"
    assert entries[0]["minutesAgo"] == 0
    assert entries[0]["playerId"] == 1
    assert entries[0]["state"] == "playing"
    track_lookup.assert_called_once_with("1")


def test_expired_now_playing_state_is_filtered():
    from crate.subsonic.services import playback

    now = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
    payload = {
        "expires_at": "2026-09-17T11:59:59+00:00",
        "subsonic_id": "1",
    }
    with (
        patch.object(playback, "_read_active_now_playing", return_value=[(1, payload)]),
        patch.object(playback, "_get_usernames") as usernames,
    ):
        entries = playback.get_now_playing_entries(now=now)

    assert entries == []
    usernames.assert_not_called()


def test_active_now_playing_reader_scans_shared_redis_presence_keys():
    import json

    from crate.subsonic.services import playback

    payload = {"track_id": 1, "title": "Song One"}
    redis_client = MagicMock()
    redis_client.scan_iter.return_value = ["cache:now_playing:1"]
    redis_client.mget.return_value = [json.dumps(payload)]
    with patch.object(playback, "get_redis", return_value=redis_client):
        active = playback._read_active_now_playing()

    assert active == [(1, payload)]
    redis_client.scan_iter.assert_called_once_with(
        match="cache:now_playing:*", count=100
    )


def test_get_now_playing_supports_form_post_and_auth_errors(test_app):
    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.playback.get_now_playing_entries", return_value=[]
        ),
    ):
        response = test_app.post(
            "/rest/getNowPlaying", data={"u": "listener", "p": "secret"}
        )
    _ok(response)
    assert response.json()["subsonic-response"]["nowPlaying"]["entry"] == []

    with _auth_fail():
        denied = test_app.post("/rest/getNowPlaying", data={"u": "bad", "p": "bad"})
    assert denied.status_code == 200
    assert denied.json()["subsonic-response"]["error"]["code"] == 40


def test_unknown_track_scrobble_is_accepted_without_recording(test_app):
    with (
        _auth_ok(),
        patch("crate.subsonic.services.playback.get_track_full", return_value=None),
        patch("crate.subsonic.services.playback.record_play_event") as record,
    ):
        response = test_app.get(
            "/rest/scrobble?u=listener&p=secret&id=999&submission=true"
        )

    _ok(response)
    record.assert_not_called()
