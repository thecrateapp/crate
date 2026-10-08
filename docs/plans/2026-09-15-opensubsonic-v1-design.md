# OpenSubsonic v1 Compatibility Design

> **Status:** reviewed and corrected for execution on
> `codex/listen-design-system`.
>
> This design targets the OpenSubsonic protocol, not a Feishin-specific
> compatibility layer. Feishin and other clients are interoperability fixtures,
> not the source of truth.

## 1. Goal

Replace Crate's partial `/rest` implementation with a standards-driven,
observable and maintainable OpenSubsonic service. A compatible client should be
able to authenticate, browse the complete library, resolve every advertised
image, manage playlists and personal state, stream or download media, scrobble,
restore its queue and use the extensions Crate explicitly advertises.

The implementation must preserve Crate's canonical library and playback
services. OpenSubsonic is an adapter over those services, not a second music
domain or a client-specific fork.

## 2. Source of truth

The contract is pinned from the official OpenSubsonic project:

- [API reference](https://opensubsonic.netlify.app/docs/api-reference/)
- [Protocol overview](https://opensubsonic.netlify.app/docs/opensubsonic-api/)
- [OpenAPI contract](https://opensubsonic.netlify.app/docs/openapi/)
- [Protocol changes](https://opensubsonic.netlify.app/docs/opensubsonic-changes/)
- [API-key authentication extension](https://opensubsonic.netlify.app/docs/extensions/apikeyauth/)
- [Form POST extension](https://opensubsonic.netlify.app/docs/extensions/formpost/)
- [Cover-art endpoint](https://opensubsonic.netlify.app/docs/endpoints/getcoverart/)

Crate targets Subsonic API version `1.16.1` plus the OpenSubsonic v1 response
shape. Contract fixtures pin three complementary sources:

- the official OpenSubsonic OpenAPI document at an exact upstream commit for
  the JSON contract;
- the official Subsonic `1.16.1` XSD, identified by source URL and content
  digest, for the legacy XML contract;
- reviewed OpenSubsonic JSON/XML golden fixtures for enhanced fields and
  extensions not represented by the legacy XSD.

The OpenAPI document is explicitly work in progress and only describes JSON
requests using `f=json`; it is not treated as an XML schema or as the sole
source of truth. Likewise, the legacy XSD does not contain enhanced
OpenSubsonic fields such as `type`, `serverVersion` and `openSubsonic`.
Updating any pinned artifact or golden fixture is an explicit, reviewable
compatibility change.

OpenSubsonic intentionally makes most endpoint families optional. Therefore
"compatible" means:

1. the mandatory protocol kernel is correct;
2. every endpoint in the documented Crate Music Profile is correct;
3. only fully implemented extensions are advertised;
4. unsupported endpoint families fail with protocol errors, never invented
   success payloads.

## 3. Current-state findings

The existing implementation is a single large module,
`app/crate/api/subsonic.py`, with 16 endpoint families and local Pydantic
models. It is useful as a behavioral baseline, but it is not a reliable
OpenSubsonic boundary.

The production audit found:

- Authentication and basic catalog browsing generally return `200`.
- `getGenres` is missing and repeatedly returns `404` to real clients.
- `getPlaylists` is a hard-coded empty response despite Crate having playlists.
- `getStarred2` serializes songs only; artist and album favorites are omitted.
- Artist payloads omit `coverArt` even when Crate has a photo for the artist.
- Album images mostly work, but image references are not governed by a general
  resolvability invariant.
- `getCoverArt` ignores the standard `size` parameter.
- Search offsets and music-folder filtering are incomplete.
- Album-list strategies silently fall back when unsupported.
- Scrobble form bodies and repeated arrays are not parsed correctly.
- Capability flags returned by `getUser` overstate implemented behavior.
- Suspended or deleted users can reach authentication paths that should reject
  them.
- Access logs can include `p`, `t`, `s` and `apiKey` query parameters.
- Tests mostly validate permissive local models rather than the official
  JSON/XML contract.

The missing artwork reported by clients has two different causes and must not
be flattened into one workaround:

- Artist photos exist in the library but are not referenced by the serializer.
- A small set of albums genuinely has no cover; those items must omit
  `coverArt` or resolve to an explicit product fallback rather than advertise a
  broken URL.

## 4. Architectural boundaries

### 4.1 Protocol core

Protocol behavior is independent from FastAPI routing and database access:

```text
app/crate/subsonic/
  auth.py              authentication parsing and verification
  capabilities.py      server profile and advertised extensions
  errors.py            OpenSubsonic errors and HTTP mapping
  params.py            GET/form/repeated parameter normalization
  protocol.py          response envelope and JSON/XML/JSONP rendering
  serializers.py       strict wire serializers and ID references
  services/
    catalog.py
    discovery.py
    playback.py
    playlists.py
    preferences.py
    queues.py
```

The API adapter is split by endpoint family:

```text
app/crate/api/subsonic/
  __init__.py
  browsing.py
  discovery.py
  media.py
  operations.py
  playback.py
  playlists.py
  preferences.py
  system.py
```

Routers parse transport input and call services. They do not contain catalog
SQL, filesystem access, response-shape conditionals or client detection.

### 4.2 Domain reuse

OpenSubsonic endpoints reuse existing Crate repositories and services:

- canonical catalog queries for artists, albums and tracks;
- playlist repositories for CRUD and ordering;
- artwork lookup and variant generation;
- streaming, playback preparation and transcoding;
- lyrics providers;
- Bliss similarity and popularity queries;
- playback state and play-event recording;
- existing task dispatch for scan operations.

The adapter may add projection queries optimized for the wire contract, but it
must not duplicate ownership of library data.

### 4.3 Stable IDs

Responses use Crate's existing global IDs:

- artists: `ga-...`
- albums: `gal-...`
- tracks: `gt-...`

Legacy local numeric/path IDs remain accepted as input during the migration
window where unambiguous. New responses never emit them. Playlist and queue IDs
receive stable, typed codecs instead of exposing table implementation details.

## 5. Protocol contract

### 5.1 Envelope and formats

Every successful and failed protocol response uses the enhanced
`subsonic-response` envelope with:

- `status`;
- `version`;
- `type` and `serverVersion`;
- `openSubsonic: true`;
- the endpoint payload or protocol error.

Supported formats are JSON and XML. Safe JSONP is retained only if it can be
rendered without weakening callback validation. `.view` aliases and extensionless
paths share exactly the same handlers.

No validation path may leak FastAPI `422` payloads. Missing, malformed or
conflicting parameters are translated into the relevant OpenSubsonic envelope.

### 5.2 Errors

The shared error mapper implements at least:

| Code | Meaning in Crate |
| --- | --- |
| `0` | Generic protocol failure |
| `10` | Required parameter missing |
| `20` | Incompatible client protocol version |
| `30` | Incompatible server protocol version |
| `40` | Wrong username, password or legacy challenge token |
| `41` | Token authentication unsupported for the requested version |
| `42` | Provided authentication mechanism unsupported |
| `43` | Multiple conflicting authentication mechanisms |
| `44` | API key invalid |
| `50` | Authenticated user not authorized |
| `60` | Trial expired; retained for schema completeness, never emitted by Crate |
| `70` | Requested resource not found |

For non-binary protocol endpoints, application, validation and authentication
failures return HTTP `200` with the requested OpenSubsonic error envelope for
broad client compatibility. HTTP status codes remain meaningful for failures
that happen outside the protocol envelope (unsupported media type, payload
limits, proxy/gateway failures and binary transfer failures). Authentication
failures do not reveal whether a user exists or which credential component
failed.

### 5.3 Parameters

A single normalizer supports query strings and `application/x-www-form-urlencoded`
bodies. It preserves repeated keys and distinguishes absent, empty and malformed
values. Endpoint parsers define aliases, bounds and defaults explicitly.
The common `v` and `c` parameters are mandatory. `f` defaults to XML. A public
endpoint can skip authentication without silently relaxing its other protocol
parameters.

The Form POST extension is advertised only when the whole published profile
behaves identically over GET and form POST.

## 6. Authentication and secret handling

Crate supports three protocol mechanisms:

1. `apiKey`, following the OpenSubsonic extension;
2. legacy `u` + `p`;
3. legacy `u` + `t` + `s` token authentication.

If more than one mechanism is supplied, the request fails with code `43`.
When `apiKey` is supplied, `u`, `p`, `t` and `s` must all be absent. A legacy
challenge-token mismatch is an authentication failure (`40`), while `42` is
reserved for an authentication mechanism Crate does not support.
Disabled, suspended and deleted users fail authorization even when their
credential material is valid.

### 6.1 Dedicated OpenSubsonic credentials

The normal Crate login password is not made recoverable. Each user gets a
dedicated OpenSubsonic credential:

- an encrypted recoverable secret supports legacy password and MD5
  challenge-token verification;
- an API-key digest supports direct indexed lookup without storing the key;
- secrets use the existing Fernet-backed credential vault and
  `CRATE_CREDENTIAL_KEY`;
- the generic vault moves to `app/crate/credentials.py`, with compatibility
  re-exports for current Bandcamp callers.

Existing `users.subsonic_token` data is migrated once under an advisory lock to
the encrypted store and then cleared. Its column is removed in a later release,
after rollback is no longer needed.

Credential creation, rotation and revocation are explicit user actions. Raw
credentials are displayed once and never returned by read endpoints.

### 6.2 Redaction

Access logs, structured logs, metrics, tracing breadcrumbs and exception
contexts redact `p`, `t`, `s` and `apiKey`, case-insensitively, from query and
form data. Tests assert redaction at the actual Uvicorn logging boundary.

Credentials that have appeared in historical logs must be rotated after the
redaction release is deployed.

## 7. Crate Music Profile

### 7.1 System

- `ping`
- unauthenticated `getOpenSubsonicExtensions`
- `getLicense`
- `getUser`
- `getAvatar`
- `getMusicFolders`

The extensions endpoint is public as required and is generated from the same
capability registry used by tests and documentation.

### 7.2 Browsing and search

- `getIndexes`, `getMusicDirectory`
- `getArtists`, `getArtist`, `getAlbum`, `getSong`
- `getAlbumList`, `getAlbumList2`
- `getRandomSongs`
- `getGenres`, `getSongsByGenre`
- `search`, `search2`, `search3`
- `getArtistInfo`, `getArtistInfo2`
- `getAlbumInfo`, `getAlbumInfo2`

Every pagination parameter is bounded and deterministic. Folder filters are
honored. Unsupported album-list types return a protocol error rather than a
different list.

### 7.3 Playlists and personal metadata

- `getPlaylists`, `getPlaylist`
- `createPlaylist`, `updatePlaylist`, `deletePlaylist`
- `getStarred`, `getStarred2`, `star`, `unstar`
- `setRating`

Stars and ratings are per-user. The existing global uniqueness constraint on
favorites is corrected so one user's action cannot affect another user.
Listen and OpenSubsonic use the same personal-state services, preventing drift
between native and third-party clients.

### 7.4 Playback

- `stream`, `download`
- `scrobble`, including repeated IDs/timestamps
- `getNowPlaying`
- `getPlayQueue`, `savePlayQueue`

Scrobbles are idempotent for practical client retries. Queue payloads are
sanitized and bounded, preserve order and position, and cannot reference media
the authenticated user may not access.

### 7.5 Discovery and lyrics

- `getLyrics`, `getLyricsBySongId`
- `getSimilarSongs`, `getSimilarSongs2`
- `getTopSongs`, plus top-songs-by-ID extension where complete

Similarity uses existing Bliss/catalog services and degrades to a valid empty
result when vectors are unavailable. It never fabricates matches.

### 7.6 Operations

- `getScanStatus`
- `startScan` for administrators only

Scan requests dispatch existing worker tasks. The API process never writes to
the music filesystem.

### 7.7 Explicitly unsupported in v1

- chat;
- bookmarks;
- podcasts;
- video and HLS;
- internet-radio station storage;
- public shares;
- jukebox control;
- OpenSubsonic user administration and password changes.

These endpoints are not advertised. If called, they return a consistent
unsupported-operation protocol error rather than `404` HTML or fake data.

## 8. Serialization and artwork invariants

All artist, album and song responses are produced by shared strict serializers.
Endpoint handlers cannot handcraft partial variants. Unknown internal fields do
not leak onto the wire.

### 8.1 Reference invariant

OpenSubsonic `coverArt` values are opaque references. Crate may encode their
resource kind internally, but clients are never expected to parse them as an
artist, album or track identifier. For every response field containing
`coverArt`:

```text
coverArt is absent OR getCoverArt(id) returns a valid image
```

This invariant is tested across catalog samples and full production audit
queries. Artist payloads use available artist photos. Albums without real
artwork do not advertise an unresolvable reference.

### 8.2 Image delivery

`getCoverArt`:

- supports artist, album, playlist and generated fallback identifiers;
- honors bounded `size` requests through the existing variant pipeline;
- returns the correct MIME type;
- emits cache validators (`ETag` and `Last-Modified` where available);
- rejects invalid IDs and oversized requests predictably;
- never performs an unbounded remote fetch during the request.

Fallback artwork is deterministic and explicitly identifiable; it is not used
to hide a serializer bug.

## 9. Streaming and transcoding

Streaming delegates to Crate's playback preparation and media services.
Responses support byte ranges, correct content metadata and disconnect
cancellation. Original-format streaming is preferred when compatible.

Transcoding is advertised only for formats and bitrate combinations actually
supported in the deployed playback worker. Limits protect the playback queue
from unbounded client fan-out. Download authorization and media resolution use
the same path as stream authorization.

## 10. Observability and performance

Record bounded-cardinality metrics for:

- endpoint family, response format and protocol error code;
- authentication mechanism, never credential values;
- latency and response size;
- cover-art hit/miss/variant outcome;
- stream original/transcoded outcome;
- scrobble and queue-write outcomes.

Sentry contexts contain endpoint names and stable outcome categories only.
Request URLs are scrubbed before capture.

Performance gates use production-shaped fixtures. Initial budgets:

- catalog metadata endpoints: p95 under 300 ms excluding client network;
- first byte for cached artwork: p95 under 250 ms;
- first byte for direct stream: p95 under 500 ms;
- no unbounded query count growth with page size.

Budgets are adjusted from measured baselines, but regressions require explicit
review rather than silent acceptance.

## 11. Compatibility and rollout

The new adapter is selected with:

```text
CRATE_OPEN_SUBSONIC_ENGINE=legacy|v1
```

Rollout order:

1. ship migrations and dormant v1 implementation;
2. run official contract and shadow production audits;
3. enable v1 locally and in CI interoperability jobs;
4. enable v1 in production with legacy rollback available;
5. monitor protocol errors, artwork misses, stream starts and client reports;
6. remove the legacy router after one healthy release;
7. remove the old plaintext credential column in a later migration.

No client-user-agent branching is allowed. Client-specific failures become
standards fixtures or generic robustness fixes.

## 12. Acceptance criteria

The release is accepted when:

- official JSON responses validate against the pinned OpenAPI components;
- legacy XML projections validate against the pinned `1.16.1` XSD, while
  enhanced OpenSubsonic XML fields validate against reviewed golden fixtures;
- the mandatory OpenSubsonic kernel is complete;
- all endpoints in the Crate Music Profile have contract and behavior tests;
- no secret reaches logs, traces or error payloads;
- every advertised `coverArt` reference resolves;
- artist photos are present when Crate has them;
- playlists, stars, ratings and queues are truly per-user and persist;
- stream, download, scrobble and queue flows pass retry and authorization tests;
- at least three independent OpenSubsonic clients complete the published smoke
  matrix, with Feishin being one fixture rather than a privileged target;
- the extension list exactly matches completed behavior;
- production rollout has an exercised one-variable rollback path.

## 13. Non-goals

- Implementing every historical Subsonic endpoint regardless of Crate product
  needs.
- Mirroring Feishin bugs or undocumented assumptions.
- Replacing Crate's catalog, playlist, playback or artwork domains.
- Exposing the user's main Crate password to support a legacy protocol.
- Hiding missing metadata with broken or fabricated references.
