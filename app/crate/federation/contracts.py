"""
Federation API contracts — search DTOs, remote track refs, and cross-instance
semantics.

These contracts are the Phase 0 deliverable that bridges the backend protocol
and the frontend implementation. Phase 1 backend and Phase 2 frontend must both
conform to these shapes.
"""

from __future__ import annotations

from enum import StrEnum
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


PROTOCOL_VERSION = "v1"
MIN_PROTOCOL_VERSION = "v1"
SUPPORTED_PROTOCOL_VERSIONS = (PROTOCOL_VERSION,)
SIGNATURE_PROFILE = "crate-ed25519-v1"

CAPABILITIES = frozenset(
    {
        "catalog.search",
        "catalog.sync",
        "catalog.artist.read",
        "catalog.album.read",
        "catalog.track.read",
        "catalog.metadata.genres",
        "artwork.read",
        "stream.proxy",
        "stream.transcoded",
        "stream.original",
        "import.request",
        "import.pull",
    }
)

# Every advertised node-to-node capability is backed by these public protocol
# operations. Contract tests compare this registry with generated OpenAPI so a
# descriptor cannot silently claim an unimplemented capability.
CAPABILITY_ENDPOINTS: dict[str, tuple[tuple[str, str], ...]] = {
    "catalog.search": (("POST", "/api/federation/v1/search"),),
    "catalog.sync": (
        ("GET", "/api/federation/v1/catalog/manifest"),
        ("GET", "/api/federation/v1/catalog/delta"),
    ),
    "catalog.artist.read": (("GET", "/api/federation/v1/artists/{remote_entity_uid}"),),
    "catalog.album.read": (("GET", "/api/federation/v1/albums/{remote_entity_uid}"),),
    "catalog.track.read": (("GET", "/api/federation/v1/tracks/{remote_entity_uid}"),),
    "catalog.metadata.genres": (
        (
            "GET",
            "/api/federation/v1/facets/{entity_type}/{remote_entity_uid}/{facet}",
        ),
    ),
    "artwork.read": (("GET", "/api/federation/v1/artwork/{remote_entity_uid}"),),
    "stream.proxy": (
        ("POST", "/api/federation/v1/stream-tickets"),
        ("GET", "/api/federation/v1/streams/{ticket_uid}"),
    ),
    "stream.transcoded": (("POST", "/api/federation/v1/stream-tickets"),),
    "stream.original": (("POST", "/api/federation/v1/stream-tickets"),),
    "import.request": (
        ("GET", "/api/federation/v1/albums/{remote_entity_uid}/import-manifest"),
    ),
    "import.pull": (("GET", "/api/federation/v1/import-files/{remote_entity_uid}"),),
}


class FederationErrorCode(StrEnum):
    SELF_PEER = "self_peer"
    REPLAY = "replay"
    CLOCK_SKEW = "clock_skew"
    UNKNOWN_KEY = "unknown_key"
    INVALID_DESCRIPTOR = "invalid_descriptor"
    INCOMPATIBLE_VERSION = "incompatible_version"
    GRANT_DENIED = "grant_denied"
    UNSAFE_URL = "unsafe_url"
    REDIRECT_DISALLOWED = "redirect_disallowed"
    STREAM_REVOKED = "stream_revoked"
    INVALID_CURSOR = "invalid_cursor"


