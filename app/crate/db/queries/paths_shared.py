"""Shared helpers for path read queries."""

from __future__ import annotations

from uuid import UUID


def _canonical_reference_params(value: str) -> dict[str, int | str | None]:
    reference_id: int | None = None
    reference_uid: str | None = None
    try:
        parsed_id = int(value)
        if -(2**63) <= parsed_id <= 2**63 - 1 and str(parsed_id) == value:
            reference_id = parsed_id
    except (TypeError, ValueError):
        pass
    try:
        parsed_uid = str(UUID(value))
        if parsed_uid == value:
            reference_uid = parsed_uid
    except (TypeError, ValueError, AttributeError):
        pass
    return {"reference_id": reference_id, "reference_uid": reference_uid}


def array_distance_sql(vector_expr: str) -> str:
    return f"""
        SQRT(COALESCE((
            SELECT SUM(POWER(tv.val - pv.val, 2))
            FROM UNNEST({vector_expr}) WITH ORDINALITY AS tv(val, idx)
            JOIN UNNEST(CAST(:probe_array AS double precision[])) WITH ORDINALITY AS pv(val, idx)
              USING (idx)
        ), 0.0))
    """


__all__ = ["array_distance_sql"]
