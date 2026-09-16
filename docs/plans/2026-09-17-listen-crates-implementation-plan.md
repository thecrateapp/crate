# Listen Crates Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Add album-only Crates to Listen with private/public visibility, owner-managed collaboration, public profile/share surfaces, and ordered or shuffled playback.

**Architecture:** Persist each crate and its ordered canonical global album references in dedicated PostgreSQL tables. FastAPI owns authorization and mutations; Listen adds Collection, profile, share, and crate pages; playback expands the ordered album set into the existing player queue.

**Tech Stack:** Python 3.13, FastAPI, PostgreSQL, Alembic, SQLAlchemy Core/text queries, React 19, TypeScript, Vitest, Listen i18n catalogs.

---

## Implementation rules

- Work only in the record-collections worktree on branch codex/feat/record-collections.
- Use TDD for each behavior: add a focused failing test, run it and confirm the failure, implement the smallest passing change, then run the focused suite.
- The current migration head is 089. Re-check Alembic head before creating the migration; use the next revision if the branch has advanced.
- Use concrete modules under db/queries and db/repositories. Do not add new internal imports through crate.db.__init__.py.
- Keep public visibility separate from collaboration. New crates default to private; the owner alone controls visibility, invite/member management, and deletion.
- Follow current Listen behavior for social previews and authenticated app pages; do not add anonymous full-page playback in this cut.
- Keep commits small and conventional, with no generated attribution.

### Task 1: Add persistent Crate schema

**Files:**
- Create: app/crate/db/migrations/versions/090_listen_crates.py
- Create: app/crate/db/schema_sections/curation_crates.py
- Modify: app/crate/db/schema_sections/curation.py
- Test: app/tests/test_crates_schema.py

**Step 1: Write the failing schema tests**

Cover the four relations: crates, crate_albums, crate_members, and crate_invites. Assert the private default, owner and album references, cascade behavior for dependent crate rows, unique album membership per crate, and an index that supports reading albums by position. Exercise both Alembic migration and schema bootstrap where the existing test fixtures permit it.

**Step 2: Run the tests to confirm the missing-schema failure**

Run: uv run pytest app/tests/test_crates_schema.py -q
Expected: FAIL because the Crate schema is not present.

**Step 3: Add the reversible migration and schema bootstrap**

Use global_album_uid as the crate item identity. Store position, added_by, and added_at with each item. Keep member rows separate from the owner and use one collaborator role. Keep invitation tokens, expiry, maximum uses, and use count consistent with playlist invites. Register the bootstrap helper in curation.py.

**Step 4: Re-run the schema tests**

Run: uv run pytest app/tests/test_crates_schema.py -q
Expected: PASS for upgrade/bootstrap and constraints; downgrade removes only the new Crate objects.

**Step 5: Commit the schema slice**

Commit message: feat: add Listen Crate schema

### Task 2: Implement Crate reads and mutations

**Files:**
- Create: app/crate/db/queries/crates.py
- Create: app/crate/db/repositories/crates.py
- Test: app/tests/test_crates_queries.py

**Step 1: Add failing repository/query tests**

Cover private-by-default creation, owner listing, collaborator listing, public filtering, album insertion/removal, duplicate rejection, order updates, and the profile rule that only owner-owned public crates are listed.

**Step 2: Confirm the tests fail**

Run: uv run pytest app/tests/test_crates_queries.py -q
Expected: FAIL because the Crate read and mutation operations do not exist.

**Step 3: Implement narrow query and repository functions**

Use read_scope for reads and transaction_scope for writes. Keep SQL in the concrete Crate modules, validate album UUID references, update timestamps on mutations, and perform reorder operations atomically. Add access helpers that distinguish owner, collaborator, public reader, and unauthorized reader. When collaboration is disabled, revoke pending invites and collaborator access in the same transaction.

**Step 4: Re-run repository tests**

Run: uv run pytest app/tests/test_crates_queries.py -q
Expected: PASS, including permission-sensitive reads and deterministic ordering.

**Step 5: Commit the persistence behavior**

Commit message: feat: add Crate repository operations

### Task 3: Add the Crate API and collaboration workflow

**Files:**
- Create: app/crate/api/schemas/crates.py
- Create: app/crate/api/crates.py
- Modify: app/crate/api/__init__.py
- Modify: app/crate/api/cache_events.py
- Test: app/tests/test_crates_api.py
- Test: app/tests/test_openapi_contract.py

**Step 1: Add failing API tests**

