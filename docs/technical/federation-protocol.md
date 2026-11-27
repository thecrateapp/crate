---
title: Federation protocol
summary: Signed node identity, typed authorization, catalog synchronization and opaque relay contracts.
section: federation
audience: [developer]
status: canonical
order: 210
verified: 2026-07-21
sources:
  [
    app/crate/api/federation.py,
    app/crate/federation/identity.py,
    app/crate/federation/pairing.py,
    app/crate/federation/authorization.py,
  ]
---

# Federation protocol

The v1 protocol is node-first. It adds approved remote sources to the same
catalog and playback contracts used in singleton mode; it never gives a client
direct peer credentials or authority over another node.

## Descriptor and request signatures

`/.well-known/crate-node` publishes a signed `NodeDescriptorV1` with node ID,
API origin, protocol/capability versions, public keys and descriptor lifetime.
Node-to-node requests use an Ed25519 signature profile over the method, path,
validated host, content metadata, node/key identifiers, timestamp, nonce and
body digest. Receivers validate signature, key lifecycle, freshness, replay and
request body before evaluating authorization.

Treat descriptors, API origins, stream URLs and directory data as hostile input.
Connection policy must be centralized: scheme, hostname DNS resolution,
redirects, resolved address class, Host/SNI and embedded endpoint origin all
need the same check. Do not weaken it for a test harness; the harness uses an
explicit development private-network allowance.

## Pairing and grants

Pairing stores a candidate/pending relationship and signed envelopes. It is not
equivalent to a production trust decision. An administrator must independently
verify remote identity and approve a peer, then create the smallest typed grant
needed for the use case.

The owner evaluates persisted grants by remote principal/subject selector,
capability, constraints and policy revision. Presets such as discovery/catalog
are templates used to seed a grant, not a substitute for this evaluation. Grant
downgrade, peer disablement or revocation must stop future authorization and
trigger ticket/reconciliation handling; consumers preserve provenance rather
than silently converting remote rows into local data.

## Catalog synchronization

Catalog sync transfers signed, bounded manifest pages and checkpoints persisted
pages before advancing. A retry must be replay-safe; tombstones and upserts are
idempotent. A missing/expired cursor requires a documented full reconciliation,
not a table truncation. The global catalog keeps source provenance and resolves
stable global identities separately from local library ownership.

Catalog read responses surface an explicit serving mode. Local fallback,
global-ready, refreshing and degraded behavior are an API contract; callers
must not invent a `catalog_warming` failure state.

### Catalog summaries (`crate.federation.summary/1`)

An owner publishes one Bloom summary per permission scope so a peer can skip
live search fan-out to owners that cannot match. The summary is built by a
worker task (`federation_build_catalog_summaries`); a request never builds it.

`GET /api/federation/v1/catalog/summary` is a signed node request authorised by
the existing `catalog.search` grant and advertised as the `catalog.summary`
capability. It serves the summary of the caller's own search scope; two peers
with different scopes get different filters, and a denied entity contributes no
bits to a restricted peer's filter.

- `200`: `{"contract", "etag", "source_sequence", "built_at", "params",
  "bloom", "artist_album_counts"}` with a quoted `ETag` header. `bloom` is the
  base64 filter, `params` holds `m` and `k`, `artist_album_counts` maps hashed
  artist keys to album counts. No names or query text are stored.
- `304`: `If-None-Match` carries the current etag (bare or quoted). The body is
  empty and the `ETag` header is repeated.
- `403`: the peer has no `catalog.search` grant, search is disabled for the
  scope, or an active role or subject grant permits `catalog.search` for some
  of the peer's users. Such a grant can give those users more than the
  node-level scope a summary is built from, so no summary is offered and the
  peer is always asked.
- `404` `{"code": "summary_pending"}`: no summary is built yet. The request
  enqueues a deduplicated build and the peer retries later.

Every `GET /api/federation/v1/catalog/delta` page carries
`"summary": {"contract", "etag", "source_sequence"}` when the peer may search
and a summary exists for its scope; otherwise the key is absent. A peer
compares the etag with its stored copy and fetches the summary only when it
differs.

