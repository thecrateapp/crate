---
title: Auth, sessions, users and social layer
summary: Authentication and user-scoped state across Admin and Listen.
section: architecture
audience: [developer]
status: canonical
order: 96
verified: 2026-11-18
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
