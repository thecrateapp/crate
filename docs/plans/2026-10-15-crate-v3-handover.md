# Crate v3 handover

Entry point for agents picking up Crate v3. Revised 2026-10-16. Read this file and the implementation
plan; the status table separates local implementation from pending QA.

## Where the work lives

- Canonical clone: `/Users/diego/Code/crate-v3`, branch `feat/crate_v3`, with its own dependencies.
  Assigned agents use isolated worktrees on the internal disk; never use the removed external tree.
- `origin` is GitHub. Checkpoint 1A and the persistent preview were committed as `efe6cf2e` and
  pushed to `origin/feat/crate_v3` with Diego's approval on 2026-10-15. The branch now tracks
  `origin`, not `local-external`. Checkpoint 1B was approved, committed as `c28a97e0` and pushed on 2026-10-15;
  1C (`e60e6f50`) and provisional 1D (`d881a728`) were committed and pushed with his explicit
  approval on 2026-10-15. Checkpoint 1E is published as `552a31f1`, its search-fixture fix as
  `c7e9e961`, and reviewed Linux baselines as `cf477986`; full comparison CI passes.
  Checkpoint 1F is published as `6e793ebd`, with reviewed Linux images in `82f14594`;
  comparison and full frontend CI pass in run `38860652793`. InstrumentPanel 1G is published as `473604f7`, with reviewed Linux captures from run
  `38864631250`; comparison/full frontend CI passes in run `38865107324`. Meter 1H is published as `6a5b3366`,
  with reviewed Linux images/provenance in `ef5e7f52`; comparison/full frontend CI passes in run
  `38869556811`. Readout 1I is published as `a80f396b`; its 36 Linux images are reviewed and
  imported from run `38871597394` in `dd71eb72`; comparison/full frontend CI passes in
  `38872274120`. ProgressHairline 1J is published as `0660fbd2`, with 40 reviewed Linux images
  imported from run `38876594597` in `3f470ec6`; comparison/full frontend CI passes in
  `38877216337`. Shared toasts 1K is published as `7b46021d`; 43 Linux images/original manifest
  are reviewed/imported from run `38880022435` in `181ca4d4`. Comparison/full frontend CI passes in
  `38880774591`. Rebase/PR/release remain gated.

## Sources of truth, in reading order

1. `2026-10-14-crate-v3-implementation-plan.md` in this directory: dependencies, internal milestones,
   task Files/Steps/Verify, Definition of done and Checkpoint 1A exception.
2. `2026-10-15-crate-v3-decision-register.md`: settled PD1–PD54 and the accepted identity/release
   amendments. Do not reopen decided product questions.
3. `2026-10-14-crate-v3-product-design.md` and `2026-10-14-crate-v3-design-system.md`: cited contracts,
   visuals, tokens, motion and accessibility.
4. `crate-v3-analysis/*.md`: historical evidence from the original investigation; not live status.
5. Visual reference: only `app/web` on `feat/website`, pinned at `258bbaee` until Diego approves a
   resync. Read files from that git tree; the moving branch HEAD does not silently change the pin.
   The discarded `vnext` is never a reference. All canonical docs and evidence are tracked.

## Current authorisation and checkpoints

Diego approved **Checkpoint 1A (1.2–1.4)** after reviewing the local mockup on 2026-10-15 and
authorised commit/push of that reviewed batch, including the persistent preview. Its local checks
passed; CI, production baselines and device QA remain separate gates.

Diego approved **Checkpoint 1B (1.5 HairlineList / HairlineRow and 1.6 chips)** on 2026-10-15 and
authorised its commit/push. Before the next infrastructure block, he requested a review of the
retained GenrePill with percentages in the persistent mockup. That preview is Task 1.6a / **Checkpoint 1C**, visually approved by Diego on 2026-10-15. It is committed as `e60e6f50`; approval does not authorise migration of genre data or Smart Mix logic. **Task 1.1 global
focus/selection is published as `d881a728` at Checkpoint 1D**, provisionally accepted to continue;
further visual polishing is deferred. Admin 1.0 and its capture/route prerequisites are now
complete; InstrumentPanel 1.7, Meter 1.8, Readout 1.9 and ProgressHairline 1.10 are approved/published.
Diego approved shared toaster configuration 1.11 / Checkpoint 1K on 2026-10-16 and authorised
commit/push, canonical Linux captures and continuation to unused shared component cleanup 1.12.
Diego approved unused shared component cleanup 1.12 / Checkpoint 1L on 2026-10-16 and authorised
commit/push, canonical Linux captures and continuation to theme runtime retirement 1.13.

The persistent component/visual mockup lives in `tools/design-system-preview/` and runs with
`npm run design-system:preview` at <http://127.0.0.1:5186/#primitivas>. Extend the same page at
every checkpoint with real components, preserving the approved examples. This is local review
material, not the committed CI screenshot source. The current checkpoint is
<http://127.0.0.1:5186/#limpieza>: an inventory of the four retired unused components, rendered with
current shared primitives. Approved toasts remain at `#toasts` with manual examples and local retry.
ProgressHairline remains at `#progreso` with known/indeterminate progress and both line thicknesses.
Readout remains at `#readout` with its separate preview and committed announcement.
Meter remains at `#meters` with its approved capacity/limit/missing-data examples.
InstrumentPanel remains at `#paneles` with its approved spacing and live status. The approved row/chip/GenrePill specimens and earlier references remain on the page.

`PLAYWRIGHT_CHANNEL=chrome npm run design-system:preview:test` passes 39 cumulative local browser
checks, including percentage-bearing GenrePill, keyboard focus, real Select options, 44px touch
targets and held-pointer reduced motion. The appearance harness passes 26 Chrome checks, including
the real Listen search in desktop/mobile and open/closed states. These local Chrome runs do not
qualify desktop runtime floors, WebKit, device QA or CI screenshot baselines. Review GenrePill at
<http://127.0.0.1:5186/#genre-pill> and the new focus block at <http://127.0.0.1:5186/#foco>.

Task 0.11 is complete: canonical Linux capture, image review and comparison CI pass on `cf477986`.
Checkpoint 0 remains open for 0.15 runtime qualification and relevant device reviews; 0.14
production measurement may wait until the wheel and needs assignment. Admin contrast 1.0 is
published at Checkpoint 1F with reviewed Linux images, green comparison CI and the local route
walkthrough recorded below. InstrumentPanel 1.7 is published at Checkpoint 1G; its Linux capture
review and full comparison CI pass. Meter 1.8 is published at 1H and Readout 1.9 at 1I;
ProgressHairline 1.10 is published at 1J; shared toaster configuration 1.11 is published at 1K.
Unused shared component cleanup 1.12 is the current local review checkpoint.

## Admin visual direction — 2026-10-16

Diego reaffirmed the site's TrackReadout as the final Audio Profile target: four large figures
with top rules, five thin feature bars and a 20-value bipolar Bliss strip, no KPI boxes or icons.
PD §4.7 / DS §4.5 / Task 3.9b already own this replacement and its data prerequisites. The mockup
at `#contraste-admin` now includes his supplied image as a labelled visual target; it is not a
production component, Linux baseline or completed readout. Loudness remains `dB` in the app until
the validated integrated-LUFS contract exists. The temporary 1F contrast repair is not final design
approval of the final readout. Diego authorised publication of the temporary 1F repair on
2026-10-16, its Linux capture run and continuation to InstrumentPanel after the applicable gates.

