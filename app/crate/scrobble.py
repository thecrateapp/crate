"""Direct scrobbling to Last.fm and ListenBrainz.

Called from record_play_event after a play that Last.fm would count.
Each service requires user-level credentials stored in user_external_identities.
"""

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass

import requests

from crate.db.jobs.scrobble_dispatch import (
    claim_scrobble_dispatch,
    finish_scrobble_dispatch,
)

log = logging.getLogger(__name__)

ACCEPTED = "accepted"
IGNORED = "ignored"
RETRYABLE = "retryable"
FAILED = "failed"
NOT_CONFIGURED = "not_configured"

# Last.fm error codes worth retrying: service offline, temporarily unavailable
# and rate limit exceeded. Every other code needs a user or operator fix.
_LASTFM_RETRYABLE_ERRORS = {11, 16, 29}
_LASTFM_INVALID_SESSION = 9
_TERMINAL_OUTCOMES = frozenset({ACCEPTED, IGNORED, NOT_CONFIGURED})


@dataclass(frozen=True)
class ScrobbleResult:
    outcome: str
    detail: str = ""

    def as_json(self) -> dict:
        return {"outcome": self.outcome, "detail": self.detail}


def _int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _lastfm_scrobble_result(status_code: int, data: object) -> ScrobbleResult:
    if isinstance(data, dict) and "error" in data:
        code = _int(data.get("error"))
        if code in _LASTFM_RETRYABLE_ERRORS:
            return ScrobbleResult(RETRYABLE, f"lastfm error {code}")
        return ScrobbleResult(FAILED, f"lastfm error {code}")
    if status_code == 429 or status_code >= 500:
        return ScrobbleResult(RETRYABLE, f"http {status_code}")
    if status_code != 200 or not isinstance(data, dict):
        return ScrobbleResult(FAILED, f"http {status_code}")
    scrobbles = data.get("scrobbles") or {}
    attr = scrobbles.get("@attr") or {}
    if _int(attr.get("accepted")) > 0:
        return ScrobbleResult(ACCEPTED)
    if _int(attr.get("ignored")) > 0:
        entry = scrobbles.get("scrobble")
        if isinstance(entry, list):
            entry = entry[0] if entry else {}
        ignored = (entry or {}).get("ignoredMessage") or {}
        return ScrobbleResult(IGNORED, f"lastfm ignored {_int(ignored.get('code'))}")
    return ScrobbleResult(RETRYABLE, "lastfm response without a scrobble count")


LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
LISTENBRAINZ_API_URL = "https://api.listenbrainz.org/1/submit-listens"


# ── Last.fm ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class LastfmSession:
    key: str
    username: str | None = None
    subscriber: bool | None = None


class LastfmAuthenticationError(RuntimeError):
    def __init__(self, *, retryable: bool) -> None:
        super().__init__("Last.fm authentication could not be completed")
        self.retryable = retryable


def _lastfm_message_for_log(message: object, secrets: tuple[str, ...]) -> str:
    if not isinstance(message, str) or not message.strip():
        return "unavailable"

    sanitized = re.sub(r"\s+", " ", message[:512]).strip()
    for secret in secrets:
        if secret:
            sanitized = sanitized.replace(secret, "[redacted]")
    return sanitized[:160] or "unavailable"


def lastfm_get_auth_token(api_key: str, api_secret: str) -> str | None:
    """Create a short-lived Last.fm desktop authorization token."""
    if not api_key or not api_secret:
        return None

    params = {"method": "auth.getToken", "api_key": api_key}
    sig_str = "".join(f"{key}{value}" for key, value in sorted(params.items()))
    params["api_sig"] = hashlib.md5(
        f"{sig_str}{api_secret}".encode(), usedforsecurity=False
    ).hexdigest()
    params["format"] = "json"

    try:
        response = requests.get(LASTFM_API_URL, params=params, timeout=10)
        data = response.json() if response.content else {}
        raw_error = data.get("error")
        safe_error = _lastfm_message_for_log(
            str(raw_error)
            if isinstance(raw_error, (int, str)) and not isinstance(raw_error, bool)
            else None,
            (api_key, api_secret),
        )
        response_token = data.get("token")
        secrets = (api_key, api_secret) + (
            (response_token,) if isinstance(response_token, str) else ()
        )
        safe_message = _lastfm_message_for_log(data.get("message"), secrets)
        token = data.get("token") if response.status_code == 200 else None
        if isinstance(token, str) and re.fullmatch(r"[a-fA-F0-9]{32}", token):
            return token
        log.warning(
            "Last.fm auth.getToken failed: status=%s error=%s message=%s",
            response.status_code,
            safe_error,
            safe_message,
        )
    except Exception as exc:
        log.warning("Last.fm auth.getToken failed: failure_type=%s", type(exc).__name__)
    return None


