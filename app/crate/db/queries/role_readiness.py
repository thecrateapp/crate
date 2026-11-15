"""A bounded database round trip for container role readiness.

The compose health check (``crate.role_readiness``) runs the same statements on
a direct psycopg2 connection so it never imports this facade.
"""

from sqlalchemy import text

from crate.db.tx import read_scope


def database_ready(*, session=None):
    def read(current):
        current.execute(text("SET LOCAL statement_timeout='2s'"))
        return current.execute(text("SELECT 1")).scalar_one() == 1

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


__all__ = ["database_ready"]
