"""Contracts for rich user play-event tracking."""

import pytest
from unittest.mock import patch


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


class TestPlayEventContract:
    def test_play_event_endpoint_persists_event_payload(self, test_app):
        payload = {
            "client_event_id": "evt_abc123",
            "track_id": 12,
            "track_path": "Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "started_at": "2026-04-01T10:00:00Z",
            "ended_at": "2026-04-01T10:01:34Z",
            "played_seconds": 73.2,
            "track_duration_seconds": 94.0,
            "completion_ratio": 0.779,
            "was_skipped": True,
            "was_completed": False,
            "play_source_type": "album",
            "play_source_id": "44",
            "play_source_name": "Jane Doe",
            "context_artist": "Converge",
            "context_album": "Jane Doe",
            "context_playlist_id": None,
            "device_type": "web",
            "app_platform": "listen-web",
        }

        with patch("crate.api.me.record_play_event", return_value=77) as mock_record:
            resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "id": 77}
        mock_record.assert_called_once_with(
            1,
            client_event_id="evt_abc123",
            track_id=12,
            global_track_uid=None,
            track_entity_uid=None,
            track_path="Converge/Jane Doe/01 - Concubine.flac",
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at="2026-04-01T10:00:00+00:00",
            ended_at="2026-04-01T10:01:34+00:00",
            played_seconds=73.2,
            track_duration_seconds=94.0,
            completion_ratio=0.779,
            was_skipped=True,
            was_completed=False,
            play_source_type="album",
            play_source_id="44",
            play_source_name="Jane Doe",
            context_artist="Converge",
            context_album="Jane Doe",
            context_playlist_id=None,
            device_type="web",
            app_platform="listen-web",
            content_origin="local",
            source_node_uid=None,
        )

    def test_play_event_endpoint_derives_playlist_context_from_source_id(
        self, test_app
    ):
        payload = {
            "client_event_id": "evt_playlist_15",
            "track_id": 12,
            "title": "Digital Bath",
            "artist": "Deftones",
            "album": "White Pony",
            "started_at": "2026-10-01T10:00:00Z",
            "ended_at": "2026-10-01T10:04:00Z",
            "played_seconds": 240,
            "play_source_type": "playlist",
            "play_source_id": "15",
            "play_source_name": "Deftones",
        }

        with patch("crate.api.me.record_play_event", return_value=78) as mock_record:
            resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 200
        assert mock_record.call_args.kwargs["context_playlist_id"] == 15

    def test_play_event_endpoint_ignores_non_numeric_playlist_sources(self, test_app):
        payload = {
            "client_event_id": "evt_setlist",
            "track_id": 12,
            "title": "Every You Every Me",
            "artist": "Placebo",
            "album": "Without You I'm Nothing",
            "started_at": "2026-10-01T10:00:00Z",
            "ended_at": "2026-10-01T10:03:00Z",
            "played_seconds": 180,
            "play_source_type": "playlist",
            "play_source_name": "Setlist probable de Placebo",
        }

        with patch("crate.api.me.record_play_event", return_value=79) as mock_record:
            resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 200
        assert mock_record.call_args.kwargs["context_playlist_id"] is None

    def test_play_event_endpoint_preserves_global_track_uid(self, test_app):
        payload = {
            "client_event_id": "evt_high_vis_001",
            "global_track_uid": "11111111-1111-4111-8111-111111111111",
            "track_id": None,
            "track_path": "11111111-1111-4111-8111-111111111111",
            "title": "0151",
            "artist": "High Vis",
            "album": "Blending",
            "started_at": "2026-04-01T10:00:00Z",
            "ended_at": "2026-04-01T10:01:34Z",
            "played_seconds": 73.2,
            "track_duration_seconds": 94.0,
            "completion_ratio": 0.779,
        }

        with patch("crate.api.me.record_play_event", return_value=78) as mock_record:
            resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 200
        mock_record.assert_called_once()
        assert (
            mock_record.call_args.kwargs["global_track_uid"]
            == "11111111-1111-4111-8111-111111111111"
        )

    def test_play_event_endpoint_rejects_inconsistent_completion_flags(self, test_app):
        payload = {
            "track_id": 12,
            "track_path": "Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "started_at": "2026-04-01T10:00:00Z",
            "ended_at": "2026-04-01T10:01:34Z",
            "played_seconds": 73.2,
            "track_duration_seconds": 94.0,
            "completion_ratio": 0.779,
            "was_skipped": True,
            "was_completed": True,
        }

        resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 422


def _access_token_user(scopes: list[str]):
    async def resolve(_middleware, _request):
        return {
            "id": 7,
            "email": "dj@example.test",
            "role": "user",
            "auth_type": "access_token",
            "access_token_id": 42,
            "scopes": scopes,
        }

    return resolve


_VDJ_PLAY_EVENT = {
    "client_event_id": "vdj_evt_1",
    "track_entity_uid": "0b5d2c8e-6f1a-4d3b-9c7e-2a1f4e8d6b90",
    "title": "Noah",
    "artist": "Birds In Row",
    "started_at": "2026-10-08T10:00:00Z",
    "ended_at": "2026-10-08T10:03:00Z",
    "played_seconds": 180.0,
    "track_duration_seconds": 193.5,
    "completion_ratio": 0.93,
    "was_skipped": False,
    "was_completed": True,
}


class TestAccessTokenPlayEvents:
    def test_access_token_without_play_event_scope_cannot_write(self, test_app):
        with (
            patch(
                "crate.api.auth.AuthMiddleware.resolve_user",
                _access_token_user(["vdj.catalog.read", "vdj.media.read"]),
            ),
            patch("crate.api.me.record_play_event") as mock_record,
        ):
            resp = test_app.post("/api/me/play-events", json=_VDJ_PLAY_EVENT)

        assert resp.status_code == 403
        assert "vdj.play_events.write" in resp.json()["detail"]
        mock_record.assert_not_called()

    def test_access_token_with_play_event_scope_records_event(self, test_app):
        with (
            patch(
                "crate.api.auth.AuthMiddleware.resolve_user",
                _access_token_user(["vdj.play_events.write"]),
            ),
            patch("crate.api.me.record_play_event", return_value=91) as mock_record,
        ):
            resp = test_app.post("/api/me/play-events", json=_VDJ_PLAY_EVENT)

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "id": 91}
        assert mock_record.call_args.args == (7,)
