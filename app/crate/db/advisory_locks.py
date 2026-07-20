from __future__ import annotations

from contextlib import contextmanager

from crate.db.engine import get_engine


@contextmanager
def artist_sync_lock(artist_name: str):
    lock_key = f"library-sync:{artist_name.strip().lower()}"
    connection = get_engine().raw_connection()
    try:
        cursor = connection.cursor()
        try:
            cursor.execute("SELECT pg_advisory_lock(hashtext(%s))", (lock_key,))
        finally:
            cursor.close()
        yield
    finally:
        try:
            cursor = connection.cursor()
            try:
                cursor.execute("SELECT pg_advisory_unlock(hashtext(%s))", (lock_key,))
            finally:
                cursor.close()
        finally:
            connection.close()


__all__ = ["artist_sync_lock"]
