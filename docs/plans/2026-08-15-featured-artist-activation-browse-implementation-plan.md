# Featured Artist Activation and Browse Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Add an explicit `is_featured` artist flag, make Artist Hero selection depend on that flag plus approved per-device compositions, and expose the state and filter in Admin Browse without changing the existing Hero scoring/rotation behavior for eligible candidates.

**Architecture:** Persist editorial state on `library_artists`; keep composition readiness derived from the existing `artist_hero_artwork` profile; expose one authenticated PATCH mutation used by the Artist Hero editor and Browse; add the featured predicate to the existing Home Hero SQL before scoring and rotation; extend the existing Browse query contract rather than creating a parallel listing path. `first_seen_at` is immutable and is used only as the default Browse ordering key.

**Tech Stack:** PostgreSQL/Alembic, SQLAlchemy Core + ORM, FastAPI/Pydantic, React 19/Vite, Vitest + Testing Library, existing Hero contract and AdminSelect components.

---

## Task 1: Persist featured state and immutable first-seen ordering

**Files:**
- Add `app/crate/db/migrations/versions/088_featured_artists.py`.
- Modify `app/crate/db/schema_sections/library_catalog.py`.
- Modify `app/crate/db/orm/library.py`.
- Modify `app/crate/db/repositories/library_artist_upserts.py` only if the existing insert path needs an explicit default.
- Add `app/tests/test_featured_artist_persistence.py`.

