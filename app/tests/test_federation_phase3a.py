"""Phase 3A federation tests — stream proxy, tickets, headers, security.

DB-dependent tests (ticket lifecycle) are integration tests that require the
federation_stream_tickets table to exist. They are skipped in unit test runs.
"""

from crate.federation.stream_proxy import (
    validate_peer_stream_grant,
    filter_request_headers,
    filter_response_headers,
    TICKET_TTL_MINUTES,
    HOP_BY_HOP_HEADERS,
    SAFE_RESPONSE_HEADERS,
)


class TestPeerStreamGrant:
    def test_discovery_no_stream(self):
        peer = {"default_grant_preset": "discovery"}
        ok, err = validate_peer_stream_grant(peer, "balanced")
        assert ok is False
        assert "stream.proxy" in err

    def test_listen_allows_transcoded(self):
        peer = {"default_grant_preset": "listen"}
        ok, err = validate_peer_stream_grant(peer, "balanced")
        assert ok is True

    def test_transcoded_delivery_requires_transcoded_capability(self, monkeypatch):
        monkeypatch.setattr(
            "crate.federation.stream_proxy.preset_allows",
            lambda _preset, capability: capability == "stream.proxy",
        )

        ok, err = validate_peer_stream_grant(
            {"default_grant_preset": "listen"}, "data_saver"
        )

        assert ok is False
        assert "stream.transcoded" in err

    def test_listen_denies_original(self):
        peer = {"default_grant_preset": "listen"}
        ok, err = validate_peer_stream_grant(peer, "original")
        assert ok is False
        assert "stream.original" in err

    def test_trusted_library_allows_original(self):
        peer = {"default_grant_preset": "trusted_library"}
        ok, err = validate_peer_stream_grant(peer, "original")
        assert ok is True

    def test_catalog_denies_stream(self):
        peer = {"default_grant_preset": "catalog"}
        ok, err = validate_peer_stream_grant(peer, "balanced")
        assert ok is False

    def test_off_denies_stream(self):
        peer = {"default_grant_preset": "off"}
        ok, err = validate_peer_stream_grant(peer, "balanced")
        assert ok is False


class TestHeaderFiltering:
    def test_filter_request_keeps_range(self):
        headers = {
            "Range": "bytes=0-1023",
            "Cookie": "secret",
            "Authorization": "Bearer x",
        }
        result = filter_request_headers(headers)
        assert "range" in result
        assert "cookie" not in result
        assert "authorization" not in result

    def test_filter_request_keeps_if_range(self):
        headers = {"If-Range": '"etag123"', "X-Forwarded-For": "evil"}
        result = filter_request_headers(headers)
        assert "if-range" in result
        assert "x-forwarded-for" not in result

    def test_filter_response_strips_hop_by_hop(self):
        headers = {
            "Content-Type": "audio/mpeg",
            "Content-Length": "1000",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",
            "Keep-Alive": "timeout=5",
            "Proxy-Authenticate": "Basic",
            "Te": "trailers",
            "Trailer": "Expires",
            "Upgrade": "h2c",
        }
        result = filter_response_headers(headers)
        assert "content-type" in result
        assert "content-length" in result
        for h in HOP_BY_HOP_HEADERS:
            assert h not in result, f"Hop-by-hop header {h} should be stripped"

    def test_filter_response_keeps_safe_headers(self):
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Range": "bytes 0-1023/5000",
            "Content-Type": "audio/mpeg",
            "ETag": '"abc123"',
            "Last-Modified": "Wed, 01 Jan 2025 00:00:00 GMT",
            "Cache-Control": "public, max-age=3600",
            "Content-Length": "5000",
            "X-Custom": "should-be-stripped",
        }
        result = filter_response_headers(headers)
        assert "accept-ranges" in result
        assert "content-range" in result
        assert "content-type" in result
        assert "etag" in result
        assert "last-modified" in result
        assert "cache-control" in result
        assert "content-length" in result
        assert "x-custom" not in result

    def test_filter_headers_case_insensitive(self):
        headers = {"RANGE": "bytes=0-100", "CONTENT-TYPE": "audio/mpeg"}
        result = filter_request_headers(headers)
        assert "range" in result
        result2 = filter_response_headers({"CONTENT-TYPE": "audio/mpeg"})
        assert "content-type" in result2

    def test_strips_cookies_and_bearer(self):
        headers = {
            "Range": "bytes=0-100",
            "Cookie": "session=abc",
            "Authorization": "Bearer token123",
            "X-Crate-Node-Id": "node-1",
            "X-Crate-Signature": "ed25519:abc",
        }
        result = filter_request_headers(headers)
        assert "cookie" not in result
        assert "authorization" not in result
        assert "x-crate-node-id" not in result
        assert "x-crate-signature" not in result
        assert "range" in result

    def test_all_response_headers_filtered(self):
        """Prove that HOP_BY_HOP headers are never in SAFE_RESPONSE_HEADERS."""
        overlap = HOP_BY_HOP_HEADERS & SAFE_RESPONSE_HEADERS
        assert len(overlap) == 0, (
            f"HOP_BY_HOP and SAFE_RESPONSE_HEADERS must be disjoint. Overlap: {overlap}"
        )

    def test_ticket_ttl_is_reasonable(self):
        assert TICKET_TTL_MINUTES == 15
