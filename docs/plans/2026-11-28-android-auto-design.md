# Android Auto and native playback without the WebView

**Status:** Draft for review
**Date:** 2026-11-28
**Scope:** Listen Android app (`app/listen/android`), API (`app/crate/api`), read plane

## Goal

Crate appears in Android Auto: the listener browses their library on the car screen, starts
music by touch or voice, and controls playback, with play history recorded. The same native
foundation lets the default Cast receiver play a real queue.

Both need one thing Listen does not have: native code that talks to the server **without the
WebView**. Android Auto starts the playback service without opening the app, and with the
screen off the WebView is frozen. Today every credential, browse request, queue decision and
play event goes through JS.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Distribute through the existing GitHub APK. Android Auto shows it once the user enables "Unknown sources" in Android Auto's developer settings ([testing docs](https://developer.android.com/training/auto/testing/index.html)). Play Store is a later, separate decision. | Matches today's distribution; media apps are covered by that setting.                                                                                                                                                            |
| D2  | A new **device credential**: a `crv_`-format access token, `token_type="native_device"`, minted by JS from an interactive session, bound to that session's lifetime and revoked with it.                                                                                   | No existing credential can browse and stream without JS (see "Current state"). Tying it to the session needs no native refresh flow: when the session hard-expires (30 days) the listener signs in again and JS mints a new one. |
| D3  | A dedicated, compact **device browse API** instead of reusing the page endpoints.                                                                                                                                                                                          | Page endpoints are session-only, unpaged (`/api/me/likes`, `/api/me/history` take unbounded limits), shaped for React pages and partly computed in the request. Android Auto needs small paged lists with a stable item shape.   |
| D4  | Whoever owns the queue revision reports its plays. JS keeps reporting the queues it loads; native reports queues it starts itself (car, voice, Cast refill).                                                                                                               | Avoids duplicate play events without coordination at play time.                                                                                                                                                                  |
| D5  | `CrateNativePlaybackService` becomes a Media3 `MediaLibraryService`.                                                                                                                                                                                                       | Android Auto and other browsers (Wear, Assistant) bind to the library service; the existing session, notification, Smart Mix decks and checkpoint stay as they are.                                                              |

## Current state (verified in code, 2026-11-28)

- **Credentials.** Session JWTs (1 h access, 30-day refresh bound to a fixed session expiry,
  `api/auth.py:547-564,1467,1491`). `crv_` tokens exist for VirtualDJ with a hard route allowlist
  (`api/auth.py:200-219`) that has no home, playlists, likes, albums, artists or radio. The
  playback continuation token (`crv_`, 12 h, `api/auth.py:222-232`) only covers plans,
  continuation and two stream routes, and is minted from JS. Media tickets are path-bound and
  short-lived. **Nothing lets native code browse.**
- **Native auth today.** JS puts `Bearer <session JWT>` on each engine track; the service keeps an
  origin to Authorization map and falls back to the continuation token near expiry
  (`CrateNativePlaybackService.authorizeStream`, `NativeStreamAuthorization`).
- **Server and profile.** The server list, the current server and the active offline profile key
  live only in WebView `localStorage` (`server-store.ts:34-35`, `offline-storage.ts:37`). Session
  tokens are in Keystore-encrypted SharedPreferences (`CrateSecureSessionPlugin`), but native code
  cannot tell which server they belong to.
- **Browse sources.** Home slices are snapshot-backed and cheap (`/api/me/home/*`,
  `ui_snapshots`). Playlists, likes, saved albums, follows, artist and album detail are live
  reads; several are unpaged.
- **Queues.** `POST /api/playback/continuation` already returns native-ready tracks, but only to
  extend a radio descriptor. Albums and playlists return full track lists in their page payloads.
- **Plays.** `POST /api/me/play-events` accepts sessions and VDJ `crv_` tokens, dedups on
  `client_event_id`. The native player never posts; it emits checkpoints to JS and keeps them on
  disk until acknowledged (`NativeDurableEventLog`).
- **Downloads.** Offline audio and its index live under `getFilesDir()/offline-media` and
  `offline-meta/offline-index-<profileKey>.json`; native code can parse them but does not know
  the profile key.
- **Service.** Manifest exports only `androidx.media3.session.MediaSessionService`
  (`AndroidManifest.xml`); no automotive descriptor.
- **Cast default receiver.** One `loadMedia` per track with a 15-minute ticket; JS starts the
  next track itself (`cast-sender.ts:1614-1649`), which a frozen WebView cannot do.

## Architecture

```
            JS (when running)                         Native (always)
  login / server switch / logout                MediaLibraryService
            |                                     |-- browse  --> DeviceApiClient --> /api/me/device/*
            v                                     |-- queue   --> DeviceApiClient --> /api/me/device/queue
  CrateDevicePlugin.setProfile(...)  ---------->  DeviceProfileStore (Keystore)
   server URL, device token, delivery,            |-- streams: Authorization from the device token
   offline profile key                            |-- plays:   NativePlayReporter --> /api/me/play-events
                                                  |-- Cast:    CastQueueRefill --> /api/me/cast/tickets
```

