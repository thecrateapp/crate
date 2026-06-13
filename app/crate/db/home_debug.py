from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from time import perf_counter

_HOME_DEBUG: ContextVar[dict | None] = ContextVar("home_debug", default=None)


@contextmanager
def collect_home_debug() -> Iterator[dict]:
    payload: dict = {"mixes": {}, "started_at": perf_counter()}
    token = _HOME_DEBUG.set(payload)
    try:
        yield payload
    finally:
        payload["snapshot_build_ms"] = round(
            (perf_counter() - float(payload["started_at"])) * 1000, 2
        )
        payload.pop("started_at", None)
        _HOME_DEBUG.reset(token)


def record_home_mix_debug(mix_id: str, diagnostics: dict) -> None:
    payload = _HOME_DEBUG.get()
    if payload is None:
        return
    mixes = payload.setdefault("mixes", {})
    mixes[mix_id] = diagnostics


def record_home_hero_debug(diagnostics: dict) -> None:
    payload = _HOME_DEBUG.get()
    if payload is None:
        return
    payload["hero"] = diagnostics


__all__ = ["collect_home_debug", "record_home_hero_debug", "record_home_mix_debug"]
