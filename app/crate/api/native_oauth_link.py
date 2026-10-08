"""Short lived, session-bound staged identities for native OAuth linking."""

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
import time
from typing import Literal

from crate.api.native_auth_store import (
    local_memory_allowed as _local_memory_allowed,
    purge_expired_memory_records,
)

NATIVE_OAUTH_LINK_TTL_SECONDS = 15 * 60
NATIVE_OAUTH_LINK_CLAIM_TTL_SECONDS = 90
_LINK_PREFIX = "crate:auth:native_oauth_link"
_CLAIM_LINK_SCRIPT = """
local completed = redis.call('GET', KEYS[3])
if completed then
  return {3, completed}
end
local pending = redis.call('GET', KEYS[2])
if pending then
  local handoff = redis.call('GET', KEYS[1])
  if handoff then
    return {2, handoff}
  end
  local is_legacy_handoff = pcall(cjson.decode, pending)
  if not is_legacy_handoff then
    return {0}
  end
  local pending_ttl = redis.call('TTL', KEYS[2])
  if pending_ttl > 0
    and pending_ttl < tonumber(ARGV[2]) - tonumber(ARGV[1]) then
    redis.call('SET', KEYS[1], pending, 'EX', pending_ttl)
    redis.call('SET', KEYS[2], 'claimed', 'EX', ARGV[1])
    return {1, pending}
  end
  return {2, pending}
end
local handoff = redis.call('GET', KEYS[1])
if not handoff then
  return {0}
end
redis.call('SET', KEYS[2], 'claimed', 'EX', ARGV[1])
return {1, handoff}
"""
_memory_links: dict[str, str] = {}
_memory_lock = RLock()


class NativeOAuthLinkUnavailable(RuntimeError):
    pass


class InvalidNativeOAuthLink(ValueError):
    pass


@dataclass(frozen=True)
class NativeOAuthLinkHandoff:
    user_id: int
    session_id: str
    provider: str
    external_user_id: str
    external_username: str | None
    app_id: str
    state: str
    challenge: str
    expires_at: datetime


def _digest(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _claim_now() -> float:
    return time.monotonic()


def link_handoff_key(code: str) -> str:
    return f"{_LINK_PREFIX}:{_digest(code)}"


def _pending_key(code: str) -> str:
    return f"{link_handoff_key(code)}:pending"


def _result_key(code: str) -> str:
    return f"{link_handoff_key(code)}:result"


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _redis_client():
    if not os.environ.get("REDIS_URL"):
        return None
    try:
        from crate.db.cache_runtime import get_redis

        return get_redis()
    except Exception:
        return None


def _serialize(handoff: NativeOAuthLinkHandoff) -> str:
    payload = asdict(handoff)
    payload["expires_at"] = handoff.expires_at.isoformat()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _deserialize(raw: bytes | str) -> NativeOAuthLinkHandoff:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        payload = json.loads(raw)
        expires_at = datetime.fromisoformat(
            str(payload["expires_at"]).replace("Z", "+00:00")
        )
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        handoff = NativeOAuthLinkHandoff(
            user_id=int(payload["user_id"]),
            session_id=str(payload["session_id"]),
            provider=str(payload["provider"]),
            external_user_id=str(payload["external_user_id"]),
            external_username=(
                str(payload["external_username"])
                if payload.get("external_username") is not None
                else None
            ),
            app_id=str(payload["app_id"]),
            state=str(payload["state"]),
            challenge=str(payload["challenge"]),
            expires_at=expires_at,
        )
        if handoff.provider not in {"google", "apple"}:
            raise ValueError("invalid provider")
        return handoff
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InvalidNativeOAuthLink("Invalid native OAuth link handoff") from exc


def issue_link_handoff(
    *,
    user_id: int,
    session_id: str,
    provider: str,
    external_user_id: str,
    external_username: str | None,
    app_id: str,
    state: str,
    challenge: str,
) -> str:
    code = secrets.token_urlsafe(32)
    handoff = NativeOAuthLinkHandoff(
        user_id=user_id,
        session_id=session_id,
        provider=provider,
        external_user_id=external_user_id,
        external_username=external_username,
        app_id=app_id,
        state=state,
        challenge=challenge,
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=NATIVE_OAUTH_LINK_TTL_SECONDS),
    )
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            stored = redis_client.set(
                link_handoff_key(code),
                serialized,
                ex=NATIVE_OAUTH_LINK_TTL_SECONDS,
                nx=True,
            )
        except Exception as exc:
            raise NativeOAuthLinkUnavailable(
                "Native OAuth link store is unavailable"
            ) from exc
        if stored:
            return code
        raise NativeOAuthLinkUnavailable("Native OAuth link could not be stored")
    if not _local_memory_allowed():
        raise NativeOAuthLinkUnavailable("Native OAuth link store is unavailable")
    with _memory_lock:
        purge_expired_memory_records(_memory_links, monotonic_now=_claim_now())
        _memory_links[link_handoff_key(code)] = serialized
    return code


