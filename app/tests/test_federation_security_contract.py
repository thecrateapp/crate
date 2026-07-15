from __future__ import annotations

import pytest


def test_protocol_contract_is_explicit_and_versioned():
    from crate.federation import contracts

    assert contracts.PROTOCOL_VERSION == "v1"
    assert contracts.MIN_PROTOCOL_VERSION == "v1"
    assert contracts.SIGNATURE_PROFILE == "crate-ed25519-v1"
    assert contracts.SUPPORTED_PROTOCOL_VERSIONS == ("v1",)
    assert contracts.CAPABILITIES == frozenset(
        {
            "catalog.search",
            "catalog.sync",
            "catalog.artist.read",
            "catalog.album.read",
            "catalog.track.read",
            "catalog.metadata.genres",
            "artwork.read",
            "stream.proxy",
            "stream.transcoded",
            "stream.original",
            "import.request",
            "import.pull",
        }
    )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("SELF_PEER", "self_peer"),
        ("REPLAY", "replay"),
        ("CLOCK_SKEW", "clock_skew"),
        ("UNKNOWN_KEY", "unknown_key"),
        ("INVALID_DESCRIPTOR", "invalid_descriptor"),
        ("INCOMPATIBLE_VERSION", "incompatible_version"),
        ("GRANT_DENIED", "grant_denied"),
        ("UNSAFE_URL", "unsafe_url"),
        ("REDIRECT_DISALLOWED", "redirect_disallowed"),
        ("STREAM_REVOKED", "stream_revoked"),
        ("INVALID_CURSOR", "invalid_cursor"),
    ],
)
def test_security_denials_have_stable_codes(name: str, value: str):
    from crate.federation.contracts import FederationErrorCode

    assert FederationErrorCode[name].value == value


def test_self_peer_is_rejected_with_a_typed_error():
    from crate.federation.contracts import (
        FederationErrorCode,
        FederationProtocolError,
        require_remote_node,
    )

    with pytest.raises(FederationProtocolError) as exc_info:
        require_remote_node("node-a", "node-a")

    assert exc_info.value.code is FederationErrorCode.SELF_PEER


def test_protocol_negotiation_rejects_an_incompatible_peer():
    from crate.federation.contracts import (
        FederationErrorCode,
        FederationProtocolError,
        negotiate_protocol,
    )

    assert negotiate_protocol(["v1"]) == "v1"

    with pytest.raises(FederationProtocolError) as exc_info:
        negotiate_protocol(["v2"])

    assert exc_info.value.code is FederationErrorCode.INCOMPATIBLE_VERSION


def test_signature_clock_window_is_sixty_seconds():
    from crate.federation import signing

    now = 1_800_000_000_000

    assert signing.validate_timestamp(now + 60_000, now=now)
    assert not signing.validate_timestamp(now + 60_001, now=now)
