"""Phase 1 federation tests — identity, signing, assertions, grants, abuse, policy."""

import time
import uuid

import pytest

from crate.federation import identity, signing, assertions, grants, abuse


# ═══════════════════════════════════════════════════════════════════════════
# Identity
# ═══════════════════════════════════════════════════════════════════════════


class TestIdentity:
    def test_generate_key_id_has_prefix(self):
        kid = identity.generate_key_id()
        assert "-" in kid
        prefix = identity.KEY_ID_PREFIX
        assert kid.startswith(prefix)

    def test_generate_key_id_is_unique(self):
        ids = {identity.generate_key_id() for _ in range(10)}
        assert len(ids) == 10

    def test_generate_ed25519_key_pair(self):
        priv, pub = identity.generate_ed25519_key_pair()
        assert priv is not None
        assert pub is not None

    def test_public_key_to_base64_round_trip(self):
        _, pub = identity.generate_ed25519_key_pair()
        b64 = identity.public_key_to_base64(pub)
        assert isinstance(b64, str)
        assert len(b64) > 0
        assert "=" not in b64 or b64.endswith("=")

    def test_key_storage_and_load(self, tmp_path):
        orig_keys = identity.KEYS_DIR
        identity.KEYS_DIR = tmp_path / "federation" / "keys"
        try:
            key_id = "2026-07-testkey"
            priv, pub = identity.generate_ed25519_key_pair()
            path = identity.store_private_key(key_id, priv)
            assert path.exists()
            assert path.stat().st_mode & 0o777 == 0o600

            loaded = identity.load_private_key(key_id)
            assert loaded is not None
        finally:
            identity.KEYS_DIR = orig_keys

    def test_key_directory_resolves_runtime_data_dir(self, monkeypatch, tmp_path):
        original_keys = identity.KEYS_DIR
        identity.KEYS_DIR = None
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        monkeypatch.delenv("FEDERATION_KEYS_DIR", raising=False)
        try:
            assert identity.get_keys_dir() == tmp_path / "federation" / "keys"
        finally:
            identity.KEYS_DIR = original_keys

    def test_is_valid_key_ref_valid(self):
        assert identity.is_valid_key_ref("federation/keys/2026-07-test.pem")

    def test_is_valid_key_ref_absolute(self):
        assert not identity.is_valid_key_ref("/etc/passwd")

    def test_is_valid_key_ref_traversal(self):
        assert not identity.is_valid_key_ref("../../../etc/passwd")

    def test_is_valid_key_ref_double_dot(self):
        assert not identity.is_valid_key_ref("federation/keys/../secret.pem")

    def test_is_valid_key_ref_empty(self):
        assert not identity.is_valid_key_ref("")

    def test_is_valid_key_ref_spaces(self):
        assert not identity.is_valid_key_ref("federation/keys/my key.pem")

    def test_is_valid_key_ref_wrong_prefix(self):
        assert not identity.is_valid_key_ref("data/keys/test.pem")

    def test_is_valid_key_ref_wrong_extension(self):
        assert not identity.is_valid_key_ref("federation/keys/test")

    def test_build_descriptor_no_leaks(self):
        d = identity.build_descriptor(
            node_uid=str(uuid.uuid4()),
            display_name="Test Node",
            api_base_url="https://api.test.net",
            listen_base_url="https://listen.test.net",
            active_key_id="2026-07-test",
            public_keys=[],
            capabilities={},
            policy={},
        )
        assert "node_uid" in d
        assert "private" not in str(d).lower()
        assert "secret" not in str(d).lower()
        assert "peer" not in str(d).lower()
        assert "user" not in str(d).lower()

    def test_descriptor_has_required_fields(self):
        d = identity.build_descriptor(
            node_uid=str(uuid.uuid4()),
            display_name="Test",
            api_base_url="https://api.test",
            listen_base_url=None,
            active_key_id="key-1",
            public_keys=[
                {
                    "key_id": "key-1",
                    "algorithm": "ed25519",
                    "public_key": "abc",
                    "status": "active",
                }
            ],
            capabilities={"catalog_search": True},
            policy={"share_scope": "federated"},
        )
        assert d["software"] == "crate"
        assert d["federation_protocol_versions"] == ["v1"]
        assert d["signature_versions"] == ["crate-ed25519-v1"]
        assert d["active_key_id"] == "key-1"

    def test_negotiate_versions_common(self):
        result = identity.negotiate_versions(["v1", "v2"], ["v1"])
        assert result == "v1"

    def test_negotiate_versions_no_common(self):
        result = identity.negotiate_versions(["v1"], ["v2"])
        assert result is None

    def test_negotiate_versions_highest(self):
        result = identity.negotiate_versions(["v1", "v2", "v3"], ["v2", "v1"])
        assert result == "v2"


