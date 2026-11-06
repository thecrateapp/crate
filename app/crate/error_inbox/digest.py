"""Sanitised digest of the latest event of an error issue.

The digest is the only part of an event that leaves the worker towards a model, and
what the admin detail view renders. It keeps the exception chain, the app's own
frames with the context lines Sentry already stores, an allowlist of tags and short
breadcrumbs. Frame variables, request data and user data never enter it. On top of
the SDK scrubbing it reduces library paths, drops query strings and removes e-mail
and IP addresses with fixed patterns.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

DIGEST_VERSION = 1
MAX_DIGEST_BYTES = 24 * 1024
MAX_EXCEPTIONS = 3
MAX_EXCEPTION_VALUE = 500
MAX_MESSAGE = 500
MAX_FRAMES = 20
CONTEXT_WINDOW = 5
MAX_CONTEXT_LINE = 200
MAX_BREADCRUMBS = 10
MAX_BREADCRUMB_MESSAGE = 160
MAX_NAME = 300
MAX_SERVICE_LENGTH = 100
TAG_ALLOWLIST = (
    "service",
    "environment",
    "release",
    "runtime",
    "transaction",
    "route",
    "task_type",
    "browser.name",
    "os.name",
    "device.family",
)

_MUSIC_PATH = re.compile(r"/music/[^\r\n]*")
_QUERY_STRING = re.compile(r"\?[^\s#'\"<>]*=[^\s#'\"<>]*")
_EMAIL = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
)
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6 = re.compile(r"(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])")
_UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_LONG_HEX = re.compile(r"\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{8,}\b")
_DIGITS = re.compile(r"\d+")
_BUNDLE_HASH = re.compile(r"-[A-Za-z0-9_-]{8}(\.m?js)$")


def _ipv6(match: re.Match[str]) -> str:
    candidate = match.group(0)
    looks_like_address = "::" in candidate or candidate.count(":") == 7
    if looks_like_address and any(char.isdigit() for char in candidate):
        return "<ip>"
    return candidate


def sanitize_text(value: Any, limit: int) -> str:
    """Apply the digest's extra scrubbing to free text and cap its length."""
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = _MUSIC_PATH.sub("/music/<path>", text)
    text = _QUERY_STRING.sub("", text)
    text = _EMAIL.sub("<email>", text)
    text = _IPV4.sub("<ip>", text)
    text = _IPV6.sub(_ipv6, text)
    return text[:limit]


def _name(value: Any) -> str | None:
    if not value:
        return None
    return sanitize_text(value, MAX_NAME) or None


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _entry(event: Mapping[str, Any], kind: str) -> Mapping[str, Any]:
    for entry in event.get("entries") or []:
        if isinstance(entry, Mapping) and entry.get("type") == kind:
            data = entry.get("data")
            return data if isinstance(data, Mapping) else {}
    return {}


