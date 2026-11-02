"""Atomic, user-bound radio batches shared by foreground and native playback."""

from contextlib import contextmanager
import json
from uuid import UUID

from redis.exceptions import LockError, WatchError

from crate import radio_engine as engine
from crate.observability.recommendations import (
    note_radio_generated,
    note_radio_recovered,
    observe_radio_batch,
)


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
    )


def _profile(session: dict) -> str:
    return str(
        session.get("radio_profile") or engine._radio_profile(session.get("seed_type"))
    )


def _commit(session: dict, result: dict, index: int, lease) -> dict:
    result = {
        **result,
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
        if index >= 2:
            pipe.delete(f"{key}:batch:{index - 2}")
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
    with observe_radio_batch("start", count) as observation:
        observation["result"] = _start_batch(
            session_id=session_id,
            user_id=user_id,
            mode=mode,
            seed_type=seed_type,
            seed_value=seed_value,
            count=count,
            buffer_refs=buffer_refs,
        )
    return observation["result"]


def _start_batch(
    *,
    session_id: str,
    user_id: int,
    mode: str,
    seed_type: str | None,
    seed_value: str | None,
    count: int,
    buffer_refs: list[str] | None,
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
                if cached:
                    return json.loads(cached)
                return _empty(
                    session_id,
                    "retryable_empty",
                    batch_index=int(session.get("batch_index", 0)),
                )
            if engine._redis().get(f"{engine._session_key(session_id)}:started"):
                return _empty(session_id)
            note_radio_generated(
                engine._radio_profile(seed_type if mode == "seeded" else None)
            )
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
            note_radio_generated(_profile(session))
            return _commit(session, result, 0, lease)
    except RadioLeaseLost:
        note_radio_recovered()
        return _recover_batch(session_id, user_id, 0)


def next_batch(
    session_id: str,
    *,
    user_id: int,
    batch_index: int,
    count: int = 20,
    buffer_refs: list[str] | None = None,
) -> dict:
    with observe_radio_batch("next", count) as observation:
        observation["result"] = _next_batch(
            session_id,
            user_id=user_id,
            batch_index=batch_index,
            count=count,
            buffer_refs=buffer_refs,
        )
    return observation["result"]


def _next_batch(
    session_id: str,
    *,
    user_id: int,
    batch_index: int,
    count: int,
    buffer_refs: list[str] | None,
) -> dict:
    if user_id is None:
        return _empty(session_id, "auth_required")
    session_id = str(UUID(session_id))
    try:
        with session_lock(session_id) as lease:
            session = engine._load_session(session_id)
            if not session or session["user_id"] != user_id:
                return _empty(session_id)
            cached = engine._redis().get(
                f"{engine._session_key(session_id)}:batch:{batch_index}"
            )
            if cached:
                return json.loads(cached)
            expected = int(session.get("batch_index", 0)) + 1
            if batch_index != expected:
                return _empty(session_id, "retryable_empty", batch_index=expected - 1)
            note_radio_generated(_profile(session))
            engine._apply_buffer_context(session, buffer_refs)
            return _commit(
                session, engine._advance_radio(session, count), batch_index, lease
            )
    except RadioLeaseLost:
        note_radio_recovered()
        return _recover_batch(session_id, user_id, batch_index)