def lastfm_scrobble(
    *,
    api_key: str,
    api_secret: str,
    session_key: str,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
) -> ScrobbleResult:
    """Scrobble a track to Last.fm using a user's session key."""
    if not all([api_key, api_secret, session_key, artist, track]):
        return ScrobbleResult(FAILED, "missing scrobble fields")

    ts = timestamp or int(time.time())
    params = {
        "method": "track.scrobble",
        "api_key": api_key,
        "sk": session_key,
        "artist": artist,
        "track": track,
        "timestamp": str(ts),
    }
    if album:
        params["album"] = album

    # Generate API signature: md5 of sorted params + secret
    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(
        sig_str.encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    params["format"] = "json"

    try:
        resp = requests.post(LASTFM_API_URL, data=params, timeout=10)
    except requests.RequestException as exc:
        log.warning("Last.fm scrobble transport error: %s", type(exc).__name__)
        return ScrobbleResult(RETRYABLE, f"transport {type(exc).__name__}")
    try:
        data = resp.json() if resp.content else None
    except ValueError:
        data = None
    result = _lastfm_scrobble_result(resp.status_code, data)
    if result.outcome != ACCEPTED:
        log.warning("Last.fm scrobble %s: %s", result.outcome, result.detail)
    return result


def lastfm_now_playing(
    *,
    api_key: str,
    api_secret: str,
    session_key: str,
    artist: str,
    track: str,
    album: str = "",
) -> bool:
    """Update Last.fm 'Now Playing' status."""
    if not all([api_key, api_secret, session_key, artist, track]):
        return False

    params = {
        "method": "track.updateNowPlaying",
        "api_key": api_key,
        "sk": session_key,
        "artist": artist,
        "track": track,
    }
    if album:
        params["album"] = album

    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(
        sig_str.encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    params["format"] = "json"

    try:
        resp = requests.post(LASTFM_API_URL, data=params, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


def lastfm_get_session(
    api_key: str, api_secret: str, auth_token: str
) -> LastfmSession | None:
    """Exchange a Last.fm auth token for a session key."""
    try:
        return lastfm_get_session_strict(api_key, api_secret, auth_token)
    except LastfmAuthenticationError:
        return None


def lastfm_get_session_strict(
    api_key: str, api_secret: str, auth_token: str
) -> LastfmSession:
    """Exchange a Last.fm auth token and preserve retryable failure details."""
    if not api_key or not api_secret or not auth_token:
        log.warning(
            "Last.fm auth.getSession failed: status=not-requested "
            "error=not-requested message=missing credentials retryable=false"
        )
        raise LastfmAuthenticationError(retryable=False)

    params = {
        "method": "auth.getSession",
        "api_key": api_key,
        "token": auth_token,
    }
    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(
        sig_str.encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    params["format"] = "json"

    resp = None
    try:
        resp = requests.get(LASTFM_API_URL, params=params, timeout=10)
        data = resp.json() if resp.content else {}
        if resp.status_code == 200 and data.get("session", {}).get("key"):
            session = data["session"]
            return LastfmSession(
                key=session["key"],
                username=session.get("name") or None,
                subscriber=bool(int(session["subscriber"]))
                if str(session.get("subscriber", "")).isdigit()
                else None,
            )
        raw_error_code = data.get("error")
        if isinstance(raw_error_code, bool) or not isinstance(
            raw_error_code, (int, str)
        ):
            error_code = None
        else:
            try:
                error_code = int(raw_error_code)
            except ValueError:
                error_code = None
        retryable_http_status = (
            resp.status_code in {408, 429} or resp.status_code >= 500
        )
        unclassified_success = 200 <= resp.status_code < 300 and error_code is None
        retryable = (
            retryable_http_status
            or unclassified_success
            or error_code
            in {
                8,
                11,
                14,
                16,
                29,
            }
        )
        safe_message = _lastfm_message_for_log(
            data.get("message"), (api_key, api_secret, auth_token)
        )
        log.warning(
            "Last.fm auth.getSession failed: status=%s error=%s "
            "message=%s retryable=%s",
            resp.status_code,
            error_code,
            safe_message,
            retryable,
        )
        raise LastfmAuthenticationError(retryable=retryable)
    except LastfmAuthenticationError:
        raise
    except Exception as exc:
        log.warning(
            "Last.fm auth.getSession failed: status=%s error=unknown "
            "message=unavailable failure_type=%s retryable=true",
            getattr(resp, "status_code", "unknown"),
            type(exc).__name__,
        )
        raise LastfmAuthenticationError(retryable=True) from exc


# ── ListenBrainz ────────────────────────────────────────────────


def listenbrainz_scrobble(
    *,
    token: str,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
) -> ScrobbleResult:
    """Submit a listen to ListenBrainz."""
    if not all([token, artist, track]):
        return ScrobbleResult(FAILED, "missing scrobble fields")

    ts = timestamp or int(time.time())
    payload = {
        "listen_type": "single",
        "payload": [
            {
                "listened_at": ts,
                "track_metadata": {
                    "artist_name": artist,
                    "track_name": track,
                    **({"release_name": album} if album else {}),
                },
            }
        ],
    }

    try:
        resp = requests.post(
            LISTENBRAINZ_API_URL,
            json=payload,
            headers={"Authorization": f"Token {token}"},
            timeout=10,
        )
    except requests.RequestException as exc:
        log.warning("ListenBrainz submit transport error: %s", type(exc).__name__)
        return ScrobbleResult(RETRYABLE, f"transport {type(exc).__name__}")
    if resp.status_code == 200:
        return ScrobbleResult(ACCEPTED)
    if resp.status_code == 429 or resp.status_code >= 500:
        result = ScrobbleResult(RETRYABLE, f"http {resp.status_code}")
    else:
        result = ScrobbleResult(FAILED, f"http {resp.status_code}")
    log.warning("ListenBrainz submit %s: %s", result.outcome, result.detail)
    return result


def listenbrainz_now_playing(
    *,
    token: str,
    artist: str,
    track: str,
    album: str = "",
) -> bool:
    """Submit 'playing now' to ListenBrainz."""
    if not all([token, artist, track]):
        return False

    payload = {
        "listen_type": "playing_now",
        "payload": [
            {
                "track_metadata": {
                    "artist_name": artist,
                    "track_name": track,
                    **({"release_name": album} if album else {}),
                },
            }
        ],
    }

    try:
        resp = requests.post(
            LISTENBRAINZ_API_URL,
            json=payload,
            headers={"Authorization": f"Token {token}"},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        return False


# ── Dispatcher ──────────────────────────────────────────────────


def _mark_lastfm_session_rejected(user_id: int) -> None:
    from crate.db.repositories.auth_identities import upsert_user_external_identity

    upsert_user_external_identity(
        user_id,
        "lastfm",
        status="error",
        last_error="Last.fm rejected the stored session; reconnect to resume scrobbling",
    )


def _identity_metadata(identity: dict) -> dict | None:
    raw_meta = identity.get("metadata_json")
    if not isinstance(raw_meta, str):
        return raw_meta or {}
    try:
        metadata = json.loads(raw_meta)
    except (json.JSONDecodeError, ValueError):
        return None
    return metadata if isinstance(metadata, dict) else None


def scrobble_play_event(
    user_id: int,
    *,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
    done: frozenset[str] = frozenset(),
) -> dict[str, ScrobbleResult]:
    """Submit one play to every linked provider not in ``done``.

    Provider failures are returned, not raised, so the caller can retry only
    the providers that did not reach a terminal outcome.
    """
    import os
    from crate.db.queries.user import get_user_scrobble_identities

    results: dict[str, ScrobbleResult] = {}
    for identity in get_user_scrobble_identities(user_id):
        provider = identity["provider"]
        if provider in done:
            continue
        metadata = _identity_metadata(identity)
        if metadata is None:
            log.warning(
                "Corrupted metadata_json for user %s provider %s", user_id, provider
            )
            results[provider] = ScrobbleResult(FAILED, "corrupted credentials")
            continue

        if provider == "lastfm":
            api_key = os.environ.get("LASTFM_APIKEY", "")
            api_secret = os.environ.get("LASTFM_API_SECRET", "")
            session_key = metadata.get("session_key", "")
            if not (api_key and api_secret):
                results[provider] = ScrobbleResult(
                    NOT_CONFIGURED, "Last.fm API credentials are not configured"
                )
            elif not session_key:
                results[provider] = ScrobbleResult(FAILED, "missing session key")
            else:
                result = lastfm_scrobble(
                    api_key=api_key,
                    api_secret=api_secret,
                    session_key=session_key,
                    artist=artist,
                    track=track,
                    album=album,
                    timestamp=timestamp,
                )
                if result.detail == f"lastfm error {_LASTFM_INVALID_SESSION}":
                    _mark_lastfm_session_rejected(user_id)
                results[provider] = result

        elif provider == "listenbrainz":
            lb_token = metadata.get("token", "")
            results[provider] = (
                listenbrainz_scrobble(
                    token=lb_token,
                    artist=artist,
                    track=track,
                    album=album,
                    timestamp=timestamp,
                )
                if lb_token
                else ScrobbleResult(FAILED, "missing token")
            )

    return results


class ScrobbleRetryError(RuntimeError):
    """A provider may accept the scrobble later; Dramatiq retries the dispatch."""


def _claim_scrobble_dispatch(event_id: int) -> tuple[str, dict | None]:
    return claim_scrobble_dispatch(event_id)


def _finish_scrobble_dispatch(
    event_id: int,
    status: str,
    *,
    error: str | None = None,
    provider_results: dict | None = None,
) -> None:
    finish_scrobble_dispatch(
        event_id, status, error=error, provider_results=provider_results
    )


def _results_summary(results: dict[str, dict]) -> str:
    return "; ".join(
        f"{provider}: {result['outcome']}"
        + (f" ({result['detail']})" if result.get("detail") else "")
        for provider, result in sorted(results.items())
        if result.get("outcome") != ACCEPTED
    )


def dispatch_scrobble_play_event(event_id: int) -> str:
    """Dispatch one play event, retrying only providers without a final answer.

    The dispatch is ``completed`` only when a provider accepted the scrobble.
    Providers that accepted or ignored it are never sent the event again, so a
    retry for another provider cannot duplicate it.
    """
    status, event = _claim_scrobble_dispatch(event_id)
    if event is None:
        return status

    if event["content_origin"] == "remote" and not event["remote_scrobbling_enabled"]:
        _finish_scrobble_dispatch(event_id, "skipped")
        return "skipped"

    previous: dict[str, dict] = dict(event.get("provider_results") or {})
    done = frozenset(
        provider
        for provider, result in previous.items()
        if result.get("outcome") in _TERMINAL_OUTCOMES
    )
    started_at = event.get("started_at")
    timestamp = int(started_at.timestamp()) if started_at is not None else None
    try:
        results = scrobble_play_event(
            int(event["user_id"]),
            artist=str(event.get("artist") or ""),
            track=str(event.get("title") or ""),
            album=str(event.get("album") or ""),
            timestamp=timestamp,
            done=done,
        )
    except Exception as exc:
        _finish_scrobble_dispatch(event_id, "failed", error=str(exc)[:1000])
        raise

    merged = {
        **previous,
        **{provider: result.as_json() for provider, result in results.items()},
    }
    outcomes = {result.get("outcome") for result in merged.values()}
    summary = _results_summary(merged) or None
    if RETRYABLE in outcomes:
        _finish_scrobble_dispatch(
            event_id, "failed", error=summary, provider_results=merged
        )
        raise ScrobbleRetryError(summary or "retryable scrobble failure")
    if FAILED in outcomes:
        _finish_scrobble_dispatch(
            event_id, "failed", error=summary, provider_results=merged
        )
        return "failed"
    if ACCEPTED in outcomes:
        _finish_scrobble_dispatch(
            event_id, "completed", error=summary, provider_results=merged
        )
        return "completed"
    _finish_scrobble_dispatch(
        event_id, "skipped", error=summary, provider_results=merged
    )
    return "skipped"
