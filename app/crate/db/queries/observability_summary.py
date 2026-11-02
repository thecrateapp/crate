"""Inputs for the persisted observability summary; reads stored rows only."""

from __future__ import annotations

from datetime import date

from sqlalchemy import text

from crate.db.queries.product_kpis import get_product_kpi_rows
from crate.db.tx import read_scope


def read_summary_inputs(start: date, end: date, *, session=None) -> dict:
    def _impl(current) -> dict:
        kpis = get_product_kpi_rows(start, end, session=current)
        stack = (
            current.execute(
                text(
                    """
                    SELECT payload_json->'inventory' AS inventory, built_at
                    FROM ui_snapshots
                    WHERE scope = 'ops:stack' AND subject_key = 'global'
                    """
                )
            )
            .mappings()
            .first()
        )
        return {
            "kpi_rows": kpis["rows"],
            "kpi_computed_at": kpis["computed_at"],
            "inventory": dict(stack["inventory"] or {}) if stack else None,
            "inventory_built_at": stack["built_at"] if stack else None,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["read_summary_inputs"]
