# OpenSubsonic v1 Implementation Plan

> **Status:** reviewed and corrected for execution on
> `codex/listen-design-system`.
>
> **For agents:** execute this plan cut by cut. Use systematic debugging for
> defects, TDD before implementation, and run the relevant quality gates before
> every commit. Each cut receives its own conventional commit and push.

**Goal:** Implement the Crate Music Profile defined in
`docs/plans/2026-09-15-opensubsonic-v1-design.md`, replacing the partial `/rest`
adapter with a secure, standards-driven OpenSubsonic v1 implementation.

**Architecture:** Keep protocol concerns in `crate.subsonic`, split FastAPI
routers by endpoint family, and adapt existing Crate repositories/services.
Contract fixtures, capability declarations and documentation share one source
of truth. Roll out behind `CRATE_OPEN_SUBSONIC_ENGINE`.

**Stack:** FastAPI, Pydantic v2, SQLAlchemy 2, PostgreSQL/Alembic, Redis,
Dramatiq, pytest, pinned OpenSubsonic OpenAPI JSON, pinned Subsonic `1.16.1`
XSD, reviewed enhanced XML golden fixtures and Docker-based interoperability
smoke tests.

---

## Execution rules

For every cut:

1. Rebase the working assumptions on the current branch and preserve unrelated
   changes from other agents.
2. Add a failing test that captures the intended protocol behavior.
3. Implement the smallest coherent production slice.
4. Run focused pytest tests plus Ruff/format checks for touched Python.
5. Run the OpenSubsonic contract suite accumulated so far.
6. Run broader backend checks when shared auth, DB, playback or logging code is
   touched.
7. Run React Doctor for the React workspaces, even for backend-only cuts, so
   cross-workspace drift is caught between commits as requested for this branch.
8. Inspect the diff and ensure no credential or production secret is present.
9. Commit with a conventional message under 72 characters and push.
10. Review CI before starting the next cut; new findings are part of the next
   cut's entry gate.

Do not advertise an endpoint or extension before its acceptance tests pass.

## Cut A — Pin the official contract

**Deliverable:** reproducible OpenSubsonic contract fixtures and a test harness.

**Files:**

- Add `app/tests/contracts/opensubsonic/` with the OpenAPI JSON pinned to an
  exact upstream commit, the Subsonic `1.16.1` XSD pinned by URL and SHA-256,
  and reviewed enhanced XML golden fixtures.
- Add `app/tests/subsonic/contract_helpers.py`.
- Add `app/tests/subsonic/test_contract_fixtures.py`.
- Add an update/verification script under `scripts/` that never runs implicitly
  in tests.

**TDD:**

- Fail when fixture revision metadata is missing.
- Validate representative enhanced JSON response envelopes against the
  OpenAPI components.
- Validate legacy XML projections against the XSD and enhanced XML against
  explicit golden fixtures; do not claim that OpenAPI validates XML.
- Fail unknown fields only where the pinned contract marks the schema strict.

**Acceptance:** offline CI can validate the contract without downloading
mutable upstream files.

**Commit:** `test: pin OpenSubsonic v1 contract`

## Cut B — Extract the protocol kernel

**Deliverable:** shared envelope, renderer, parameter and error infrastructure;
split system router behind the v1 flag.

**Files:**

- Add `app/crate/subsonic/{errors,params,protocol,capabilities}.py`.
- Convert `app/crate/api/subsonic.py` into the package structure defined by the
  design, initially routing untouched legacy families through compatibility
  adapters.
- Add `app/tests/subsonic/test_protocol.py` and `test_params.py`.

**TDD:**

- JSON/XML success and error envelopes.
- `.view` and extensionless route parity.
- malformed/missing parameters produce protocol errors, not FastAPI `422`.
- repeated query and form values remain ordered.

**Acceptance:** `ping`, `getLicense` and the public
`getOpenSubsonicExtensions` run through the new kernel without changing other
endpoint behavior.

**Commit:** `refactor: extract OpenSubsonic protocol kernel`

## Cut C — Secure OpenSubsonic authentication

**Deliverable:** dedicated recoverable OpenSubsonic credentials, API keys,
legacy challenge auth and end-to-end redaction.

**Files:**

- Add migration `097`; `096` is the confirmed branch head at plan review time.
  Re-check the head immediately before creating the migration.
- Extract generic encrypted credential storage to
  `app/crate/credentials.py`; keep Bandcamp compatibility imports.
