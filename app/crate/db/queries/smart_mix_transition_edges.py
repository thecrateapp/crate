"""Batch-load Smart Mix edge signals onto recommendation rows."""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any, Iterable, MutableMapping

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.smart_mix.transition_fit import (
    TRANSITION_EDGE_COLUMNS,
    TRANSITION_EDGE_PREFIX,
)


def transition_edge_select(alias: str) -> str:
    return ", ".join(
        f"{alias}.{column} AS {TRANSITION_EDGE_PREFIX}{column}"
        for column in TRANSITION_EDGE_COLUMNS
    )


def transition_edge_join(track_alias: str, alias: str) -> str:
    return (
        f"LEFT JOIN track_mix_profiles {alias} "
        f"ON {alias}.track_id = {track_alias}.id "
        f"AND {alias}.source_stale_at IS NULL"
    )


_EDGES_SQL = text(
    f"""
    SELECT profile.track_id, {transition_edge_select("profile")}
    FROM track_mix_profiles profile
    WHERE profile.track_id = ANY(CAST(:ids AS bigint[]))
      AND profile.source_stale_at IS NULL
    """
)


def attach_transition_edges(
    rows: Iterable[MutableMapping[str, Any]],
    *,
    session: Session | None = None,
) -> None:
    quality_column = f"{TRANSITION_EDGE_PREFIX}quality"
    pending: dict[int, list[MutableMapping[str, Any]]] = {}
    for row in rows:
        if quality_column in row:
            continue
        track_id = row.get("id", row.get("track_id"))
        try:
            key = int(track_id)
        except (TypeError, ValueError):
            continue
        pending.setdefault(key, []).append(row)
    if not pending:
        return
    with nullcontext(session) if session is not None else read_scope() as current:
        found = {
            int(item["track_id"]): item
            for item in current.execute(_EDGES_SQL, {"ids": list(pending)}).mappings()
        }
    for track_id, targets in pending.items():
        profile = found.get(track_id)
        for row in targets:
            for column in TRANSITION_EDGE_COLUMNS:
                name = f"{TRANSITION_EDGE_PREFIX}{column}"
                row[name] = profile[name] if profile is not None else None


__all__ = [
    "attach_transition_edges",
    "transition_edge_join",
    "transition_edge_select",
]
