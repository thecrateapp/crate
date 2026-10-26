from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import uuid

import jwt

from crate.auth import JWT_ALGORITHM, _get_jwt_secret
from crate.db.queries.playback_provenance import get_imported_track_source_node_uid

_PLAYBACK_AUDIENCE = "crate-playback"
_DEFAULT_LIFETIME = timedelta(hours=6)
_PLAYED_AT_LEEWAY = timedelta(minutes=5)
_CONTENT_ORIGINS = frozenset({"local", "remote", "imported"})


class PlaybackSessionInvalid(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class PlaybackSessionClaims:
    content_origin: str
    source_node_uid: str | None
    global_track_uid: str | None


def _normalized_uuid(value: str | None, *, field: str) -> str | None:
    if value is None:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError(f"Invalid {field}") from exc


def issue_playback_session(
    *,
    user_id: int,
    content_origin: str,
    source_node_uid: str | None = None,
    global_track_uid: str | None = None,
    lifetime: timedelta = _DEFAULT_LIFETIME,
) -> str:
    if content_origin not in _CONTENT_ORIGINS:
        raise ValueError("Invalid content origin")
    normalized_node = _normalized_uuid(source_node_uid, field="source node UID")
    normalized_track = _normalized_uuid(global_track_uid, field="global track UID")
    if content_origin == "remote" and normalized_node is None:
        raise ValueError("Remote playback requires a source node")
    if content_origin == "local" and normalized_node is not None:
        raise ValueError("Local playback cannot have a source node")

    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "aud": _PLAYBACK_AUDIENCE,
            "typ": "playback",
            "sub": str(user_id),
            "jti": str(uuid.uuid4()),
            "origin": content_origin,
            "source_node_uid": normalized_node,
            "global_track_uid": normalized_track,
            "iat": now,
            "exp": now + lifetime,
        },
        _get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


def _session_covers(payload: dict, played_at: datetime) -> bool:
    if played_at.tzinfo is None:
        played_at = played_at.replace(tzinfo=timezone.utc)
    issued, expires = payload.get("iat"), payload.get("exp")
    if not isinstance(issued, (int, float)) or not isinstance(expires, (int, float)):
        return False
    moment = played_at.timestamp()
    leeway = _PLAYED_AT_LEEWAY.total_seconds()
    return issued - leeway <= moment <= expires + leeway


def verify_playback_session(
    token: str,
    *,
    user_id: int,
    global_track_uid: str | None = None,
    played_at: datetime | None = None,
) -> PlaybackSessionClaims:
    """Verify a playback session, at ``played_at`` when the play is reported later.

    Clients queue play events offline and resend them for hours; the session
    must have been valid when the play started, not when it reaches the API.
    """
    try:
        payload = jwt.decode(
            token,
            _get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            audience=_PLAYBACK_AUDIENCE,
            options={"verify_exp": played_at is None},
        )
        if played_at is not None and not _session_covers(payload, played_at):
            raise PlaybackSessionInvalid("Playback session is invalid or expired")
        if payload.get("typ") != "playback" or payload.get("sub") != str(user_id):
            raise PlaybackSessionInvalid("Playback session subject mismatch")
        content_origin = str(payload.get("origin") or "")
        if content_origin not in _CONTENT_ORIGINS:
            raise PlaybackSessionInvalid("Playback session origin is invalid")
        source_node_uid = _normalized_uuid(
            payload.get("source_node_uid"), field="source node UID"
        )
        token_track_uid = _normalized_uuid(
            payload.get("global_track_uid"), field="global track UID"
        )
        expected_track_uid = _normalized_uuid(
            global_track_uid, field="global track UID"
        )
        if (
            token_track_uid
            and expected_track_uid
            and token_track_uid != expected_track_uid
        ):
            raise PlaybackSessionInvalid("Playback session track mismatch")
        if content_origin == "remote" and source_node_uid is None:
            raise PlaybackSessionInvalid("Remote playback source is missing")
        if content_origin == "local" and source_node_uid is not None:
            raise PlaybackSessionInvalid("Local playback source is invalid")
    except PlaybackSessionInvalid:
        raise
    except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
        raise PlaybackSessionInvalid("Playback session is invalid or expired") from exc

    return PlaybackSessionClaims(
        content_origin=content_origin,
        source_node_uid=source_node_uid,
        global_track_uid=token_track_uid,
    )


def resolve_local_content_provenance(track_id: int | None) -> tuple[str, str | None]:
    if track_id is None:
        return "local", None
    source_node_uid = get_imported_track_source_node_uid(track_id)
    if source_node_uid:
        return "imported", source_node_uid
    return "local", None


__all__ = [
    "PlaybackSessionClaims",
    "PlaybackSessionInvalid",
    "issue_playback_session",
    "resolve_local_content_provenance",
    "verify_playback_session",
]
