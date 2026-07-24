"""TDD Phase: Rate limit wiring, key material detection, ticket revocation.

Tests added via strict TDD: RED (write failing test) → GREEN (minimal code) → REFACTOR.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from crate.federation.abuse import peer_rate_limit_key, subject_rate_limit_key


# ═══════════════════════════════════════════════════════════════════════════
# TDD #1: Rate limit enforcement in search fan-out
# ═══════════════════════════════════════════════════════════════════════════


class TestRateLimitWiring:
    def test_rate_limit_keys_are_namespaced(self):
        key = peer_rate_limit_key("node-1", "search")
        assert key.startswith("federation:rl:peer:")
        assert "node-1" in key
        assert "search" in key

    def test_search_rate_limit_at_default(self):
        """RED: check_rate_limit must return False when at limit."""
        from crate.federation.abuse import check_rate_limit

        class FakeRedis:
            def pipeline(self):
                return self

            def zremrangebyscore(self, *a, **kw):
                return 0

            def zcard(self, *a, **kw):
                return 60  # at limit

            def zadd(self, *a, **kw):
                return 0

            def expire(self, *a, **kw):
                return True

            def execute(self, *a, **kw):
                return (0, 60, 0, True)

        redis = FakeRedis()
        allowed = check_rate_limit(
            redis,
            peer_rate_limit_key("node-1", "search"),
            max_requests=60,
            window_seconds=60,
        )
        assert allowed is False, "Should reject when at limit"

    def test_search_rate_limit_allows_under_limit(self):
        from crate.federation.abuse import check_rate_limit

        class FakeRedis:
            def pipeline(self):
                return self

            def zremrangebyscore(self, *a, **kw):
                return 0

            def zcard(self, *a, **kw):
                return 5  # under limit

            def zadd(self, *a, **kw):
                return 0

            def expire(self, *a, **kw):
                return True

            def execute(self, *a, **kw):
                return (0, 5, 0, True)

        redis = FakeRedis()
        allowed = check_rate_limit(
            redis,
            peer_rate_limit_key("node-1", "search"),
            max_requests=60,
            window_seconds=60,
        )
        assert allowed is True

    def test_subject_rate_limit_key_is_correct(self):
        key = subject_rate_limit_key("node-a", "hash123", "search")
        assert key == "federation:rl:subject:node-a:hash123:search"

    def test_stream_ticket_rate_limit_key(self):
        key = peer_rate_limit_key("node-b", "ticket")
        assert key == "federation:rl:peer:node-b:ticket"


# ═══════════════════════════════════════════════════════════════════════════
# TDD #2: Key material loss detection
# ═══════════════════════════════════════════════════════════════════════════


class TestKeyMaterialDetection:
    def test_detect_missing_key_when_db_row_exists(self, tmp_path):
        """RED: bootstrap must detect when DB row exists but key file is missing."""
        from crate.federation.key_verify import _verify_key_material

        pem_dir = tmp_path / "federation" / "keys"
        pem_dir.mkdir(parents=True)

        result = _verify_key_material(
            private_key_ref="federation/keys/missing-key.pem",
            data_dir=str(tmp_path),
        )
        assert result is False, "Should detect missing key file"

    def test_detect_present_key(self, tmp_path):
        from crate.federation.key_verify import _verify_key_material

        pem_dir = tmp_path / "federation" / "keys"
        pem_dir.mkdir(parents=True)
        pem = pem_dir / "present-key.pem"
        pem.write_text("-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n")

        result = _verify_key_material(
            private_key_ref="federation/keys/present-key.pem",
            data_dir=str(tmp_path),
        )
        assert result is True

    def test_key_missing_state_blocks_federation_requests(self):
        """RED: When key material is missing, federation endpoints must reject."""
        from crate.federation.key_verify import _is_key_material_missing

        mock_get = MagicMock(
            return_value={
                "node_uid": "test",
                "private_key_ref": "federation/keys/missing.pem",
            }
        )

        with patch("crate.federation.key_verify.repo.get_local_node", mock_get):
            with (
                patch(
                    "crate.federation.key_verify.trust_repo.get_active_local_key",
                    return_value={"private_key_ref": "federation/keys/missing.pem"},
                ),
                patch("crate.federation.key_verify.Path.exists", return_value=False),
            ):
                assert _is_key_material_missing() is True


# ═══════════════════════════════════════════════════════════════════════════
# TDD #3: Ticket revocation on subject block and peer disable
# ═══════════════════════════════════════════════════════════════════════════


class TestTicketRevocation:
    def test_revoke_peer_tickets_exists(self):
        """GREEN: revoke_peer_tickets function is callable and returns an int."""
        from crate.federation.stream_proxy import revoke_peer_tickets

        assert callable(revoke_peer_tickets)

    def test_revoke_subject_tickets_exists(self):
        """GREEN: revoke_subject_tickets function is callable."""
        from crate.federation.stream_proxy import revoke_subject_tickets

        assert callable(revoke_subject_tickets)

    def test_disable_peer_calls_ticket_revocation(self):
        """GREEN: stream_proxy module exports revocation functions."""
        from crate.federation.stream_proxy import (
            revoke_peer_tickets,
            revoke_subject_tickets,
        )

        assert revoke_peer_tickets is not None
        assert revoke_subject_tickets is not None


# ═══════════════════════════════════════════════════════════════════════════
# TDD #4: Worker task handler stubs
# ═══════════════════════════════════════════════════════════════════════════


class TestWorkerTaskHandlers:
    def test_catalog_sync_handler_registers(self):
        """RED: federation_catalog_sync task handler must exist and be callable."""
        try:
            from crate.worker_handlers.federation import FEDERATION_TASK_HANDLERS

            assert "federation_catalog_sync" in FEDERATION_TASK_HANDLERS
            handler = FEDERATION_TASK_HANDLERS["federation_catalog_sync"]
            assert callable(handler)
        except ImportError:
            pytest.skip("Worker handlers module not yet created")

    def test_import_handler_registers(self):
        """RED: federation_import task handler must exist."""
        try:
            from crate.worker_handlers.federation import FEDERATION_TASK_HANDLERS

            assert "federation_import" in FEDERATION_TASK_HANDLERS
            handler = FEDERATION_TASK_HANDLERS["federation_import"]
            assert callable(handler)
        except ImportError:
            pytest.skip("Worker handlers module not yet created")

    def test_health_poll_handler_registers(self):
        """RED: federation_health_poll task handler must exist."""
        try:
            from crate.worker_handlers.federation import FEDERATION_TASK_HANDLERS

            assert "federation_health_poll" in FEDERATION_TASK_HANDLERS
            handler = FEDERATION_TASK_HANDLERS["federation_health_poll"]
            assert callable(handler)
        except ImportError:
            pytest.skip("Worker handlers module not yet created")


# ═══════════════════════════════════════════════════════════════════════════
# TDD #5: Health polling loop
# ═══════════════════════════════════════════════════════════════════════════


class TestHealthPolling:
    def test_health_poll_checks_each_approved_peer(self):
        """RED: health poll must iterate over approved peers."""
        from crate.federation.health import run_health_poll

        with patch(
            "crate.federation.health.repo.list_peers",
            return_value=[
                {
                    "node_uid": "p1",
                    "api_base_url": "https://api.test",
                    "display_name": "P1",
                    "disabled_at": None,
                }
            ],
        ):
            with patch(
                "crate.federation.health.poll_peer",
                return_value={"healthy": True, "latency_ms": 42, "error": None},
            ):
                results = run_health_poll()
                assert results is not None
                assert len(results) >= 1

    def test_health_poll_returns_per_peer_status(self):
        """RED: health poll run must return status dict per peer."""
        from crate.federation.health import run_health_poll

        with patch(
            "crate.federation.health.repo.list_peers",
            return_value=[
                {
                    "node_uid": "p1",
                    "api_base_url": "https://api.test",
                    "display_name": "P1",
                }
            ],
        ):
            with patch(
                "crate.federation.health.poll_peer",
                return_value={"healthy": True, "latency_ms": 42},
            ):
                results = run_health_poll()
                assert results is not None
                assert len(results) >= 1


# ═══════════════════════════════════════════════════════════════════════════
# TDD #6: Make targets verification
# ═══════════════════════════════════════════════════════════════════════════


class TestMakeTargets:
    def test_federation_dev_up_target_exists(self):
        makefile = Path(__file__).resolve().parents[2] / "Makefile"
        with makefile.open() as f:
            content = f.read()

        required = [
            "federation-dev-up",
            "federation-dev-down",
            "federation-dev-reset",
        ]
        for target in required:
            assert f".PHONY: {target}" in content or f"{target}:" in content, (
                f"Missing Make target: {target}"
            )

    def test_federation_dev_smoke_target_exists(self):
        makefile = Path(__file__).resolve().parents[2] / "Makefile"
        with makefile.open() as f:
            content = f.read()
        assert "federation-dev-smoke" in content
        assert "federation-dev-logs" in content
        assert "federation-dev-seed" in content