# ═══════════════════════════════════════════════════════════════════════════
# Signing
# ═══════════════════════════════════════════════════════════════════════════


class TestSigning:
    def setup_method(self):
        self.priv, self.pub = identity.generate_ed25519_key_pair()
        self.node_id = str(uuid.uuid4())
        self.key_id = "2026-07-test"

    def test_sign_and_verify(self):
        body = b'{"q": "High Vis"}'
        sig_headers = signing.sign_request(
            private_key=self.priv,
            method="POST",
            path_with_query="/api/federation/v1/search",
            host="api.test.net",
            content_type="application/json",
            node_id=self.node_id,
            key_id=self.key_id,
            body=body,
        )
        assert "X-Crate-Signature" in sig_headers
        assert sig_headers["X-Crate-Signature"].startswith("ed25519:")

        sig_b64 = sig_headers["X-Crate-Signature"].replace("ed25519:", "")
        result = signing.verify_signature(
            public_key=self.pub,
            method="POST",
            path_with_query="/api/federation/v1/search",
            host="api.test.net",
            content_type="application/json",
            node_id=self.node_id,
            key_id=self.key_id,
            timestamp=int(sig_headers["X-Crate-Timestamp"]),
            nonce=sig_headers["X-Crate-Nonce"],
            body=body,
            signature_b64=sig_b64,
        )
        assert result is True

    def test_bad_signature_fails(self):
        body = b"test"
        sig_headers = signing.sign_request(
            private_key=self.priv,
            method="GET",
            path_with_query="/test",
            host="api.test.net",
            content_type="",
            node_id=self.node_id,
            key_id=self.key_id,
            body=body,
        )
        sig_b64 = sig_headers["X-Crate-Signature"].replace("ed25519:", "")
        result = signing.verify_signature(
            public_key=self.pub,
            method="GET",
            path_with_query="/test",
            host="evil.test.net",  # wrong host
            content_type="",
            node_id=self.node_id,
            key_id=self.key_id,
            timestamp=int(sig_headers["X-Crate-Timestamp"]),
            nonce=sig_headers["X-Crate-Nonce"],
            body=body,
            signature_b64=sig_b64,
        )
        assert result is False

    def test_modified_body_fails(self):
        body = b'{"q": "original"}'
        sig_headers = signing.sign_request(
            private_key=self.priv,
            method="POST",
            path_with_query="/api/federation/v1/search",
            host="api.test.net",
            content_type="application/json",
            node_id=self.node_id,
            key_id=self.key_id,
            body=body,
        )
        sig_b64 = sig_headers["X-Crate-Signature"].replace("ed25519:", "")
        result = signing.verify_signature(
            public_key=self.pub,
            method="POST",
            path_with_query="/api/federation/v1/search",
            host="api.test.net",
            content_type="application/json",
            node_id=self.node_id,
            key_id=self.key_id,
            timestamp=int(sig_headers["X-Crate-Timestamp"]),
            nonce=sig_headers["X-Crate-Nonce"],
            body=b'{"q": "modified"}',  # wrong body
            signature_b64=sig_b64,
        )
        assert result is False

    def test_validate_timestamp_within_skew(self):
        now = int(time.time() * 1000)
        assert signing.validate_timestamp(now) is True
        assert signing.validate_timestamp(now - 59_000) is True

    def test_validate_timestamp_outside_skew(self):
        now = int(time.time() * 1000)
        assert signing.validate_timestamp(now + 61_000) is False

    def test_generate_nonce_is_unique(self):
        nonces = {signing.generate_nonce() for _ in range(10)}
        assert len(nonces) == 10

    def test_get_empty_body_signature(self):
        headers = signing.sign_request(
            private_key=self.priv,
            method="GET",
            path_with_query="/.well-known/crate-node",
            host="api.test.net",
            content_type="",
            node_id=self.node_id,
            key_id=self.key_id,
            body=b"",
        )
        assert headers["X-Crate-Body-SHA256"] == signing.sha256_hex(b"")