### 1. Device profile and credential (phase AA2)

**Server**

- `POST /api/auth/device-tokens` (interactive session only) mints a `native_device` token for a
  named device (`device_id` generated on the phone, label "Android: <model>"). One active token
  per `(session, device_id)`; minting again replaces it. Expiry = the session's `expires_at`;
  revoking or expiring the session revokes the token (same rule as continuation tokens,
  `api/auth.py:1770-1774`).
- Scope `device.native` with a route allowlist next to the VDJ and continuation ones:
  the device browse and queue routes (below), track stream routes and `playback` resolution,
  artwork routes, `POST /api/me/play-events`, `POST /api/playback/transition-plans`,
  `POST /api/playback/continuation`, `POST /api/me/cast/tickets`, `GET /api/capabilities`,
  `GET /api/auth/me`. Nothing that writes the library, settings or other users.
- Listed and revocable in Listen Settings > Devices, like access tokens.
- Read plane: routes it serves must accept `native_device` tokens or fall through to FastAPI for
  them. Verify which before AA3; the read plane does not validate `crv_` today
  (`readplane/internal/routes/catalog.go:578-581`).

**Android**

- `CrateDevicePlugin` (new Capacitor plugin): `setProfile({serverUrl, serverId, deviceToken,
deliveryPolicy, offlineProfileKey})` and `clearProfile()`. JS calls it after sign-in, on server
  switch, when the delivery preference or offline profile changes, and on logout.
- `DeviceProfileStore`: AES-GCM with an Android Keystore key, like `CrateSecureSessionPlugin`.
  Holds one active profile.
- `DeviceApiClient`: OkHttp or `HttpURLConnection` client with the device token, timeouts, ETag
  caching for browse pages, and a 401 handler that clears the profile and shows "Open Crate on
  your phone to sign in".
- The service authorizes streams with the device token when no fresher session bearer is known,
  replacing the continuation-token fallback for native-owned queues.

### 2. Device browse and queue API (phase AA3)

All under `/api/me/device/`, accepting sessions and `native_device` tokens, paged
(`limit` ≤ 100, opaque `cursor`), with `ETag`/`If-None-Match`.

- `GET /api/me/device/browse/{node}` returns
  `{node, title, items:[{id, kind, title, subtitle, artwork_url, playable, browsable,
duration_ms?}], next_cursor}`. Nodes:
  `root`, `home` (mixes and recent from the home snapshot), `recent`, `playlists`,
  `playlist:{id}`, `liked`, `albums`, `album:{uid}`, `artists`, `artist:{uid}`, `radio`.
  `downloads` is built natively from the offline index, never on the server.
- `GET /api/me/device/search?q=` returns the same item shape (local catalogue, `limit` ≤ 50).
- `POST /api/me/device/queue` with `{node | item_ids[], start_item_id?, shuffle?, delivery}`
  returns native-ready tracks `{id, entityUid, url, title, artist, album, artwork, durationMs}`
  plus an optional continuation descriptor for radios and mixes, and an initial plan window.
  This is the one place that turns a container into a playable queue for native code; it reuses
  the album, playlist, liked and radio repositories.

Performance rules from `AGENTS.md` apply: home nodes read `ui_snapshots`; lists page in SQL; no
`COUNT`/`SUM` over `library_tracks` in the request; batch lookups with `ANY(:ids)`. Artwork URLs
are canonical API paths authorized with the device token by the service's artwork loader.

### 3. MediaLibraryService (phase AA1)

- `CrateNativePlaybackService` extends `MediaLibraryService` with a `MediaLibrarySession`
  whose callback implements `onGetLibraryRoot`, `onGetChildren`, `onGetItem`, `onSearch` /
  `onGetSearchResult`, and `onAddMediaItems` / `onSetMediaItems` (resolve browse ids through the
  queue endpoint). The existing `MediaSession` behaviour (notification, Smart Mix facade, decks,
  checkpoint, resume authorization, network recovery, stream cache) is kept.
- Root hints: answer `EXTRA_RECENT` with the current or last queue so Android Auto can offer
  "resume"; tabs for Home, Library, Downloads; content-style hints (grid for albums and mixes,
  list for tracks).
- Manifest: export the service with `androidx.media3.session.MediaLibraryService` and
  `android.media.browse.MediaBrowserService` actions; add
  `res/xml/automotive_app_desc.xml` (`<uses name="media"/>`) and the
  `com.google.android.gms.car.application` meta-data; car-safe app icon.
- Without a device profile, the root shows one non-playable item, "Open Crate on your phone to
  sign in", and no error loop.

