"""Read-through cache helpers for federated global content facets."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from crate.db.tx import read_scope, transaction_scope

DEFAULT_JSON_TTL_SECONDS = 3600
DEFAULT_BLOB_TTL_SECONDS = 86400

log = logging.getLogger(__name__)


def cache_key_for_selection(selection: dict[str, Any]) -> str:
    identity = {
        "entity_type": selection.get("entity_type"),
        "global_entity_uid": selection.get("global_entity_uid"),
        "facet": selection.get("facet"),
        "node_uid": selection.get("node_uid"),
        "remote_entity_uid": selection.get("remote_entity_uid"),
        "source_revision": selection.get("source_revision"),
        "cache_variant": selection.get("cache_variant"),
    }
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def get_cached_json_facet(selection: dict[str, Any]) -> dict[str, Any] | None:
    key = cache_key_for_selection(selection)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT payload_json
                    FROM global_content_cache
                    WHERE cache_key = :cache_key
                      AND payload_json IS NOT NULL
                      AND (expires_at IS NULL OR expires_at > NOW())
                    """
                ),
                {"cache_key": key},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    payload = row["payload_json"]
    return payload if isinstance(payload, dict) else None


def store_json_facet(
    selection: dict[str, Any],
    payload: dict[str, Any],
    *,
    ttl_seconds: int = DEFAULT_JSON_TTL_SECONDS,
) -> None:
    key = cache_key_for_selection(selection)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(1, ttl_seconds))
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_content_cache
                    (
                        cache_key,
                        entity_type,
                        global_entity_uid,
                        facet,
                        source_node_uid,
                        remote_entity_uid,
                        source_revision,
                        content_type,
                        payload_json,
                        expires_at,
                        updated_at
                    )
                VALUES
                    (
                        :cache_key,
                        :entity_type,
                        :global_entity_uid,
                        :facet,
                        :source_node_uid,
                        :remote_entity_uid,
                        :source_revision,
                        'application/json',
                        :payload_json,
                        :expires_at,
                        NOW()
                    )
                ON CONFLICT (cache_key) DO UPDATE SET
                    payload_json = EXCLUDED.payload_json,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW()
                """
            ),
            {
                "cache_key": key,
                "entity_type": selection.get("entity_type"),
                "global_entity_uid": selection.get("global_entity_uid"),
                "facet": selection.get("facet"),
                "source_node_uid": selection.get("node_uid"),
                "remote_entity_uid": selection.get("remote_entity_uid"),
                "source_revision": selection.get("source_revision"),
                "payload_json": json.dumps(payload),
                "expires_at": expires_at,
            },
        )


def get_cached_blob_facet(selection: dict[str, Any]) -> dict[str, Any] | None:
    key = cache_key_for_selection(selection)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT content_type, blob_path
                    FROM global_content_cache
                    WHERE cache_key = :cache_key
                      AND blob_path IS NOT NULL
                      AND (expires_at IS NULL OR expires_at > NOW())
                    """
                ),
                {"cache_key": key},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    blob_path = Path(str(row["blob_path"]))
    try:
        if not blob_path.is_file():
            return None
        return {
            "content": blob_path.read_bytes(),
            "content_type": row.get("content_type") or "application/octet-stream",
        }
    except OSError as exc:
        log.debug("Global content cache blob read skipped: %s", exc)
        return None


def store_blob_facet(
    selection: dict[str, Any],
    content: bytes,
    *,
    content_type: str,
    ttl_seconds: int = DEFAULT_BLOB_TTL_SECONDS,
) -> None:
    key = cache_key_for_selection(selection)
    blob_path = _blob_path_for_key(key, content_type)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(1, ttl_seconds))
    try:
        blob_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = blob_path.with_suffix(f"{blob_path.suffix}.tmp")
        tmp_path.write_bytes(content)
        tmp_path.replace(blob_path)
    except OSError as exc:
        log.debug("Global content cache blob write skipped: %s", exc)
        return

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_content_cache
                    (
                        cache_key,
                        entity_type,
                        global_entity_uid,
                        facet,
                        source_node_uid,
                        remote_entity_uid,
                        source_revision,
                        content_type,
                        blob_path,
                        expires_at,
                        updated_at
                    )
                VALUES
                    (
                        :cache_key,
                        :entity_type,
                        :global_entity_uid,
                        :facet,
                        :source_node_uid,
                        :remote_entity_uid,
                        :source_revision,
                        :content_type,
                        :blob_path,
                        :expires_at,
                        NOW()
                    )
                ON CONFLICT (cache_key) DO UPDATE SET
                    content_type = EXCLUDED.content_type,
                    blob_path = EXCLUDED.blob_path,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW()
                """
            ),
            {
                "cache_key": key,
                "entity_type": selection.get("entity_type"),
                "global_entity_uid": selection.get("global_entity_uid"),
                "facet": selection.get("facet"),
                "source_node_uid": selection.get("node_uid"),
                "remote_entity_uid": selection.get("remote_entity_uid"),
                "source_revision": selection.get("source_revision"),
                "content_type": content_type,
                "blob_path": str(blob_path),
                "expires_at": expires_at,
            },
        )


def _blob_path_for_key(key: str, content_type: str) -> Path:
    root = Path(os.environ.get("DATA_DIR", "/data")) / "global-content-cache"
    return root / key[:2] / f"{key}{_suffix_for_content_type(content_type)}"


def _suffix_for_content_type(content_type: str) -> str:
    normalized = content_type.split(";", 1)[0].strip().lower()
    if normalized == "image/jpeg":
        return ".jpg"
    if normalized == "image/png":
        return ".png"
    if normalized == "image/webp":
        return ".webp"
    return ".bin"


def invalidate_source_cache(node_uid: str, remote_entity_uid: str | None = None) -> int:
    sql = "DELETE FROM global_content_cache WHERE source_node_uid = :node_uid"
    params: dict[str, Any] = {"node_uid": node_uid}
    if remote_entity_uid is not None:
        sql += " AND remote_entity_uid = :remote_entity_uid"
        params["remote_entity_uid"] = remote_entity_uid
    try:
        with transaction_scope() as session:
            result = session.execute(text(sql), params)
            return int(getattr(result, "rowcount", 0) or 0)
    except SQLAlchemyError as exc:
        log.debug("Global content cache invalidation skipped: %s", exc)
        return 0


__all__ = [
    "cache_key_for_selection",
    "get_cached_blob_facet",
    "get_cached_json_facet",
    "invalidate_source_cache",
    "store_blob_facet",
    "store_json_facet",
]
