# Listen Crates Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Add album-only Crates to Listen with configurable ordering/looping, reusable Collection cards, a public coverflow presentation, Instagram-specific share cards, private/public visibility, collaboration, and ordered or shuffled playback.

**Architecture:** Persist each crate, its presentation settings, and canonical global album references in dedicated PostgreSQL tables. FastAPI owns authorization and mutations; Listen adds Collection, profile, share, and crate pages. `CrateCard` is the compact Collection surface, while the public share surface uses a coverflow component and optional authenticated playback. Instagram rendering is a Crate-specific branch of the existing native story pipeline.

**Tech Stack:** Python 3.13, FastAPI, PostgreSQL, Alembic, SQLAlchemy Core/text queries, React 19, TypeScript, Vitest, Listen i18n catalogs, and the MIT-licensed `ashishgogula/coverflow` component adapted for the Vite/Tailwind app after compatibility verification.

---

## Implementation rules

- Work only in the record-collections worktree on branch codex/feat/record-collections.
- Use TDD for each behavior: add a focused failing test, run it and confirm the failure, implement the smallest passing change, then run the focused suite.
- The initial feature branch migration head was 089. After integrating the current `main`, Crates follows its migration head at revision 098 and uses revision 099.
- Use concrete modules under db/queries and db/repositories. Do not add new internal imports through crate.db.__init__.py.
- Keep public visibility separate from collaboration. New crates default to private; the owner alone controls visibility, invite/member management, and deletion.
- Keep the public shared Crate page readable without a session. Detect the existing Listen session and enable playback only for authenticated users; editing remains protected.
- Use the existing social-share pipeline and native Instagram Stories integration. Do not create a second native sharing mechanism.
- Keep the coverflow dependency isolated to the public Crate presentation; Collection cards must remain lightweight.
- Keep commits small and conventional, with no generated attribution.

### Task 1: Add persistent Crate schema

**Files:**
- Create: app/crate/db/migrations/versions/099_listen_crates.py
- Create: app/crate/db/schema_sections/crates_v099.py
- Create: app/crate/db/schema_sections/curation_crates.py
- Modify: app/crate/db/schema_sections/curation.py
- Test: app/tests/test_crates_schema.py

**Step 1: Write the failing schema tests**

Cover the four relations: crates, crate_albums, crate_members, and crate_invites. Assert the private default, owner and album references, cascade behavior for dependent crate rows, unique album membership per crate, and an index that supports reading albums by position. Exercise both Alembic migration and schema bootstrap where the existing test fixtures permit it.

**Step 2: Run the tests to confirm the missing-schema failure**

Run: uv run pytest app/tests/test_crates_schema.py -q
Expected: FAIL because the Crate schema is not present.

**Step 3: Add the reversible migration and schema bootstrap**

Use global_album_uid as the crate item identity. Store position, added_by, and added_at with each item. Add `is_ordered BOOLEAN NOT NULL DEFAULT true`, `sort_direction VARCHAR NOT NULL DEFAULT 'asc'` with an asc/desc check, and `loop_enabled BOOLEAN NOT NULL DEFAULT false` to crates. Keep member rows separate from the owner and use one collaborator role. Keep invitation tokens, expiry, maximum uses, and use count consistent with playlist invites. Register the bootstrap helper in curation.py.

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

Cover private-by-default creation, owner listing, collaborator listing, public filtering, album insertion/removal, duplicate rejection, order updates, presentation settings (`is_ordered`, `sort_direction`, `loop_enabled`), and the profile rule that only owner-owned public crates are listed.

**Step 2: Confirm the tests fail**

Run: uv run pytest app/tests/test_crates_queries.py -q
Expected: FAIL because the Crate read and mutation operations do not exist.

**Step 3: Implement narrow query and repository functions**

Use read_scope for reads and transaction_scope for writes. Keep SQL in the concrete Crate modules, validate album UUID references, update timestamps on mutations, and perform reorder operations atomically. Add access helpers that distinguish owner, collaborator, public reader, and unauthorized reader. Keep sorting and loop settings in the Crate aggregate, not in frontend-only state. When collaboration is disabled, revoke pending invites and collaborator access in the same transaction.

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

Cover create/list/detail/update/delete, adding/removing/reordering albums, updating `is_ordered`, `sort_direction`, and `loop_enabled`, and listing a user’s owned and collaborative crates. Verify that owners can change visibility and manage collaborators; collaborators can edit crate metadata, contents, and presentation settings but cannot change visibility, manage membership, or delete. Verify public reads, private access denial without disclosure, default-private creation, and validation errors.

**Step 2: Add failing invite tests**

Cover owner-only invitation creation, successful acceptance by an authenticated user, expired/revoked tokens, and visibility of the crate after acceptance. Verify that a collaborator invite never changes crate visibility.

**Step 3: Run the API tests**

Run: uv run pytest app/tests/test_crates_api.py app/tests/test_openapi_contract.py -q
Expected: FAIL because the router, schemas, and operations are absent.

