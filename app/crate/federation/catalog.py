"""Federated catalog persistence facade and opaque cursor codec."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from typing import Any

from crate.db.repositories.federation_catalog import (
    STALE_THRESHOLD_HOURS,
    _FED_SEARCH_SQL,
    cleanup_old_tombstones,
    cleanup_peer_catalog,
    count_catalog_items,
    get_cursor,
    is_catalog_stale,
    record_catalog_sync_error,
    save_catalog_sync_checkpoint,
    search_federated_catalog,
    tombstone_catalog_item,
    tombstone_catalog_items_missing_from_session,
    tombstone_catalog_items_missing_from_revision,
    upsert_catalog_item,
    upsert_cursor,
)


class InvalidCatalogCursor(ValueError):
    pass


_EPHEMERAL_CURSOR_SECRET = secrets.token_bytes(32)


def _cursor_secret() -> bytes:
    value = os.environ.get("CRATE_FEDERATION_CURSOR_SECRET") or os.environ.get(
        "JWT_SECRET"
    )
    return value.encode("utf-8") if value else _EPHEMERAL_CURSOR_SECRET


def _canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def _encode_cursor_envelope(envelope: dict[str, Any]) -> str:
    payload = envelope["payload"]
    signature = hmac.new(
        _cursor_secret(), _canonical_json(payload), hashlib.sha256
    ).hexdigest()
    body = _canonical_json({"payload": payload, "signature": signature})
    return base64.urlsafe_b64encode(body).rstrip(b"=").decode("ascii")


def _decode_cursor_envelope(cursor: str) -> dict[str, Any]:
    try:
        padding = "=" * (-len(cursor) % 4)
        decoded = base64.urlsafe_b64decode(cursor + padding)
        envelope = json.loads(decoded)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise InvalidCatalogCursor("Malformed catalog cursor") from exc
    if not isinstance(envelope, dict) or not isinstance(envelope.get("payload"), dict):
        raise InvalidCatalogCursor("Malformed catalog cursor")
    return envelope


def encode_catalog_cursor(*, peer_uid: str, mode: str, position: dict[str, Any]) -> str:
    if mode not in {"snapshot", "delta"}:
        raise ValueError("Unsupported catalog cursor mode")
    return _encode_cursor_envelope(
        {
            "payload": {
                "version": 1,
                "peer_uid": peer_uid,
                "mode": mode,
                "position": position,
            }
        }
    )


def decode_catalog_cursor(cursor: str, *, peer_uid: str) -> dict[str, Any]:
    envelope = _decode_cursor_envelope(cursor)
    payload = envelope["payload"]
    supplied = str(envelope.get("signature") or "")
    expected = hmac.new(
        _cursor_secret(), _canonical_json(payload), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(supplied, expected):
        raise InvalidCatalogCursor("Invalid catalog cursor signature")
    if payload.get("version") != 1:
        raise InvalidCatalogCursor("Unsupported catalog cursor version")
    if payload.get("peer_uid") != peer_uid:
        raise InvalidCatalogCursor("Catalog cursor belongs to another peer")
    if payload.get("mode") not in {"snapshot", "delta"}:
        raise InvalidCatalogCursor("Invalid catalog cursor mode")
    position = payload.get("position")
    if not isinstance(position, dict):
        raise InvalidCatalogCursor("Invalid catalog cursor position")
    return {
        "version": 1,
        "mode": payload["mode"],
        "position": position,
    }


__all__ = [
    "STALE_THRESHOLD_HOURS",
    "InvalidCatalogCursor",
    "_FED_SEARCH_SQL",
    "cleanup_old_tombstones",
    "cleanup_peer_catalog",
    "count_catalog_items",
    "decode_catalog_cursor",
    "encode_catalog_cursor",
    "get_cursor",
    "is_catalog_stale",
    "record_catalog_sync_error",
    "save_catalog_sync_checkpoint",
    "search_federated_catalog",
    "tombstone_catalog_item",
    "tombstone_catalog_items_missing_from_session",
    "tombstone_catalog_items_missing_from_revision",
    "upsert_catalog_item",
    "upsert_cursor",
]
