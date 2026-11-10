from __future__ import annotations

from collections.abc import Iterator
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


@contextmanager
def try_session_lock(lock_key: str) -> Iterator[bool]:
    """Try a session advisory lock on ``lock_key`` without waiting.

    Yields True while this process holds it, False if another session holds it.
    The lock lives on one raw connection for the whole block, so a killed process
    releases it when PostgreSQL drops the connection.
    """
    connection = get_engine().raw_connection()
    acquired = False
    try:
        cursor = connection.cursor()
        try:
            cursor.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (lock_key,))
            row = cursor.fetchone()
            acquired = bool(row and row[0])
        finally:
            cursor.close()
        connection.commit()
        yield acquired
    finally:
        try:
            if acquired:
                cursor = connection.cursor()
                try:
                    cursor.execute(
                        "SELECT pg_advisory_unlock(hashtext(%s))", (lock_key,)
                    )
                finally:
                    cursor.close()
                connection.commit()
        finally:
            connection.close()


__all__ = ["artist_sync_lock", "try_session_lock"]
