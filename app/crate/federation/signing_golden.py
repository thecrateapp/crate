"""
Golden canonicalization fixtures for crate-ed25519-v1 request signing.

These fixtures serve as the authoritative specification for the signing
profile. Any implementation must produce the exact same signed payloads.

Canonicalization payload format (newline-separated, uppercase fields):

    CRATE-SIGNATURE-V1\n
    {METHOD}\n
    {PATH_WITH_QUERY}\n
    {HOST}\n
    {CONTENT_TYPE}\n
    {NODE_ID}\n
    {KEY_ID}\n
    {TIMESTAMP}\n
    {NONCE}\n
    {BODY_SHA256}\n
    {SIGNED_HEADERS}

Signed headers list (semicolon-separated, lowercase):

    host;content-type;x-crate-node-id;x-crate-signature-version;
    x-crate-key-id;x-crate-timestamp;x-crate-nonce;x-crate-body-sha256

Request headers sent over the wire:

    Host: <request_host>
    Content-Type: application/json
    X-Crate-Node-Id: <node_uid>
    X-Crate-Signature-Version: crate-ed25519-v1
    X-Crate-Key-Id: <key_id>
    X-Crate-Timestamp: <unix_ms>
    X-Crate-Nonce: <random_nonce>
    X-Crate-Body-SHA256: <lowercase_hex_sha256>
    X-Crate-Signed-Headers: host;content-type;x-crate-node-id;...
    X-Crate-Signature: ed25519:<base64_signature>

Validation checks performed by the receiver:

    1. Node exists and is enabled.
    2. Signature version is supported.
    3. Federation protocol version is supported for the endpoint.
    4. Key ID exists for the stored peer and is active or still within grace.
    5. Timestamp is within allowed skew (5 minutes).
    6. Nonce has not been seen recently (Redis replay guard).
    7. Body hash matches the received body.
    8. Host and content type match the canonical payload.
    9. Peer has the required node scope.
    10. The peer grant allows the principal, action, resource, and constraints.

Edge cases:

    - GET with empty body: BODY_SHA256 is SHA256(""), i.e.
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    - POST with JSON body: BODY_SHA256 is SHA256 of the raw JSON bytes (no
      trailing newline, UTF-8).
    - Query string parameters are preserved in PATH_WITH_QUERY in the order
      they appear in the request.
    - Modified host in the canonical payload must fail validation.
    - Modified body hash in the canonical payload must fail validation.
    - Replayed nonce must fail validation.
    - Timestamp outside the skew window must fail validation.
    - Unknown key ID must fail validation.
    - Mismatched signature version must fail validation.
"""

import hashlib
import json

# ── Golden fixtures ───────────────────────────────────────────────────────

