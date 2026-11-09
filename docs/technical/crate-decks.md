---
title: Crate Decks server contract
summary: What the server offers the Crate Decks desktop DJ client - session, capabilities and the fields it relies on.
section: reference
audience: [developer]
status: canonical
order: 35
verified: 2026-11-09
sources:
  - app/crate/api/auth.py
  - app/crate/api/native_oauth_auth.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/capabilities.py
  - app/crate/api/browse_media.py
  - app/crate/api/schemas/media.py
  - app/crate/api/schemas/smart_mix.py
  - app/crate/api/decks_stems.py
  - app/crate/api/smart_mix.py
  - app/crate/api/settings.py
  - app/crate/api/permissions.py
  - app/crate/smart_mix/stems.py
  - app/crate/db/repositories/smart_mix_stems.py
  - app/crate/db/repositories/smart_mix_stem_files.py
  - app/crate/smart_mix/stem_files.py
  - app/crate/api/smart_mix_playlists.py
  - app/crate/db/repositories/smart_mix_playlists.py
  - app/crate/api/schemas/playlists.py
  - app/crate/db/queries/browse_media_search.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/cue_detection.py
  - app/crate/smart_mix/analyzer.py
  - app/readplane/internal/routes/catalog.go
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeTransitionPlan.java
  - app/tests/test_auth_decks_client.py
  - app/tests/test_capabilities_decks.py
  - app/tests/test_capabilities_stems.py
  - app/tests/test_decks_stem_analysis_api.py
  - app/tests/test_stem_files.py
  - app/tests/test_smart_mix_playlists_api.py
  - app/tests/test_search_playable_audio.py
---

# Crate Decks server contract

Crate Decks is a desktop DJ client built on Mixxx. It uses a Crate server as its
library: it browses and searches the user's local library, downloads original
audio, imports Smart Mix profiles and asks the planner for transition plans. It
lives in its own repository; this page is the server side of the contract. The
server changes are additive and are announced through `GET /api/capabilities`,
so Listen, VirtualDJ and OpenSubsonic clients are not affected.

## Session (S1)

Decks is a first-class native client with the same session policy as Listen. It
sends `X-Crate-App: decks/<version>` on every request, logs in with email and
password or with native OAuth (app ID `crate-decks`, PKCE, loopback callback on
`http://127.0.0.1:<port>/callback`), and receives a refresh token. It also sends `X-Device-Fingerprint`, a random ID
created once per install, so each machine keeps its own session. It is
bearer-only: the server never sets auth cookies for it. The full rules are in
the native authentication contract (`docs/technical/listen-native-auth-contract.md`,
section "Native clients: Listen and Crate Decks").

`crv_` access tokens keep working for VirtualDJ and automations; Decks does not
need them.

## Capabilities (S2)

`GET /api/capabilities` includes a `decks` section for every caller:

```json
{
  "decks": {
    "available": true,
    "min_client_version": "0.1.0",
    "contract_version": 1,
    "features": ["stems", "stem_upload"]
  }
}
```

| Field                | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `available`          | The server accepts the Decks client                                       |
| `min_client_version` | Oldest Decks version (semver) the server supports                         |
| `contract_version`   | Integer, bumped on every incompatible change to the Decks server contract |
| `features`           | Decks server contracts this instance serves to this caller                |

Rules:

- `contract_version` changes only on incompatible changes. The server PR that
  makes one bumps it, and the client handles both versions for one release.
  Additive changes only add a value to `features`.
- Clients ignore unknown `features` values and degrade when one is missing.
- Each feature is added by the server change that implements it:

  | Feature                                       | Server change                                                          |
  | --------------------------------------------- | ---------------------------------------------------------------------- |
  | `library_cursor`                              | S3, paginated navigation for clients                                   |
  | `profiles_batch`                              | S4, batch mix profiles                                                 |
  | `beatmatch`, `bass_handoff`, `long_beatmatch` | S5, `decks` context in the planner                                     |
  | `cues`                                        | S7, synchronised cues and corrections                                  |
  | `stems`                                       | Smart Mix Stems ST1, stem analysis reads and the profile stems layer   |
  | `stem_upload`                                 | Smart Mix Stems ST1, stem analysis uploads (only for a caller who may) |
  | `local_refinement`                            | Smart Mix Stems ST3, candidate menu for local refinement               |

  `stems` and `stem_upload` ship so far. `stems` is always present.
  `stem_upload` is present only when the caller's session holds
  `smart_mix.stems.contribute` and an admin has not turned uploads off, so it
  depends on who asks. Decks features never follow the Android Smart Mix flags
  (`CRATE_ANDROID_*`); `smart_mix.android_*` remains the Android contract.

The constants live in `app/crate/api/capabilities.py`
(`DECKS_CONTRACT_VERSION`, `DECKS_MIN_CLIENT_VERSION`, `_decks_features`), and
the allowed feature names in `DecksFeature`
(`app/crate/api/schemas/capabilities.py`).

## Stem analyses (Smart Mix Stems ST1)