Admin V3 removes almost all icons, including redundant icons on labelled actions/navigation;
only narrowly justified functional exceptions remain. This supersedes the previous general
navigation/action icon allowance for Admin. Task 1b.8 owns inventory, consumer/accessibility tests,
reviewable migration groups and Linux visual QA; each page task follows the rule. Listen/desktop
icons are unaffected. No blanket removal or reordering of Task 3.9b is implemented in this update. Diego explicitly
confirmed that TrackReadout will be addressed when its planned task arrives.

## One visual identity

Crate v3 is the only approved visual identity across Listen, Admin, site and docs. The entire
selectable theme/skin system, visual modes, accents, material/radius/typography overrides and
album-driven chrome tint are retired as a target. Artwork/data-derived visualizer palettes remain
content. This is **not yet implemented** in the runtime.

Planned Task 1.13 inventories consumers/persistence/transport, migrates legacy preferences, removes
the runtime/editor/variant CSS/subscribers and obsolete fixtures, and checks older-peer compatibility.
It preserves semantic design tokens, reduced motion, OS accessibility, effects safety and functional
preferences. Keep the current token registry/generation until that task migrates its consumers.
No variant matrix or retired contrast exception remains a target requirement. Nivo's chart theme
is a token-based chart configuration, not a selectable product skin.

## Execution protocol

1. Use `executing-plans` or follow the same task/review protocol. Read task contracts and actual
   symbols before editing; historical line numbers are hints.
2. Follow tests-first for changed logic and record actual results separately from pending QA.
3. Keep one reviewable diff per task, respecting explicit multi-commit task exceptions. Proposed
   commit messages are conventional and contain no co-author/generated attribution. **Do not create
   commits until Diego gives the go-ahead.** His 2026-10-15 commit/push approvals covered 1A and
   1B with the persistent preview. On 2026-10-15 he also explicitly authorised commit/push of
   1C and provisional 1D, then 1E with Linux CI captures and continuation with the next plan block. Subsequent checkpoints
   remain subject to review and a separate publication go-ahead.
4. The single integrator updates this handover/status after integrating agent results. Agents report
   their scope, patch and verification; they do not independently overwrite canonical status.
5. Stop at each checkpoint. If a dependency changes, document it and report; do not invent a new
   design or begin an unassigned independent task.

## Hard rules

- No push, PR, tag, deployment or production access/queries without Diego's explicit go-ahead.
- No instance domain in UI, fixtures, screenshots or recorded assets.
- Root/scoped `AGENTS.md` still apply: workers own library writes, DB code stays in concrete DB
  modules, no request aggregates/rebuilds, correct Admin/Listen conventions and no UI emojis.
- Shared components need both apps as specified. Keep semantic tokens and accessibility/motion.
- Committed visual baselines come only from the approved Linux amd64 `update-listen-visual` CI job.

## Parallel work and integration

- Each assigned agent edits only its isolated internal-disk worktree and assigned files.
- Serialise token registry/generated CSS, `typography.css`, `cn.ts`, drift ceilings and i18n edits.
  Isolated worktrees do not remove conflicts in shared files. The integrator owns final integration.
- Integrate local patches and rerun applicable verification after integration when authorised.
  Do not create merges/commits merely to transfer an agent's local diff.
- R0 2A/2B and `[MAIN]` tasks use separately assigned branches from `main`; never start them just
  because the old plan says “start now”. Keep critical deployments and their observation isolated.

## Status

| Area                                                         | Local implementation / next gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.0 font licence; 0.1 tracking steps 1–2; 0.2 internal clone | Implemented and pushed with 1A; rebase/PR pending approval and Smart Mix integration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 0.3 decisions                                                | Accepted, including one identity, small Admin captures and 520 KiB budget; calendar estimates provisional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 0.4–0.10, 0.12, 0.13                                         | Local implementation recorded; does not certify full CI, screenshots or device QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 0.11 visual baselines                                        | Complete: 1E published; 31 canonical Linux PNGs imported/reviewed from run 38807507930. Full Frontend Tests and visual comparison pass on `cf477986` in run 38808354069 (appearance 26, Listen 34 / four skips, Admin 12). This prerequisite precedes the local 1F diff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 0.14 production graph                                        | Pending assignment; required before wheel, may wait during primitives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0.15 desktop runtime                                         | Pending qualification or approved fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Checkpoint 0                                                 | Open for remaining production/runtime/device gates; 0.11 Linux comparison is complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.2–1.4 / Checkpoint 1A                                      | Committed/pushed as `efe6cf2e`. At 1A: Shared 679, Admin 248, Listen 2,853 and Desktop 50 tests pass (Listen has 4 skipped); 66 focused primitive/CSS tests pass after the minified-fallback correction. Shared/Admin/Listen/Desktop typechecks, both app lints, package/app builds and 15 drift metrics pass without budget changes. Static spec/quality reviews found no actionable defects. Diego approved the mockup and authorised commit/push on 2026-10-15. CI/baselines/device QA remain pending                                                                                                                                                                                                                                                                                                                                         |
| 1.0 / Checkpoint 1F                                          | Published `6e793ebd` + canonical images `82f14594`; 33 Linux PNGs reviewed (31 unchanged, two new), full comparison/frontend CI green in run 38860652793. Local route walkthrough completed with the pre-existing artist-alias defect and deep-state limits recorded below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.7 / Checkpoint 1G | Published `473604f7` + reviewed Linux images/provenance in `c44b31f3`; recording 38864631250 and full comparison/frontend CI 38865107324 pass. |
| 1.8 / Checkpoint 1H | Published `6a5b3366` + reviewed Linux images/provenance `ef5e7f52`; recording `38869057068` and comparison/full frontend CI `38869556811` pass. |
| 1.9 / Checkpoint 1I | Published `a80f396b` + reviewed Linux images/provenance `dd71eb72`; recording `38871597394` and comparison/full frontend CI `38872274120` pass. |
| 1.10 / Checkpoint 1J | Published `0660fbd2` + reviewed Linux images/provenance `3f470ec6`; recording `38876594597` and comparison/full frontend CI `38877216337` pass. |
| 1.11 / Checkpoint 1K | Published `7b46021d`; 43 Linux images/provenance `181ca4d4` from `38880022435` (40 unchanged, three new toast scenes). Comparison/full frontend CI `38880774591` passes. |
| 1.12 / Checkpoint 1L | Approved by Diego; commit/push and Linux captures authorised. Local verification and spec/quality reviews pass. |
| 1b | Not started; respect applicable gates and the next review checkpoint. |
| 1.5–1.6 / Checkpoint 1B                                      | Committed/pushed as `c28a97e0`; Shared 696, Admin 248, Listen 2,853 and Desktop 50 tests pass (3,847 total; Listen has 4 skipped). Seven preview browser checks pass. Four typechecks, both app lints, shared/app builds, 21 gate tests, token sync and 15 drift metrics pass. Spec/quality reviews have no remaining findings. Approved and published as `c28a97e0` on 2026-10-15                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.6a / Checkpoint 1C                                         | Percentage-preserving GenrePill restyle visually approved by Diego on 2026-10-15; committed as `e60e6f50`, publication authorised. Its 27 focused tests pass; integrated suites/builds and cumulative browser checks are recorded with 1D. Commit/push explicitly authorised for this checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.1 / Checkpoint 1D                                          | Published as d881a728 with explicit approval and provisionally accepted by Diego to keep moving; focus-fade visual polish is deferred (not final visual parity approval). Available at #foco. Full suites run serially with maxWorkers=2: Shared 738, Admin 248, Listen 2,853 and Desktop 50 pass (3,889 total; 4 Listen skipped). This includes 15 focus-motion unit tests. Preview 22 and appearance 26 Chrome checks pass, including initial/intermediate/final on/off frames against the original native search transition, interruption, reduced motion, forced colours and real portal/TopBar geometry. Four typechecks, both app lints, shared/app/preview builds, 22 gate tests, token sync, 15 drift metrics and layer policy pass. Spec/quality review has no remaining findings. CI baselines/WebKit/runtime/device QA remain pending |
| 1.13 runtime theme retirement | Assigned by Diego after approving 1L; inventory/integration prerequisite review begins before implementation. Required for the joint major. |
| Phases 2–7                                                   | Pending; reconcile Smart Mix overlap after rebase before marking tasks complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Integration and release order

