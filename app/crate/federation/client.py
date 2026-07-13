"""Federation HTTP client — signed outbound requests with timeouts."""

from __future__ import annotations

import ipaddress
import json
import logging
from urllib.parse import urljoin, urlparse

import httpx

from crate.federation.identity import load_private_key
from crate.federation.signing import sign_request

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
SEARCH_TIMEOUT = httpx.Timeout(2.0, connect=2.0)

_BLOCKED_HOSTS = frozenset(
    {"localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"}
)


def _build_client(timeout: httpx.Timeout = DEFAULT_TIMEOUT) -> httpx.Client:
    return httpx.Client(timeout=timeout)


def _sanitize_base_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid base URL scheme: {url}")
    if not parsed.netloc:
        raise ValueError(f"Invalid base URL: {url}")

    hostname = parsed.hostname or ""
    if hostname.lower() in _BLOCKED_HOSTS:
        raise ValueError(f"Blocked host: {hostname}")
    if hostname.endswith(".local"):
        raise ValueError(f"Blocked .local host: {hostname}")

    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None
    if addr is not None and (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
    ):
        raise ValueError(f"Blocked address: {hostname}")

    return url.rstrip("/")


def _key_id_from_ref(ref: str) -> str:
    return ref.replace("federation/keys/", "").replace(".pem", "")


def _sign_and_send(
    client: httpx.Client,
    method: str,
    url: str,
    node_id: str,
    key_id: str,
    private_key_ref: str,
    body: bytes | None = None,
    user_assertion: str | None = None,
) -> httpx.Response:
    headers = build_signed_headers(
        method=method,
        url=url,
        node_id=node_id,
        key_id=key_id,
        private_key_ref=private_key_ref,
        body=body or b"",
        content_type="application/json" if body else "",
    )
    if user_assertion:
        headers["X-Crate-User-Assertion"] = user_assertion

    return client.request(
        method=method,
        url=url,
        headers=headers,
        content=body if body else None,
    )


def build_signed_headers(
    method: str,
    url: str,
    node_id: str,
    key_id: str,
    private_key_ref: str,
    body: bytes | None = None,
    content_type: str = "",
) -> dict[str, str]:
    """Build crate-ed25519-v1 headers for an outbound request."""
    parsed = urlparse(url)
    host = parsed.netloc
    path_with_query = parsed.path
    if parsed.query:
        path_with_query += "?" + parsed.query

    node_id = str(node_id)
    key_id = str(key_id)
    private_key = load_private_key(_key_id_from_ref(str(private_key_ref)))
    body_bytes = body or b""

    headers = sign_request(
        private_key=private_key,
        method=method,
        path_with_query=path_with_query,
        host=host,
        content_type=content_type,
        node_id=node_id,
        key_id=key_id,
        body=body_bytes,
    )
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def fetch_descriptor(
    base_url: str, timeout: httpx.Timeout = DEFAULT_TIMEOUT
) -> dict | None:
    url = urljoin(_sanitize_base_url(base_url), "/.well-known/crate-node")
    try:
        with _build_client(timeout) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        log.warning("Failed to fetch descriptor from %s: %s", base_url, e)
        return None


def federated_get(
    base_url: str,
    path: str,
    node_id: str,
    key_id: str,
    private_key_ref: str,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    user_assertion: str | None = None,
) -> httpx.Response:
    url = urljoin(_sanitize_base_url(base_url), path)
    with _build_client(timeout) as client:
        return _sign_and_send(
            client=client,
            method="GET",
            url=url,
            node_id=node_id,
            key_id=key_id,
            private_key_ref=private_key_ref,
            user_assertion=user_assertion,
        )


def federated_post(
    base_url: str,
    path: str,
    node_id: str,
    key_id: str,
    private_key_ref: str,
    json_body: dict,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    user_assertion: str | None = None,
) -> httpx.Response:
    url = urljoin(_sanitize_base_url(base_url), path)
    body = json.dumps(json_body, separators=(",", ":"), default=str).encode("utf-8")
    with _build_client(timeout) as client:
        return _sign_and_send(
            client=client,
            method="POST",
            url=url,
            node_id=node_id,
            key_id=key_id,
            private_key_ref=private_key_ref,
            body=body,
            user_assertion=user_assertion,
        )
