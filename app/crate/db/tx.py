"""Explicit transaction boundaries for the Crate data layer.

``transaction_scope()`` is the canonical way for runtime code to talk
to PostgreSQL. It yields a SQLAlchemy ``Session`` with automatic
commit/rollback semantics:

    with transaction_scope() as session:
        session.execute(text("INSERT INTO ..."), {...})
        # auto-committed here

Legacy psycopg2 bootstrap still lives in ``db.core``, but this module
no longer exposes a cursor-based compatibility wrapper. New runtime
code should always compose around ``Session``.
"""

import logging
from collections.abc import Callable
from contextlib import contextmanager

from sqlalchemy import event

from crate.db.engine import get_session_factory

log = logging.getLogger(__name__)

_AFTER_COMMIT_CALLBACKS_KEY = "_after_commit_callbacks"
_AFTER_COMMIT_HOOKS_KEY = "_after_commit_hooks_registered"


def _run_after_commit_callbacks(session) -> None:
    nested = session.get_nested_transaction()
    if nested is not None:
        # SQLAlchemy emits after_commit for RELEASE SAVEPOINT too. Successful
        # children inherit their parent's fate; only the outer commit may publish.
        session.info[_AFTER_COMMIT_CALLBACKS_KEY] = [
            (nested.parent if owner is nested else owner, callback)
            for owner, callback in session.info.get(_AFTER_COMMIT_CALLBACKS_KEY, [])
        ]
        return
    callbacks = session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, [])
    for _owner, callback in callbacks:
        try:
            callback()
        except Exception:
            log.exception("Post-commit callback failed")


def _discard_ended_transaction_callbacks(session, transaction) -> None:
    if transaction.parent is None:
        # Also covers close() without an explicit rollback, and failed commits.
        session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, None)
        return
    # Committed savepoints were promoted by after_commit. Everything still
    # owned by this ended scope was rolled back/closed and must be discarded.
    session.info[_AFTER_COMMIT_CALLBACKS_KEY] = [
        (owner, callback)
        for owner, callback in session.info.get(_AFTER_COMMIT_CALLBACKS_KEY, [])
        if owner is not transaction
    ]


def register_after_commit(session, callback: Callable[[], None]) -> None:
    """Run a callback only after the outer Session transaction commits.

    Savepoint success retains its callbacks until outer commit. Savepoint
    rollback discards only its own callbacks, preserving the parent's effects.
    Outer rollback/close discards all callbacks. Registration order is retained.
    An idle session starts a logical transaction so rollback/close can discard it.
    """
    owner = (
        session.get_nested_transaction() or session.get_transaction() or session.begin()
    )
    callbacks = session.info.setdefault(_AFTER_COMMIT_CALLBACKS_KEY, [])
    callbacks.append((owner, callback))

    if session.info.get(_AFTER_COMMIT_HOOKS_KEY):
        return

    # propagate=False keeps the listener on this session instance only.
    # Install once per session instance; reuse across transactions without
    # accumulating listeners. They are discarded with the session itself.
    event.listen(session, "after_commit", _run_after_commit_callbacks, propagate=False)
    event.listen(
        session,
        "after_transaction_end",
        _discard_ended_transaction_callbacks,
        propagate=False,
    )
    session.info[_AFTER_COMMIT_HOOKS_KEY] = True


@contextmanager
def transaction_scope():
    """Open a SQLAlchemy Session with automatic commit/rollback.

    Yields a ``sqlalchemy.orm.Session``. Commits on clean exit, rolls
    back on exception. The session is closed after the block regardless.

    Usage::

        with transaction_scope() as session:
            session.execute(text("UPDATE users SET name = :n WHERE id = :id"), {"n": "X", "id": 1})
            # auto-committed here
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def optional_scope(session=None):
    """Reuse a caller's session when provided, otherwise open a new one.

    This is the composability primitive: functions that accept an
    optional ``session`` keyword use this to avoid opening a redundant
    transaction when a caller already has one open.

    Usage::

        def my_function(arg, *, session=None):
            with optional_scope(session) as s:
                s.execute(text("..."))
    """
    if session is not None:
        yield session
        return
    with transaction_scope() as managed:
        yield managed


@contextmanager
def read_scope():
    """Open a read-only Session that rolls back on exit.

    Use for SELECT queries that don't need commit semantics. Rolling
    back on exit keeps the lifecycle explicit and avoids unnecessary
    commit work on read-only paths.

    Usage::

        with read_scope() as session:
            rows = session.execute(text("SELECT ...")).mappings().all()
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