### 4. Playback started outside JS (phase AA4)

- A queue started from the car gets a native revision (`native:<uuid>`). It is checkpointed like
  any other and uses the stream cache, network recovery and Smart Mix plans (via the plan window
  and `NativeContinuationClient` with the device token).
- Voice: `onSetMediaItems` with a search request (`MediaItem.RequestMetadata.searchQuery`)
  resolves through `/api/me/device/search`, then plays the best match (track, else album, else
  artist radio).
- When the app opens while a native-owned queue plays, JS adopts it: a new plugin call returns
  the native queue with track metadata, JS builds `Track` objects from it, persists them and
  stops treating its stored queue as authoritative. The existing revision adoption from the
  resume fix (`adoptPersistedQueueRevision`) is the starting point.

### 5. Plays from native-owned queues (phase AA5)

- `NativePlayReporter` turns native checkpoints and transitions of `native:*` revisions into
  play events (`started_at`, `ended_at`, `played_seconds`, completion, skip, `client_event_id`,
  `device_type=car` or `mobile`, `app_platform=android`) and posts them with the device token.
- Events wait in a durable outbox (the `NativeDurableEventLog` pattern) until the server
  answers, so plays survive process death and offline driving. `client_event_id` makes
  retries safe.
- JS ignores durable events of `native:*` revisions, so plays are reported once (D4).

### 6. Default Cast receiver queue (phase CQ)

- When casting to the default receiver, native code loads a window of the current track and the
  next two with `queueLoad`, each with a 3600 s ticket (`expires_in_seconds`, max 3600).
- On each receiver item change it appends the next track with `queueInsertItems`, requesting its
  ticket with the device token. Works with the WebView frozen.
- The custom receiver path is unchanged and becomes the default once a registered receiver ID
  exists (issue tracker 591015514).

### 7. Downloads in the car

- `OfflineIndexReader` parses `offline-meta/offline-index-<profileKey>.json` for the profile key
  in the device profile and lists verified items under the `downloads` node. Those queues play
  local files only and work with no network or token.

## Delivery and quality

The device profile carries the listener's delivery preference. `auto` resolves natively:
`original` on unmetered networks, `balanced` on metered ones, the same rule JS applies with
`navigator.connection`. The stream cache key already separates qualities.

## Security and privacy

- The device token is scoped to reading and streaming the listener's own library, writing their
  play events and requesting Cast tickets. It cannot change settings, the library or other users.
- It is stored only in Keystore-encrypted storage, never in checkpoints, logs or URLs (Bearer
  header only).
- It dies with its session, is revoked on logout and server switch, and is listed and revocable
  in Settings.
- Android Auto never shows a sign-in form; the car only says to open Crate on the phone.

## Phases

| Phase | Content                                                                                                                                                                        | Depends on |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| AA2   | Device token (server mint, scope, allowlist, revocation, Settings list); `CrateDevicePlugin`, `DeviceProfileStore`, `DeviceApiClient`; JS wiring on sign-in, switch and logout | —          |
| AA3   | `/api/me/device/browse`, `/search`, `/queue` with paging, ETags and tests; read-plane decision                                                                                 | AA2        |
| CQ    | Default Cast receiver queue window and native refill                                                                                                                           | AA2        |
| AA1   | `MediaLibraryService`, callbacks, manifest, automotive descriptor, signed-out root                                                                                             | AA2, AA3   |
| AA4   | Native-owned queues, voice search, JS adoption on app open                                                                                                                     | AA1        |
| AA5   | `NativePlayReporter` with durable outbox; JS skips native revisions                                                                                                            | AA4        |
| AA6   | Downloads node, car UX polish, Desktop Head Unit tests, docs                                                                                                                   | AA1-AA5    |

Each phase is one PR with tests: pytest for scopes and endpoints (including the token being
refused outside its allowlist and after session revocation), Robolectric for the service and
callbacks, JUnit for pure classes, Vitest for the JS wiring.

## Testing

- **Desktop Head Unit (DHU)** on the development machine, with Android Auto's developer mode and
  unknown sources enabled on a test phone.
- A gate per phase: AA1 shows the signed-out and signed-in roots on the DHU; AA4 starts and
  controls an album and a voice search; AA5 shows car plays in history after process death; CQ
  plays five tracks in a row on a Chromecast with the screen off.

## Open questions

1. Settings UI for devices: a new "Devices" section, or extend the existing access-token list?
2. Should the device token also replace the session bearer for JS-loaded queues, so streams
   never depend on a 1 h JWT? (Simplifies `NativeStreamAuthorization`.)
3. Home nodes for the car: which home sections are worth showing while driving (mixes, recent,
   radio) and which are not (essentials, suggestions)?
4. Play Store distribution later, or keep APK plus developer setting permanently?
