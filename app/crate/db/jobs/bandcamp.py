from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session

from crate.db.tx import transaction_scope


@contextmanager
def bandcamp_write_scope() -> Iterator[Session]:
    with transaction_scope() as session:
        yield session


__all__ = ["bandcamp_write_scope"]
