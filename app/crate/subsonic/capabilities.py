"""OpenSubsonic server profile and feature-flag selection."""

import os
from typing import Literal

OpenSubsonicEngine = Literal["legacy", "v1"]

# Extensions are added only when their complete behavior is implemented.
OPEN_SUBSONIC_EXTENSIONS: tuple[dict[str, object], ...] = (
    {"name": "indexBasedQueue", "versions": [1]},
)


def selected_engine(value: str | None = None) -> OpenSubsonicEngine:
    configured = (
        value
        if value is not None
        else os.environ.get("CRATE_OPEN_SUBSONIC_ENGINE", "legacy")
    )
    normalized = configured.strip().lower()
    if normalized not in {"legacy", "v1"}:
        raise ValueError("CRATE_OPEN_SUBSONIC_ENGINE must be either 'legacy' or 'v1'")
    return normalized  # type: ignore[return-value]


def advertised_extensions() -> list[dict[str, object]]:
    return [dict(extension) for extension in OPEN_SUBSONIC_EXTENSIONS]
