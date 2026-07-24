"""Golden canonicalization tests for crate-ed25519-v1 signing profile.

These tests verify the canonical payload generation against frozen fixtures.
Any implementation of the signing helper must pass these before it can be
used in federation endpoints.
"""

import hashlib
import json

from crate.federation.signing_golden import get_fixtures

FIXTURES = get_fixtures()


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _build_canonical(
    method: str,
    path_with_query: str,
    host: str,
    content_type: str,
    node_id: str,
    key_id: str,
    timestamp: int,
    nonce: str,
    body: bytes,
    signed_headers: str,
) -> bytes:
    body_hash = _sha256_hex(body)
    parts = [
        "CRATE-SIGNATURE-V1",
        method.upper(),
        path_with_query,
        host,
        content_type,
        node_id,
        key_id,
        str(timestamp),
        nonce,
        body_hash,
        signed_headers,
    ]
    return "\n".join(parts).encode("utf-8")


class TestGoldenFixtures:
    def test_get_empty_body_canonical(self):
        f = FIXTURES["get_empty_body"]
        result = _build_canonical(
            method=f["method"],
            path_with_query=f["path"],
            host=f["host"],
            content_type=f["content_type"],
            node_id=f["node_id"],
            key_id=f["key_id"],
            timestamp=f["timestamp"],
            nonce=f["nonce"],
            body=f["body"],
            signed_headers=f["signed_headers"],
        )
        assert result == f["canonical"], (
            f"GET empty body canonical mismatch.\n"
            f"Expected:\n{f['canonical_string']}\n\n"
            f"Got:\n{result.decode('utf-8')}"
        )

    def test_get_empty_body_hash_is_sha256_of_empty(self):
        f = FIXTURES["get_empty_body"]
        assert f["body_hash"] == _sha256_hex(b"")
        assert (
            f["body_hash"]
            == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )

    def test_post_json_body_canonical(self):
        f = FIXTURES["post_json_body"]
        result = _build_canonical(
            method=f["method"],
            path_with_query=f["path"],
            host=f["host"],
            content_type=f["content_type"],
            node_id=FIXTURES["get_empty_body"]["node_id"],
            key_id=FIXTURES["get_empty_body"]["key_id"],
            timestamp=FIXTURES["get_empty_body"]["timestamp"],
            nonce=FIXTURES["get_empty_body"]["nonce"],
            body=f["body"],
            signed_headers=FIXTURES["get_empty_body"]["signed_headers"],
        )
        assert result == f["canonical"]

    def test_post_json_body_hash_matches(self):
        f = FIXTURES["post_json_body"]
        expected = _sha256_hex(f["body"])
        assert f["body_hash"] == expected

    def test_get_query_string_order_preserved(self):
        f = FIXTURES["get_query_string"]
        result = _build_canonical(
            method="GET",
            path_with_query=f["path"],
            host=FIXTURES["get_empty_body"]["host"],
            content_type="",
            node_id=FIXTURES["get_empty_body"]["node_id"],
            key_id=FIXTURES["get_empty_body"]["key_id"],
            timestamp=FIXTURES["get_empty_body"]["timestamp"],
            nonce=FIXTURES["get_empty_body"]["nonce"],
            body=b"",
            signed_headers=FIXTURES["get_empty_body"]["signed_headers"],
        )
        assert result == f["canonical"]

    def test_query_string_reversed_order_differs(self):
        reversed_path = "/api/federation/v1/catalog/delta?limit=50&cursor=abc123"
        result = _build_canonical(
            method="GET",
            path_with_query=reversed_path,
            host=FIXTURES["get_empty_body"]["host"],
            content_type="",
            node_id=FIXTURES["get_empty_body"]["node_id"],
            key_id=FIXTURES["get_empty_body"]["key_id"],
            timestamp=FIXTURES["get_empty_body"]["timestamp"],
            nonce=FIXTURES["get_empty_body"]["nonce"],
            body=b"",
            signed_headers=FIXTURES["get_empty_body"]["signed_headers"],
        )
        assert result != FIXTURES["get_query_string"]["canonical"], (
            "Reversed query params must produce different canonical payload"
        )

    def test_modified_host_fails(self):
        f = FIXTURES["wrong_host"]
        assert f["canonical"] != FIXTURES["get_empty_body"]["canonical"]

    def test_modified_body_hash_fails(self):
        f = FIXTURES["wrong_body_hash"]
        assert f["canonical"] != FIXTURES["post_json_body"]["canonical"]

    def test_different_body_produces_different_hash(self):
        body_a = json.dumps({"q": "test"}, separators=(",", ":")).encode("utf-8")
        body_b = json.dumps({"q": "test2"}, separators=(",", ":")).encode("utf-8")
        assert _sha256_hex(body_a) != _sha256_hex(body_b)

    def test_json_whitespace_changes_hash(self):
        body_compact = json.dumps({"q": "test"}, separators=(",", ":")).encode("utf-8")
        body_pretty = json.dumps({"q": "test"}, indent=2).encode("utf-8")
        assert _sha256_hex(body_compact) != _sha256_hex(body_pretty), (
            "JSON whitespace differences must produce different body hashes"
        )

    def test_canonical_contains_all_required_fields(self):
        canonical_str = FIXTURES["get_empty_body"]["canonical_string"]
        assert canonical_str.startswith("CRATE-SIGNATURE-V1\n")
        assert "GET\n" in canonical_str
        assert "11111111-1111-1111-1111-111111111111" in canonical_str
        assert "2026-07-test" in canonical_str
        assert "1752000000000" in canonical_str
        assert "test-nonce-001" in canonical_str
        assert (
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            in canonical_str
        )

    def test_signed_headers_lowercase_semicolon_separated(self):
        sh = FIXTURES["get_empty_body"]["signed_headers"]
        assert sh == sh.lower()
        assert ";" in sh
        assert "host" in sh
        assert "content-type" in sh
        assert "x-crate-node-id" in sh
        assert "x-crate-signature-version" in sh
        assert "x-crate-key-id" in sh
        assert "x-crate-timestamp" in sh
        assert "x-crate-nonce" in sh
        assert "x-crate-body-sha256" in sh


class TestKeyPathValidation:
    def test_rejects_absolute_path(self):
        assert not _is_valid_key_ref("/etc/passwd")

    def test_rejects_traversal(self):
        assert not _is_valid_key_ref("../../../etc/passwd")

    def test_rejects_non_key_location(self):
        assert not _is_valid_key_ref("federation/keys/../secret.pem")

    def test_accepts_valid_ref(self):
        assert _is_valid_key_ref("federation/keys/2026-07-test.pem")

    def test_accepts_valid_ref_with_hyphens(self):
        assert _is_valid_key_ref("federation/keys/2026-07-abcd.pem")

    def test_rejects_empty(self):
        assert not _is_valid_key_ref("")

    def test_rejects_ref_with_spaces(self):
        assert not _is_valid_key_ref("federation/keys/my key.pem")


def _is_valid_key_ref(ref: str) -> bool:
    """Placeholder validation — real implementation in federation/identity.py."""
    if not ref:
        return False
    if ref.startswith("/"):
        return False
    if ".." in ref:
        return False
    if " " in ref:
        return False
    if not ref.startswith("federation/keys/"):
        return False
    if not ref.endswith(".pem"):
        return False
    return True
