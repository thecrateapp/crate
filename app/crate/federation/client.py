"""Federation HTTP client — signed outbound requests with timeouts."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import urlparse, urlsplit, urlunsplit

import httpx

from crate.federation.identity import load_private_key
from crate.federation.signing import sign_request
from crate.federation.url_policy import (
    FederationURLPolicy,
    ValidatedFederationURL,
)

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
SEARCH_TIMEOUT = httpx.Timeout(2.0, connect=2.0)
DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

_DEFAULT_URL_POLICY = FederationURLPolicy()


def _build_client(timeout: httpx.Timeout = DEFAULT_TIMEOUT) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=False)


def _sanitize_base_url(url: str) -> str:
    return _DEFAULT_URL_POLICY.validate_base_url(url).url


def _pinned_url(validated: ValidatedFederationURL, external_url: str) -> str:
    parsed = urlsplit(external_url)
    address = validated.addresses[0]
    host = f"[{address}]" if ":" in address else address
    default_port = 443 if validated.scheme == "https" else 80
    netloc = host if validated.port == default_port else f"{host}:{validated.port}"
    return urlunsplit((validated.scheme, netloc, parsed.path, parsed.query, ""))


@dataclass(frozen=True, slots=True)
class PreparedOutboundResource:
    external_url: str
    connection_url: str
    host_header: str
    sni_hostname: str


def prepare_outbound_resource(
    base_url: str,
    candidate: str,
    *,
    policy: FederationURLPolicy | None = None,
) -> PreparedOutboundResource:
    active_policy = policy or _DEFAULT_URL_POLICY
    validated = active_policy.validate_base_url(base_url)
    external_url = active_policy.require_same_origin(validated, candidate)
    return PreparedOutboundResource(
        external_url=external_url,
        connection_url=_pinned_url(validated, external_url),
        host_header=urlsplit(validated.origin).netloc,
        sni_hostname=validated.hostname,
    )


class SignedFederationClient:
    def __init__(
        self,
        *,
        base_url: str,
        node_id: str,
        key_id: str,
        private_key_ref: str,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
        policy: FederationURLPolicy | None = None,
        max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    ) -> None:
        self._base_url = base_url
        self._node_id = node_id
        self._key_id = key_id
        self._private_key_ref = private_key_ref
        self._policy = policy or _DEFAULT_URL_POLICY
        self._policy.validate_base_url(base_url)
        self._max_response_bytes = max_response_bytes
        self._client = _build_client(timeout)

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        user_assertion: str | None = None,
    ) -> httpx.Response:
        prepared = prepare_outbound_resource(
            self._base_url,
            path,
            policy=self._policy,
        )
        body = (
            json.dumps(json_body, separators=(",", ":"), default=str).encode("utf-8")
            if json_body is not None
            else b""
        )
        headers = build_signed_headers(
            method=method,
            url=prepared.external_url,
            node_id=self._node_id,
            key_id=self._key_id,
            private_key_ref=self._private_key_ref,
            body=body,
            content_type="application/json" if json_body is not None else "",
        )
        if user_assertion:
            headers["X-Crate-User-Assertion"] = user_assertion
        response = self._client.request(
            method=method,
            url=prepared.connection_url,
            headers=headers,
            content=body if json_body is not None else None,
            extensions={"sni_hostname": prepared.sni_hostname},
            follow_redirects=False,
        )
        if len(response.content) > self._max_response_bytes:
            response.close()
            raise ValueError("Federation response exceeded the configured byte limit")
        return response

    @contextmanager
    def stream(
        self,
        path: str,
        *,
        user_assertion: str | None = None,
        headers: dict[str, str] | None = None,
    ):
        prepared = prepare_outbound_resource(
            self._base_url,
            path,
            policy=self._policy,
        )
        signed_headers = build_signed_headers(
            method="GET",
            url=prepared.external_url,
            node_id=self._node_id,
            key_id=self._key_id,
            private_key_ref=self._private_key_ref,
            body=b"",
            content_type="",
        )
        if user_assertion:
            signed_headers["X-Crate-User-Assertion"] = user_assertion
        for name, value in (headers or {}).items():
            if name.lower() in {
                "range",
                "if-range",
                "accept",
                "x-crate-playback-session",
            }:
                signed_headers[name] = value
        with self._client.stream(
            method="GET",
            url=prepared.connection_url,
            headers=signed_headers,
            extensions={"sni_hostname": prepared.sni_hostname},
            follow_redirects=False,
        ) as response:
            yield response

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> SignedFederationClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


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
    base_url: str,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    *,
    local_node_uid: str | None = None,
) -> dict | None:
    try:
        validated = _DEFAULT_URL_POLICY.validate_base_url(base_url)
        external_url = _DEFAULT_URL_POLICY.require_same_origin(
            validated, "/.well-known/crate-node"
        )
        with _build_client(timeout) as client:
            resp = client.request(
                "GET",
                _pinned_url(validated, external_url),
                headers={"Host": urlsplit(validated.origin).netloc},
                extensions={"sni_hostname": validated.hostname},
                follow_redirects=False,
            )
            resp.raise_for_status()
            payload = resp.json()
            if local_node_uid is not None:
                from crate.federation.identity import verify_signed_descriptor

                return verify_signed_descriptor(
                    payload,
                    local_node_uid=local_node_uid,
                ).model_dump(mode="json")
            return payload
    except Exception as e:
        log.warning("Failed to fetch descriptor from %s: %s", base_url, e)
        return None


def safe_get(
    url: str,
    *,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    policy: FederationURLPolicy | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    active_policy = policy or _DEFAULT_URL_POLICY
    validated = active_policy.validate_base_url(url)
    request_headers = {"Host": urlsplit(validated.origin).netloc, **(headers or {})}
    with _build_client(timeout) as client:
        response = client.request(
            "GET",
            _pinned_url(validated, validated.url),
            headers=request_headers,
            extensions={"sni_hostname": validated.hostname},
            follow_redirects=False,
        )
        if len(response.content) > max_response_bytes:
            response.close()
            raise ValueError("Federation response exceeded the configured byte limit")
        return response


def safe_post_json(
    base_url: str,
    path: str,
    json_body: dict,
    *,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    policy: FederationURLPolicy | None = None,
) -> httpx.Response:
    prepared = prepare_outbound_resource(base_url, path, policy=policy)
    body = json.dumps(json_body, separators=(",", ":"), default=str).encode("utf-8")
    with _build_client(timeout) as client:
        response = client.request(
            method="POST",
            url=prepared.connection_url,
            headers={
                "Host": prepared.host_header,
                "Content-Type": "application/json",
            },
            content=body,
            extensions={"sni_hostname": prepared.sni_hostname},
            follow_redirects=False,
        )
        if len(response.content) > max_response_bytes:
            response.close()
            raise ValueError("Federation response exceeded the configured byte limit")
        return response


def federated_get(
    base_url: str,
    path: str,
    node_id: str,
    key_id: str,
    private_key_ref: str,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    user_assertion: str | None = None,
    policy: FederationURLPolicy | None = None,
) -> httpx.Response:
    with SignedFederationClient(
        base_url=base_url,
        node_id=node_id,
        key_id=key_id,
        private_key_ref=private_key_ref,
        timeout=timeout,
        policy=policy,
    ) as client:
        return client.request(
            "GET",
            path,
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
    policy: FederationURLPolicy | None = None,
) -> httpx.Response:
    with SignedFederationClient(
        base_url=base_url,
        node_id=node_id,
        key_id=key_id,
        private_key_ref=private_key_ref,
        timeout=timeout,
        policy=policy,
    ) as client:
        return client.request(
            "POST",
            path,
            json_body=json_body,
            user_assertion=user_assertion,
        )