1. Smart Mix merges to `main` under its own assignment.
2. The integrator rebases `feat/crate_v3` onto the actual result with approval. Reconcile Camelot,
   migrations, Android EQ, catalogs and any changed task prerequisites.
3. Integrate `feat/website` (`app/web`, `app/docs`) into `feat/crate_v3`, with an approved source-pin
   resync when needed. Keep this branch through the joint major, including site assets.
4. Complete internal milestones: Foundation (including 1.13) → Genres → player/EQ → Ops → Health →
   Stats, with contracts before UI and review at every checkpoint. No public Foundation 2.8 release.
5. The major retains the plan's existing **P0** boundary. P1/P2 and Phase 6 coverage remain subsequent
   work unless Diego expressly changes scope. Re-record site screenshots/screencast from final UI.
6. Listen, Admin, site and docs ship together only after the full applicable QA and explicit release
   approval. Separately assigned R0 fixes may retain their independent releases; 2.10 and 2.11a–c
   retain their critical isolated deployment/observation protocols.

## Accepted details and pending review

- Admin initial-JS ceiling: **520 KiB**, accepted; recorded baseline **514,659 B gzip**. Record the
  revision for future measurements; this note is not a fresh build result.
- PD48: small Admin capture set before 1.0, extended by each P0 page task; Linux CI source only.
- The retired visual variant's contrast fixture/allowance is removed in 1.13 with its runtime;
  there is no new variant colour to select. Crate v3 AA remains mandatory.
- Checkpoint 1A local initial JS: Listen **203,980 B gzip** (ceiling 307,200), Admin **514,679 B gzip** (ceiling 532,480). Both builds and budgets passed; no ceiling was raised.
- Numeral fallbacks were checked in compiled/minified CSS and the Listen production asset: `@supports not (font-size: 1cqi)` preserves rem sizes through LightningCSS. CSS tooling is an explicit development dependency only.
- Refresh remaining estimates after integration and 1A review. Pending approvals/results belong
  here; no old “done” label closes a gate without its required evidence.

## Checkpoint 1B implementation notes

- HairlineList adds optional top rules and HTML attributes; rows add active bar/wash, untruncated
  content and a full-row single-child target. Native links/buttons preserve refs/events/attributes;
  index/title/trailing have readable accessible-name spacing. Default children remain compatible.
- CratePill adds toggle/action/static variants with inferred defaults for existing callers, 32px
  minimum targets (44px coarse), mono label typography and scale-longhand press feedback. Only
  toggles use `aria-pressed` and the active fill. Its temporary local focus outline kept it usable
  before global Task 1.1; 1D now retires that provisional styling in favour of the shared rule. Listen's radius rule now exempts `data-slot="chip"`.
- Eight existing Admin static+active pills became CrateChip tags; three Dashboard navigation pills
  use `variant="action"`. No backend, Settings, player or Smart Mix logic changed.
- Browser regression reproduced press scaling under reduced motion, then verified the specificity
  fix using `:where()`. Spring timing has an `ease-snap` fallback where `linear()` is unsupported.
- Icon sizes now use the shared catalogue. Removed the obsolete raw-size allowance and lowered
  the arbitrary-utility ceiling from 61 to 57; no budget was raised.
- Checkpoint 1B initial JS: Listen **203,980 B gzip** (ceiling 307,200); Admin **514,766 B gzip**
  (ceiling 532,480), +87 B versus 1A. Both budgets pass unchanged.
- Diego approved 1B and requested GenrePill with percentages in the mockup before the next
  infrastructure block. Applicable Phase 0 gates remain open.

## GenrePill / Checkpoint 1C

- Kept `@crate/ui/domain/genres/GenrePill` and GenrePillRow, existing importers/re-export and policy.
  The original plan said "chip look"; DS §2.2 / Task 1.6a now explicitly protect the v2 percentages.
- Data behavior remains explicit percent first, otherwise rounded share × 100; no weight fallback,
  fake missing percentage, profile renormalisation or callback/order migration. Source stays in the
  tooltip and zero/full percentages remain visible.
- Local v3 visual proposal: mono 11px rounded chip, primary name, tabular accent-hi percentage with
  a subtle separator, 32px/44px targets and separate open/remove controls. Approved by Diego at Checkpoint 1C on 2026-10-15.
- Preview <http://127.0.0.1:5186/#genre-pill> uses the actual shared component: example artist profile,
  optional/0/100%, long name and editable labels. Approved earlier specimens remain visible.
- Its 27 component cases pass; the integrated full suites, builds and cumulative 13 preview
  checks are green and recorded with 1D. Local checks do not qualify CI/native screenshots.

## Global focus / Checkpoint 1D

- One unlayered 2px `focus-ring` keyboard outline: flush (offset 0) on controls and CTAs, -2px
  inset for rows, menus and clipped controls. Diego requested the existing Listen search effect on
  2026-10-15, replacing the initial detached bright 3px/4px proposal. Colour and extent match the
  search field's `0 0 0 2px var(--focus-ring)`; outline rendering preserves component shadows.
  The CTA-only offset hook is retired. Pointer focus on buttons does not show the keyboard marker.
- Diego clarified that the reference includes animated **on and off**. Static colour/geometry
  parity is insufficient. The ring fades and expands over 500 ms with the real search's
  `cubic-bezier(0.22, 1.18, 0.36, 1)` and no delay; it contracts/fades on blur even after entry
  has finished. Rapid refocus continues from the rendered subpixel shadow. The shared native
  Web Animations helper is installed in Listen, Admin and Desktop and both test/preview entries.
  It adds the focus `box-shadow` with `composite: add`, preserving component shadows and existing
  transition lists, with no dependency or per-frame JavaScript. The static outline is transparent
  only while the shadow animates and is restored on finish/cancel. Outline-width animation was
  rejected because integer rounding causes visible steps; production uses a continuous shadow.
  Missing additive support and SVG controls retain static focus. OS/Crate reduced motion and forced colours cancel/skip motion and retain static CSS.
  Weak references retain settled controls without preventing their removal from memory.