- Add `app/crate/subsonic/auth.py` and repository/query support.
- Add an access-log scrubber at the Uvicorn entry point.
- Add credential-management schemas/routes needed by later UI work.

**TDD:**

- `apiKey`, `u+p`, and `u+t+s` success/failure.
- conflicting mechanisms return code `43`.
- invalid API key returns `44`; a bad legacy password/challenge token returns
  `40`; unsupported mechanisms return `42`.
- `apiKey` combined with any of `u`, `p`, `t` or `s` returns `43`.
- suspended/deleted users are rejected.
- old `users.subsonic_token` migration is idempotent and lock-safe.
- query/form/access/Sentry logs never contain credential values.

**Acceptance:** no main Crate password becomes recoverable; legacy secrets are
encrypted; raw API keys are only shown at creation.

**Commit:** `feat: secure OpenSubsonic authentication`

**Operational follow-up:** rotate any credential previously exposed in access
logs after this cut reaches production.

## Cut D — Introduce strict shared serializers

**Deliverable:** one serializer path for artists, albums, songs, users and
music folders.

**Files:**

- Add `app/crate/subsonic/serializers.py` and typed projection models.
- Add `app/crate/subsonic/services/catalog.py`.
- Migrate `getMusicFolders`, `getUser`, `getArtists`, `getArtist`, `getAlbum`
  and `getSong` to the shared serializers.

**TDD:**

- Golden JSON/XML fixtures for each media type.
- Stable global IDs and accepted legacy input IDs.
- Duration, dates, suffix, content type, size and parent references.
- No extra internal fields.

**Acceptance:** every migrated endpoint emits the same media shape for the same
entity.

**Commit:** `refactor: unify OpenSubsonic media serialization`

## Cut E — Make artwork complete and resolvable

**Deliverable:** artist photos, album covers, playlist covers and bounded image
variants with a strict reference invariant.

**Files:**

- Extend serializer projections with resolvable artwork references.
- Adapt `getCoverArt` to the existing artwork variant service.
- Add production-shaped artwork audit tests.

**TDD:**

- Artists with `has_photo` receive working `coverArt` IDs.
- Albums with covers resolve; genuinely missing covers do not produce broken
  IDs.
- `size` bounds, MIME, ETag and Last-Modified behavior.
- invalid IDs and unauthorized resources fail consistently.
- sample every serializer endpoint for the reference invariant.

**Acceptance:** all advertised artwork resolves, and the known artist-photo gap
is closed without fabricating album covers.

**Commit:** `fix: complete OpenSubsonic artwork delivery`

## Cut F — Complete browsing, genres and album lists

**Deliverable:** deterministic catalog navigation and all documented list
strategies.

**Files:**

- Add browsing queries/services for indexes, directories and genres.
- Implement `getIndexes`, `getMusicDirectory`, `getGenres`,
  `getSongsByGenre`, `getAlbumList`, `getAlbumList2`, and `getRandomSongs`.

**TDD:**

- Pagination, ordering, folder filtering and genre counts.
- Every supported album-list strategy.
- Unsupported types return an error instead of falling back.
- Empty libraries and boundaries.

**Acceptance:** common clients can traverse the full catalog without private
Crate endpoints or `404` responses.

**Commit:** `feat: complete OpenSubsonic catalog browsing`

## Cut G — Complete search and metadata

**Deliverable:** standards-correct search pagination and artist/album metadata.

**Files:**

- Implement `search`, `search2`, `search3` through a common service.
- Implement `getArtistInfo`, `getArtistInfo2`, `getAlbumInfo`, and
  `getAlbumInfo2`.

**TDD:**

- independent artist/album/song offsets and counts;
- music-folder filtering;
- Unicode and escaped search terms;
- metadata absence versus empty values;
- artwork and external-link serialization.

**Acceptance:** result counts and paging remain stable across formats and
aliases.

**Commit:** `feat: complete OpenSubsonic search metadata`

## Cut H — Wire real playlists

**Deliverable:** playlist read/write support backed by Crate repositories.

**Files:**

- Add `app/crate/subsonic/services/playlists.py`.
- Implement `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`
  and `deletePlaylist`.

**TDD:**

- ownership and administrator visibility;
- create by song IDs and update by add/remove indices;
- deterministic ordering and duration/count totals;
- concurrent update behavior and not-found errors;
- playlist artwork reference behavior.

**Acceptance:** changes round-trip between an OpenSubsonic client and Crate's
native playlist UI.

**Commit:** `feat: expose Crate playlists over OpenSubsonic`