Cover create/list/detail/update/delete, adding/removing/reordering albums, and listing a user’s owned and collaborative crates. Verify that owners can change visibility and manage collaborators; collaborators can edit crate metadata and contents but cannot change visibility, manage membership, or delete. Verify public reads, private access denial without disclosure, default-private creation, and validation errors.

**Step 2: Add failing invite tests**

Cover owner-only invitation creation, successful acceptance by an authenticated user, expired/revoked tokens, and visibility of the crate after acceptance. Verify that a collaborator invite never changes crate visibility.

**Step 3: Run the API tests**

Run: uv run pytest app/tests/test_crates_api.py app/tests/test_openapi_contract.py -q
Expected: FAIL because the router, schemas, and operations are absent.

**Step 4: Implement the API**

Expose authenticated owner/collection operations under /api/crates and /api/me/crates. Add member and invite endpoints modeled on playlist collaboration. Register the router before any catch-all route. Return typed responses and consistent 404/403/422 errors. Wire cache invalidation for the owner’s Collection and affected profile data.

**Step 5: Re-run API and OpenAPI tests**

Run: uv run pytest app/tests/test_crates_api.py app/tests/test_openapi_contract.py -q
Expected: PASS with the new Crate paths and response schemas in OpenAPI.

**Step 6: Commit the API slice**

Commit message: feat: add Crate API and collaboration

### Task 4: Build Collection Crates management