- Text selection uses `accent-action` with `surface-canvas` text. Forced colours use system
  `Highlight` and retain browser adjustments.
- Removed local focus-only rings/shadows and provisional 1B/1C outlines; selected, checked,
  invalid, danger, hover and elevation styles remain. The policy also covers `focus-within`.
- Real Radix Select options and Listen TopBar search preserve an inset outline. The search
  regression reproduced clipping before the fix, then passed in desktop/mobile and open/closed
  states using its real view and Listen CSS.
- Removed the redundant `--focus-shadow` alias after its only remaining consumer was the legacy
  `--shadow-focus` bridge. That bridge is now inline; `--focus-ring`, registry, resolver and theme
  runtime remain for 1.13. Definition ceilings fall 139→138 and foundation 96→95; one-shot stays
  23, unused tokens 0. GenrePill also lowers the arbitrary-utility ceiling 57→54.
- The appearance surface contract now matches the already accepted card token
  `rgba(13, 14, 20, 0.78)`; no runtime palette or committed PNG baseline changed.
- Final verification of the search-style ring is recorded in the status table. Full suites were
  repeated serially with `--maxWorkers=2` after parallel runs hit timeouts under contention. Three
  obsolete per-component offset-class tests were retired; browser tests now cover the shared ring,
  CTA layout and preserved shadows against the actual legacy search recipe. Only local Chrome was
  run; Linux CI screenshots, WebKit, runtime floors and device gates remain open.
- The real Radix portal check reproduced a missing colour outside the appearance scope. The
  root `--focus-ring` alias now reads the stable `--crate-token-color-ring` foundation value,
  avoiding a Tailwind inline bridge that can be discarded when unused. Runtime overrides and
  scope cleanup remain intact; token/appearance checks and the 26 browser checks pass.
- Integrated initial JS: Listen **204,720 B gzip** (ceiling 307,200), Admin **515,375 B gzip**
  (ceiling 532,480). Both budgets pass without increases.
- Diego accepted the current 1D state provisionally to keep moving. Defer further focus-fade
  polishing; do not claim final visual parity approval. Preserve the specimen at
  <http://127.0.0.1:5186/#foco>. Diego explicitly authorised commit/push of 1C/1D on 2026-10-15;
  later checkpoint publication needs its own go-ahead.
- The appearance harness uses a separate Vite dependency cache. Sharing the preview cache
  produced a 504 for `react-i18next` and a blank real TopBar fixture; all 26 appearance checks
  pass after cache isolation.

## Checkpoint 1E — capture infrastructure before Admin adoption

Diego approved Checkpoint 1E and explicitly authorised its commit/push, the canonical Linux CI
capture run and continuation with the next plan block on 2026-10-15. Capture infrastructure is
published as `552a31f1`, the debounced search fixture fix as `c7e9e961`, and reviewed Linux
baselines as `cf477986`. Canonical recording, image review and full comparison CI pass, closing
Task 0.11 before Admin changes. Task 1.0 was then published and qualified at 1F; InstrumentPanel
1.7 is now the separate local 1G review diff. Theme runtime retirement and deferred 1D focus polish remain later work.

- `appearance-chromium` and manual `update-listen-visual` run in
  `mcr.microsoft.com/playwright:v1.63.0-noble` on Linux amd64. Manual recording uploads both apps'
  PNGs plus a manifest with commit/image/platform/architecture, without pushing generated files.
- Both screenshot configs use platform-free names and default to `updateSnapshots: "none"`.
  A tested global setup refuses updates outside the pinned Linux x64 CI runtime, including a
  plain local `--update-snapshots`. A noncanonical CI run is rejected even in comparison mode.
- `CRATE_VISUAL_SMOKE=1` writes advisory render captures into ignored `test-results/` only;
  no comparison or baseline approval is claimed. `PLAYWRIGHT_CHANNEL=chrome` permits local Chrome.
- Admin fixtures fail on unknown API paths. Seven full-page scenes cover Dashboard, Tasks,
  Health, Genres, Album, Settings and System, with frozen time, reduced motion, fixed data and
  fixture SVG artwork. Full-page captures include Genres cards and System Resources below the fold.
- Listen adds the populated Radar probable-setlist contract and Smart EQ with a ten-band curve,
  active genre-taxonomy source and inherited Rock source in desktop popover/mobile sheet.
- The 22 existing Linux PNGs were renamed without pixel changes; all 22 obsolete Darwin copies
  were removed. The two EQ and seven Admin canonical PNGs are now imported from the successful Linux run below.
- Local verification: Admin 12/12 (seven captures plus five existing functional flows); Listen's
  existing smoke cases 32 pass / four intentional skips, and both new Smart EQ scenes pass.
  All 49 tooling tests pass (27 runtime-guard cases plus 22 existing); 24 preview checks pass,
  including gallery assets and missing-asset fallbacks on desktop/mobile. Local baseline update
  was rejected in a real Playwright run. Token sync, 15 drift budgets, layer policy, preview build,
  documentation integrity and formatting pass. SPEC/quality review found a readiness race in
  independently loaded panels; each affected scene now waits for fixture content in Genres,
  Tasks and Settings before capture. These checks certify preparation only, not Linux regression.
- Review the seven current Admin scenes at <http://127.0.0.1:5186/#base-admin>. The gallery now imports the committed Linux PNGs directly, including on a clean clone. These
  references precede the V3 Admin redesign. The README explains advisory local rendering. Approved 1A–1C and provisional 1D remain in the same persistent mockup.

Publication, canonical capture, manifest verification, image review and comparison CI are done.
Task 0.11 is closed by the successful run below. Admin 1.0 proceeds at its own Checkpoint 1F;
its publication, new Linux states, comparison and route review are now complete as recorded below.

### 1E CI follow-up

The first canonical run (`38806716768`, source `552a31f1`) passed all 34 Listen cases (four
intentional skips) and generated seven Admin scenes, but failed one functional command-palette
case: its 300 ms debounced `/api/search` request lacked a fixture. Fast local clicks had hidden
the request. The test now waits for the search response before selecting the action, reproducing
the missing route locally; a typed-shape empty artists/albums/tracks fixture preserves strict
unknown-route failures. No PNGs were imported from the failed run; the successful repeat used the fix SHA.

### 1E canonical capture review

- Successful run: <https://github.com/thecrateapp/crate/actions/runs/38807507930>, renderer
  `c7e9e96180d5ae85fcb755319d38e5383c95b828`. Listen 34 pass / four intentional skips; Admin 12 pass.
- Artifact `12006129308`, SHA-256
  `8fc02ceddaa43f707d93f1e6e267b5cd10f88efda0f4c921eaa4547297a2023e` verified after download.
  Manifest confirms `mcr.microsoft.com/playwright:v1.63.0-noble`, Linux x64 and the source SHA;
  its original JSON was imported with 1E; the latest tracked `tests/visual/capture-manifest.json`
  advances with each reviewed recording, so prior provenance is retained in Git history.
