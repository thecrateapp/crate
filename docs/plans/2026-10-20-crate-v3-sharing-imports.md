# 1BD — Sharing and imports

Base:028da356 (Community approved and pushed). Execute the approved Listen-first H2 plan.
Keep5186/6006/5174 active, Listen's existing production API. No new commit/push before Diego's
review. Reference: approved mockup and confirmed shared action/caption/surface amendments.

## Tasks

1. ShareSheet: extract an actual Listen-local view composing AppModal, MonoLabel, MediaCover,
   native close/back actions and shared entity action rows. Remove custom glass/shadows/button
   recipes; preserve localized text, Crate story style choice/order, native capability gates,
   cancellation/busy/retry, clipboard/external/share authority and canvas/font preparation.
2. Bandcamp: actual PageHeader/SectionHeader/StatNumber, solid surfaces and shared item rows;
   preserve full-width tile artwork and56px row artwork through managed MediaCover. Canonical
   icon-only import/open/menu actions. Failed reads must retry rather than fabricate zero/empty.
   Keep owned/downloadable/imported guards, endpoints, FLAC payload, authenticated artwork and
   contextual desktop/touch menus. Existing Collection Bandcamp/Contributions reuse their
   already consolidated components; cover their export/withdraw confirmations in the review.
3. Upload and remote import: extract actual UploadView with canonical grouped FormField/Button picker and hidden native Input,
   captions/actions/progress/success. Keep native multi-file/ZIP selection and actual confirmed
   chunk bytes; unknown progress remains indeterminate. Preserve small/large upload protocols,
   retry/413/localized errors and task attribution. Remote import uses canonical caption,
   status/progress/confirmation, retaining idempotent requests/SSE/approval/cancel/retry.
4. English Listen family stories and one small tabbed review shared by5186and6006: sharing
   normal/styles/busy/unavailable, Bandcamp ready/loading/error/empty/long, upload empty/files/
   progress/queued and contribution confirmation, every remote import status. Fixtures invoke
   only local callbacks, no network/share/clipboard/storage writes. Both hosts375/1200px,
  8px field gaps, canonical geometry/typography, overflow and keyboard/modal restore focus.

## Verification and boundaries

RED→GREEN for each changed contract and adapter action; scoped Vitest workers1, browser workers1.
Listen/Desktop/Storybook types, Desktop tests, relevant policies/i18n, changed-file lint, catalogue,
builds/bundle. Shared sources only change if a current component contract requires it, with
both-app consumers and mandatory documented entry updates. One fresh final review, then one
TDD fix pass. No fullCI, canonical snapshot regeneration, production imports/shares/uploads,
provider/account changes, deployment or new runtime dependencies. Offline complete and1BE
remain later cuts; do not declare all1BD/H2complete here.

## Diego’s Upload amendments

Keep /upload as a page. Restore a visible, functional file dropzone; stage files until Import,
with busy/empty/text guards. Use the actual decorative CrateLogo, a centered canonical picker
Button and native Input transport, formats below and a single-column layout. Remove the whole
What happens next section: processing internals do not belong in this end-user page.

## Final checkpoint evidence

- Listen scoped suite:124tests/18files GREEN. Latest Upload removal/logo/native-picker
  tests14/14GREEN after user amendments. Shared66/4files +bio10 +identity2GREEN.
- Admin affected consumers18/2files GREEN; Desktop final54/9files GREEN, including new
  native drop config regression2RED→GREEN. Static desktop workflow pytest1GREEN.
- Listen/Admin/Desktop/Storybook/shared types GREEN; changed Listen ESLint GREEN;
  locales0errors/0warnings; catalogue58documented/93entries/120sourcesGREEN.
- Browser current8/8GREEN:both hosts375/1200px, actual File/DataTransfer drops,8px gaps,
  focus return, enabled/disabled foreground feedback, progress, menus and no API/storage writes.
- Current Listen build/bundle202982gzip bytes (budget307200), standalone and Storybook
  builds GREEN. Existing large-chunk warnings retained, no baseline or limit changes.
- Fresh review:1Important Windows drag interception fixed in one RED→GREEN pass by
  desktop-host flags, no new permissions/native path reader. No Critical/Minor findings.
- Actual scene visually inspected; final screenshot `.artifacts/review/1bd-upload-dropzone.png`.
- Three services active. HEAD=origin/feat/crate_v3=`028da356`; index empty. No new commit/push.
- No real upload/import/share/clipboard/withdraw during QA. Native device file drag/share
  and full phase canonical/native QA remain outside this browser checkpoint. Offline complete
  and1BEremain later cuts.

## Bandcamp card correction requested during review

