"""OAuth from Admin for Google Drive and Dropbox destinations (admin backups, BK2).

The flow follows ``crate.api.native_oauth``: a one-time state bound to the admin
who started it, kept server-side with a short TTL, and PKCE.

1. ``start_authorization`` stores ``{destination, user, verifier, redirect_uri}``
   under the SHA-256 of a random state (Redis, or memory in dev and tests) and
   returns the provider's consent URL. Google asks only for ``drive.file``: Crate
   sees the files it creates and nothing else of the account.
2. The provider redirects to Admin's callback with ``code`` and ``state``.
   ``complete_authorization`` takes the state out of the store (it works once),
   checks it is unexpired and was issued to the same admin for the same kind of
   destination, exchanges the code with the verifier, and stores the token in the
   destination's encrypted secrets in the format rclone reads.

Each install brings its own OAuth client (a Google "Web application" client, a
Dropbox app) with Admin's callback URL registered: rclone's shared Google client
is rate-limited, being retired in 2026, and only allows loopback redirects. The
client ID lives in the destination's settings, the secret with its credentials;
``CRATE_BACKUP_GDRIVE_CLIENT_ID``/``_SECRET`` and ``CRATE_BACKUP_DROPBOX_CLIENT_ID``/
``_SECRET`` give an install-wide default.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any
from urllib.parse import urlencode

from crate.backups.destinations import (
    DestinationNotFound,
    load_destination_secrets,
    update_destination,
)
from crate.backups.providers import DestinationError, install_oauth_client
from crate.db.queries.backup_destinations import get_backup_destination

STATE_TTL_SECONDS = 10 * 60
_STATE_PREFIX = "crate:backups:oauth"
_memory_states: dict[str, str] = {}
_memory_lock = RLock()


class OAuthError(RuntimeError):
    """The flow cannot go on; the message is safe to show."""


class OAuthStateError(OAuthError):
    """The state is unknown, used, expired or bound to someone else."""


@dataclass(frozen=True, slots=True)
class OAuthProvider:
    kind: str
    label: str
    authorize_url: str
    token_url: str
    scope: str | None
    extra_params: tuple[tuple[str, str], ...]


OAUTH_PROVIDERS: dict[str, OAuthProvider] = {
    "gdrive": OAuthProvider(
        "gdrive",
        "Google Drive",
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
        "https://www.googleapis.com/auth/drive.file",
        # A refresh token, every time: rclone runs unattended.
        (("access_type", "offline"), ("prompt", "consent")),
    ),
    "dropbox": OAuthProvider(
        "dropbox",
        "Dropbox",
        "https://www.dropbox.com/oauth2/authorize",
        "https://api.dropboxapi.com/oauth2/token",
        None,
        (("token_access_type", "offline"),),
    ),
}


@dataclass(frozen=True, slots=True)
class PendingAuthorization:
    destination_id: str
    kind: str
    user_id: int
    verifier: str
    redirect_uri: str
    expires_at: datetime


def _state_key(state: str) -> str:
    return f"{_STATE_PREFIX}:{hashlib.sha256(state.encode('utf-8')).hexdigest()}"


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _redis():
    if not os.environ.get("REDIS_URL"):
        return None
    try:
        from crate.db.cache_runtime import get_redis

        return get_redis()
    except Exception:
        return None


def _memory_allowed() -> bool:
    # Same rule as the native OAuth handoffs: memory only in dev and tests.
    environment = os.environ.get("CRATE_ENV", "").strip().lower()
    return environment in {"dev", "development", "test"}


def _store_state(key: str, value: str) -> None:
    client = _redis()
    if client is not None:
        try:
            if client.set(key, value, ex=STATE_TTL_SECONDS, nx=True):
                return
        except Exception as exc:
            raise OAuthError("The OAuth state store is unavailable") from exc
        raise OAuthError("The OAuth state could not be stored")
    if not _memory_allowed():
        raise OAuthError("The OAuth state store is unavailable")
    with _memory_lock:
        _memory_states[key] = value


def _take_state(key: str) -> str | None:
    """Read and delete in one step: a state works once."""
    client = _redis()
    if client is not None:
        try:
            raw = client.getdel(key)
        except Exception as exc:
            raise OAuthError("The OAuth state store is unavailable") from exc
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return raw
    if not _memory_allowed():
        raise OAuthError("The OAuth state store is unavailable")
    with _memory_lock:
        return _memory_states.pop(key, None)


def oauth_client(
    kind: str, config: Mapping[str, Any], credentials: Mapping[str, Any]
) -> tuple[str, str]:
    """The OAuth client of a destination, else the install-wide one."""
    try:
        return install_oauth_client(kind, config, credentials)
    except DestinationError as exc:
        raise OAuthError(str(exc)) from exc


def _oauth_destination(destination_id: str) -> dict[str, Any]:
    row = get_backup_destination(destination_id)
    if row is None:
        raise DestinationNotFound(destination_id)
    if row["kind"] not in OAUTH_PROVIDERS:
        raise OAuthError("This destination does not connect through OAuth")
    return row


def start_authorization(destination_id: str, *, user_id: int, redirect_uri: str) -> str:
    """Store a one-time state and return the provider's consent URL."""
    row = _oauth_destination(destination_id)
    provider = OAUTH_PROVIDERS[row["kind"]]
    credentials = load_destination_secrets(row).credentials
    client_id, _ = oauth_client(row["kind"], row["config"] or {}, credentials)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    pending = {
        "destination_id": str(row["id"]),
        "kind": row["kind"],
        "user_id": int(user_id),
        "verifier": verifier,
        "redirect_uri": redirect_uri,
        "expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=STATE_TTL_SECONDS)
        ).isoformat(),
    }
    _store_state(_state_key(state), json.dumps(pending, sort_keys=True))
    params: list[tuple[str, str]] = [
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("state", state),
        ("code_challenge", _challenge(verifier)),
        ("code_challenge_method", "S256"),
    ]
    if provider.scope:
        params.append(("scope", provider.scope))
    params.extend(provider.extra_params)
    return f"{provider.authorize_url}?{urlencode(params)}"


