---
title: OpenSubsonic compatibility profile
summary: Crate's supported OpenSubsonic API, authentication, observability and rollout contract.
section: architecture
audience: [developer, operator]
status: canonical
order: 99
verified: 2026-09-17
sources: [app/crate/subsonic, app/crate/api/subsonic, app/crate/observability]
---

# Crate OpenSubsonic profile

Crate exposes its music library to third-party players through `/rest`, using
the pinned Subsonic `1.16.1` wire contract and the OpenSubsonic JSON/XML
envelope. This page describes the behavior implemented by Crate; it does not
claim support for endpoints or extensions absent from the tables below.

## Transport and authentication

- Base path: `/rest`; legacy `.view` aliases resolve to the same operation.
- GET and `application/x-www-form-urlencoded` POST are accepted for the
  registered operations. Form POST support is advertised as `formPost`.
- Responses support JSON (`f=json`) and XML (`f=xml`). Protocol errors use the
  Subsonic response envelope and retain HTTP 200 where required by the
  compatibility contract. Media delivery can return normal HTTP error codes.
- Preferred authentication is the dedicated OpenSubsonic API key (`apiKey`).
  Clients may also use the Subsonic username/password (`u` + `p`) or token/salt
  (`u` + `t` + `s`) mechanisms with the dedicated OpenSubsonic credential.
  Do not use the user's Listen login password.
- Users can create, rotate, copy once, and revoke the dedicated credential in
  Listen Settings. API-key material is not returned again after it has been
  dismissed or copied.

## Registered v1 operations

The table is checked against the actual v1 FastAPI router in
`app/tests/test_opensubsonic_docs.py`. It collapses `.view` aliases and lists
the methods registered for each operation.

<!-- opensubsonic-endpoints:start -->

| Operation                   | Methods   |
| --------------------------- | --------- |
| `createPlaylist`            | GET, POST |
| `deletePlaylist`            | GET, POST |
| `download`                  | GET, POST |
| `getAlbum`                  | GET, POST |
| `getAlbumInfo`              | GET, POST |
| `getAlbumInfo2`             | GET, POST |
| `getAlbumList`              | GET, POST |
| `getAlbumList2`             | GET, POST |
| `getArtist`                 | GET, POST |
| `getArtistInfo`             | GET, POST |
| `getArtistInfo2`            | GET, POST |
| `getArtists`                | GET, POST |
| `getAvatar`                 | GET, POST |
| `getCoverArt`               | GET, POST |
| `getGenres`                 | GET, POST |
| `getIndexes`                | GET, POST |
| `getLicense`                | GET, POST |
| `getLyrics`                 | GET, POST |
| `getLyricsBySongId`         | GET, POST |
| `getMusicDirectory`         | GET, POST |
| `getMusicFolders`           | GET, POST |
| `getNowPlaying`             | GET, POST |
| `getOpenSubsonicExtensions` | GET, POST |
| `getPlayQueue`              | GET, POST |
| `getPlayQueueByIndex`       | GET, POST |
| `getPlaylist`               | GET, POST |
| `getPlaylists`              | GET, POST |
| `getRandomSongs`            | GET, POST |
| `getScanStatus`             | GET, POST |
| `getSimilarSongs`           | GET, POST |
| `getSimilarSongs2`          | GET, POST |
| `getSong`                   | GET, POST |
| `getSongsByGenre`           | GET, POST |
| `getStarred2`               | GET, POST |
| `getTopSongs`               | GET, POST |
| `getUser`                   | GET, POST |
| `ping`                      | GET, POST |
| `savePlayQueue`             | GET, POST |
| `savePlayQueueByIndex`      | GET, POST |
| `scrobble`                  | GET, POST |
| `search`                    | GET, POST |
| `search2`                   | GET, POST |
| `search3`                   | GET, POST |
| `setRating`                 | GET, POST |
| `star`                      | GET, POST |
| `startScan`                 | GET, POST |
| `stream`                    | GET, POST |
| `unstar`                    | GET, POST |
| `updatePlaylist`            | GET, POST |

<!-- opensubsonic-endpoints:end -->

`getCoverArt` and `getAvatar` are binary artwork routes; `stream` and
`download` deliver audio through the media service. `createPlaylist`,
`updatePlaylist`, `deletePlaylist`, stars, ratings, scrobbling, and saved queues
use the same user-scoped Crate data as Listen where applicable.

## Advertised OpenSubsonic extensions

Only complete capabilities are advertised. The list is generated from
`crate.subsonic.capabilities.OPEN_SUBSONIC_EXTENSIONS` and checked here in CI.

<!-- opensubsonic-extensions:start -->

| Extension            | Versions |
| -------------------- | -------- |
| `formPost`           | 1        |
| `indexBasedQueue`    | 1        |
| `songLyrics`         | 1        |
| `topSongsByArtistId` | 1        |

<!-- opensubsonic-extensions:end -->

Unlisted OpenSubsonic extensions and Subsonic endpoints are not promised by
this profile. Clients should feature-detect via
`getOpenSubsonicExtensions` and tolerate absent optional metadata.

## Observability, privacy and budgets

- `/rest` requests contribute to `api.request.*` counters and latency samples.
  Per-route latency is stored in `api.route.latency` with target
  `opensubsonic`.
- Route tags come from the registered router, `.view` aliases are collapsed,
  and unmatched `/rest` paths share `/rest/{unmatched}`. Query strings, IDs,
  usernames, API keys and request bodies are never metric tags.
- HTTP failures on `/rest` increment `opensubsonic.request.errors`; failed
  Subsonic response envelopes increment `opensubsonic.protocol.errors` using a
  bounded protocol error-code tag. Audio streams use the existing
  `stream.requests`, `stream.latency`, and `stream.concurrent` metrics; stream
  latency measures the full response duration, not time-to-first-byte.
- Non-media API requests at or above 1,000 ms increment
  `api.request.slow` and emit a route-only warning. The threshold is a
  diagnostic budget, not a user-facing latency SLO.
- HTTP 5xx events are grouped by method, registered route, and status; Sentry
  labels `/rest` events with `protocol=opensubsonic`. The global Sentry event
  and breadcrumb filters redact query credentials, URL-encoded form secrets,
  authorization/cookie values, and multipart bodies. Expected protocol/auth
  errors are counted as metrics instead of generating one Sentry issue per
  client request.
- The production-shaped PostgreSQL search guard seeds 25 tracks and limits the
  global OpenSubsonic catalog search plan to four statements: artists, albums,
  tracks, and the optional track total. Result count must not introduce an
  N+1 query pattern.

## Engine rollout and rollback

`CRATE_OPEN_SUBSONIC_ENGINE` selects the `/rest` implementation:

| Value    | Behavior                                                             |
| -------- | -------------------------------------------------------------------- |
| `legacy` | Default when unset; keeps the compatibility adapter active.          |
| `v1`     | Selects the split v1 system/media routers and Crate-backed services. |

Roll out by setting the variable to `v1` for the API service and restarting it
only after the release's migrations and smoke checks are complete. Observe
authentication denials, protocol error codes, route latency, artwork failures,
stream starts and worker pressure. To roll back, restore `legacy` and restart
the API; the additive OpenSubsonic credential data is retained. Do not remove
or reverse credential migrations as part of a code rollback. An unsupported
flag value fails closed during router selection.

This is the implementation contract, not authorization to activate the v1
engine in production. The production cutover and legacy retirement are the
separate post-merge Cut S runbook.
