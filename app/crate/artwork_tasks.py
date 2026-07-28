"""Canonical task dispatch for persistent artwork variants."""

from __future__ import annotations

from crate.artwork_variants import ArtworkAsset
from crate.db.repositories.tasks import create_task_dedup

ARTWORK_BACKFILL_VERSION = "1"
ARTWORK_MANIFEST_PERMISSIONS_VERSION = "1"


def queue_artwork_materialization(asset: ArtworkAsset, *, reason: str) -> str | None:
    return create_task_dedup(
        "materialize_artwork_variants",
        {"kind": asset.kind, "entity_key": asset.entity_key, "reason": reason},
        dedup_key=f"artwork:{asset.kind}:{asset.entity_key}",
    )


__all__ = [
    "ARTWORK_BACKFILL_VERSION",
    "ARTWORK_MANIFEST_PERMISSIONS_VERSION",
    "queue_artwork_materialization",
]
