"""Fencing for federation catalog sync sessions (FED-D11).

``begin_catalog_sync_session`` hands each session a per-peer generation.
Every session write calls ``fence_catalog_sync_write`` first, in its own
transaction: it locks the peer's cursor row, aborts with
``CatalogSyncFenced`` when a newer session (or a disable/revocation) has
bumped the generation, and declares the fence so the database guards from
migration 160 let the write through.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.schema_sections.federation_catalog_sync_fencing_v160 import (
    FENCE_SETTING,
)
from crate.db.tx import optional_scope


class CatalogSyncFenced(RuntimeError):
    """A newer sync session, a disable or a revocation superseded this one."""

    def __init__(
        self,
        node_uid: str,
        *,
        expected_generation: int | None,
        current_generation: int | None,
        reason: str | None = None,
    ) -> None:
        self.node_uid = node_uid
        self.expected_generation = expected_generation
        self.current_generation = current_generation
        message = reason or (
            f"catalog sync session for peer {node_uid} was superseded "
            f"(session generation {expected_generation}, "
            f"current generation {current_generation}); it stopped without writing"
        )
        super().__init__(message)


def _declare_fence(session: Session, value: str) -> None:
    session.execute(
        text("SELECT set_config(:setting, :value, true)"),
        {"setting": FENCE_SETTING, "value": value},
    )


def declare_catalog_maintenance_write(session: Session) -> None:
    """Mark a write outside any sync session (single-item maintenance helpers)."""
    _declare_fence(session, "maintenance")


def begin_catalog_sync_session(node_uid: str, *, session: Session | None = None) -> int:
    """Start a sync session for an approved peer and return its generation.

    The peer row is read ``FOR SHARE`` before the cursor row is bumped, the same
    order a disable takes, so a disable either wins (and this raises) or waits
    and then fences the session it lets start.
    """

    def _impl(current: Session) -> int:
        peer = (
            current.execute(
                text(
                    "SELECT trust_state, disabled_at FROM federation_nodes "
                    "WHERE node_uid = CAST(:node_uid AS uuid) FOR SHARE"
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .first()
        )
        if (
            peer is None
            or peer["disabled_at"] is not None
            or (peer["trust_state"] != "approved")
        ):
            raise CatalogSyncFenced(
                node_uid,
                expected_generation=None,
                current_generation=None,
                reason=(
                    f"catalog sync for peer {node_uid} not started: "
                    "the peer is missing, disabled or not approved"
                ),
            )
        _declare_fence(current, "begin")
        return int(
            current.execute(
                text(
                    """
                    INSERT INTO federation_catalog_cursors
                        (node_uid, sync_generation, updated_at)
                    VALUES (CAST(:node_uid AS uuid), 1, NOW())
                    ON CONFLICT (node_uid) DO UPDATE SET
                        sync_generation = federation_catalog_cursors.sync_generation + 1,
                        updated_at = NOW()
                    RETURNING sync_generation
                    """
                ),
                {"node_uid": node_uid},
            ).scalar_one()
        )

    with optional_scope(session) as current:
        return _impl(current)


def fence_catalog_sync_write(
    session: Session, node_uid: str, sync_generation: int
) -> dict[str, Any]:
    """Lock the peer's cursor row and abort unless this session is current.

    Call it first in every session write transaction. It returns the locked
    cursor row so the caller can keep checkpoints monotonic.
    """
    row = (
        session.execute(
            text(
                "SELECT * FROM federation_catalog_cursors "
                "WHERE node_uid = CAST(:node_uid AS uuid) FOR UPDATE"
            ),
            {"node_uid": node_uid},
        )
        .mappings()
        .first()
    )
    if row is None or int(row["sync_generation"]) != int(sync_generation):
        raise CatalogSyncFenced(
            node_uid,
            expected_generation=int(sync_generation),
            current_generation=(
                int(row["sync_generation"]) if row is not None else None
            ),
        )
    _declare_fence(session, str(int(sync_generation)))
    return dict(row)


def checkpoint_moves_forward(
    locked_cursor: dict[str, Any], sync_session_uid: str | None, next_page: int
) -> bool:
    """Whether a partial checkpoint may replace the stored one.

    A new sync session may reset the checkpoint (it holds the current
    generation). Within one session, a replayed page never moves it back.
    """
    try:
        stored = json.loads(str(locked_cursor.get("cursor") or ""))
    except (TypeError, ValueError, RecursionError):
        return True
    if not isinstance(stored, dict) or stored.get("status") != "partial":
        return True
    if str(stored.get("sync_session_uid") or "") != str(sync_session_uid or ""):
        return True
    try:
        stored_page = int(stored.get("next_page") or 0)
    except (TypeError, ValueError):
        return True
    return int(next_page) >= stored_page


__all__ = [
    "CatalogSyncFenced",
    "begin_catalog_sync_session",
    "checkpoint_moves_forward",
    "declare_catalog_maintenance_write",
    "fence_catalog_sync_write",
]