class FederationProtocolError(ValueError):
    def __init__(self, code: FederationErrorCode, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


class DescriptorPublicKeyV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key_id: str
    algorithm: Literal["ed25519"] = "ed25519"
    public_key: str
    status: Literal["pending", "active", "retiring"]
    not_before: datetime | None = None
    not_after: datetime | None = None


class TaxonomyReleaseDescriptorV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    taxonomy_id: str
    version: str
    digest: str
    key_id: str
    signature: str


class NodeDescriptorV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_uid: str
    name: str
    software: Literal["crate"] = "crate"
    version: str
    api_base_url: str
    listen_base_url: str | None = None
    audience: Literal["public"] = "public"
    protocol_version: str
    min_protocol_version: str
    federation_protocol_versions: list[str]
    signature_profile: str
    signature_versions: list[str]
    active_key_id: str
    public_keys: list[DescriptorPublicKeyV1]
    capabilities: list[str]
    taxonomy_release: TaxonomyReleaseDescriptorV1 | None = None
    signed_at: datetime
    expires_at: datetime
    descriptor_digest: str
    key_id: str
    signature: str


def require_remote_node(local_node_uid: str, remote_node_uid: str) -> str:
    local_uid = str(local_node_uid).strip()
    remote_uid = str(remote_node_uid).strip()
    if not remote_uid:
        raise FederationProtocolError(
            FederationErrorCode.INVALID_DESCRIPTOR,
            "Remote descriptor omitted node_uid",
        )
    if local_uid and remote_uid == local_uid:
        raise FederationProtocolError(
            FederationErrorCode.SELF_PEER,
            "A Crate node cannot be paired with itself",
        )
    return remote_uid


def negotiate_protocol(remote_versions: list[str] | tuple[str, ...]) -> str:
    remote = {
        str(version).strip() for version in remote_versions if str(version).strip()
    }
    for version in reversed(SUPPORTED_PROTOCOL_VERSIONS):
        if version in remote:
            return version
    raise FederationProtocolError(
        FederationErrorCode.INCOMPATIBLE_VERSION,
        "No compatible federation protocol version",
    )


# ── Search DTO Contract ───────────────────────────────────────────────────

# Phase 0 decision: unified typed result lists with origin.
# Local results omit `origin` (treated as "local").
# Remote results include `origin: "remote"` plus remote ref fields.
# There is NO separate `remote` envelope.

# Existing local search response (unchanged):
# {
#   "artists": [SearchArtistResultResponse],
#   "albums":  [SearchAlbumResultResponse],
#   "tracks":  [TrackRefResponse]
# }

# Extended search result shapes for federation:

# Added to artist results when origin is "remote":
#   origin: "remote"
#   node_uid: str
#   node_name: str
#   remote_entity_uid: str
#   availability: { catalog: bool, stream: bool, import: bool }
#   match: { confidence: float, matched_by: [str] }  # optional

# Added to album results when origin is "remote":
#   origin: "remote"
#   node_uid: str
#   node_name: str
#   remote_entity_uid: str
#   availability: { catalog: bool, stream: bool, import: bool }
#   match: { confidence: float, matched_by: [str] }  # optional

# Added to track results when origin is "remote":
#   origin: "remote"
#   node_uid: str
#   node_name: str
#   remote_entity_uid: str
#   availability: { catalog: bool, stream: bool, import: bool, stale?: bool }
#   match: { confidence: float, matched_by: [str] }  # optional

# Rules:
# - Remote results must NOT include local numeric IDs, local filesystem paths,
#   raw stream URLs, or bearer tokens.
# - Remote results live in the SAME `artists`, `albums`, `tracks` arrays.
# - cache keys must include scope, authorization context, peer revision,
#   and limit.

TrackOrigin = Literal["local", "remote"]


class RemoteTrackRef:
    """Client-side contract for a track that lives on a remote node."""

    node_uid: str
    node_name: str
    remote_entity_uid: str
    availability: RemoteAvailability


class RemoteAvailability:
    catalog: bool
    stream: bool
    import_: bool
    stale: bool | None = None


# ── Remote Track Contract ──────────────────────────────────────────────────

# A playable remote track in Listen must carry:
#
#   origin: "remote"
#   remote: RemoteTrackRef
#
# It must NOT include:
#   - local libraryTrackId
#   - local entityUid
#   - local path
#   - durable stream URLs
#   - bearer tokens
#   - raw remote media URLs
#
# getStreamUrl() must resolve remote tracks through a local playback resolver
# endpoint, never by constructing /api/tracks/.../stream from remote opaque IDs.

# ── Cross-instance Semantics ───────────────────────────────────────────────

# Queue:
#   - May contain remote tracks as safe remote refs.
#   - May persist: origin, remote.nodeUid, remote.remoteEntityUid, display
#     metadata, cover proxy URL.
#   - Must NOT persist: ticket URLs, bearer tokens, one-time stream URLs,
#     raw remote media URLs, local-only paths, local-only IDs.
#   - If a peer goes offline while a remote item is queued, the item remains
#     visible but playback resolution fails as a recoverable error.
#   - The player may skip to the next playable item only after surfacing the
#     remote failure; it should not silently delete the queued item.

# Playlists:
#   - Persist canonical global_track_uid references, never remote ticket URLs.
#   - Playback resolves the currently selected source when the playlist is read.
#   - Legacy local track references remain valid and are backfilled to global IDs.

# Favorites/Likes:
#   - Persist canonical global_track_uid locally and remain visible while a peer is down.
#   - Legacy local likes dual-read and backfill to the same canonical identity.

# Offline Cache:
#   - Remote tracks are not offline-capable until Phase 5 import.
#   - UI must hide/disable offline controls for remote tracks.

# Scrobbling (Last.fm):
#   - Off by default for remote playback.

# Track Radio / Smart Play:
#   - Canonical global track/artist IDs are valid seeds.
#   - Source selection happens at playback time; local-only analysis stays optional.

# Recommendations / Infinite Playback:
#   - Global catalog tracks may participate when policy and availability permit.
#   - Unavailable remote sources are skipped without deleting user references.

# Import:
#   - The explicit boundary where a remote track becomes a normal local item.
#   - After import, the track participates in all local features normally.

# ── Search scope parameter ─────────────────────────────────────────────────

# GET /api/search?scope=local|auto|federated
#
#   local:     local catalog only (default, backward compatible)
#   auto:      local first, remote fallback/parallel if policy allows
#   federated: local + all trusted peers allowed by policy
#
# Node-first catalog routes are canonical. Compatibility routes preserve their
# legacy shape while resolving through the same local-plus-approved-source model.

# ── i18n Labels ────────────────────────────────────────────────────────────

# All Listen-visible federation strings must go through the i18n catalog
# system. Suggested keys:

#   federation.remote.onNode:     "On {{nodeName}}"
#   federation.remote.label:      "Remote"
#   federation.remote.available:  "Available remotely"
#   federation.remote.stale:      "Remote catalog may be stale"
#   federation.remote.unavailable: "Remote source unavailable"
