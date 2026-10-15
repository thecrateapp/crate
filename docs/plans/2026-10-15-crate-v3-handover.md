# Crate v3 handover

Entry point for agents picking up Crate v3. Revised 2026-10-15. Read this file and the implementation
plan; the status table separates local implementation from pending QA.

## Where the work lives

- Canonical clone: `/Users/diego/Code/crate-v3`, branch `feat/crate_v3`, with its own dependencies.
  Assigned agents use isolated worktrees on the internal disk; never use the removed external tree.
- `origin` is GitHub. Checkpoint 1A and the persistent preview were committed as `efe6cf2e` and
  pushed to `origin/feat/crate_v3` with Diego's approval on 2026-10-15. The branch now tracks
  `origin`, not `local-external`. Diego approved Checkpoint 1B and authorised its commit/push on 2026-10-15; rebase/PR/release remain gated.

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
retained GenrePill with percentages in the persistent mockup. That next preview remains local
until reviewed; it does not authorise migration of genre data or Smart Mix logic. InstrumentPanel 1.7 waits for Admin 1.0 and its capture prerequisites.
Theme runtime retirement 1.13 remains outside this batch.

The persistent component/visual mockup lives in `tools/design-system-preview/` and runs with
`npm run design-system:preview` at <http://127.0.0.1:5186/#primitivas>. Extend the same page at
every checkpoint with real components, preserving the approved examples. This is local review
material, not the committed CI screenshot source. The current additions are at
<http://127.0.0.1:5186/#filas-y-chips>: interactive rows, link/multiline examples, toggle/action pills
and static tags. The approved 1A specimens remain on the same page.

`PLAYWRIGHT_CHANNEL=chrome npm run design-system:preview:test` passes seven local browser checks,
including real typography, 44px touch targets and held-pointer reduced-motion checks for both OS
and Crate preferences. This Chrome run does not qualify the desktop floors or CI screenshot QA.

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
   commits until Diego gives the go-ahead.** His 2026-10-15 approval covers the reviewed 1A batch
   and persistent preview; the next batch remains a local diff for review.
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

| Area                                                         | Local implementation / next gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0 font licence; 0.1 tracking steps 1–2; 0.2 internal clone | Implemented and pushed with 1A; rebase/PR pending approval and Smart Mix integration                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 0.3 decisions                                                | Accepted, including one identity, small Admin captures and 520 KiB budget; calendar estimates provisional                                                                                                                                                                                                                                                                                                                                                                                                |
| 0.4–0.10, 0.12, 0.13                                         | Local implementation recorded; does not certify full CI, screenshots or device QA                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 0.11 visual baselines                                        | Pending branch publication/workflow approval and Linux captures/review; precedes Admin 1.0                                                                                                                                                                                                                                                                                                                                                                                                               |
| 0.14 production graph                                        | Pending assignment; required before wheel, may wait during primitives                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 0.15 desktop runtime                                         | Pending qualification or approved fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Checkpoint 0                                                 | Open; no claim of CI/device/visual approval                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1.2–1.4 / Checkpoint 1A                                      | Committed/pushed as `efe6cf2e`. At 1A: Shared 679, Admin 248, Listen 2,853 and Desktop 50 tests pass (Listen has 4 skipped); 66 focused primitive/CSS tests pass after the minified-fallback correction. Shared/Admin/Listen/Desktop typechecks, both app lints, package/app builds and 15 drift metrics pass without budget changes. Static spec/quality reviews found no actionable defects. Diego approved the mockup and authorised commit/push on 2026-10-15. CI/baselines/device QA remain pending |
| 1.0/1.1/1.7–1.12, 1b                                         | Not started; respect applicable gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.5–1.6 / Checkpoint 1B                                      | Implemented locally; Shared 696, Admin 248, Listen 2,853 and Desktop 50 tests pass (3,847 total; Listen has 4 skipped). Seven preview browser checks pass. Four typechecks, both app lints, shared/app builds, 21 gate tests, token sync and 15 drift metrics pass. Spec/quality reviews have no remaining findings. Diego approved the checkpoint and authorised commit/push on 2026-10-15                                                                                                              |
| 1.13 runtime theme retirement                                | Planned, not implemented; outside current batch; required for the joint major                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Phases 2–7                                                   | Pending; reconcile Smart Mix overlap after rebase before marking tasks complete                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
  toggles use `aria-pressed` and the active fill. The temporary local focus outline keeps it usable
  before global Task 1.1. Listen's radius rule now exempts `data-slot="chip"`.
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
