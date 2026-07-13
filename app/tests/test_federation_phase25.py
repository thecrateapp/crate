"""Phase 2.5 federation tests — cross-instance semantics, remote browse guards."""

import pytest

from crate.federation.cross_instance import (
    is_remote_ref,
    is_imported_remote_ref,
    sanitize_queue_track,
    build_remote_album_detail,
    deny_remote_for_local_action,
)


class TestRemoteRefDetection:
    def test_is_remote_ref_true(self):
        assert is_remote_ref({"origin": "remote"}) is True

    def test_is_remote_ref_false(self):
        assert is_remote_ref({}) is False
        assert is_remote_ref({"origin": "local"}) is False

    def test_is_imported_ref_true(self):
        assert is_imported_remote_ref({}) is True
        assert is_imported_remote_ref({"origin": "local"}) is True

    def test_is_imported_ref_false(self):
        assert is_imported_remote_ref({"origin": "remote"}) is False

    def test_is_imported_ref_with_flag(self):
        assert is_imported_remote_ref({"origin": "remote", "_imported": True}) is True


class TestDenyRemoteActions:
    def test_local_not_denied(self):
        # Local items should pass without raising
        deny_remote_for_local_action({"origin": "local"}, "test")

    def test_remote_denied(self):
        with pytest.raises(Exception):
            deny_remote_for_local_action({"origin": "remote"}, "add to playlist")

    def test_imported_remote_not_denied(self):
        deny_remote_for_local_action(
            {"origin": "remote", "_imported": True}, "add to playlist"
        )


class TestQueueSanitization:
    def test_strips_stream_url(self):
        track = {"title": "Test", "stream_url": "https://secret/ticket", "artist": "A"}
        safe = sanitize_queue_track(track)
        assert "stream_url" not in safe
        assert safe["title"] == "Test"

    def test_strips_ticket_fields(self):
        track = {
            "title": "T",
            "ticket_url": "url",
            "ticket_uid": "uid",
            "bearer_token": "tok",
        }
        safe = sanitize_queue_track(track)
        assert "ticket_url" not in safe
        assert "ticket_uid" not in safe
        assert "bearer_token" not in safe

    def test_strips_path(self):
        track = {"title": "T", "path": "/music/secret/file.mp3", "local_path": "/tmp/x"}
        safe = sanitize_queue_track(track)
        assert "path" not in safe
        assert "local_path" not in safe

    def test_preserves_safe_fields(self):
        track = {"title": "T", "artist": "A", "origin": "remote", "node_uid": "n1"}
        safe = sanitize_queue_track(track)
        assert safe["title"] == "T"
        assert safe["artist"] == "A"
        assert safe["origin"] == "remote"
        assert safe["node_uid"] == "n1"


class TestRemoteAlbumDetail:
    def test_builds_correct_shape(self):
        peer = {
            "node_uid": "node-1",
            "display_name": "Friend Crate",
            "default_grant_preset": "listen",
        }
        remote = {
            "entity_uid": "album-1",
            "name": "Blending",
            "artist": "High Vis",
            "year": "2022",
            "has_cover": True,
            "tracks": [
                {
                    "entity_uid": "t1",
                    "title": "Track 1",
                    "artist": "High Vis",
                    "duration": 180,
                },
            ],
        }
        detail = build_remote_album_detail(peer, remote)
        assert detail["origin"] == "remote"
        assert detail["node_uid"] == "node-1"
        assert detail["node_name"] == "Friend Crate"
        assert detail["name"] == "Blending"
        assert len(detail["tracks"]) == 1
        assert detail["tracks"][0]["title"] == "Track 1"
        assert detail["tracks"][0]["album_entity_uid"] == remote["entity_uid"]
        assert detail["tracks"][0]["availability"]["stream"] is True

    def test_stream_unavailable_when_not_granted(self):
        peer = {
            "node_uid": "n1",
            "display_name": "P",
            "default_grant_preset": "discovery",
        }
        remote = {"name": "A", "artist": "B", "tracks": []}
        detail = build_remote_album_detail(peer, remote)
        assert detail["availability"]["stream"] is False
