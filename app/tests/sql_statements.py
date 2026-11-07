"""Count the SQL statements a block of code sends to PostgreSQL."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event


@contextmanager
def recorded_statements() -> Iterator[list[str]]:
    from crate.db.engine import get_engine

    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(" ".join(statement.split()))

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)
