"""Relay committed PostgreSQL outbox events to Redis Streams."""

from __future__ import annotations

import logging
import socket

from crate.db.domain_event_outbox import (
    claim_outbox_events,
    mark_outbox_delivered,
    mark_outbox_failed,
)
from crate.db.domain_events import publish_outbox_event

log = logging.getLogger(__name__)


def relay_domain_events(
    *,
    limit: int = 100,
    worker_id: str | None = None,
) -> dict[str, int]:
    relay_id = worker_id or f"{socket.gethostname()}:{id(relay_domain_events)}"
    events = claim_outbox_events(relay_id, limit=limit)
    delivered = 0
    failed = 0

    for event in events:
        event_uid = str(event["event_uid"])
        try:
            stream_id, sequence = publish_outbox_event(event)
            mark_outbox_delivered(
                event_uid,
                stream_id,
                sequence,
                worker_id=relay_id,
            )
            delivered += 1
        except Exception as exc:
            attempts = int(event.get("attempts") or 0) + 1
            mark_outbox_failed(
                event_uid,
                str(exc),
                attempts,
                worker_id=relay_id,
            )
            failed += 1
            log.warning(
                "Domain event relay failed",
                extra={"event_uid": event_uid, "attempts": attempts},
                exc_info=True,
            )

    return {"claimed": len(events), "delivered": delivered, "failed": failed}


__all__ = ["relay_domain_events"]