def claim_link_handoff(
    *,
    code: str,
    state: str,
    verifier: str,
    app_id: str,
    user_id: int,
    session_id: str,
) -> tuple[Literal["claimed", "in_progress", "completed"], NativeOAuthLinkHandoff]:
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            result = redis_client.eval(
                _CLAIM_LINK_SCRIPT,
                3,
                link_handoff_key(code),
                _pending_key(code),
                _result_key(code),
                NATIVE_OAUTH_LINK_CLAIM_TTL_SECONDS,
                NATIVE_OAUTH_LINK_TTL_SECONDS,
            )
        except Exception as exc:
            raise NativeOAuthLinkUnavailable(
                "Native OAuth link store is unavailable"
            ) from exc
        status = int(result[0])
        raw = result[1] if len(result) > 1 else None
    else:
        if not _local_memory_allowed():
            raise NativeOAuthLinkUnavailable("Native OAuth link store is unavailable")
        key = link_handoff_key(code)
        pending_key = _pending_key(code)
        result_key = _result_key(code)
        with _memory_lock:
            purge_expired_memory_records(_memory_links, monotonic_now=_claim_now())
            if result_key in _memory_links:
                status, raw = 3, _memory_links[result_key]
            else:
                raw = _memory_links.get(key)
                pending_until = _memory_links.get(pending_key)
                try:
                    claim_is_active = (
                        pending_until is not None
                        and float(pending_until) > _claim_now()
                    )
                except ValueError:
                    claim_is_active = False
                if raw is None:
                    status = 0
                elif claim_is_active:
                    status = 2
                else:
                    status = 1
                    _memory_links[pending_key] = str(
                        _claim_now() + NATIVE_OAUTH_LINK_CLAIM_TTL_SECONDS
                    )

    if status == 0 or raw is None:
        raise InvalidNativeOAuthLink("Native OAuth link is invalid or expired")
    handoff = _deserialize(raw)
    valid = (
        handoff.expires_at > datetime.now(timezone.utc)
        and handoff.provider in {"google", "apple"}
        and secrets.compare_digest(handoff.state, state)
        and secrets.compare_digest(handoff.app_id, app_id)
        and secrets.compare_digest(handoff.session_id, session_id)
        and handoff.user_id == user_id
        and secrets.compare_digest(handoff.challenge, _pkce_challenge(verifier))
    )
    if not valid:
        if status == 1:
            restore_link_handoff(code=code, handoff=handoff)
        raise InvalidNativeOAuthLink("Native OAuth link binding is invalid")
    if status == 1:
        return "claimed", handoff
    if status == 2:
        return "in_progress", handoff
    if status == 3:
        return "completed", handoff
    raise InvalidNativeOAuthLink("Native OAuth link is invalid or expired")


def restore_link_handoff(*, code: str, handoff: NativeOAuthLinkHandoff) -> None:
    remaining = math.ceil(
        (handoff.expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    if remaining <= 0:
        return
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.set(link_handoff_key(code), serialized, ex=remaining, nx=True)
            redis_client.delete(_pending_key(code))
            return
        except Exception as exc:
            raise NativeOAuthLinkUnavailable(
                "Native OAuth link store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthLinkUnavailable("Native OAuth link store is unavailable")
    with _memory_lock:
        purge_expired_memory_records(_memory_links, monotonic_now=_claim_now())
        result_key = _result_key(code)
        if result_key not in _memory_links:
            _memory_links.setdefault(link_handoff_key(code), serialized)
        _memory_links.pop(_pending_key(code), None)


def complete_link_handoff(*, code: str, handoff: NativeOAuthLinkHandoff) -> None:
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.set(
                _result_key(code),
                serialized,
                ex=NATIVE_OAUTH_LINK_TTL_SECONDS,
            )
            redis_client.delete(link_handoff_key(code), _pending_key(code))
            return
        except Exception as exc:
            try:
                stored = redis_client.get(_result_key(code))
            except Exception as verify_exc:
                raise NativeOAuthLinkUnavailable(
                    "Native OAuth link completion could not be verified"
                ) from verify_exc
            if stored == serialized or stored == serialized.encode("utf-8"):
                return
            raise NativeOAuthLinkUnavailable(
                "Native OAuth link completion could not be stored"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthLinkUnavailable("Native OAuth link store is unavailable")
    with _memory_lock:
        purge_expired_memory_records(_memory_links, monotonic_now=_claim_now())
        _memory_links[_result_key(code)] = serialized
        _memory_links.pop(link_handoff_key(code), None)
        _memory_links.pop(_pending_key(code), None)


def discard_link_handoff(code: str) -> None:
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.delete(link_handoff_key(code), _pending_key(code))
            return
        except Exception as exc:
            raise NativeOAuthLinkUnavailable(
                "Native OAuth link store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeOAuthLinkUnavailable("Native OAuth link store is unavailable")
    with _memory_lock:
        purge_expired_memory_records(_memory_links, monotonic_now=_claim_now())
        _memory_links.pop(link_handoff_key(code), None)
        _memory_links.pop(_pending_key(code), None)
