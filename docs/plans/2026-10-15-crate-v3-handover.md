# Crate v3 handover

Entry point for agents picking up Crate v3. Revised 2026-10-16. Read this file and the implementation
plan; the status table separates implementation from pending QA.

Current transfer: **1N–1P are complete in the checkpoint commit
`feat(ui): unify v3 overlays, controls and field spacing`**. Diego authorised commit/push and
continuation on Linux; this final publication record supersedes earlier local-only stops below.
**1T is approved and published as `5308c391c1b0168edebfff58b15e821a1e5a6757`.** Task 1b.7 /
checkpoint 1U is implemented locally at <http://127.0.0.1:5186/#saltar-contenido> and stops for
Diego's review before publication or 1b.8. Shared skip navigation in both shells and seven Listen
translations are the current review. The retained Listen play/halo/ring and luminous seek trail
from 1S remain intact. Resume on Linux with
[`2026-10-16-crate-v3-linux-handover.md`](2026-10-16-crate-v3-linux-handover.md).
Canonical 1N–1P Linux recording/comparison and native QA remain pending.

## Where the work lives

- Active Linux worktree: `/home/diego/.codex/worktrees/crate-v3-1q/crate`, existing branch
  `feat/crate_v3`, published HEAD `5308c391c1b0168edebfff58b15e821a1e5a6757` (1T);
  transfer checkpoint `53177736a7643c232cbb19e744a2b2ee9077efaf` remains an ancestor. Node 22.23.3, root
  dependencies and persistent :5186 preview are prepared. This isolates the MCP agent's
  `/home/diego/Code/Ninja/crate` checkout (`feat/crate_mcp`); leave its files untouched.

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
  `38880774591`. Cleanup 1L is published as `2c90a6f2`; Linux recording `38883592145` passes
  with all 43 PNGs byte-identical. The original manifest is imported in `bf1fa793`; comparison/full CI passes in `38885478542`.
  Rebase/PR/release remain gated.

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
material, not the committed CI screenshot source. The current publication cut retains
<http://127.0.0.1:5186/#capas> (1N overlays),
<http://127.0.0.1:5186/#formularios> (1O form foundations) and
<http://127.0.0.1:5186/#seleccion> (1P short choices). The approved fixed identity remains
at `#identidad`, with real functional preference controls and a fictional, memory-only legacy
migration. Cleanup remains at `#limpieza`, rendered with
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
Cleanup 1.12 and theme retirement 1.13 are published. The current transfer closes 1b.1–1b.2
through checkpoints 1N–1P; continue with 1b.3 / checkpoint 1Q.

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
content. Runtime retirement is verified locally and approved by Diego at Checkpoint 1M.

Listen and Admin use the same tokens, primitives, recipes and interaction rules. Only domain
components/data/workflows differ; app-specific general styling must not survive V3. Legacy
duplicates are transitional and converge in block 1b/page migrations. Check both apps together
and enforce drift/export gates at each relevant checkpoint. This clarification was confirmed
by Diego on 2026-10-16.

Task 1.13 inventories consumers/persistence/transport, migrates legacy preferences, removes
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
| 1.7 / Checkpoint 1G                                          | Published `473604f7` + reviewed Linux images/provenance in `c44b31f3`; recording 38864631250 and full comparison/frontend CI 38865107324 pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.8 / Checkpoint 1H                                          | Published `6a5b3366` + reviewed Linux images/provenance `ef5e7f52`; recording `38869057068` and comparison/full frontend CI `38869556811` pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.9 / Checkpoint 1I                                          | Published `a80f396b` + reviewed Linux images/provenance `dd71eb72`; recording `38871597394` and comparison/full frontend CI `38872274120` pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.10 / Checkpoint 1J                                         | Published `0660fbd2` + reviewed Linux images/provenance `3f470ec6`; recording `38876594597` and comparison/full frontend CI `38877216337` pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.11 / Checkpoint 1K                                         | Published `7b46021d`; 43 Linux images/provenance `181ca4d4` from `38880022435` (40 unchanged, three new toast scenes). Comparison/full frontend CI `38880774591` passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.12 / Checkpoint 1L                                         | Published `2c90a6f2`; recording `38883592145` passes with all 43 PNGs byte-identical. Original manifest imported in `bf1fa793`; comparison/full CI passes in `38885478542`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1b.1 / Checkpoint 1N                                         | Complete in the combined 1N–1P publication cut authorised by Diego; shared overlays/menus, ConfirmDialog and one close recipe. Focused checks and SPEC/QUALITY pass; new canonical Linux recording/native QA pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1b.2 / Checkpoints 1O–1P                                     | Complete in the combined publication cut: nine form foundations, 28 short selectors, caller review, Radio debounce and global 8 px field spacing. Focused checks and SPEC/QUALITY pass. Next: 1b.3 / 1Q; Linux continuation instructions are tracked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1b.3 / Checkpoint 1Q | Approved and published as `e863c227`; focused replay 39 Vitest / three Chromium cases passes. |
| 1b.4 / Checkpoint 1R | Approved/published as `093dcb1f`; scoped replay 309 Vitest / three Chromium cases passed before publication. |
| 1b.5 / Checkpoint 1S | Approved/published as `124b36a8`; track/media/table foundations and retained Listen play/ring/seek trail. Pre-publication replay: 31 Vitest / 9 Chromium cases passed. |
| 1b.6 / Checkpoint 1T | Approved/published as `5308c391`; pre-publication focused replay: 34 Vitest / 2 Chromium cases pass. Earlier 185-test consumer validation remains recorded below. |
| 1b.7 / Checkpoint 1U | Local at `#saltar-contenido`; shared first-focus skip link, main targets and seven Listen translations. Awaiting Diego before publication or 1b.8. |
| 1.5–1.6 / Checkpoint 1B                                      | Committed/pushed as `c28a97e0`; Shared 696, Admin 248, Listen 2,853 and Desktop 50 tests pass (3,847 total; Listen has 4 skipped). Seven preview browser checks pass. Four typechecks, both app lints, shared/app builds, 21 gate tests, token sync and 15 drift metrics pass. Spec/quality reviews have no remaining findings. Approved and published as `c28a97e0` on 2026-10-15                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.6a / Checkpoint 1C                                         | Percentage-preserving GenrePill restyle visually approved by Diego on 2026-10-15; committed as `e60e6f50`, publication authorised. Its 27 focused tests pass; integrated suites/builds and cumulative browser checks are recorded with 1D. Commit/push explicitly authorised for this checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.1 / Checkpoint 1D                                          | Published as d881a728 with explicit approval and provisionally accepted by Diego to keep moving; focus-fade visual polish is deferred (not final visual parity approval). Available at #foco. Full suites run serially with maxWorkers=2: Shared 738, Admin 248, Listen 2,853 and Desktop 50 pass (3,889 total; 4 Listen skipped). This includes 15 focus-motion unit tests. Preview 22 and appearance 26 Chrome checks pass, including initial/intermediate/final on/off frames against the original native search transition, interruption, reduced motion, forced colours and real portal/TopBar geometry. Four typechecks, both app lints, shared/app/preview builds, 22 gate tests, token sync, 15 drift metrics and layer policy pass. Spec/quality review has no remaining findings. CI baselines/WebKit/runtime/device QA remain pending |
| 1.13 / Checkpoint 1M                                         | Verified locally; spec/quality approved. One shared identity, safe preference migration and Cast/native compatibility. Chromium 41 / WebKit 41 / preview 41 / Admin 21 pass; Listen 43 + mobile Smart EQ replay 1 pass (four existing skips). Published `21873d24`; Linux recording `38888497469` passes. 33 PNGs reviewed, two Settings changes imported in `297daaa1`; comparison/full CI `38889352392` passes.                                                                                                                                                                                                                                                                                                                                                                                                                                |
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
to theme runtime retirement 1.13. Published as `2c90a6f2`; capture references follow below.

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
- Canonical Linux recording passes in <https://github.com/thecrateapp/crate/actions/runs/38883592145>,
  source `2c90a6f2`, Playwright 1.63.0-noble / Linux x64. Artifact `12038349206` SHA256
  `602c29a1e4de41fa8e48ade0da41907b497623c5b2ad2a6d679a8360d279e8b4` matches the downloaded ZIP.
  All 43 PNGs are byte-identical to the reviewed 1K references; the original manifest is imported.
- Remaining gate: comparison CI. Theme runtime retirement 1.13 is assigned; keep its next checkpoint.