- Imported 31 PNGs: 24 Listen, seven Admin. Twelve old Listen images are byte-identical; ten
  changed and nine are new. Reviewed all changed before/after/diff images, all seven Admin
  pages and both new EQ states. The intended genre-chip treatment, populated Radar ticket and
  prior font/token changes account for the diffs. Existing retired-skin captures remain only
  until runtime removal 1.13; their refresh is not a new variant requirement or visual approval.
- Full Admin pages include Genres Sound Intelligence and System Resources. EQ shows ten bands,
  the genre-taxonomy source and inherited Rock in desktop/mobile. No PNG was generated on Mac
  for baseline import. The mockup's 1E gallery now uses these exact committed references.
- Comparison and full Frontend Tests pass: <https://github.com/thecrateapp/crate/actions/runs/38808354069>,
  source `cf4779868208bc4dc9445d1e80f545dc277f3988`. Appearance 26, Listen 34 / four intentional
  skips, Admin 12; all frontend suites, types, lint, builds, budgets and design gates pass. This
  closes 0.11. Other Phase 0/runtime/device gates remain open.

## Checkpoint 1F — Admin card contrast (Task 1.0)

Diego approved commit/push of the contrast checkpoint, its Linux capture run and continuation
with InstrumentPanel on 2026-10-16. Canonical capture/review and the local route walkthrough
were completed before the 1.7 adopter changes, as recorded below. Diego's 2026-10-16
feedback confirms the unboxed TrackReadout as final Audio Profile, not the legacy KPI treatment.
The mockup distinguishes that target from this temporary contrast comparison. Inventory at
`cf477986` found 99 background-token usages across 39 files, with only two borderless card
callsites: four Audio Profile KPI boxes and the image-crop modal. Existing Card/Badge/Select
borders, artwork placeholders, progress tracks, hover states and separated calendar cells need
no change. The two callsites gain `border border-border-quiet`; tokens and behaviour stay intact.

- The seven 1E captures do not expose either state. `tests/admin-e2e/card-contrast.spec.ts` adds
  deterministic analysis data for the real Album KPI grid and opens the real crop modal with a
  synthetic image. Tests reproduced the missing 0px border, then passed with the fix. They check
  all four sides against the effective quiet token, normalising browser colour representations
  to RGBA, and confirm cancellation performs no API write. No upload is submitted.
- The persistent mockup at <http://127.0.0.1:5186/#contraste-admin> shows real before/after crops
  from local browser renders, clearly labelled advisory. They live in ignored `.artifacts/`;
  missing assets retain an explicit placeholder. The 31 canonical 1E PNGs remain unchanged.
- Verification passes: Admin 248 unit tests, 14 browser checks, preview 26 checks, Admin types and
  lint, Admin/preview builds and unchanged bundle budget: 515,384 B gzip / 532,480 B ceiling.
  Spec and quality review have no actionable findings.
- The initial manual review visited 24 sidebar destinations; Logs initially timed out. The
  remaining route walkthrough, canonical Linux captures and full comparison CI were subsequently
  completed before 1.7, as recorded below. Focused fixture tests independently cover both changed
  surfaces. Deeper states and the pre-existing Artist-alias issue remain explicitly qualified below.

### 1F publication and canonical Linux recording — 2026-10-16

- Published source: `6e793ebdf3ccf02c950e18af489c719dc60ac463` on `origin/feat/crate_v3`.
- Successful capture run: <https://github.com/thecrateapp/crate/actions/runs/38859757212>,
  artifact `12028567230`, SHA-256
  `7aef4a2701a2c92440ecec599bb3ac556d75e13ce43a9d652ce9c11ef7bd458c` verified after download.
- Original manifest confirms the exact source, Playwright 1.63.0 Noble, Linux x64; retained at
  `tests/visual/capture-manifest.json`. All 31 existing PNGs are byte-identical to 1E.
  Two new canonical PNGs cover the four real Audio Profile KPIs and the open crop modal.
  Both have been visually reviewed; the quiet exterior borders and fixture content are as expected.
- Canonical image import, comparison CI and the remaining local route walkthrough are complete
  (next section). The separate 1G implementation is local and is not part of the 1F publication.

### 1F comparison and local route walkthrough — complete

Full Frontend Tests and Linux comparison pass on `82f145940df8045c9cb3765dcafce410276531cf`:
<https://github.com/thecrateapp/crate/actions/runs/38860652793>. Appearance 26, Listen 34 / four
intentional skips, Admin 14; all frontend suites, types, lint, builds, budgets and gates pass.

The remaining local walkthrough was performed before changing the two 1.7 adopters. Logs now
loads 100 lines and its filter/roster/stream panels. Reviewed actual Artist overview/discography,
Album with analysed Audio Profile, Genre detail/editor, both playlist creation panels (cancelled),
the missing-playlist state, Profile inspector redirect, authenticated Login redirect and the first
Setup form without submission. The legacy Album alias resolves to the real Crystallize canonical
route. Combined with the earlier 25 sidebar destinations, all 34 route patterns have been surveyed.

This is a route/surface walkthrough, not full functional certification: no populated playlist
exists locally, later Setup steps require writes, capability variants and some independent loading
states remain broader QA limits. The old Artist alias `/artists/23/quicksand` resolves as Album
and shows `Not found`, matching the already planned shadowing check in 3.2; it is pre-existing and
unrelated to the two hairlines. Do not mark that alias fixed or the deeper states tested. Task 1.0's
capture/comparison and route-walk prerequisites are complete; the isolated 1.7 adoption can proceed.

## Checkpoint 1G — InstrumentPanel (Task 1.7)

Diego approved the corrected visual checkpoint on 2026-10-16 and authorised its commit/push,
canonical Linux captures and continuation to Meter 1.8. The implementation is published as
`473604f7046bd72a53e41a77a87d54e54e73e730`.
The shared primitive implements the DS §2.3 props-only contract: figure/section, optional real-data
summary, named heading fallback, h2/h3 MonoLabel, technical metadata and an isolated polite status
slot, optional top rule and an inline-size container. No fill, side borders, motion, fetching or
stream subscriptions are added. Header/content changes use the existing snapshots and controls.

- Listen `SettingsPrimitives.Section` uses the real primitive as a named section, preserving its
  description, children, controls and catalog strings. Admin migrates only System Resources,
  preserving resource cards, period controls and refresh; the header loses its decorative icon.
  Its accessible summary reads the actual music-volume measurements when present.
- Tests reproduced the missing primitive and legacy consumer structure before implementation.
  Spec review and Diego's spacing feedback identified the inherited `.settings-section` recipe:
  its full border/fill surrounded unpadded content. Browser tests reproduced the effective fill;
  the class and unused recipe are removed. Desktop/mobile checks now assert a transparent section
  with only the top rule. The preview compositions also leave space between readings, copy/actions.
  The real Admin render also exposed `m-0` overriding its parent's `space-y-6`: the primitive now
  resets only inline margins (`mx-0`). A browser regression reproduced a collapsed gap and now
  verifies at least 24px between Resources and Metric Streams, sampling both rectangles together.
