"""Secrets read from the file named by <NAME>_FILE, the Docker secrets convention."""

from __future__ import annotations

import os
from collections.abc import MutableMapping

SECRET_NAMES = (
    "JWT_SECRET",
    "CRATE_CREDENTIAL_KEY",
    "CRATE_CREDENTIAL_PREVIOUS_KEYS",
    "CRATE_POSTGRES_PASSWORD",
    "POSTGRES_SUPERUSER_PASSWORD",
    "REDIS_URL",
    "REDIS_CACHE_URL",
    "REDIS_DURABLE_URL",
    "CRATE_READPLANE_SERVICE_TOKEN",
    "CRATE_FEDERATION_SUBJECT_SECRET",
    "CRATE_FEDERATION_CURSOR_SECRET",
    "CRATE_CONNECT_WS_TICKET_SECRET",
    "CRATE_CAST_TICKET_SECRET",
    "FORWARD_AUTH_SECRET",
    "DEFAULT_ADMIN_PASSWORD",
    "SLSKD_API_KEY",
    "LASTFM_APIKEY",
    "LASTFM_API_SECRET",
    "FANART_API_KEY",
    "SPOTIFY_SECRET",
    "SETLISTFM_API_KEY",
    "DISCOGS_CONSUMER_SECRET",
    "TICKETMASTER_API_KEY",
    "GOOGLE_CLIENT_SECRET",
    "APPLE_PRIVATE_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "AUDIOMUSE_GEMINI_API_KEY",
    "TAVILY_API_KEY",
    "BRAVE_SEARCH_API_KEY",
)


class SecretFileError(RuntimeError):
    """A configured secret file could not be read."""


def load_secret_files(environ: MutableMapping[str, str] | None = None) -> list[str]:
    """Set NAME from the file in NAME_FILE, which wins over NAME; return the names set."""
    target = os.environ if environ is None else environ
    loaded = []
    for name in SECRET_NAMES:
        path = target.get(f"{name}_FILE", "").strip()
        if not path:
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                value = handle.read()
        except (OSError, UnicodeDecodeError) as error:
            reason = getattr(error, "strerror", None) or type(error).__name__
            raise SecretFileError(f"{name}_FILE could not be read: {reason}") from None
        target[name] = value.rstrip("\r\n")
        loaded.append(name)
    return loaded
