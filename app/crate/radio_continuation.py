"""Atomic, user-bound radio batches shared by foreground and native playback."""

from contextlib import contextmanager
import json
from uuid import UUID

from redis.exceptions import LockError, WatchError

from crate import radio_engine as engine


class RadioLeaseLost(RuntimeError):
    """The session lease could not protect a radio mutation."""


@contextmanager
def session_lock(session_id: str):
    body_error = None
    try:
        with engine._redis().lock(
            f"radio:session:{session_id}:lock", timeout=60, blocking_timeout=3
        ) as lease:
            try:
                yield lease
            except BaseException as exc:
                body_error = exc
                raise
    except LockError as exc:
        if body_error is not None:
            raise body_error from None
        raise RadioLeaseLost("Radio session lease unavailable") from exc


@contextmanager
def leased_pipeline(lease):
    """Fence session mutations if the lock expires before MULTI/EXEC commits."""
    try:
        with engine._redis().pipeline() as pipe:
            pipe.watch(lease.name)
            if not lease.owned():
                raise RadioLeaseLost("Radio session lease expired")
            pipe.multi()
            yield pipe
    except WatchError as exc:
        raise RadioLeaseLost("Radio session lease changed before commit") from exc


def _empty(session_id: str, status: str = "exhausted", **extra) -> dict:
    return {
        "session_id": session_id,
        "tracks": [],
        "status": status,
        "exhausted": status == "exhausted",
        "revision": 1,
        **extra,
    }


def _recover_batch(session_id: str, user_id: int, index: int) -> dict:
    session = engine._load_session(session_id)
    if not session:
        if index == 0 and not engine._redis().get(
            f"{engine._session_key(session_id)}:started"
        ):
            return _empty(session_id, "retryable_empty", batch_index=-1)
        return _empty(session_id)
    if session["user_id"] != user_id:
        return _empty(session_id)
    cached = engine._redis().get(f"{engine._session_key(session_id)}:batch:{index}")
    if cached:
        return json.loads(cached)
    return _empty(
        session_id,
        "retryable_empty",
        batch_index=int(session.get("batch_index", 0)),
        revision=session.get("revision", 1),
    )


def _commit(session: dict, result: dict, index: int, lease) -> dict:
    result = {
        **result,
        "revision": session.get("revision", 1),
        "batch_index": index,
        "exhausted": bool(result.get("exhausted")),
    }
    result["status"] = (
        "ok"
        if result["tracks"]
        else "exhausted"
        if result["exhausted"]
        else "retryable_empty"
    )
    session["batch_index"] = index
    key = engine._session_key(session["id"])
    with leased_pipeline(lease) as pipe:
        pipe.set(key, json.dumps(session, default=str), ex=engine._SESSION_TTL)
        pipe.set(
            f"{key}:batch:{index}",
            json.dumps(result, default=str),
            ex=engine._SESSION_TTL,
        )
        pipe.set(f"{key}:started", "1", ex=engine._SESSION_TTL * 2)
        pipe.execute()
    return result


def start_batch(
    *,
    session_id: str,
    user_id: int,
    mode: str = "seeded",
    seed_type: str | None = None,
    seed_value: str | None = None,
    count: int = 20,
    buffer_refs: list[str] | None = None,
) -> dict:
    if user_id is None:
        return _empty(session_id, "auth_required")
    session_id = str(UUID(session_id))
    try:
        with session_lock(session_id) as lease:
            session = engine._load_session(session_id)
            if session:
                if session["user_id"] != user_id:
                    return _empty(session_id)
                cached = engine._redis().get(
                    f"{engine._session_key(session_id)}:batch:0"
                )
                return json.loads(cached) if cached else _empty(session_id)
            if engine._redis().get(f"{engine._session_key(session_id)}:started"):
                return _empty(session_id)
            created = engine._create_radio(
                user_id,
                mode,
                seed_type,
                seed_value,
                session_id=session_id,
                count=count,
                buffer_refs=buffer_refs,
            )
            if not created:
                return _empty(session_id)
            session, result = created
            session["revision"] = 1
            return _commit(session, result, 0, lease)
    except RadioLeaseLost:
        return _recover_batch(session_id, user_id, 0)


def next_batch(
    session_id: str,
    *,
    user_id: int,
    batch_index: int,
    revision: int = 1,
    count: int = 20,
    buffer_refs: list[str] | None = None,
) -> dict:
    if user_id is None:
        return _empty(session_id, "auth_required")
    try:
        with session_lock(session_id) as lease:
            session = engine._load_session(session_id)
            if (
                not session
                or session["user_id"] != user_id
                or revision != session.get("revision", 1)
            ):
                return _empty(session_id)
            cached = engine._redis().get(
                f"{engine._session_key(session_id)}:batch:{batch_index}"
            )
            if cached:
                return json.loads(cached)
            expected = int(session.get("batch_index", 0)) + 1
            if batch_index != expected:
                return _empty(session_id, "retryable_empty", batch_index=expected - 1)
            engine._apply_buffer_context(session, buffer_refs or [])
            return _commit(
                session, engine._advance_radio(session, count), batch_index, lease
            )
    except RadioLeaseLost:
        return _recover_batch(session_id, user_id, batch_index)
