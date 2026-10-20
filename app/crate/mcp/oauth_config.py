"""Explicit issuer configuration and bounded, pinned client metadata retrieval."""

import http.client
import ipaddress
import json
import os
import socket
import ssl
from dataclasses import dataclass
from urllib.parse import urlsplit

from crate.agent_access import ALLOWED_GRANTS


@dataclass(frozen=True)
class OAuthSettings:
    issuer: str
    resource: str


def oauth_enabled() -> bool:
    return os.environ.get("CRATE_MCP_OAUTH_ENABLED", "false").lower() == "true"


def oauth_settings() -> OAuthSettings:
    issuer = os.environ.get("CRATE_MCP_OAUTH_ISSUER", "").rstrip("/")
    parts = urlsplit(issuer)
    local = os.environ.get(
        "CRATE_MCP_OAUTH_ALLOW_LOCALHOST", "false"
    ).lower() == "true" and parts.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or parts.path
        or parts.scheme != "https"
        and not (local and parts.scheme == "http")
    ):
        raise ValueError("MCP OAuth requires a configured HTTPS issuer origin")
    # Trigger validation of malformed or out-of-range ports.
    _ = parts.port
    return OAuthSettings(issuer, issuer + "/mcp")


def validate_client_registration(
    client_id, name, redirect_uris, scopes, metadata_url=None
):
    if (
        not isinstance(client_id, str)
        or not 1 <= len(client_id) <= 2048
        or any(ord(c) < 33 or ord(c) == 127 for c in client_id)
    ):
        raise ValueError("Invalid OAuth client ID")
    if (
        not isinstance(name, str)
        or not 1 <= len(name.strip()) <= 120
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
    ):
        raise ValueError("Invalid OAuth client name")
    if isinstance(redirect_uris, str) or not 1 <= len(redirect_uris) <= 20:
        raise ValueError("Register one to twenty exact redirect URIs")
    for uri in redirect_uris:
        parts = urlsplit(uri)
        local = parts.hostname in {"127.0.0.1", "localhost", "::1"}
        if (
            not parts.hostname
            or parts.username
            or parts.password
            or parts.fragment
            or parts.scheme != "https"
            and not (local and parts.scheme == "http")
            or len(uri) > 2048
            or any(ord(c) < 33 or ord(c) == 127 for c in uri)
        ):
            raise ValueError(
                "Redirect URIs require HTTPS or an exact loopback callback"
            )
        _ = parts.port
    if isinstance(scopes, str) or not scopes or not set(scopes) <= ALLOWED_GRANTS:
        raise ValueError("OAuth scopes must be an allowed nonempty subset")
    if metadata_url is not None:
        if metadata_url != client_id:
            raise ValueError("The metadata URL must equal the registered client ID")
        document = fetch_client_metadata(metadata_url)
        if (
            document.get("client_id") != client_id
            or set(document.get("redirect_uris", [])) != set(redirect_uris)
            or document.get("token_endpoint_auth_method", "none") != "none"
            or set(document.get("grant_types", ["authorization_code", "refresh_token"]))
            != {"authorization_code", "refresh_token"}
            or document.get("response_types", ["code"]) != ["code"]
        ):
            raise ValueError(
                "Client metadata differs from the exact Admin registration"
            )
    elif client_id.startswith(("https://", "http://")):
        raise ValueError("URL client IDs require explicit metadata registration")


def public_metadata_addresses(url: str) -> tuple[str, list[str]]:
    if any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise ValueError("Client metadata URL contains invalid characters")
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
        or parts.query
        or parts.path in {"", "/"}
        or parts.port not in {None, 443}
        or len(url) > 2048
    ):
        raise ValueError("Client metadata requires a public HTTPS URL on port 443")
    host = parts.hostname.encode("idna").decode("ascii")
    try:
        records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("Client metadata hostname cannot be resolved") from exc
    addresses = sorted({str(record[4][0]) for record in records})
    if not addresses:
        raise ValueError("Client metadata hostname has no addresses")
    for address in addresses:
        parsed = ipaddress.ip_address(address)
        mapped = (
            isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None
        )
        if not parsed.is_global or parsed.is_multicast or mapped:
            raise ValueError(
                "Client metadata must resolve exclusively to public addresses"
            )
    return host, addresses


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str):
        self._tls_context = ssl.create_default_context()
        super().__init__(host, timeout=3, context=self._tls_context)
        self._address = address

    def connect(self):
        raw = socket.create_connection((self._address, 443), self.timeout)
        try:
            self.sock = self._tls_context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def fetch_client_metadata(url: str) -> dict:
    host, addresses = public_metadata_addresses(url)
    connection = _PinnedHTTPSConnection(host, addresses[0])
    try:
        path = urlsplit(url).path or "/"
        connection.request(
            "GET", path, headers={"Accept": "application/json", "Host": host}
        )
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("Client metadata must return 200 without redirects")
        if response.getheader("Content-Type", "").split(";", 1)[0] not in {
            "application/json",
            "application/client-id+json",
        }:
            raise ValueError("Client metadata must be JSON")
        body = response.read(65537)
        if len(body) > 65536:
            raise ValueError("Client metadata exceeds 64 KiB")
        document = json.loads(body)
        if not isinstance(document, dict):
            raise ValueError("Client metadata must be a JSON object")  # noqa: TRY004 — invalid remote document.
        return document
    except (
        OSError,
        http.client.HTTPException,
        json.JSONDecodeError,
        UnicodeDecodeError,
    ) as exc:
        raise ValueError("Client metadata could not be read safely") from exc
    finally:
        connection.close()


__all__ = [
    "OAuthSettings",
    "fetch_client_metadata",
    "oauth_enabled",
    "oauth_settings",
    "public_metadata_addresses",
    "validate_client_registration",
]
