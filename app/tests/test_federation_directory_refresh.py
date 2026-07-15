from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from crate.federation.url_policy import FederationURLPolicy


def _policy() -> FederationURLPolicy:
    def resolver(host, port, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", port))]

    return FederationURLPolicy(resolver=resolver)


def _key_pair():
    private = Ed25519PrivateKey.generate()
    public = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode("ascii")
    return private, public


def _document(private, *, expires_delta=timedelta(hours=1), entries=None):
    from crate.federation.directory import sign_directory_document

    now = datetime.now(timezone.utc)
    return sign_directory_document(
        {
            "directory_version": "1",
            "issued_at": now.isoformat(),
            "expires_at": (now + expires_delta).isoformat(),
            "entries": entries
            or [
                {
                    "node_uid": "11111111-1111-4111-8111-111111111111",
                    "descriptor_url": "https://node.example/.well-known/crate-node",
                    "descriptor_digest": "a" * 64,
                }
            ],
        },
        private,
        key_id="directory-2026",
    )


def test_directory_document_requires_trusted_signature_and_freshness():
    from crate.federation.directory import (
        DirectoryValidationError,
        validate_directory_document,
    )

    private, public = _key_pair()
    document = _document(private)
    trusted = [{"key_id": "directory-2026", "public_key": public}]

    validated = validate_directory_document(
        document,
        trusted_keys=trusted,
        local_node_uid="22222222-2222-4222-8222-222222222222",
        policy=_policy(),
    )
    assert validated.signing_key_id == "directory-2026"
    assert validated.entries[0]["descriptor_digest"] == "a" * 64

    with pytest.raises(DirectoryValidationError, match="trusted"):
        validate_directory_document(
            document,
            trusted_keys=[{"key_id": "other", "public_key": public}],
            local_node_uid="22222222-2222-4222-8222-222222222222",
            policy=_policy(),
        )
    with pytest.raises(DirectoryValidationError, match="expired"):
        validate_directory_document(
            _document(private, expires_delta=timedelta(seconds=-1)),
            trusted_keys=trusted,
            local_node_uid="22222222-2222-4222-8222-222222222222",
            policy=_policy(),
        )


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        (
            [
                {
                    "node_uid": "11111111-1111-4111-8111-111111111111",
                    "descriptor_url": "https://node.example/.well-known/crate-node",
                    "descriptor_digest": "a" * 64,
                },
                {
                    "node_uid": "11111111-1111-4111-8111-111111111111",
                    "descriptor_url": "https://other.example/.well-known/crate-node",
                    "descriptor_digest": "b" * 64,
                },
            ],
            "duplicate",
        ),
        (
            [
                {
                    "node_uid": "22222222-2222-4222-8222-222222222222",
                    "descriptor_url": "https://node.example/.well-known/crate-node",
                    "descriptor_digest": "a" * 64,
                }
            ],
            "local node",
        ),
        (
            [
                {
                    "node_uid": "11111111-1111-4111-8111-111111111111",
                    "descriptor_url": "http://127.0.0.1/descriptor",
                    "descriptor_digest": "not-a-digest",
                }
            ],
            "descriptor",
        ),
    ],
)
def test_directory_document_rejects_duplicate_self_and_unsafe_entries(entries, message):
    from crate.federation.directory import (
        DirectoryValidationError,
        validate_directory_document,
    )

    private, public = _key_pair()
    with pytest.raises(DirectoryValidationError, match=message):
        validate_directory_document(
            _document(private, entries=entries),
            trusted_keys=[{"key_id": "directory-2026", "public_key": public}],
            local_node_uid="22222222-2222-4222-8222-222222222222",
            policy=_policy(),
        )


def test_refresh_uses_conditional_get_and_304_does_not_touch_candidates(monkeypatch):
    from crate.federation import directory

    class Response:
        status_code = 304
        headers = {"etag": '"v2"'}

        def raise_for_status(self):
            return None

    subscription = {
        "id": 9,
        "url": "https://directory.example/nodes.json",
        "etag": '"v1"',
        "last_modified": "Mon, 13 Jul 2026 10:00:00 GMT",
        "trusted_keys_json": [],
        "refresh_interval_seconds": 3600,
    }
    monkeypatch.setattr(directory, "safe_get", lambda *a, **kw: Response())
    monkeypatch.setattr(
        directory.directory_repo, "claim_refresh", lambda _id: {"run_uid": "run-1"}
    )
    finish = monkeypatch.setattr
    calls = []
    finish(
        directory.directory_repo,
        "finish_refresh",
        lambda *a, **kw: calls.append((a, kw)),
    )
    monkeypatch.setattr(
        directory.directory_repo,
        "upsert_candidate",
        lambda **kw: pytest.fail("304 must not mutate candidates"),
    )

    result = directory.refresh_directory_subscription(subscription)

    assert result["status"] == "not_modified"
    assert calls[0][1]["status"] == "not_modified"
    assert calls[0][1]["etag"] == '"v2"'