Crate Decks separates tracks into stems on the DJ's machine and shares the
result as a `stem-analysis/1` document: per-stem level curves, never audio. The
format, its storage and which analysis applies are in the Smart Mix operations
doc (`docs/technical/smart-mix-operations.md`, section "Stem analyses").

| Route                                                     | Use                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/decks/tracks/{uid}/stem-analysis`               | The analysis Smart Mix uses for the track's current file, as a document |
| `PUT /api/decks/tracks/{uid}/stem-analysis`               | Upload Decks' own analysis of the track                                 |
| `GET /api/decks/tracks/{uid}/stems`                       | Download the server's stem file of the track (Smart Mix playlists)      |
| `GET /api/tracks/by-entity/{uid}/mix-profile?detail=full` | The profile with its `stems` layer, when an analysis applies            |

The `/api/decks` routes take a Decks session; `crv_` access tokens do not reach
them. A UID outside the server's local library answers 404.

**Read.** `GET` answers the analysis of the track's current source revision, the
stronger separator first and the server's on a tie, in the same JSON an upload
sends. It answers 404 when the track has no profile, when its file changed since
its analyses, or when it has none. Decks reads it before separating a track.

**Upload.** An upload is untrusted input. The server checks, in this order:

| Check                                                                                      | Answer |
| ------------------------------------------------------------------------------------------ | ------ |
| A session                                                                                  | 401    |
| The `smart_mix.stems.contribute` permission (owner and admin roles by default)             | 403    |
| A body of at most 64 KiB, by `Content-Length` and while reading it                         | 413    |
| Uploads turned on (`stem_uploads_enabled` in `PUT /api/settings/smart-mix`, on by default) | 403    |
| A valid `stem-analysis/1` document with no unknown fields                                  | 422    |
| A `crate-decks/<version>` producer: Decks cannot pass its analysis off as the server's     | 422    |
| A local track with that UID                                                                | 404    |
| `sourceRevision` equal to the profile's `sourceRevision` of the current file               | 409    |
| `durationMs` within 2 % of the profile's duration                                          | 422    |

A 409 means the file changed after Decks got the track: the client fetches the
profile again before it separates or uploads again. When everything passes, the
answer is `{"result": "stored" | "replaced" | "kept_stronger"}`.
`kept_stronger` stores nothing, because the server already has an analysis of
the same file from an equal or stronger separator, so retrying the same upload
changes nothing. Each stored upload records the uploader in `contributed_by`.

**Profile layer.** With `detail=full`, the profile gains an optional `stems`
object when an analysis of its current file applies: `producer`,
`separatorModel`, `separatorVersion` and `phrases`, one entry per phrase with
`startMs`, `endMs` and the mean level byte of `drums`, `bass`, `other` and
`vocals`. The summary profile never carries it, because the Go read plane serves
the summary natively. No planner reads the layer yet (ST3).

**Stem files.** For the tracks of Smart Mix playlists the server also keeps
the separated audio, when `smart_mix.stems.storage` is true in
`GET /api/capabilities`. `GET /api/decks/tracks/{uid}/stems` answers one MP4
(`audio/mp4`) with three AAC streams at 256 kbps, in this order: drums, bass
and vocals, each named in its handler (`handler_name`), at 44.1 kHz stereo.
There is no `other` stream: Decks computes it as its own decode minus the three
stems (STEM-D9). Range requests are served (`206` with `Content-Range`), so a
download can resume. The route answers 404 when the server has no stem file of
the track's current file: not separated yet, separated from a file that has
changed since, evicted by the server's quota, or a server that keeps no stem
files. Decks then separates the track itself; the analysis may still be there
(`GET .../stem-analysis`). A download counts as use of the file and of the
caller's Smart Mix playlists that hold the track, which keeps them from being
evicted first. A five-minute track is about 29 MB.

## Smart Mix playlists (Smart Mix Stems ST2)

A Smart Mix playlist is a playlist its owner marks for Smart Mix. The mark is
the same for Listen, the web app and Decks: the server separates the
playlist's tracks into stems, and Decks keeps the playlist as an offline set
(it replaces Decks' own offline sets). How the server stores the state and
queues the work is in the Smart Mix operations doc
(`docs/technical/smart-mix-operations.md`, section "Smart Mix playlists").
`smart_mix.stems.playlists` in `GET /api/capabilities` says the server offers
them.

| Route                                              | Use                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/smart-mix/playlists?sinceRevision=N`     | The caller's Smart Mix playlists changed after revision `N`        |
| `GET /api/smart-mix/playlists/{playlistId}`        | The playlist's state, its tracks' stem progress and an estimate    |
| `PUT /api/smart-mix/playlists/{playlistId}`        | Turn Smart Mix on or off: `{"enabled": true \| false}`, owner only |
| `GET /api/playlists`, its detail, `playlists-page` | Each playlist carries `smartMix: {enabled, ready, total}`          |

All of them take a session; `crv_` access tokens do not reach them.