Diego rejects the bordered tile with horizontal EntityRow below its artwork: inline actions
reduce titles/artists to a few characters and the menu differs from AlbumCard. Replace that
composition with actual shared EntityCard (grid), without foundation overrides or a local card
recipe. Its own upper-left cover menu contains the existing Import/Open actions; native opener
remains Listen-owned. Rows remain actual EntityRow with56px media/direct actions. This amendment
supersedes the earlier tile-frame/full-width-with-border presentation. Storybook/standalone
reuse four actual view cards with varied title lengths and the real pure action builder; no
fixture network/native calls. Regression checks ensure the menu lies over the cover, title
width is retained and long names ellipsize rather than wrapping to a narrow column.

### Contributions and Bandcamp navigation amendment

Collection now has six sections: Artists, Crates, Playlists, Albums, Liked and Contributions.
Bandcamp is removed from both sidebar children and Collection tabs; /bandcamp is the single
canonical view, reachable through the existing Settings connection link while its future main
navigation placement is undecided. Old /library?tab=bandcamp and /collection/bandcamp URLs
replace-redirect to it, preserving unrelated query/hash/state. The obsolete LibraryBandcampTab
controller/purchases composition is removed, so it cannot diverge into a second live screen.

Available contributions use LibraryContributionItem: the existing managed56px artwork and
LibraryContributionRow, native album-route Link and lazy actual AlbumCardMenu (play, queue,
save, etc.). Export and explicit withdrawal confirmation remain separate. Missing local album
IDs keep export/navigation/play unavailable instead of generating a broken link. The review
uses the actual row and shared menu with local-only callbacks; it never starts real playback.

### Final verification after review amendments

- 62 Listen tests / 13 files and 54 Desktop tests / 9 files pass. Available contribution
  navigation and the actual lazy album menu/play conversion are covered; missing local albums,
  export and explicit withdrawal remain covered. No production action was invoked.
- Browser: four Sharing/imports cases plus seven Shell cases pass, both hosts at mobile and
  desktop widths. The four obsolete seven-section Shell expectations now assert six sections,
  Contributions present and Bandcamp absent; no production component was changed for tests.
- Listen, Desktop and Storybook types, changed Listen lint (34 files), catalogue and all three
  builds pass. Initial Listen bundle: 203133 gzip bytes / 307200 budget. Existing chunk warnings.
- Live Contributions and its normal album menu visually inspected; proof saved at
  `.artifacts/review/1bd-contributions-navigation.png`. The standalone Bandcamp page was inspected
  with the corrected EntityCard tiles. No playback/import/export/withdraw was run in production.
- Three services remain active. HEAD and origin remain `028da356`, index empty. Stop before
  commit/push for Diego's review. No second reviewer or full-CI/baseline run.

## Diego's Contributions grid and end-user notices amendment

The current Contributions screen supersedes its row presentation: default MediaGrid and actual
EntityCard match Albums. LibraryContributionCard is the Listen-local pure view shared with the
review. Its adapter reuses AlbumCard model, managed artwork, offline badges, save and playback
helpers, plus the lazy AlbumCardMenu. The pure contribution action builder adds Export and
Remove contribution to that menu. Missing local albums retain only withdrawal enabled; no
broken navigation/playback/export. The existing worker request and explicit confirmation stay.

The removal toast interpolated the worker task ID; the Upload toast was already free of IDs,
but its visible receipt rendered one. Withdrawal now names the album and says removal is in
progress; errors use a friendly localized message and keep the confirmation open. Upload's
receipt and success toast acknowledge receipt/adding music, preserve file counts and avoid IDs.
All seven catalogs and reviewed metadata are updated; task IDs remain internal response data.

Regression evidence: contribution-grid-red.log (nine expected failures), green integration
coverage and final 101 Listen tests / 11 files, Desktop 54 / 9 files and browser four cases
across both hosts at 375/1200 px. Browser checks square artwork, title overflow, cover menu
placement, normal/specific actions, unavailable guards, cancel focus return and no API/storage
writes. A preliminary run hit a Storybook HMR detach while the scene was edited; the unchanged
stable rerun is four green. No product workaround. Listen/Desktop/Storybook types, scoped lint,
locales, catalogue and three builds/bundle pass; 203130 initial gzip bytes / 307200 budget.
Live Contributions grid and its specific menu visually inspected without running production
actions. Proof: `.artifacts/review/1bd-contributions-grid.png`. Three services active; no commit.

Source-label amendment: contribution source chips become actual MonoLabel, uppercase and without
a capsule/border. Upload is subtle gray with a decorative12px Solar upload icon; Bandcamp uses
accent and its12px brand mark. Unknown sources retain neutral text without a misleading icon.
The same card feeds live Listen and both review hosts; family docs and source regressions updated.
No shared foundation changes, API calls or production mutations. Remains uncommitted for review.

## Approval and publication

Diego approved this cut including the source MonoLabels on2026-10-20 and explicitly requested
commit/push. The prior stop is revoked for this completed cut only. Next:1BD Offline library,
download/storage management and capability/read states; announce before implementation and
stop again for review before publishing that new cut. Keep all three services active.
