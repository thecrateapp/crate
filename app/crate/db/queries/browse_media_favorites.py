from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def list_favorites() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT item_type, item_id, created_at FROM favorites ORDER BY created_at DESC"
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


__all__ = ["list_favorites"]
