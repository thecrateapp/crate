# 1BB — Playlist and Crate details/editors

Base: published first1BB batch0f8cf24f. Approved Listen plan H2/R08–R11; approved5186
mockup and Diego's later amendments remain the reference. Continue inline, one final fresh
review. No commit/push of this batch until Diego reviews it. Keep5186/6006/5174 active.

## Task 1: Detail presentation and read states

Playlist/Curated/HomePlaylist reuse PlaylistHeroSection; adopt explicit MonoLabel metadata,
canonical search/count frame and empty/error/read retry states without changing queues or
fetch topology. HomeSection retains PageHeader/MediaGrid and adopts retryable read errors.
Crate hero preserves V2 coverflow/artwork geometry and managed public/authenticated images;
remove secondary-action internal sizing repairs. Crate album section adopts SectionHeader and
actual EntityRow for non-interactive public previews. Existing album cards/TrackList keep their
roles. No global CSS, API, route, engine or invented counts.
Expected: failing filter/metadata/read-state contracts before changes, then actual route/hero
consumer suites green. Identity and names retain case; context captions use MonoLabel.

## Task 2: Collection editor composition

One app-local CollectionEditorDialog composes actual AppModal/ModalBody/ModalFooter and canonical
Buttons for PlaylistCreateModal, CrateCreateModal and CrateEditor. Keep native form submit,
owner restrictions, pending close rules, names/covers, uploads and reducers. CrateForm uses
Select for Visibility/Ordering and FormField for all captions/toggles (8px/inline geometry).
Existing reorder, keyboard/pointer sensors, overlays, optimistic rollback and API payloads
remain in their controllers. Conventional row remove/move/drag actions use ActionButton;
managed artwork remains48px and track identity preserves its case. No new shared export.
Expected: form/row contracts fail first; create/edit/submit, disabled/owner, drag/rollback and
pending workflows pass after. Mobile geometry inspected rather than repaired through internals.

## Task 3: Collaborator composition

Playlist and Crate members share app-local CollectionMemberRow composed from EntityRow,
MonoLabel for roles, InfoBadge where appropriate, optional managed avatar/profile link and
ActionButton. Preserve names/handles, owner/self restrictions, add/remove/leave confirmations,
existing picker and read retries. Keep all calls and permission logic in owning controllers.
Expected: actual consumer tests prove action shape, mixed-case identity, restriction gates and
callback identity. No live member/account writes during QA.

## Task 4: Storybook, review and validation

Small review-1bb-collection-details.html and Reviews/1BB/Collection details share one scene of
actual production presentation views and real components, including editor forms, search,
rows, member permissions, pending/error/empty and native drag callbacks where feasible.
Catalogue/docs updated for any modified shared component; app-local inventory documents the
actual adopters. Explicitly inventory Playlist/Curated/HomePlaylist/HomeSection, Crate public/
owner/collaborator details, create/edit and collaborator dialogs. 3D CrateCard and Home special
artwork retain V2 behavior; do not claim a redesign or native certification.
Expected: scoped Vitest and Desktop maxWorkers1, focused browser375/1200 ×2hosts workers1,
8px labels/40–44px controls/48px artwork, no overflow or API/preference/audio writes. Types3,
changed lint,3builds/bundle and catalogue green. One fresh whole-batch review, one fix pass.
Stop uncommitted for Diego; preserve historical mockup and prior review pages.

## Completed amendment: domain search and artwork identity

Diego expanded the track-search request to a reusable Listen domain search for tracks, albums,
artists or any subset. CatalogSearch now supplies the controlled presentation; playlist search
and the crate album picker adopt it while retaining their controllers. TopBarSearch keeps its
specialized keyboard/recents contract and remains outside this amendment. No shared export.

Confirmed artwork regressions corrected in search results, selected composer rows, reopened
editable tracks and the playlist collage. API album identities survive the conversion boundary
and canonical managed image routes resolve the artwork. No name-based routes or metadata N+1.

Complete: targeted24/7files, consumers32/6files, shared policy28/3files and browser8/8 pass.
Listen/Desktop/Storybook types, changed lint, all3builds, bundle202335Bgzip/24assets and unchanged
catalogue pass. Search and collection reviews cover375/1200px in both hosts. Production search
and a canceled local Meds draft verify real covers without saving or mutating production.
Story: listen-catalog-search--all-kinds; standalone: review-1bb-catalog-search.html.
Evidence: .artifacts/review/1bb-search-* and1bb-search-real-covers.png.
All3services active. Both second1BB and this amendment remain uncommitted for Diego's review.
