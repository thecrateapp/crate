"""Settings helpers stored in PostgreSQL."""

from __future__ import annotations

from typing import overload

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


@overload
def get_setting(key: str, default: str) -> str: ...


@overload
def get_setting(key: str, default: None = None) -> str | None: ...


def get_setting(key: str, default: str | None = None) -> str | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT value FROM settings WHERE key = :key"), {"key": key}
            )
            .mappings()
            .first()
        )
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES (:key, :value) "
                "ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value"
            ),
            {"key": key, "value": value},
        )


__all__ = ["get_setting", "set_setting"]