Tokenizer `fts-simple-v2`: lowercase `[^\W_]+` tokens (letters and digits;
underscores split words, as in PostgreSQL's `simple` parser) of artist, album
and track names. Each token is inserted whole, plus its prefixes of length 3 up
to the token length minus one. Probe rule: drop query tokens shorter than 3
characters, probe the other tokens whole and the last token as a prefix; a
query with no probe left is not routable and must fan out. Receivers reject a
summary whose `params` do not name this tokenizer, `hash: "blake2b-128-km"` and
`min_prefix: 3`, or whose sizes are out of bounds (`1 <= k <= 32`,
`64 <= m <= 67,108,864` bits with a bloom of exactly `ceil(m/8)` bytes, at most
200,000 artist counts keyed by 16 lowercase hex characters, non-negative
integer counts and `source_sequence`).

Guarantee. A word-prefix query over the owner's FTS tokens is never routed away
from a peer while the receiver holds a fresh summary of that peer, and the
filter targets a 1 % false-positive rate. "Fresh" has two parts:

- Content lag: the owner rebuilds summaries every 300 s, and the receiver
  learns of a new etag on its next delta sync (every 120 s) or summary poll
  (every 900 s). Content added on the owner within that window can be missed
  by routing until the new summary arrives; the local results and other peers
  are unaffected.
- Maximum age: a stored summary routes only while it was fetched or confirmed
  within the last 1800 s (twice the poll). A `304`, or a delta page announcing
  the same etag, confirms it. Older rows are ignored and the peer is asked.

The receiver deletes its stored summary of a peer when the peer answers `403`,
any `404` (including `summary_pending`), or a summary it cannot accept (unknown
contract or tokenizer, malformed or out-of-bounds fields). Network errors, `429`
and `5xx` keep the row, which then ages out. An older summary (lower
`source_sequence`) never replaces a newer one.

Known gaps, each one a routing miss, never a wrong result:

- Mid-word queries ("ivision" for "Division") are not covered; the owner's FTS
  does not match them either, but its fuzzy fallback can.
- Locale casing: Python lowercases `İ` to `i` plus a combining dot, which
  splits the word (`İstanbul` gives `i`, `stanbul`); PostgreSQL gives
  `istanbul`. A query for "istanbul" can be routed away from a peer that has
  "İstanbul".

Names PostgreSQL keeps as one file or host lexeme, such as `AC/DC` (`ac/dc`)
or `R.E.M.` (`r.e.m`), are not a routing gap: the receiver splits them into
words and inserts each whole, and the owner's FTS only matches them by a prefix
of the first word, which the filter holds. They can only make a peer be asked
for a later word ("dc") that its FTS does not match, a false positive.

`tests/test_federation_summary_bloom.py::test_tokens_agree_with_postgres_simple_parser`
pins the agreement with PostgreSQL for the other names, and
`test_wire_format_golden_vector` pins the filter bytes.

Size: for the production-sized reference catalogue the filter is 185,204 bytes
(about 181 KiB) raw and 246,940 bytes (about 241 KiB, 247 kB) as base64 in the
JSON body, plus the artist counts. See [Federation capacity](federation-capacity.md).

## Playback relay

The consumer asks the owner for a short-lived, subject-bound remote stream
authorization and exposes a separate opaque local relay ticket. The browser
uses the local path only. Traefik routes eligible stream paths to Go readplane;
the relay forwards only allowed Range/cache validators and selected response
metadata. It never forwards cookies, browser authorization, peer URLs or owner
tickets.

The owner remains authoritative for quota, byte reservation, entity constraints,
policy revision and revocation. Playback preparation is advisory and must not
reserve a stream or transfer media.

### Bounded playback preparation

`POST /api/federation/v1/playback/prepare` is an advisory, signed owner request
for one or two owner-local track entity UIDs. It requires the same stream grants
and entity allowlist as a transcoded stream, plus a user assertion with purpose
`stream.prepare`. It does not create a ticket, playback session, stream URL,
byte reservation or media transfer.

The owner reports only `ready`, `preparing`, `unavailable` or `rate_limited`.
Ready variants consume no reservation. New speculative work has four live reservations per peer and twenty per owner, atomically tracked in Redis by variant cache key. Active playback remains higher priority and serves the original source when the prepared variant is not ready.

## Compatibility and errors

Protocol version and advertised capability negotiate the allowed contract; a
software version string is not a capability. Authentication, replay, unsafe
URL, grant and cursor failures are terminal unless the API explicitly documents
a recovery action. Network failures use bounded backoff and incomplete search
must be reported as partial rather than cached as complete.

See [Federation overview](federation-overview.md) for the model and
[Production acceptance](federation-production-acceptance.md) for the conditions
under which a network-facing deployment may rely on it.