**Sync.** Every change of one of the user's Smart Mix playlists takes the next
value of a per-user revision: turned on, turned off, or tracks added, removed
or replaced while it is on. The list answers
`{"revision": R, "playlists": [...]}`, oldest change first, including
playlists turned off. Each item has `playlistId`, `enabled`, `enabledAt`,
`disabledAt`, `lastUsedAt`, `revision` and `updatedAt`. Decks keeps `R` and
sends it as `sinceRevision` next time; without it, the list has every Smart
Mix playlist the user ever turned on. A deleted playlist loses its Smart Mix
row with it and is not listed as a change: Decks drops offline sets whose
playlist no longer exists in `GET /api/playlists`. A change of tracks comes as
a new revision of the playlist, so Decks reads its tracks again from
`GET /api/playlists/{id}`.

**Turning it on or off.** Only the playlist's owner can, and system playlists
have none: anyone else gets 403, and an unknown playlist 404. Setting the state
the playlist already has changes nothing (turning on again only queues the
tracks still missing). Turning it on answers 409 when the playlist, or all of
the owner's Smart Mix playlists together, would hold more distinct local
tracks than the instance allows (`stem_max_tracks_per_playlist`, 300 by
default, and `stem_max_tracks_per_user`, no limit by default, both in
`PUT /api/settings/smart-mix`). Adding tracks to a Smart Mix playlist past
those limits answers 409 too, in `POST /api/playlists/{id}/tracks`, in
`POST /api/playlists/{id}/generate` and in OpenSubsonic. The answer is the
playlist's state, as in the list; a playlist that was never on answers
`enabled: false` with null dates and revision.

**Progress.** The status adds `total` (distinct local tracks while it is on),
`counts` per state and `tracks`, one per local track in playlist order with
`trackId`, `trackEntityUid`, `state` and `attempts`:

| `state`     | Meaning                                                    |
| ----------- | ---------------------------------------------------------- |
| `ready`     | The server has a stem analysis of the track's current file |
| `pending`   | Waiting for separation                                     |
| `analyzing` | Being separated                                            |
| `failed`    | Separation failed for this file; retried up to 3 attempts  |

`estimatedSecondsLeft` is the time left for the playlist's pending and
analysing tracks at the server's recent pace, without other queued work; it is
null while the playlist is off. The owner, collaborators and admins read the
status; other users get 403.

**Playlist responses.** `smartMix` is `{enabled, ready, total}`: `ready` of
`total` local tracks have server stems, both 0 while Smart Mix is off. It is
computed for all listed playlists in one query. It is reported on the caller's
own and shared playlists (`GET /api/playlists`, `playlists` in
`GET /api/me/playlists-page`, and the detail for the owner and collaborators),
and is null elsewhere. The Go read plane serves none of these routes.

## Audio availability and plan fields (S9)

### `playable` in DJ search

Decks searches with `GET /api/search?fields=dj&q=…&limit=50`. Each track in that
response carries `playable`:

- `true`: the audio file exists in the library as a regular file, so
  `/api/tracks/by-entity/{uid}/stream` (and the VDJ stream) can serve it.
- `false`: the library row exists but the file is missing, is not a regular
  file, resolves outside the library or cannot be read. Decks should not offer
  it for loading.

The check is the one the stream endpoints use (`resolve_source_path` and
`is_file()`), done on every request for at most 50 results. The server path is
used for the check and never returned. Access-token DJ queries (a valid DJ query
without `fields=dj`) also carry `playable`.

Plain local, `auto` and federated search do not include `playable`: the Go read
plane serves plain local search natively and must keep the same JSON. Any
`/api/search` request with a `fields` parameter falls back from the read plane
to FastAPI (`searchRoute` in `app/readplane/internal/routes/catalog.go`), so
`fields=dj` gets the DJ filters and `playable` behind the edge too. The paged
navigation responses (S3) will carry the same field when they exist.

### Plan and profile fields

- **`beatPhaseOffsetMs`** (`POST /api/playback/transition-plans`): beat-phase
  correction for `mode=beatmatch`, 0 in the other modes. It is measured on the
  outgoing (mix) timeline and is smaller than one outgoing beat. It moves the
  incoming start point ahead, never back: when the outgoing reaches
  `outgoingCueMs`, the incoming starts from
  `incomingCueMs + round(beatPhaseOffsetMs × incomingTempoRatio)` ms of its own
  audio, at `incomingTempoRatio` speed. In the other modes it starts at
  `incomingCueMs`.
- **`activeEndMs`** (`GET /api/tracks/by-entity/{uid}/mix-profile`): the musical
  end of the track, the end of the last 50 ms frame whose RMS stays within 35 dB
  of the loudest analysed frame and above −55 dBFS (long files measure it on
  their analysed tail). Fade-out tails fall after it, so it is not a silence
  threshold: a client that needs the point where the audio drops to silence
  (Mixxx's −60 dB N60dBSound) measures it itself. `outroCueMs` is placed
  before it.

The Android client applies the offset the same way
(`NativeTransitionPlan.startIncomingCueMs()`); the planner computes it in
`_beat_phase_offset` (`app/crate/smart_mix/planner.py`), and the analyser
computes `activeEndMs` in `detect_mix_cues`
(`app/crate/smart_mix/cue_detection.py`).
