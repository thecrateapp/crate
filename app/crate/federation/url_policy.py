"""Network destination policy for every federation outbound request."""

from __future__ import annotations

import ipaddress
import os
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit


Resolver = Callable[..., list[tuple]]


@dataclass(frozen=True, slots=True)
class ValidatedFederationURL:
    url: str
    origin: str
    scheme: str
    hostname: str
    port: int
    addresses: tuple[str, ...]


def _normalized_hostname(hostname: str) -> str:
    normalized = hostname.rstrip(".").encode("idna").decode("ascii").lower()
    if not normalized or normalized.endswith(".local"):
        raise ValueError("Federation hostname is empty or local-only")
    return normalized


def _effective_port(scheme: str, port: int | None) -> int:
    if port is not None:
        return port
    return 443 if scheme == "https" else 80


def _origin(scheme: str, hostname: str, port: int) -> str:
    default_port = 443 if scheme == "https" else 80
    host = f"[{hostname}]" if ":" in hostname else hostname
    return f"{scheme}://{host}" + (f":{port}" if port != default_port else "")


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value.split("%", 1)[0])
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_global and not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


class FederationURLPolicy:
    def __init__(
        self,
        *,
        resolver: Resolver = socket.getaddrinfo,
        allow_http: bool | None = None,
        allow_private_networks: bool | None = None,
    ) -> None:
        self._resolver = resolver
        self._allow_http = (
            os.environ.get("CRATE_FEDERATION_DEV_ALLOW_HTTP", "").lower()
            in {"1", "true", "yes"}
            if allow_http is None
            else allow_http
        )
        self._allow_private_networks = (
            os.environ.get("CRATE_FEDERATION_DEV_ALLOW_PRIVATE_NETWORKS", "").lower()
            in {"1", "true", "yes"}
            if allow_private_networks is None
            else allow_private_networks
        )

    def validate_base_url(self, raw_url: str) -> ValidatedFederationURL:
        if not raw_url or any(ord(char) < 32 for char in raw_url):
            raise ValueError("Invalid federation URL")
        parsed = urlsplit(raw_url)
        scheme = parsed.scheme.lower()
        if scheme not in {"http", "https"}:
            raise ValueError("Federation URL must use HTTP or HTTPS")
        if scheme == "http" and not self._allow_http:
            raise ValueError("HTTPS is required for federation URLs")
        if not parsed.hostname:
            raise ValueError("Federation URL must include a hostname")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Federation URLs cannot contain credentials")
        if parsed.fragment:
            raise ValueError("Federation URLs cannot contain fragments")
        if parsed.query:
            raise ValueError("Federation base URLs cannot contain a query")

        hostname = _normalized_hostname(parsed.hostname)
        try:
            port = _effective_port(scheme, parsed.port)
        except ValueError as exc:
            raise ValueError("Federation URL has an invalid port") from exc
        if not 1 <= port <= 65535:
            raise ValueError("Federation URL has an invalid port")

        try:
            answers = self._resolver(
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
        except OSError as exc:
            raise ValueError(
                f"Federation hostname could not be resolved: {hostname}"
            ) from exc
        addresses = tuple(
            dict.fromkeys(str(answer[4][0]).split("%", 1)[0] for answer in answers)
        )
        if not addresses:
            raise ValueError(f"Federation hostname has no addresses: {hostname}")
        if not self._allow_private_networks and any(
            not _is_public_address(address) for address in addresses
        ):
            raise ValueError("Federation hostname resolved to a non-public address")

        origin = _origin(scheme, hostname, port)
        path = parsed.path.rstrip("/")
        return ValidatedFederationURL(
            url=f"{origin}{path}",
            origin=origin,
            scheme=scheme,
            hostname=hostname,
            port=port,
            addresses=addresses,
        )

    def require_same_origin(
        self,
        base: ValidatedFederationURL,
        candidate: str,
    ) -> str:
        resolved = urljoin(f"{base.origin}/", candidate)
        parsed = urlsplit(resolved)
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Federation resource URLs cannot contain credentials")
        if parsed.fragment:
            raise ValueError("Federation resource URLs cannot contain fragments")
        hostname = _normalized_hostname(parsed.hostname or "")
        port = _effective_port(parsed.scheme.lower(), parsed.port)
        candidate_origin = _origin(parsed.scheme.lower(), hostname, port)
        if candidate_origin != base.origin:
            raise ValueError("Federation resource URL changed origin")
        return urlunsplit(
            (
                parsed.scheme.lower(),
                urlsplit(base.origin).netloc,
                parsed.path,
                parsed.query,
                "",
            )
        )
