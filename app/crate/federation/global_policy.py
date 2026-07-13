"""Compatibility predicates for the mandatory canonical catalog.

The names remain temporarily while read surfaces migrate, but no environment or
settings value can turn the catalog into an alternate local-only product mode.
"""

from __future__ import annotations


def is_global_catalog_enabled() -> bool:
    """The canonical catalog is required on every node."""
    return True


def global_catalog_surface_enabled(surface: str) -> bool:
    """Return whether a non-empty canonical surface name is supported."""
    return bool(surface.strip())


def global_catalog_remote_playlist_refs_allowed() -> bool:
    """A global ID is a canonical reference; source grants are checked later."""
    return True


__all__ = [
    "global_catalog_remote_playlist_refs_allowed",
    "global_catalog_surface_enabled",
    "is_global_catalog_enabled",
]
