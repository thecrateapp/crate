"""
Federation API contracts — search DTOs, remote track refs, and cross-instance
semantics.

These contracts are the Phase 0 deliverable that bridges the backend protocol
and the frontend implementation. Phase 1 backend and Phase 2 frontend must both
conform to these shapes.
"""

from __future__ import annotations

from typing import Literal

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
#   - Local playlists may NOT persist remote tracks unless imported.
#   - API must reject playlist add for non-imported remote refs.

# Favorites/Likes:
#   - Out of scope for v1.

# Offline Cache:
#   - Remote tracks are not offline-capable until Phase 5 import.
#   - UI must hide/disable offline controls for remote tracks.

# Scrobbling (Last.fm):
#   - Off by default for remote playback.

# Track Radio / Smart Play:
#   - Remote tracks are not seedable.

# Recommendations / Infinite Playback:
#   - Remote tracks are not included until a later product decision.

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
# When scope is omitted, behavior matches today (local only).

# ── i18n Labels ────────────────────────────────────────────────────────────

# All Listen-visible federation strings must go through the i18n catalog
# system. Suggested keys:

#   federation.remote.onNode:     "On {{nodeName}}"
#   federation.remote.label:      "Remote"
#   federation.remote.available:  "Available remotely"
#   federation.remote.stale:      "Remote catalog may be stale"
#   federation.remote.unavailable: "Remote source unavailable"
