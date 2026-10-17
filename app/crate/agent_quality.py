"""Bounded reads of worker-produced quality evidence."""

import base64
import json
from datetime import UTC, datetime

from crate.agent_diagnostics import DiagnosticError, _safe, _rows
from crate.db.analytics_quality_surface import (
    QUALITY_CATEGORIES,
    empty_quality_report,
    read_quality_report_snapshot,
)
from crate.db.read_model_shared import coerce_datetime


def get_library_quality(
    *, category: str | None = None, limit: int = 50, cursor: str | None = None
) -> dict:
    if category is not None and (
        not isinstance(category, str) or category not in QUALITY_CATEGORIES
    ):
        raise DiagnosticError("INVALID_ARGUMENT", "Unknown quality category")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Quality limit must be between 1 and 100"
        )
    offset, expected_version = 0, None
    if cursor:
        try:
            if len(cursor) > 512:
                raise ValueError()
            page = json.loads(
                base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            )
            if page["category"] != category:
                raise ValueError()
            offset, expected_version = page["offset"], page["version"]
            if type(offset) is not int or not 0 <= offset <= 100000:
                raise ValueError()
            if type(expected_version) is not int or expected_version < 1:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Invalid quality cursor"
            ) from None
    record = read_quality_report_snapshot(category=category, offset=offset, limit=limit)
    result = empty_quality_report()
    result.update({"category": category, "items": [], "total": 0, "next_cursor": None})
    if record is None:
        if cursor:
            raise DiagnosticError(
                "CURSOR_STALE", "Quality evidence is no longer available"
            )
        return {
            **result,
            "availability": "unavailable",
            "reason": "No quality snapshot",
        }
    version = int(record["version"])
    if expected_version is not None and expected_version != version:
        raise DiagnosticError(
            "CURSOR_STALE", "Quality evidence changed; restart pagination"
        )
    stale_after = coerce_datetime(record.get("stale_after"))
    stale = stale_after is not None and stale_after <= datetime.now(UTC)
    invalidated = record.get("invalidated_at") is not None
    snapshot = {
        key: _safe(record.get(key))
        for key in (
            "version",
            "built_at",
            "stale_after",
            "invalidated_at",
            "source_seq",
            "generation_ms",
        )
    }
    result["snapshot"] = snapshot
    if invalidated or record.get("active_mutation"):
        return {
            **result,
            "availability": "unavailable",
            "reason": "A library mutation is in progress"
            if record.get("active_mutation")
            else "Quality snapshot was invalidated",
        }
    summary = record.get("summary") or {}
    result.update({key: _safe(value) for key, value in summary.items()})
    # The compatibility category array and items both carry the same evidence page.
    items = _rows(record.get("items") or [], limit, byte_budget=18000)
    result.update(
        {
            "availability": "stale" if stale else "ready",
            "historical": stale,
            "category": category,
            "items": items,
            "total": int(record.get("total") or 0),
        }
    )
    if category:
        result[category] = items
    next_offset = offset + len(items)
    if items and next_offset < result["total"] and next_offset <= 100000:
        result["next_cursor"] = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {"category": category, "offset": next_offset, "version": version}
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
    return result
