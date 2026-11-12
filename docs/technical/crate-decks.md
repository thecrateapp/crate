---
title: Crate Decks server contract
summary: What the server offers the Crate Decks desktop DJ client - session, capabilities and the fields it relies on.
section: reference
audience: [developer]
status: canonical
order: 35
verified: 2026-11-10
sources:
  - app/crate/api/auth.py
  - app/crate/api/native_oauth_auth.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/capabilities.py
  - app/crate/api/decks.py
  - app/crate/api/schemas/decks.py
  - app/crate/db/queries/decks_library.py
  - app/crate/db/queries/decks_profiles.py
  - app/crate/db/queries/vdj_catalog.py
  - app/crate/streaming/service.py
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
  - app/tests/test_decks_library_api.py
  - app/tests/test_decks_library_queries.py
  - app/tests/test_decks_profiles_api.py
  - app/tests/test_openapi_contract.py
  - app/tests/test_readplane_route_manifest.py
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
    "features": [
      "library_cursor",
      "profiles_batch",
      "stems",
      "stem_upload",
      "local_refinement"
    ]
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

  `library_cursor`, `profiles_batch`, `stems`, `stem_upload` and
  `local_refinement` ship so far. `library_cursor`, `profiles_batch`, `stems`
  and `local_refinement` are always present. `stem_upload` is present only when the
  caller's session holds `smart_mix.stems.contribute` and an admin has not
  turned uploads off, so it depends on who asks. Decks features never follow
  the Android Smart Mix flags (`CRATE_ANDROID_*`); `smart_mix.android_*`
  remains the Android contract.

The constants live in `app/crate/api/capabilities.py`
(`DECKS_CONTRACT_VERSION`, `DECKS_MIN_CLIENT_VERSION`, `_decks_features`), and
the allowed feature names in `DecksFeature`
(`app/crate/api/schemas/capabilities.py`).

## Library navigation (S3)

Decks mirrors the user's library into its own tables. Two read-only routes
serve it, announced by the `library_cursor` feature:

- They need a user session. A `crv_` access token gets `401`: the auth
  middleware never lets one reach `/api/decks`, and the handlers answer `403`
  if one ever does. A trusted-header user without a Crate account also gets
  `403`.
- Each request runs one bounded SQL statement and never aggregates over
  `library_tracks`.
- Both answer `If-None-Match` with `304`.
- The Go read plane does not serve them: no edge routes `/api/decks/*` to it,
  so they always reach FastAPI (`test_decks_library_routes_stay_on_fastapi`).

### Container tree

`GET /api/decks/containers`

```json
{
  "library": { "track_count": 136512 },
  "containers": [
    {
      "id": "28",
      "kind": "playlist",
      "name": "Para el coche",
      "parent_id": null,
      "track_count": 52,
      "etag": "6f1e0c2b9a4d7e3f5a8b1c0d2e4f6a8b"
    },
    {
      "id": "8c3c0f8e-1b9e-4f2e-9d55-2f7a1b0c4d6e",
      "kind": "crate",
      "name": "Digging",
      "parent_id": null,
      "etag": "0b7d4f1a2c3e5d6f7a8b9c0d1e2f3a4b"
    },
    {
      "id": "17",
      "kind": "genre",
      "name": "Techno",
      "parent_id": null,
      "track_count": 4312,
      "etag": "9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d"
    },
    {
      "id": "party",
      "kind": "mood",
      "name": "Party",
      "parent_id": null,
      "etag": "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
    },
    {
      "id": "me",
      "kind": "recent",
      "name": "Recently Played",
      "parent_id": null,
      "etag": "1f2e3d4c5b6a79881726354453627180"
    },
    {
      "id": "me",
      "kind": "likes",
      "name": "Likes",
      "parent_id": null,
      "etag": "d41d8cd98f00b204e9800998ecf8427e"
    }
  ]
}
```

The tree lists the kinds in this order, and each kind in its own order:

| Kind       | Nodes                                                                                                                      | Id          | Order                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------- |
| `playlist` | Active playlists the user owns or is a member of, and the public or system playlists they follow (the set VirtualDJ lists) | Playlist id | Name                   |
| `crate`    | Crates the user owns, collaborative crates they are a member of, and public crates they follow                             | Crate UUID  | Name                   |
| `genre`    | The 40 genres with the most albums (`DECKS_GENRE_LIMIT`, the same top list as VirtualDJ's genre folders)                   | Genre id    | Album count, then name |
| `mood`     | One node per mood: `aggressive`, `dark`, `happy`, `party`, `relaxed`, `sad`                                                | Mood key    | Fixed (alphabetical)   |
| `recent`   | One node                                                                                                                   | `me`        | After the moods        |
| `likes`    | One node                                                                                                                   | `me`        | Last                   |

| Field         | Meaning                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | Unique within its kind, so clients key nodes by `(kind, id)`                                                                                                                                                                                                             |
| `kind`        | Clients ignore kinds they do not know; new kinds are additive                                                                                                                                                                                                            |
| `parent_id`   | Always `null` (there are no folders)                                                                                                                                                                                                                                     |
| `track_count` | Only when the server keeps it precomputed, omitted otherwise: playlists (`playlists.track_count`) and genres (the sum of their albums' `library_albums.track_count`). It counts every entry, including entries without a local track that the tracks endpoint leaves out |
| `etag`        | A membership and order signal, without reading the tracks: see below. Track metadata and profile changes do not change it; they change the page `ETag`                                                                                                                   |

What changes a node `etag`:

- `playlist`: the playlist's `updated_at`, `editorial_revision`, `generation_epoch` or `track_count` (adding, removing or reordering entries bumps `updated_at`).
- `crate`: the crate's `updated_at` (album changes bump it), `is_ordered` or `sort_direction`.
- `genre`: the genre's albums (count and ids) or their track counts.
- `mood`: never. Mood membership follows the analysis; revalidate mood pages with `If-None-Match`.
- `recent`: a new play event.
- `likes`: any like added or removed.

Public and system playlists and public crates that the user does not follow
are not in the tree, but the tracks endpoint serves them (see access below).

`library.track_count` is the number of tracks in the whole library, the count
Decks shows for its Library entry:

- It is always present, `0` for an empty library.
- It adds up the albums' `library_albums.track_count`, the counts the scanner
  keeps and the genre nodes use, so no request counts `library_tracks`.
- Like the playlist and genre counts, it includes tracks without an
  `entity_uid`, which the tracks endpoint leaves out. A track outside any album
  is not counted.
- `library` is not a container: it has no node `etag` and no tracks endpoint. A
  change to it changes the tree's response `ETag` (see caching below).

### Container tracks

`GET /api/decks/containers/{kind}/{id}/tracks?cursor=…&limit=500`

```json
{
  "container": { "kind": "playlist", "id": "28" },
  "tracks": [
    {
      "entity_uid": "0f6b3d9e-5a1c-4e2b-8d7f-1a2b3c4d5e6f",
      "global_track_uid": "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
      "title": "Noah",
      "artist": "Converge",
      "album": "Jane Doe",
      "duration_ms": 245500,
      "bpm": 124.0,
      "camelot": "8A",
      "energy": 0.72,
      "genre": "Metalcore",
      "format": "flac",
      "bitrate": 1411,
      "sample_rate": 44100,
      "bit_depth": 16,
      "byte_length": 43251877,
      "source_revision": "432bd8811cde4ee2c4b333c8ea5eeee1ae3ddce8ee248c94d7afea3e74403112",
      "profile_revision": "98d2b4a5b3372ffe6cc383d06c1dbd22d7feea71ff12728443dce61b61790317",
      "profile_quality": "full",
      "playable": true,
      "cover_url": "/api/vdj/albums/412/cover?size=512"
    }
  ],
  "next_cursor": "WyJwbGF5bGlzdCIsIjI4IixbNTAwLDE4MzRdXQ"
}
```

| Field                                           | Type                     | Meaning                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity_uid`                                    | string                   | Library track UID: the key for the stream and mix-profile endpoints                                                                                                                                                                                                 |
| `global_track_uid`                              | string or null           | Global catalog track, when there is one                                                                                                                                                                                                                             |
| `title`, `artist`                               | string                   | Title (the file name when the tag is empty) and artist                                                                                                                                                                                                              |
| `album`                                         | string or null           | Album name                                                                                                                                                                                                                                                          |
| `duration_ms`                                   | integer or null          | Track duration in milliseconds                                                                                                                                                                                                                                      |
| `bpm`                                           | number or null           | BPM of the Smart Mix profile, else the tag BPM                                                                                                                                                                                                                      |
| `camelot`, `energy`                             | string, number           | Key and global energy (0 to 1) of the Smart Mix profile; `null` without one                                                                                                                                                                                         |
| `genre`                                         | string or null           | Track tag, else album tag, else the album's strongest genre                                                                                                                                                                                                         |
| `format`, `bitrate`, `sample_rate`, `bit_depth` | string, integers or null | As the scanner recorded them                                                                                                                                                                                                                                        |
| `byte_length`                                   | integer or null          | Size of the audio file the stream endpoints serve (`stat`). When the file is not playable, the size the scanner recorded                                                                                                                                            |
| `source_revision`                               | string or null           | Revision of the audio file on disk (hash of size, mtime and inode), the same value a current profile records as its source revision. It changes whenever the file changes; `null` when the track is not playable                                                    |
| `profile_revision`, `profile_quality`           | string or null           | The Smart Mix profile `GET /api/tracks/by-entity/{uid}/mix-profile` serves: any analyzer and schema version, as long as its source is not stale. `null` when there is none. `profile_quality` is `full`, `partial`, `legacy` or `unavailable` (the analysis failed) |
| `playable`                                      | boolean                  | Same meaning and check as in the DJ search (S9)                                                                                                                                                                                                                     |
| `cover_url`                                     | string or null           | Album cover (a public route), `null` when the album has none                                                                                                                                                                                                        |

Order, by kind:

- **`playlist`**: playlist position. Entries without a local library track
  (deleted or remote-only) are left out. Inactive playlists are `404`.
- **`crate`**: crates hold albums, so a crate expands to the local tracks of its
  albums: album position in the crate (reversed when the crate is ordered
  descending), then disc and track number, then track id. Albums without local
  tracks add nothing, and a track that appears twice keeps its first place.
- **`genre`**: the tracks of the albums tagged with the genre (`album_genres`),
  by album id, then disc and track number, then track id. Any genre id works,
  not only the ones in the tree.
- **`mood`**: tracks whose score for the mood (`library_tracks.mood_json`) is a
  number of at least `0.5`, highest score first, ties by track id. These are
  VirtualDJ's mood folders.
- **`recent`** (id `me`): the tracks of the user's last 2,000 play events, most
  recently played first, each once. A play whose track row is gone counts for
  the library track with the same entity UID; remote-only plays are left out.
- **`likes`** (id `me`): newest like first. It merges the canonical global likes
  that have a local track with legacy local likes; a track liked twice appears
  once.

Only library tracks with an `entity_uid` are listed.

Access: a playlist can be read by its owner and members, or by anyone when it
is public or a system playlist; a crate by its owner and collaborators, or by
anyone when it is public. Anything else is `403`, also for admins. Genres and
moods are the shared library; `recent` and `likes` are always the caller's.

Errors:

| Status | When                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Malformed cursor, or a cursor from another container                                                                                                                                                                        |
| `401`  | No session, or a `crv_` access token                                                                                                                                                                                        |
| `403`  | Another user's private playlist or crate; an access token or an accountless trusted-header user reaching the handler                                                                                                        |
| `404`  | Unknown container, inactive playlist, or an id that is not valid for its kind (a playlist or genre id that is not a number, a crate id that is not a UUID, an unknown mood, `recent` or `likes` with an id other than `me`) |
| `422`  | Unknown kind, `limit` outside 1 to 500, a container id longer than 64 characters or a cursor longer than 1,024                                                                                                              |

Paging:

- `limit` is 1 to 500 (default 500).
- `container.id` echoes the canonical id (`007` becomes `7`, a crate UUID its
  lowercase hyphenated form). The tree already lists canonical ids.
- `next_cursor` is opaque (base64url, no padding, of the kind, the container id
  and the last row's sort key). Send it back unchanged as `cursor`. `null` means
  the last page.
- Pagination is keyset-based. Rows appended to a container (new playlist
  entries, crate albums added at the end) show up on later pages, and a client
  that pages through never gets a row twice or misses one, unless rows are
  removed or reordered meanwhile. `recent` and `likes` are newest first, so a
  play or like added while paging shows up on the first page, not on later ones;
  a mood score that changes while paging can move a track across pages.

Caching:

- Each response carries a strong `ETag` computed from its body (a quoted
  32-character hex string), so it changes with any change to the response: in
  the tree, `library.track_count` or any node; in a page, the tracks, any field
  (`playable` included) or `next_cursor`.
- `If-None-Match` (one value, a list, `*`, or a weak `W/` value) that matches
  gets `304` and no body, with the same `ETag`. The server still runs the query;
  the `304` saves the transfer and the client's parsing.
- Responses are `Cache-Control: private, no-cache`.

Cost (measured 2026-11-09):

- On a synthetic library sized like production, in its own PostgreSQL:
  141,715 tracks in 10,900 albums, 400 genres (the largest on 30% of the
  albums), 134,629 profiles, a 2,000-entry playlist, a 200-album crate, and
  3,500 likes and 60,000 plays for the user, and 98% of the audio files present.
- Every page reads its container in order through indexes and stops after the
  page. No plan reads `library_tracks` sequentially and nothing aggregates over
  it; `test_explain_uses_index` and `test_no_aggregate_over_library_tracks` pin
  both. A 500-track page takes 9,000 to 23,000 shared buffer hits, the tree
  under 1,000.
- There is no stored genre ranking: the tree ranks `album_genres` (about 26,000
  rows) on every request, which is most of the tree's cost. It also adds up the
  albums' track counts for `library.track_count`, one pass over
  `library_albums` (about 11,000 rows).
- `playable`, `source_revision` and `byte_length` come from one `stat` per
  track (`stat_playable_sources`), which resolves the library root once and each
  folder once per page.
- The measurement machine was a laptop under heavy unrelated load (load average
  25 to 31 on 22 hybrid cores), so its times are well above an idle server's.
  There, PostgreSQL executed a 500-track page in 18 to 74 ms and the tree in
  24 ms (`EXPLAIN ANALYZE` without per-node timing). At p95, the statement with
  its rows took 40 to 103 ms, the 500 file checks 17 to 40 ms, and the whole
  request through the app 110 to 277 ms (85 to 176 ms at the median), where a
  trivial endpoint (`/api/capabilities`) already took 63 ms (33 ms at the
  median).
- Side by side under the same load and on the same data, every page was 1.5 to
  3.5 times faster at the median than the first S3 implementation, which
  measured 49 to 61 ms at p95 end to end on a copy of the dev database
  (2026-11-04). The 150 ms budget therefore holds by that extrapolation, not by
  a measurement on an idle server, and there is no `playable` column. Cold disk
  caches add latency to each file check; if that ever breaks the budget,
  availability moves to a column.
- Diego accepted on 2026-11-09 the p95 extrapolation above and the two
  deviations from the plan: genres ranked on every request instead of a
  precomputed top N, and no migration (no `playable` column).

## Batch mix profiles (S4)

Decks imports the Smart Mix analysis of a whole playlist or container at once
(client phase F4) instead of one profile request per track. The route is
announced by the `profiles_batch` feature.

`POST /api/decks/mix-profiles`

```json
{
  "entity_uids": [
    "0b6f2c1e-5d6a-4c1b-9a51-2f0c8a3c9e10",
    "7d1e9b44-3f2a-4e8e-8c0d-61b5a2f4d7aa"
  ],
  "detail": "full"
}
```

```json
{
  "profiles": {
    "0b6f2c1e-5d6a-4c1b-9a51-2f0c8a3c9e10": {
      "trackEntityUid": "0b6f2c1e-5d6a-4c1b-9a51-2f0c8a3c9e10",
      "profileRevision": "…",
      "bpm": 124.0,
      "beatGridMs": [512, 996, 1480],
      "stems": { "producer": "crate-server/2026.11.9", "phrases": [] }
    }
  },
  "missing": ["7d1e9b44-3f2a-4e8e-8c0d-61b5a2f4d7aa"]
}
```

Request:

- `entity_uids`: 1 to 200 track entity UIDs. A UID sent twice, or in another
  case, is answered once.
- `detail`: only `full`, the default.

Response:

- `profiles`: each profile is exactly what
  `GET /api/tracks/by-entity/{uid}/mix-profile?detail=full` answers for the
  track, with the same fields, the beat grid and the optional `stems` layer
  (`full_mix_profile_response` in `app/crate/api/smart_mix.py` serves both).
  The keys are the UIDs in lowercase hyphenated form, in request order.
- `missing`: the requested UIDs without a current profile, in request order:
  not a local library track, never analysed, or a file that changed since its
  analysis. These are the UIDs the single endpoint answers with `404`.

Access is the same as for the S3 routes: a user session; a `crv_` access token
gets `401` from the middleware and `403` if it ever reaches the handler, and a
trusted-header user without a Crate account gets `403`. Profiles are part of
the shared local library, so every signed-in user reads the same ones, as with
the single endpoint.

Errors:

| Status | When                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------- |
| `401`  | No session, or a `crv_` access token                                                            |
| `403`  | An access token or an accountless trusted-header user reaching the handler                      |
| `422`  | No UIDs, more than 200, a value that is not a UUID, `detail` other than `full`, or extra fields |

Cost:

- One SQL statement per request (`get_decks_mix_profiles` in
  `app/crate/db/queries/decks_profiles.py`, pinned by `test_single_query`): the
  tracks by `entity_uid = ANY(:entity_uids)` through the unique
  `idx_lib_tracks_entity_uid`, their current profile by primary key, and their
  stem analyses of the same source revision by primary key. A track with
  analyses from both producers comes back on two rows, so at most 400 rows.
- Nothing aggregates over `library_tracks` and nothing touches the audio files.
- Measured 2026-11-10 in a Testcontainers PostgreSQL with 140,000 tracks,
  135,000 profiles and 4,000 tracks with both producers' analyses, on a batch
  of 200 six-minute tracks (767 beats each), 40 of them with stems: PostgreSQL
  executes the statement in about 1.3 ms (1,700 shared buffer hits). The time
  goes to Python, decoding and checking 200 beat grids: 70 to 85 ms at p95 for
  the read, 120 to 130 ms at p95 for the whole request through the app (about
  1.4 MB of JSON), on a laptop with a load average of 2 to 3, where
  `/api/capabilities` took 10 ms at p95. The single endpoint pays the same per
  track, so one batch replaces 200 requests of that cost.

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
`separatorModel`, `separatorVersion`, `vocalDetector` (`stem-vocals-1`) and
`phrases`, one entry per phrase with `startMs`, `endMs`, the mean level byte of
`drums`, `bass`, `other` and `vocals`, and whether the phrase has each of
vocals, bass and drums (`vocalPresent`, `bassPresent`, `drumsPresent`; cuts in
`docs/technical/smart-mix-operations.md`, "Stem analyses"). The summary profile
never carries it, because the Go read plane serves the summary natively.
`smart-mix-v3` scores with the layer when both tracks of an edge have one and
the request is Crate Decks' (`source: "decks"`; no other client gets the layer)
and the edge belongs to the beatmatch family (both tracks' genre priors at least 0.5,
with the machine-drum industrial family in, STEM-G1), and says so with
`stemsUsed: true` on the plan.

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

## Local refinement (Smart Mix Stems ST3)

The server plan is the baseline; Crate Decks may refine it locally with its own
stems (STEM-D10). It asks for the material with `plannerVersion:
"smart-mix-v3"` and a `decks` context:

```json
{
  "plannerVersion": "smart-mix-v3",
  "edges": [
    {
      "outgoingTrackEntityUid": "…",
      "incomingTrackEntityUid": "…",
      "context": {
        "source": "decks",
        "automatic": true,
        "offline": false,
        "preferredDurationMs": 12000,
        "userCueProfile": "auto",
        "allowBeatmatch": true,
        "allowTempoAdjustment": true,
        "allowBassHandoff": true,
        "allowLongBeatmatch": true,
        "localRefinement": true
      }
    }
  ]
}
```

Each plan then also carries:

- **`candidates`**: the v3 menu, best first (index 0 is the served plan), each
  with `outgoingPhrase`, `incomingPhrase`, `lengthBars`, `structureUsed`,
  `stemsUsed` (only when true), `score`, the `breakdown` (the six components,
  `vocal` and, with stems on both tracks, `stems`: `vocalOverlapMs`,
  `bassOverlapMs`, `drumsOnlyEntry`, `vocalFreeExit`) and the complete `plan`.
  Null values are left out.
- **`policyLimits`**, when both tracks have a profile: the planner policy
  resolved for the edge. A plan Decks builds (another candidate, a phrase moved
  by one, another length or bass handoff) is valid when it keeps every bound,
  all inclusive:

  - duration from `minimumTransitionMs` to `maximumTransitionMs`, or up to
    `maximumLongBeatmatchMs` as a beatmatched `dj-blend` when both
    `longBeatmatchAllowed` (the context) and `longBeatmatchEligible` (the
    tracks' tempo stability);
  - `|incomingTempoRatio − 1|` within `maximumTempoAdjustment` in beatmatch,
    exactly 1 otherwise, and within 0.001 without `tempoAdjustmentAllowed`;
  - each deck's gain from `−maximumCutDb` to the lower of `maximumBoostDb` and
    its peak-limited gain (`outgoingPeakLimitedGainDb`,
    `incomingPeakLimitedGainDb`), or exactly that peak-limited gain (a hot
    master), within 0.001 dB;
  - outgoing cue from `outgoingEarliestCueMs`, outgoing cue + duration up to
    `outgoingLatestEndMs`, incoming cue + duration × the incoming tempo (in
    beatmatch) up to `incomingLatestEndMs`;
  - `bassHandoff: "balanced"` only with `bassHandoffAllowed`, beatmatch only
    with `beatmatchAllowed`;
  - `phraseLengths` are the lengths the menu tries; `rulesRevision` is the
    planner's.

  `crate.smart_mix.evaluation.limit_violations` is the reference check: on a
  plan that mixes, it gives exactly the codes of `policy_violations` (a test
  compares both on hundreds of plans around every bound). Gapless plans and the
  350 ms short cut are not refinements: Decks keeps the server's plan there.

Without `localRefinement`, with another `source` or with `smart-mix-v2` the
response does not change, and the flag does not split the plan cache outside
the `decks` context. Android and the VirtualDJ plugin get exactly the plans and
cache keys they got before. Until the `decks` context of S5 exists, `decks`
plans like `playlist` and its bass handoff still follows the Android flag
(`CRATE_ANDROID_BASS_HANDOFF_ENABLED`).

## Audio availability and plan fields (S9)

### `playable` in DJ search

Decks searches with `GET /api/search?fields=dj&q=…&limit=50`. Each track in that
response carries `playable`:

- `true`: the audio file exists in the library as a regular file, so
  `/api/tracks/by-entity/{uid}/stream` (and the VDJ stream) can serve it.
- `false`: the library row exists but the file is missing, is not a regular
  file, resolves outside the library or cannot be read. Decks should not offer
  it for loading.

The check is the one the stream endpoints use: the path resolves inside the
library (`resolve_source_path`) and `stat` finds a regular file. It runs on every
request, for at most 50 results, through `stat_playable_sources`
(`app/crate/streaming/service.py`), which reads the library root once per batch.
The server path is used for the check and never returned. Access-token DJ queries (a valid DJ query
without `fields=dj`) also carry `playable`.

Plain local, `auto` and federated search do not include `playable`: the Go read
plane serves plain local search natively and must keep the same JSON. Any
`/api/search` request with a `fields` parameter falls back from the read plane
to FastAPI (`searchRoute` in `app/readplane/internal/routes/catalog.go`), so
`fields=dj` gets the DJ filters and `playable` behind the edge too. The S3
track pages carry the same field with the same check.

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