- Diego also spotted a 6px difference between the Resources and Settings rule-to-heading gaps.
  The status wrapper inherited a 16px/24px line box and raised the header baseline. It now uses
  the same MonoLabel metrics in a flex wrapper; both titles start 22px below the rule. A browser
  regression failed with the original 6px difference and passes on desktop and 390px after the
  fix. The six primitive tests and shared typecheck also pass again after this adjustment.
- <http://127.0.0.1:5186/#paneles> uses actual InstrumentPanel, Listen Section/ToggleRow, StatNumber
  and StatusDot. It shows live/pause status without announcing readings, a working Settings switch
  and a section without a rule, with explicitly fictional data. Earlier checkpoints remain visible.
- Verification: Shared 744, Admin 252, Listen 2,854 and Desktop 50 unit tests pass (3,900 passing;
  four existing Listen skips). Admin browser 15, Listen smoke 34 / four skips, cumulative preview
  28 pass. After removing the legacy CSS, focused Listen 12 and all six existing Settings smoke
  states pass again; the preview verifies desktop and 390px. Four typechecks, both app lints,
  shared/Admin/Listen/preview builds, token sync, 49 tooling tests, 15 drift budgets and layer
  boundaries pass. Initial JS gzip: Admin 515,404 B / 532,480 ceiling; Listen 204,757 B / 307,200.
- Spec and code-quality reviews have no remaining actionable findings. No drift/bundle ceiling
  increased. The 33 committed Linux PNGs and provenance manifest are unchanged by the local 1G diff.
- Canonical Linux recording passes in run <https://github.com/thecrateapp/crate/actions/runs/38864631250>.
  Artifact `12030469443` SHA256 `d351c4876b8b862e3949a848ba866e41cfb14597b1b4f8d4d1ee82f5442a3d45`
  matches the downloaded archive. Its manifest pins `473604f7`, Playwright 1.63.0-noble, Linux x64.
  All 33 PNGs are retained: 26 byte-identical; the seven reviewed changes are System Resources
  and six existing Settings captures (the legacy appearance matrix awaits retirement in 1.13).
  Images show the expected top rules/open sections, retained controls and 24px Admin panel gap.
- Comparison and full frontend CI pass in <https://github.com/thecrateapp/crate/actions/runs/38865107324>,
  source `c44b31f3`: appearance 26, Listen 34 / four skips, Admin 15; unit/types/lint/builds/budgets
  and design gates pass. This closes the 1G publication/capture checkpoint.
  Local smoke images are advisory only. Meter 1.8 and Readout 1.9 are approved/published;
  ProgressHairline 1.10 and shared toaster configuration 1.11 are published; cleanup 1.12 is the current local checkpoint. TrackReadout and global Admin
  icon retirement retain their planned tasks; 1D focus polishing stays deferred.


## Checkpoint 1H — Meter (Task 1.8)

Diego approved the visual checkpoint on 2026-10-16 and authorised commit/push, canonical Linux
captures and continuation to Readout (Task 1.9). Published as `6a5b3366b7f6e3e3da67d687103d2828ef96215c`.
The shared props-only primitive uses MonoLabel, a quiet track and accent fill, a limit tick and
1–4px tracks. Its fill exposes `valueRef` and writes `--v` through the DOM ref per sample; no
animation loop, timers or React state per frame. Fixed styling stays in CSS; the drift ceiling
is unchanged. Over-limit readings retain the real value in text and add `over · max N`.

- ARIA clarification in DS §2.3: valid meters clamp `aria-valuenow` to the numeric range while
  `aria-valuetext` retains the actual sample. Null/non-finite samples or invalid ranges render
  a labelled group described by the visible reading, without fill or numeric range attributes.
  Missing data displays `n/a`; an empty mirror retains `0/0`. This avoids an invalid meter role
  with no required value and does not invent zero/capacity.
- Listen OfflineSection uses readyTrackCount/trackCount and profile totalBytes/browser quota.
  It preserves sync/remove actions, disabling and existing translated copy. Quota is sampled
  on mount/byte changes without polling or storage-permission prompts; failed/missing/invalid
  estimates retain the count and byte readout. Native filesystem runtimes do not mix their
  file bytes with the web origin quota. Unrelated origin `usage` is not profile consumption.
- Admin replaces only Transcode Slots with active/limit from the existing delivery payload;
  absent or incomplete runtime renders `n/a`, replacing the former invented `0/1` fallback.
  Other statistics, requests, worker state and refresh behaviour are unchanged.
- Real browser QA reproduced a 0px track inside the old five-column card layout. Transcoding
  is now a full-width row below the four remaining cards; Offline has full-width count/storage
  rows and a StatNumber item summary. Browser tests require at least 80px of useful track in
  desktop/mobile layouts. Admin opens directly at mobile width; resizing mounted Nivo charts
  produced unrelated SVG animation errors and is outside this Meter layout check.
- The persistent mockup at <http://127.0.0.1:5186/#meters> uses actual Meter/InstrumentPanel
  components with fictional readings, a working over-limit toggle, missing data and all four
  thicknesses. Earlier specimens remain visible. Preview browser checks include forced colors;
  local images are advisory. Two focused Offline screenshots were added by the approved 1H
  Linux run; all 35 PNGs/provenance are published in `ef5e7f52`.
- Verification passes: Shared 753, Admin 257, Listen 2,867 and Desktop 50 unit tests (3,927 passing;
  four existing Listen skips). Admin browser 17, Listen smoke 40 / four skips, cumulative preview
  31 pass; the three Meter desktop/mobile/forced-color checks pass again after allowing longer
  mono labels to stay intact. Both real adopters keep useful tracks at desktop/mobile widths.
  Four typechecks, both app lints, shared/Admin/Listen/preview builds, 49 tooling tests, token
  policy, 15 drift budgets and layer boundaries pass. Initial JS gzip: Admin 515,406 B / 532,480;
  Listen 204,757 B / 307,200. No ceiling increased. SPEC and code-quality reviews are approved.
- The first simultaneous unrestricted unit runs saturated the host and timed out; they do not
  qualify any gate. The complete successful rerun executes workspaces sequentially with
  `--maxWorkers=2`. Keep that local limit; run browser suites with one worker and avoid launching
  several unrestricted workspace suites together. No stale test processes remain.
- Canonical Linux recording passes in <https://github.com/thecrateapp/crate/actions/runs/38869057068>,
  source `6a5b3366`, Playwright 1.63.0-noble / Linux x64. Artifact `12032298795` SHA256
  `9ddb9de0b2cf3beb5dda5d125cc609dffecb13fe1b840f22071e7028b3f57a12` matches the downloaded ZIP.
  Review covers one changed System image and two new Offline images; the other 32 are identical.
  All 35 PNGs and the original manifest are published in `ef5e7f52`. Comparison/full frontend CI
  passes in <https://github.com/thecrateapp/crate/actions/runs/38869556811>, source `ef5e7f52`.
  This closes the 1H publication/capture checkpoint.
- Readout 1.9 is the next authorised visual checkpoint. TrackReadout 3.9b, global Admin icon retirement,
  theme runtime retirement and the deferred 1D focus polish retain their planned tasks.


## Checkpoint 1I — Readout (Task 1.9)

