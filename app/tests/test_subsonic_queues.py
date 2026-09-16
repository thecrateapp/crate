from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

import pytest


USER = {
    "id": 23,
    "email": "listener@example.test",
    "username": "listener",
    "role": "user",
}

TRACK_1 = {
    "id": 1,
    "title": "First",
    "artist": "Artist",
    "album": "Album",
    "album_id": 7,
    "artist_id": 9,
    "duration": 180,
    "format": "flac",
    "has_cover": 1,
}
TRACK_2 = {**TRACK_1, "id": 2, "title": "Second", "duration": 240}


@contextmanager
def _auth_ok():
    with patch("crate.subsonic.auth.authenticate", return_value=USER):
        yield


def test_save_play_queue_by_index_preserves_order_duplicates_and_bounded_position():
    from crate.subsonic.params import RequestParameters
    from crate.subsonic.services import queues

    params = RequestParameters(
        {
            "id": ("1", "2", "1"),
            "currentIndex": ("2",),
            "position": ("999999",),
            "c": ("Feishin",),
        }
    )
    with (
        patch.object(
            queues,
            "_track_for_subsonic_id",
            side_effect=[(None, TRACK_1), (None, TRACK_2)],
        ),
        patch.object(queues, "upsert_device") as upsert_device,
        patch.object(queues, "upsert_playback_state") as upsert_state,
    ):
        queues.save_play_queue(params, USER, by_index=True)

    upsert_device.assert_called_once_with(
        23,
        device_id=queues.QUEUE_DEVICE_ID,
        device_label="Feishin",
        device_type="subsonic",
        app_platform="Feishin",
        touch_presence=False,
    )
    saved = upsert_state.call_args.kwargs
    assert [item["subsonic_id"] for item in saved["queue"]] == ["1", "2", "1"]
    assert saved["current_index"] == 2
    assert saved["position_ms"] == 180_000
    assert saved["app_platform"] == "Feishin"


def test_save_play_queue_by_id_resolves_current_track():
    from crate.subsonic.params import RequestParameters
    from crate.subsonic.services import queues

    params = RequestParameters(
        {
            "id": ("1", "2"),
            "current": ("2",),
            "position": ("1200",),
            "c": ("Test client",),
        }
    )
    with (
        patch.object(
            queues,
            "_track_for_subsonic_id",
            side_effect=[(None, TRACK_1), (None, TRACK_2)],
        ),
        patch.object(queues, "upsert_device"),
        patch.object(queues, "upsert_playback_state") as upsert_state,
    ):
        queues.save_play_queue(params, USER, by_index=False)

    assert upsert_state.call_args.kwargs["current_index"] == 1
    assert upsert_state.call_args.kwargs["position_ms"] == 1200


def test_save_empty_play_queue_clears_only_the_authenticated_users_queue():
    from crate.subsonic.params import RequestParameters
    from crate.subsonic.services import queues

    with patch.object(queues, "clear_playback_state") as clear_state:
        queues.save_play_queue(RequestParameters({}), USER, by_index=False)

    clear_state.assert_called_once_with(23, device_id=queues.QUEUE_DEVICE_ID)


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"id": ("1",)}, "current"),
        ({"id": ("1",), "currentIndex": ("1",)}, "currentIndex"),
        ({"id": ("1",), "currentIndex": ("0",), "position": ("-1",)}, "position"),
        ({"id": ("1",), "currentIndex": ("0",), "position": ("invalid",)}, "position"),
    ],
)
def test_save_play_queue_rejects_invalid_current_or_position(values, message):
    from crate.subsonic.errors import OpenSubsonicError
    from crate.subsonic.params import RequestParameters
    from crate.subsonic.services import queues

    params = RequestParameters(values)
    with (
        patch.object(
            queues, "_track_for_subsonic_id", return_value=(None, TRACK_1)
        ) as resolve_track,
        patch.object(queues, "upsert_device") as upsert_device,
        pytest.raises(OpenSubsonicError, match=message),
    ):
        queues.save_play_queue(params, USER, by_index=True)

    upsert_device.assert_not_called()
    resolve_track.assert_not_called()


def test_save_play_queue_rejects_unavailable_tracks_and_oversized_queues():
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError
    from crate.subsonic.params import RequestParameters
    from crate.subsonic.services import queues

    with (
        patch.object(queues, "_track_for_subsonic_id", return_value=None),
        patch.object(queues, "upsert_device") as upsert_device,
        pytest.raises(OpenSubsonicError) as unknown_track,
    ):
        queues.save_play_queue(
            RequestParameters({"id": ("999",), "currentIndex": ("0",)}),
            USER,
            by_index=True,
        )
    assert unknown_track.value.code == ErrorCode.NOT_FOUND
    upsert_device.assert_not_called()

    too_many = tuple(str(index + 1) for index in range(queues.MAX_QUEUE_TRACKS + 1))
    with (
        patch.object(queues, "_track_for_subsonic_id") as resolve_track,
        pytest.raises(OpenSubsonicError),
    ):
        queues.save_play_queue(
            RequestParameters({"id": too_many, "currentIndex": ("0",)}),
            USER,
            by_index=True,
        )
    resolve_track.assert_not_called()