## Checkpoint 1M — One shared identity (Task 1.13, local review)

Diego assigned this task after approving 1L and reconfirmed that Listen/Admin share the same
identity, design system, primitives and interactions; only domain components/workflows differ.
The shared/app/platform inventories find no technical dependency on Smart Mix merging.
Proceed on the current branch without rebase. At inventory time `origin/main` was `2451aa75`,
Smart Mix `f037bcf1` remained unmerged, and website HEAD was `08500b2c` (reference pin remains
`258bbaee`). The earlier integrated-baseline prerequisite is relaxed for this assigned task only.
Audit/reconcile new Smart Mix settings after integration; integration order and release gates stand.

- Fixed solid tokens and one CSS output replace skin/mode/accent/material/radius/font overrides.
  Listen/Admin/Desktop initialise the same shared identity and functional preference store.
  Settings retain only motion, effects and density; reduced OS motion always wins. Artwork and
  visualizer palettes remain content. Admin HeroComposition no longer mounts a ThemeScope.
- `crate.interface-preferences.v1` stores version/density/motion/effects. Valid new data wins.
  Legacy v2 density, reduced motion and effects migrate before removing the four inventoried
  keys: `crate.listen.appearance.v2`, `crate.listen.theme-skin`,
  `crate.listen.theme-skin.backup.v1`, `crate.listen.appearance.corrupt-backup`.
  Failed destination writes preserve sources; future versions are not overwritten/cleaned.
  Locale, player, visualizer and unrelated keys remain intact.
- Cast keeps contract v1 and accepts older peer values. New senders use default/dark/dark
  constants plus real reduced motion; the receiver uses the fixed TV-safe Crate palette.
  No Pydantic/public wire schema change. Capacitor status bar and Sonner use the fixed identity.
- Linux reads only GNOME window-button placement with a bounded 200 ms query; other desktops
  use native fallback. GTK scheme/accent/font/icon/cursor subscriptions are retired. Native
  control geometry, transparency, window configuration and IPC command name remain.
- `#identidad` uses actual Settings controls and the real migration function against isolated
  memory. No API/localStorage writes. All approved specimens remain available.
- Local verification and independent spec/quality reviews pass as detailed below. Native devices
  and new canonical Linux captures remain separate QA gates. Preserve all 43 previous PNGs
  and their manifest until publication approval; 10 retired variant captures will then be
  removed explicitly and the single-identity set recorded in Linux CI.

Stop for Diego's visual review. No commit/push of 1M, rebase, PR or release is authorised yet.

### Joint-major release note (draft, not released)

Listen and Admin now share the fixed Crate V3 identity and design system. Theme, skin, color-mode,
accent, material, radius and font selectors retire. Returning users keep motion, effects and
content-density preferences through an automatic local migration; OS reduced motion and unrelated
settings remain respected. Desktop no longer adopts GTK colors/fonts; native window-button
placement remains supported. Older Cast peers remain compatible. This note ships only with the
approved joint major after integration and device QA.

### 1L publication gate — complete