# ═══════════════════════════════════════════════════════════════════════════
# Assertions
# ═══════════════════════════════════════════════════════════════════════════


class TestAssertions:
    def test_pairwise_subject_hash_deterministic(self):
        h1 = assertions.pairwise_subject_hash("secret", "user-1", "node-b")
        h2 = assertions.pairwise_subject_hash("secret", "user-1", "node-b")
        assert h1 == h2

    def test_pairwise_subject_hash_different_users(self):
        h1 = assertions.pairwise_subject_hash("secret", "user-1", "node-b")
        h2 = assertions.pairwise_subject_hash("secret", "user-2", "node-b")
        assert h1 != h2

    def test_pairwise_subject_hash_different_nodes(self):
        h1 = assertions.pairwise_subject_hash("secret", "user-1", "node-b")
        h2 = assertions.pairwise_subject_hash("secret", "user-1", "node-c")
        assert h1 != h2

    def test_build_assertion_has_required_fields(self):
        a = assertions.build_assertion(
            issuer_node_uid="node-a",
            audience_node_uid="node-b",
            subject_hash="hash123",
            purpose="catalog.search",
        )
        assert a["iss"] == "node-a"
        assert a["aud"] == "node-b"
        assert a["sub"] == "hash123"
        assert a["purpose"] == "catalog.search"
        assert "iat" in a
        assert "exp" in a
        assert "jti" in a

    def test_validate_assertion_valid(self):
        a = assertions.build_assertion(
            issuer_node_uid="node-a",
            audience_node_uid="node-b",
            subject_hash="hash123",
            purpose="catalog.search",
        )
        ok, err = assertions.validate_assertion(a, "node-b", "catalog.search")
        assert ok is True
        assert err is None

    def test_validate_assertion_wrong_aud(self):
        a = assertions.build_assertion(
            issuer_node_uid="node-a",
            audience_node_uid="node-b",
            subject_hash="hash123",
            purpose="catalog.search",
        )
        ok, err = assertions.validate_assertion(a, "node-c", "catalog.search")
        assert ok is False
        assert "aud" in err

    def test_validate_assertion_wrong_purpose(self):
        a = assertions.build_assertion(
            issuer_node_uid="node-a",
            audience_node_uid="node-b",
            subject_hash="hash123",
            purpose="catalog.search",
        )
        ok, err = assertions.validate_assertion(a, "node-b", "stream.proxy")
        assert ok is False
        assert "purpose" in err

    def test_validate_assertion_expired(self):
        a = assertions.build_assertion(
            issuer_node_uid="node-a",
            audience_node_uid="node-b",
            subject_hash="hash123",
            purpose="catalog.search",
            ttl=-1,  # already expired
        )
        ok, err = assertions.validate_assertion(a, "node-b", "catalog.search")
        assert ok is False
        assert "expired" in err

    def test_stream_assertion_has_shorter_ttl(self):
        a_search = assertions.build_assertion(
            "a", "b", "h", "catalog.search", ttl=assertions.ASSERTION_TTL_SEARCH
        )
        a_stream = assertions.build_assertion(
            "a", "b", "h", "stream.proxy", ttl=assertions.ASSERTION_TTL_STREAM
        )
        assert (a_stream["exp"] - a_stream["iat"]) < (a_search["exp"] - a_search["iat"])