## Cut I — Unify per-user stars and ratings

**Deliverable:** correct per-user artist, album and song preferences shared with
Listen.

**Files:**

- Add migration `098` after rechecking migration head.
- Correct favorites uniqueness to include `user_id`.
- Add per-user rating storage.
- Add `app/crate/subsonic/services/preferences.py`.
- Migrate touched native favorite/rating callers to the same service.

**TDD:**

- two users can independently star the same entity;
- artists, albums and songs serialize in `getStarred(2)`;
- `star`, `unstar` and `setRating` are idempotent;
- native Listen and OpenSubsonic changes are mutually visible;
- migration preserves existing owner data deterministically.

**Acceptance:** no library-wide track rating mutation and no cross-user
favorite leakage.

**Commit:** `fix: make media preferences user scoped`

## Cut J — Harden scrobbling and now-playing

**Deliverable:** retry-safe play reporting over GET and form bodies.

**Files:**

- Add `app/crate/subsonic/services/playback.py`.
- Implement robust `scrobble` and `getNowPlaying`.
- Add playback-report extension support if its complete contract is met.

**TDD:**

- repeated IDs/timestamps and mixed malformed entries;
- submission versus now-playing events;
- idempotent client retries;
- authorization and unknown track IDs;
- native analytics receive the expected play events.

**Acceptance:** client retries do not inflate play history and active playback
is represented consistently.

**Commit:** `feat: harden OpenSubsonic play reporting`

## Cut K — Persist play queues

**Deliverable:** `getPlayQueue`/`savePlayQueue` and index-queue extension using
Crate playback state.

**Files:**

- Add `app/crate/subsonic/services/queues.py`.
- Add typed, stable queue ID support if not already available.

**TDD:**

- ordered tracks, current index, position and timestamp round-trip;
- unknown/inaccessible IDs are rejected or sanitized per contract;
- queue size and position are bounded;
- concurrent device updates follow the documented last-write policy.

**Acceptance:** a client can restart and restore the exact authorized queue.

**Commit:** `feat: persist OpenSubsonic play queues`

## Cut L — Add lyrics and discovery

**Deliverable:** lyrics, top songs and similarity through existing Crate data.

**Files:**

- Add `app/crate/subsonic/services/discovery.py`.
- Implement `getLyrics`, `getLyricsBySongId`, `getTopSongs`,
  `getSimilarSongs`, and `getSimilarSongs2`.

**TDD:**

- synced and unsynced lyrics shapes;
- missing lyrics return a valid empty result;
- Bliss availability/unavailability;
- authorization, limits, ordering and deduplication;
- top-songs-by-ID extension only when complete.

**Acceptance:** discovery never fabricates matches and degrades safely when
enrichment data is absent.

**Commit:** `feat: add OpenSubsonic lyrics and discovery`

## Cut M — Harden stream, download and transcoding

**Deliverable:** robust media delivery backed by playback workers.

**Files:**

- Move `stream` and `download` to the media router/service.
- Add explicit transcode capability mapping.
- Reuse playback preparation rather than writing from the API container.

**TDD:**

- direct stream and byte ranges;
- MIME, length, disposition and cache headers;
- supported format/bitrate transcodes;
- client disconnect cancellation;
- authorization and missing media;
- playback-worker saturation/backpressure.

**Acceptance:** extension advertisement matches deployed codecs, and API
workers never write to `/music`.

**Commit:** `fix: harden OpenSubsonic media delivery`

## Cut N — Add truthful system and scan operations

**Deliverable:** accurate roles, avatar behavior and worker-backed scan status.

**Files:**

- Complete `getUser` capabilities.
- Implement `getAvatar`, `getScanStatus` and admin-only `startScan`.

**TDD:**

- role fields correspond to actual endpoint authorization;
- avatar fallback/reference behavior;
- scan status while idle/running/failed;
- non-admin scan rejection;
- `startScan` dispatches a task and performs no API filesystem write.

**Acceptance:** capability payloads do not promise unsupported operations.

**Commit:** `feat: expose OpenSubsonic system operations`

## Cut O — Complete Form POST parity

**Deliverable:** all Crate Music Profile endpoints behave identically over GET
and form POST.

**Files:**

- Finish shared form parsing across every router.
- Add table-driven route/format/method parity tests.
- Advertise `formPost` only in the final change of this cut.

**TDD:**

- scalar, repeated, empty and encoded parameters;
- authentication in form bodies;
- no secret leakage in validation/logging failures;
- parity of JSON/XML error envelopes.