Capture/provenance commit `bf1fa793` is pushed. Full Frontend Tests and Linux visual comparison
pass in [38885478542](https://github.com/thecrateapp/crate/actions/runs/38885478542). Production
remains `2c90a6f2`; all 43 PNGs are byte-identical to 1K and the original manifest points at
that production commit. New 1M source remains uncommitted and does not alter those references.

### 1M local verification — 2026-10-16

- Shared full 746, Admin full 268, Desktop full 52, Cast receiver full 66 and Cast protocol
  full 20 pass. Listen full: 2,884 pass / four existing skips and one stale raw-input budget
  failure (the removed editor accounts for 10→8 inputs). Lowering that measured budget gives
  seven green focused policy/theme-color cases. Thus all current behaviour cases are covered;
  do not describe the earlier full Listen invocation as green. Suites run serially with two
  workers; seven Rust collector cases pass against the actual module in a temporary macOS harness.
- Appearance Chromium 41 pass; full WebKit 41 pass after test portability fixes. Five changed
  focus cases also pass in Chromium. Preview 41 pass; two final desktop/390px identity cases pass
  with complete advisory section images. Admin browser 21 pass. Listen browser: 43 pass / four
  existing skips; one mobile Smart EQ case was interrupted by a source-edit HMR reload and
  passes on an isolated replay with stable source. No assertion was disabled for that failure.
- WebKit was initially absent and then installed for the pinned Playwright version. Its first
  run exposed two legacy test assumptions: macOS Tab omits buttons while Alt+Tab includes them;
  forced colors work but `forced-color-adjust` is unsupported. An isolated browser probe confirmed
  both. Tests now use Alt+Tab only on WebKit/macOS and condition only the unsupported-property
  assertion on CSS support. Highlight, solid 2px outlines, focus order and clipping checks remain
  mandatory, with zero new skips and no change to the deferred 1D visual polish. Independent
  quality review approves the portability adjustment.
- Six workspace typechecks, three app lints, seven-locale i18n/metadata checks, generated token
  sync, Rust format (edition 2021), 49 tooling tests, all 15 drift metrics and shared layer policy
  pass (zero violations, 138 source files). Direct shadcn imports drop 96→95; lower that ceiling.
- Shared clean build, Admin/Listen/Cast receiver and preview builds pass. A clean shared output
  contains none of ThemeScope/appearance-types/appearance-resolver/theme-skin or the 1L removals.
  Initial JS gzip: Admin 516,837 B / 532,480 (+1,905 B from 1L), Listen 200,050 B / 307,200
  (−4,854 B); Cast receiver 71,083 B / 153,600. No ceiling increased.
- Separate independent specification and quality reviews find no material defects. All five
  canonical plan documents and scoped guidance record the shared identity/no app-level drift rule.
  Advisory images live at `tools/design-system-preview/.artifacts/checkpoint-1m-{desktop,mobile}.png`.
  All 43 canonical Linux PNGs and their original manifest remain unchanged from `bf1fa793`.

Next: Diego reviews `#identidad`. Publish 1M and retire/re-record the ten old variant PNGs only
after his approval. Hardware QA (Capacitor/status bars, Tauri/Linux buttons and Cast peers),
integration reconciliation and joint-major release gates remain open.

## 1M publication authorisation — 2026-10-16

Diego approved Checkpoint 1M and explicitly authorised commit/push, canonical Linux captures
and continuation with the next plan block (Task 1b.1). This supersedes the local-only review
stops above for 1M. Keep all later checkpoint publication gates. The ten obsolete skin/light PNGs
are removed explicitly now; 33 single-identity references will be re-recorded and reviewed in
the pinned Linux CI image. Rebase, PR, deployment and joint release remain separately gated.

### Checkpoint 1M — publication and Linux capture verification

Published and pushed as `21873d24997ca53ca3218c891a8d70fae296cc78`. Linux recording
[38888497469](https://github.com/thecrateapp/crate/actions/runs/38888497469) passes. Artifact
`12040079621` has verified SHA256 `4fdf97def687772a3830bb34671a79d944fc6530f498470b7743edef38940731`.
The original manifest identifies that production SHA, Linux x64 and the pinned Playwright
`v1.63.0-noble` image. Of 33 PNGs, 31 are byte-identical; only desktop/mobile Settings change
to the approved three functional preferences. Both changed images are reviewed and imported.
The ten obsolete skin/light captures were explicitly retired in the production commit.
Capture/provenance commit `297daaa1` is pushed. Full Frontend Tests and Linux visual comparison
pass in [38889352392](https://github.com/thecrateapp/crate/actions/runs/38889352392).
Next assigned task: 1b.1 / Checkpoint 1N, shared overlays/menus and one ConfirmDialog; preserve
its visual review/publication stop.

## Checkpoint 1N — Shared overlays (Task 1b.1, ready for visual review)

The persistent mockup extends `#capas`: actual AppModal, nested ConfirmDialog, Sheet,
DropdownMenu, Popover and Tooltip. Examples only change local sample state; no API or
localStorage writes. Keep all earlier approved specimens.

- Shared recipes implement DS §5.9: solid popover surface, 72% canvas scrim without blur,
  14 px panel radius, Bricolage title/MonoLabel eyebrow, quiet footer, 36/44 px menu items,
  neutral destructive entries and 400 ms tooltip delay. Custom modal widths and XL remain compatible.
- Admin's local ConfirmDialog and test retire. Actual inventory is 15 consumer files / 20
  instances; the old plan's 17 included implementation/barrel. All use the shared composite.
  Existing Admin callbacks return void so worker enqueue/polling keeps the legacy close behavior.
  Shared async confirmation remains guarded for Listen, including pending cancellation,
  rejection, focus restoration, exact typed confirmation and stale completions after reopening.
- WIPE/REBUILD require the exact word. All 20 Admin confirmations get a mono consequence line
  using existing names/counts/sizes/destinations only. REBUILD includes health check, repair,
  sync and enrichment; only WIPE promises that files remain on disk. No new reads/writes added.
- Listen callers adopt the common eyebrow in seven locales. Localized domain consequence copy
  remains explicit work for their page/domain migrations; do not claim all Listen consequences
  are migrated. EQ glass remains reserved for Task 4.2. The broad Admin icon/status migrations
  remain Tasks 1b.8/1b.6.
- Diego's review corrections: one OverlayCloseButton base supplies the same 40 px control,
  24 px icon, transparent hover and keyboard focus to AppModal, ConfirmDialog and Radix Dialog/Sheet.
  Built-in closes are anchored to the panel's top-right corner,
  inset 16 px, with title space reserved (also on mobile with the grabber). The sample input
  uses existing FormField with 8 px label/control spacing. Eight legacy glass overrides and three
  local scrims retire from Listen AppModal consumers; two local border-0 overrides also retire.
  Full form restyling remains 1b.2.
- Measured drift: arbitrary utilities 53→48; definitions 138→139 and foundation 95→96 for the
  planned scrim token (utility aliases normalize to the same token). Direct shadcn imports
  95→98: one existing Input import for typed confirmation and two imports of the new shared
  OverlayCloseButton base from AppModal/ConfirmDialog. These are internal foundation consumers;
  no app-local duplicate is added. The base is also composed by Radix Dialog/Sheet via asChild.

Focused local verification and independent SPEC/QUALITY reviews pass as detailed below.
Canonical 33 Linux PNGs and the original 1M manifest remain unchanged. Stop at Diego's review before committing/pushing 1N;
new Linux recording follows that approval. Rebase, PR, deployment and release remain gated.

### Development test policy — Diego, 2026-10-16

During development run only suites scoped to changed behavior and affected consumers.
Run full validation once after development or the phase is complete; do not repeat global
suites during iteration. The two broad validation chains still active at this instruction
were stopped (Listen full incomplete, Desktop not started; pending broad Admin browser also
cancelled). Earlier completed results remain historical evidence, not a current full green run.
Continue 1N with focused dialog/action/menu/consumer cases and two preview geometry cases.

### 1N focused verification — 2026-10-16

- Shared: 145 cases in the 11 affected overlay/action/runtime recipe files pass. Ten close
  component/conditional-header cases pass again after correcting Testing Library query types;
  these are a subset of the 145, not additional coverage counts.
- Listen: 174 cases in 15 affected consumer files pass, plus all four component-policy cases
  including the new guard against local modal glass/scrims (178 total). Admin: 55 cases in
  12 affected consumers pass. No worker/API behavior is changed by consequence copy.
- Preview: both desktop/390 px overlay cases pass on final production source. They cover
  modal/confirmation/Sheet close size and transparent hover, corner geometry and title space,
  long Sheet titles, label gap, keyboard/stacked focus, exact confirmation, pending/reset and
  the absence of overflow or API/localStorage writes.
- Admin browser: Command Palette and desktop WIPE/REBUILD pass. The first two mobile cases
  stopped in the fixture before opening a dialog because it required a desktop sidebar. The
  readiness assertion now matches Shell's real md breakpoint and exact visible navigation
  control; the two mobile cases pass on scoped replay. No assertion was skipped or weakened.
  Independent quality review approves that fixture adjustment.
- Shared/Listen typechecks and Admin production compilation/build pass. ESLint passes on all
  changed Admin (17) and Listen (31) TS/TSX files; locale metadata check reports zero errors or
  warnings. Preview production build passes. Admin initial gzip JS is 515,428 B / 532,480
  (−1,409 B versus published 1M). No bundle ceiling increased.
- The focused repository drift-budget check passes all 15 metrics; layer boundaries have zero
  violations across 139 source files. Updated ceilings reflect the measured 48 arbitrary
  utilities, 139 definitions / 96 foundation definitions and 98 internal shadcn imports.
- Advisory section/modal/confirmation/Sheet images are refreshed in the preview's ignored
  `.artifacts/checkpoint-1n-*.png`; desktop/mobile dialogs and confirmation were inspected.
  All 33 canonical Linux PNGs and their original manifest remain unchanged.

Global suites remain for the single validation run at development/phase close under Diego's
new test policy. Earlier completed global runs predate the latest review corrections; the
interrupted Listen full run is not a green result. Native QA and 1N Linux recording remain
pending. Diego reviews `#capas`; preserve its publication checkpoint. The later 1O section
records the authorised local continuation without assuming approval to publish 1N.

## Checkpoint 1O — Form foundations (Task 1b.2, local review)

Diego asked to continue and to run the preview while he reviews. Continue local work without
assuming publication approval for 1N. Its full review source, including new files, is saved
in ignored `tools/design-system-preview/.artifacts/checkpoint-1n-source.patch` with SHA256
`6567cdff369e250e817513d48f6cb35b735baac5ec29c3806ca05bf521b68749`. It can be staged separately
when authorised. Neither checkpoint is committed/pushed yet.

- 1O covers Input, Textarea, Select, Switch, Checkbox, SearchInput, FormField, SegmentedControl
  and AdminSelect. Consolidate Admin's duplicate (35 usages / ten consumer files) into the
  shared composite; restyling only shared would leave all actual Admin callers unchanged.
- Preserve APIs, keyboard, indeterminate, refs, debounce and immediate clear. Validation remains
  caller-owned, shown on blur in the preview. Use warning StatusDot and accessible error links,
  never red field borders. Keep iOS's functional 16 px input font exception. The existing
  `rounded-lg` token is already 6 px; no new radius token is needed.
- RadioGroup remains physically tracked but unused. Leave implementation/test alone; correct
  the allowlist's inaccurate claim that shadcn dropdown-menu consumes it (it uses Radix directly).
- 1P follows with 28 fixed short selects (22 Admin, six effective Listen) and six SegmentedControl
  caller reviews. Admin has two fixed large 15-option field selectors and 17 dynamic controls;
  do not convert dynamic sources based on their current fixture length. The new-short-select
  policy and DS Radio seed debounce remain explicit 1b.2 work. Keep tab semantics for panel
  switchers until the Task 1b.3/page migration, rather than treating every group as a filter.
- Preview: `#formularios`, real shared controls and local sample state only. Keep `#capas` and
  earlier approved specimens. Only focused tests run during development; global validation
  remains for development/phase close.

The foundations use shared 40/44 px controls, existing 6 px field radius, MonoLabel with an
8 px gap, mono helpers, warning-dot errors and common keyboard focus. Switch/Checkbox retain
small visual geometry with 44 px coarse-pointer hit areas; inline margins reserve those areas
without horizontal overflow. Explicit mono code fields keep their font. Typed ConfirmDialog
confirmation now composes FormField so it cannot retain a separate label recipe.

Both AdminSelect variants expose a stable accessible field name; empty-valued real options
stay distinct from the clear sentinel. Search keeps the caret's Home/End behavior, selects
the first filtered result on Enter, does nothing on an empty result, and ignores IME key
events (including Safari keyCode 229) until composition ends. Counts preserve zero/string
values as plain mono metadata. No API calls, validation ownership or persistence change.

Independent SPEC and final QUALITY reviews pass. The responsive preview heading is stacked
on mobile with a measured gap; controls and headings remain within their section. Advisory
images use ignored `checkpoint-1o-{desktop,mobile}.png`. Canonical 33 Linux PNGs and the 1M
manifest remain unchanged. New Linux recording follows publication approval; 1P is not started.

### 1O focused verification — 2026-10-16

- Shared: the initial 65-case batch across the 11 affected form/recipe/policy files passes.
  The final selector/recipe/export subset covers 19 cases (13 AdminSelect, five CSS, one
  export policy). Two cases timed out or inherited unfinished input during overlapping local
  checks; only those two were replayed serially, passing on unchanged production source.
  The 39-case ConfirmDialog/FormField/recipe subset also passes. These overlapping batches
  are not additive coverage totals. IME tests reproduced the lost focus before the fix.
- Listen: 24 focused cases across Login, SettingsPrimitives, CrateEditor, PlayerSurfaceModeSwitch,
  VisualizerSettingsPanel and radius policy pass. The two player tests now assert the shared
  chip/thumb contract rather than retired styling literals; their behavior assertions remain.
- Admin: ten focused cases across Browse, Settings, Users, PlaylistEditor and the AdminSelect
  re-export pass. Browse retains both filter-request assertions while querying the new
  combobox/option semantics. Local jsdom polyfills are installed only if missing and restored.
- Browser: the final 390 px touch case passes; the desktop case hit the 30 s deadline during
  overlapping checks and passes in 8.7 s on serial replay. No timeout or assertion was relaxed.
  They cover field geometry/surfaces, label gaps, blur validation, keyboard focus, selectors,
  debounce/clear, hit areas, responsive heading and no overflow/API/localStorage writes.
  The two 1N overlay cases also passed after the typed field adopted FormField.
- Shared, Admin, Listen and Desktop typechecks pass. Scoped Shared/Listen and Admin ESLint,
  preview production build, the one repository drift-budget case and layer boundaries pass.
  Layer inventory remains 139 source files / zero violations. Direct shadcn imports are 99
  (one additional internal Select composition); other ceilings are not raised. A foreground
  role violation was fixed through the existing canvas-coloured `--text-on-contrast` alias.
- Final desktop/mobile advisory section images are copied to the preview's ignored `.artifacts/`
  and inspected. The 1N source snapshot checksum is unchanged. No commits, pushes, canonical
  PNG/manifest changes, full suites or Linux recording were performed for 1O.

Keep validation chains serial while Diego reviews the live preview; run only affected files
or cases. Full validation remains the single run at development/phase close. Next step is
Diego's review of the local checkpoints; preserve 1P as the next separate implementation block.

## Checkpoints 1N–1P — final publication cut and Linux transfer, 2026-10-16

Diego explicitly requested finishing the next cut through commit/push, then supplying a detailed
prompt for a Linux Codex agent without a local branch/worktree. This authorises publication of
the combined 1N–1P cut, including his global label-spacing correction, and supersedes the older
local-only stops above. The checkpoint commit is identified by
`feat(ui): unify v3 overlays, controls and field spacing`; use `git log` to resolve its SHA.
The transfer prompt supplies the exact published SHA. Rebase, PR, deploy and release are not
part of this authorisation. Keep later visual review stops.

### 1P behavior and global form geometry

- Task 1b.2 is complete. Migrate 28 fixed short choices to shared radio chips: 22 Admin and six
  effective Listen controls. Preserve URL/filter values, genuine empty options, clear behavior,
  disabled/fieldset states, rule value resets and Jam Auto DJ permanence. Keep 17 dynamic
  selectors and two fixed 15-option field lists as Select; the new source policy checks both
  apps with exact, reasoned dynamic exceptions, including wrapper callers and lexical aliases.
- Review the six existing SegmentedControl callers. Filters and Player view modes are radios;
  genuine Library/ExtendedPlayer panels retain tab semantics for the next task. Remove local
  styling overrides and reserve 44 × 44 px coarse-pointer targets, including icon-only chips.
- Stable rule-row identity fixes keyboard focus loss while changing an operator in PlaylistEditor
  and Playlists. Regression cases reproduce the loss before the fix and verify two consecutive
  arrow changes, value reset and the final request payload after it.
- Radio seed search waits 300 ms, clears immediately below two characters, cancels queued work
  on edits/seed selection/unmount and ignores obsolete responses. Existing dispatched requests
  are not aborted; each completed search retains the two existing endpoints.
- Diego requires one standard gap for every stacked label/control pair. `.crate-form-field`
  owns an actual 8 px grid gap throughout Listen/Admin, including legacy auth, profile, metadata,
  search, read-only values, sliders and chip groups. The final global sweep changes 35 production
  files (20 Admin / 15 Listen) and removes seven local FormField gap overrides. Horizontal rows
  preserve their layout with an 8 px vertical gap when wrapping. Section headings and result
  lists retain their separate rhythm; two Setup heading margins were restored after review.
- The persistent `#seleccion` sample uses actual CrateForm, Jam playback options and Player view
  mode with isolated Spanish translations and sample state. It preserves `#formularios`, `#capas`
  and all earlier checkpoints. No API or localStorage writes occur in these samples.

### Final focused validation and limits

All chains ran serially with one test/browser worker; no full suite or new CI workflow ran.
Earlier 1N/1O records remain historical coverage; overlapping batches are not additive totals.

- Shared: 22 cases / three affected recipe, FormField and SegmentedControl files pass after the
  global spacing correction. Earlier 1P selector/policy/controller cases pass, including seven
  short-select policy cases and 11 Radio controller cases.
- Listen: 38 cases / 11 affected files pass: VisualizerSettingsPanel, AccountSectionForms,
  InterfacePreferencesSection, SettingsPrimitives, ShowsLocationControls, TranslationOverlay,
  Login, Paths, Radio, Register and the short-select policy.
- Admin: 74 cases / 17 affected files pass: TrackTable, ArtistBioResearchDialog,
  ArtistHeroArtworkEditor, ArtistMetadataEditor, GenreTaxonomyTree, Sidebar, Album, Artist,
  Browse, Genres, I18nReview, Login, PlaylistEditor, Playlists, Settings, Tasks and Users.
- Browser: six final cases pass at 1440/390 px: 1M identity, 1O forms and 1P selection in both
  layouts. They measure 8 px label/control geometry for fields, searches and chip groups and
  retain keyboard, validation, clear, coarse hit-target, overflow and no-external-write checks.
  Ignored desktop/mobile advisory PNGs are refreshed; they are not canonical references.
- Shared/Admin/Listen/Desktop typechecks, 100 scoped Shared/Listen and 34 scoped Admin ESLint
  files, both app production builds/bundle gates and preview build pass. Listen i18n: six
  locales, zero errors/warnings. Shared layers: 139 source files, zero violations. Drift checks
  pass; ceilings tighten to 96 direct shadcn imports and 22 one-shot tokens, with none raised.
- Admin initial JS: **526,386 B gzip / 532,480 B ceiling** (about 514 / 520 KiB), leaving only
  6,094 B. Keep this small headroom visible during subsequent shared imports. Listen initial JS:
  **200,232 B / 307,200 B**. Existing large-chunk warnings remain; both gates pass.
- Independent final SPEC and QUALITY reviews pass, including the global spacing sweep and
  restored Setup section spacing. No dependency/lockfile or canonical PNG/manifest changes.

Canonical references remain the 33 PNGs and original 1M manifest from `297daaa1`; the green
comparison `38889352392` is historical, not proof of current 1N–1P parity. New approved Linux CI
recording/comparison and native QA remain pending. Never regenerate those references locally or
fabricate provenance. Full validation remains the single run at development/phase close.

Continue with **Task 1b.3 / checkpoint 1Q**, text tabs and app-local URL helpers. Bootstrap,
reading order, preview, focused verification, site pin and future review boundaries are in
[`2026-10-16-crate-v3-linux-handover.md`](2026-10-16-crate-v3-linux-handover.md).


## Checkpoint 1Q — Text tabs and URL helpers, Linux local review, 2026-10-16

**Stop for Diego's review at <http://127.0.0.1:5186/#pestanas>.** No commit/push, later task,
PR, merge/rebase, deployment, release or CI run has been performed for 1Q. HEAD remains
`53177736a7643c232cbb19e744a2b2ee9077efaf`. The work is uncommitted in the managed worktree
`/home/diego/.codex/worktrees/crate-v3-1q/crate`, on existing `feat/crate_v3`. The other agent's
MCP checkout remains separate. Node 22.23.3 and root `npm ci` are ready; the persistent preview
is live on loopback :5186 without a backend. All earlier specimens remain on the same page.

### Scope and contracts

- Shared `Tabs` retains Radix props, ARIA relationships, roving focus, disabled items,
  controlled/uncontrolled state, manual activation, orientation and `default`/`line` exports.
  Both variants use one recipe: Mono 11.5 px / .14em uppercase, transparent surfaces,
  a 2 px `accent-action-hi` active underline, 44 px targets and horizontal mobile scrolling.
  Vertical keyboard behavior remains supported. The scroll row uses the existing inset
  focus treatment, including its animated shadow; forced colors use a visible system marker.
- Inventory confirms Admin Download is the only production consumer of shared Tabs today.
  Its actual five panels have a keyboard regression test. No production page adopts a new
  URL helper in this checkpoint. Library's existing `/collection/:section` and `?tab=`
  adapters, player panel semantics and filter radio groups remain for their planned phases.
- Separate app-local hooks expose `useTabParam(values, defaultValue, { param?, replace? })`
  returning readonly `[tab, setTab]`. Missing/unknown values show the fallback without
  rewriting links; invalid writes are ignored. Valid writes push history by default,
  explicit replacement is supported, and writing the current raw value is a no-op.
  Other/repeated query parameters, path, hash, route state and scroll survive.
- `#pestanas` uses both actual helpers, with `tab` and a sample-only `listenTab`, direct/unknown
  links and previous/next controls. Browser history works. The sample uses no API or storage
  writes and keeps the 8 px label/read-only URL gap through `.crate-form-field`.

### Focused verification and limits

All validation chains use one test/browser worker and run serially. No full suite runs.
The final focused batches pass: **Shared 18 cases / five files; Admin 11 / two files;
Listen 10 / one file** (39 total). They cover shared tabs, form/focus recipes, design/export
policies, each real app-local router helper and actual Download panel behavior.

**Three Chromium browser cases pass:** desktop 1440 px, mobile/touch 390 px, and forced colors
with reduced motion. They verify typography, physical underline, hit targets, horizontal row,
ARIA/panel selection, disabled skipping, arrows/Home/End, deep links, unknown values, parameter
preservation, back/forward, global inset focus, 8 px URL label spacing, responsive heading,
no document overflow and no sample API/storage writes. The third test waits for the committed
selected tab before reading the pseudo-element; a transient pre-navigation read was corrected.
The mobile heading defect was reproduced before stacking it; the focus-offset defect was
reproduced at both sizes before applying `crate-focus-inset`.

Shared, Admin, Listen and Desktop typechecks pass. The new preview component/spec also pass
standalone strict TypeScript checking. Scoped ESLint (nine changed TS/TSX files), formatting,
Admin production build/bundle gate, preview production build, the one repository drift-budget
case and shared layer check pass. Layers remain 139 source files / zero violations; no budget
or ceiling is raised. Build warnings about existing large chunks remain.

Final Admin initial JavaScript is **527,332 B gzip / 532,480 B**, leaving **5,148 B**;
the previous published handover recorded 526,386 B. No dependencies, lockfile or package exports
change. Listen production bundling was not repeated: no production Listen consumer imports
the new hook/Tabs yet; its typecheck and focused hook cases pass. Desktop runtime tests were
not expanded for an unadopted hook; its typecheck passes.

An independent read-only source review found one P2: the scroll row could clip the outer
keyboard outline. The regression failed at both widths, then passed with the shared inset
focus class; the related focus CSS cases pass. No other actionable source findings were
reported. The reviewer did not execute tests or inspect final documentation/mobile rendering;
the integrator ran the checks above and inspected the final desktop/mobile advisory images.

Advisory screenshots are ignored under `.artifacts/design-system-preview/` as
`checkpoint-1q-{1440,390}.png`; they are not baselines. All **33 canonical Linux PNGs and the
original 1M manifest are unchanged**. Approved CI recording/comparison for 1N–1P, native QA,
1Q's visual approval and the single full validation at development/phase close remain pending.
Do not advance to Task 1b.4 or publish 1Q until Diego directs continuation.


### Checkpoint 1Q approval and publication authorisation — 2026-10-16

Diego approved 1Q and explicitly requested commit/push, continuation to Task 1b.4,
keeping the preview active and stopping at the next visual checkpoint (1R) for review.
This supersedes the local-only stops above. Publish the reviewed 1Q diff as
`feat(ui): add text tabs that keep their state in the URL`; resolve its SHA with git log.
No PR, merge/rebase, deploy, release, full validation or baseline/CI update is authorised.
The next block covers shared loading/empty/error states and reserved skeleton geometry.
Canonical 33 PNGs/1M manifest, pending Linux recording/comparison and native QA remain unchanged.


### Checkpoint 1Q publication — 2026-10-16

The approved cut is committed and pushed as **`e863c22715de39b974fc1cf527003fc498d59215`**
(`feat(ui): add text tabs that keep their state in the URL`). A fresh scoped replay passed
39 Vitest cases and three Chromium cases before commit. `origin/feat/crate_v3` was fetched,
then verified to equal the published SHA after push. The frontend workflow only auto-runs on
pushes to `main`; no full CI workflow or canonical recording was dispatched for this iteration.
Continue locally with Task 1b.4 / checkpoint 1R and preserve its review/publication stop.


## Checkpoint 1R — Shared states, Linux local review, 2026-10-16

**Stop for Diego's review at <http://127.0.0.1:5186/#estados>.** Task 1b.4 is local and
uncommitted on `feat/crate_v3` in `/home/diego/.codex/worktrees/crate-v3-1q/crate`. Published
HEAD and `origin/feat/crate_v3` remain **`e863c22715de39b974fc1cf527003fc498d59215`** (1Q),
verified with `git ls-remote` after this block. Diego approved the page error identifier's
placement beside the eyebrow/code; that feedback does not approve the entire 1R checkpoint.
Do not commit/push 1R or advance to 1b.5 before his direction.

### Scope and contracts

- Shared `LoadingState` sections reserve a caller-supplied final layout with static `—`
  readings. Route/page/screen aliases show a MonoLabel and 120 px ProgressHairline after
  200 ms, cancelling the timer on unmount. Named live regions contain actual loading text;
  decorative placeholders are hidden and no permanent `aria-busy` suppresses announcements.
  Deprecated phrase props remain type-compatible but no longer cycle marketing copy.
- Empty states use one inline text recipe; panel/dashed/icon props remain compatibility
  aliases. Errors share compact/page recipes, retain Retry/Back/custom actions and name
  themselves through ARIA. Compact display titles are 20 px; page titles are 40 px / 800.
  The page warning dot accompanies the eyebrow/code, leaving the large heading clear,
  following Diego's correction and approval of that placement.
- Card/Grid/TableSkeleton and the base Skeleton are static. Tables reserve 32 px headers and
  44 px rows. Grid variants match album padding, capped/fill artist circles and station
  covers. Actual MediaGrid/MediaRail and placeholders share their unchanged column/rail
  class recipes through internal `lib/media-layout`, preserving layer boundaries.
- Two Admin PageSpinner definitions/four callsites and both Listen shell fallbacks use the
  shared route indicator. Admin auth/capability denial screens use shared page errors with
  existing access checks, callbacks, copy and redirects preserved. Three Admin skeleton
  subpaths re-export the shared composites; their duplicate implementations and the dead
  local ErrorState are removed. Barrel/compatibility imports have consumer tests.
- Listen Library Albums/Artists reserve the actual default grid, media shape and mobile
  40 px sort row, using dash readings for unavailable sort fields. Home's artist rail,
  Radio's station rail and user-connection rows reserve the corresponding current shapes.
  Generic section fallbacks remain for complex unmigrated layouts; their exact multi-section
  composition and direct CrateLoader users belong to their page phases. PD50 retirement is
  complete for these foundation/route files, not claimed globally.
- The persistent `#estados` specimen uses real components, manual loading/warming/ready/stale/
  error/empty/offline states and local Retry/Back actions. Initial loading and ready share
  the same reading geometry; stale/error/retry/offline preserve the last sample data.
  Loading/empty omit the header status. Actual artist/album cards sit beside placeholders
  for geometry comparison. All prior checkpoint specimens remain; no API/storage writes.

### Focused verification and limits

Serial final batches pass with Vitest `--maxWorkers=1`: **Shared 60 cases / seven files;
Admin 26 / seven files; Listen 223 / sixteen files** (309 total). The last Library sort-row
change was replayed separately: all four cases pass. No full suites were run. Coverage
includes affected callers, auth/redirect behavior, compatibility imports, ARIA names,
route delay/cancellation, no spinner/shimmer and retained grid/rail/row layout contracts.

**Three Chromium cases pass**, using Playwright `--workers=1`: desktop 1440 px, touch/mobile
390 px and the exact 200 ms delayed route indicator with reduced motion. They measure current
artist/album card versus placeholder geometry, 32/44 px table geometry, 8 px field spacing,
120 px progress width, stable reading space, typography, identifier placement, retry/offline
behavior, keyboard activation, no overflow and no sample API/storage writes. Advisory PNGs
are ignored beneath `.artifacts/design-system-preview/`; they are not canonical baselines.

Shared/Admin/Listen/Desktop typechecks and standalone strict preview/spec TypeScript pass.
Scoped ESLint, formatting, preview build and both app production builds/bundle gates pass.
Shared layers: **140 source files, zero violations**. The drift inventory case passes with
its unchanged ceilings. A final gate caught two upward composite-to-domain imports; extracting
existing media layout recipes into the lower lib layer resolved them. Two new direct shadcn
imports for sort placeholders exceeded the drift ceiling; those unavailable readings now use
static dashes, as specified, keeping the ceiling at 96. No ceiling or dependency was raised.

Admin initial JavaScript: **529,065 B gzip / 532,480 B**, leaving **3,415 B** (1Q: 527,332 B).
Listen: **199,908 B / 307,200 B**. Existing large-chunk warnings remain; both gates pass.
No dependency/lockfile/package export changes. Generated Admin tsbuildinfo is excluded.

Independent read-only review identified five actionable issues: permanent busy flags, compact
18 px display text, media/sort-row geometry, a loading-only specimen table and loading/empty
header statuses. Each was addressed with focused regression evidence in one fix pass. The
reviewer did not run tests, inspect the final rendering or validate native/screen-reader output;
the integrator ran the checks above and inspected advisory renders.

During review the IAB tab became blank after a cached Vite HMR export error. Loopback still
returned HTTP 200. The preview was restarted with `--force`, the existing tab reloaded and
actual rendered content verified; the final browser replay passes. Keep the current Node 22
preview process alive on :5186 for Diego. On a future similar blank tab, inspect browser/server
logs and clear the dev-module cache instead of assuming an HTTP 200 proves rendering.

All **33 canonical PNGs and the original 1M manifest remain unchanged**. Canonical Linux
recording/comparison for 1N–1P and later changes, native QA, actual assistive-technology QA and
the single full validation at development/phase close remain pending. No canonical recording,
full CI, PR, merge/rebase, deployment, release or 1R publication was performed.


### Checkpoint 1R approval and publication authorisation — 2026-10-16

Diego approved the complete 1R checkpoint and explicitly requested commit/push, continuation
to Task 1b.5, keeping the preview active and stopping at the next checkpoint (1S) for review.
This supersedes the local-only publication stops above. Publish the reviewed 1R changes as
`feat(ui): one set of loading, empty and error states`; resolve its SHA from git log.
No PR, merge/rebase, deploy, release, full suite/CI or canonical baseline update is authorised.


### Checkpoint 1R publication — 2026-10-16

Approved 1R is committed and pushed as **`093dcb1fbfe67d1f994ee49e27aefd802d258c54`**
(`feat(ui): one set of loading, empty and error states`). Fresh serial scoped validation
passed 309 Vitest and three Chromium cases before commit; `git ls-remote` verifies the remote
branch at this SHA. Continue locally with Task1b.5 / checkpoint1S, keeping :5186 alive and
stopping for Diego's review before another publication. No full suite/CI or baseline update.


## Checkpoint 1S — Track rows, media and retained playback identity, local review, 2026-10-16

Approved 1R is published as `093dcb1fbfe67d1f994ee49e27aefd802d258c54`. Task 1b.5 / 1S
is local in the same isolated Linux worktree and existing `feat/crate_v3` branch. The MCP
checkout is untouched. Preview: <http://127.0.0.1:5186/#pistas>. Stop for Diego's visual
review before 1S commit/push or Task 1b.6. This final record supersedes earlier local-only
1R status and the initial interpretation that removed row progress/glow.

### Scope and review amendments

- Shared TrackList/MediaGrid retain their item/virtualization contracts, with continuous hairlines
  and grid minima that fit narrow containers. MediaCover uses mono initials on the accent wash,
  retains explicit fallbacks and image retry/reset behavior, and gets an inset hairline.
  EntityCard supplies 14/500 titles and 10.5 px mono metadata, with no cover lift/scale/shadow.
  Shared PlayButton overlays retain the 40 px accent disc and 44 px coarse hit area.
- Listen's actual TrackRowContent and PlaybackControl are reused by production and the persistent
  specimen. Existing selection, row/keyboard playback, menus, likes, queue data and duration remain.
  The active row has a 2 px bar and accent-hi title. Supplied BPM/key, quality, explicit and remote
  provenance use mono metadata; absent data is omitted. Camelot follows the existing bliss mapping,
  with unknown/partial keys preserved. The stale provenance ring precedes text so ellipsis cannot
  hide it. New Listen strings are present in all seven catalogs.
- Diego explicitly retained the current Listen play's essence: halo, layers and advancing ring.
  The original visual structure now uses V3 tokens and a 2 px ring. Only the active progress leaf
  subscribes to `usePlayerProgress`; rows/lists and duration do not subscribe to ticks. He also
  retained the current player's luminous seek trail, narrowed to 2 px (thin 1 px). The real
  horizontal GlowSeekBar keeps native keyboard seeking, scrubbing and disabled/Jam behavior,
  with 40/44 px fine/coarse interaction areas. Its existing local CSS is extracted for production
  and preview reuse. Motion/effects preferences retain position while suppressing animation/glow.
  This is a scoped amendment, not a redesign of every player surface.
- Existing artist circles, artwork auth/retries/srcset, offline/pre-release behavior and card
  controllers remain. Album/artist fallbacks adopt the identity; editorial artist titles also use
  the shared scale. Admin TrackTable remains a real management table with its existing permissions,
  mutations, lyrics/download/retry and analysis popovers. It has no player capability to invent.
  Shared table geometry supplies a sticky canvas header, tabular right-aligned numeric cells and
  comparison-column reductions at 1000/760 px. Later global Admin icon/status work is still pending.
- Read-only review found collapsed narrow-row titles and 40 px coarse tablet card menus. Chromium
  reproduced both before fixes. Container queries yield quality/analysis/provenance at 480/620/800 px,
  and all card menu targets reach 44 px. The explicit DS numeric-alignment requirement was completed
  with a failing-then-passing regression. No second review or broader page migration was requested.

### Focused verification and limits

Serial Vitest `--maxWorkers=1` passes **Shared 99 / eight files, Admin 5 / two files and
Listen 239 / seventeen files**, with **four existing Listen skips** (343 passed, four skipped).
The final Listen batch includes TrackRow, AlbumCard, ArtistCard, data mapping, QueueTrackRow,
QueuePanel, PlaylistTrackList, affected Album/Artist/Library pages, catalogs/policies and
PlayerSeekBar/ExtendedPlayer/FullscreenPlayer/PlayerBar. The four documented TEST_GAP skips
cover native/gesture/real-animation behavior; they are not counted as passing. No full suite ran.

**Ten Chromium cases pass**, serial `--workers=1`: seven for 1S plus the three affected 1R state
cases. They measure 1440/390 px geometry, narrow 300/360 px row containers, 1024 px touch menus,
14/500 and 10.5 px typography, 8 px field spacing, 1–2 px seek tracks/2 px active bar, advancing
and paused ring/seek position, keyboard scrubbing, reduced motion/effects-off, stable height,
cover hairline/initials, numeric/sticky tables, column thresholds and no overflow/API/storage writes.
One coarse-menu lookup timed out once during iteration; its isolated replay and the final serial
replay pass. Advisory PNGs and the IAB review image are ignored local evidence, not baselines.

Shared/Admin/Listen/Desktop typechecks pass. Strict preview sources and the affected 1R/1S browser
specs pass with the apps' ambient declarations. Scoped ESLint and formatting pass. Shared layers:
**141 source files, zero violations**; all **15 drift metrics** remain within unchanged ceilings.
A semantic-role gate caught the new glyph foreground using a surface role; the existing
`accent-action-foreground` fixes it without raising a ceiling. The organic-radius exception moves
with the retained play view; no new exemption or dependency is added. Listen i18n reports no errors
or warnings. Preview and both app production builds/bundle gates pass; existing chunk warnings remain.

Admin initial JavaScript: **529,065 B gzip / 532,480 B** (unchanged; **3,415 B** headroom).
Listen: **199,899 B / 307,200 B**. No lockfile/package/export changes. Generated Admin tsbuildinfo
is excluded. Keep the Node 22 preview process alive on :5186 for Diego's review.

Pinned `app/web` object **258bbaee** is unavailable locally even after fetching feat/website;
GitHub commit lookup returns 422. The pin is preserved and no current website/vnext substitute
was used. This implementation follows the explicit DS contracts; pixel fidelity against that
object remains unverified. Actual backend/audio/remote/offline/native execution and assistive-
technology QA remain integration/device work; focused mocks and browser geometry do not certify it.

All **33 canonical PNGs and the original 1M manifest are unchanged**. Linux recording/comparison
for 1N–1P and later changes, native QA and the single full validation at phase/development close
remain pending. No full CI, canonical baseline regeneration, 1S publication, PR, merge/rebase,
Smart Mix integration, deployment or release was performed. Await Diego at 1S.


### 1S review follow-up — keep seek head attached, 2026-10-16

Diego reported the progress head moving separately from the beam. The beam interpolated its
transform for 150 ms; both idle/hover heads jumped to the target left position immediately.
The scoped CSS correction shares duration/easing through `motion-duration-fast` and suppresses
movement on all three under reduced motion. No player/controller/public-prop or stroke change.
The same recipe fixes both PlayerSeekBar and the existing desktop PlayerBarProgress consumer.

Two Chromium regressions first reproduced detached heads at 1440/390 px, then passed with the
fix. They sample actual beam/trail endpoints and both head centres at 0/30/75/120/150 ms during
forward/backward seeks, real pointer dragging and live demo ticks; separation stays below 0.75 px.
The final affected 1S browser file passes all **nine cases** with one worker. This supersedes its
previous seven-case count; unrelated 1R cases were not rerun for this local CSS correction.

Fresh scoped verification also passes **31 Vitest cases in PlayerSeekBar/PlayerBar**, serial
`--maxWorkers=1`, strict preview/spec types, formatting, all 15 drift metrics and Listen production
build/budget. Listen remains **199,899 B gzip / 307,200 B**; no Admin JavaScript/import changed.
The existing large-chunk warning remains. Preview rendering is verified and stays active on :5186;
local evidence is ignored at `.artifacts/review/checkpoint-1s-attached-head.png`.

1S remains local for Diego's review: no commit/push or 1b.6 advancement. Canonical references,
the unavailable site pin, native/assistive-technology QA and phase-close validation retain the
limits above. No full suite, canonical recording or CI run was triggered.


### Latest 1S review correction — common edge, smaller point, 2026-10-16

This supersedes the equal-duration/easing correction above. Diego still observed detachment during
continuous dragging, clarifying that the beam moved before the point. He also requested a smaller
point and a proportionate beam. Natural rAF observations reproduced over 123 px separation on the
390 px specimen. The earlier regression paused each animation and set its time independently,
which concealed divergence during real retargeting; that test is replaced, not retained as proof.

A new app-local pure `PlayerProgressBeam` renders one absolute moving edge shared by the fill,
trail and idle/engaged heads. Both PlayerSeekBar and desktop PlayerBarProgress use it. Only that
common width animates; neither point has independent positional animation. No per-frame React
state or new playback subscription is introduced. The point is **4 px idle / 6 px engaged**;
the glow envelope is **8 px** with a 2 px blur and smaller head halo, while core strokes remain
**2 px / thin 1 px**. Native range/desktop slider controllers, keyboard, scrubbing, Jam locks,
40/44 px hit areas and motion/effects preferences remain. Unused independent left/scale styles
and model fields retire. Inline-style drift ceiling tightens **88 → 86**, with no raised metric.

The two new regressions sample untouched animation frames throughout uninterrupted, reversing
pointer drags, keyboard seeks and live demo ticks at 1440/390 px. No pause/currentTime/finish calls
are used. Rendered head centres stay within 0.75 px of the beam endpoint in both axes. Sizes are
also measured. The IAB preview was exercised with real forward/backward drags and retained for
Diego; local image: `.artifacts/review/checkpoint-1s-common-beam.png`.

Fresh serial checks pass **95 Vitest cases / six affected files**, with the same **four existing
TEST_GAP skips**, plus **nine Chromium cases** in the affected 1S file. Strict preview/spec types,
scoped ESLint, formatting, all 15 drift metrics, Listen production build/budget and preview build
pass. A long batched process was interrupted during production build; the standalone build replay
passes and is the final build evidence. Existing large-chunk warnings remain.

Listen initial JavaScript is **199,922 B gzip / 307,200 B** (23 B above the preceding correction).
No Admin import/JavaScript change; its last verified 529,065 B / 532,480 B and 3,415 B headroom stand.
No full suite or CI, canonical baseline update, publication or advance beyond 1S. The unavailable
site pin, canonical/native/assistive-technology QA and phase-close validation limits remain.


### Checkpoint 1S approval and publication authorisation — 2026-10-16

Diego approved the complete 1S checkpoint, including the final common-edge progress correction
and smaller point/beam. He explicitly authorised commit/push and continuation to Task 1b.6,
keeping :5186 active and stopping for the next review at 1T. This supersedes all local-only
1S stops above. Publish as `feat(ui): restyle track rows and media grids`; record the resulting
SHA after publication. No full suite/CI, baseline regeneration, PR, merge/rebase, deploy or release.


### Checkpoint 1S publication — 2026-10-16

Approved 1S is committed/pushed as **`124b36a83a51da46dea137b9b84c00d07060ebd6`**
(`feat(ui): restyle track rows and media grids`). Fresh critical consumer replay passes
31 Vitest and nine Chromium cases before publication; remote SHA verified. Continue locally
with Task 1b.6 / checkpoint 1T, preserving the preview and stopping before publication or 1b.7.
No full suite/CI, baseline recording, PR, merge/rebase, deployment or release was performed.


## Checkpoint 1T — Admin status colour, Linux local review, 2026-10-16

Diego approved complete 1S and authorised commit/push plus Task 1b.6. 1S is published as
`124b36a83a51da46dea137b9b84c00d07060ebd6`; origin was verified at that exact SHA. **1T remains
local and uncommitted**, awaiting Diego at <http://127.0.0.1:5186/#estado-admin>. Stop before
publication or Task 1b.7. This record supersedes historical 1S local-only stops above.

Implementation:

- Admin chromatic utility classes and old `state-success*` / `state-danger*` aliases now use
  accent, warning or neutral roles. Active/success is accent; waiting, stale, review and failure
  retain explicit words with amber. Inactive/never-active/deleted readings and exited services
  use neutral roles. Descriptive provider links, release types, shows and quality no longer imply
  warnings. No dependency, endpoint, permission, callback or subscription changes.
- New Admin-local `SeverityMeter` uses three neutral decorative segments plus the level/risk
  word. Health, artist repair, scanner issues, logs, task log levels, playlist refinement and
  translation-quality issues consume it. Individual translation errors and warnings preserve
  their distinct level word/meter alongside the issue code. Aggregate operational failure and
  warning counts retain amber semantics.
- Destructive/cancel/logout triggers use neutral controls; danger remains on the actual shared
  ConfirmDialog confirmation button. Existing icons remain for Task 1b.8, not retired here.
- `status-colour-policy.test.ts` has 20 cases, a production-source scan and zero exceptions.
  It rejects raw chromatic utility families, legacy success/danger aliases, destructive variants
  and danger icon tones outside ConfirmDialog, including locally identifier-bound props with
  lexical shadowing. It is not arbitrary CSS/runtime data-flow analysis. Chart palettes/native
  surfaces and broad page geometry remain their scheduled work.
- The persistent `#estado-admin` specimen renders actual Admin OpsStatTile, SeverityMeter and
  IssueList plus shared StatusDot, SegmentedControl and ConfirmDialog, with fictional local
  actions. All previous specimens and the approved 1S playback controls remain. Preview-only
  Tailwind sources and responsive layout cover these real consumers.

Review and verification:

- One read-only code review found three P2 items: custom destructive controls remained amber;
  some old hues were mechanically mapped against their meaning; translation issue severities
  became indistinguishable. One fix pass resolved these, plus the P3 indirect-prop guard gap.
  Representative consumer assertions were seen red before correction and then green. No second
  reviewer pass is claimed.
- **185 Vitest tests / 49 affected files pass**, in serial 25/24-file batches with
  `--maxWorkers=1`. This is the statically resolved affected consumer graph, not the full Admin
  suite. Source-policy, Ops/meter, real track lyrics, missing release metadata, provider links,
  user activity/destructive controls, task status and mixed translation severities are covered.
- Admin strict TypeScript/build, scoped ESLint for 69 changed Admin files, preview strict types/
  static build, drift (15 metrics within budget), shared layers (0 violations / 141 files) and
  `git diff --check` pass. Build tooling's existing 500 kB chunk-size advisory remains non-fatal.
- Admin initial JS **529091 / 532480 B gzip**, +26 B from 1S, with **3389 B** headroom. No production
  Listen/shared changes in 1T; their 1S measurements remain historical, not new 1T build claims.

The first expanded advisory browser replay passed both new 1T cases and eight 1S cases, but its
mobile seek guard sampled only ten distinct rounded positions (required >10). Three unchanged
mobile replays passed, identifying unstable pointer/paint sampling rather than an alignment
assertion failure. The harness now waits for natural rAF between input steps, without pausing,
advancing or synchronising animation clocks, and retains the original frame-count/alignment
thresholds. Six diagnostic runs (1440/390 px, three each) recorded 115–145 frames, 39–60 distinct
positions and **0 px maximum horizontal/vertical separation**. Frame JSON is saved under ignored
`.artifacts/review/1t-seek-frame-diagnostics/`. The actual seek UI is unchanged.

Final advisory browser replay and proof are recorded below. The preview remains active at :5186.

Limits: no local canonical recording, baseline updates or full CI/suite were run. The 33 canonical
PNGs and current manifest remain from 1M. Linux CI record/import/comparison for 1N onward, real-data
Admin geometry and native/AT QA remain pending. `app/web@258bbaee` stays pinned and unavailable
locally after the earlier fetch attempt; no substitute reference was used. No PR, merge/rebase,
deploy, release, Smart Mix integration or 1T publication. The original MCP checkout is untouched.


### 1T final verification and stop

The final focused Chromium replay passes **11/11** cases with `--workers=1`: both 1T desktop/
390 px touch cases plus the nine affected 1S track/media/seek checks. Strict preview types pass
with Node test types resolved from the existing workspace, without dependency changes. Both final
seek recordings again report 0 px horizontal/vertical separation. The advisory test is still
Chromium automation; it does not replace real-device/native playback or AT review.

In-app browser review verified the actual 1T specimen and shared confirmation; Cancel restored
focus to its neutral trigger. The tab is retained at `?tab=albums&listenTab=history#estado-admin`.
Proof: ignored `.artifacts/review/checkpoint-1t.png`; final frame records are beside the diagnostic
samples above. HTTP :5186 returns 200 and the existing preview process remains active.

All 1T source/docs are unstaged and uncommitted. HEAD remains published 1S `124b36a8`. Stop here
for Diego's review; do not publish 1T or start 1b.7 without his direction.


### Checkpoint 1T approval and publication authorisation — 2026-10-17

Diego approved complete 1T and explicitly authorised commit/push and continuation with Task 1b.7.
This supersedes its local-only stop above. Publish the reviewed status-colour batch, keep :5186
active, implement skip links locally, and stop at checkpoint 1U before another publication or
Task 1b.8. Existing canonical/native QA limits remain; no full suites or CI during iteration.


## Checkpoint 1U — Skip navigation, Linux local review, 2026-10-17

Diego approved complete 1T and authorised commit/push plus Task 1b.7. 1T is published as
`5308c391c1b0168edebfff58b15e821a1e5a6757`, verified at origin. Its fresh pre-publication scoped
replay passed 34 Vitest and two Chromium cases. **1U is local, uncommitted and awaiting review**
at <http://127.0.0.1:5186/#saltar-contenido>. Stop before publication or Task1b.8.

Shared `SkipLink` is the first keyboard stop in both shells. Admin's existing main gains
`admin-main-content`; Listen's existing DesktopShell/MobileShell main gains `listen-main-content`.
All targets use `tabIndex=-1`. The link resolves the current target in its owner document, moves
focus into main, and leaves query/hash unchanged on successful activation. A missing target
retains native anchor fallback. The next Tab continues inside content. It has one shared solid
recipe, immediate focused visibility, existing focus ring, 44px minimum target, safe-area insets,
stacking above navigation and forced-color borders. No app-specific foundation variants, new
dependencies, API/player/permission/subscription changes or automatic route-focus behavior.

Listen's new `common.skipToMainContent` label is translated in all seven catalogs. Only that key
is added to the six non-English metadata files; historical records stay unchanged. The canonical
site pin remains `258bbaee`, without using a replacement tree. The original MCP checkout is untouched.

The persistent specimen uses real shared SkipLink/main in separate preview documents, with
fictional chrome. This avoids nested main landmarks and API-dependent app setup. Actual app Shell
integration is tested separately. The demo's outer button waits for its iframe/link to be ready;
a first-click browser failure exposed React's deferred initial commit, reproduced by comparing
readiness, and was fixed with a synchronous fixture commit before load plus a disabled control
until ready. This changes only preview startup. Existing checkpoints remain on the same page.

Focused verification:

- Shared SkipLink: 2 tests; Admin Shell/Sidebar/CommandPalette:22; Listen Shell/catalogs:57;
  shared source policies:5; Listen component/token/copy policies:8. **94 cases pass** across
  the affected files. RED was observed first: shared2, Admin1, Listen9 failures for missing behavior.
- **27 additional Shell cases pass** using the Desktop config's aliases and a simulated Tauri
  runtime with the existing renderer fixture. Combined total:121 scoped Vitest cases. This is
  not the full Desktop suite or a native window/AT run. Commands stayed serial, `--maxWorkers=1`.
- Strict types pass for Shared UI, Admin, Listen and Desktop; the preview's typed entries/spec
  pass with existing Node types. Scoped ESLint, export/token/component/copy policies, drift
  (15 metrics within budget) and shared layers (0 violations across142 files) pass.
- Admin build/budget: **529225 / 532480 B gzip**, +134B from1T, **3255B** headroom. Listen web
  build/budget: **199918 / 307200 B gzip**. No dependency or lockfile changes. Static preview
  builds both entry documents; existing large-chunk advisories are non-fatal.
- Six advisory browser cases cover both app labels at desktop and390px, keyboard/pointer
  activation, next Tab, real URL preservation, immediate visibility/44px target, forced colors,
  reduced motion, no overflow/API errors and both embedded controls. Final replay details below.

One fresh read-only review found no Critical/Important issue. **Minor deferred:** Shell unit tests
compare `window.location` while their fixture route lives in MemoryRouter, so those assertions
alone do not exercise the supplied query/hash. The browser tests use real URLs and cover this;
refine the unit URL fixture in later Shell work. No production defect or second review is claimed.

Decisions: successful skip preserves URL state (one handler to change if wrong); the review uses
isolated real-component documents (extra preview entry to maintain); automatic route-change h1
focus/announcements stay in planned Tasks3.2/4.1 (their controller work remains to implement).
Reviewer-declined runtime checks were performed here where available; native safe-area behavior,
AT announcements, cross-engine focus and canonical Linux CI QA remain pending. The 33 canonical
PNGs and current manifest remain from1M. No baselines, full suites/CI, PR, merge/rebase, deploy,
release, icon migration or 1U publication were performed.


### 1U final verification and review stop

The final Chromium replay passes **6/6** cases, `--workers=1`, including390px touch/coarse-pointer
contexts for both app labels and the specimen's actual8px label/control gap. Strict preview types,
scoped preview lint, static multi-entry build and i18n check (0 errors/0 warnings) pass after the
last fixture/type refinements. A locator scoping mistake in the added gap assertion was corrected;
its successful measurement remains8px. Production shell/link source was unchanged during this.

The in-app browser displays `?tab=albums&listenTab=history#saltar-contenido`; the real Listen
skip link was visibly focused in its isolated document. Proof is ignored
`.artifacts/review/checkpoint-1u.png`. HTTP :5186 remains active. Actual OS/native/AT testing is
still pending; the simulated Desktop renderer checks above do not certify those environments.

All1U files are unstaged/uncommitted. HEAD remains published1T `5308c391`. Keep the preview active
and stop for Diego here. Do not publish1U or begin1b.8 without his next direction. Generated Admin
TS build-info was restored to HEAD; no dependency, baseline or manifest changes remain.


### Checkpoint 1U approval and publication authorisation — 2026-10-17

Diego approved complete1U and explicitly authorised commit/push plus Task1b.8, keeping :5186
active and stopping at the next checkpoint. This supersedes its local-only stop above. The next
stop is1V: the task's mandatory Admin icon inventory and proposed functional exceptions, before
blanket deletion or a first migration group. Existing scoped/serial/no-baseline validation applies.
