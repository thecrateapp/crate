# 1BB — Home and Library, first review batch

Base:1BA approved and published43e34284 on feat/crate_v3. Spec: approved5186 mockup and
Diego's confirmed amendments; Listen implementation plan H2/R01/R04/R08–R11. This is the first
coherent batch of1BB, following the plan's explicit review-size rule. No commit/push before review.
Keep5186/6006/5174 active. Shared primitives keep their contracts; no new shared exports.

## Scope and continuation

Reconcile Home greeting, conventional hero actions and recent entity typography; Library list
headers, Bandcamp metrics and contribution rows/actions; Crates index headings/load/error.
Preserve V2 image sizes, hero framing, rail counts, query/route helpers, managed artwork,
player authority, sorting, imports/export/withdraw confirmations and seven existing tabs.
Do not replace custom coverflow, poster artwork, card variants or drag with generic frames.

Already adopted artists/albums/liked, Home rails and track rows retain their actual components.
Playlist/Curated/HomePlaylist detail, HomeSection detail, Crate detail/editor/collaborators,
coverflow and full card-variant reconciliation remain the next1BB batch. Home instruments and
event-row expansion retain their owning1BC/H3 scopes. This batch is not all of1BB or Listen V3.

## Task 1: Home uses approved heading, action and row roles

Use a small app-local HomeGreeting view with actual PageHeader. Remove hero genre blur and
Button/FollowHeartButton internals overrides; preserve event propagation and image framing.
Recent entities retain EntityRow, managed48px artwork, identity/menu callbacks, and its native
typographic recipe rather than local title weight/spacing patches. Add focused consumer tests
for heading family, canonical controls and contextual row actions.
Expected: tests fail on old heading/control/row contracts, then pass; existing Home breakpoints,
SSE/data inputs, mobile-only rail suppression and playback callbacks remain green.

## Task 2: Library list composition and contribution actions

Create app-local LibrarySection and LibraryContributionRow views composing SectionHeader,
StatNumber, EntityRow and ActionGroup/ActionButton. Keep artwork56px through an injected
managed frame; use the same actual row in Bandcamp imports and Contributions. Remove StatBox
and export/withdraw styling constants. Missing album disables export; withdraw still opens
the existing ConfirmDialog and only confirms through its existing callback. No new API calls.
Playlist groups adopt the same section frame and canonical create button. Bandcamp metrics use
real counts, including zero; no made-up totals. Read errors expose retry instead of empty data.
Expected: focused view and actual Library tests prove callbacks, zero/missing capability,
errors/loading and existing tab/URL/native workflows, with no production mutations.

## Task 3: Crates index boundaries

Use shared SectionHeader/LoadingState/ErrorState for owned/shared/followed index states. Keep
the exact V2 grid formulas (2/3/6,20px gap), card image sizes and editor/creation/download flows.
Use a local index-section view shared with review, not a new shared MediaGrid density invented
for one consumer. Retry uses existing refetch, and followed read failure is not an empty list.
Expected: actual Crates tests retain create/edit/delete/play/shuffle/radio/offline contracts;
new loading/error tests fail before implementation and pass after.

## Task 4: Storybook, isolated review and verification

One small review scene composed from actual production views and shared components, reused in
review-1bb-home-library.html and a stable English review story. Cover Home greeting/actions,
Library metrics (zero included), contribution actions/disabled export, grouped playlist/crate
frames and loading/error/empty states. Labels use FormField8px; no scene CSS repairs.
Inventory lists every relevant tab and remaining1BB detail variant explicitly. Focused Vitest
maxWorkers1 and browser workers1; types Listen/Desktop/Storybook, changed lint,3builds/bundle,
catalogue check. One fresh whole-batch review per executing-plans; no re-review loops. No full
suites, canonical baseline updates, budget increases or native/AT/production-write claims.
Expected: both hosts at375/1200px show matching geometry,56/48px media,44px actions, correct
heading/font roles, no overflow, functional callbacks and pending/read error feedback. All
three services remain active; stop1BB uncommitted for Diego.

## Scope matrix and label amendment