**Acceptance:** the extension is advertised and the full parity matrix passes.

**Commit:** `feat: support OpenSubsonic form requests`

## Cut P — Add Listen credential management

**Deliverable:** users can create, rotate, copy once and revoke OpenSubsonic
credentials from Listen settings.

**Files:**

- Add settings API client/hooks in shared web where appropriate.
- Add a focused Listen settings section using `@crate/ui` primitives.
- Do not expose encrypted secret material after creation.

**TDD:**

- configured/unconfigured/revoked UI states;
- one-time secret reveal and explicit confirmation on rotation/revocation;
- API key and legacy credential paths;
- accessibility and responsive behavior;
- React Doctor on changed frontend files.

**Acceptance:** setup does not require production shell or database access and
does not reuse the normal login password.

**Commit:** `feat: manage OpenSubsonic credentials in Listen`

## Cut Q — Add observability, budgets and operator docs

**Deliverable:** bounded telemetry and a complete public/operator compatibility
contract.

**Files:**

- Add metrics/Sentry instrumentation with URL/body scrubbing.
- Add `docs/technical/opensubsonic.md`.
- Add production-shaped load and query-count tests.
- Document `CRATE_OPEN_SUBSONIC_ENGINE` rollout/rollback.

**TDD/checks:**

- bounded tag cardinality;
- scrubbed URLs and exception contexts;
- endpoint latency/query budgets;
- extension list generated from capability registry;
- documentation endpoint table checked against registry in CI.

**Acceptance:** operators can detect auth, catalog, artwork and playback
regressions without collecting secrets.

**Commit:** `docs: publish Crate OpenSubsonic profile`

## Cut R — Add conformance and interoperability gates

**Deliverable:** release-blocking official contract tests, automated protocol
probes and a documented multi-client smoke matrix.

**Files:**

- Add a Dockerized OpenSubsonic smoke harness.
- Add deterministic protocol probes that cover every advertised capability.
- Document and run release-candidate smoke sessions in at least three
  independent clients, with Feishin as one fixture rather than a privileged
  target. GUI clients are not simulated with production user-agent branches.
- Add CI workflow jobs scoped to `/rest` changes.

**Scenarios:**

- discover extensions unauthenticated;
- authenticate using each advertised mechanism;
- browse artists/albums/tracks and resolve artwork;
- search and genres;
- playlist create/update/delete;
- star/rate/scrobble;
- queue save/restore;
- stream, seek and download;
- lyrics/similarity where data exists.

**Acceptance:** no client-specific production branches; a discovered failure is
reduced to a protocol fixture before fixing it.

**Commit:** `test: gate OpenSubsonic interoperability`

## Cut S — Post-merge production rollout and legacy retirement

This is an operational release runbook, not a feature-branch implementation
commit. It starts only after Cuts A-R are merged and release artifacts exist.

**Deliverable:** controlled v1 activation with measured health and reversible
rollback.

**Steps:**

1. Merge only after all CI and review findings are clean.
2. Build and publish the release images.
3. Apply migrations with backup and rollback verification.
4. Deploy with `CRATE_OPEN_SUBSONIC_ENGINE=legacy`.
5. Run authenticated production smoke tests without printing secrets.
6. Switch to `v1` and monitor protocol errors, artwork misses, stream starts,
   worker queues and Sentry.
7. Run the three-client matrix against production.
8. Keep one-variable rollback available for one healthy release.
9. Remove legacy routing in a separate commit/release.
10. Remove the old plaintext credential column only after rollback expiry.

**Acceptance:** production remains healthy, every advertised artwork reference
in the audit sample resolves, and rollback has been exercised before legacy
deletion.

Any configuration/documentation change discovered during rollout receives its
own reviewed commit; production activation itself is not represented by an
empty source commit.

## Final verification matrix

Before considering the plan complete:

- `pytest` for all `app/tests/subsonic/` tests;
- full backend pytest suite relevant to auth, playlists, favorites, playback,
  artwork and migrations;
- Ruff format/lint and repository pre-commit hooks;
- Listen typecheck, Vitest, build and React Doctor for Cut P;
- official OpenAPI JSON validation, legacy XSD validation and enhanced XML
  golden-fixture validation;
- GET/form and `.view` parity matrix;
- secret-redaction tests at every logging/telemetry boundary;
- production-shaped artwork resolvability audit;
- query-count and latency budgets;
- three-client interoperability matrix;
- clean CI review before release.
