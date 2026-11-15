"""Unsaved destination settings on their way to a worker (BK4, BG1-9).

"Test connection" before saving sends settings that include secrets. They never
reach PostgreSQL (no task parameter, no credential row): the API encrypts them
with the credentials key (Fernet), keeps the token in Redis for ten minutes under
a random id, and the worker takes it once (``GETDEL``). Fernet's own timestamp
makes an older token useless even if it lingered. Outside Redis, only dev and
tests keep it in memory.
"""

from __future__ import annotations

import json
import os
import secrets
from threading import RLock
from typing import Any

from cryptography.fernet import InvalidToken

TTL_SECONDS = 10 * 60
_PREFIX = "crate:backups:probe"
_memory: dict[str, str] = {}
_lock = RLock()


class EphemeralUnavailable(RuntimeError):
    pass


def _key(probe_id: str) -> str:
    return f"{_PREFIX}:{probe_id}"


def _redis():
    if not os.environ.get("REDIS_URL"):
        return None
    try:
        from crate.db.cache_runtime import get_redis

        return get_redis()
    except Exception:
        return None


def _memory_allowed() -> bool:
    return os.environ.get("CRATE_ENV", "").strip().lower() in {
        "dev",
        "development",
        "test",
    }


def _fernet():
    from crate.credentials import _fernet as credentials_fernet

    return credentials_fernet()


def put(payload: dict[str, Any]) -> str:
    """Encrypt and park ``payload``; return the id a worker takes it with."""
    probe_id = secrets.token_urlsafe(24)
    token = _fernet().encrypt(json.dumps(payload).encode("utf-8")).decode("ascii")
    client = _redis()
    if client is not None:
        try:
            client.set(_key(probe_id), token, ex=TTL_SECONDS)
            return probe_id
        except Exception as exc:
            raise EphemeralUnavailable("The probe store is unavailable") from exc
    if not _memory_allowed():
        raise EphemeralUnavailable("The probe store is unavailable")
    with _lock:
        _memory[_key(probe_id)] = token
    return probe_id


def take(probe_id: str) -> dict[str, Any] | None:
    """The payload, once; None when it expired, was taken or never existed."""
    if not isinstance(probe_id, str) or not probe_id or len(probe_id) > 64:
        return None
    client = _redis()
    if client is not None:
        try:
            raw = client.getdel(_key(probe_id))
        except Exception as exc:
            raise EphemeralUnavailable("The probe store is unavailable") from exc
    elif _memory_allowed():
        with _lock:
            raw = _memory.pop(_key(probe_id), None)
    else:
        raise EphemeralUnavailable("The probe store is unavailable")
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("ascii")
    try:
        data = _fernet().decrypt(raw.encode("ascii"), ttl=TTL_SECONDS)
    except InvalidToken:
        return None
    payload = json.loads(data)
    return payload if isinstance(payload, dict) else None


__all__ = ["EphemeralUnavailable", "TTL_SECONDS", "put", "take"]