Diego approved the visual checkpoint on 2026-10-16 and authorised its commit/push, canonical
Linux captures and continuation to ProgressHairline (Task 1.10). Published as `a80f396b`.
The props-only primitive renders a mono 11.5px visible line, muted text, wide tracking, 1.4em
minimum height and a default 12ch reserve. `minWidthCh` writes a CSS variable through the DOM
ref; the minimum is capped at the container width and longer text can wrap. The visible span
is aria-hidden; a separate persistent sr-only polite/atomic status carries `announcement`.
Changing only the preview leaves that live node and text untouched. No motion loop or fetching.

- Listen adopts Readout in the EQ header. Existing labels/controls/i18n remain; manual band input
  changes the visual mode while retaining the last committed announcement. Band commit announces
  Custom. Committed preset/Smart/Adaptive changes from the existing runtime update the announcement.
  Spec review found an interrupted-preview edge case: an external mode could remove the commit
  callback and leave the preview flag active. Two regressions reproduced stale Flat announcements
  for Smart/Punk; clearing the flag for external modes fixes both and subsequent Custom/Adaptive
  changes. The focused EQ suite passes 9/9 after the fix. No changes to DSP or persistence APIs.
- Admin replaces the existing GenreEqEditor synchronization line with Readout. Its existing
  commit-only dirty state, reset, PATCH/onSaved and parent rehydration are preserved. The real
  browser test opens a deterministic taxonomy node, captures the initial editor, commits a local
  edit and resets it; the live node persists and no API write occurs. One focused Admin scene
  joins the next Linux recording after 1I approval; the 35 canonical 1H PNGs/manifest are unchanged.
- The persistent mockup at <http://127.0.0.1:5186/#readout> shows the real primitive with a 32ch
  reserve, separate preview/confirm/reset actions and a visual-only specimen. Fictional data,
  advisory desktop/mobile screenshots and all prior examples remain. Browser checks measure
  physical width against 32 font glyphs, keep it stable through preview/commit and check overflow;
  they do not assume how CSS `min()` serializes in computed styles.
- Local verification passes: Shared 757, Admin 259, Listen 2,871 and Desktop 50 unit tests
  (3,937 passing; four existing Listen skips), preview 33, Admin browser 18 and Listen smoke 40 /
  four skips. After the interrupted-preview fix, the complete Listen suite, Listen/Desktop
  typechecks, Listen lint and both desktop/mobile EQ browser checks pass again. Four typechecks,
  both app lints, shared/Admin/Listen/preview builds, 49 tooling tests, 15 drift budgets and layer
  boundaries pass. Initial JS gzip: Admin 515,402 B / 532,480; Listen 204,757 B / 307,200. No ceiling
  increased. Spec and quality reviews are approved; local runs retain the bounded concurrency.
- Canonical Linux recording passes in <https://github.com/thecrateapp/crate/actions/runs/38871597394>,
  source `a80f396b`, Playwright 1.63.0-noble / Linux x64. Artifact `12033384073` SHA256
  `c6e2230780326e0da172db9fc9e74627efb7dd18415f14ba0a5abca7b6414cd2` matches the downloaded ZIP.
  All 36 PNGs and the original manifest are imported: 33 byte-identical, two reviewed EQ header
  changes (desktop/mobile), and a new focused GenreEqEditor capture. Controls/curve remain intact.
- Comparison/full frontend CI passes in <https://github.com/thecrateapp/crate/actions/runs/38872274120>,
  source `dd71eb72`. This closes the 1I publication/capture checkpoint. Diego authorised
  ProgressHairline 1.10 as the next visual checkpoint. TrackReadout 3.9b, global Admin icon retirement, runtime theme retirement
  and the deferred 1D focus polish retain their planned tasks.

## Checkpoint 1J — ProgressHairline (Task 1.10)

Diego approved the visual checkpoint on 2026-10-16 and authorised commit/push, canonical Linux
captures and continuation to the shared toaster configuration (Task 1.11). Published as `0660fbd2`.
The props-only primitive accepts a normalized value, accessible label/valueText and 1/2px thickness.
Finite values clamp to 0–1, write `--p` through the fill ref and expose a 0–100 ARIA range. Missing
or non-finite values omit `aria-valuenow`. The indeterminate 36% block uses the pinned site's
2.4s `cubic-bezier(0.65, 0, 0.35, 1)` animation only while IntersectionObserver reports onscreen
and the shared OS/Crate/document motion gate permits it; otherwise it is static. No rAF/timers.

- Admin Tasks replaces the existing progress bar, retains server percentage, counts, rate, ETA,
  actions and its existing snapshot/SSE connection. Unknown totals retain their step/message
  alongside an indeterminate bar. Terminal task events remove only the unknown bar while the
  snapshot catches up; the reason and last numeric reading remain. Three terminal regressions
  failed before this correction, and the fourth protects the known reading. ScanProgress uses
  the same primitive for artists; unknown
  totals do not invent 0%. The scanner component has no active production consumer in this tree,
  so its coverage is component-level; no artificial route or scanner operation was added.
- Listen Upload adds one named bar per selected file during submission. Existing chunk-count
  callbacks remain; an additive callback reports bytes only after successful chunks, including
  short final chunks and unequal file sizes. Direct fetch uploads remain indeterminate because
  the transport exposes no byte telemetry. File selection/clear are locked while submitting;
  success/failure clears progress and a retry starts with a fresh measurement. No endpoint,
  request-body, chunk order or background import behaviour changes.
- The unused Admin shadcn Progress re-export is removed. The measured direct-shadcn drift stays
  96 because that inventory scans Listen/shared only; its ceiling/scope are unchanged. Global
  Admin icon retirement and scanner pipeline styling remain assigned to their later tasks.
- <http://127.0.0.1:5186/#progreso> retains all prior specimens and shows actual ProgressHairline
  with fictional values, 50→75→100→0 controls and indeterminate→complete toggling. Two browser
  checks cover real widths/transforms, both thicknesses, motion gates and overflow on desktop/390px.
  Diego requested the percentage align with the right end of the full track. Its Readout keeps
  its reserved width with right-aligned text; a Range-based regression failed with a 54px gap
  and passes at 50%/75% on both viewports. Their PNGs are advisory. Four focused Tasks/Upload
  captures join the next approved Linux run.
- Tests-first failures were observed for primitive, Tasks, scanner, Upload and preview. Full suites
  pass: Shared 768 / Admin 268 / Listen 2,876 / Desktop 50 (3,962 passing; four existing Listen skips).
  The seven Tasks cases include the four terminal regressions; all 11 primitive tests pass again
  after the type-safe empty-observer fallback. Browser checks pass: preview 35 / Admin 20 /
  Listen 42 with four existing skips. Four typechecks, both lints, shared/Admin/Listen/preview
  builds, 49 tooling tests, token policy, 15 drift budgets and layer boundaries pass. Initial JS
  gzip: Admin 514,803 B / 532,480; Listen 204,762 B / 307,200. No ceiling increased. The final Upload
  desktop/mobile rerun passes with captures focused on the pending file queue, avoiding fixed
  chrome inside a tall element screenshot. Spec/quality reviews approve; local concurrency remains bounded.
