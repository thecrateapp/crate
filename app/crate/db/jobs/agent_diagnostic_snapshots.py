"""Background-only producer for the canonical diagnostic health sample."""

import time

from sqlalchemy import text

from crate.db.admin_health_surface import build_health_surface_payload
from crate.db.domain_events import get_latest_domain_event_id
from crate.db.tx import read_scope
from crate.db.ui_snapshot_writes import upsert_ui_snapshot


def warm_agent_health_snapshot() -> None:
    started = time.monotonic()
    source_seq = get_latest_domain_event_id()
    payload = build_health_surface_payload(limit=1000)
    ids = sorted(
        {
            row["artist_id"]
            for row in payload["issues"]
            if row.get("artist_id") is not None
        }
    )
    with read_scope() as current:
        identities = {
            row.id: str(row.entity_uid)
            for row in current.execute(
                text("SELECT id, entity_uid FROM library_artists WHERE id = ANY(:ids)"),
                {"ids": ids},
            )
        }
    for issue in payload["issues"]:
        issue["artist_uid"] = identities.get(issue.get("artist_id"))
    fields = (
        "id",
        "check_type",
        "severity",
        "description",
        "auto_fixable",
        "status",
        "created_at",
        "last_seen_at",
        "artist_id",
        "artist_uid",
        "album_id",
    )
    payload["issues"] = [
        {
            key: value[:2048] if isinstance(value, str) else value
            for key in fields
            if (value := row.get(key)) is not None
        }
        for row in payload["issues"][:1000]
    ]
    upsert_ui_snapshot(
        "ops:health",
        "agent:diagnostics:v1",
        payload,
        stale_after_seconds=60,
        source_seq=source_seq,
        generation_ms=int((time.monotonic() - started) * 1000),
    )


__all__ = ["warm_agent_health_snapshot"]
