---
title: Auth, sessions, users and social layer
summary: Authentication and user-scoped state across Admin and Listen.
section: architecture
audience: [developer]
status: canonical
order: 96
verified: 2026-11-28
sources: [app/crate/api, app/crate/db/orm]
---

# Auth, Sessions, Users, and Social Layer

## Identity model

Crate has evolved from a simple local-login system into a real multi-user
identity layer.

The current model combines:

- users in PostgreSQL
- persisted sessions
- JWT-backed request identity
- external identities for OAuth providers
- auth invites
- public social profiles

## User records

The core user model is managed from `app/crate/db/repositories/auth.py`.

Relevant concepts include:

- email
- username
- display name
- avatar
- bio
- role
- password hash
- external identities
- subsonic token
- last login

The data layer also owns bootstrap admin seeding, invite acceptance, username
logic, and lower-level session maintenance.

## Sessions

Crate uses persisted sessions, not only stateless JWT.

Session behavior spans:

- `app/crate/api/auth.py`
- `app/crate/db/repositories/auth.py`

Each session stores data such as:

- session id
- user id
- expiry
- created/last-seen timestamps
- IP
- user agent
- app id
- device label
- revoked state

This enables:

- device/session listing
- revoke current or other sessions
- presence-like behavior
- explicit session cleanup

## Cookie and token model

Auth is hybrid by design:

- cookies are used for first-party web apps
- JWT carries session/user identity
- session rows enforce revocation and lifecycle
- bearer tokens are used by native Listen clients and by Crate Decks, which
  never receives cookies (see `listen-native-auth-contract.md`)

There are separate cookie names for admin-style and listen-style web auth so
both surfaces can coexist cleanly.

## Native device tokens

A native device token is the credential the Android media service uses when the
WebView is not running (Android Auto, Cast refill, background plays). It is a
`crv_` access token with `token_type = "native_device"` and the single scope
`device.native`. Server code: `app/crate/api/device_tokens.py`,
`app/crate/db/repositories/access_tokens.py`; the allowlist is
`_NATIVE_DEVICE_ACCESS_TOKEN_ROUTES` in `app/crate/api/auth.py`.

- **Minting.** `POST /api/auth/device-tokens` with `{device_id, label}` returns
  `{id, token, device_id, label, created_at, expires_at}`. `device_id` is
  generated on the phone (8-128 characters of `[A-Za-z0-9_-]`); `label` is at
  most 80 characters, for example `Android: Pixel 8`. Only an interactive
  session can mint, list or revoke: any `crv_` bearer (VirtualDJ, continuation
  or device token) gets 403. The secret is returned once; the table stores its
  SHA-256 digest.
- **One per device and session.** A token belongs to its user, the session that
  minted it (`session_id`) and the `device_id`. Minting again for the same
  session and device deletes the previous token (partial unique index
  `uq_user_access_tokens_native_device`, migration 170).
- **Lifetime.** `expires_at` is the parent session's `expires_at` at mint time.
  The middleware also checks the parent session on every request, so the token
  stops working as soon as that session is logged out, revoked
  (`DELETE /api/auth/sessions/{id}`, `POST /api/auth/sessions/revoke-all`, admin
  revocation, account deletion) or expires. There is no refresh: when the
  session ends, the phone signs in again and JS mints a new token.
