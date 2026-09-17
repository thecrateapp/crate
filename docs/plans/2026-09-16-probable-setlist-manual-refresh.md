# Probable Setlist Manual Refresh Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Add an authorized Admin action that force-refreshes an artist's probable setlist and updates the open panel without a page reload.

**Architecture:** Extend the existing Setlist.fm service and Dramatiq task with an explicit forced path while preserving cache-first automatic refreshes. Expose identity-aware Admin endpoints, invalidate the aggregate enrichment cache after a successful refresh, and let the Artist page follow the task and re-fetch enrichment through its existing data layer.

**Tech Stack:** FastAPI, Pydantic v2, Dramatiq, PostgreSQL/Redis cache, React 19, TypeScript, Vitest, Testing Library.

---

## Task 1: Force-refresh service contract

**Files:**

- Modify: `app/tests/test_enrichment.py`
- Modify: `app/tests/test_setlist_background.py`
- Modify: `app/crate/setlistfm.py`
- Modify: `app/crate/worker_handlers/enrichment.py`

1. Add failing tests proving a normal lookup still uses cached data and a forced
   lookup bypasses it, calls Setlist.fm, and replaces the probable-setlist cache.
2. Add a failing test proving an empty or failed forced lookup preserves the
   previous good cached setlist.
3. Add failing tests proving a forced queue request ignores fresh cache/status
   gates and returns the matching active task ID when deduplicated.
4. Add a failing worker test proving `force` is forwarded and existing artist
   invalidations are emitted.
5. Implement the smallest service and handler changes that satisfy the tests.
6. Run:

   ```bash
   pytest -q app/tests/test_enrichment.py -k probable_setlist
   pytest -q app/tests/test_setlist_background.py
   ```

## Task 2: Admin refresh API

**Files:**

- Modify: `app/crate/api/enrichment.py`
- Modify: `app/crate/api/schemas/common.py` if the existing task schema is not sufficient
- Modify: `app/tests/test_permissions.py`
- Modify: `app/tests/test_openapi_contract.py`
- Add or modify the focused API test module selected during implementation

1. Add failing tests for the numeric-ID and entity-UID routes.
2. Cover `library.metadata.write`, anonymous/insufficient permission, artist not
   found, and the returned task ID.
3. Implement the two endpoints using the existing artist identity helpers and
   task response schema.
4. Update the OpenAPI contract assertion for the new authenticated routes.
5. Run the focused API, permissions, and OpenAPI tests.

## Task 3: Admin interaction and in-place refresh

**Files:**

- Modify: `app/ui/src/components/artist/ArtistSetlistSection.test.tsx`
- Modify: `app/ui/src/components/artist/ArtistSetlistSection.tsx`
- Modify: `app/ui/src/hooks/use-artist-data.ts`
- Modify: `app/ui/src/pages/Artist.test.tsx`
- Modify: `app/ui/src/pages/Artist.tsx`

1. Add failing component tests proving the refresh action is visible in both
   populated and empty states, hidden without permission, and disabled while
   refreshing.
2. Add a failing page/hook test proving completion re-fetches enrichment and
   updates local state without reloading.
3. Expose a stable enrichment `refetch` operation.
4. Add the identity-aware mutation, task following, result toasts, and local
   refresh to the Artist page model.
5. Render the action with the shared Admin button patterns and loading icon.
6. Run:

   ```bash
   npm run --workspace=app/ui test -- src/components/artist/ArtistSetlistSection.test.tsx src/pages/Artist.test.tsx
   npm run --workspace=app/ui typecheck
   npm run --workspace=app/ui lint
   ```

## Task 4: Full quality gate

1. Run the complete focused backend and Admin frontend suites touched above.
2. Run Admin build and React Doctor against the branch changes.
3. Run repository pre-commit checks for changed files.
4. Review the final diff for scope, permissions, cache safety, and unrelated
   changes from other agents.
5. Commit and push the implementation as a separate conventional commit.