| Surface | This batch | Remaining |
| --- | --- | --- |
| Home | Greeting/actions/recent row recipe; ArtistCard contextual captions; playlist count slots; history/replay captions | Specialized instruments/event composition1BC; HomeSection/HomePlaylist details next1BB |
| Library Artists | ArtistCard counts adopt MonoLabel through the owner | Existing filters/grid preserved |
| Library Albums | Existing adopted view retained | No new layout in this batch |
| Library Liked | Existing adopted view retained | No new layout in this batch |
| Library Playlists | Owned/shared/followed/curated section frames, canonical create action, read-error/retry | Full card variants, Playlist/Curated details and editors next1BB |
| Library Bandcamp | Real zero-safe metrics, shared import row/artwork/actions, source error/retry | Purchase/wishlist domain cards keep existing behavior; acquisition extension1BC |
| Library Contributions | Shared row/artwork/actions, existing withdrawal confirmation and read-error/retry | No API/permission changes |
| Library Crates | Section/read states, exact2/3/6 grid | 3D card, detail/editor/coverflow/collaborators next1BB |

Diego's additional request is incorporated here: ArtistCard's context (plays, album/track counts,
match) and scalar meta use MonoLabel in tile/row/editorial, covering Home, Library, genre and
search/related artist callers. PlaylistCard count slots and Home history/replay captions use it
too. The component owns CSS uppercase; no translated strings are mutated. Structured badges
keep their own component and names/artist summaries/prose retain case. No global uppercasing of
EntityCard/Row subtitles. Other domain pages continue their semantic label adoption in their
owning checkpoint; this does not claim every legacy Listen label has been audited.

Preview fixtures exercise actual pure views. Managed transport remains injected by the real
consumer (56px contribution artwork), and no scene issues API/audio/account writes. Crate image
slots illustrate preserved geometry without pretending to consolidate its still-pending cards.

## Validation and review stop

- Consumer Vitest:135 passing across10 Home/Library/Crates/ArtistCard/PlaylistCard files.
  Follow-up owner identity/contextual action correction passes actual LibraryListViews6 cases,
  PlaylistCard16 cases and HomeHeroContent3 cases. Layout guard3/3 now checks the actual
  PlayerBarFrame/PlayerQueueFrame delegation rather than retired inline source locations.
- Remaining scoped Listen component/token/radius/badge guards passed; shared preview/showcase/row
  policy27/27; Desktop50/50 over7 focused files. No full phase/CI suite or baseline regeneration.
- Listen, Desktop and Storybook typechecks green; changed Listen lint clean.
- Same final scene:4/4 Playwright cases,375/1200px × standalone/Storybook, workers1. Validated
  uppercase Mono11px, Bricolage heading, actual8px field gaps,56px contribution art,44px actions,
  disabled export, cancel/focus return, confirmed pending removal, loading/error/retry/empty,
  exact2/6 crate columns at those widths, no overflow or API requests. Follow tooltip is action-only.
- Listen, Storybook and standalone builds green. Listen initial202217Bgzip,24assets,307200 budget.
  Catalogue53 documented/93entries/120sources; only mono-label docs/story entry refreshed.
- One fresh independent review found P2 owner identity uppercased in playlist rows and P3
  contextual Follow tooltip. P2 reproduced in actual shared/followed consumer, corrected with
  explicit ownerLabel slot, counters separate. P3 corrected with translated Follow/Unfollow
  tooltip and tested in both hosts. No re-review loop.
- Live Home inspected read-only: real84 plays and Just landed album/track counts now use
  MonoLabel uppercase; no playback, export/import, withdrawal or account writes performed.

Evidence: .artifacts/review/1bb-home-library.png and1bb-home-labels.png, scoped logs1bb-*.
All5186/6006/5174 services active. Stop first1BB batch for Diego; all changes since43e34284
remain uncommitted and unstaged. Details/editors/coverflow/collaborators remain next1BB batch.
Native/AT/other engines, actual production writes and full ListenV3 certification remain separate.

## 2026-10-20 — primer lote1BB aprobado

Diego aprueba este lote y autoriza commit/push. Continuar con detalles y editores de playlists
y crates, mockup como referencia y Storybook actualizado; mantener5186/6006/5174 y detener el
siguiente lote para revisión antes de commit. La aprobación sustituye el stop local anterior.
