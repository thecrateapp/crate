"""Short-lived, exact-path credentials for browser media surfaces."""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, cast
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

MediaAudience = Literal["artwork", "stream", "sse", "ws"]

MEDIA_ACCESS_TTL_SECONDS = 60
_KEY_PREFIX = "media-access:v1:"
_VALID_AUDIENCES = frozenset({"artwork", "stream", "sse", "ws"})
_memory_lock = threading.Lock()
_memory_tickets: dict[str, tuple[float, str]] = {}


class MediaAccessUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class IssuedMediaAccessTicket:
    ticket: str
    audience: MediaAudience
    path: str
    expires_at: datetime


@dataclass(frozen=True)
class ValidatedMediaAccessTicket:
    user_id: int
    session_id: str
    audience: MediaAudience
    path: str


def _redis_client():
    from crate.db.cache_runtime import get_redis

    return get_redis()


def _local_fallback_allowed() -> bool:
    return os.environ.get("DOMAIN", "localhost") in {"localhost", "127.0.0.1"}


def _ticket_key(ticket: str) -> str:
    digest = hashlib.sha256(ticket.encode("utf-8")).hexdigest()
    return f"{_KEY_PREFIX}{digest}"


def _store(key: str, payload: str) -> None:
    try:
        redis_client = _redis_client()
        if redis_client is not None:
            redis_client.set(key, payload, ex=MEDIA_ACCESS_TTL_SECONDS)
            return
    except Exception as exc:
        raise MediaAccessUnavailable(
            "Media access ticket storage is unavailable"
        ) from exc
    if not _local_fallback_allowed():
        raise MediaAccessUnavailable("Media access ticket storage is unavailable")
    with _memory_lock:
        _memory_tickets[key] = (
            time.monotonic() + MEDIA_ACCESS_TTL_SECONDS,
            payload,
        )


def _read(key: str) -> str | None:
    try:
        redis_client = _redis_client()
        if redis_client is not None:
            value = redis_client.get(key)
            if isinstance(value, bytes):
                return value.decode("utf-8")
            return cast(str | None, value)
    except Exception:
        return None
    if not _local_fallback_allowed():
        return None
    with _memory_lock:
        stored = _memory_tickets.get(key)
        if stored is None:
            return None
        expires_at, payload = stored
        if expires_at <= time.monotonic():
            _memory_tickets.pop(key, None)
            return None
        return payload


def media_audience_for_path(path: str) -> MediaAudience | None:
    normalized = urlsplit(path).path
    if not normalized.startswith("/api/"):
        return None
    if normalized.endswith("/ws") and "/jam/" in normalized:
        return "ws"
    if (
        normalized == "/api/events"
        or normalized.startswith("/api/events/")
        or normalized == "/api/cache/events"
        or normalized == "/api/me/connect/events"
        or normalized.endswith("-stream")
    ):
        return "sse"
    if (
        normalized.startswith("/api/stream/")
        or normalized.endswith("/stream")
        or "/streams/" in normalized
    ):
        return "stream"
    artwork_markers = (
        "/cover",
        "/artwork",
        "/avatar",
        "/photo",
        "/background",
        "/image",
        "/images/",
        "/export",
    )
    if any(marker in normalized for marker in artwork_markers):
        return "artwork"
    return None


def normalize_media_access_path(path: str) -> str:
    if not isinstance(path, str) or not path or len(path) > 2048:
        raise ValueError("A bounded media API path is required")
    parts = urlsplit(path)
    if parts.scheme or parts.netloc or parts.fragment:
        raise ValueError("Media access paths must be relative API paths")
    normalized = unquote(parts.path)
    if (
        not normalized.startswith("/api/")
        or "\x00" in normalized
        or posixpath.normpath(normalized) != normalized
    ):
        raise ValueError("Media access paths must be canonical API paths")
    return normalized


def issue_media_access_ticket(
    *,
    user_id: int,
    session_id: str,
    audience: MediaAudience,
    path: str,
) -> IssuedMediaAccessTicket:
    if audience not in _VALID_AUDIENCES:
        raise ValueError("Unsupported media access audience")
    if user_id <= 0 or not session_id:
        raise ValueError("A persisted user session is required")
    normalized_path = normalize_media_access_path(path)
    if media_audience_for_path(normalized_path) != audience:
        raise ValueError("Media access path does not match its audience")

    ticket = secrets.token_urlsafe(32)
    payload = json.dumps(
        {
            "user_id": user_id,
            "session_id": session_id,
            "audience": audience,
            "path": normalized_path,
        },
        separators=(",", ":"),
    )
    _store(_ticket_key(ticket), payload)
    return IssuedMediaAccessTicket(
        ticket=ticket,
        audience=audience,
        path=normalized_path,
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=MEDIA_ACCESS_TTL_SECONDS),
    )


def validate_media_access_ticket(
    ticket: str,
    *,
    audience: MediaAudience,
    request_path: str,
) -> ValidatedMediaAccessTicket | None:
    if not ticket or audience not in _VALID_AUDIENCES:
        return None
    try:
        normalized_path = normalize_media_access_path(request_path)
    except ValueError:
        return None
    if media_audience_for_path(normalized_path) != audience:
        return None
    try:
        raw = _read(_ticket_key(ticket))
        data = json.loads(raw) if raw else None
        if (
            not isinstance(data, dict)
            or data.get("audience") != audience
            or data.get("path") != normalized_path
        ):
            return None
        user_id = int(data["user_id"])
        session_id = str(data["session_id"])
        if user_id <= 0 or not session_id:
            return None
        return ValidatedMediaAccessTicket(
            user_id=user_id,
            session_id=session_id,
            audience=audience,
            path=normalized_path,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def redact_media_credentials(url: str) -> str:
    try:
        parts = urlsplit(url)
        query = [
            (key, "[REDACTED]" if key in {"token", "media_ticket"} else value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
        ]
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
        )
    except ValueError:
        return url
