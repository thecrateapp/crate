"""One-time PKCE-bound handoffs for native OAuth clients."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock

NATIVE_OAUTH_HANDOFF_TTL_SECONDS = 60
_HANDOFF_PREFIX = "crate:auth:native_oauth"
_memory_handoffs: dict[str, str] = {}
_memory_lock = RLock()


class NativeOAuthUnavailable(RuntimeError):
    pass


class InvalidNativeOAuthHandoff(ValueError):
    pass


@dataclass(frozen=True)
class NativeOAuthHandoff:
    user_id: int
    app_id: str
    state: str
    challenge: str
    expires_at: datetime


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def handoff_key(code: str) -> str:
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    return f"{_HANDOFF_PREFIX}:{digest}"


def _redis_client():
    if not os.environ.get("REDIS_URL"):
        return None
    try:
        from crate.db.cache_runtime import get_redis

        return get_redis()
    except Exception:
        return None


def _local_memory_allowed() -> bool:
    environment = os.environ.get("CRATE_ENV", "").strip().lower()
    domain = os.environ.get("DOMAIN", "localhost").strip().lower()
    return environment in {"dev", "development", "test"} or domain in {
        "localhost",
        "127.0.0.1",
    }


def _serialize(handoff: NativeOAuthHandoff) -> str:
    payload = asdict(handoff)
    payload["expires_at"] = handoff.expires_at.isoformat()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _deserialize(raw: bytes | str) -> NativeOAuthHandoff:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        payload = json.loads(raw)
        expires_at = datetime.fromisoformat(
            str(payload["expires_at"]).replace("Z", "+00:00")
        )
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return NativeOAuthHandoff(
            user_id=int(payload["user_id"]),
            app_id=str(payload["app_id"]),
            state=str(payload["state"]),
            challenge=str(payload["challenge"]),
            expires_at=expires_at,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InvalidNativeOAuthHandoff("Invalid native OAuth handoff") from exc


def issue_handoff(*, user_id: int, app_id: str, state: str, challenge: str) -> str:
    code = secrets.token_urlsafe(32)
    key = handoff_key(code)
    handoff = NativeOAuthHandoff(
        user_id=user_id,
        app_id=app_id,
        state=state,
        challenge=challenge,
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=NATIVE_OAUTH_HANDOFF_TTL_SECONDS),
    )
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        stored = redis_client.set(
            key,
            serialized,
            ex=NATIVE_OAUTH_HANDOFF_TTL_SECONDS,
            nx=True,
        )
        if stored:
            return code
        raise NativeOAuthUnavailable("Native OAuth handoff could not be stored")
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        _memory_handoffs[key] = serialized
    return code


def _take_handoff(key: str) -> bytes | str | None:
    redis_client = _redis_client()
    if redis_client is not None:
        return redis_client.getdel(key)
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        return _memory_handoffs.pop(key, None)


def consume_handoff(*, code: str, state: str, verifier: str) -> NativeOAuthHandoff:
    raw = _take_handoff(handoff_key(code))
    if raw is None:
        raise InvalidNativeOAuthHandoff("Native OAuth handoff is invalid or consumed")
    handoff = _deserialize(raw)
    now = datetime.now(timezone.utc)
    state_valid = secrets.compare_digest(handoff.state, state)
    challenge_valid = secrets.compare_digest(
        handoff.challenge,
        pkce_challenge(verifier),
    )
    if handoff.expires_at <= now or not state_valid or not challenge_valid:
        raise InvalidNativeOAuthHandoff("Native OAuth handoff binding is invalid")
    return handoff