**Files:**
- Modify: app/listen/src/pages/Library.tsx
- Create: app/listen/src/pages/Crates.tsx
- Create: app/listen/src/components/crates/CrateEditor.tsx
- Create: app/listen/src/components/crates/CrateAlbumPicker.tsx
- Create: app/listen/src/components/crates/CrateCard.tsx
- Modify: app/listen/src/i18n/catalogs/*.json
- Test: app/listen/src/pages/Library.test.tsx
- Create: app/listen/src/pages/Crates.test.tsx

**Step 1: Add failing Collection navigation tests**

Verify that Crates appears as a Collection tab, the section deep link parses correctly, and switching tabs preserves the existing Collection behavior.

**Step 2: Add failing list/editor tests**

Cover empty/loading/error states, owned and collaborative crates, create with private default, edit name/description, catalog album search and addition, removal, manual reordering, and owner-only visibility/invitation controls.

**Step 3: Run focused Listen tests**

Run: npm test --workspace=app/listen -- src/pages/Library.test.tsx src/pages/Crates.test.tsx
Expected: FAIL for the missing tab and Crates surface.

**Step 4: Implement Collection and editor**

Add Crates to the existing section/tab parser and use the authenticated Crate API. Use stable global album UUIDs from catalog results. Refresh the list after mutations and show localized success/error feedback. Keep collaborators’ edit UI separate from owner-only controls.

**Step 5: Add translations and run focused tests**

Add every new string to all supported Listen catalogs. Run: npm test --workspace=app/listen -- src/pages/Library.test.tsx src/pages/Crates.test.tsx
Expected: PASS.

**Step 6: Commit the Collection slice**

Commit message: feat: add Crates to Listen Collection

### Task 5: Add the public Crate page, profile section, and sharing

**Files:**
- Modify: app/crate/db/queries/social_profiles.py
- Modify: app/crate/api/social.py
- Modify: app/crate/api/schemas/social.py
- Modify: app/crate/api/share.py
- Modify: app/listen/src/app-shell/route-table.tsx
- Modify: app/listen/src/pages/UserProfile.tsx
- Create: app/listen/src/pages/Crate.tsx
- Create: app/listen/src/pages/CrateInvite.tsx
- Modify: app/listen/src/components/share/ShareSheet.tsx
- Modify: app/listen/src/lib/social-share.ts
- Modify: app/listen/src/i18n/catalogs/*.json
- Test: app/tests/test_social_queries.py
- Test: app/tests/test_share_previews.py
- Test: app/listen/src/pages/UserProfile.test.tsx
- Create: app/listen/src/pages/Crate.test.tsx
- Create: app/listen/src/pages/CrateInvite.test.tsx
- Test: app/listen/src/components/share/ShareSheet.test.tsx

**Step 1: Add failing backend profile and preview tests**

Verify that only owner-owned public crates appear in a profile, private crates never leak, and /share/crate/{id} returns social preview metadata for a public crate but not a private crate. Use the first album’s cover as preview artwork with the standard brand fallback.

**Step 2: Run focused backend tests**

Run: uv run pytest app/tests/test_social_queries.py app/tests/test_share_previews.py -q
Expected: FAIL because profile and share responses have no Crate support.

**Step 3: Implement profile and social preview reads**

Add public_crates to the bundled profile response using one batched query. Add the Crate preview route using the existing HTML preview renderer and link it to /crate/{id}. Do not expose private metadata through the preview endpoint.

**Step 4: Add failing UI/share tests**

Verify the public profile section and empty state, public/private Crate page behavior, invite acceptance, and Crate entries in the existing ShareSheet. Confirm WhatsApp, Telegram, copy-link, and native Instagram Story reuse existing share actions.

**Step 5: Implement routes, page, and share integration**

Register /crate/:id and /crate/invite/:token. Render albums in saved order; expose edit controls only to owner/collaborators. Add the public_crates section to UserProfile and Crate to the share-kind translations. Keep app pages behind the existing Listen session gate; the preview endpoint remains public.

**Step 6: Re-run backend and UI tests**

Run: uv run pytest app/tests/test_social_queries.py app/tests/test_share_previews.py -q
Run: npm test --workspace=app/listen -- src/pages/UserProfile.test.tsx src/pages/Crate.test.tsx src/pages/CrateInvite.test.tsx src/components/share/ShareSheet.test.tsx
Expected: PASS.

**Step 7: Commit the public surface**

Commit message: feat: share public Crates on profiles

### Task 6: Add ordered and shuffled playback

**Files:**
- Modify: app/crate/api/crates.py
- Modify: app/crate/db/queries/crates.py
- Modify: app/listen/src/contexts/player-types.ts
- Modify: app/listen/src/pages/Crate.tsx
- Test: app/tests/test_crates_api.py
- Test: app/tests/test_crates_queries.py
- Test: app/listen/src/pages/Crate.test.tsx

**Step 1: Add failing playback-query tests**

Cover flattening ordered albums to tracks, preserving album order and canonical disc/track order, handling partially available albums, and returning no playable tracks for an empty/unavailable crate.

**Step 2: Add failing UI playback tests**

Verify Play starts the ordered queue and Shuffle starts a shuffled queue, both with a Crate PlaySource and correct deep link. Verify both controls are disabled when there are no playable tracks.

**Step 3: Run the focused tests**

Run: uv run pytest app/tests/test_crates_queries.py app/tests/test_crates_api.py -q
Run: npm test --workspace=app/listen -- src/pages/Crate.test.tsx
Expected: FAIL for the missing playback operation and controls.

**Step 4: Implement playback resolution and controls**

Resolve the full crate track list in one backend request, using current catalog availability and playable-track mapping. Preserve the sequential order. Use existing playAll and shuffleArray; shuffle the flattened tracks rather than album groups. Add a crate source type to player-types.ts; do not modify the audio engine.

**Step 5: Re-run playback tests**

Run the same focused backend and Listen tests.
Expected: PASS for sequential, shuffle, empty, and partial-availability cases.

**Step 6: Commit playback**

Commit message: feat: play Crates in order or shuffle

### Task 7: Verify integration and quality gates

**Files:**
- Review all changed files and translation catalogs
- Update docs/API references only where the implemented contract requires it

**Step 1: Run all Crate and social backend tests**

Run: uv run pytest app/tests/test_crates_schema.py app/tests/test_crates_queries.py app/tests/test_crates_api.py app/tests/test_social_queries.py app/tests/test_share_previews.py app/tests/test_openapi_contract.py -q
Expected: PASS with PostgreSQL available; report explicit skips if it is not.

**Step 2: Run Listen feature tests**

Run: npm test --workspace=app/listen -- src/pages/Library.test.tsx src/pages/Crates.test.tsx src/pages/Crate.test.tsx src/pages/CrateInvite.test.tsx src/pages/UserProfile.test.tsx src/components/share/ShareSheet.test.tsx
Expected: PASS.

**Step 3: Run frontend quality gates**

Run: npm run --workspace=app/listen typecheck
Run: npm run --workspace=app/listen lint
Run: npm run --workspace=app/listen i18n:check
Run: npm run --workspace=app/listen build
Expected: all commands exit successfully.

**Step 4: Review migration and authorization edge cases**

Verify upgrade/downgrade against a disposable PostgreSQL test database; check private-resource non-disclosure, invite revocation, owner-only controls, and absence of per-album playback requests.

**Step 5: Report completion**

Summarize behavior, migration revision, tests, and any remaining assumptions. Do not push or open a PR unless requested separately.
