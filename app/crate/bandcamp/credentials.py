"""Compatibility exports for Bandcamp's shared credential vault."""

from crate.credentials import (
    CredentialSecretError,
    fingerprint_secret,
    load_secret,
    purge_expired_secrets,
    redacted,
    revoke_scope,
    revoke_secret,
    store_secret,
)

__all__ = [
    "CredentialSecretError",
    "fingerprint_secret",
    "load_secret",
    "purge_expired_secrets",
    "redacted",
    "revoke_scope",
    "revoke_secret",
    "store_secret",
]
