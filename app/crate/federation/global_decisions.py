"""Compatibility facade for global catalog match decisions."""

from crate.db.repositories.global_catalog_decisions import (
    force_merge_target_for_source,
    merge_blocked_for_source,
    record_match_decision,
)

__all__ = [
    "force_merge_target_for_source",
    "merge_blocked_for_source",
    "record_match_decision",
]
