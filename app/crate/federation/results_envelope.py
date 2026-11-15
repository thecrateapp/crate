"""The remote search result envelope, ``crate.federation.results/1`` (FED-D5).

The owner answers a remote search with this envelope instead of its full API
DTOs. It carries remote identities, a small set of display fields, playback
availability and a metadata lease (FED-D7). Changes are additive: readers ignore
fields they do not know, and every field except the identity is optional.

The requesting node (A) maps the envelope into the search contract Listen
already consumes (``origin: "remote"`` items with ``node_uid`` and
``remote_entity_uid``), with ``envelope_to_search_contract``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

log = logging.getLogger(__name__)

RESULTS_CONTRACT = "crate.federation.results/1"
# FED-D7 (decided by Diego, 2026-11-12): metadata leases last 24 h. Revocations
# are pushed through the delta feed; the lease only bounds an unreachable owner.
SEARCH_LEASE_TTL = timedelta(hours=24)

EntityType = Literal["artist", "album", "track"]
ENTITY_TYPES: tuple[EntityType, ...] = ("artist", "album", "track")
_GROUP_BY_TYPE: dict[str, str] = {
    "artist": "artists",
    "album": "albums",
    "track": "tracks",
}


class _Lenient(BaseModel):
    """Unknown fields are ignored so owners can add fields without a new contract."""

    model_config = ConfigDict(extra="ignore")


def _lenient_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        text = value.strip()[:4] if value.strip()[:4].isdigit() else value.strip()
        try:
            return int(text)
        except ValueError:
            return None
    return None


class EnvelopeSource(_Lenient):
    node_uid: str
    node_name: str | None = None
    fetched_at: datetime | None = None


class EnvelopeCover(_Lenient):
    url: str | None = None
    etag: str | None = None


class EnvelopeFields(_Lenient):
    name: str | None = None
    artist: str | None = None
    album: str | None = None
    year: int | None = None
    duration_ms: int | None = None
    track_number: int | None = None
    mbid: str | None = None
    isrc: str | None = None
    cover: EnvelopeCover | None = None

    @field_validator("year", "duration_ms", "track_number", mode="before")
    @classmethod
    def _int_or_none(cls, value: Any) -> int | None:
        return _lenient_int(value)


class EnvelopeAvailability(_Lenient):
    playable: bool | None = None
    formats: list[str] = Field(default_factory=list)
    bitrate: int | None = None

    @field_validator("bitrate", mode="before")
    @classmethod
    def _bitrate(cls, value: Any) -> int | None:
        return _lenient_int(value)


class EnvelopeLease(_Lenient):
    scope: str | None = None
    expires_at: datetime | None = None


class EnvelopeItem(_Lenient):
    entity_type: EntityType
    remote_entity_uid: str = Field(min_length=1)
    revision: str | None = None
    fields: EnvelopeFields = Field(default_factory=EnvelopeFields)
    availability: EnvelopeAvailability | None = None
    lease: EnvelopeLease | None = None


class EnvelopeCoverage(_Lenient):
    complete: bool = True
    truncated: bool = False


class ResultsEnvelope(_Lenient):
    contract: Literal["crate.federation.results/1"]
    source: EnvelopeSource
    items: list[EnvelopeItem] = Field(default_factory=list)
    coverage: EnvelopeCoverage = Field(default_factory=EnvelopeCoverage)


class _EnvelopeShell(_Lenient):
    contract: Literal["crate.federation.results/1"]
    source: EnvelopeSource
    items: list[Any] = Field(default_factory=list)
    coverage: EnvelopeCoverage = Field(default_factory=EnvelopeCoverage)


# ── Owner side ────────────────────────────────────────────────────────────


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _compact(mapping: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in mapping.items() if value is not None}


def _artist_item(row: dict[str, Any]) -> dict[str, Any]:
    return {"fields": _compact({"name": _clean(row.get("name"))})}


def _album_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "fields": _compact(
            {
                "name": _clean(row.get("name")),
                "artist": _clean(row.get("artist")),
                "year": _lenient_int(row.get("year")),
                "mbid": _clean(row.get("musicbrainz_albumid")),
            }
        )
    }


def _track_item(row: dict[str, Any]) -> dict[str, Any]:
    duration = row.get("duration")
    duration_ms = (
        int(round(float(duration) * 1000))
        if isinstance(duration, (int, float)) and not isinstance(duration, bool)
        else None
    )
    fmt = _clean(row.get("format"))
    return {
        "fields": _compact(
            {
                "name": _clean(row.get("title")),
                "artist": _clean(row.get("artist")),
                "album": _clean(row.get("album")),
                "year": _lenient_int(row.get("year")),
                "duration_ms": duration_ms,
                "track_number": _lenient_int(row.get("track_number")),
                "mbid": _clean(row.get("musicbrainz_trackid")),
                "isrc": _clean(row.get("isrc")),
            }
        ),
        "availability": _compact(
            {
                # The owner searched its own library: a row it returns is a file
                # it can serve. Playback revalidates at play time (FED-D7).
                "playable": row.get("playable", True) is not False,
                "formats": [str(fmt).lower()] if fmt else [],
                "bitrate": _lenient_int(row.get("bitrate")),
            }
        ),
    }


_ITEM_BUILDERS = {
    "artists": ("artist", _artist_item),
    "albums": ("album", _album_item),
    "tracks": ("track", _track_item),
}


def build_results_envelope(
    payload: dict[str, list[dict[str, Any]]],
    *,
    node_uid: str,
    node_name: str | None,
    lease_scope: str,
    truncated: bool,
    now: datetime | None = None,
    complete: bool = True,
) -> dict[str, Any]:
    """Build the owner's envelope from local search rows.

    Only whitelisted fields are copied, so local ids, slugs and paths never leave
    the owner. Rows without an ``entity_uid`` have no remote identity and are
    left out.
    """
    fetched_at = now or datetime.now(UTC)
    lease = {
        "scope": lease_scope,
        "expires_at": (fetched_at + SEARCH_LEASE_TTL).isoformat(),
    }
    items: list[dict[str, Any]] = []
    for group, (entity_type, build) in _ITEM_BUILDERS.items():
        for row in payload.get(group) or []:
            remote_entity_uid = _clean(row.get("entity_uid"))
            if not remote_entity_uid:
                continue
            items.append(
                {
                    "entity_type": entity_type,
                    "remote_entity_uid": str(remote_entity_uid),
                    **build(row),
                    "lease": dict(lease),
                }
            )
    return {
        "contract": RESULTS_CONTRACT,
        "source": _compact(
            {
                "node_uid": str(node_uid),
                "node_name": node_name,
                "fetched_at": fetched_at.isoformat(),
            }
        ),
        "items": items,
        "coverage": {"complete": complete, "truncated": truncated},
    }


# ── Requesting side (A) ───────────────────────────────────────────────────


def is_results_envelope(raw: Any) -> bool:
    return isinstance(raw, dict) and "contract" in raw


def parse_results_envelope(raw: Any) -> ResultsEnvelope | None:
    """Validate an envelope; ``None`` for anything that is not a v1 envelope.

    A malformed or unknown item is skipped on its own, so one bad row never hides
    the rest of a peer's answer.
    """
    if not isinstance(raw, dict):
        return None
    try:
        shell = _EnvelopeShell.model_validate(raw)
    except ValidationError:
        return None
    items: list[EnvelopeItem] = []
    skipped = 0
    for raw_item in shell.items:
        try:
            items.append(EnvelopeItem.model_validate(raw_item))
        except ValidationError:
            skipped += 1
    if skipped:
        log.debug(
            "Skipped %d unreadable item(s) from %s", skipped, shell.source.node_uid
        )
    return ResultsEnvelope(
        contract=shell.contract,
        source=shell.source,
        items=items,
        coverage=shell.coverage,
    )


def _grant_allows(peer: dict[str, Any], capability: str) -> bool:
    from crate.federation.grants import preset_allows

    try:
        return preset_allows(
            str(peer.get("default_grant_preset") or "discovery"), capability
        )
    except ValueError:
        return False


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _year_text(value: int | None) -> str | None:
    return str(value) if value is not None else None


def envelope_to_search_contract(
    envelope: ResultsEnvelope,
    *,
    peer: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Map an owner's envelope into Listen's search contract.

    The peer identity comes from the pairing record, never from the payload. Items
    whose lease has expired are hidden (FED-D7). Results never carry the owner's
    local ids or slugs, so they cannot be mistaken for local entities.
    """
    peer_uid = str(peer["node_uid"])
    if str(envelope.source.node_uid) != peer_uid:
        raise ValueError("Envelope source does not match the queried peer")
    current = now or datetime.now(UTC)
    source = {
        "origin": "remote",
        "node_uid": peer_uid,
        "node_name": peer.get("display_name") or envelope.source.node_name or "",
    }
    may_stream = _grant_allows(peer, "stream.proxy")
    may_import = _grant_allows(peer, "import.request")

    results: dict[str, list[dict[str, Any]]] = {
        "artists": [],
        "albums": [],
        "tracks": [],
    }
    for item in envelope.items:
        expires_at = item.lease.expires_at if item.lease else None
        if expires_at is not None and _aware(expires_at) <= current:
            continue
        fields = item.fields
        base = {**source, "remote_entity_uid": item.remote_entity_uid}
        if item.entity_type == "artist":
            entry = {**base, "name": fields.name or ""}
        elif item.entity_type == "album":
            entry = _compact(
                {
                    **base,
                    "name": fields.name or "",
                    "artist": fields.artist or "",
                    "year": _year_text(fields.year),
                    "mbid": fields.mbid,
                }
            )
        else:
            availability = item.availability or EnvelopeAvailability()
            entry = _compact(
                {
                    **base,
                    "title": fields.name or "",
                    "artist": fields.artist or "",
                    "album": fields.album or "",
                    "year": _year_text(fields.year),
                    "duration": (
                        fields.duration_ms / 1000
                        if fields.duration_ms is not None
                        else None
                    ),
                    "track_number": fields.track_number,
                    "format": availability.formats[0] if availability.formats else None,
                    "bitrate": availability.bitrate,
                    "mbid": fields.mbid,
                    "isrc": fields.isrc,
                    "availability": {
                        "catalog": True,
                        "stream": may_stream and availability.playable is not False,
                        "import": may_import,
                    },
                    "lease_expires_at": (
                        _aware(expires_at).isoformat()
                        if expires_at is not None
                        else None
                    ),
                }
            )
        results[_GROUP_BY_TYPE[item.entity_type]].append(entry)
    return results
