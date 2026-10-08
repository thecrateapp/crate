from __future__ import annotations

from typing import cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult

from crate.db.tx import transaction_scope


def add_favorite(user_id: int, item_type: str, item_id: str, created_at: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                "INSERT INTO favorites (user_id, item_type, item_id, created_at) "
                "VALUES (:user_id, :item_type, :item_id, :created_at) "
                "ON CONFLICT (user_id, item_type, item_id) DO NOTHING"
            ),
            {
                "user_id": user_id,
                "item_type": item_type,
                "item_id": item_id,
                "created_at": created_at,
            },
        )
        return int(cast(CursorResult, result).rowcount or 0) > 0


def remove_favorite(user_id: int, item_type: str, item_id: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                "DELETE FROM favorites "
                "WHERE user_id = :user_id AND item_id = :item_id "
                "AND item_type = :item_type"
            ),
            {"user_id": user_id, "item_id": item_id, "item_type": item_type},
        )
        return int(cast(CursorResult, result).rowcount or 0) > 0


__all__ = ["add_favorite", "remove_favorite"]
