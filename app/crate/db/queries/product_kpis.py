"""Read precomputed daily product KPIs; never aggregates source tables."""

from __future__ import annotations

from datetime import date

from sqlalchemy import text

from crate.db.tx import read_scope

MINIMUM_SEGMENT_SAMPLE = 3


def get_product_kpi_rows(start: date, end: date, *, session=None) -> dict:
    def _impl(current) -> dict:
        rows = current.execute(
            text(
                """
                SELECT day, kpi, dims, value, sample, computed_at
                FROM product_kpi_daily
                WHERE day BETWEEN :start AND :end
                ORDER BY kpi, dims::text, day
                """
            ),
            {"start": start, "end": end},
        ).mappings()
        result = [dict(row) for row in rows]
        computed = max((row["computed_at"] for row in result), default=None)
        return {"rows": result, "computed_at": computed}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["MINIMUM_SEGMENT_SAMPLE", "get_product_kpi_rows"]
