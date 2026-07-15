"""Compatibility import for federation backfill verification."""

from crate.db.queries.federation_backfill_verification import (
    collect_federation_backfill_report,
)

__all__ = ["collect_federation_backfill_report"]
