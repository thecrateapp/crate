"""Grant evaluation — preset-based peer access control.

Phase 1 exposes only presets (Off, Discovery, Catalog, Listen, Trusted Library).
Advanced constraint editing is future-only.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# ── Preset definitions ────────────────────────────────────────────────────

PRESETS: dict[str, dict] = {
    "off": {
        "capabilities": [],
        "constraints": {},
    },
    "discovery": {
        "capabilities": ["catalog.search", "artwork.read"],
        "constraints": {
            "max_results": 10,
            "allowed_entity_types": ["artist", "album", "track"],
        },
    },
    "catalog": {
        "capabilities": [
            "catalog.search",
            "catalog.sync",
            "catalog.artist.read",
            "catalog.album.read",
            "catalog.track.read",
            "catalog.metadata.genres",
            "artwork.read",
        ],
        "constraints": {
            "max_results": 20,
            "allowed_entity_types": ["artist", "album", "track"],
        },
    },
    "listen": {
        "capabilities": [
            "catalog.search",
            "catalog.sync",
            "catalog.artist.read",
            "catalog.album.read",
            "catalog.track.read",
            "catalog.metadata.genres",
            "artwork.read",
            "stream.proxy",
            "stream.transcoded",
        ],
        "constraints": {
            "max_results": 20,
            "max_concurrent_streams": 4,
            "daily_stream_bytes": 50_000_000_000,
            "delivery": ["balanced"],
            "allow_original": False,
            "allowed_entity_types": ["artist", "album", "track"],
        },
    },
    "trusted_library": {
        "capabilities": [
            "catalog.search",
            "catalog.sync",
            "catalog.artist.read",
            "catalog.album.read",
            "catalog.track.read",
            "catalog.metadata.genres",
            "artwork.read",
            "stream.proxy",
            "stream.transcoded",
            "stream.original",
            "import.request",
        ],
        "constraints": {
            "max_results": 50,
            "max_concurrent_streams": 4,
            "daily_stream_bytes": 250_000_000_000,
            "delivery": ["balanced", "original"],
            "allow_original": True,
            "allowed_entity_types": ["artist", "album", "track"],
        },
    },
}

PRESET_NAMES = tuple(PRESETS.keys())


def resolve_preset(preset_name: str) -> dict:
    preset_name = preset_name.lower()
    if preset_name not in PRESETS:
        raise ValueError(
            f"Unknown preset: {preset_name}. Valid presets: {', '.join(PRESET_NAMES)}"
        )
    return PRESETS[preset_name]


def preset_allows(preset_name: str, capability: str) -> bool:
    resolved = resolve_preset(preset_name)
    capabilities: list[str] = resolved.get("capabilities", [])
    return capability in capabilities


def preset_has_stream_original(preset_name: str) -> bool:
    return preset_allows(preset_name, "stream.original")


def preset_has_import_request(preset_name: str) -> bool:
    return preset_allows(preset_name, "import.request")


# ── Grant evaluation (Phase 1: preset-based) ──────────────────────────────


def evaluate_grant(
    peer_trust_state: str,
    peer_disabled_at: str | None,
    preset_name: str,
    required_capability: str,
    subject_blocked: bool = False,
) -> tuple[bool, str | None]:
    if peer_trust_state != "approved":
        return False, f"peer trust state is {peer_trust_state}"
    if peer_disabled_at is not None:
        return False, "peer is disabled"
    if subject_blocked:
        return False, "remote subject is blocked"
    if not preset_allows(preset_name, required_capability):
        return False, (f"preset '{preset_name}' does not allow '{required_capability}'")
    return True, None