**Steps:**
1. Write failing database tests proving `is_featured` defaults to false, `first_seen_at` is populated on insert, and a repeated artist upsert preserves the original timestamp and flag.
2. Run `pytest -q app/tests/test_featured_artist_persistence.py` and verify it fails because the columns are absent.
3. Add the migration with `BOOLEAN NOT NULL DEFAULT FALSE`, `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, a `(first_seen_at DESC, id DESC)` index, and a partial `is_featured` index.
4. Backfill existing rows deterministically from the oldest available album/artist filesystem timestamp, falling back to `updated_at` and then `NOW()`. Document that pre-migration values are deterministic approximations, not reconstructed historical insertion instants.
5. Add the same columns/defaults to fresh-schema bootstrap and ORM metadata. Ensure the upsert update clause never assigns `first_seen_at`.
6. Run the focused tests and the schema/import checks.

**Expected result:** New artists receive an immutable timestamp and false flag; resync and metadata updates cannot reset either field; existing installations migrate without breaking.

## Task 2: Add the canonical featured mutation and eligibility service

**Files:**
- Add `app/crate/db/repositories/featured_artists.py`.
- Modify `app/crate/api/browse_artist.py` or the appropriate artist router registration.
- Modify `app/crate/api/schemas/browse.py` if a response schema is needed.
- Modify `app/crate/db/repositories/artist_hero_artwork.py` for readiness/auto-disable helpers.
- Add `app/tests/test_featured_artist_api.py`.

**Steps:**
1. Write failing tests for enabling an eligible artist, rejecting an artist with no approved composition with HTTP 409, disabling an artist, and automatically clearing `is_featured` when no approved desktop/mobile composition remains.
2. Run the focused tests and verify the expected failures.
3. Implement `PATCH /api/artists/{artist_id}/featured` with `{ "is_featured": bool }`, permission checks, and a transaction that validates the approved profile before enabling.
4. Return readiness metadata (`desktop`, `mobile`, `eligible`) in the mutation response. Keep approval independent from publication.
5. Add an atomic helper invoked by composition reset/delete/rejection paths that clears the flag only when both device slots are no longer approved. Preserve gallery source assets.
6. Emit the existing cache invalidation/read-model refresh signal for the artist, Browse, and Home surfaces after a successful mutation.
7. Run focused API/repository tests.

**Expected result:** Admin and Browse share one safe mutation; an invalid enable cannot publish an artist; deleting the last approved composition unpublishes the artist atomically.

## Task 3: Restrict Home Hero candidates by featured flag and device readiness

**Files:**
- Modify `app/crate/db/queries/home_catalog.py`.
- Modify `app/crate/db/home_builder_discovery_queries.py` only where the public readiness metadata is normalized.
- Add/update `app/tests/test_home_queries.py` and `app/tests/test_featured_artist_api.py` as appropriate.

**Steps:**
1. Add failing query/service tests showing non-featured artists are absent, desktop selection requires an approved desktop composition, mobile selection requires an approved mobile composition, and no candidate returns an empty device surface.
2. Run the focused tests and verify RED.
3. Add `la.is_featured IS TRUE` to the Hero candidate pool and express approved composition readiness per device using the existing profile fields/contract.
4. Preserve the current personalized scoring, daily rotation, deduplication, and selection limits after filtering.
5. Ensure public Hero payloads do not leak internal readiness columns beyond the existing canonical composition contract.
6. Run Home query and Hero contract tests to protect the working Hero behavior.

**Expected result:** The new Hero appears only for explicitly featured, device-ready artists; the existing ranking/rotation remains unchanged within that candidate set.

## Task 4: Extend Browse API with recent default, featured filter, and device metadata

**Files:**
- Modify `app/crate/api/browse_artist.py`.
- Modify `app/crate/api/schemas/browse.py`.
- Add/update `app/tests/test_browse_artist_api.py`.

**Steps:**
1. Add failing tests for default `recent` ordering (`first_seen_at DESC, id DESC`), `featured=true`, `featured=false`, and `featured_devices` derived from approved desktop/mobile compositions.
2. Run the focused tests and verify RED.
3. Add `featured: str = Query("all", pattern="^(all|true|false)$")`, selecting `is_featured`, `first_seen_at`, and readiness expressions in the existing query.
4. Make `recent` the backend default and use the exact tie-breaker `la.first_seen_at DESC, la.id DESC`. Preserve explicit existing sorts and filesystem fallback behavior only for rows whose first-seen value is unavailable during transitional bootstrap.
5. Add the response fields to the Pydantic contract and both grid/list payloads.
6. Verify the filesystem fallback path remains safe and returns the same shape with default false/empty metadata.
7. Run Browse API and OpenAPI tests.

**Expected result:** Browse is URL-compatible, deterministic, recently-added by default, and exposes enough metadata for Admin to distinguish desktop/mobile readiness.

## Task 5: Add Featured controls and readiness state to the Admin Artist Hero editor

**Files:**
- Modify `app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx`.
- Modify `app/ui/src/components/artist/ArtistArtworkSection.tsx` if refresh propagation is required.
- Update `app/ui/src/components/artist/ArtistHeroArtworkEditor.test.tsx`.

**Steps:**
1. Add failing React tests for the readiness indicators, disabled toggle when no approved composition exists, successful enable/disable mutation, and the 409 error message.
2. Run the focused Vitest test file and verify RED.
3. Extend the profile payload with `is_featured`, `featured_devices`, and `featured_eligible`/reason fields.
4. Add a clearly labelled `Featured artist` switch in the Hero section. Disable it when neither composition is approved and explain why; show desktop/mobile readiness independently.
5. Call the canonical PATCH endpoint and reload the profile after mutation. Do not auto-toggle on approval.
6. Keep existing upload, preview, generate, and review flows untouched except for the atomic unpublish behavior supplied by the backend.
7. Run the editor tests and UI typecheck.

**Expected result:** Editors can publish only prepared artists, see exactly which surfaces are ready, and do not regress the existing Hero editor.

## Task 6: Surface Featured state and URL-persisted filtering in Browse

**Files:**
- Modify `app/ui/src/pages/Browse.tsx`.
- Modify `app/ui/src/components/artist/ArtistCard.tsx`.
- Modify `app/ui/src/components/artist/ArtistRow.tsx`.
- Add/update Browse component tests near `app/ui/src/pages` or existing Browse test location.

**Steps:**
1. Add failing tests for the default `recent` sort, URL persistence of `featured=true|false`, the visible cyan Featured badge, and desktop/mobile readiness indicators.
2. Run the focused Vitest tests and verify RED.
3. Add the Featured filter using the existing `AdminSelect`; keep it in search params and reset pagination when it changes.
4. Change the frontend fallback default sort from `name` to `recent` and keep explicit user selections intact.
5. Pass `isFeatured` and `featuredDevices` to cards/rows and render a compact, accessible Featured badge plus device hints without disturbing existing click/select behavior.
6. Add the secondary single-artist quick toggle only if the existing Browse card interaction can support it without introducing a second mutation implementation; otherwise keep management canonical in the Artist Hero editor for this slice.
7. Run UI tests, lint, and typecheck.

**Expected result:** Admin Browse makes Featured status immediately visible and filterable, while existing navigation and selection behavior remains unchanged.

## Task 7: Integration verification and rollout guardrails

**Files:**
- Update relevant API/OpenAPI snapshots/tests if generated contracts change.
- Add a concise rollout note to the design/implementation plan if migration caveats change.

**Steps:**
1. Run backend focused tests, frontend focused tests, typechecks, and `git diff --check`.
2. Run the full applicable backend test suite and UI checks.
3. Review the diff for unintended Hero changes, especially candidate ranking, rotation, image URLs, and cache invalidation.
4. Verify the migration is the only required production data step and that old artists remain non-featured until explicitly activated.
5. Commit in logical conventional-commit units only after the checks are green.

**Expected result:** The feature is deployable with an explicit opt-in rollout and no regression to the current Artist Hero composition or rendering pipeline.
