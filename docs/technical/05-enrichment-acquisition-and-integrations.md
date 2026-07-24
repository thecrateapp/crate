---
title: Enrichment, acquisition and integrations
summary: Background enrichment and acquisition ownership.
section: architecture
audience: [developer]
status: canonical
order: 90
verified: 2026-07-21
sources: [app/crate/enrichment.py, app/crate/worker_handlers]
---

# Enrichment, Acquisition, and External Integrations

## Why this layer exists

Crate is not a passive index of tags. A large part of its value comes from
enriching local files with external knowledge and importing new content into the
library cleanly.

This layer spans:

- artist enrichment
- artwork sourcing
- acquisition from paid, owned, uploaded, and P2P sources
- show aggregation
- completeness checks
- post-download normalization

## Artist enrichment

The main unified entrypoint is `app/crate/enrichment.py`.

For a given artist, `enrich_artist(...)` pulls from multiple providers, merges
the results, and persists them into PostgreSQL.

### Sources consulted

- Last.fm
- MusicBrainz
- Setlist.fm
- Fanart.tv
- Discogs
- Deezer and iTunes as image fallbacks
- Spotify popularity/follower overlays when configured

### Data persisted

Typical writes include:

- biography
- tags
- similar artists
- listeners and playcount
- MBID and MusicBrainz URLs
- country, area, type, and dates
- members
- Discogs profile/identifiers
- Spotify popularity/followers

The function also updates genre links and may download a local artist photo if
missing.

## Artwork sourcing

Artwork is handled across API helpers, worker handlers, and image-specific
modules.

Typical sources include:

- Cover Art Archive
- embedded tags
- Deezer
- iTunes
- Last.fm
- Fanart.tv
- manual upload/crop

Crate treats artwork as part of the product surface, not just metadata
decoration.

## Acquisition sources

Crate currently integrates strongly with Bandcamp, Tidal, Soulseek, and direct
uploads.

### Bandcamp

Bandcamp is the main "support the artist" acquisition path. It is not treated
as a streaming backend; it is a user-owned purchase import system.

Key pieces:

- API surface in `app/crate/api/bandcamp.py`
- integration modules in `app/crate/bandcamp/`
- persistence in `app/crate/db/repositories/bandcamp.py`
- worker orchestration in `app/crate/worker_handlers/bandcamp.py`
- contribution withdrawal in `app/crate/worker_handlers/contributions.py`

Current capabilities:

- connect a user's Bandcamp account with native/session material or a manually
  pasted `identity` cookie
- sync collection, wishlist, and following
- cache Bandcamp items and user ownership/following state
- create candidate links between Bandcamp artists/albums/tracks and Crate
  entities
- import owned downloadable purchases into the shared library, defaulting to
  FLAC
- skip imports when the same Bandcamp item or artist/album already exists in
  the instance
- record the importing user as a library contributor
- expose portable export and withdrawal controls for that user's contribution
- surface Bandcamp support CTAs on linked artists/albums in Listen

Crate persists confirmed Bandcamp URLs on `library_artists` and
`library_albums`. This keeps support links available even when the original
Bandcamp collection sync result is no longer on the hot path.

### Bandcamp connection model

Normal web pages cannot read cookies from `bandcamp.com`, so Crate supports
two practical connection paths today:

- native/desktop session capture can post Bandcamp session material to
  `/api/bandcamp/me/connect/session`
- web/mobile users can paste the Bandcamp `identity` cookie value into Listen
  settings, which posts to `/api/bandcamp/me/connect/cookie`

The older server-side web credential bridge remains behind
`CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED=false` by default. It should be
treated as an optional operator-controlled escape hatch, not the preferred user
flow.

Bandcamp session material is stored through encrypted `credential_secrets`.
Production should set a stable `CRATE_CREDENTIAL_KEY` so external sessions
remain decryptable across JWT secret rotations.

### Tidal

Key pieces:

- API surface in `app/crate/api/tidal.py`
- integration logic in `app/crate/tidal.py`
- worker orchestration in `app/crate/worker_handlers/acquisition.py`
- artifact inspection/repair in `app/crate/m4a_fix.py`

The repo currently pins `tiddl 3.3.0`.

Crate wraps it with:

- progress reporting
- partial failure reporting
- intermediate artifact cleanup
- library move and sync
- post-download enrichment/analysis

### Current quality philosophy

Crate now optimizes for **best-quality real output**, not merely the requested
quality label.

That matters because Tidal/tiddl can leave behind:

- extensionless `tmp*` artifacts
- `.flac` files whose payload is actually MP4/AAC
- recoverable raw FLAC streams with the wrong extension

Current behavior:

- preserve/recover true lossless output when it is really present
- normalize playable AAC/ALAC wrappers to clean `.m4a`
- avoid importing fake FLACs as if they were lossless
- fall back to a clean playable `.m4a` result if the “lossless” tree is not
  genuinely recoverable

### Soulseek

Key pieces:

- API surface in `app/crate/api/acquisition.py`
- integration logic in `app/crate/soulseek.py`
- worker orchestration in acquisition handlers

Crate uses `slskd` for the network client and adds:

- search heuristics
- quality filtering
- alternate peer retry
- import normalization

## Unified acquisition philosophy

Even though Bandcamp, Tidal, Soulseek, and uploads are very different sources,
Crate converges them into one internal pattern:

1. enqueue acquisition work
2. download to staging
3. inspect and normalize artifacts
4. resolve canonical artist/album destination
5. move into the library
6. sync into PostgreSQL
7. queue enrichment and analysis follow-ups
8. record provenance when a user contributed the content
9. emit cache/domain events so home, browse, artist, album, playlist, and ops
   read models become fresh

This keeps the downstream pipeline largely source-agnostic.

## Post-acquisition processing

The acquisition worker does more than download bytes. It also:

- emits user-facing task events
- updates acquisition status tables
- suppresses watcher loops during managed library writes
- aligns staged artist names with existing folder conventions
- triggers scans and downstream processing
- seeds user library state in some upload/import flows
- records `library_contributions` for user uploads and Bandcamp imports
- emits acquisition completion events that the projector uses to warm snapshots

## Shows and live data

Crate also treats external event data as part of enrichment/discovery.

Key integrations:

- Ticketmaster
- Last.fm event scraping
- Setlist.fm probable setlists

This data powers:

- upcoming shows in admin and Listen
- artist show sections
- setlist-derived intelligence

## Rate limiting and resilience

Crate's enrichment/acquisition code makes pragmatic trade-offs:

- source calls are wrapped defensively
- caches are used aggressively
- one provider failing usually does not abort the whole enrichment flow
- long-running acquisition is task-based, not request-based
- partial Tidal failures can still yield a usable normalized result
