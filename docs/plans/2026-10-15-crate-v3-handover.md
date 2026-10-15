# Crate v3 handover

Entry point for agents picking up Crate v3. Revised 2026-10-15. Read this file and the implementation
plan; the status table separates local implementation from pending QA.

## Where the work lives

- Canonical clone: `/Users/diego/Code/crate-v3`, branch `feat/crate_v3`, with its own dependencies.
  Assigned agents use isolated worktrees on the internal disk; never use the removed external tree.
- `origin` is GitHub. Checkpoint 1A and the persistent preview were committed as `efe6cf2e` and
  pushed to `origin/feat/crate_v3` with Diego's approval on 2026-10-15. The branch now tracks
  `origin`, not `local-external`. Checkpoint 1B was approved, committed as `c28a97e0` and pushed on 2026-10-15;
  rebase/PR/release remain gated.

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
focus/selection is implemented locally at Checkpoint 1D**, provisionally accepted to continue;
further visual polishing is deferred. InstrumentPanel 1.7
waits for Admin 1.0 and its capture prerequisites.
Theme runtime retirement 1.13 remains outside this batch.

The persistent component/visual mockup lives in `tools/design-system-preview/` and runs with
`npm run design-system:preview` at <http://127.0.0.1:5186/#primitivas>. Extend the same page at
every checkpoint with real components, preserving the approved examples. This is local review
material, not the committed CI screenshot source. The current additions are at
<http://127.0.0.1:5186/#filas-y-chips>: interactive rows, link/multiline examples, toggle/action pills
and static tags. The approved 1A specimens remain on the same page.

`PLAYWRIGHT_CHANNEL=chrome npm run design-system:preview:test` passes 13 cumulative local browser
checks, including percentage-bearing GenrePill, keyboard focus, real Select options, 44px touch
targets and held-pointer reduced motion. The appearance harness passes 26 Chrome checks, including
the real Listen search in desktop/mobile and open/closed states. These local Chrome runs do not
qualify desktop runtime floors, WebKit, device QA or CI screenshot baselines. Review GenrePill at
<http://127.0.0.1:5186/#genre-pill> and the new focus block at <http://127.0.0.1:5186/#foco>.

Checkpoint 0 remains open: 0.11 CI baselines/reviews, 0.15 runtime qualification and relevant device
reviews are pending; 0.14 production measurement may wait until the wheel and needs assignment.
Admin captures in 0.11 still precede 1.0. Focused tests do not substitute for CI/screenshots/device QA.

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
   1C and provisional 1D, then continuation with the next plan block. Subsequent checkpoints
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

| Area                                                         | Local implementation / next gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0 font licence; 0.1 tracking steps 1–2; 0.2 internal clone | Implemented and pushed with 1A; rebase/PR pending approval and Smart Mix integration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 0.3 decisions                                                | Accepted, including one identity, small Admin captures and 520 KiB budget; calendar estimates provisional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 0.4–0.10, 0.12, 0.13                                         | Local implementation recorded; does not certify full CI, screenshots or device QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 0.11 visual baselines                                        | Pending approved workflow run, Linux captures/review; precedes Admin 1.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 0.14 production graph                                        | Pending assignment; required before wheel, may wait during primitives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 0.15 desktop runtime                                         | Pending qualification or approved fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Checkpoint 0                                                 | Open; no claim of CI/device/visual approval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1.2–1.4 / Checkpoint 1A                                      | Committed/pushed as `efe6cf2e`. At 1A: Shared 679, Admin 248, Listen 2,853 and Desktop 50 tests pass (Listen has 4 skipped); 66 focused primitive/CSS tests pass after the minified-fallback correction. Shared/Admin/Listen/Desktop typechecks, both app lints, package/app builds and 15 drift metrics pass without budget changes. Static spec/quality reviews found no actionable defects. Diego approved the mockup and authorised commit/push on 2026-10-15. CI/baselines/device QA remain pending                                                                                                                                                                                                                                                                                                                                                 |
| 1.0/1.7–1.12, 1b                                             | Not started; respect applicable gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.5–1.6 / Checkpoint 1B                                      | Committed/pushed as `c28a97e0`; Shared 696, Admin 248, Listen 2,853 and Desktop 50 tests pass (3,847 total; Listen has 4 skipped). Seven preview browser checks pass. Four typechecks, both app lints, shared/app builds, 21 gate tests, token sync and 15 drift metrics pass. Spec/quality reviews have no remaining findings. Approved and published as `c28a97e0` on 2026-10-15                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.6a / Checkpoint 1C                                         | Percentage-preserving GenrePill restyle visually approved by Diego on 2026-10-15; committed as `e60e6f50`, publication authorised. Its 27 focused tests pass; integrated suites/builds and cumulative browser checks are recorded with 1D. Commit/push explicitly authorised for this checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.1 / Checkpoint 1D                                          | Included in the current authorised commit/push batch and provisionally accepted by Diego to keep moving; focus-fade visual polish is deferred (not final visual parity approval). Available at #foco. Full suites run serially with maxWorkers=2: Shared 738, Admin 248, Listen 2,853 and Desktop 50 pass (3,889 total; 4 Listen skipped). This includes 15 focus-motion unit tests. Preview 22 and appearance 26 Chrome checks pass, including initial/intermediate/final on/off frames against the original native search transition, interruption, reduced motion, forced colours and real portal/TopBar geometry. Four typechecks, both app lints, shared/app/preview builds, 22 gate tests, token sync, 15 drift metrics and layer policy pass. Spec/quality review has no remaining findings. CI baselines/WebKit/runtime/device QA remain pending |
| 1.13 runtime theme retirement                                | Planned, not implemented; outside current batch; required for the joint major                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Phases 2–7                                                   | Pending; reconcile Smart Mix overlap after rebase before marking tasks complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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

## Next block — baseline captures before Admin adoption

Continue Task 0.11 before 1.0 → 1.7. Its fixture scaffolding exists, but the pinned CI capture job,
platform-independent snapshot names and the seven initial Admin captures still need implementation.
The next checkpoint prepares this capture pipeline. Generated PNGs come only from the pinned Linux
amd64 workflow, and each image must be reviewed before the Admin card contrast change. Keep the
persistent component mockup and the deferred 1D focus-polish note throughout this infrastructure batch.
