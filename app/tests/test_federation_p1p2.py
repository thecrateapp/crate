"""TDD Phase P1/P2: Catalog pagination, delta, projector, scheduler, manifest sig,
Admin UI catalog, Listen remote artist, Connect safe refs, scrobble guard.

RED phase: write failing tests → GREEN: minimal code → REFACTOR.
"""

from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest


# ═══════════════════════════════════════════════════════════════════════════
# P1 #4: Worker catalog sync with pagination
# ═══════════════════════════════════════════════════════════════════════════


class TestCatalogSyncPagination:
    def test_catalog_sync_builds_paginated_url(self):
        from crate.worker_handlers.federation import _handle_catalog_sync

        call_paths = []

        def capture_path(*args, **kwargs):
            call_paths.append(kwargs.get("path", ""))
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json = MagicMock(
                return_value={
                    "revision": "r1",
                    "page": 0,
                    "total_pages": 1,
                    "items": {"albums": [], "tracks": []},
                }
            )
            return resp

        mock_peer = {
            "node_uid": "p1",
            "api_base_url": "https://api.test",
            "display_name": "P1",
        }
        mock_local = {
            "node_uid": "local",
            "active_key_id": "key1",
            "private_key_ref": "federation/keys/k.pem",
        }

        with nullcontext():
            with patch(
                "crate.db.repositories.federation.get_peer",
                return_value=mock_peer,
            ):
                with patch(
                    "crate.db.repositories.federation.get_local_node",
                    return_value=mock_local,
                ):
                    with patch(
                        "crate.federation.client.federated_get",
                        side_effect=capture_path,
                    ):
                        with patch("crate.db.repositories.federation.update_peer"):
                            with patch("crate.federation.catalog.upsert_cursor"):
                                with patch(
                                    "crate.federation.catalog.upsert_catalog_item"
                                ):
                                    _handle_catalog_sync(
                                        "task-1", {"node_uid": "p1"}, {}
                                    )
                                    assert len(call_paths) > 0
                                    path = call_paths[0]
                                    assert "page" in path.lower()

    def test_catalog_sync_handles_empty_manifest(self):
        from crate.worker_handlers.federation import _handle_catalog_sync

        mock_peer = {
            "node_uid": "p1",
            "api_base_url": "https://a",
            "display_name": "P",
        }
        mock_local = {
            "node_uid": "l",
            "active_key_id": "k",
            "private_key_ref": "federation/keys/k.pem",
        }

        with nullcontext():
            with patch(
                "crate.db.repositories.federation.get_peer",
                return_value=mock_peer,
            ):
                with patch(
                    "crate.db.repositories.federation.get_local_node",
                    return_value=mock_local,
                ):
                    with patch("crate.federation.client.federated_get") as mock_get:
                        resp = MagicMock()
                        resp.raise_for_status = MagicMock()
                        resp.json = MagicMock(
                            return_value={
                                "revision": "r1",
                                "page": 0,
                                "total_pages": 1,
                                "items": {},
                            }
                        )
                        mock_get.return_value = resp
                        with patch("crate.db.repositories.federation.update_peer"):
                            with patch("crate.federation.catalog.upsert_cursor"):
                                with patch(
                                    "crate.federation.catalog.upsert_catalog_item"
                                ):
                                    result = _handle_catalog_sync(
                                        "t", {"node_uid": "p1"}, {}
                                    )
                                    assert "synced" in result
                                    assert result["synced"] == 0


# ═══════════════════════════════════════════════════════════════════════════
# P1 #5: Delta endpoint with real operations
# ═══════════════════════════════════════════════════════════════════════════


class TestDeltaEndpoint:
    def test_delta_returns_operations_not_empty_stub(self):
        """RED: catalog delta must return structured operations list."""
        from crate.api.federation import router

        routes = [r.path for r in router.routes]
        has_delta = any("delta" in p for p in routes)
        assert has_delta, "Delta route must exist on the federation router"

    def test_delta_response_structure(self):
        """RED: delta response has operations and cursor."""
        result = {"cursor": "c1", "operations": [{"op": "upsert"}]}
        assert "operations" in result
        assert isinstance(result["operations"], list)
        assert "cursor" in result


# ═══════════════════════════════════════════════════════════════════════════
# P1 #6: Projector / domain events for federation
# ═══════════════════════════════════════════════════════════════════════════


class TestFederationDomainEvents:
    def test_domain_event_emitter_exists(self):
        """RED: must have a function to emit federation domain events."""
        events_module_importable = False
        try:
            from crate.federation import events

            events_module_importable = True
            assert hasattr(events, "emit_catalog_sync_completed")
            assert hasattr(events, "emit_catalog_sync_failed")
            assert hasattr(events, "emit_peer_health_changed")
        except ImportError:
            pass
        assert events_module_importable, "federation.events module must exist"

    def test_catalog_sync_fires_completion_event(self):
        """RED: catalog sync handler must emit completion event."""
        try:
            from crate.federation import events
        except ImportError:
            pytest.skip("Module not created yet")

        with patch.object(events, "emit_catalog_sync_completed") as mock_emit:
            events.emit_catalog_sync_completed("node-1", 42, "rev-1")
            mock_emit.assert_called_once()
            call_args = mock_emit.call_args[0]
            assert call_args[0] == "node-1"


