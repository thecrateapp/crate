from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
import uuid


EntityKind = Literal["artist", "album", "track"]
EntityScope = Literal["local", "global"]

_GLOBAL_PREFIXES: dict[EntityKind, str] = {
    "artist": "ga-",
    "album": "gal-",
    "track": "gt-",
}
_LOCAL_PREFIXES: dict[EntityKind, str] = {
    "artist": "ar-",
    "album": "al-",
    "track": "",
}


class SubsonicIdError(ValueError):
    code = 70
    message = "Invalid Subsonic entity ID"

    def __init__(self) -> None:
        super().__init__(self.message)


@dataclass(frozen=True, slots=True)
class SubsonicEntityId:
    kind: EntityKind
    scope: EntityScope
    local_id: int | None = None
    global_uid: str | None = None

    @property
    def identity(self) -> int | str:
        if self.scope == "local" and self.local_id is not None:
            return self.local_id
        if self.scope == "global" and self.global_uid is not None:
            return self.global_uid
        raise SubsonicIdError()


def decode_subsonic_id(value: str, *, expected_kind: EntityKind) -> SubsonicEntityId:
    raw = str(value or "").strip()
    for kind, prefix in sorted(
        _GLOBAL_PREFIXES.items(), key=lambda item: len(item[1]), reverse=True
    ):
        if raw.startswith(prefix):
            if kind != expected_kind:
                raise SubsonicIdError()
            try:
                global_uid = str(uuid.UUID(raw[len(prefix) :]))
            except (ValueError, AttributeError) as exc:
                raise SubsonicIdError() from exc
            return SubsonicEntityId(kind=kind, scope="global", global_uid=global_uid)

    local_prefix = _LOCAL_PREFIXES[expected_kind]
    local_value = raw
    if local_prefix:
        if not raw.startswith(local_prefix):
            raise SubsonicIdError()
        local_value = raw[len(local_prefix) :]
    elif any(raw.startswith(prefix) for prefix in ("ar-", "al-")):
        raise SubsonicIdError()
    try:
        local_id = int(local_value)
    except (TypeError, ValueError) as exc:
        raise SubsonicIdError() from exc
    if local_id <= 0:
        raise SubsonicIdError()
    return SubsonicEntityId(kind=expected_kind, scope="local", local_id=local_id)


def encode_subsonic_id(entity_id: SubsonicEntityId) -> str:
    if entity_id.scope == "global" and entity_id.global_uid:
        return f"{_GLOBAL_PREFIXES[entity_id.kind]}{uuid.UUID(entity_id.global_uid)}"
    if entity_id.scope == "local" and entity_id.local_id is not None:
        prefix = _LOCAL_PREFIXES[entity_id.kind]
        return f"{prefix}{entity_id.local_id}"
    raise SubsonicIdError()


def global_subsonic_id(kind: EntityKind, global_uid: str) -> str:
    return encode_subsonic_id(
        SubsonicEntityId(kind=kind, scope="global", global_uid=global_uid)
    )


def local_subsonic_id(kind: EntityKind, local_id: int) -> str:
    return encode_subsonic_id(
        SubsonicEntityId(kind=kind, scope="local", local_id=local_id)
    )


__all__ = [
    "EntityKind",
    "SubsonicEntityId",
    "SubsonicIdError",
    "decode_subsonic_id",
    "encode_subsonic_id",
    "global_subsonic_id",
    "local_subsonic_id",
]
