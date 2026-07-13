"""Streaming proxy — short-lived ticket-based remote media streaming.

The proxy never buffers full media in memory. It streams bytes from the remote
peer to the local client, forwarding Range headers and preserving media response
headers while stripping hop-by-hop headers and blocking local credentials.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

import httpx
from sqlalchemy.exc import ProgrammingError

from crate.db.tx import transaction_scope
from crate.federation.grants import preset_allows

log = logging.getLogger(__name__)

TICKET_TTL_MINUTES = 5
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


def create_ticket(
    node_uid: str,
    remote_entity_uid: str,
    delivery_policy: str = "balanced",
    subject_hash: str | None = None,
    local_user_id: int | None = None,
    direction: str = "outbound",
) -> dict:
    ticket_uid = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TICKET_TTL_MINUTES)

    with transaction_scope() as s:
        from sqlalchemy import text

        s.execute(
            text(
                """
                INSERT INTO federation_stream_tickets
                    (ticket_uid, direction, node_uid, subject_hash,
                     remote_entity_uid, delivery_policy, local_user_id,
                     expires_at)
                VALUES
                    (:ticket_uid, :direction, :node_uid, :subject_hash,
                     :remote_entity_uid, :delivery_policy, :local_user_id,
                     :expires_at)
                """
            ),
            {
                "ticket_uid": ticket_uid,
                "direction": direction,
                "node_uid": node_uid,
                "subject_hash": subject_hash,
                "remote_entity_uid": remote_entity_uid,
                "delivery_policy": delivery_policy,
                "local_user_id": local_user_id,
                "expires_at": expires_at,
            },
        )
        row = (
            s.execute(
                text("SELECT * FROM federation_stream_tickets WHERE ticket_uid = :uid"),
                {"uid": ticket_uid},
            )
            .mappings()
            .one()
        )
        return dict(row)


def validate_ticket(ticket_uid: str) -> dict | None:
    from sqlalchemy import text

    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_stream_tickets "
                    "WHERE ticket_uid = :uid AND status = 'active' AND expires_at > :now"
                ),
                {"uid": ticket_uid, "now": now},
            )
            .mappings()
            .first()
        )

        if not row:
            return None

        ticket = dict(row)

        # Mark as used
        s.execute(
            text(
                "UPDATE federation_stream_tickets SET used_at = :now "
                "WHERE ticket_uid = :uid"
            ),
            {"uid": ticket_uid, "now": now},
        )
        return ticket


def revoke_peer_tickets(node_uid: str) -> int:
    from sqlalchemy import text

    try:
        with transaction_scope() as s:
            result = s.execute(
                text(
                    "UPDATE federation_stream_tickets SET status = 'revoked' "
                    "WHERE node_uid = :uid AND status = 'active'"
                ),
                {"uid": node_uid},
            )
            return int(getattr(result, "rowcount", 0) or 0)
    except ProgrammingError as exc:
        log.warning("Could not revoke federation peer tickets: %s", exc)
        return 0


def revoke_subject_tickets(node_uid: str, subject_hash: str) -> int:
    from sqlalchemy import text

    try:
        with transaction_scope() as s:
            result = s.execute(
                text(
                    "UPDATE federation_stream_tickets SET status = 'revoked' "
                    "WHERE node_uid = :uid AND subject_hash = :hash AND status = 'active'"
                ),
                {"uid": node_uid, "hash": subject_hash},
            )
            return int(getattr(result, "rowcount", 0) or 0)
    except ProgrammingError as exc:
        log.warning("Could not revoke federation subject tickets: %s", exc)
        return 0


def validate_peer_stream_grant(
    peer: dict, delivery_policy: str
) -> tuple[bool, str | None]:
    preset = peer.get("default_grant_preset", "discovery")
    if not preset_allows(preset, "stream.proxy"):
        return False, "peer does not have stream.proxy grant"

    if delivery_policy == "original" and not preset_allows(preset, "stream.original"):
        return False, "peer does not have stream.original grant"

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


async def proxy_stream(
    source_url: str,
    request_headers: dict | None = None,
    chunk_size: int = 65536,
) -> AsyncIterator[tuple[bytes, dict]]:
    """Stream bytes from source_url to the caller.

    Yields (chunk_bytes, response_headers_dict). The first yield includes the
    initial response headers. Subsequent yields are streaming chunks.

    Never buffers the full response in memory.
    """
    filtered_headers = filter_request_headers(request_headers or {})

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        async with client.stream(
            "GET",
            source_url,
            headers=filtered_headers,
        ) as response:
            if response.status_code >= 400:
                log.warning(
                    "Upstream stream error: %d from %s",
                    response.status_code,
                    source_url,
                )
                yield (b"", {"status_code": response.status_code})
                return

            safe_headers = filter_response_headers(dict(response.headers))
            safe_headers["status_code"] = response.status_code

            # First yield: headers only
            yield (b"", safe_headers)

            bytes_sent = 0
            async for chunk in response.aiter_bytes(chunk_size=chunk_size):
                bytes_sent += len(chunk)
                yield (chunk, {})

            log.debug("Streamed %d bytes from %s", bytes_sent, source_url)