def _values(data: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [value for value in data.get("values") or [] if isinstance(value, Mapping)]


def _frame(raw: Mapping[str, Any]) -> dict[str, Any]:
    lineno = _int(raw.get("lineNo"))
    context: list[list[Any]] = []
    for item in raw.get("context") or []:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        line = _int(item[0])
        if line is None or (lineno is not None and abs(line - lineno) > CONTEXT_WINDOW):
            continue
        context.append([line, sanitize_text(item[1], MAX_CONTEXT_LINE)])
    return {
        "module": _name(raw.get("module")),
        "function": _name(raw.get("function")),
        "filename": _name(raw.get("filename")),
        "lineno": lineno,
        "context": context,
    }


def _app_frames(exceptions: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    for value in reversed(exceptions):
        stacktrace = value.get("stacktrace")
        frames = stacktrace.get("frames") if isinstance(stacktrace, Mapping) else None
        if frames:
            in_app = [
                frame
                for frame in frames
                if isinstance(frame, Mapping) and frame.get("inApp")
            ]
            return [_frame(frame) for frame in in_app[-MAX_FRAMES:]]
    return []


def _exception(value: Mapping[str, Any]) -> dict[str, Any]:
    mechanism = value.get("mechanism")
    mechanism = mechanism if isinstance(mechanism, Mapping) else {}
    handled = mechanism.get("handled")
    return {
        "type": _name(value.get("type")),
        "value": sanitize_text(value.get("value"), MAX_EXCEPTION_VALUE),
        "module": _name(value.get("module")),
        "mechanism": _name(mechanism.get("type")),
        "handled": handled if isinstance(handled, bool) else None,
    }


def _tags(event: Mapping[str, Any]) -> dict[str, str]:
    tags: dict[str, str] = {}
    for item in event.get("tags") or []:
        if isinstance(item, Mapping):
            key, value = item.get("key"), item.get("value")
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            key, value = item
        else:
            continue
        if key not in TAG_ALLOWLIST or value in (None, ""):
            continue
        tags[key] = (
            str(value)[:MAX_NAME]
            if key == "release"
            else sanitize_text(value, MAX_NAME)
        )
    return tags


def _breadcrumb(raw: Mapping[str, Any]) -> dict[str, Any]:
    message = raw.get("message")
    data = raw.get("data")
    if not message and isinstance(data, Mapping) and data.get("url"):
        status = data.get("status_code")
        message = " ".join(
            part
            for part in (
                str(data.get("method") or ""),
                str(data.get("url")),
                f"[{status}]" if status is not None else "",
            )
            if part
        )
    return {
        "category": _name(raw.get("category")),
        "level": _name(raw.get("level")),
        "message": sanitize_text(message, MAX_BREADCRUMB_MESSAGE),
    }


def _release(event: Mapping[str, Any]) -> str | None:
    release = event.get("release")
    if isinstance(release, Mapping):
        release = release.get("version")
    return str(release)[:MAX_NAME] if release else None


def _size(digest: Mapping[str, Any]) -> int:
    return len(json.dumps(digest, ensure_ascii=False, separators=(",", ":")).encode())


def _fit(digest: dict[str, Any]) -> dict[str, Any]:
    """Trim breadcrumbs, then context lines, then outer frames until it fits."""
    if _size(digest) <= MAX_DIGEST_BYTES:
        return digest
    digest["truncated"] = True
    while digest["breadcrumbs"] and _size(digest) > MAX_DIGEST_BYTES:
        digest["breadcrumbs"].pop(0)
    for window in (3, 2, 1, 0):
        if _size(digest) <= MAX_DIGEST_BYTES:
            return digest
        for frame in digest["frames"]:
            lineno = frame["lineno"]
            frame["context"] = [
                line
                for line in frame["context"]
                if lineno is not None and abs(line[0] - lineno) <= window
            ]
    if _size(digest) > MAX_DIGEST_BYTES:
        for frame in digest["frames"]:
            frame["context"] = []
    while len(digest["frames"]) > 1 and _size(digest) > MAX_DIGEST_BYTES:
        digest["frames"].pop(0)
    return digest


def build_digest(event: Mapping[str, Any]) -> dict[str, Any]:
    exception_values = _values(_entry(event, "exception"))
    exceptions = [_exception(value) for value in exception_values[-MAX_EXCEPTIONS:]]
    message = sanitize_text(event.get("message"), MAX_MESSAGE) or None
    if message is None and not exceptions:
        message = sanitize_text(event.get("title"), MAX_MESSAGE) or None
    digest = {
        "v": DIGEST_VERSION,
        "event_id": _name(event.get("eventID") or event.get("id")),
        "platform": _name(event.get("platform")),
        "release": _release(event),
        "message": message,
        "exceptions": exceptions,
        "frames": _app_frames(exception_values),
        "tags": _tags(event),
        "breadcrumbs": [
            _breadcrumb(crumb)
            for crumb in _values(_entry(event, "breadcrumbs"))[-MAX_BREADCRUMBS:]
        ],
        "truncated": False,
    }
    return _fit(digest)


def _normalized(text: Any) -> str:
    value = str(text or "")
    value = _UUID.sub("<id>", value)
    value = _LONG_HEX.sub("<hex>", value)
    return _DIGITS.sub("#", value)


def _location(frame: Mapping[str, Any]) -> str:
    if frame.get("module"):
        return str(frame["module"])
    filename = str(frame.get("filename") or "").split("?", 1)[0]
    for prefix in ("webpack:///", "app:///"):
        filename = filename.removeprefix(prefix)
    while filename.startswith(("./", "../")):
        filename = filename.removeprefix("./").removeprefix("../")
    return _BUNDLE_HASH.sub(r"\1", filename)


def digest_hash(digest: Mapping[str, Any]) -> str:
    """Hash of the content that matters for triage; stable across events and releases."""
    exceptions = digest.get("exceptions") or []
    payload = {
        "exceptions": [
            [item.get("type"), _normalized(item.get("value"))] for item in exceptions
        ],
        "message": None if exceptions else _normalized(digest.get("message")),
        "frames": [
            [_location(frame), frame.get("function")]
            for frame in digest.get("frames") or []
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def service_tag(digest: Mapping[str, Any]) -> str | None:
    """The `service` tag of the digest's event: the inbox's service when present."""
    tags = digest.get("tags")
    value = tags.get("service") if isinstance(tags, Mapping) else None
    if not isinstance(value, str):
        return None
    return value.strip()[:MAX_SERVICE_LENGTH] or None


def group_key(digest: Mapping[str, Any]) -> str:
    """Exception type plus the innermost app frame: candidates for duplicates."""
    exceptions = digest.get("exceptions") or []
    main = exceptions[-1] if exceptions else {}
    frames = digest.get("frames") or []
    if frames:
        anchor = f"{_location(frames[-1])}:{frames[-1].get('function') or ''}"
    else:
        anchor = _normalized(main.get("value") or digest.get("message"))
    encoded = json.dumps([main.get("type"), anchor], separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()[:16]


__all__ = [
    "MAX_DIGEST_BYTES",
    "TAG_ALLOWLIST",
    "build_digest",
    "digest_hash",
    "group_key",
    "sanitize_text",
    "service_tag",
]