**Step 4: Implement the API**

Expose authenticated owner/collection operations under /api/crates and /api/me/crates. Add member and invite endpoints modeled on playlist collaboration. Return Crate presentation settings in list/detail responses and validate sort direction and loop values at the API boundary. Register the router before any catch-all route. Return typed responses and consistent 404/403/422 errors. Wire cache invalidation for the owner’s Collection and affected profile data.

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
- Modify: app/listen/src/components/CrateCard.tsx
- Modify: app/listen/src/i18n/catalogs/*.json
- Test: app/listen/src/pages/Library.test.tsx
- Create: app/listen/src/pages/Crates.test.tsx
- Test: app/listen/src/components/CrateCard.test.tsx

**Step 1: Add failing Collection navigation tests**

Verify that Crates appears as a Collection tab, the section deep link parses correctly, and switching tabs preserves the existing Collection behavior.

**Step 2: Add failing list/editor tests**

Cover empty/loading/error states, owned and collaborative crates, create with private default, edit name/description, catalog album search and addition, removal, manual reordering, presentation settings, and owner-only visibility/invitation controls. Cover the square `CrateCard`: central Play, previous/next album controls, album/track metadata, rank overlay for ordered crates, and loop boundaries.

**Step 3: Run focused Listen tests**

Run: npm test --workspace=app/listen -- src/pages/Library.test.tsx src/pages/Crates.test.tsx
Expected: FAIL for the missing tab and Crates surface.

**Step 4: Implement Collection and editor**

Add Crates to the existing section/tab parser and use the authenticated Crate API. Use stable global album UUIDs from catalog results. Refresh the list after mutations and show localized success/error feedback. Implement `CrateCard` as a sibling of `AlbumCard`, keeping carousel index local to the card and using transform/opacity transitions only. Keep collaborators’ edit UI separate from owner-only controls.

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
- Create: app/listen/src/pages/PublicCrate.tsx
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

Verify that only owner-owned public crates appear in a profile, private crates never leak, and /share/crate/{id} returns social preview metadata for a public crate but not a private crate. Verify that the public shared surface can render without a session while authenticated users receive the playback capability. Use the first available album cover as preview artwork with the standard brand fallback.

**Step 2: Run focused backend tests**

Run: uv run pytest app/tests/test_social_queries.py app/tests/test_share_previews.py -q
Expected: FAIL because profile and share responses have no Crate support.

**Step 3: Implement profile and social preview reads**

Add public_crates to the bundled profile response using one batched query. Add the Crate preview route using the existing HTML preview renderer and link it to the public read-only Crate surface. Do not expose private metadata through the preview endpoint.

**Step 4: Add failing UI/share tests**

Verify the public profile section and empty state, public/private Crate page behavior, anonymous versus authenticated public access, invite acceptance, and Crate entries in the existing ShareSheet. Confirm WhatsApp, Telegram, copy-link, and native Instagram Story reuse existing share actions.

**Step 5: Implement routes, page, and share integration**

Register /crate/:id, the public shared Crate route, and /crate/invite/:token. Render albums in saved order; expose edit controls only to owner/collaborators. Add the public_crates section to UserProfile and Crate to the share-kind translations. Keep private/editor surfaces behind the existing Listen session gate; the public shared route remains readable without a session and gates only playback behind authentication.

**Step 6: Re-run backend and UI tests**

Run: uv run pytest app/tests/test_social_queries.py app/tests/test_share_previews.py -q
Run: npm test --workspace=app/listen -- src/pages/UserProfile.test.tsx src/pages/Crate.test.tsx src/pages/CrateInvite.test.tsx src/components/share/ShareSheet.test.tsx
Expected: PASS.

**Step 7: Commit the public surface**

Commit message: feat: share public Crates on profiles

### Task 6: Add Crate presentation and Instagram Story cards

**Files:**
- Create: app/listen/src/components/crates/CrateCoverflow.tsx
- Create: app/listen/src/components/crates/CrateCoverflow.test.tsx
- Modify: app/listen/src/pages/PublicCrate.tsx
- Modify: app/listen/src/components/CrateCard.tsx
- Modify: app/listen/src/lib/social-share.ts
- Modify: app/listen/src/lib/social-share-story-builder.ts
- Modify: app/listen/src/lib/social-share-story-canvas.ts
- Test: app/listen/src/lib/social-share-story-builder.test.ts
- Test: app/listen/src/pages/Crate.test.tsx
- Test: app/listen/src/components/CrateCard.test.tsx

**Step 1: Verify the upstream coverflow component before adding it**

Inspect the upstream `ashishgogula/coverflow` source, props, license, and build assumptions. Verify the React 19/Vite/Tailwind compatibility in the Listen app. Prefer importing or porting the smallest client-side component into `components/crates/` if the upstream package assumes Next.js or introduces an unnecessary dependency. Keep the coverflow code isolated from Collection cards.

**Step 2: Add failing coverflow interaction tests**

Cover rendering the active album, previous/next controls, touch swipe, keyboard navigation, side-cover selection, loop enabled/disabled boundaries, ordered rank overlays, and the absence of autoplay. Use a reduced-motion media-query test or a deterministic class/prop assertion for the reduced-motion path.

**Step 3: Implement the public coverflow**

Use the verified coverflow component for the public shared Crate. Feed it canonical album artwork URLs and the configured sort direction. Start ordered `Best of 2026` crates at the configured first visible item (for descending rankings, position 10) and preserve the route’s current item while the user stays on the page. Gate Play/Shuffle on the existing authenticated session and player actions; anonymous users retain read-only navigation. Respect `loop_enabled` for both controls and swipe traversal. Keep animation transform-based and disable autoplay.

**Step 4: Add failing Instagram renderer tests**

Extend the share payload with the Crate presentation data needed by the renderer: album covers, album count, optional track count, `is_ordered`, `sort_direction`, and `loop_enabled` only where relevant to the card. Verify that ordered Crates select the `Ranked stack` composition with Stats-style rank overlays, unordered Crates select `Hero editorial`, and missing artwork falls back to the existing branded background. Verify the public share URL and title/owner attribution remain unchanged.

**Step 5: Implement Crate-specific Instagram output**

Keep the existing 1080×1920 native Story pipeline and branch only the artwork/card drawing for `kind: "crate"`. Render `Ranked stack` for ordered Crates with three or four album covers, cyan `RANK #n` labeling, and large semitransparent position numerals. Render `Hero editorial` for unordered Crates with one dominant cover and title/owner/count metadata. Reuse the Stats tokens and existing social-share colors; do not introduce a second native sharing API. Use the first available cover or the standard fallback when artwork is unavailable.

**Step 6: Re-run presentation and sharing tests**

Run: npm test --workspace=app/listen -- src/components/crates/CrateCoverflow.test.tsx src/components/CrateCard.test.tsx src/pages/Crate.test.tsx src/lib/social-share-story-builder.test.ts
Expected: PASS for public navigation, authenticated playback gating, card controls, both Instagram compositions, and fallback artwork.

**Step 7: Commit the presentation slice**

Commit message: feat: add Crate coverflow and social cards

### Task 7: Add ordered and shuffled playback

**Files:**
- Modify: app/crate/api/crates.py
- Modify: app/crate/db/queries/crates.py
- Modify: app/listen/src/contexts/player-types.ts
- Modify: app/listen/src/pages/Crate.tsx
- Test: app/tests/test_crates_api.py
- Test: app/tests/test_crates_queries.py
- Test: app/listen/src/pages/Crate.test.tsx

**Step 1: Add failing playback-query tests**

Cover flattening ordered albums to tracks, preserving album order and canonical disc/track order, applying `sort_direction`, handling loop-enabled traversal, handling partially available albums, and returning no playable tracks for an empty/unavailable crate.

**Step 2: Add failing UI playback tests**

Verify Play starts the configured sequential queue and Shuffle starts a shuffled queue, both with a Crate PlaySource and correct deep link. Verify loop-enabled crates wrap to the first album and non-looping crates stop at the last album. Verify both controls are disabled when there are no playable tracks.

**Step 3: Run the focused tests**

Run: uv run pytest app/tests/test_crates_queries.py app/tests/test_crates_api.py -q
Run: npm test --workspace=app/listen -- src/pages/Crate.test.tsx
Expected: FAIL for the missing playback operation and controls.

**Step 4: Implement playback resolution and controls**

Resolve the full crate track list in one backend request, using current catalog availability and playable-track mapping. Apply the stored sort direction before flattening and preserve the sequential order. Use existing playAll and shuffleArray; shuffle the flattened tracks rather than album groups. Add a crate source type to player-types.ts and connect the loop setting to the existing queue/player loop behavior; do not modify the audio engine.

**Step 5: Re-run playback tests**

Run the same focused backend and Listen tests.
Expected: PASS for sequential, shuffle, empty, and partial-availability cases.

**Step 6: Commit playback**

Commit message: feat: play Crates in order or shuffle

### Task 8: Verify integration and quality gates

**Files:**
- Review all changed files and translation catalogs
- Update docs/API references only where the implemented contract requires it

**Step 1: Run all Crate and social backend tests**

Run: uv run pytest app/tests/test_crates_schema.py app/tests/test_crates_queries.py app/tests/test_crates_api.py app/tests/test_social_queries.py app/tests/test_share_previews.py app/tests/test_openapi_contract.py -q
Expected: PASS with PostgreSQL available; report explicit skips if it is not.

**Step 2: Run Listen feature tests**

Run: npm test --workspace=app/listen -- src/pages/Library.test.tsx src/pages/Crates.test.tsx src/pages/Crate.test.tsx src/pages/CrateInvite.test.tsx src/pages/UserProfile.test.tsx src/components/CrateCard.test.tsx src/components/crates/CrateCoverflow.test.tsx src/components/share/ShareSheet.test.tsx src/lib/social-share-story-builder.test.ts
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
