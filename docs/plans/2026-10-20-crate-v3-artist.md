# 1BC — Artist · second batch

Base: approved/published a89bac48. Execute inline with executing-plans and TDD. The approved5186
mockup plus Diego's later decisions are binding: V2 image sizes, desktop background100px lower
with original gradient, full-width bio, contextual MonoLabel, actual data/quality and canonical
forms/actions/surfaces. Keep5186/6006/5174 active and stop uncommitted for review.

## Task 1: Read states and actual Artist hero

Reconcile real Artist loading/404/error/retry with shared states; cached successful content stays
visible on transient failures. Extract its pure ArtistHeroView, with managed artwork/actions
injected by existing adapter. Counts use MonoLabel including real0, prose/names preserve case.
Keep hero100px/original gradients/circular160px photo and existing playback/follow/menu/support
behavior. Remove redundant action size and text control skins. No extra requests.
Expected: RED→GREEN consumer tests for cached read, retry, real0 metrics and canonical controls;
existing hero/menu/managed image tests green.

## Task 2: Biography and artist sections

Complete catalogue entries for ArtistBioProfile/Text/HeroFrame/HeroPresentation before editing
shared modules. Profile uses canonical typography/StatNumber/FormField group headings and8px
spacing; links/buttons/close and MediaCover use existing foundations, no local chrome overrides.
Preserve members/date grouping, genre percentages/source, full-width paragraphs, injected app
images/links and localized labels. Retain missing external metrics as absent (not fabricated0).
HeroPresentation keeps its established image/copy geometry and adopts MonoLabel kicker.
Artist community sections use SectionHeader/MediaGrid and solid Card show-prep view. Preserve
V2 discography scale; show card/instruments untouched. Match0 is real data. Existing setlist
modal retains the same frequency rail/authority, uses canonical Modal/Row/metadata/footer/actions.
Expected: RED→GREEN role/callback/zero/missing tests; shared + actual Listen and Admin consumers
remain green. No new instrument, map, event row, API or data contract.

## Task 3: Storybook and isolated review

English catalogue stories/docs for the4 existing shared modules with real adoption stated.
Listen/Artist and Reviews/1BC/Artist plus review-1bc-artist.html share actual views. Cover hero
artwork/no-artwork/long names/0, sections/grid, biography/member/percent/missing data, modal
open/close/links, setlist local callbacks/pending, read states. No API/audio/preference writes.
Expected:375/1200 both hosts no overflow, fonts/captions8px,160px hero photo/V2 grid,44px actions,
modal full-width content, original gradient100px, keyboard/dismissal and callbacks checked.

## Task 4: Focused verification and final review

Scoped Vitest workers1 for changed artist/shared/consumer/policy tests and Desktop, types
Listen/Desktop/Admin/shared/Storybook, changed lint, affected3builds/bundle and catalogue check.
No fullCI/canonical snapshots/budget regeneration. One fresh final reviewer, one fix pass.
Record evidence, preserve3services and stop before commit.

## Evidence and decisions at review stop

Published previous batch: a89bac48. This Artist batch is intentionally uncommitted.
Focused validation: Listen101/15files, shared35/5, Admin38/3, Desktop28/3, shared/showcase
policy27/3; browser4/4 across375/1200px and both hosts. The final image-source change also
passes the affected13/2 Artist consumer tests and repeats browser4/4 with decoded artwork.
Listen/Desktop/Admin/shared/Storybook types pass; changed Listen lint passes; three individual
builds pass; initial JS202395gzip bytes versus307200budget. Catalogue58documented/93entries,
120source files. No baseline/budget regeneration. Logs are `.artifacts/review/1bc-artist-*`.
One resource-sensitive lazy Crate-editor timeout was followed by isolated32/32 and the final
scoped101/101 green run, without changing that test. Admin canvas stubs emit existing jsdom
not-implemented notices; its38tests pass. An interrupted multi-command build chain is not counted
as success; three subsequent individual builds all completed successfully.

Decisions carried from the ledger:

- User stop-before-commit and focused repo verification take precedence over generic per-task
  commit/full-suite/cleanup instructions. Cost if wrong: broader phase/native certification
  remains outstanding; this is a reviewed local batch, not a release.
- Community cards preserve V2 lg4/xl5; discography retains its already approved lg5comfortable
  scale. Cost if wrong: changing those roles would resize existing artwork unexpectedly.
- FormField owns8px caption gaps while its caption retains heading level3 for biography/member
  regions. Cost if wrong: document navigation or group naming would regress; consumer/browser
  tests exercise those labels and tables.
- Actual pure Hero/Actions/Setlist/ShowPrep/Bandcamp views make the review share production
  markup; adapters retain API, image recovery, i18n, menu builder and playback authority. No
  showcase runtime alias is added. Cost if wrong: fixtures could diverge; actual adapter tests
  and shared views are the guard. Working-tree review package replaces a commit-based package
  because a checkpoint commit before approval would violate Diego's instruction.
- Review hosts import real Listen viewport/safe-area metrics. Cost if wrong: hostless modal
  behavior is outside this app review; no component geometry selector repairs are introduced.
- Source reviewer declined pixel/focus/build certification; author supplies both-host browser
  checks and readonly live Placebo inspection plus screenshot1bc-artist-review.png. Cost if
  wrong: native/device/AT behavior beyond these hosts remains for its later validation phase.

Fresh final review: one Important artwork injection regression fixed RED→GREEN. Missing review
states (long name/More/Bandcamp) were re-graded to required coverage and completed in the one
fix pass. No deferred minors remain. Explicit404 beats cache; transient reads keep content.
Cache versioning stays in the app artwork adapter so the pure view preserves resolved sources.
