---
title: Crate Decks server contract
summary: What the server offers the Crate Decks desktop DJ client - session, capabilities and the fields it relies on.
section: reference
audience: [developer]
status: canonical
order: 35
verified: 2026-11-03
sources:
  - app/crate/api/auth.py
  - app/crate/api/native_oauth_auth.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/capabilities.py
  - app/crate/api/browse_media.py
  - app/crate/api/schemas/media.py
  - app/crate/api/schemas/smart_mix.py
  - app/crate/db/queries/browse_media_search.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/cue_detection.py
  - app/crate/smart_mix/analyzer.py
  - app/readplane/internal/routes/catalog.go
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeTransitionPlan.java
  - app/tests/test_auth_decks_client.py
  - app/tests/test_capabilities_decks.py
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
    "features": []
  }
}
```

| Field                | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `available`          | The server accepts the Decks client                                       |
| `min_client_version` | Oldest Decks version (semver) the server supports                         |
| `contract_version`   | Integer, bumped on every incompatible change to the Decks server contract |
| `features`           | Decks server contracts this instance serves                               |

Rules:

- `contract_version` changes only on incompatible changes. The server PR that
  makes one bumps it, and the client handles both versions for one release.
  Additive changes only add a value to `features`.
- Clients ignore unknown `features` values and degrade when one is missing.
- Each feature is added by the server change that implements it:

  | Feature                                       | Server change                         |
  | --------------------------------------------- | ------------------------------------- |
  | `library_cursor`                              | S3, paginated navigation for clients  |
  | `profiles_batch`                              | S4, batch mix profiles                |
  | `beatmatch`, `bass_handoff`, `long_beatmatch` | S5, `decks` context in the planner    |
  | `cues`                                        | S7, synchronised cues and corrections |

  None ships yet, so `features` is empty. Decks features never follow the
  Android Smart Mix flags (`CRATE_ANDROID_*`); `smart_mix.android_*` remains
  the Android contract.

The constants live in `app/crate/api/capabilities.py`
(`DECKS_CONTRACT_VERSION`, `DECKS_MIN_CLIENT_VERSION`, `_decks_features`), and
the allowed feature names in `DecksFeature`
(`app/crate/api/schemas/capabilities.py`).

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