- **Listing and revocation.** `GET /api/auth/device-tokens` lists the user's
  active device tokens whose session is still alive, without secrets:
  `{id, device_id, label, created_at, last_used_at, expires_at, current_session}`.
  `DELETE /api/auth/device-tokens/{id}` revokes one of the user's own tokens
  (404 for anyone else's). `last_used_at` is updated at most every five minutes,
  like other access tokens.
- **Allowlist.** Outside these routes the middleware answers 403 (other access
  tokens are treated as anonymous instead):

  - `GET /api/auth/me`, `GET /api/capabilities`, `GET /api/me/device/*` and
    `POST /api/me/device/queue` (the device API below);
  - streams: `GET|HEAD /api/tracks/by-entity/{uid}/stream`,
    `/api/catalog/tracks/{uid}/stream`, `/api/tracks/{id}/stream`,
    `/api/stream/{path}`, `/api/playback/variants/{id}/stream`;
  - playback resolution: `GET /api/tracks/by-entity/{uid}/playback`,
    `/api/tracks/{id}/playback`, `/api/catalog/tracks/{uid}/playback`;
  - artwork: `GET|HEAD /api/albums/{id}/cover`,
    `/api/albums/by-entity/{uid}/cover`, `/api/catalog/albums/{uid}/cover`,
    `/api/artists/{id}/{photo|background}`,
    `/api/artists/by-entity/{uid}/{photo|background}`,
    `/api/catalog/artists/{uid}/{photo|background}`;
  - `POST /api/me/play-events` (plays are written for the token's owner),
    `POST /api/playback/transition-plans`, `POST /api/playback/continuation`,
    `POST /api/me/cast/tickets`.

  Nothing on the list writes settings, the library or other users, and a device
  token cannot mint tokens. `POST /api/playback/continuation` still reads its
  queue descriptor from a playback continuation token, so a device token gets
  403 there until native-owned queues (AA4) define where that descriptor lives.

- **Read plane.** The read plane never validates `crv_` tokens: every `/api/`
  request with a `Bearer crv_` header goes to the FastAPI fallback before any
  native handler (`withAccessTokenFallback` in
  `app/readplane/internal/routes/access_tokens.go`).

## Device browse, search and queue API

The compact API the Android media service (Android Auto, Assistant, Wear)
browses and plays from while the WebView is not running (phase AA3 of
`docs/plans/2026-11-28-android-auto-design.md`). Router:
`app/crate/api/device_library.py`; SQL: `app/crate/db/queries/device_library.py`.
Every route accepts an interactive session or a native device token and reads
only the caller's own library; other access tokens get 403. The read plane has
no handler for `/api/me/device/*` and no edge routes it there, so session JWTs
reach FastAPI too (`tests/test_readplane_route_manifest.py`).

- **Browse.** `GET /api/me/device/browse/{node}?limit=&cursor=` (`limit` 1-100,
  default 50) returns `{node, title, items, next_cursor}`. Each item is
  `{id, kind, title, subtitle, artwork_url, playable, browsable}` plus
  `duration_ms` for tracks and `group` (section title) in mixed nodes. Item ids
  encode the kind: `album:<uid>`, `artist:<uid>`, `playlist:<id>`,
  `track:<uid>`, `mix:<id>`, `station:<artist|album>:<id>`; folders use their
  node name. Unknown nodes, missing containers and another user's private
  playlist answer 404; a cursor from another node answers 400.
- **Nodes and their sources.**

  | Node                | Items                                                       | Source and paging                                                     |
  | ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
  | `root`              | folders `home`, `library`, `radio`                          | fixed                                                                 |
  | `library`           | folders `recent`, `playlists`, `liked`, `albums`, `artists` | fixed                                                                 |
  | `home`              | up to 8 mixes, 8 recently played, 8 radio stations (D8)     | home snapshot, offset cursor                                          |
  | `recent`, `radio`   | recently played albums, artists, playlists; radio stations  | home snapshot, offset cursor                                          |
  | `playlists`         | owned, shared and followed playlists the user can play      | SQL keyset on name                                                    |
  | `playlist:<id>`     | the playlist's local tracks in order                        | Decks playlist page (keyset on position)                              |
  | `liked`             | liked local tracks, newest first                            | Decks likes page (keyset)                                             |
  | `albums`, `artists` | saved albums, followed artists, newest first                | SQL keyset on save or follow time                                     |
  | `album:<uid>`       | the album's tracks in disc and track order                  | SQL keyset                                                            |
  | `artist:<uid>`      | 12 top tracks, then up to 200 albums                        | artist page top tracks (Redis, 5 min) and one SQL read, offset cursor |

  Home nodes call `get_home_discovery_snapshot`: a fresh snapshot, else a stale
  one (up to an hour) with a deduplicated refresh task, else an empty home and
  a refresh. The request never builds the home. Essentials and suggestions are
  not shown in the car. Only local items with an entity uid are listed; global
  (federated-only) albums, artists, likes and radio seeds are skipped.

- **Search.** `GET /api/me/device/search?q=&limit=` (`q` at least 2 characters,
  `limit` up to 50 per kind) returns the same page shape (`node: "search"`)
  with groups `Artists`, `Albums` and `Tracks` from the local catalogue search.
- **ETags.** Browse and search pages carry a strong `ETag` and
  `Cache-Control: private, no-cache`; `If-None-Match` answers 304.
- **Artwork.** `artwork_url` is a canonical API path on the device token's
  allowlist: `/api/albums/by-entity/{uid}/cover?size=512`,
  `/api/albums/{id}/cover?size=512` or
  `/api/artists/by-entity/{uid}/photo?size=512`.
- **Queue.** `POST /api/me/device/queue` with either `node` (a playable
  container: `album:`, `playlist:`, `liked`, `mix:`, `artist:` for its top
  tracks, `station:`) or `item_ids` (up to 500 `track:` ids), plus
  `start_item_id`, `shuffle` and `delivery` (`auto`, `original`, `balanced`,
  `data_saver`). It returns `{tracks, start_index, continuation}` with at most
  500 tracks in order, each with `id`, `entityUid`, `url`, `title`, `artist`,
  `album`, `artwork` and `durationMs`, resolved with one batched `ANY(:uids)`
  query. The stream URL is `/api/tracks/by-entity/{uid}/stream`, with
  `?delivery=` only for `balanced` and `data_saver`: the device resolves `auto` itself
  (unmetered: original; metered: balanced). With `shuffle`, the start track
  plays first and `start_index` is 0. Stations and mixes return a
  `seeded_radio` continuation descriptor (`seedType` `artist`, `album` or
  `home_playlist`) for a later native refill; finite containers return null.
  The queue writes nothing.
- **Bounds that compute.** Station queues generate 50 radio tracks in the
  request, as `/api/radio/*` does. A mix queue reads the same Redis entry as
  Listen's mix page (`home_mix:v3:...:40`, five minutes) and builds the mix
  only on a miss, so at most once per user and mix every five minutes, and
  only on an explicit play, never while browsing.

## OAuth providers

The auth layer supports:

- password
- Google OAuth
- Apple OAuth

Availability is determined by both:

- environment configuration
- settings-based enable/disable flags

## External identity model

External login is modeled canonically through `user_external_identities`, not
provider-specific columns.

This makes account linking/unlinking and multi-provider ownership much cleaner.

## Auth invites

Crate supports invite-driven onboarding.

At the DB layer, invite creation and consumption live in repository helpers so
invite acceptance can participate in the same transaction as user creation or
session issuance.

## Account self-service: data export and deletion

Signed-in users can export their own data and delete their own account from
Listen (Settings > Account > Your data). Both flows live in
`app/crate/api/me_account.py` and accept only a session identity: `crv_` access
tokens are rejected (`403`), so a plugin token can never export or close an
account.

### Data export

| Route                              | Behaviour                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/me/export`              | Queues an export (`202`). Returns the pending export instead of a new one while one is running. `503` when the download cache is disabled. |
| `GET /api/me/export`               | Latest export of the current user (`pending`, `ready`, `failed`, `expired`).                                                               |
| `GET /api/me/export/{id}/download` | Streams the ZIP. `404` unless the export belongs to the caller, is `ready` and has not expired.                                            |

- The API never writes the archive. `POST` inserts a `user_data_exports` row
  and the `export_user_data` task (queue `default`) in one transaction; the
  worker writes the ZIP into the download cache (`account-export` kind, keyed
  by the export id) with a temp file and `os.replace`, then marks the row
  `ready` with `expires_at`.
- The archive holds one JSON array per section plus `manifest.json` (format
  version, generation time, row count per section). Sections and their exact
  columns are listed in `crate/db/queries/user_data_export.py`
  (`USER_DATA_EXPORT_SECTIONS`): profile, roles, connected accounts, sessions,
  devices, access tokens, owned playlists and their tracks, playlist
  memberships and follows, owned Crates and their albums, Crate memberships and
  follows, likes, saves, follows, ratings, favorites, play events and legacy
  play history, show attendance and reminders, users followed, equalizer
  presets, contributions, Decks cues and corrections, Smart Mix playlists,
  recommendation and radio feedback, music paths, Bandcamp connection and
  items, artist suggestions and hosted Jam rooms.
- Every section filters on the caller's user id. Columns are chosen
  explicitly: password hashes, the legacy Subsonic token, token digests,
  session ids, device fingerprints, provider metadata (it can hold session
  keys), secret references, server file paths and other users' identities
  (followers, collaborators, who added an album to a shared Crate) are never
  exported.
- The download uses the normal session cookie on the web and a 60 second,
  path-bound `media_ticket` (`artwork` audience, issued by
  `POST /api/auth/media-access`) on native clients, both bound to the
  signed-in user.
- Exports expire after `CRATE_ACCOUNT_EXPORT_TTL_SECONDS` (default 24 h). A new
  export supersedes the previous one (its file is removed). The hourly
  `cleanup_user_data_exports` task (queue `maintenance`) marks expired rows
  `expired`, removes their files and fails exports still pending after one
  hour. The download cache's own TTL/LRU pruning also covers the
  `account-export` kind.

### Account deletion

`DELETE /api/me` with `{"password": "..."}`.

- Re-authentication: accounts with a password must send it; failures count
  against the login rate limiter (`429` once locked). Accounts without a
  password (OAuth only) must have signed in on the current session within the
  last 10 minutes. `sessions.authenticated_at` is set by every login, OAuth
  callback and native exchange and is not touched by token refresh or
  heartbeats. `GET /api/me/account/deletion` tells the client which proof is
  needed and whether the session is recent enough.
- The last active owner/admin cannot delete their account (`409`). Admins use
  `DELETE /api/auth/users/{id}`, which keeps its existing `400` for that case.
- Self-service and admin deletion share `_delete_user_account` in
  `app/crate/api/auth.py`, so both do the same thing:
  - soft delete: `users.status = 'deleted'` with `deleted_at` and `deleted_by`;
    the row and its personal data stay, and an admin can restore it;
  - revoke every session, every access token and the OpenSubsonic key, and
    invalidate the auth cache (the readplane rejects revoked sessions);
  - enqueue `library_cleanup_user_contributions` for albums the user
    contributed (they leave the shared library unless someone else also
    contributed them);
  - enqueue `cleanup_user_data_exports` for the user, which expires and
    removes any export archive;
  - write a `delete_user` audit entry with `source` `admin` or `self`.
- Shared and collaborative content is not removed: playlists, Crates and Jam
  rooms the user owns keep their rows, collaborators keep their access and
  public items stay visible. Likes, history and other per-user rows stay
  attached to the deleted account until a purge removes the user row
  (the foreign keys cascade on a hard delete).
- Listen clears the local session and returns to the login screen after a
  successful deletion.

## Frontend auth behavior

### Admin UI

- cookie/session oriented
- operator-facing
- no multi-server model

### Listen Web

- same-origin web app
- persisted session plus auth token handling in the web client
- auth bootstrap via `/api/auth/me`
- session heartbeat while active

### Listen Capacitor

Listen native builds are explicitly **multi-server**:

- the app stores a list of configured Crate servers
- each server can hold its own bearer token
- the current server can change live without a full app reload

The relevant client boundary lives in:

- `app/listen/src/lib/server-store.ts`
- `app/listen/src/lib/api.ts`

## Listen auth runtime

The public `AuthContext` in Listen is now a thin facade over focused internals:

- `use-auth-session.ts` — `/api/auth/me` bootstrap and re-fetch
- `use-auth-oauth-sync.ts` — callback/deep-link completion
- `use-auth-heartbeat.ts` — active-session heartbeat
- `lib/capacitor.ts` and related modules — native boundary and OAuth payload
  persistence

That split matters because Listen is a stateful client with playback, offline
state, and per-server auth concerns.

## Public social layer

The social API lives in `app/crate/api/social.py`.

Core capabilities:

- public user profile lookup by username
- social search
- followers/following endpoints
- follow/unfollow mutations
- self social summary
- affinity exposure between viewer and viewed user

## Collaborative features

User identity also intersects with:

- playlist ownership and collaboration
- playlist invite tokens
- jam room host/collaborator roles
- jam invite flows

Auth in Crate is therefore not only request validation; it is part of the
product model.