# ═══════════════════════════════════════════════════════════════════════════
# Grants
# ═══════════════════════════════════════════════════════════════════════════


class TestGrants:
    def test_known_presets(self):
        for name in grants.PRESET_NAMES:
            resolved = grants.resolve_preset(name)
            assert "capabilities" in resolved
            assert "constraints" in resolved

    def test_unknown_preset_raises(self):
        with pytest.raises(ValueError, match="Unknown preset"):
            grants.resolve_preset("nonexistent")

    def test_off_preset_allows_nothing(self):
        assert not grants.preset_allows("off", "catalog.search")
        assert not grants.preset_allows("off", "stream.proxy")

    def test_discovery_allows_search(self):
        assert grants.preset_allows("discovery", "catalog.search")
        assert not grants.preset_allows("discovery", "stream.proxy")

    def test_catalog_allows_read(self):
        assert grants.preset_allows("catalog", "catalog.album.read")
        assert not grants.preset_allows("catalog", "stream.proxy")

    def test_listen_allows_stream_transcoded(self):
        assert grants.preset_allows("listen", "stream.transcoded")
        assert not grants.preset_has_stream_original("listen")

    def test_trusted_library_allows_original(self):
        assert grants.preset_has_stream_original("trusted_library")
        assert grants.preset_has_import_request("trusted_library")

    def test_evaluate_grant_approved_preset_ok(self):
        ok, err = grants.evaluate_grant(
            peer_trust_state="approved",
            peer_disabled_at=None,
            preset_name="catalog",
            required_capability="catalog.search",
            subject_blocked=False,
        )
        assert ok is True
        assert err is None

    def test_evaluate_grant_pending_fails(self):
        ok, err = grants.evaluate_grant(
            peer_trust_state="pending",
            peer_disabled_at=None,
            preset_name="catalog",
            required_capability="catalog.search",
        )
        assert ok is False
        assert "pending" in err

    def test_evaluate_grant_disabled_fails(self):
        ok, err = grants.evaluate_grant(
            peer_trust_state="approved",
            peer_disabled_at="2026-01-01T00:00:00Z",
            preset_name="catalog",
            required_capability="catalog.search",
        )
        assert ok is False

    def test_evaluate_grant_subject_blocked_fails(self):
        ok, err = grants.evaluate_grant(
            peer_trust_state="approved",
            peer_disabled_at=None,
            preset_name="listen",
            required_capability="stream.proxy",
            subject_blocked=True,
        )
        assert ok is False
        assert "blocked" in err

    def test_evaluate_grant_insufficient_preset(self):
        ok, err = grants.evaluate_grant(
            peer_trust_state="approved",
            peer_disabled_at=None,
            preset_name="discovery",
            required_capability="stream.proxy",
        )
        assert ok is False
        assert "does not allow" in err


# ═══════════════════════════════════════════════════════════════════════════
# Abuse
# ═══════════════════════════════════════════════════════════════════════════


class TestAbuse:
    def test_subject_blocked(self):
        assert abuse.is_subject_blocked("2026-01-01T00:00:00Z") is True

    def test_subject_not_blocked(self):
        assert abuse.is_subject_blocked(None) is False

    def test_rate_limit_keys_are_namespaced(self):
        key = abuse.peer_rate_limit_key("node-1", "search")
        assert key.startswith("federation:rl:peer:")
        assert "node-1" in key
        assert "search" in key

    def test_subject_rate_limit_key(self):
        key = abuse.subject_rate_limit_key("node-1", "hash123", "search")
        assert "subject" in key
        assert "node-1" in key
        assert "hash123" in key