def consume_state(state: str, *, user_id: int | None) -> PendingAuthorization:
    """Take a state out of the store and check it; raise OAuthStateError otherwise."""
    if not isinstance(state, str) or not 20 <= len(state) <= 256:
        raise OAuthStateError("The authorization state is invalid")
    raw = _take_state(_state_key(state))
    if raw is None:
        raise OAuthStateError("The authorization state is unknown or was already used")
    try:
        record = json.loads(raw)
        pending = PendingAuthorization(
            destination_id=str(record["destination_id"]),
            kind=str(record["kind"]),
            user_id=int(record["user_id"]),
            verifier=str(record["verifier"]),
            redirect_uri=str(record["redirect_uri"]),
            expires_at=datetime.fromisoformat(str(record["expires_at"])),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise OAuthStateError("The authorization state is invalid") from exc
    if pending.expires_at <= datetime.now(timezone.utc):
        raise OAuthStateError("The authorization expired; connect again")
    if user_id is None or not secrets.compare_digest(
        str(pending.user_id), str(int(user_id))
    ):
        raise OAuthStateError("The authorization was started by another account")
    return pending


def _post_form(url: str, data: Mapping[str, str]) -> tuple[int, Any]:
    import requests

    response = requests.post(url, data=dict(data), timeout=15)
    try:
        payload = response.json()
    except ValueError:
        payload = None
    return response.status_code, payload


def exchange_code(
    provider: OAuthProvider,
    *,
    code: str,
    verifier: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str,
    post: Callable[[str, Mapping[str, str]], tuple[int, Any]] = _post_form,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Trade the code for a token, in the JSON format rclone keeps in its config."""
    status, payload = post(
        provider.token_url,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
            "code_verifier": verifier,
        },
    )
    if status != 200 or not isinstance(payload, dict):
        raise OAuthError(f"{provider.label} refused the authorization code")
    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")
    if not isinstance(access_token, str) or not access_token:
        raise OAuthError(f"{provider.label} returned no access token")
    if not isinstance(refresh_token, str) or not refresh_token:
        raise OAuthError(
            f"{provider.label} returned no refresh token; remove Crate's access in "
            "your account settings and connect again"
        )
    if provider.scope and payload.get("scope"):
        granted = set(str(payload["scope"]).split())
        if provider.scope not in granted:
            raise OAuthError(f"{provider.label} did not grant {provider.scope}")
    expires_in = payload.get("expires_in")
    issued = now or datetime.now(timezone.utc)
    expiry = issued + timedelta(
        seconds=int(expires_in) if isinstance(expires_in, int) else 3600
    )
    return {
        "access_token": access_token,
        "token_type": str(payload.get("token_type") or "Bearer"),
        "refresh_token": refresh_token,
        "expiry": expiry.isoformat().replace("+00:00", "Z"),
    }


def complete_authorization(
    *,
    state: str,
    code: str,
    user_id: int | None,
    post: Callable[[str, Mapping[str, str]], tuple[int, Any]] = _post_form,
) -> dict[str, Any]:
    """Check the state, exchange the code, store the token. Returns the destination."""
    pending = consume_state(state, user_id=user_id)
    if not isinstance(code, str) or not code or len(code) > 4096:
        raise OAuthError("The provider sent no authorization code")
    row = _oauth_destination(pending.destination_id)
    if row["kind"] != pending.kind:
        raise OAuthStateError("The destination changed while it was being connected")
    provider = OAUTH_PROVIDERS[row["kind"]]
    credentials = load_destination_secrets(row).credentials
    client_id, client_secret = oauth_client(
        row["kind"], row["config"] or {}, credentials
    )
    token = exchange_code(
        provider,
        code=code,
        verifier=pending.verifier,
        redirect_uri=pending.redirect_uri,
        client_id=client_id,
        client_secret=client_secret,
        post=post,
    )
    return update_destination(
        pending.destination_id,
        secrets={"token": json.dumps(token, separators=(",", ":"), sort_keys=True)},
    )


__all__ = [
    "OAUTH_PROVIDERS",
    "OAuthError",
    "OAuthProvider",
    "OAuthStateError",
    "PendingAuthorization",
    "STATE_TTL_SECONDS",
    "complete_authorization",
    "consume_state",
    "exchange_code",
    "oauth_client",
    "start_authorization",
]