def test_get_play_queue_round_trips_order_index_position_and_timestamp():
    from crate.subsonic.global_ids import decode_subsonic_id
    from crate.subsonic.services import queues

    changed = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)
    state = {
        "queue": [
            {"subsonic_id": "1"},
            {"subsonic_id": "2"},
            {"subsonic_id": "1"},
        ],
        "current_index": 2,
        "position_ms": 9000,
        "updated_at": changed,
        "app_platform": "Feishin",
    }
    resolved = {
        "1": (decode_subsonic_id("1", expected_kind="track"), TRACK_1),
        "2": (decode_subsonic_id("2", expected_kind="track"), TRACK_2),
    }
    with (
        patch.object(queues, "get_device_playback_state", return_value=state),
        patch.object(
            queues, "_track_for_subsonic_id", side_effect=lambda item: resolved[item]
        ),
    ):
        queue_by_index = queues.get_play_queue(USER, by_index=True)
        queue_by_id = queues.get_play_queue(USER, by_index=False)

    assert queue_by_index["currentIndex"] == 2
    assert queue_by_index["position"] == 9000
    assert [entry["id"] for entry in queue_by_index["entry"]] == ["1", "2", "1"]
    assert queue_by_index["changed"] == changed.isoformat()
    assert queue_by_index["changedBy"] == "Feishin"
    assert queue_by_id["current"] == "1"


def test_get_play_queue_drops_tracks_that_are_no_longer_available():
    from crate.subsonic.services import queues

    state = {
        "queue": [{"subsonic_id": "1"}, {"subsonic_id": "999"}],
        "current_index": 1,
        "position_ms": 30,
        "updated_at": datetime(2026, 9, 17, tzinfo=timezone.utc),
        "app_platform": "Feishin",
    }
    with (
        patch.object(queues, "get_device_playback_state", return_value=state),
        patch.object(
            queues,
            "_track_for_subsonic_id",
            side_effect=[(None, TRACK_1), None],
        ),
    ):
        queue = queues.get_play_queue(USER, by_index=True)

    assert [entry["id"] for entry in queue["entry"]] == ["1"]
    assert queue["currentIndex"] == 0
    assert queue["position"] == 0


def test_queue_endpoints_are_user_scoped_and_advertise_index_extension(test_app):
    from crate.subsonic.capabilities import advertised_extensions

    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.queues.get_play_queue",
            return_value={"username": "listener", "entry": []},
        ) as get_queue,
    ):
        response = test_app.get("/rest/getPlayQueue?u=listener&p=secret")

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["playQueue"]["username"] == "listener"
    get_queue.assert_called_once_with(USER, by_index=False)
    assert {"name": "indexBasedQueue", "versions": [1]} in advertised_extensions()


def test_save_play_queue_endpoint_reports_protocol_errors_and_auth(test_app):
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError

    with (
        _auth_ok(),
        patch(
            "crate.subsonic.services.queues.save_play_queue",
            side_effect=OpenSubsonicError(ErrorCode.NOT_FOUND, "Unknown track"),
        ),
    ):
        response = test_app.get(
            "/rest/savePlayQueueByIndex?u=listener&p=secret&id=999&currentIndex=0"
        )

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["error"]["code"] == ErrorCode.NOT_FOUND

    with patch(
        "crate.subsonic.auth.authenticate",
        side_effect=OpenSubsonicError(ErrorCode.INVALID_CREDENTIALS, "invalid"),
    ):
        denied = test_app.get("/rest/getPlayQueue?u=bad&p=bad")
    assert denied.status_code == 200
    assert (
        denied.json()["subsonic-response"]["error"]["code"]
        == ErrorCode.INVALID_CREDENTIALS
    )


def test_save_play_queue_endpoint_returns_empty_success_response(test_app):
    with (
        _auth_ok(),
        patch("crate.subsonic.services.queues.save_play_queue") as save_queue,
    ):
        response = test_app.get(
            "/rest/savePlayQueueByIndex?u=listener&p=secret&id=1&currentIndex=0"
        )

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "ok"
    assert save_queue.call_args.args[1] == USER
    assert save_queue.call_args.kwargs["by_index"] is True