- Canonical Linux recording passes in <https://github.com/thecrateapp/crate/actions/runs/38876594597>,
  source `0660fbd2`, Playwright 1.63.0-noble / Linux x64. Artifact `12035801498` SHA256
  `716889696d8d273628c6dd5878e4c5df8fe36b358a8bc5b2cf32ef556291225a` matches the downloaded ZIP.
  All 40 PNGs/original manifest are imported: 35 byte-identical; Tasks changes from the old thick
  progress bar to the hairline, and four focused Tasks/Upload desktop/mobile scenes are new.
- Comparison/full frontend CI passes in <https://github.com/thecrateapp/crate/actions/runs/38877216337>,
  source `3f470ec6`. This closes the 1J publication/capture checkpoint. The shared toaster
  configuration (Task 1.11) is the current authorised visual checkpoint.

## Checkpoint 1K — Shared toaster configuration (Task 1.11)

Diego approved 1K on 2026-10-16 and authorised commit/push, canonical Linux captures and continuation
to Task 1.12. Published as `7b46021d`; Linux capture references are recorded below.
One typed `toasterConfig` supplies Sonner classes, its existing 4000ms default duration and no
default icons. Both app mounts remove `richColors`. Admin keeps dark/bottom-right; Listen keeps
its runtime colour/native synchronization, bottom-center placement and mobile bottom-chrome
offset. The `notify` API, per-call duration/icon overrides, messages and actions are preserved.

- Shared recipes supply an object card/hairline/panel radius, 380px maximum width, 12/16px padding,
  sans 14px messages, muted mono 11.5px descriptions and ghost actions. A late-injected Sonner
  dark-description rule reproduced the wrong RGB value; the stronger scoped selector passes the
  regression on desktop/390px. No application identity branches or dependency changes.
- This task is configuration only. DS §5.10 contextual MonoLabel type words, task-id/Open task
  links and inline-first feedback remain pending consumer migration. Do not mark the whole recipe
  complete or add generic untranslated prefixes to localized Listen messages.
- <http://127.0.0.1:5186/#toasts> mounts actual Sonner with a scoped id, manual fictional
  saved/queued/error examples, local retry and a two-toast stack. Clearing dismisses both bounded
  IDs. Indefinite duration and embedded positioning are preview-only; old specimens remain visible.
  Its screenshots are advisory.
- Real Admin browser QA saves a fixture genre EQ; Listen queues a local-stub Upload. They check
  shared styles, absence of default icons and preserved placement/safe offsets. Three new focused
  toast captures join the next Linux recording after approval; the 40 reviewed 1J PNGs stay intact.
- Four config tests and seven cross-app policy cases pass; full units pass Shared 772 / Admin 268 /
  Listen 2,881 / Desktop 50 (3,971 passing; four existing Listen skips). Four typechecks and both
  app lints pass. Preview 37, Admin 21 and Listen 42 browser checks pass, with four existing Listen
  skips. The final focused Admin/Listen runs pass after correcting the test's expected unchanged
  Upload message. Browser checks run with one worker; unit suites run serially with maxWorkers=2.
- Quality review reproduced two missing behaviours after opting out of Sonner styling: rear-toast
  content stayed visible in a collapsed stack, and its focused card lost the keyboard indicator.
  Both regressions failed before the scoped CSS fixes and now pass on desktop/390px; a real Admin
  toast also retains a 2px token-coloured outline against Sonner's late outline reset. Spec/quality
  reviews approve with no remaining findings.
- Shared/Admin/Listen/preview builds, 49 tooling tests, 15 drift budgets and layer boundaries pass
  (zero violations across 144 source files). Initial JS gzip is Admin 514,933 B / 532,480 and
  Listen 204,904 B / 307,200; no ceiling increased. The 40 canonical PNGs/manifest remain unchanged.
- Canonical Linux recording passes in <https://github.com/thecrateapp/crate/actions/runs/38880022435>,
  source `7b46021d`, Playwright 1.63.0-noble / Linux x64. Artifact `12037047924` SHA256
  `476048805f9b0ab4b6115f65bdbe1d944afea9e9ace3bc2c127d54d1f54ca41e` matches the downloaded ZIP.
  All 43 PNGs/original manifest are imported: 40 byte-identical and three new reviewed toast
  scenes (Admin genre save, Listen Upload desktop/mobile), with quiet borders, cyan text and no icons.
- Comparison/full frontend CI passes in <https://github.com/thecrateapp/crate/actions/runs/38880774591>,
  source `181ca4d4`. This closes 1K publication/capture QA; preserve the reviewed mockup.

## Checkpoint 1L — Unused shared component cleanup (Task 1.12)

Diego approved 1L on 2026-10-16 and authorised commit/push, canonical Linux captures and continuation
to theme runtime retirement 1.13. Publication/capture references follow as they complete.

- Import/re-export/manifest review found zero production consumers for shared OpsPageHero,
  OpsPanel, OpsStatTile and ShowCard. They and their two exclusive test files are removed (nine
  obsolete cases). App-local Ops/ShowCard implementations and shared show-types/test/explicit
  exports are preserved. The package is private and its wildcard exports need no manifest change.
- Remove the general Ops export-policy bypass, ShowCard unused-export exception, its two hand-made
  GenrePill exceptions, obsolete literal type/icon budgets and the stale Listen local-copy
  exception. The policies failed before cleanup (four initial failures, plus the full Listen
  suite detecting the additional stale duplicate exception). They continue to guard active code.
- Measured drift drops: arbitrary utilities 54→53 and inline styles 89→88. Lower both ceilings;
  no budget or policy scope increases. Update Shared/Admin instructions; historical analysis and
  layer-inventory fixture strings remain evidence rather than executable dependencies.
- <http://127.0.0.1:5186/#limpieza> records the cleanup with actual current primitives and retains
  all approved specimens. Desktop/390px checks cover four readable entries, overflow and named
  regions/headings. The two new cases failed before the section existed; additional heading
  assertions reproduced an ignored InstrumentPanel prop and pass with its real label/heading API.
- Unit verification: Shared 763, Admin 268 and Desktop 50 pass in full. Listen's full run passes
  2,880 cases with four existing skips and detects only the stale ShowCard duplicate exception;
  after removing that entry, all three component-policy cases pass on the focused rerun. Together
  these cover 3,962 current cases; the nine-case drop from 1K retires tests of deleted components.
  Suites run serially with maxWorkers=2. No remaining test failure is unresolved.
- Browser QA passes preview 39 / Admin 21 / Listen 42, with four existing Listen skips. Both new
  preview cases pass again after correcting named headings and matching the existing 20px content
  spacing. The desktop/mobile PNGs were reviewed locally and remain advisory.
- Four typechecks, both app lints, shared/Admin/Listen/preview builds, bundle checks, 49 tooling
  tests, token CSS sync, 15 drift budgets and layer boundaries pass (zero violations across 140
  source files). Shared output was rebuilt from an empty generated dist directory and contains
  none of the four retired modules. Initial JS gzip is Admin 514,932 B / 532,480 and Listen
  204,904 B / 307,200; no ceiling increased.
- Spec/quality reviews approve. The 43 reviewed Linux PNGs and original manifest remain unchanged
  by this cleanup.
- Remaining gates: authorised publication and Linux capture/review/comparison. Theme runtime
  retirement 1.13 is now assigned; review its integration prerequisites and keep the next checkpoint.
