"""Now playing and play events reported by Crate Decks (server S6).

Decks reports each played track with `device_type="decks"` and
`play_source_type="decks"`, and its now-playing heartbeat can name the deck
(1-4) and the mix session. Calls from a Decks session that leave those labels
out are still attributed to Decks; every other client keeps today's contract.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from crate.db.repositories.auth_shared import promote_now_playing_session

_DECKS_HEADERS = {"X-Crate-App": "decks/0.3.0"}


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


def _play_event(**overrides):
    payload = {
        "client_event_id": "decks-evt-1",
        "track_id": 12,
        "title": "Windowlicker",
        "artist": "Aphex Twin",
        "album": "Windowlicker",
        "started_at": "2026-11-16T22:00:00Z",
        "ended_at": "2026-11-16T22:04:10Z",
        "played_seconds": 250,
    }
    payload.update(overrides)
    return payload


def _now_playing(**overrides):
    payload = {"track_id": 12, "title": "Windowlicker", "artist": "Aphex Twin"}
    payload.update(overrides)
    return payload


def _post_now_playing(test_app, payload, headers=None):
    with (
        patch("crate.api.me.resolve_track_reference_read", return_value=None),
        patch("crate.api.me.set_cache") as mock_set_cache,
    ):
        resp = test_app.post("/api/me/now-playing", json=payload, headers=headers)
    return resp, mock_set_cache


def _session_user(session_id: str):
    async def _resolve(self, request):
        return {
            "id": 1,
            "email": "test@test.com",
            "role": "admin",
            "username": "testadmin",
            "name": "Test Admin",
            "session_id": session_id,
        }

    return _resolve


# ── Play events ──────────────────────────────────────────────


def test_play_event_accepts_decks_device(test_app):
    payload = _play_event(
        device_type="decks", play_source_type="decks", app_platform="decks"
    )

    with patch("crate.api.me.record_play_event", return_value=91) as mock_record:
        resp = test_app.post("/api/me/play-events", json=payload)

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "id": 91}
    kwargs = mock_record.call_args.kwargs
    assert kwargs["device_type"] == "decks"
    assert kwargs["play_source_type"] == "decks"
    assert kwargs["app_platform"] == "decks"
    assert kwargs["client_event_id"] == "decks-evt-1"


def test_play_event_from_decks_header_defaults_missing_labels(test_app):
    with patch("crate.api.me.record_play_event", return_value=92) as mock_record:
        resp = test_app.post(
            "/api/me/play-events", json=_play_event(), headers=_DECKS_HEADERS
        )

    assert resp.status_code == 200
    kwargs = mock_record.call_args.kwargs
    assert kwargs["device_type"] == "decks"
    assert kwargs["play_source_type"] == "decks"
    assert kwargs["app_platform"] == "decks"


def test_play_event_from_decks_keeps_explicit_labels(test_app):
    payload = _play_event(
        play_source_type="playlist",
        play_source_id="15",
        app_platform="decks-macos",
    )

    with patch("crate.api.me.record_play_event", return_value=93) as mock_record:
        resp = test_app.post(
            "/api/me/play-events", json=payload, headers=_DECKS_HEADERS
        )

    assert resp.status_code == 200
    kwargs = mock_record.call_args.kwargs
    assert kwargs["play_source_type"] == "playlist"
    assert kwargs["context_playlist_id"] == 15
    assert kwargs["app_platform"] == "decks-macos"
    assert kwargs["device_type"] == "decks"


def test_play_event_from_decks_session_without_header_is_attributed(
    test_app, monkeypatch
):
    monkeypatch.setattr(
        "crate.api.auth.AuthMiddleware.resolve_user", _session_user("decks-session")
    )
    sessions = {"decks-session": {"id": "decks-session", "app_id": "crate-decks"}}

    with (
        patch(
            "crate.api.auth_cache.get_cached_session",
            side_effect=lambda session_id: sessions.get(session_id),
        ),
        patch("crate.api.me.record_play_event", return_value=94) as mock_record,
    ):
        resp = test_app.post("/api/me/play-events", json=_play_event())

    assert resp.status_code == 200
    assert mock_record.call_args.kwargs["device_type"] == "decks"
    assert mock_record.call_args.kwargs["play_source_type"] == "decks"


def test_play_event_from_listen_session_is_not_relabelled(test_app, monkeypatch):
    monkeypatch.setattr(
        "crate.api.auth.AuthMiddleware.resolve_user", _session_user("listen-session")
    )

    with (
        patch(
            "crate.api.auth_cache.get_cached_session",
            return_value={"id": "listen-session", "app_id": "listen-web"},
        ),
        patch("crate.api.me.record_play_event", return_value=95) as mock_record,
    ):
        resp = test_app.post("/api/me/play-events", json=_play_event())

    assert resp.status_code == 200
    kwargs = mock_record.call_args.kwargs
    assert kwargs["device_type"] is None
    assert kwargs["play_source_type"] is None
    assert kwargs["app_platform"] is None


# ── Now playing ──────────────────────────────────────────────


def test_now_playing_accepts_deck_fields(test_app):
    resp, mock_set_cache = _post_now_playing(
        test_app,
        _now_playing(
            deck=3,
            mix_session_id="mix-2026-11-16-a",
            device_type="decks",
            app_platform="decks",
        ),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    key, payload = mock_set_cache.call_args.args
    assert key == "now_playing:1"
    assert payload["deck"] == 3
    assert payload["mix_session_id"] == "mix-2026-11-16-a"
    assert payload["device_type"] == "decks"
    assert payload["app_platform"] == "decks"
    assert mock_set_cache.call_args.kwargs == {"ttl": 90}


@pytest.mark.parametrize("deck", [0, 5, -1, "2", 2.5, True])
def test_now_playing_rejects_invalid_deck(test_app, deck):
    resp, mock_set_cache = _post_now_playing(test_app, _now_playing(deck=deck))

    assert resp.status_code == 422
    mock_set_cache.assert_not_called()


def test_now_playing_rejects_overlong_mix_session_id(test_app):
    resp, mock_set_cache = _post_now_playing(
        test_app, _now_playing(mix_session_id="m" * 129)
    )

    assert resp.status_code == 422
    mock_set_cache.assert_not_called()


def test_now_playing_drops_blank_mix_session_id(test_app):
    resp, mock_set_cache = _post_now_playing(
        test_app, _now_playing(deck=1, mix_session_id="   ")
    )

    assert resp.status_code == 200
    payload = mock_set_cache.call_args.args[1]
    assert payload["deck"] == 1
    assert "mix_session_id" not in payload


def test_now_playing_from_decks_header_defaults_labels(test_app):
    resp, mock_set_cache = _post_now_playing(
        test_app, _now_playing(deck=2), headers=_DECKS_HEADERS
    )

    assert resp.status_code == 200
    payload = mock_set_cache.call_args.args[1]
    assert payload["device_type"] == "decks"
    assert payload["app_platform"] == "decks"
    assert payload["deck"] == 2


def test_now_playing_stop_from_decks_clears_state(test_app):
    with (
        patch("crate.api.me.delete_cache") as mock_delete,
        patch("crate.api.me.set_cache") as mock_set_cache,
    ):
        resp = test_app.post(
            "/api/me/now-playing",
            json={"playing": False, "deck": 4},
            headers=_DECKS_HEADERS,
        )

    assert resp.status_code == 200
    mock_delete.assert_called_once_with("now_playing:1")
    mock_set_cache.assert_not_called()


# ── Existing clients ─────────────────────────────────────────


def test_existing_clients_unchanged(test_app):
    resp, mock_set_cache = _post_now_playing(
        test_app,
        _now_playing(device_type="web", app_platform="listen-web"),
    )

    assert resp.status_code == 200
    payload = mock_set_cache.call_args.args[1]
    assert set(payload) == {
        "track_id",
        "track_entity_uid",
        "track_path",
        "title",
        "artist",
        "album",
        "started_at",
        "heartbeat_at",
        "device_type",
        "app_platform",
    }
    assert payload["device_type"] == "web"
    assert payload["app_platform"] == "listen-web"

    event = _play_event(
        play_source_type="album",
        play_source_id="44",
        device_type="web",
        app_platform="listen-web",
    )
    with patch("crate.api.me.record_play_event", return_value=96) as mock_record:
        resp = test_app.post(
            "/api/me/play-events",
            json=event,
            headers={"X-Crate-App": "listen-web"},
        )

    assert resp.status_code == 200
    kwargs = mock_record.call_args.kwargs
    assert kwargs["device_type"] == "web"
    assert kwargs["play_source_type"] == "album"
    assert kwargs["app_platform"] == "listen-web"


def test_play_event_ignores_transition_source(test_app):
    """`transition_source` was dropped with AI refinement; it is not stored."""
    with patch("crate.api.me.record_play_event", return_value=97) as mock_record:
        resp = test_app.post(
            "/api/me/play-events",
            json=_play_event(device_type="decks", transition_source="ai"),
        )

    assert resp.status_code == 200
    assert "transition_source" not in mock_record.call_args.kwargs


# ── Session presence ─────────────────────────────────────────


def _session(session_id: str, app_id: str, seen_minutes_ago: int, now: datetime):
    return {
        "id": session_id,
        "app_id": app_id,
        "revoked_at": None,
        "expires_at": now + timedelta(days=7),
        "last_seen_at": now - timedelta(minutes=seen_minutes_ago),
        "activity_state": "recent",
        "is_active": False,
        "is_recent": True,
    }


def test_decks_now_playing_promotes_the_decks_session():
    now = datetime.now(timezone.utc)
    sessions = [
        _session("listen", "listen-web", 5, now),
        _session("decks", "crate-decks", 10, now),
    ]

    promoted = promote_now_playing_session(
        sessions,
        now_playing={"device_type": "decks", "app_platform": "decks"},
        now=now,
    )

    by_id = {session["id"]: session for session in promoted}
    assert by_id["decks"]["is_active"] is True
    assert by_id["decks"]["activity_state"] == "active"
    assert by_id["listen"]["is_active"] is False


def test_listen_now_playing_does_not_promote_a_decks_session():
    now = datetime.now(timezone.utc)
    sessions = [_session("decks", "crate-decks", 10, now)]

    promoted = promote_now_playing_session(
        sessions, now_playing={"app_platform": "listen-web"}, now=now
    )

    assert promoted[0]["is_active"] is False
