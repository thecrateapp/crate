# Manual Probable Setlist Refresh Design

## Context

The Admin artist page displays a probable setlist derived from recent Setlist.fm
concerts. The computed value is cached for seven days. Automatic refreshes are
appropriate for normal browsing, but an administrator currently has no way to
replace a visibly stale setlist before that TTL expires.

## Goals

- Let an authorized administrator request a fresh probable setlist from the
  artist page.
- Keep the action asynchronous and observable through the existing task system.
- Update the open Admin panel without a full-page reload.
- Keep the last known good setlist if Setlist.fm is unavailable or returns no
  usable concerts.
- Preserve the existing cache-first behavior for automatic/background refreshes.

## User experience

The Probable Setlist heading includes a `Refresh setlist` action. The action is
also present when no setlist is currently available, so it can recover an empty
state.

After activation:

1. The button is disabled and displays an in-progress state.
2. Admin queues or joins the active refresh task for that artist.
3. The UI follows the task with the existing task event/polling helper.
4. On success, the artist enrichment payload is fetched again and the panel is
   replaced in place.
5. A toast distinguishes an updated result, a provider result with no usable
   setlist, and a failed/rate-limited task.

The action is only visible to users with `library.metadata.write`.

## Backend design

Two explicit Admin endpoints support both artist identities used by the UI:

- `POST /api/artists/{artist_id}/probable-setlist/refresh`
- `POST /api/artists/by-entity/{artist_entity_uid}/probable-setlist/refresh`

Both resolve the canonical artist name, require `library.metadata.write`, and
queue `refresh_probable_setlist` with `force=true`. Existing task deduplication
is retained, and the endpoint always returns the ID of either the new task or
the matching active task.

The forced worker path bypasses the seven-day probable-setlist cache when
reading, fetches Setlist.fm, and overwrites the cached result only when a usable
result is produced. A failed or empty provider response does not destroy the
last known good setlist. Status metadata still records the latest attempt.

After a successful refresh, the service removes the cached aggregate
`enrichment:<artist>` payload. The worker then emits the existing artist and
upcoming-content invalidations so read models and clients can refresh.

## Frontend design

`ArtistSetlistSection` remains presentational. It receives permission, loading,
and refresh callback props and renders the action in both populated and empty
states. The Artist page owns the mutation:

- POST the identity-aware action route.
- Follow the returned task to a terminal state.
- Re-fetch artist enrichment.
- Replace local enrichment state without reloading the page.

The enrichment hook exposes a stable `refetch` operation so the initial fetch
and post-mutation refresh use one implementation.

## Failure and concurrency behavior

- Repeated clicks are prevented while the local request is active.
- Concurrent callers join the active per-artist refresh task.
- Provider failure leaves the previous good cache intact and surfaces a task
  error to Admin.
- A successful request with no usable setlist surfaces an informative state and
  retains any previous good cache.
- Authorization and artist lookup errors use the existing API conventions.

## Verification

- Python unit tests cover forced cache bypass, preservation of good cached data,
  deduplication, endpoint authorization/identity resolution, and worker flags.
- Vitest/Testing Library covers action visibility in populated and empty states,
  disabled progress state, and the page refresh flow.
- Relevant backend tests, Admin tests, lint, typecheck, build, and React Doctor
  must pass before the implementation is committed.