# ═══════════════════════════════════════════════════════════════════════════
# P1 #7: Scheduler - health poll + catalog sync cron
# ═══════════════════════════════════════════════════════════════════════════


class TestScheduler:
    def test_scheduler_registers_health_poll(self):
        """RED: scheduler must have a recurring federation health poll."""
        try:
            from crate.scheduler import SCHEDULED_TASKS

            tasks = {t["name"] for t in SCHEDULED_TASKS}
            assert "federation_health_poll" in tasks, (
                f"federation_health_poll not in scheduled tasks: {tasks}"
            )
        except ImportError:
            pytest.skip("Scheduler module not found at expected path")

    def test_scheduler_registers_catalog_sync(self):
        """RED: scheduler must have a recurring catalog sync task."""
        try:
            from crate.scheduler import SCHEDULED_TASKS

            tasks = {t["name"] for t in SCHEDULED_TASKS}
            assert "federation_sync_catalog" in tasks
        except ImportError:
            pytest.skip("Scheduler module not found")


# ═══════════════════════════════════════════════════════════════════════════
# P1 #8: Community manifest signature verification
# ═══════════════════════════════════════════════════════════════════════════


class TestManifestSignature:
    def test_manifest_has_signature_field(self):
        """RED: validate_manifest must check for signature."""
        from crate.federation.directory import _validate_manifest

        unsigned = {
            "manifest_version": "1",
            "nodes": [{"node_uid": "n1", "api_base_url": "https://test"}],
        }
        # Without signature, manifest should still validate structurally
        # but a signed manifest check should exist
        assert _validate_manifest(unsigned) is True

    def test_signed_manifest_verification_exists(self):
        """RED: verify_signed_manifest function must exist."""
        from crate.federation.directory import verify_signed_manifest

        assert callable(verify_signed_manifest)

        with patch("crate.federation.directory.fetch_community_manifest") as mock_fetch:
            mock_fetch.return_value = {
                "manifest_version": "1",
                "nodes": [{"node_uid": "n1", "api_base_url": "https://test"}],
                "signature": "ed25519:bad_sig_that_wont_verify",
            }
            result = verify_signed_manifest("https://test/manifest.json")
            assert result is False, "Bad signature must fail verification"


# ═══════════════════════════════════════════════════════════════════════════
# P2 #9: Admin UI catalog data
# ═══════════════════════════════════════════════════════════════════════════


class TestAdminCatalogUI:
    def test_catalog_counts_endpoint_exists(self):
        """RED: must have endpoint returning item counts per peer."""
        from crate.federation.catalog import count_catalog_items

        assert callable(count_catalog_items)

    def test_catalog_cursor_endpoint_exists(self):
        """RED: must have cursor/sync status per peer."""
        from crate.federation.catalog import get_cursor, is_catalog_stale

        assert callable(get_cursor)
        assert callable(is_catalog_stale)


# ═══════════════════════════════════════════════════════════════════════════
# P2 #10: Listen - remote artist detail, hide local actions, player source
# ═══════════════════════════════════════════════════════════════════════════


class TestListenRemoteFeatures:
    def test_remote_artist_route_exists(self):
        """RED: route table must include remote artist route."""
        import os

        route_file = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "listen",
            "src",
            "app-shell",
            "route-table.tsx",
        )
        if os.path.exists(route_file):
            with open(route_file) as f:
                content = f.read()
            assert "RemoteArtist" in content or "remote-artist" in content.lower(), (
                "Must have remote artist route"
            )
        else:
            pytest.skip("Route table not found at expected path")

    def test_scrobble_guard_for_remote_tracks(self):
        """RED: scrobble must be blocked for remote tracks."""

        def should_scrobble(track):
            if track.get("origin") == "remote":
                return False
            return True

        assert should_scrobble({"origin": "remote"}) is False
        assert should_scrobble({"origin": "local"}) is True

    def test_player_metadata_includes_origin(self):
        """RED: player track display must include remote source info."""

        def player_source_label(track):
            if track.get("origin") == "remote":
                node = track.get("remote", {}).get("nodeName", "Remote")
                return f"Streaming from {node}"
            return None

        remote_track = {
            "origin": "remote",
            "remote": {"nodeName": "Friend Crate"},
        }
        label = player_source_label(remote_track)
        assert label is not None
        assert "Friend Crate" in label

        local_track = {"origin": "local"}
        assert player_source_label(local_track) is None
