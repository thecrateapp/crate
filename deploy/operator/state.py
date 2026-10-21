"""Single-process durable state, bounded journals, and atomic outbox admission."""

import copy
import fcntl
import json
import os
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

MAX_BYTES = 16 * 1024 * 1024
LIMITS = {"events": 2000, "incidents": 500, "outbox": 1000, "evidence": 20}
RETENTION_SECONDS = 14 * 86400


class CapacityError(RuntimeError):
    """Admission stopped rather than silently deleting unresolved work."""


class State:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._lock = open(self.directory / "writer.lock", "a+b")  # noqa: SIM115 — held for process lifetime; close() releases it.
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock.close()
            raise RuntimeError("Operator state already has a writer") from None
        self.mutex = threading.RLock()
        self.path = self.directory / "state.json"
        try:
            if self.path.exists():
                if self.path.stat().st_size > MAX_BYTES:
                    raise ValueError("Operator state exceeds byte bound")
                self.data = json.loads(self.path.read_bytes())
                if self.data["schema"] != 1:
                    raise ValueError("Unsupported operator state schema")
            else:
                self.data = {
                    "schema": 1,
                    "sequence": 0,
                    "events": [],
                    "incidents": {},
                    "outbox": {},
                    "watches": {},
                    "rules": {},
                    "receipts": {},
                    "health": {},
                }
        except Exception:
            self.close()
            raise

    def close(self):
        self._lock.close()

    def snapshot(self):
        with self.mutex:
            return copy.deepcopy(self.data)

    @contextmanager
    def transaction(self):
        with self.mutex:
            working = copy.deepcopy(self.data)
            yield working
            raw = json.dumps(
                working, sort_keys=True, separators=(",", ":"), allow_nan=False
            ).encode()
            if len(raw) > MAX_BYTES:
                raise CapacityError("Operator state exceeds byte bound")
            temp = self.directory / "state.tmp"
            fd = os.open(temp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, self.path)
            # Publish after replace even if directory fsync fails: callers must treat
            # fsync failures as fatal, never continue from an obsolete in-memory copy.
            self.data = working
            fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def events(self, cursor=0, limit=50):
        if (
            type(cursor) is not int
            or cursor < 0
            or type(limit) is not int
            or not 1 <= limit <= 100
        ):
            raise ValueError("Invalid event cursor or limit")
        snapshot = self.snapshot()
        if cursor > snapshot["sequence"]:
            raise ValueError("Event cursor is ahead of this store")
        events = snapshot["events"]
        oldest = events[0]["seq"] if events else snapshot["sequence"] + 1
        selected = [event for event in events if event["seq"] > cursor][:limit]
        while len(json.dumps(selected).encode()) > 50000 and len(selected) > 1:
            selected.pop()
        return {
            "events": selected,
            "next_cursor": selected[-1]["seq"] if selected else snapshot["sequence"],
            "retention_gap": cursor < oldest - 1,
            "oldest_cursor": oldest - 1,
            "latest_cursor": snapshot["sequence"],
        }


def prune(data, now):
    data["events"] = [
        event for event in data["events"] if event["at"] >= now - RETENTION_SECONDS
    ][-LIMITS["events"] :]
    data["incidents"] = {
        key: item
        for key, item in data["incidents"].items()
        if item["state"] != "resolved" or item["updated_at"] >= now - RETENTION_SECONDS
    }
    # Pending, uncertain and dead-letter items are never silently expired. They
    # stay bounded by admission backpressure; confirmed delivery expires in 14d.
    data["outbox"] = {
        key: item
        for key, item in data["outbox"].items()
        if item["state"] != "delivered" or item["updated_at"] >= now - RETENTION_SECONDS
    }
    data["watches"] = {
        key: item for key, item in data["watches"].items() if item["expires_at"] > now
    }
    data["receipts"] = {
        key: expiry for key, expiry in data["receipts"].items() if expiry > now
    }


def event(data, kind, payload, now):
    data["sequence"] += 1
    item = {"seq": data["sequence"], "at": now, "kind": kind, "data": payload}
    data["events"].append(item)
    data["events"] = data["events"][-LIMITS["events"] :]
    return item


def enqueue(data, message, now, *, incident=None):
    if len(data["outbox"]) >= LIMITS["outbox"]:
        raise CapacityError("Outbox capacity reached; inspect retained dead letters")
    logical_id = uuid.uuid4().hex
    data["outbox"][logical_id] = {
        "id": logical_id,
        "message": f"[Crate alert {logical_id}] {message}"[:3500],
        "incident": incident,
        "state": "pending",
        "created_at": now,
        "updated_at": now,
        "next_at": now,
        "attempts": [],
        "generation": 0,
        "uncertain": False,
    }
    return logical_id
