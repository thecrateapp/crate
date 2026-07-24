"""Streaming proxy — short-lived ticket-based remote media streaming.

The proxy never buffers full media in memory. It streams bytes from the remote
peer to the local client, forwarding Range headers and preserving media response
headers while stripping hop-by-hop headers and blocking local credentials.
"""

from __future__ import annotations

import inspect
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.responses import Response

from crate.db.repositories.federation_stream_tickets import (
    TICKET_TTL_MINUTES,
    create_ticket,
    revoke_peer_tickets,
    revoke_subject_tickets,
    validate_ticket,
)
from crate.federation.grants import preset_allows

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
SAFE_RESPONSE_HEADERS = {
    "accept-ranges",
    "content-range",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "cache-control",
}
SAFE_REQUEST_HEADERS = {"range", "if-range", "accept"}

REVOCATION_PROBE_TTL_SECONDS = 0.25
_REVOCATION_PROBE_MAX_ENTRIES = 4096
_revocation_probe_cache: dict[tuple[int, str], tuple[float, bool]] = {}
_revocation_probe_lock = threading.Lock()


def requested_byte_count(file_size: int, range_header: str | None) -> int:
    if not range_header or not range_header.lower().startswith("bytes="):
        return max(0, file_size)
    spec = range_header.split("=", 1)[1].strip()
    if "," in spec or "-" not in spec:
        return max(0, file_size)
    start_raw, end_raw = spec.split("-", 1)
    try:
        if not start_raw:
            suffix = int(end_raw)
            return min(max(0, suffix), file_size)
        start = int(start_raw)
        if start < 0 or start >= file_size:
            return 0
        end = int(end_raw) if end_raw else file_size - 1
        end = min(end, file_size - 1)
        return max(0, end - start + 1)
    except ValueError:
        return max(0, file_size)


def _revocation_key(ticket_uid: str) -> str:
    return f"federation:stream-revoked:{{{ticket_uid}}}"


def revoke_active_stream(redis_client, ticket_uid: str, *, ttl: int = 300) -> None:
    redis_client.set(_revocation_key(ticket_uid), "1", ex=ttl)
    with _revocation_probe_lock:
        _revocation_probe_cache[(id(redis_client), ticket_uid)] = (
            time.monotonic() + REVOCATION_PROBE_TTL_SECONDS,
            True,
        )


def is_stream_revoked(redis_client, ticket_uid: str) -> bool:
    cache_key = (id(redis_client), ticket_uid)
    now = time.monotonic()
    with _revocation_probe_lock:
        cached = _revocation_probe_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    revoked = bool(redis_client.get(_revocation_key(ticket_uid)))
    with _revocation_probe_lock:
        if len(_revocation_probe_cache) >= _REVOCATION_PROBE_MAX_ENTRIES:
            expired = [
                key
                for key, (deadline, _) in _revocation_probe_cache.items()
                if deadline <= now
            ]
            for key in expired:
                _revocation_probe_cache.pop(key, None)
            if len(_revocation_probe_cache) >= _REVOCATION_PROBE_MAX_ENTRIES:
                _revocation_probe_cache.clear()
        _revocation_probe_cache[cache_key] = (
            now + REVOCATION_PROBE_TTL_SECONDS,
            revoked,
        )
    return revoked


def clear_revocation_probe_cache() -> None:
    with _revocation_probe_lock:
        _revocation_probe_cache.clear()


class _StreamTerminated(Exception):
    pass


class FederationQuotaResponse(Response):
    def __init__(
        self,
        response,
        *,
        redis_client,
        node_uid: str,
        subject_hash: str | None,
        stream_id: str,
        ticket_uid: str,
        reserved_bytes: int,
        reconcile: Callable[..., Any],
        release: Callable[..., Any],
        revoked: Callable[..., bool] = is_stream_revoked,
    ) -> None:
        super().__init__(status_code=getattr(response, "status_code", 200))
        self._response = response
        self._redis = redis_client
        self._node_uid = node_uid
        self._subject_hash = subject_hash
        self._stream_id = stream_id
        self._ticket_uid = ticket_uid
        self._reserved_bytes = reserved_bytes
        self._reconcile = reconcile
        self._release = release
        self._revoked = revoked

    async def __call__(self, scope, receive, send) -> None:
        actual_bytes = 0
        response_started = False

        async def forward(message: dict) -> None:
            nonlocal actual_bytes, response_started
            if message.get("type") == "http.response.start":
                response_started = True
            body = message.get("body") or b""
            if body:
                if self._revoked(self._redis, self._ticket_uid):
                    raise _StreamTerminated
                if actual_bytes + len(body) > self._reserved_bytes:
                    raise _StreamTerminated
                actual_bytes += len(body)
            result = send(message)
            if inspect.isawaitable(result):
                await result

        try:
            await self._response(scope, receive, forward)
        except _StreamTerminated:
            if response_started:
                result: Awaitable | None = send(
                    {"type": "http.response.body", "body": b"", "more_body": False}
                )
                if inspect.isawaitable(result):
                    await result
        finally:
            self._reconcile(
                self._redis,
                self._node_uid,
                reserved_bytes=self._reserved_bytes,
                actual_bytes=actual_bytes,
                subject_hash=self._subject_hash,
            )
            self._release(
                self._redis,
                self._node_uid,
                self._subject_hash,
                self._stream_id,
            )


def validate_peer_stream_grant(
    peer: dict, delivery_policy: str
) -> tuple[bool, str | None]:
    preset = peer.get("default_grant_preset", "discovery")
    if not preset_allows(preset, "stream.proxy"):
        return False, "peer does not have stream.proxy grant"

    if delivery_policy == "original" and not preset_allows(preset, "stream.original"):
        return False, "peer does not have stream.original grant"

    if delivery_policy != "original" and not preset_allows(preset, "stream.transcoded"):
        return False, "peer does not have stream.transcoded grant"

    return True, None


def filter_request_headers(headers: dict) -> dict:
    """Keep only safe request headers; strip cookies, auth, X-Forwarded-*, etc."""
    return {
        k.lower(): v for k, v in headers.items() if k.lower() in SAFE_REQUEST_HEADERS
    }


def filter_response_headers(headers: dict) -> dict:
    """Keep only safe response headers; strip hop-by-hop headers."""
    return {
        k.lower(): v
        for k, v in headers.items()
        if k.lower() not in HOP_BY_HOP_HEADERS and k.lower() in SAFE_RESPONSE_HEADERS
    }


__all__ = [
    "HOP_BY_HOP_HEADERS",
    "SAFE_REQUEST_HEADERS",
    "SAFE_RESPONSE_HEADERS",
    "TICKET_TTL_MINUTES",
    "FederationQuotaResponse",
    "REVOCATION_PROBE_TTL_SECONDS",
    "create_ticket",
    "clear_revocation_probe_cache",
    "filter_request_headers",
    "filter_response_headers",
    "is_stream_revoked",
    "requested_byte_count",
    "revoke_active_stream",
    "revoke_peer_tickets",
    "revoke_subject_tickets",
    "validate_peer_stream_grant",
    "validate_ticket",
]
