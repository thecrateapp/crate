"""One-time PKCE-bound handoffs for native OAuth clients."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock

NATIVE_OAUTH_HANDOFF_TTL_SECONDS = 15 * 60
NATIVE_OAUTH_RESULT_TTL_SECONDS = NATIVE_OAUTH_HANDOFF_TTL_SECONDS
_HANDOFF_PREFIX = "crate:auth:native_oauth"
_CLAIM_HANDOFF_SCRIPT = """
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {2}
end
local handoff = redis.call('GET', KEYS[1])
if not handoff then
  return {0}
end
redis.call('SET', KEYS[2], handoff, 'EX', ARGV[1])
redis.call('DEL', KEYS[1])
return {1, handoff}
"""
_memory_handoffs: dict[str, str] = {}
_memory_lock = RLock()


class NativeOAuthUnavailable(RuntimeError):
    pass


class NativeOAuthCompletionUnknown(NativeOAuthUnavailable):
    """The exchange result write may have succeeded but cannot be verified."""


class NativeOAuthExchangePending(NativeOAuthUnavailable):
    """Another request is already completing this exchange."""


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


def exchange_result_key(code: str) -> str:
    return f"{handoff_key(code)}:result"


def exchange_pending_key(code: str) -> str:
    return f"{handoff_key(code)}:pending"


def exchange_session_id(code: str) -> str:
    """Return the stable login session id owned by one exchange code."""
    digest = hashlib.sha256(f"session\0{code}".encode("utf-8")).hexdigest()
    return f"native-{digest[:32]}"


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
        try:
            stored = redis_client.set(
                key,
                serialized,
                ex=NATIVE_OAUTH_HANDOFF_TTL_SECONDS,
                nx=True,
            )
        except Exception as exc:
            raise NativeOAuthUnavailable(
                "Native OAuth handoff store is unavailable"
            ) from exc
        if stored:
            return code
        raise NativeOAuthUnavailable("Native OAuth handoff could not be stored")
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        _memory_handoffs[key] = serialized
    return code


def _claim_handoff(code: str) -> tuple[int, bytes | str | None]:
    key = handoff_key(code)
    pending_key = exchange_pending_key(code)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            result = redis_client.eval(
                _CLAIM_HANDOFF_SCRIPT,
                2,
                key,
                pending_key,
                NATIVE_OAUTH_HANDOFF_TTL_SECONDS,
            )
        except Exception as exc:
            raise NativeOAuthUnavailable(
                "Native OAuth handoff store is unavailable"
            ) from exc
        status = int(result[0])
        raw = result[1] if len(result) > 1 else None
        return status, raw
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        if pending_key in _memory_handoffs:
            return 2, None
        raw = _memory_handoffs.pop(key, None)
        if raw is None:
            return 0, None
        _memory_handoffs[pending_key] = raw
        return 1, raw


def _clear_pending_handoff(code: str) -> None:
    key = exchange_pending_key(code)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.delete(key)
            return
        except Exception as exc:
            raise NativeOAuthUnavailable(
                "Native OAuth handoff store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        _memory_handoffs.pop(key, None)


def consume_handoff(*, code: str, state: str, verifier: str) -> NativeOAuthHandoff:
    status, raw = _claim_handoff(code)
    if status == 2:
        raise NativeOAuthExchangePending("Native OAuth exchange is already in progress")
    if status == 0 or raw is None:
        raise InvalidNativeOAuthHandoff("Native OAuth handoff is invalid or consumed")
    try:
        handoff = _deserialize(raw)
    except InvalidNativeOAuthHandoff:
        _clear_pending_handoff(code)
        raise
    now = datetime.now(timezone.utc)
    state_valid = secrets.compare_digest(handoff.state, state)
    challenge_valid = secrets.compare_digest(
        handoff.challenge,
        pkce_challenge(verifier),
    )
    if handoff.expires_at <= now or not state_valid or not challenge_valid:
        _clear_pending_handoff(code)
        raise InvalidNativeOAuthHandoff("Native OAuth handoff binding is invalid")
    return handoff


def restore_handoff(*, code: str, handoff: NativeOAuthHandoff) -> None:
    remaining_seconds = math.ceil(
        (handoff.expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    if remaining_seconds <= 0:
        return
    key = handoff_key(code)
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.set(key, serialized, ex=remaining_seconds, nx=True)
            redis_client.delete(exchange_pending_key(code))
            return
        except Exception as exc:
            raise NativeOAuthUnavailable(
                "Native OAuth handoff store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        _memory_handoffs.setdefault(key, serialized)
        _memory_handoffs.pop(exchange_pending_key(code), None)


def complete_exchange(
    *, code: str, handoff: NativeOAuthHandoff, payload: dict[str, object]
) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=NATIVE_OAUTH_RESULT_TTL_SECONDS
    )
    serialized = json.dumps(
        {
            "app_id": handoff.app_id,
            "state": handoff.state,
            "challenge": handoff.challenge,
            "expires_at": expires_at.isoformat(),
            "payload": payload,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    key = exchange_result_key(code)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            if redis_client.set(
                key,
                serialized,
                ex=NATIVE_OAUTH_RESULT_TTL_SECONDS,
            ):
                try:
                    redis_client.delete(exchange_pending_key(code))
                except Exception:
                    pass
                return
            raise NativeOAuthUnavailable(
                "Native OAuth exchange result could not be stored"
            )
        except NativeOAuthUnavailable:
            raise
        except Exception as exc:
            try:
                raw = redis_client.get(key)
            except Exception as verification_exc:
                raise NativeOAuthCompletionUnknown(
                    "Native OAuth exchange result could not be verified"
                ) from verification_exc
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            if isinstance(raw, str) and secrets.compare_digest(raw, serialized):
                return
            raise NativeOAuthUnavailable(
                "Native OAuth exchange result could not be stored"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
    with _memory_lock:
        _memory_handoffs[key] = serialized
        _memory_handoffs.pop(exchange_pending_key(code), None)


def get_completed_exchange(
    *, code: str, state: str, verifier: str, app_id: str
) -> dict[str, object] | None:
    key = exchange_result_key(code)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            raw = redis_client.get(key)
        except Exception as exc:
            raise NativeOAuthUnavailable(
                "Native OAuth handoff store is unavailable"
            ) from exc
    else:
        if not _local_memory_allowed():
            raise NativeOAuthUnavailable("Native OAuth handoff store is unavailable")
        with _memory_lock:
            raw = _memory_handoffs.get(key)
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        record = json.loads(raw)
        expires_at = datetime.fromisoformat(
            str(record["expires_at"]).replace("Z", "+00:00")
        )
        payload = record["payload"]
        valid = (
            isinstance(payload, dict)
            and expires_at > datetime.now(timezone.utc)
            and secrets.compare_digest(str(record["state"]), state)
            and secrets.compare_digest(
                str(record["challenge"]), pkce_challenge(verifier)
            )
            and secrets.compare_digest(str(record["app_id"]), app_id)
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        valid = False
        payload = None
    if not valid:
        raise InvalidNativeOAuthHandoff("Native OAuth exchange result is invalid")
    return payload
