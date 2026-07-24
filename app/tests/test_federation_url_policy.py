from __future__ import annotations

import socket

import pytest


def _resolver(*addresses: str):
    def resolve(host: str, port: int, **kwargs):
        del host, kwargs
        return [
            (
                socket.AF_INET6 if ":" in address else socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                (address, port, 0, 0) if ":" in address else (address, port),
            )
            for address in addresses
        ]

    return resolve


def test_https_public_origin_is_normalized_and_pinned():
    from crate.federation.url_policy import FederationURLPolicy

    policy = FederationURLPolicy(resolver=_resolver("93.184.216.34"))

    validated = policy.validate_base_url("https://EXAMPLE.com.:443/root/")

    assert validated.url == "https://example.com/root"
    assert validated.origin == "https://example.com"
    assert validated.addresses == ("93.184.216.34",)
    assert validated.port == 443


def test_http_requires_the_explicit_development_override():
    from crate.federation.url_policy import FederationURLPolicy

    resolver = _resolver("93.184.216.34")
    with pytest.raises(ValueError, match="HTTPS is required"):
        FederationURLPolicy(resolver=resolver).validate_base_url(
            "http://example.com:8585"
        )

    validated = FederationURLPolicy(
        resolver=resolver,
        allow_http=True,
    ).validate_base_url("http://example.com:8585")
    assert validated.origin == "http://example.com:8585"


def test_private_networks_require_a_separate_development_override():
    from crate.federation.url_policy import FederationURLPolicy

    resolver = _resolver("10.0.0.8")
    with pytest.raises(ValueError, match="non-public"):
        FederationURLPolicy(
            resolver=resolver,
            allow_http=True,
        ).validate_base_url("http://node-a-api:8585")

    validated = FederationURLPolicy(
        resolver=resolver,
        allow_http=True,
        allow_private_networks=True,
    ).validate_base_url("http://node-a-api:8585")

    assert validated.addresses == ("10.0.0.8",)


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@example.com",
        "https://example.com/path#fragment",
        "ftp://example.com",
        "https:///missing-host",
        "https://service.local",
    ],
)
def test_unsafe_url_shapes_are_rejected(url: str):
    from crate.federation.url_policy import FederationURLPolicy

    with pytest.raises(ValueError):
        FederationURLPolicy(resolver=_resolver("93.184.216.34")).validate_base_url(url)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "192.0.2.1",
        "224.0.0.1",
        "::1",
        "fe80::1",
        "::ffff:127.0.0.1",
    ],
)
def test_non_public_dns_answers_are_rejected(address: str):
    from crate.federation.url_policy import FederationURLPolicy

    with pytest.raises(ValueError, match="non-public"):
        FederationURLPolicy(resolver=_resolver(address)).validate_base_url(
            "https://example.com"
        )


def test_mixed_public_and_private_dns_answers_are_rejected():
    from crate.federation.url_policy import FederationURLPolicy

    with pytest.raises(ValueError, match="non-public"):
        FederationURLPolicy(
            resolver=_resolver("93.184.216.34", "127.0.0.1")
        ).validate_base_url("https://example.com")


def test_resource_urls_must_remain_on_the_approved_origin():
    from crate.federation.url_policy import FederationURLPolicy

    policy = FederationURLPolicy(resolver=_resolver("93.184.216.34"))
    base = policy.validate_base_url("https://example.com/api")

    assert policy.require_same_origin(base, "/media/track.flac") == (
        "https://example.com/media/track.flac"
    )
    assert (
        policy.require_same_origin(base, "https://example.com/media/track.flac")
        == "https://example.com/media/track.flac"
    )

    with pytest.raises(ValueError, match="origin"):
        policy.require_same_origin(base, "https://cdn.example.net/track.flac")
    with pytest.raises(ValueError, match="credentials"):
        policy.require_same_origin(base, "https://user@example.com/track.flac")
