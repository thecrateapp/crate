# Artist biography Apply persistence

The biography Apply flow now persists the reviewed prose in both entry points: the Artist
Overview action and the nested research dialog inside Edit artist metadata. It waits for the
metadata worker to finish before displaying `Biography saved`. Applying a biography saves only
that field; other edits in the metadata dialog remain unsaved until Save metadata.

## Reproduced causes

1. Inside `ArtistMetadataEditor`, the research dialog's old `onApply` merely updated the form
   state. It never issued a metadata PUT or queued a persistence task. The dialog nevertheless
   said that Apply saved the proposal and displayed a success toast. Closing the parent editor
   could discard that draft.
2. The editor reset every field whenever its `artist` object changed. A refetch of the same
   artist could therefore replace the current draft with the server's old biography and discard
   other unsaved fields.

The Overview action already called the metadata worker. It now shares the same Admin workflow
helper as the editor so these entry points cannot silently diverge again.

## Persistence and read trace

- Research: `POST /api/artists/by-entity/{uid}/bio/research` queues `research_artist_bio` and returns
  the reviewed proposal without persisting it.
- Apply: `saveArtistBiography` calls `PUT .../metadata` with `{bio}` and awaits task completion.
- Worker: `_handle_update_artist_metadata` calls the concrete library repository writer. That
  writer commits `library_artists.bio` and locks the manually edited field against provider
  enrichment. The worker then broadcasts library, home, artist and biography invalidations.
- Admin read: the artist-detail endpoint reads the local library record directly. This route
  does not depend on an asynchronous artist-page snapshot rebuild. The page refetches after
  successful Apply and prefers `data.bio` over provider biography text.

No backend behavior was changed in this cut. The persistence/read trace above was inspected in
source; it is not a claim that a live production Apply was executed.

## Editor behavior

A draft belongs to an open editor session and an artist identity. Refetching the same artist
keeps that session. Switching artists or opening a new editor session resets from the supplied
canonical data. Successfully applying a biography updates that field's confirmed baseline,
which prevents a spurious discard prompt when no other edits remain. Other dirty fields retain
their original baseline and still prompt before discard.

The editor and research dialog also keep their pending save operation open: Cancel, Escape and
the close control cannot dismiss it mid-save. A failed task leaves the reviewed proposal
available and reports the failure without a saved toast.

## Verification

- Four new regression cases failed against the previous implementation before the fix: no
  metadata PUT on nested Apply, same-artist refetch overwrote the draft, no parent refresh after
  Apply, and no persistence error propagation.
- Artist metadata editor, biography research dialog, Artist page and navigation: 4 suites,
  25 tests passed.
- Tests cover deferred worker completion, biography-only payload, reopening with the persisted
  canonical value, preservation of another unsaved field, artist identity reset, cancellation,
  failure, pending-save dismissal and canonical prose winning over stale provider prose.
- Admin TypeScript typecheck, scoped ESLint, formatting and diff whitespace checks passed.

Research, API responses and task completion are mocked in the automated regression tests. No
real LLM call, production write or development-library mutation was performed. The root review
owns the combined Admin suite/build and browser verification for this cut.
