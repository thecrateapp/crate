"""Phase 5 tests — import policy, approval workflow, provenance."""

from crate.federation.imports import (
    can_request_import,
)


class TestImportPolicy:
    def test_trusted_library_allows_import(self):
        peer = {"default_grant_preset": "trusted_library"}
        ok, err = can_request_import(peer)
        assert ok is True

    def test_listen_denies_import(self):
        peer = {"default_grant_preset": "listen"}
        ok, err = can_request_import(peer)
        assert ok is False
        assert "import.request" in err

    def test_discovery_denies_import(self):
        peer = {"default_grant_preset": "discovery"}
        ok, err = can_request_import(peer)
        assert ok is False

    def test_catalog_denies_import(self):
        peer = {"default_grant_preset": "catalog"}
        ok, err = can_request_import(peer)
        assert ok is False

    def test_off_denies_import(self):
        peer = {"default_grant_preset": "off"}
        ok, err = can_request_import(peer)
        assert ok is False