FIXTURE_NODE_ID = "11111111-1111-1111-1111-111111111111"
FIXTURE_KEY_ID = "2026-07-test"
FIXTURE_TIMESTAMP = 1752000000000
FIXTURE_NONCE = "test-nonce-001"


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_payload(
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


# ── Fixture 1: GET with empty body ────────────────────────────────────────

FIXTURE_1_METHOD = "GET"
FIXTURE_1_PATH = "/.well-known/crate-node"
FIXTURE_1_HOST = "api.example.net"
FIXTURE_1_CONTENT_TYPE = ""
FIXTURE_1_BODY = b""

FIXTURE_1_SIGNED_HEADERS = ";".join(
    [
        "host",
        "content-type",
        "x-crate-node-id",
        "x-crate-signature-version",
        "x-crate-key-id",
        "x-crate-timestamp",
        "x-crate-nonce",
        "x-crate-body-sha256",
    ]
)

FIXTURE_1_CANONICAL = _canonical_payload(
    method=FIXTURE_1_METHOD,
    path_with_query=FIXTURE_1_PATH,
    host=FIXTURE_1_HOST,
    content_type=FIXTURE_1_CONTENT_TYPE,
    node_id=FIXTURE_NODE_ID,
    key_id=FIXTURE_KEY_ID,
    timestamp=FIXTURE_TIMESTAMP,
    nonce=FIXTURE_NONCE,
    body=FIXTURE_1_BODY,
    signed_headers=FIXTURE_1_SIGNED_HEADERS,
)

FIXTURE_1_EXPECTED_HASH = _sha256_hex(FIXTURE_1_BODY)
# e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

FIXTURE_1_CANONICAL_STRING = FIXTURE_1_CANONICAL.decode("utf-8")
"""
CRATE-SIGNATURE-V1
GET
/.well-known/crate-node
api.example.net

11111111-1111-1111-1111-111111111111
2026-07-test
1752000000000
test-nonce-001
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
host;content-type;x-crate-node-id;x-crate-signature-version;x-crate-key-id;x-crate-timestamp;x-crate-nonce;x-crate-body-sha256
"""

# ── Fixture 2: POST with JSON body ────────────────────────────────────────

FIXTURE_2_METHOD = "POST"
FIXTURE_2_PATH = "/api/federation/v1/search"
FIXTURE_2_HOST = "api.example.net"
FIXTURE_2_CONTENT_TYPE = "application/json"
FIXTURE_2_BODY = json.dumps(
    {"q": "High Vis", "limit": 10}, separators=(",", ":")
).encode("utf-8")

FIXTURE_2_CANONICAL = _canonical_payload(
    method=FIXTURE_2_METHOD,
    path_with_query=FIXTURE_2_PATH,
    host=FIXTURE_2_HOST,
    content_type=FIXTURE_2_CONTENT_TYPE,
    node_id=FIXTURE_NODE_ID,
    key_id=FIXTURE_KEY_ID,
    timestamp=FIXTURE_TIMESTAMP,
    nonce=FIXTURE_NONCE,
    body=FIXTURE_2_BODY,
    signed_headers=FIXTURE_1_SIGNED_HEADERS,
)

FIXTURE_2_EXPECTED_HASH = _sha256_hex(FIXTURE_2_BODY)

# ── Fixture 3: GET with query string (order preserved) ─────────────────────

FIXTURE_3_METHOD = "GET"
FIXTURE_3_PATH = "/api/federation/v1/catalog/delta?cursor=abc123&limit=50"
FIXTURE_3_HOST = "api.example.net"
FIXTURE_3_CONTENT_TYPE = ""
FIXTURE_3_BODY = b""

FIXTURE_3_CANONICAL = _canonical_payload(
    method=FIXTURE_3_METHOD,
    path_with_query=FIXTURE_3_PATH,
    host=FIXTURE_3_HOST,
    content_type=FIXTURE_3_CONTENT_TYPE,
    node_id=FIXTURE_NODE_ID,
    key_id=FIXTURE_KEY_ID,
    timestamp=FIXTURE_TIMESTAMP,
    nonce=FIXTURE_NONCE,
    body=FIXTURE_3_BODY,
    signed_headers=FIXTURE_1_SIGNED_HEADERS,
)

# ── Fixture 4: Modified host (failure case) ────────────────────────────────

FIXTURE_4_WRONG_HOST = "evil.example.net"
FIXTURE_4_CANONICAL = _canonical_payload(
    method=FIXTURE_1_METHOD,
    path_with_query=FIXTURE_1_PATH,
    host=FIXTURE_4_WRONG_HOST,
    content_type=FIXTURE_1_CONTENT_TYPE,
    node_id=FIXTURE_NODE_ID,
    key_id=FIXTURE_KEY_ID,
    timestamp=FIXTURE_TIMESTAMP,
    nonce=FIXTURE_NONCE,
    body=FIXTURE_1_BODY,
    signed_headers=FIXTURE_1_SIGNED_HEADERS,
)

# Fixture 4 must NOT equal Fixture 1
assert FIXTURE_4_CANONICAL != FIXTURE_1_CANONICAL, (
    "Modified host must produce different canonical payload"
)

# ── Fixture 5: Modified body hash (failure case) ───────────────────────────

FIXTURE_5_WRONG_BODY = b'{"q": "wrong"}'
FIXTURE_5_CANONICAL = _canonical_payload(
    method=FIXTURE_2_METHOD,
    path_with_query=FIXTURE_2_PATH,
    host=FIXTURE_2_HOST,
    content_type=FIXTURE_2_CONTENT_TYPE,
    node_id=FIXTURE_NODE_ID,
    key_id=FIXTURE_KEY_ID,
    timestamp=FIXTURE_TIMESTAMP,
    nonce=FIXTURE_NONCE,
    body=FIXTURE_5_WRONG_BODY,
    signed_headers=FIXTURE_1_SIGNED_HEADERS,
)

# Fixture 5 must NOT equal Fixture 2
assert FIXTURE_5_CANONICAL != FIXTURE_2_CANONICAL, (
    "Modified body must produce different canonical payload"
)


# ── Public reference values (to be used by tests) ──────────────────────────


def get_fixtures():
    """Return all golden fixtures for test consumption."""
    return {
        "get_empty_body": {
            "canonical": FIXTURE_1_CANONICAL,
            "canonical_string": FIXTURE_1_CANONICAL_STRING,
            "body_hash": FIXTURE_1_EXPECTED_HASH,
            "method": FIXTURE_1_METHOD,
            "path": FIXTURE_1_PATH,
            "host": FIXTURE_1_HOST,
            "content_type": FIXTURE_1_CONTENT_TYPE,
            "body": FIXTURE_1_BODY,
            "node_id": FIXTURE_NODE_ID,
            "key_id": FIXTURE_KEY_ID,
            "timestamp": FIXTURE_TIMESTAMP,
            "nonce": FIXTURE_NONCE,
            "signed_headers": FIXTURE_1_SIGNED_HEADERS,
        },
        "post_json_body": {
            "canonical": FIXTURE_2_CANONICAL,
            "body_hash": FIXTURE_2_EXPECTED_HASH,
            "body": FIXTURE_2_BODY,
            "method": FIXTURE_2_METHOD,
            "path": FIXTURE_2_PATH,
            "host": FIXTURE_2_HOST,
            "content_type": FIXTURE_2_CONTENT_TYPE,
        },
        "get_query_string": {
            "canonical": FIXTURE_3_CANONICAL,
            "path": FIXTURE_3_PATH,
        },
        "wrong_host": {
            "canonical": FIXTURE_4_CANONICAL,
            "wrong_host": FIXTURE_4_WRONG_HOST,
            "must_differ_from": "get_empty_body",
        },
        "wrong_body_hash": {
            "canonical": FIXTURE_5_CANONICAL,
            "wrong_body": FIXTURE_5_WRONG_BODY,
            "must_differ_from": "post_json_body",
        },
    }
