"""Short-lived, session-bound Last.fm authorization state for Tauri."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import secrets
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Literal

NATIVE_LASTFM_LINK_TTL_SECONDS = 55 * 60
_LINK_PREFIX = "crate:auth:native_lastfm_link"
_CLAIM_SCRIPT = """
local completed = redis.call('GET', KEYS[3])
if completed then
  return {3, completed}
end
local pending = redis.call('GET', KEYS[2])
if pending then
  return {2, pending}
end
local handoff = redis.call('GET', KEYS[1])
if not handoff then
  return {0}
end
redis.call('SET', KEYS[2], handoff, 'EX', ARGV[1])
redis.call('DEL', KEYS[1])
return {1, handoff}
"""
_SAVE_RESOLVED_SCRIPT = """
if not redis.call('GET', KEYS[1]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
"""
_RESTORE_SCRIPT = """
if redis.call('GET', KEYS[3]) then
  redis.call('DEL', KEYS[2])
  return 0
end
local handoff = redis.call('GET', KEYS[2])
if not handoff then
  return 0
end
redis.call('SET', KEYS[1], handoff, 'EX', ARGV[1], 'NX')
redis.call('DEL', KEYS[2])
return 1
"""
_memory_links: dict[str, str] = {}
_memory_lock = RLock()


class NativeLastfmLinkUnavailable(RuntimeError):
    """The short-lived native Last.fm handoff store cannot be reached."""


class InvalidNativeLastfmLink(ValueError):
    """The handoff is expired or does not match the initiating flow."""


@dataclass(frozen=True)
class NativeLastfmLinkHandoff:
    user_id: int
    session_id: str
    state: str
    challenge: str
    provider_token: str | None
    expires_at: datetime
    session_key: str | None = None
    username: str | None = None
    subscriber: bool | None = None


def _digest(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


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


def _local_memory_allowed() -> bool:
    environment = os.environ.get("CRATE_ENV", "").strip().lower()
    domain = os.environ.get("DOMAIN", "localhost").strip().lower()
    return environment in {"dev", "development", "test"} or domain in {
        "localhost",
        "127.0.0.1",
    }


def _serialize(handoff: NativeLastfmLinkHandoff) -> str:
    payload = asdict(handoff)
    payload["expires_at"] = handoff.expires_at.isoformat()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _deserialize(raw: bytes | str) -> NativeLastfmLinkHandoff:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        payload = json.loads(raw)
        expires_at = datetime.fromisoformat(
            str(payload["expires_at"]).replace("Z", "+00:00")
        )
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        handoff = NativeLastfmLinkHandoff(
            user_id=int(payload["user_id"]),
            session_id=str(payload["session_id"]),
            state=str(payload["state"]),
            challenge=str(payload["challenge"]),
            provider_token=(
                str(payload["provider_token"])
                if payload.get("provider_token") is not None
                else None
            ),
            expires_at=expires_at,
            session_key=(
                str(payload["session_key"])
                if payload.get("session_key") is not None
                else None
            ),
            username=(
                str(payload["username"])
                if payload.get("username") is not None
                else None
            ),
            subscriber=(
                bool(payload["subscriber"])
                if payload.get("subscriber") is not None
                else None
            ),
        )
        if not handoff.session_id or not handoff.state or not handoff.challenge:
            raise ValueError("missing native Last.fm binding")
        if (
            not handoff.provider_token
            and not handoff.session_key
            and not handoff.username
        ):
            raise ValueError("missing Last.fm credential")
        return handoff
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InvalidNativeLastfmLink("Invalid native Last.fm handoff") from exc


def issue_link_handoff(
    *,
    user_id: int,
    session_id: str,
    state: str,
    challenge: str,
    provider_token: str,
) -> str:
    code = secrets.token_urlsafe(32)
    handoff = NativeLastfmLinkHandoff(
        user_id=user_id,
        session_id=session_id,
        state=state,
        challenge=challenge,
        provider_token=provider_token,
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=NATIVE_LASTFM_LINK_TTL_SECONDS),
    )
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            stored = redis_client.set(
                link_handoff_key(code),
                serialized,
                ex=NATIVE_LASTFM_LINK_TTL_SECONDS,
                nx=True,
            )
        except Exception as exc:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            ) from exc
        if stored:
            return code
        raise NativeLastfmLinkUnavailable("Native Last.fm link could not be stored")
    if not _local_memory_allowed():
        raise NativeLastfmLinkUnavailable("Native Last.fm link store is unavailable")
    with _memory_lock:
        _memory_links[link_handoff_key(code)] = serialized
    return code


def _validate_handoff(
    handoff: NativeLastfmLinkHandoff,
    *,
    state: str,
    verifier: str,
    user_id: int,
    session_id: str,
) -> bool:
    try:
        challenge = _pkce_challenge(verifier)
    except (UnicodeEncodeError, ValueError):
        return False
    return (
        handoff.expires_at > datetime.now(timezone.utc)
        and secrets.compare_digest(handoff.state, state)
        and secrets.compare_digest(handoff.session_id, session_id)
        and handoff.user_id == user_id
        and secrets.compare_digest(handoff.challenge, challenge)
    )


def claim_link_handoff(
    *,
    code: str,
    state: str,
    verifier: str,
    user_id: int,
    session_id: str,
) -> tuple[Literal["claimed", "in_progress", "completed"], NativeLastfmLinkHandoff]:
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            result = redis_client.eval(
                _CLAIM_SCRIPT,
                3,
                link_handoff_key(code),
                _pending_key(code),
                _result_key(code),
                NATIVE_LASTFM_LINK_TTL_SECONDS,
            )
        except Exception as exc:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            ) from exc
        status = int(result[0])
        raw = result[1] if len(result) > 1 else None
    else:
        if not _local_memory_allowed():
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            )
        key = link_handoff_key(code)
        pending_key = _pending_key(code)
        result_key = _result_key(code)
        with _memory_lock:
            if result_key in _memory_links:
                status, raw = 3, _memory_links[result_key]
            elif pending_key in _memory_links:
                status, raw = 2, _memory_links[pending_key]
            elif key in _memory_links:
                status, raw = 1, _memory_links.pop(key)
                _memory_links[pending_key] = raw
            else:
                status, raw = 0, None

    if status == 0 or raw is None:
        raise InvalidNativeLastfmLink("Native Last.fm link is invalid or expired")
    handoff = _deserialize(raw)
    if not _validate_handoff(
        handoff,
        state=state,
        verifier=verifier,
        user_id=user_id,
        session_id=session_id,
    ):
        if status == 1:
            restore_link_handoff(code=code, handoff=handoff)
        raise InvalidNativeLastfmLink("Native Last.fm link binding is invalid")
    if status == 1:
        return "claimed", handoff
    if status == 2:
        return "in_progress", handoff
    if status == 3:
        return "completed", handoff
    raise InvalidNativeLastfmLink("Native Last.fm link is invalid or expired")


def save_resolved_session(
    *,
    code: str,
    handoff: NativeLastfmLinkHandoff,
    session_key: str,
    username: str,
    subscriber: bool | None,
) -> NativeLastfmLinkHandoff:
    remaining = math.ceil(
        (handoff.expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    if remaining <= 0:
        raise NativeLastfmLinkUnavailable(
            "Native Last.fm link expired during completion"
        )
    resolved = replace(
        handoff,
        provider_token=None,
        session_key=session_key,
        username=username,
        subscriber=subscriber,
    )
    serialized = _serialize(resolved)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            saved = redis_client.eval(
                _SAVE_RESOLVED_SCRIPT,
                1,
                _pending_key(code),
                serialized,
                remaining,
            )
        except Exception as exc:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            ) from exc
        if saved:
            return resolved
        raise NativeLastfmLinkUnavailable(
            "Native Last.fm link expired during completion"
        )
    if not _local_memory_allowed():
        raise NativeLastfmLinkUnavailable("Native Last.fm link store is unavailable")
    with _memory_lock:
        key = _pending_key(code)
        if key not in _memory_links:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link expired during completion"
            )
        _memory_links[key] = serialized
    return resolved


def restore_link_handoff(*, code: str, handoff: NativeLastfmLinkHandoff) -> None:
    remaining = math.ceil(
        (handoff.expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    if remaining <= 0:
        return
    serialized = _serialize(handoff)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.eval(
                _RESTORE_SCRIPT,
                3,
                link_handoff_key(code),
                _pending_key(code),
                _result_key(code),
                remaining,
            )
            return
        except Exception as exc:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeLastfmLinkUnavailable("Native Last.fm link store is unavailable")
    with _memory_lock:
        pending_key = _pending_key(code)
        result_key = _result_key(code)
        if pending_key not in _memory_links or result_key in _memory_links:
            return
        _memory_links.setdefault(link_handoff_key(code), serialized)
        _memory_links.pop(pending_key, None)


def complete_link_handoff(
    *, code: str, handoff: NativeLastfmLinkHandoff
) -> NativeLastfmLinkHandoff:
    result = replace(handoff, provider_token=None, session_key=None)
    serialized = _serialize(result)
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.set(
                _result_key(code),
                serialized,
                ex=NATIVE_LASTFM_LINK_TTL_SECONDS,
            )
            redis_client.delete(link_handoff_key(code), _pending_key(code))
            return result
        except Exception as exc:
            try:
                stored = redis_client.get(_result_key(code))
            except Exception as verify_exc:
                raise NativeLastfmLinkUnavailable(
                    "Native Last.fm link completion could not be verified"
                ) from verify_exc
            if stored == serialized or stored == serialized.encode("utf-8"):
                return result
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link completion could not be stored"
            ) from exc
    if not _local_memory_allowed():
        raise NativeLastfmLinkUnavailable("Native Last.fm link store is unavailable")
    with _memory_lock:
        _memory_links[_result_key(code)] = serialized
        _memory_links.pop(link_handoff_key(code), None)
        _memory_links.pop(_pending_key(code), None)
    return result


def discard_link_handoff(code: str) -> None:
    redis_client = _redis_client()
    if redis_client is not None:
        try:
            redis_client.delete(
                link_handoff_key(code), _pending_key(code), _result_key(code)
            )
            return
        except Exception as exc:
            raise NativeLastfmLinkUnavailable(
                "Native Last.fm link store is unavailable"
            ) from exc
    if not _local_memory_allowed():
        raise NativeLastfmLinkUnavailable("Native Last.fm link store is unavailable")
    with _memory_lock:
        _memory_links.pop(link_handoff_key(code), None)
        _memory_links.pop(_pending_key(code), None)
        _memory_links.pop(_result_key(code), None)
