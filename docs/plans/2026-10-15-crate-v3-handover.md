# Crate v3 handover

Entry point for agents picking up Crate v3. Revised 2026-10-18. Read this file and the implementation
plan; the status table separates implementation from pending QA.

Current transfer: **1N–1P are complete in the checkpoint commit
`feat(ui): unify v3 overlays, controls and field spacing`**. Diego authorised commit/push and
continuation on Linux; this final publication record supersedes earlier local-only stops below.
**1AA is approved and published as `1327270692937896072b3a3c79ad6cef6c1049b3`.**
**1AB is approved and published as `2d047fecd4721ac4575faadbf9bd8781eec37c5b`.**
Its three-block Dashboard, producer interpretation fixes and Ops/Analysis typography remain intact.
**1AC System Health is approved and published as `439b3e78daf2719d86cee72dd5726f7bc210c504`.**
**1AD Library Health is approved and published as `5e1d9c8f287804a834b3143f6367f7e5a2ef8e31`.**
**1AE Library Trash is approved and published as `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b`.**
Task 1b.8 / checkpoint **1AF Contributions is local for Diego review**, preserving functional
loading glyphs, attribution, source/status metadata, real album/cover helpers and read contract.
Review <http://127.0.0.1:5186/admin-contributions-demo.html> or persistent `/#aportes-admin`.
Next stop: 1AF before commit/push or another group.

Published **1AD Health** context: Diego approved the issue-queue sketch and explicitly authorised
its implementation on 2026-10-18.
The primary view lists recorded problems and opens actual cases/resolution actions. Activity,
check catalog and filters are secondary; no-data, empty, filtered, stale and limited results stay
truthful. Functional glyphs, repair eligibility, API/stream/confirmation contracts remain.
Diego subsequently requested a visual drift correction: accents, primary-action hierarchy,
reviewed typography and spacing are restored. Only the shared default-border cascade changes;
no new foundation variant or API change. Read the final visual-correction evidence below.
Published Health specimen: <http://127.0.0.1:5186/admin-health-demo.html> or persistent `/#salud-admin`.
The final composition record below and
[`2026-10-18-crate-v3-health-inbox.md`](2026-10-18-crate-v3-health-inbox.md) supersede the
historical icon-only and awaiting-sketch-approval stops. **The former 1AD stop is superseded by Diego's publication approval.**
Earlier provisional/publication stops are historical and superseded by Diego's approval and
next-group request on 2026-10-18. **Next stop: 1AF before commit/push or another group.**
The retained Listen play/halo/ring and luminous seek trail
from 1S remain intact. Resume on Linux with
[`2026-10-16-crate-v3-linux-handover.md`](2026-10-16-crate-v3-linux-handover.md).
Canonical 1N–1P Linux recording/comparison and native QA remain pending.

## Where the work lives

- Active Linux worktree: `/home/diego/.codex/worktrees/crate-v3-1q/crate`, existing branch
  `feat/crate_v3`, published HEAD `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b` (1AE);
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
| 1b.3 / Checkpoint 1Q                                         | Approved and published as `e863c227`; focused replay 39 Vitest / three Chromium cases passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1b.4 / Checkpoint 1R                                         | Approved/published as `093dcb1f`; scoped replay 309 Vitest / three Chromium cases passed before publication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1b.5 / Checkpoint 1S                                         | Approved/published as `124b36a8`; track/media/table foundations and retained Listen play/ring/seek trail. Pre-publication replay: 31 Vitest / 9 Chromium cases passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1b.6 / Checkpoint 1T                                         | Approved/published as `5308c391`; pre-publication focused replay: 34 Vitest / 2 Chromium cases pass. Earlier 185-test consumer validation remains recorded below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1b.7 / Checkpoint 1U                                         | Approved/published as `afed5a3c`; fresh pre-publication replay: 30 scoped Vitest / 6 Chromium cases pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1b.8 / Checkpoint 1V                                         | Approved/published as `cd5bf5e7`; inventory gate complete, historical 1U source snapshot preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1b.8 / Checkpoint 1W                                         | Approved/published as `52eaa6a5`; navigation glyph retirement, balanced counters, active bar and retained UX.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1b.8 / Checkpoint 1X                                         | Approved/published as `b628a438`; search/reusable controls, Select geometry and portalled keyboard access.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1b.8 / Checkpoint 1Y                                         | Approved/published as `ea6ebdc8`; operational surface contracts and all 125 uses adapted, UX and 8px geometry preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1b.8 / Checkpoint 1Z                                         | Approved/published `2efb4754`; Logs/Stack text controls and consistent shared selector/tag geometry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1b.8 / Checkpoint 1AA                                        | Approved/published `13272706`; Analysis including latest fingerprint. Final publication record below supersedes older local notes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1b.8 / Checkpoint 1AB                                        | Approved/published `2d047fec`: three-block Dashboard plus Ops/Analysis fonts. Origin SHA verified; scoped publication replay89Vitest/5Chromium green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1b.8 / Checkpoint 1AC                                        | Approved/published `439b3e78`: System Health icon retirement, shared window/text refresh and preserved instruments. Origin SHA verified; publication replay 27 Vitest / four preview Chromium green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1b.8 / Checkpoint 1AD                                        | Approved and published as 5e1d9c8f: corrected issue queue, retained UX and real contracts. Next local group: Library Trash / 1AE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1b.8 / Checkpoint 1AE                                        | Approved/published `638f4b0d`: Library Trash text actions, retained UX and real task/confirmation contracts. Publication replay 26 Vitest / one embedding Chromium pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1b.8 / Checkpoint 1AF                                        | Local for Diego review: Contributions, retained UX/data/routes. 26 Vitest / seven Chromium; 526770 B gzip, 5710 B margin. Review 0 Critical/0 Important/1 Minor deferred. No commit/push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
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

## Checkpoint 1V — Admin icon inventory, Linux local review, 2026-10-17

Diego approved 1U and authorised commit/push plus Task 1b.8. 1U is published as
`afed5a3c2174b7ebe39c2f6a6e7fbdbd7212469a`, verified against GitHub's branch ref. The fresh
pre-publication replay passed **30 Vitest** cases (SkipLink/Admin Shell/Listen Shell) and **6
Chromium** cases, with one worker. **1V is local and uncommitted**, at
<http://127.0.0.1:5186/#iconos-admin>. This is the mandatory inventory-first review before any
production deletion, not completion of the whole Task 1b.8.

The [inventory and proposals](2026-10-17-crate-v3-admin-icon-inventory.md) record 142 production
Admin TS/TSX/CSS files, 90 with indexed references, 72 with runtime glyph imports and 543 import
bindings. The report indexes direct JSX (625 sites), expressions, maps/properties, props, dynamic
slots and specific owned/shared export chains. Counts overlap and conditional routes (707) are
not visible-icon counts; the document states the syntax-analysis limits. All Admin source files
and 59 traced owned dependencies carry hashes; the CLI's `--check` rejects stale inventory.

Twenty-five source-located review cases propose text/marker replacements, identify shared close/
loading/Select contract work, and separate QR, provider/cover marks, charts/maps and inert Listen
hero presentation as content. **Zero permanent action-glyph exceptions are proposed or approved.**
No production icon, permission, action or shared API changed; no exception allowlist was created.
The proposed first subsequent group is Sidebar/CommandPalette/Shell, after Diego reviews 1V.
Later groups add source-policy/render tests and migrate actual consumers with their contracts.

The persistent mockup adds `#iconos-admin`: real shared Button/StatusDot/StatNumber/Input, local
fictional actions, bounded searchable file summaries and expandable per-control proposals. All
previous specimens, the 1U isolated documents, Listen's retained play/halo/ring/seek trail and
:5186 remain. No API backend is mounted or needed.

Scoped local validation:

- **10 serial Node tests** for scanner behaviour, aliased/type-only imports, maps/props, dynamic
  slots, raw vectors, external visuals, owned exports, star/cycle handling, CLI freshness,
  dependency hashes and manual case locations. Original seven-case RED preceded implementation;
  the star/cycle case also failed before its repair.
- **8 Chromium cases**, `--workers=1`: two new 1V desktop/390 px cases plus six affected 1U
  preview/isolated-entry cases. Filtering, pagination, native disclosure/keyboard operation,
  local actions, actual 8 px field gap, 44 px buttons, query preservation, no overflow/API/page
  errors, and the retained skip controls pass. The new preview case failed before the section
  existed. Screenshots are advisory ignored artifacts, never canonical baselines.
- Strict preview TypeScript, scoped ESLint and two-entry static preview build pass. Vite retains
  its advisory large-chunk warning for the review-only bundle. Production app bundles were not
  rebuilt for this tooling/docs-only checkpoint; `app/ui/src`, `app/listen/src`, `app/shared/ui`,
  package/lock files and the canonical manifest are unchanged relative to published 1U.
- Admin's last measured bundle remains **529225 / 532480 B gzip** (1U), **3255 B** headroom.
  No new production imports/dependencies. This is a historical measurement, not a new 1V build.

The single independent read-only review found no critical/important issue; final browser evidence
and its one minor repair are recorded below. No full suites/full CI or baseline recording were run. Canonical PNGs/manifest remain
1M; later Linux recording/import/comparison, real-data geometry, cross-engine/native/AT QA and
the unavailable pinned-site `app/web@258bbaee` comparison remain pending. No replacement pin,
Smart Mix, PR/merge/rebase/deploy/release or 1V publication. Original MCP checkout untouched.

**Stop at 1V for Diego before publication or the first production migration group.**

### 1V final review and stop

The independent read-only reviewer also passed the ten scanner tests, freshness check and both
new browser cases. It found one minor scanner issue: caching a cycle-dependent negative could
hide a second consumer imported through another barrel entry point. The strengthened two-entry
cycle fixture failed before repair; negative results are now left uncached, while positive
evidence is memoized. All **10 Node cases** pass again and `--check` confirms the actual 1V
report is unchanged. There was one repair pass and no second review.

Final preview copy uses singular/plural file counts and explicit whitespace in accessible summary
names; both new Chromium cases pass again. The earlier affected six 1U cases remain green. Strict
preview types, scoped lint/format and the two-entry static build pass. No production source changed.
The prior 1U minor Shell MemoryRouter/browser-URL fixture weakness remains deferred to the actual
Shell migration; real-URL browser cases cover query/hash preservation already.

In-app browser verification filtered `layout/Sidebar`, expanded its native disclosure and showed
its source categories. The live :5186 tab is kept as the deliverable; advisory screenshot:
`.artifacts/review/checkpoint-1v.png`. No canonical PNG/manifest changed. Preview responds HTTP200.

**HEAD/origin stay at published 1U `afed5a3c`. 1V is unstaged/uncommitted. Stop for Diego's
inventory/proposal review before publication or the first production migration group.**

### Checkpoint 1V approval and publication authorisation — 2026-10-17

Diego approved complete 1V and explicitly authorised commit/push plus the first Admin icon
retirement group: Sidebar, CommandPalette and Shell. The next review stop is checkpoint 1W,
before its publication or another migration group. The inventory gate is now approved; its
historical source snapshot remains the published 1U base. This migration applies only to Admin;
Listen/Desktop icons and the approved player/play/ring/seek presentation remain unchanged.

## Checkpoint 1W — Admin navigation icon retirement, Linux local review, 2026-10-17

Diego approved/published 1V as `cd5bf5e7229a9217694e38dbef3e33b9519d77b0`; origin was verified.
Its pre-publication scoped replay passed ten Node and two Chromium cases. **1W is local and
uncommitted**, at <http://127.0.0.1:5186/#navegacion-admin>. Stop for Diego before publishing it or
starting another group. Task 1b.8 remains in progress; this is its first production group only.

### Latest UX direction overrides the 1V proposal

Diego explicitly clarified that back/forward and other UX glyphs can stay, then named back,
next and collapse. Conventional functional UX glyphs are retained: history, collapse/expand,
menu, close, search, etc. This supersedes the historical zero-permanent-exception proposal in
1V for those controls. Retire redundant Admin destination/action/header/metric glyphs; preserve
Listen/Desktop icons and the approved play/halo/ring/seek essence. There are no shared API edits.

The scoped source policy bounds these **nine current uses**, with their existing accessible
names and 44px targets. Reusing an approval marker with a different glyph or duplicate site fails.
The map lives in `app/ui/src/admin-icon-policy.test.ts`; removals may shrink it. No blanket
exception is granted to page/destination glyphs. Shared close controls retain their established
shared glyph; direct Admin controls use Lucide.

| Component / marker              | Retained glyph        | Purpose and accessible name                                                |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| Shell / history-back            | ChevronLeft           | Conventional reverse-history affordance, `Go back`                         |
| Shell / history-forward         | ChevronRight          | Opposite history direction, `Go forward`                                   |
| Shell / mobile-navigation       | Menu                  | Compact mobile navigation trigger, `Open navigation`                       |
| Shell / help-close              | Existing shared close | Same 1N overlay close affordance, `Close`                                  |
| Sidebar / sidebar-collapse      | PanelLeftClose        | Collapse rail without competing with destination names, `Collapse sidebar` |
| Sidebar / sidebar-expand        | PanelLeftOpen         | Restore rail width, `Expand sidebar`                                       |
| Sidebar / drawer-close          | Existing shared close | Dismiss the drawer, `Close navigation`                                     |
| CommandPalette / palette-search | Search                | Identify the command/search field; combobox name `Search commands`         |
| CommandPalette / palette-close  | Existing shared close | Explicit pointer/keyboard dismissal, `Close command palette`               |

### Result and scope

- Sidebar removes destination icon maps, redundant Bandcamp navigation mark, user fallback glyph
  and logout glyphs. Full destination names remain in both modes; profile name/photos/initials,
  logout, section/capability filtering, counters, role preview and callbacks remain. The compact
  rail is **144px**, expanded **240px**; header/main offsets use the matching widths. Its existing
  preference key and event stay compatible. The mobile drawer always uses full names/width and
  does not alter the saved rail mode. All affected controls have at least 44px targets.
- CommandPalette removes navigation/action icon maps and artist/album-result glyphs. Task catalog
  contracts, bodies, filtering, capabilities, search debounce and task outcome toasts remain.
  Its cmdk root now provides the actual generated label used by the combobox's `aria-labelledby`;
  setting only an input `aria-label` was insufficient. Commands are text with 44px rows. The UX
  search/close glyphs stay; focus returns to the opener after dismissal.
- Shell retains history glyphs/callbacks, mobile menu and shared help close, plus 1U's first-focus
  skip link and main target. The drawer now uses its real SheetTrigger so Escape/close returns
  focus; palette/help also restore focus. Medium-width header search fits, retaining the existing
  500px width on larger screens. No guessed history-boundary/forward-stack disable logic was added.
- Direct runtime glyph bindings across the three files fall from **60 to 6** (Sidebar 28→2,
  CommandPalette 29→1, Shell 3→3). These are static import bindings, not counts of rendered icons.
  The nine UX sites include three inherited shared close controls. Source policy covers direct,
  passed/mapped/dynamic and owned library/native-vector wrappers. The scanner now traces inline
  vector wrappers too. Its new fixture failed before implementation and passes after it.
- SearchBar and the role AdminSelect are two explicitly pending nested surfaces. Their single
  embeddings are bounded, not permanent exceptions for decorative glyphs. Their own group will
  review redundant glyphs while retaining functional UX. The standard shared Button spinner is
  only accepted without a loading prop; implicit overlay closes need a concrete UX approval or
  `showCloseButton={false}`. Branding/photos remain content.

The 1V JSON/manual review snapshots remain byte-for-byte intact at their original 1U base. The
manual case test reads exact source lines from that published commit. Do not regenerate 1V's
report after migration: its `--check` command applies to the old source base. The new policy
checks current sources instead. Only Admin production code changed; Listen/Desktop/shared sources
and package/lock files are untouched. The original MCP checkout remains untouched.

### Preview and validation

The persistent page retains previous checkpoints and adds an iframe entry with the actual three
components. Preview-only Vite resolution supplies fictional API/ops values and no live notification
effects; real AuthContext is given fictional values. The production config is unchanged. The demo
supports history, collapse, role preview, local logout result and palette actions. The real Admin
entry is independently exercised with the existing intercepted API fixtures. Neither needs a backend.
The static preview build contains main, skip-link demo and Admin navigation demo HTML entries.

- **37 scoped Vitest cases**, `--maxWorkers=1`: Sidebar, Shell, CommandPalette and source policy.
  Original icon/text cases failed before retirement; the revised retained-UX assertions failed
  before restoring the authorised glyphs. Palette/help focus assertions failed before repair.
  Capability, route/callback, catalog body/outcome and preference/counter tests pass. The old
  1U Shell MemoryRouter/browser-URL fixture weakness is fixed by seeding/restoring browser history.
- **11 serial Node cases** pass, including the new native-vector wrapper fixture. Historical
  manual cases and prior scanner cases remain covered.
- **12 preview Chromium cases**, `--workers=1`: 1W at 1440/768/390px and persistent embedding,
  two 1V inventory cases and six affected 1U skip cases. New real entry proves routes/history,
  full compact labels, retained UX glyphs, focus/keyboard, 44px targets, fitting search/layout,
  no overflow/page errors and no live API requests. Initial preview-only failures exposed missing
  Tailwind Admin source scanning and drawer focus return; both are repaired. No canonical images.
- **3 production Admin Chromium cases**, `--workers=1`, pass at 1440/768/390px with the existing
  API interception fixtures: real URL/query/hash skip, history, compact/expanded offsets, full
  navigation names, retained UX controls, palette focus and mobile dismissal. Advisory captures
  only. Its first build attempt was stopped by new test typing errors; after repair the scoped
  build/browser run passed. No unrelated test failure is hidden.
- Admin types, scoped ESLint/format, strict main-preview and Admin-demo types, production Admin
  build, three-entry preview build and bundle gate pass. Vite's existing advisory chunk warnings
  remain. Main-preview types use Listen aliases; Admin-demo types use Admin aliases separately.
- New measured initial Admin JavaScript is **525989 / 532480 B gzip** (9 assets), **6491 B**
  headroom; **3236 B less** than 1U's 529225. No runtime dependency was added.

### Independent review and repair — 1W

One fresh read-only review found no Critical/Minor issues and two Important issues, both
reproduced before repair: the three inherited close targets measured 40px, and pressing `?`
again while help was open replaced the external focus-return anchor with the modal's Close.
A single repair pass adds Admin-local 44px sizing without shared API edits and captures the help
opener only on closed→open. The repeated-`?` unit regression failed before repair; the new
close geometry browser checks failed before sizing. The final scoped replay passes all 37
unit cases, 12 preview Chromium cases and 3 real Admin Chromium cases. The browser checks now
measure drawer/palette/help close targets, including the preview's coarse-pointer 390px case,
and verify repeated-`?` dismissal restores external focus. Type/lint/build/bundle checks pass
again after repair. No second review loop was run.

In-app evidence is saved under ignored `.artifacts/review/checkpoint-1w.png` and
`checkpoint-1w-palette.png`. The persistent `#navegacion-admin` tab stays open and the :5186
preview remains active. A stale browser error tab from an earlier preview restart was replaced
with a verified working preview tab; the server is HTTP 200.

No full suites/full CI,
baseline regeneration, PR/merge/rebase/deploy/release, Smart Mix or 1W publication. Canonical
33 PNGs/manifest remain 1M. Later Linux capture/import/comparison, real-data geometry, native/AT,
cross-engine and unavailable pinned `app/web@258bbaee` fidelity checks remain pending.

### Diego's visual follow-up — counters, active destination and palette focus, 2026-10-17

Still local checkpoint 1W. The sidebar counter combined 6px horizontal CSS padding with no
vertical padding; measured numeral ink had 6px left/right but only 3–4px top/bottom. The two
navigation counts now use JetBrains Mono tabular numerals, 12px type/14px line-height, and
balanced visible spacing. Browser tests measure the actual glyph ink against the inside border
for one- and two-digit values in expanded, compact and drawer navigation, allowing at most
1.5px variation for glyph bearings/rasterisation. The initial geometry checks failed before repair.

Diego also requested a marker for the current page. Its route now has the DS §5.4 left-hand
2px `accent-action-hi` bar and primary text, replacing the filled active pill. `aria-current`
remains supplied by NavLink. Tests verify the marker follows navigation, appears in both rail
modes and drawer, and disappears from the previous destination.

The command search field's global outline projected 2px beyond its header row. It now uses the
existing shared `crate-focus-inset` utility so the 2px keyboard focus stays inside the field and
header. The new overflow regression measured 2px and failed before repair; it passes at all
three widths. No shared focus rules or other search fields were changed.

Final follow-up replay: **34 affected Vitest**, **7 Admin preview Chromium** (including three new
geometry/current-destination cases) and **3 actual Admin Chromium** pass, serial workers only.
Admin/preview types, scoped lint/format, Admin build and three-entry preview build pass. Current
initial Admin JavaScript: **526012 / 532480 B gzip**, **6468 B margin**. This supersedes the
pre-follow-up bundle measurement above. Previous unaffected 1U/1V/1W checks remain recorded;
no full suites/CI or canonical baseline regeneration. Proof: ignored
`.artifacts/review/checkpoint-1w-counter-active.png` and
`checkpoint-1w-palette-inset-focus.png`. Preview :5186 stays active for review.

**Stop at 1W for Diego before commit/push or another migration group.**

## Final 1W publication / local checkpoint 1X — 2026-10-17

Diego approved 1W and authorised commit/push plus the next Admin icon-retirement group.
Published `52eaa6a5da3f1acac58850a700947540320feb6f` (`feat(ui): retire redundant Admin
navigation icons`); exact remote branch SHA verified. Pre-publication focused replay passed
37 Vitest, 11 Node and 7 preview Chromium cases. No full CI was dispatched; frontend push CI
is scoped to main. Work stays in the existing isolated worktree; MCP checkout stays untouched.

### 1X scope and contracts

- SearchBar removes User/Disc/Music placeholder glyphs, Clock beside recent text and Library
  beside the empty-result text. Real artwork stays content. Search, busy spinner and clear X
  remain individually named/bounded UX sites. Preserve 200ms debounce, lower-case cache,
  recent storage/migration, canonical routes, keyboard wrapping/Enter/Escape and callback props.
  Loading gains aria-busy; clear and recent rows now have 44px targets.
- AIButton removes Sparkles beside the action label. Preserve LLM availability gate, callback
  and button props, disabled/loading behavior and existing appearance. Its busy spinner remains
  aria-hidden with aria-busy on the button. Default minimum target is 44px; density overrides
  remain possible. Its inherited Button spinner is explicitly off after forwarded props,
  avoiding a second spinner while preserving the public prop contract.
- Sidebar's role Select now has a 44px trigger. Its shared disclosure/selection/search glyphs
  are functional UX. The source policy covers SearchBar/AIButton/the AdminSelect reexport as
  well as the 1W navigation files; it removes both temporary nested deferrals and bounds one
  reviewed Select consumer plus 13 concrete retained glyph/close sites. Explicitly disabling
  inherited Button loading after all spreads is checked positively and negatively.
- Reviewed surrounding controls: shared close/disclosure/selected/radio/loading glyphs, rating
  value stars and image-edit affordances are UX/content under Diego's latest instruction.
  MusicContextMenu already renders text actions. No global icon opt-out is needed; later
  operations/page passed icons remain pending, rather than being granted blanket exceptions.

### Select clipping reported by Diego during 1X

The wide source trigger made the portalled viewport at least as wide as the trigger while
AdminSelect's outer menu was 240px. Rows and the selected marker were clipped far beyond the
outer surface. The browser regression failed before repair (row right edge ~1383px versus menu
~267px). Shared SelectContent now assigns the default popper width to the outer surface;
caller width overrides still work, and the inner viewport fills the actual menu. This corrects
one shared foundation for both apps without app-specific variants or public API changes.
Item-aligned placement is unchanged. Keyboard tests wait for actual option focus before arrow
navigation; initial tests sent the next key before Radix's deferred focus settled.

### Search dropdown stacking reported by Diego during 1X

The field's existing focus transform isolated the inline AppPopover in a stacking context below
later positioned AI content, despite its dropdown token. A browser hit-test reproduced the
third result behind that action. SearchBar now uses the shared Radix Popover portal/dropdown
layer with a standard additive PopoverAnchor export. The field stays focused, portal width and
collision positioning follow the anchor, and pointer/keyboard selection remain intact. Radix
outside/Escape handling replaces the old document mousedown handler, which would incorrectly
classify portalled results as outside. Anchor clicks stay inside; outside clicks retain their
own focus. No z-index value or second foundation was invented. The hit-test now passes at
1440/768/390; native result clicks also navigate through the portal.

### Persistent specimen and verification

`#controles-admin` embeds actual SearchBar, AIButton, LLMStatusProvider and shared AdminSelect
in an isolated fourth HTML entry. Preview-only API adapters supply results, an empty query
(`vacio`), explicitly held loading (`espera`) and LLM availability. No backend calls or real
operations. The 1W section is preserved and marked published. A fixture release button initially
sat behind its own result popover; it was moved before the field. Geometry checks wait for the
existing overlay entry animation to settle, rather than weakening the 44px target.

Final scoped validation/review evidence is appended below. No 1X commit/push, full suites/CI,
canonical baseline regeneration, PR/merge/rebase/deploy/release or Smart Mix. Canonical 33 images
and manifest remain 1M; native/AT, cross-engine, real-data geometry, canonical Linux capture/import/
comparison and unavailable pinned app/web@258bbaee fidelity checks remain pending.

### Independent review and bounded keyboard repair — 1X

One fresh read-only reviewer found no Critical/Minor issues and one Important introduced
regression: after portalling, Tab from the input skipped suggestions and outside-focus dismissal
closed them. The reviewer verified pointer selection, caller Select width overrides, glyph/policy
scope and settled anchor width; the apparent 6px offset was the intended 8px viewport collision
clamp, not broken anchor tracking. No positioning-strategy change was warranted.

One repair pass restores the logical Tab bridge: input→first suggestion, Shift+Tab→input, native
Tab between suggestions, last Tab→the next page control while dismissing suggestions. Capture at
portal boundaries avoids Radix FocusScope's internal loop. An internal fallback input ref also
keeps this behavior when callers omit inputRef. Escape from a suggestion returns focus to the
field; it consumes that overlay event before Shell's separate Escape-to-blur shortcut. The new
preview regression failed before the Tab fix and again before the focused Escape repair. The
real Admin integration then reproduced Shell's blur interaction in both desktop widths; consuming
the handled overlay event is the bounded fix, leaving the global shortcut unchanged.

The repaired preview cases verify the complete route at 1440/768/390, pointer result navigation,
layer hit-testing, Select clipping/keyboard selection, 44px targets and the real 8px field gap.
The production Admin cases also exercise Tab, Shift+Tab and Escape on actual search results.
No second reviewer loop is used; the covering regression checks verify the single repair pass.

Review rulings: native AT/cross-engine/exhaustive scroll-resize/real-data/canonical fidelity remain
phase QA, not certification by this checkpoint; wrong assumptions must be caught before phase
closure/publication to production. Request cancellation and cross-window recents stay baseline
work outside this icon group; no behavior there was changed. The reviewer did not independently
rerun suites; the executor records its actual scoped runs/build results below. No Minor items are
deferred. Keep all existing canonical evidence and the pinned reference.

### Final scoped evidence — 1X

- **41 Admin Vitest cases**: 27 controls/policy cases plus 14 affected existing Playlist/Genres/
  GenreTaxonomy/GenreEq/ArtistMetadata consumer cases. The 27 control/policy cases pass again
  after the keyboard repair. Source-policy scope includes the AdminSelect reexport and no
  remaining temporary nested deferral. Direct runtime glyph bindings in SearchBar/AIButton
  decrease **10→4**; these are bindings, not a count of visible instances.
- **31 shared Vitest cases**: Select, AdminSelect, AppPopover and floating-layer governance.
  **7 Listen selector-policy cases** plus shared/Listen type checks pass. Listen/Desktop source
  and shared z-index tokens are untouched; the shared fixes are standard geometry/an anchoring
  export, preserving existing consumer APIs and behavior.
- **13 preview Chromium cases**: 4 new 1X cases (1440/768/390px and persistent embedding),
  7 affected 1W navigation cases and 2 affected 1O form cases. Real data adapters produce no
  backend requests. These cover layer hit-testing and pointer selection, Tab/Shift+Tab/last-row
  exit/Escape, selected-marker/menu bounds, actual 8px label gap and 44px targets. All workers
  remain serial. Earlier failing fixture/animation/focus runs are described above.
- **3 actual Admin Chromium cases** pass at 1440/768/390 after the final repair, including
  actual result Tab/Shift+Tab/Escape integration with Shell. The preceding 2 desktop failures
  demonstrated the global blur interaction before the final handled-event fix; they are not
  omitted. The clean final run exits 0.
- Admin/shared/Listen/main-preview/Admin-demo types, scoped lint/format, actual Admin build,
  four-entry static preview build and bundle gate pass. Existing advisory Vite chunk warnings
  remain. Current initial Admin JavaScript: **526122 / 532480 B gzip**, **6358 B margin**
  (9 assets; **110 B above 1W**). No package/lock/runtime dependency changes.
- Advisory in-app evidence: ignored `.artifacts/review/checkpoint-1x-search.png` and
  `checkpoint-1x-select.png`. Preview HTTP 200, kept active; the 1X tab remains open for Diego.
  Canonical snapshots/manifest stay 1M. No full suites/full CI or new publication/PR/deployment.

**Stop at 1X for Diego before publication or another group.**

## Final Linux record — 1X published; 1Y operational surface contracts (2026-10-17)

This record supersedes the earlier 1X local-only stop. Diego approved 1X and authorised its
publication plus the next bounded group. Commit `b628a43871e346c095b248794f4085d888b19226`
(`refactor(ui): retire redundant Admin control icons`) is pushed to `origin/feat/crate_v3`;
local HEAD and `git ls-remote` agree. Fresh prepublication replay: 27 scoped Vitest + 4 preview
Chromium tests pass. Checkpoints through 1X remain preserved.

### Scope and contracts — 1Y local

- Admin-local `components/admin/ops-surfaces.tsx`: remove the required `icon` prop, decorative
  SVGs and empty icon wrappers from OpsPageHero, OpsPanel and OpsStatTile. Preserve title and
  heading levels, description, data/ReactNode values (including zero), captions, tone, className,
  actions and child content. Functional loading/disclosure glyphs supplied in slots stay usable.
- Inspect/adapt **125 callsites in ten pages**: Analysis 10, Dashboard 18, Discover 11, Genres 17,
  Insights 9, Logs 8, NewReleases 7, Stack 8, SystemHealth 19, Tasks 18. Remove 26 unused Lucide
  bindings across seven pages; glyphs still used in page-specific actions/rows remain for later
  groups. AST comparison confirms these ten page bodies are unchanged outside the retired
  surface icon props/imports: no capability, route, callback, stream or fetching edits.
- Metric label/value pairs now use `.crate-form-field` for **8 real px**, replacing legacy 12px
  margin. Captions stay separate and retain their spacing. 1T's success/accent, warning/danger
  amber and primary/default neutral readings remain. Adapt the three actual older 1T specimens
  to the retired prop; keep the section mounted with its state controls.
- Extend `admin-icon-policy.test.ts` to the surface implementation and all production Admin TSX
  consumers. Tests reject the old icon prop and opaque spreads, including imported aliases and
  namespace access. Existing 13 UX sites and one shared Select approval do not grow. This checks
  surface contracts, not completion of every icon on the ten pages.
- Persistent specimen **`#superficies-admin`** mounts all three real components with fictional
  readings, a long label, zero, idle/busy refresh and keyboard disclosure. Busy/disclosure controls
  retain their UX glyphs and 44px targets. The 1X section/footer is marked published. No backend
  or real operation; all prior checkpoints remain mounted.

### Scoped evidence and limits — 1Y

- RED: hero/stat/panel tests find their former SVGs, source guard finds 8 surface entries and
  consumer guard finds 125 old props. GREEN after retirement. Preview section absence RED, then
  real metric geometry RED (12px received vs required 8px), GREEN with the shared field recipe.
- **64 scoped Vitest cases** pass: surface/slot contracts, icon policy, status-colour policy and
  existing Tasks/SystemHealth/Genres/Discover consumer tests; `--maxWorkers=1` throughout.
- **4 new preview Chromium cases** pass (1440/768/390px plus previous-checkpoint preservation),
  checking text hierarchy, semantic colours, actual 8px geometry, zero/long readings, keyboard,
  busy/disclosure glyphs, 44px targets, URL parameters, no overflow, no API calls or page errors.
- **4 actual Admin Chromium cases** pass: Tasks/SystemHealth operational readings at those three
  widths plus the existing Resources/panel-spacing regression. Fixture-backed production build,
  no screenshot baseline update; `--workers=1`. **2 affected 1T preview Chromium cases** also
  pass (1440/390px), keeping the previous state/confirmation checkpoint functional.
- Admin typecheck, strict preview/spec typecheck, the new actual-Admin spec typecheck, scoped
  Admin ESLint and changed-code Prettier checks pass. Preview spec's initial readonly-tuple
  errors were corrected before these final typechecks. The four-entry preview build passes;
  the existing large-chunk advisory remains. No additional entry or runtime import is added to
  the production app for the specimen.
- Admin production build passes; initial JS **526063 / 532480 B gzip**, **6417 B margin**, nine
  assets, **59 B below 1X**. No dependency, package/lock or shared production contract changes.
- No Listen/Desktop source edits, main/Smart Mix integration, PR, merge, rebase, deploy, release,
  full suites/CI or local canonical baseline generation. The 33 PNGs/manifest still belong to 1M.
  Pinned `app/web@258bbaee` remains unavailable and unchanged; no substitute visual source.
  Canonical Linux comparison, real-data/full phase QA, native/AT and cross-engine checks remain
  pending. These Chromium checks and the advisory specimen do not certify those gaps.

Advisory review proof: `.artifacts/review/checkpoint-1y-surfaces.png`; the public preview tab
is left at `?tab=albums&listenTab=history#superficies-admin`, HTTP 200, server kept active.
One fresh read-only review of the complete local 1Y diff returned **Critical 0 / Important 0 /
Minor 0**, ready for Diego's bounded checkpoint review. The reviewer independently replayed 24
surface/policy cases (already included in the 64 unique cases above), confirmed the consumer AST
scope and inspected busy/disclosure UX in a separate temporary tab. No file/index/HEAD changes
or repair pass were required. The reviewer explicitly declined remaining page icons, canonical,
native/AT, cross-engine/real-data, full-suite/CI and whole-1b.8 completion claims.

**Stop at 1Y for Diego before commit/push or another group.**

## Final Linux record — 1Y published; 1Z Logs/Stack pages (2026-10-17)

This record supersedes the earlier 1Y local-only stop. Diego approved 1Y and authorised its
publication plus one next bounded Admin group with UX glyphs retained. Commit
`ea6ebdc809ba3062733b51d04186bd6861b7566f` (`refactor(ui): retire decorative Admin operational
surface icons`) is pushed to `origin/feat/crate_v3`; local HEAD and `git ls-remote` agree.
Fresh prepublication replay: 24 scoped surface/policy Vitest + 4 preview Chromium cases pass.

### Scope and contracts — 1Z local

- **Logs**: remove the refresh glyph and line-count/worker-summary icons. Keep Search, the named
  page loading status and live Pause/Play glyphs, hidden from accessible names. The live toggle
  retains changing action labels; the separate mode chip states Live/Frozen status. Search has a
  specific accessible name. Refresh/live/
  search/select triggers use 44px targets. Log levels remain neutral severity, errors/warnings
  remain amber with words. Filters, metadata/task links, retry and subscription lifetime stay.
- **Stack**: replace icon-only service actions with visible Logs, Stop/Start, Restart and Open
  service text plus names specific to each service. Keep functional start/stop/busy, external-
  navigation and search glyphs. Replace ScrollText with a disclosure chevron and add expanded/
  controls state plus a named logs region. Each card is a named article. Refresh/restart and
  summary icons retire; their unused imports and ActionIconButton wrapper import are removed.
  Service action/search targets are 44px. Service state uses shared SegmentedControl radio chips,
  matching Log level: 32px fine / 44px coarse, with shared arrow-key selection and the same
  all/running/stopped values. Status/Ports/Public route label/value pairs use
  the shared `.crate-form-field` for **8 real px**. Keep state words/dots, logs, disabled/busy
  behavior and the existing shared restart confirmation, cancellation and focus return.
- **Behavior unchanged**: AST comparison of **12 Logs + 15 Stack helper/action/hook
  bodies** matches HEAD. No stream/dependency, reconnect, fetching/fresh query, route, permission,
  action-eligibility, API mutation path or confirmation semantics change. Core-service restrictions
  remain their separate planned product change. No shared, Listen/Desktop or dependency edits.
- **Source policy**: both entire page files join the migrated scope. Twelve new exact UX sites
  bring the bounded direct/close list to **25**. Reviewed shared uses: existing Sidebar Select,
  two Logs Selects, one ErrorState per page and one Stack ConfirmDialog. Glyph-free shared
  badge calls require no icon or opaque spread; Button loading guards remain. Negative fixtures
  cover badge icon/spread bypasses. Historical 1V JSON remains untouched; remaining page families
  and broader 1b.8 are pending, not implicitly approved by these exceptions.
- **Persistent specimen**: `#operaciones-admin`, fifth entry `admin-operations-demo.html`, actual
  Logs/Stack pages and production Admin CSS. Fictional JSON/API/EventSource/action adapters apply
  only in preview. Navigation switches pages; ready/loading/empty/offline states and held service
  actions are local. Use “Completar acción de muestra” to finish a sample action. No backend,
  network API/SSE or real mutation. 1Y is marked published; all earlier checkpoints remain.

### Scoped evidence — 1Z

- RED: 9 page cases fail on former glyphs and missing accessible loading/search/action names;
  the baseline retry passes. Expanded source guard fails on 52 entries. GREEN after migration.
  Preview-section absence RED; then three Stack cases fail on missing named card semantics;
  named articles make the complete new browser scope green.
- **35 scoped Vitest cases pass**: Logs 4, Stack 6, icon policy 16, shared-consumer Admin surface
  tests 9. Cover snapshots/stream updates and cleanup, no reconnect on filter updates, routes,
  filtering/refresh/retry, busy start/stop, log disclosure and restart confirmation/cancel/focus.
  `--maxWorkers=1`; no full suite.
- **20 unique Chromium cases pass**, all `--workers=1`: 9 new preview cases (both pages at
  1440/768/390px, persistent embedding and 2 fine/coarse chip-geometry parity cases), 3 fixture-backed actual Admin cases (both pages at
  those widths), 8 affected previous 1X/1Y preview cases. Check real 8px geometry, 44px page/service
  actions/search/select targets, standard 32px fine / 44px coarse service chips, text/retained UX, keyboard/focus, loading/empty/error states, filters, local actions,
  zero API requests in preview and no horizontal overflow. Actual Admin POSTs are intercepted
  by test fixtures; no real service operations.
- Admin/scoped preview/demo/new actual-Admin spec types and scoped Admin ESLint pass. Initial
  test-only type errors (unsupported Testing Library `exact` role flag and timer overload) were
  corrected; the first build stopped in TypeScript before Vite. A pass-through timer spy plus
  afterEach cleanup preserves real timer behavior. Subsequent build and focused Admin tests pass.
- Admin build and five-entry preview build pass. Initial JS **526069 / 532480 B gzip**, **6411 B
  margin**, nine assets, **6 B above 1Y**. Existing large-chunk advisory persists; no package/lock
  or runtime dependency changes. Known generated `tsconfig.tsbuildinfo` restored from HEAD.
- Advisory proof: `.artifacts/review/checkpoint-1z-stack.png`; the public preview remains active
  at `?tab=albums&listenTab=history#operaciones-admin`. Final formatting and independent review
  results are recorded below when complete.

### Same-checkpoint feedback and bounded review repair — 1Z

Diego reported Service filters looked thicker and rounder. Direct geometry regression measured
44px on a fine pointer versus the existing Log level chip's 32px. Replace the bespoke CratePill
selection with the existing shared SegmentedControl, without a height override. Fine/coarse
browser parity now verifies height, radius, border, padding and font match (32/44px). Radio/arrow-
key selection preserves the same three values, filtering and subscription lifetime.

The single independent review found one Important introduced AT issue: `aria-pressed` combined
with changing Pause live/Resume live action labels was exposed as contradictory checkbox states
while the mode chip showed Live/Frozen. Grade agreed. A single RED→GREEN repair removes only
that attribute and tests absence across both action labels. No other issue in the original scope
was found; the same review includes the user-directed filter amendment without a second round.
Final post-amendment Admin/preview/demo/new actual-spec typechecks, scoped Admin ESLint and
changed-code Prettier pass. The same 35 scoped unit cases and 9 new preview cases pass; all three
actual Admin cases replay with radio/arrow selection and pass. The five-entry preview rebuild
passes. Final initial JS is **526069 B gzip**, **6411 B margin**, **6 B above 1Y**.

The single fresh read-only review is closed: **Critical 0 / Important 0 / Minor 0 outstanding**.
Its one Important accessibility finding was repaired in the single bounded RED→GREEN pass; the
same review assessed Diego's filter amendment without a second review round. The reviewer
independently passed 26 focused cases already included in the 35 unique cases, reviewed the final
changes/evidence, and closed their temporary tab. No reviewer file/index/HEAD changes. Remaining
Admin migrations, baseline action restrictions, native/actual AT, other engines, real data,
canonical baselines, the unavailable pin and full suites/CI are explicitly outside this verdict.
Advisory screenshot refreshed after the filter correction; public preview kept active. No 1Z
commit/push, publication or next group.

No full suites/CI or local canonical baseline generation. The 33 PNGs/manifest still belong to
1M; `app/web@258bbaee` remains unavailable and unchanged, without a substitute/vnext reference.
Canonical Linux recording/comparison, native/AT, cross-engine, real-data and full phase QA remain
pending. No PR, merge, rebase, main/Smart Mix integration, deploy or release.

**Stop at 1Z for Diego before commit/push or another group.**

### Further visual follow-up — uniform summary tags, 1Z

Diego's Logs screenshot exposed mixed static `CrateChip` and `CratePill` geometry in the same
summary row: measured 16px/font10/padding8×2 versus 32px/font11/padding12×4, with static pills
inflating to 44px under a coarse pointer. Stack's header had the same pattern. Both migrated-page
summaries now consistently use the existing static CrateChip recipe; error/warning tags use its
shared warning tone. No custom height/padding/radius override, shared API, control sizing, label,
state, callback or stream changes. Static tags are informational and have no touch action.

Four new browser cases first reproduce geometry mismatches, then pass for both pages with fine
and coarse pointers, including Logs live/frozen states. They compare height, padding, radius,
font/line/family/weight and border width, and assert no button or glyph in the row. The focused
Logs warning-tone assertion also follows RED→GREEN. Fresh follow-up checks: **26 scoped Vitest**
and **13 scoped preview Chromium** pass, Admin build/typecheck, preview spec types, scoped ESLint
and changed-code formatting pass. Existing earlier actual-Admin/other-preview checks are retained;
no full suites/CI or baseline generation. Final budget **526069 / 532480 B gzip**, **6411 B margin**,
nine assets (**6 B above 1Y**). Generated tsbuildinfo restored from HEAD.

Proof: `.artifacts/review/checkpoint-1z-summary.png`. Preview remains active on 1Z with the Logs
sample frozen for comparison. The prior independent review covers its recorded revision; this
small subsequent consumer-only styling correction has the focused checks above. Keep the 1Z
review stop: no commit/push or next migration group. Native/canonical/full-phase limits remain.

## Final Linux record — 1Z published; 1AA Analysis page (2026-10-18)

Diego approved 1Z and authorised commit/push plus the next bounded Admin group. Published
`2efb4754f1cf85a265897f3481fabcd835d29991` (`refactor(ui): retire redundant Admin operations icons`)
and verified local/origin SHA equality. Fresh pre-publication replay passed 26 scoped Vitest
and 13 preview Chromium cases. The worktree stays isolated from the MCP checkout. Preview was
down at turn start; restarted with Node 22.23.3 on :5186, then HTTP/browser verified.

### Scope and contracts — 1AA local

- Entire `app/ui/src/pages/Analysis.tsx` plus its local PipelineCoverage, MiniMetric and
  RecentTrackCard. Remove redundant action/summary/coverage/output glyphs, private icon props
  and empty icon boxes. Local section titles become real h3 headings.
- Retain nine Loader2 sites: named initial loading and eight action spinners, aria-hidden on
  glyphs and aria-busy on the active action. Text names, shared Button semantics, exclusive
  disabling, failure recovery and 44px action targets remain.
- Nine header summaries consistently use static CrateChip (shared warning/accent tone API).
  The 22 MiniMetric label/value pairs adopt `.crate-form-field` at 8px, alongside five already
  compliant OpsStatTile readings. No bespoke field margins or shared badge sizing changes.
- Normalization, percentages, coverage bars, timestamps and recent output metadata are intact.
  AST audit confirms five helper/action functions, both status/metrics memos and all eight
  queue calls unchanged against 1Z. Preserve their paths, payloads, toasts and 800ms refresh.
  Existing OpsSnapshotContext remains the sole provider/stream owner; no provider edits.
- Source policy now covers ten entire migrated files, 34 exact functional UX sites and bounded
  shared consumers (two Analysis ErrorState uses added). Original 1V inventory remains historical.
  No shared, Listen, Desktop, backend, route, capability or dependency change.
- Sixth isolated preview entry `admin-analysis-demo.html` mounts actual Analysis with local
  fictional snapshots/actions. Vite redirects only Analysis's API/context imports; older
  adapters/specimens are preserved. States: ready/loading/empty/PCM/missing/unavailable; action
  completion is held for inspection. No API/SSE network requests or actual task submission.
  Sample generations prevent an old queued action refresh from overwriting a later sample.

### Scoped evidence — 1AA

- 39 focused Vitest: Analysis 14, icon policy 16, affected Ops surfaces 9. Eight parameterized
  action cases cover exact endpoint/body, keyboard dispatch, busy/disable/recovery, notification
  and the delayed refresh; loading, error/missing retry and empty/fallback/output states covered.
- Five new preview Chromium cases: persistent embedding/preservation, desktop/tablet/mobile
  page/actions/states/geometry/no-network, and a deterministic delayed-sample isolation case.
  One affected previous 1Z embedding case passes. No screenshot baselines in these tests.
- Three actual Admin Chromium cases (1440/768/390) pass with intercepted fixture traffic:
  Analysis text/actions/coverage/recent outputs, keyboard queue+refresh, 27 actual 8px pairs,
  44px buttons and no horizontal overflow. No real mutations or canonical recordings.
- Admin build/types, preview/demo/actual-spec strict types, scoped ESLint and six-entry preview
  build pass. Admin initial JS **526039 / 532480 B gzip**, nine assets, **6441 B headroom**
  (30 B below 1Z). Known Vite large-chunk advisory remains. Generated tracked tsbuildinfo restored.
- RED→GREEN: initial Analysis/whole-file policy expectations; missing preview section; controlled
  clock reproduces the preview-only old-refresh race before the generation guard. Initial
  full-ops fixture type assertion exposed legacy null/type mismatches; unit mocks now supply
  only the Analysis-owned projection. Explicit sample store typing fixes literal narrowing.
  One first-load embedding failure coincided with Vite config/optimizer restart; settled replay
  passes without timeout increases. Subsequent test/build chains are serial with workers=1.

Single fresh read-only review completed: **Critical 0 / Important 0 / Minor 0**; ready for
Diego's bounded checkpoint review. Reviewer independently inspected source, evidence logs and
visual/accessibility hierarchy in a private temporary tab, then closed it. No reviewer edits,
extra tests/builds or Git mutations; no second review round or repair pass was needed.

Advisory proof: `.artifacts/review/checkpoint-1aa-analysis.png` (public persistent preview with
1AA heading, real actions and metrics). The reviewer did not independently assess this later
proof/documentation append. The public tab stays at `?tab=albums&listenTab=history#analisis-admin`.

Preview now runs under transient user systemd service **`crate-v3-preview.service`**, independent
of the command session, with Node22 and `Restart=on-failure`. Its working directory is this V3
worktree and it binds only 127.0.0.1:5186. Service active/running, HTTP200 and IAB rendering verified.
Inspect with `systemctl --user status crate-v3-preview.service` and `journalctl --user -u
crate-v3-preview.service`; restart with `systemctl --user restart crate-v3-preview.service`.
This is a local process-lifetime measure, not a deployment or CI change.

Review limits accepted within Diego's bounded scope: unchanged task/backend/SSE/permission source
and intercepted contracts are preservation evidence, not real production integration. Actual AT,
cross-engine/native, real-data and canonical-reference QA remain open; fixtures are not substitutes.
Legacy layout/contrast/data behavior outside these icon/field changes is left for planned phases;
no attributable regression was found. Remaining Admin migrations, later instruments and
Listen/Desktop stay outside this group. Publication/merge readiness was not assessed; this is
an uncommitted checkpoint for Diego. The advisory proof/post-review docs are author-verified.

**Limits:** 1AA is one page, not completion of 1b.8 or later Analysis instruments. Native/actual
screen-reader, other engines, real-data, full phase QA and canonical Linux recording/comparison
remain pending. The 33 canonical captures/manifest stay at 1M; no baselines or full CI triggered.
Pinned `app/web@258bbaee` remains unavailable and unchanged; no vnext or substituted pin. Preserve
Listen's layered play/halo/progress ring and luminous thin seek trail from 1S. No PR, merge,
rebase, deploy or release. **Stop at 1AA for Diego before commit/push or the next group.**

### Same-checkpoint follow-up — remove Operator notes, 1AA (2026-10-18)

Diego requested deleting Operator notes. The four static guidance cards and their OpsPanel
retire; the enclosing 1.5fr/1fr split disappears so Recent outputs fills the available width.
Both recent-track cards keep their existing xl two-column / smaller stacked layout and data.
No task, snapshot/provider, shared, Listen/Desktop or permission change.

The existing content test first fails on Operator notes still being present, then passes after
removal. Fresh replay: **30 focused Vitest** (Analysis14 + source policy16) and **three preview
Chromium** (1440/768/390) pass. The browser cases assert no Operator notes and a Recent outputs
panel as wide as Pipeline coverage, plus the existing actions/states/8px/44px/no-network checks.
Admin build/types, preview strict types, scoped lint and diff checks pass. Latest Admin budget:
**526040 / 532480 B gzip**, nine assets, **6440 B margin** (1 B above the original 1AA build).
Generated tsbuildinfo restored again. No full suites/CI/canonical baselines or extra reviewer.

Advisory proof: `.artifacts/review/checkpoint-1aa-no-notes.png`; IAB shows the expanded Recent
outputs and no advisory panel. Public preview service remains active/running on :5186. The
single fresh review above covers the preceding revision; this small user-directed deletion is
verified by the focused checks here. **1AA remains local, awaiting Diego; no commit/push/next group.**

### Further follow-up — latest audio fingerprint, 1AA (2026-10-18)

Diego requested audio fingerprints in Recent outputs. This explicitly extends the earlier
presentation-only scope by one additive projection, `analysis.last_fingerprinted`: title, artist,
album, source and recorded computed timestamp; never the raw fingerprint/hash.

- `db/queries/management.get_last_fingerprinted_track` reads the newest nonempty, dated stored
  fingerprint, with deterministic id tie-breaking and optional caller session. No new column or
  migration. The new library query runs only in the background sampler, at the existing 120s
  cadence. Existing analysis/bliss reads move into a small worker helper, retaining the same
  cache key, cadence, error handling and coverage payload. No new HTTP query, endpoint or stream.
- `AnalysisStatusResponse` declares a defaulted FingerprintTrackSummaryResponse, reused through
  the existing ops schema; empty payload declares `{}`. Cached/stale snapshot forwarding is
  unchanged. Admin's field is optional and normalized to empty for old/missing data. The existing
  GET fallback is not extended with a new library query.
- Real Analysis and the persistent sample have three named result articles: analysis, Bliss,
  fingerprint. Explicit local kinds select the appropriate content; no fingerprint gets the
  Bliss explanation. Known source labels are Chromaprint/PCM fallback, unknown sources remain
  readable, absent sources are named. A dated result without title shows Untitled track.
  Full-width panel, xl three columns, smaller stacked layout; Operator notes remains removed.
- All eight task paths/bodies, queue callbacks, notifications, exclusive disabling/recovery and
  800ms refresh are preserved. AST audit of existing normalization fields, four helper/action
  bodies, two memos and eight queue calls passes. Source policy still bounds 34 UX sites.
  Shared/Listen/Desktop contracts, permissions and providers/connection ownership are unchanged.

Focused evidence after this amendment: **36 Vitest** (Analysis20 + policy16), **five preview**
and **three actual Admin Chromium** cases pass. **13 pytest** pass: eight query/worker/schema/API/
snapshot cases (including three real PostgreSQL tests), four relevant DB boundary cases and the
specific management OpenAPI/security/schema case. Query/schema/empty expectations failed first;
an extra dated-but-blank fingerprint reproduced a failure before its exclusion. Tests also cover
source variants, unknown/absent sources, untitled and legacy payloads. Worker publication is
mocked; a real daemon/SSE/backend deployment is not exercised. Preview stays entirely local.

Admin build/types, preview/demo/spec strict types, scoped frontend lint, Ruff 0.15.22 default CI
rules/format (`--isolated`, avoiding unrelated user-global rules), Prettier and six-entry preview
build pass. Broader user-global Ruff initially reported pre-existing import/exception rules plus
two new issues; the new export ordering/UTC issues were fixed. No repository lint configuration
was changed. OpenAPI/dependency deprecation and existing duplicate-operation-id warnings remain.
Latest initial Admin JS: **526053 / 532480 B gzip**, nine assets, **6427 B headroom** (+13 B vs
notes-removal build). Generated tsbuildinfo restored. Python 3.13.16 test tooling lives only in
ignored `.artifacts/backend-venv`/python-tools; no requirements/lock or other checkout edits.

Proof: `.artifacts/review/checkpoint-1aa-fingerprint.png`; contract audit:
`.artifacts/review/checkpoint-1aa-fingerprint-contract-audit.txt`. The earlier fresh review covers
its recorded revision; this additional user-requested data amendment has the focused evidence
above and no second review round. Later six-item recent/readout work is still pending; do not
mark 3.9a/3.9b complete. All previous canonical/native/real-data/full phase QA limits persist.
**Stop at local 1AA: no commit/push, next group, PR, merge, rebase, deploy or release.**

## Final Linux record — 1AA published; 1AB provisional / Dashboard analysis (2026-10-18)

Diego approved 1AA and authorised commit/push plus one further Admin icon group. Published
**1327270692937896072b3a3c79ad6cef6c1049b3**, `feat(ui): simplify Admin analysis and show latest fingerprint`;
local/remote SHA equality verified. Prepublication replay36Vitest,5preview and8backend cases
passed, including3realPostgreSQL cases. No PR/merge/rebase/release/deploy.

The next bounded group was Dashboard. Local 1AB removes redundant labelled action/navigation,
metric, task-status and album fallback/hover glyphs. Retains Loader2 on running tasks and
ChevronDown/Up on diagnostics:3 exact sites; source policy 37 UX sites across 11 whole files, bounded
ErrorState/ConfirmDialog consumers and externalNivo content retained. Disclosure adds expanded/
controls semantics and a hidden controlled region; targets44px, month/day readonly pairs8px.
No data/action/provider/permission changes. An18-entry structural AST audit confirms all six
private Dashboard helpers, sync callback, derived data/attention priorities, three Nivo charts,
queue/navigation/artwork calls, both confirmation contracts and Analysis normalization/memos/
eight queue calls are unchanged. Audit ignores formatting only and checks matching nodes exist.
Seventh isolated preview mounts real Dashboard with fictional ops/auth/actions/covers and real
album route building. No API/SSE traffic. All prior specimens remain.

User typography audit confirmed real drift: OpsPageHero H1 Poppins 24px, OpsPanel H2 Poppins 18px,
labels/values inherited Poppins; chips already Mono. Fontface imports were present. Admin common
Ops surfaces now use Bricolage page/subhead/numeral hierarchy and MonoLabel; Analysis local
headers, metadata and numeric readouts follow the same identity. Poppins body/controls remain.
The common surface correction reaches 10 Admin page consumers without changing public props or
workflows. Preview and actual Analysis checks verify 3 faces loaded, computed families per role,
8px fields and 44px actions. Visual review at 1310px also found the long Chromaprint label
overflowing its metric; a 1299px browser regression failed before container-based 2/4-column
grids fixed it. Labels are measured against their padded field, not their own overflowing box.
No shared/native/Listen/Desktop/fontasset/dependency changes.

Typography TDD initially 2 unit failures and computed H1 Poppins browser failure; Dashboard source/
UX/semantics expectations failed before removal. Two test harness errors were corrected (wrong
expected canonical album route and missing auth on rerender), not production contracts. Preview
replay initially used a locator whose accessible name changed from Show to Hide; corrected
locator, no timeout increase. Strict types caught sample literal narrowing/empty-record types.
First actual Admin replay did not start: new Testing Library tests incorrectly used Playwright's
`exact` role option. Removed unsupported options; subsequent Admin build/types pass.

User then rejected Dashboard's density and requested analysis rather than further UI development.
He confirmed the purpose: **whether the system and its jobs are functioning**. Read
`2026-10-18-crate-v3-dashboard-simplification-analysis.md`: diagnosis, proposed state/work/
intervention hierarchy, destinations for removed content and evidence limits. Existing Healthy
only checks postgres/watcher; snapshots/slots/updated_at cannot alone prove worker liveness or
useful progress. Recent task failures have no age/recovery filter; library volume is not severity.
The plan's four-tile Dashboard remains a historical planned target pending explicit revision;
this analysis does not approve a new Task 3.3 implementation. **1AB is provisional, uncommitted,
not formally reviewed or ready for approval; pause further product work at this analysis stop.**

Current scoped evidence: 64 Vitest; 6 Analysis preview (including 1299px); 4 Dashboard preview; 17 prior
Ops/Logs/Stack preview. Strict demo/preview/spec types, Admin build/types and bundlecheck pass.
Initial JS 526011/532480 B gzip, 9 assets, 6469 B margin, 42 B below 1AA. Full suites/CI, canonical comparisons
and actual AT/native/other-engine/production integration remain pending. 33 canonical PNGs/manifest at 1M
and site pin 258bbaee untouched. Actual Admin replay and final housekeeping status follow.

Final existing-work validation replay: **six actual Admin Chromium cases pass** (Analysis and
Dashboard at 1440/768/390). This includes real built CSS/fonts, keyboard/disclosure, card spacing,
art routes and intercepted typed rebuild/wipe requests. They never contact production. The
seven-entry preview build, scoped ESLint and formatting pass. Known generated tsbuildinfo is
restored from HEAD; diff check clean. No product changes implementing the new simplification
proposal were made. No fresh formal 1AB review was dispatched while the user is changing its
product structure. This is a recorded provisional stop, not a completed checkpoint.

Advisory font proof: `.artifacts/review/checkpoint-1ab-analysis-fonts.png`; 18-contract audit:
`.artifacts/review/checkpoint-1ab-contract-audit.txt`. IAB tab 2 remains on corrected Analysis and
marked deliverable; preview service active/running HTTP200. No 1AB commit/push or later group.

## Authoritative 1AB implementation — three-block Dashboard (2026-10-18)

Diego approved implementing the simplification with **only real available data**, keeping the
preview active and stopping at 1AB before commit. This supersedes the provisional analysis stop
above. The three-block composition supersedes the earlier four-tile Dashboard target in PD §4.1 /
Task 3.3; future HealthScanTile, governor/liveness/readout work and backend prerequisites remain
unimplemented. Task 1b.8 is not globally complete.

Production reads only the existing shared `useOpsSnapshot`; no new HTTP query, provider, stream,
backend/schema/dependency or polling. Admin-local `dashboard-model.ts` tests and interprets:

- Report built/expiry timestamps, explicit stale flag and refresh error. Missing/invalid/future
  metadata stays unknown. A cleaned-up local deadline timeout expires an open report even
  without another render. Stale work counts say Last report; old offline signals are not current
  interruption alerts. No clock-derived request loop.
- Explicit PostgreSQL, watcher and Event Redis booleans. Headline is scoped to reported
  services; unknown signals are not false/zero. Worker availability remains explicitly unreported.
- All five queue counts only when complete valid nonnegative integers, bounded task rows, safe
  JSON progress with real done/total or bounded percent, and separate analysis/Bliss active counts.
  No invented progress, ETA, throughput, stall threshold or global idle from an empty task list.
- Last dated completed/failed records, excluding invalid/future timestamps. Historical failures
  remain dated in Work, not asserted as unresolved/current blockers. Full worker slots, imports
  and DB-heavy admission waits do not create interruptions. Only fresh offline service reports
  produce attention rows, which move before Work when present.

Shared InstrumentPanel/MonoLabel/ProgressHairline make three quiet regions, with Bricolage
titles, Poppins body/controls and Mono technical metadata. No KPI mosaic, recent albums/shows,
charts, footprint or advanced diagnostics. Existing capability-gated System/Stack/Tasks/Analysis
routes provide detail; `/tasks?task=<encoded-id>` is an existing Tasks consumer contract.
Maintenance is an explicit secondary AppModal: sync, rebuild and wipe stay accessible. Destructive
actions preserve the previous admin-only restriction and check `library.maintenance.manage`;
sync checks `library.import.manage`, matching existing endpoint permission checks. Both original
ConfirmDialog nodes/callbacks, three mutation calls, sync toasts and shared provider call pass
a structural audit against HEAD. No permission grants or route additions.

One Dashboard Loader2 site is retained; the retired diagnostics chevrons leave the policy.
Policy bounds 35 named UX sites across 11 whole files, plus exact shared AppModal/ErrorState/typed
confirmation callsites. Buttons/links 44px and stacked fields 8px. Earlier Analysis/Ops typography
corrections remain part of 1AB; long technical metric labels are covered by the prior 1299px case.

Focused evidence so far: **79 Vitest** (model 19, Dashboard 13, icon policy 16, Analysis 21, Ops 10),
**five Dashboard preview** and **seven actual Admin Chromium** cases pass (Dashboard 3 widths,
long unbroken mobile data, Analysis 3 widths). Actual Admin build/types pass; strict demo/preview/
spec TypeScript passes. Model/page expectations were observed RED before implementation; an
additional stale Work-caption expectation failed then passed. An unsupported Vitest--grep
invocation was corrected to -t before that RED run; no skipped test is counted as evidence.
The first progress-history text assertion needed a prefix matcher, not a product change.

The preview has seven explicit fictional states: active, idle, service interruption, expired,
partial, loading and first-load failure. Actual components and provider-shaped data; all local
actions are intercepted and no API requests leave the sample. Refresh renews its report.

Latest built initial JS: **526458/532480 B gzip**, 10 assets, **6022 B margin** ( +405 B vs published 1AA).
Current contract evidence: `.artifacts/review/checkpoint-1ab-simplification-contract-audit.txt`.
The earlier 18-contract audit describes the pre-simplification revision only; removed Dashboard
helpers/data/chart markup are intentional approved changes, not claimed unchanged now.
Final browser replay, lint/preview build and fresh read-only review are recorded next.

Limits: no real production worker/backend/SSE health verification, actual AT/native/other-engine
or full phase QA. No full suites/CI, canonical PNG/manifest regeneration, alternate site pin,
SmartMix, PR/merge/rebase/deploy/release. 33 canonical PNGs/manifest remain 1M; `app/web@258bbaee`
remains unchanged/unavailable. **Stop at 1AB for Diego; no commit/push or another group.**

Final pre-review replay:11affected preview Chromium cases pass (Dashboard5 + Analysis6), seven
actual Admin Chromium cases pass, scoped lint and strict types pass, Admin/7-entry preview builds
pass. Scoped lint initially rejected an unnecessary regex escape; equivalent startsWith checks
replace it,19model cases replay green and final builds/budget pass. Final initialJS526458/532480B
gzip,10assets,6022Bmargin. Prior browser evidence precedes only that equivalent parser expression
and documentation formatting. Generated tsbuildinfo restored; diffcheck clean. No further UI
changes during fresh read-only review.

### 1AB read-only review and producer interpretation repair

The fresh reviewer found no Critical, two Important interpretation issues and one Minor stale
status-table row. All are accepted. The row now records the implemented three-block checkpoint.
One bounded RED→GREEN repair pass adds divergent/missing Redis and independent analysis metadata
regressions: ten new assertions failed before repair, then **89 focused Vitest cases passed**
(model 26, Dashboard 16, policy 16, Analysis 21, Ops 10). No second review round or new group.

- Event Redis now reads `eventing.domain_events.redis_connected` from the durable domain-event
  producer, independently of the top-level cache Redis flag. Missing nested data stays unknown;
  the detail names domain-event delivery. Existing payload/provider/types are unchanged.
- Analysis respects its producer's own `stale` and `unavailable` markers. Unavailable suppresses
  counts; stale counts say last reported and out of date. Absent markers, including REST's
  schema-stripped response, leave section freshness unknown. A fresh outer snapshot cannot
  promote old counts to current daemon activity. A reported count is never a worker heartbeat.

The reviewer performed source/evidence inspection only, with no tests/builds/browser sessions,
production access, file/index/HEAD mutations or delegation. Executor rulings on uncertified areas:

- Cached/default PostgreSQL/watcher/Redis flags are only reported connectivity; actual service
  and worker liveness remain unverified and need producer/phase QA, outside this UI change.
- Task dates show recorded updates, not useful advancement, stall detection or failure recovery.
  No added inference, threshold or follow-up implementation is warranted by available data.
- Shared Ops public props/workflows remain unchanged. Representative Ops surfaces and Analysis
  geometry have scoped evidence; fresh visual inspection of all ten consumers is not claimed.
- Chromium supports the nested-dialog contract. Actual AT/native/other-engine verification stays
  pending; no full-suite replay is justified for this local checkpoint.
- Current task persistence/emission supplies serialized progress strings. Broad schema permission
  for structured objects is not a verified current producer path; no speculative parser/API
  expansion. Unsupported data remains unavailable.

Post-repair Admin build/types and three strict scoped TS configs pass; scoped ESLint passes from
its Admin config directory. Initial JS is now **526461/532480 B gzip**, ten assets, **6019 B margin**
(+408 B vs published 1AA). Four actual built-Admin Dashboard Chromium cases pass, including
cache/event Redis divergence, desktop/tablet/mobile, long mobile text and intercepted maintenance.
The isolated test config serves the already-built Admin to avoid a redundant build. Its first
import-based attempt did not inherit Playwright options correctly: baseline guard stopped the
first run and missing baseURL stopped four navigation cases before rendering. Replacing only
that ignored harness with explicit original config options and `--update-snapshots=none` fixed
the harness; no canonical files changed. An initial root ESLint invocation lacked its scoped
config; the corrected Admin invocation passes. These setup failures are not product test passes.

Final repair validation: five Dashboard preview Chromium cases and the seven-entry preview build
pass. Together with the unchanged Analysis evidence, checkpoint coverage is **11 preview + seven
actual Admin Chromium cases**; the final repair replay is Dashboard's five + four. Final contract
audit still passes. No source edits follow this evidence, only docs/formatting and restoring the
known generated tsbuildinfo from HEAD. Preview service remains active/running HTTP200 at :5186.
Advisory visible proof: `.artifacts/review/checkpoint-1ab-dashboard.png`, saved from public IAB tab 2
and marked deliverable. It shows the three real blocks and explicitly unknown analysis freshness
for the REST-shaped fixture. This is not a canonical baseline. Execution checklist is complete;
Diego's visual approval remains pending. **1AB stays uncommitted; no push or next group.**

## 1AB visual approval and publication authorisation — 2026-10-18

Diego approved 1AB and explicitly requested commit/push and the next bounded Admin icon group,
retaining UX glyphs, the active preview and a review stop at the next checkpoint (1AC). This
supersedes the 1AB publication stop above. The approved product implementation is unchanged;
only the specimen/status and publication records change before commit. Fresh scoped publication
evidence and the resulting SHA will be recorded with the next checkpoint. No PR/merge/rebase,
deploy/release, full suites/CI or canonical baseline regeneration is authorised.

Fresh pre-publication replay: **89 scoped Vitest + five Dashboard Chromium** pass serially
with one worker. Approved product source is unchanged since the final 1AB build/budget and
producer-fix evidence. The specimen now says 1AB published; all historical checkpoints remain.

## Final Linux record — 1AB published; 1AC System Health review (2026-10-18)

Diego approved 1AB and authorised commit/push plus one next bounded Admin icon group. It is
published as **2d047fecd4721ac4575faadbf9bd8781eec37c5b**, `feat(ui): simplify Admin Dashboard into
three reported-state blocks`, with origin branch SHA verified. The fresh pre-publication replay
passed 89 Vitest / five Dashboard Chromium. This supersedes all earlier 1AB review/publication stops.

The next group is SystemHealth alone, from the reviewed 1V operations/settings inventory.
No shared/Listen/Desktop, backend/provider/schema/dependency or other-page workflow changes.
Task 1b.8 and future SystemHealth Task 3.4 remain incomplete globally. The V3 worktree and preview
user service remain isolated from the MCP checkout; existing checkpoints/pin/baselines are intact.

1AC removes ten Lucide import bindings, redundant header/resource/score/elapsed glyphs and the
local ResourceCard icon prop with all six callers. There are no direct retained page glyphs;
Nivo charts and the shared playback meter remain instruments. No new permanent exception.
The source policy now covers twelve whole files, still 35 individually bounded UX sites plus
its existing bounded shared controls. Unmigrated Admin/Listen/Desktop icons are not altered.

Refresh is a visible shared Button. Window 1h/24h uses shared radio chips with named group,
arrow-key selection and the exact existing minute/60 / hour/1440 query. Chips retain 32 px fine
pointer / 44 px coarse pointer; refresh is 44 px. The first overly broad 44 px test for all controls
was corrected to the established shared chip contract, removing an ineffective local override;
no foundation variant or shared CSS change. Header summaries retain consistent static tags.

Resource/score numerals and local titles use Bricolage; labels/readout metadata use Mono,
body/refresh Poppins. `.crate-form-field` supplies real 8 px for resource/score, labelled progress,
and stacked route readings. Mobile route measurements use a compact 2×2 arrangement; long task
text wraps in a responsive row. Measurement values, expressions, ordering and callback data
remain. No new metric, health guarantee, inference, stream, polling, endpoint or route.

The AST audit against 2d047fec confirms unchanged helpers, score/summary and other page
calculations/hooks, route/playback calculations, Nivo series/props and all 13 chart consumers,
shared meter props, task progress/elapsed calculations, six resource label/value/children
contracts and refresh callback. Evidence: `.artifacts/review/checkpoint-1ac-contract-audit.txt`.
Existing SystemHealth score/default/availability semantics are preserved, not independently
certified by this icon migration; its later product/data phase remains responsible for them.

An eighth isolated persistent entry imports the actual page and redirects only that page's
useApi/task-catalog dependencies to fictional data. Activity/pressure samples, local query and
refresh feedback use a new existing-shaped fixture. No API or stream is called by the sample.
Review `/#sistema-admin` or `admin-system-health-demo.html`; all prior specimens remain, with
1AB published and 1AC in review. No new backend or actual task action is needed.

Focused evidence so far: 27 Vitest (System Health 11 / policy 16), four preview Chromium cases at
1440/768/390 including embedding, three strict scoped TS configs and scoped ESLint pass.
Original RED preceded removal (four failures), and the missing embedding failed before addition.
One elapsed assertion needed a split-text matcher correction, not a product behavior change.
All existing meter/partial-payload tests remain green. Final built-Admin checks/review follow.
Admin build/types pass; initial JS **526781 / 532480 B gzip**, ten assets, **5699 B margin** (+320 B vs 1AB).

Limits: no real runtime/metrics/SSE or worker liveness certification, native/AT/other-engine QA,
full suites/CI, canonical recording/comparison or replacement of `app/web@258bbaee`. The 33 PNG/
manifest remain 1M; Linux/native follow-up remains pending. No SmartMix, PR/merge/rebase/deploy/
release. **Stop at 1AC for Diego before commit/push or another group.**

Final actual Admin replay: **four Chromium cases pass**, including desktop/tablet/mobile,
unchanged window query and refresh, real 8 px field boxes, instruments and long unbroken mobile
task/route text. All traffic is intercepted. It serves the already-built Admin with an ignored
config override, so the build is not repeated. Final lint/types/build/budget remain green;
preview build and the fresh read-only checkpoint review follow.

The eight-entry preview build passes. Advisory screenshots from public IAB tab2 are saved as
`.artifacts/review/checkpoint-1ac-system-health.png` (header/metrics) and
`.artifacts/review/checkpoint-1ac-resources.png` (resources and preserved Nivo charts), without
canonical capture changes. The public tab is marked deliverable. Source is frozen during the
one fresh read-only review; final review rulings and service check follow.

### Final 1AC review and stop

The one fresh-context read-only reviewer found **Critical 0 / Important 0 / Minor 0 actionable**
and considers 1AC ready for Diego's local review. Source/contract and test implementations were
inspected independently. In a private hidden tab the reviewer exercised arrow selection to
`hour&minutes=1440`, local Refresh and the pressure sample, then closed that tab; existing user
tabs were untouched. The reviewer ran no suites/builds and changed no files/index/HEAD.
No repair pass or second review round is needed; product source remains frozen.

Executor rulings on areas the reviewer declined to certify:

- Existing SystemHealth score/default/health semantics and metric authority stay preserved;
  later Task 3.4/data work owns improvements. This migration adds no runtime health guarantee.
- API/SSE integration, worker liveness and runtime capability enforcement need real integration
  QA. Existing requests and production routing/capabilities are unchanged; this group uses only
  fictional/intercepted traffic and requires no backend or production operations.
- Actual AT/native/other-engine and exhaustive mobile QA remain pending. Evidence covers
  Chromium 1440/768/390 and the long mobile case, not every device or assistive technology.
- Test/build/budget outcomes are executor-run evidence: 27 Vitest, four preview/four actual Admin
  Chromium, three strict TS configs, scoped lint and both builds pass. The reviewer inspected
  their source/evidence without independently replaying them; no duplicated runs are claimed.
- This is a bounded visual checkpoint, not completed Task 1b.8/3.4, full-phase or merge/release QA.
  Diego's visual approval remains pending. Final appendices record evidence/status only and were
  added after the reviewer snapshot; no product source changed afterwards.

Final initial JS remains **526781 / 532480 B gzip**, ten assets, **5699 B margin**. Formatting and
diff checks pass; known generated tsbuildinfo is restored from HEAD. Preview user service remains
active/running HTTP200; public SystemHealth tab is marked deliverable, with the two advisory
proofs above. HEAD/origin remain the published 1AB SHA 2d047fec; all 1AC files stay uncommitted.
**Stop at 1AC for Diego: no commit/push, another group, full CI/baselines, PR/merge/rebase/deploy/release.**

## 1AC visual approval and publication authorisation — 2026-10-18

Diego approved 1AC and explicitly requested commit/push plus the next bounded Admin icon group,
retaining UX glyphs, the active preview and a review stop before the next checkpoint publication
(1AD). This supersedes the previous 1AC publication stop. Approved product source is unchanged;
only the specimen/status records change before commit. Fresh scoped publication evidence and
the resulting SHA follow. No full suites/CI, canonical baselines, PR/merge/rebase/deploy/release.

Fresh pre-publication replay: **27 scoped Vitest + four System Health Chromium** pass
serially with one worker. Approved product source remains unchanged; specimen now says published.

Published 1AC as **`439b3e78daf2719d86cee72dd5726f7bc210c504`**,
`refactor(ui): retire redundant System Health icons`. HEAD/origin/remote branch agree.
Approved product source was unchanged during publication. The next authorised group is Library
Health alone; other Admin pages remain pending.

## Final Linux record — 1AC published; 1AD Library Health review (2026-10-18)

1AD changes only `app/ui/src/pages/Health.tsx` and its local IssueRow/ArtistGroupHeader in
production. It removes seven redundant Lucide bindings, the severity icon registry, header/empty
icon boxes and labelled-action decoration. Three named loaders and two disclosure chevrons
remain, with visible busy state and accessible labels. The source policy now covers **13 whole
files / 40 individually bounded UX sites**, adding exactly one shared ErrorState and ConfirmDialog
consumer for Health. Five neutral SeverityMeter instruments remain unchanged.

OpsPageHero replaces the duplicated hero. Labels use JetBrains Mono, titles/readings Bricolage
Grotesque and body/actions Poppins. Three Repair lanes readings use `.crate-form-field` at actual
8 px. Text scan/fix/cleanup/dismiss/resolve/repair/task-log and artist-link targets are 44 px;
existing filter pills retain 32 px fine / 44 px coarse pointer. Responsive issue rows and long
artist/path text fit the viewport without clipping essential action text.

The former outer group button contained action buttons. Each group now has one named
Expand/Collapse button with `aria-expanded`/`aria-controls` and a matching named section, beside
independent text actions. Space expands it; resolve/dismiss/fix/cleanup do not toggle it.
Confirmation cancel restores focus to Fix all. Existing repair eligibility, paths/body/IDs,
role gate, empty/health interpretation and task completion behavior are preserved. No new
runtime/data authority or HealthScanTile contract is claimed.

The structural audit against `439b3e78` confirms unchanged **21 helper/fetch/mutation bodies,
25 hooks/effects/stream/task-completion bodies, nine API call expressions, nine inline action
callbacks**, shared ConfirmDialog JSX, five SeverityMeter props and artist path builder. The
sole removed inline callback is the obsolete header actions `stopPropagation` wrapper: sibling
controls replace that structure and tests cover action isolation. Health's data/state prefix,
3s/5s reconnect, cleanup, filtering, notifications and gates are unchanged. Evidence is in
`.artifacts/review/checkpoint-1ad-contract-audit.txt`.

A ninth isolated preview entry mounts the actual Health page. Only that page's API/task-event
imports are adapted; EventSource is replaced within the entry. Existing-shaped fictional data
covers automatic, artist bulk, manual and cleanup lanes. Local Resolve/Dismiss/scan/repair actions,
confirmation and manual task completion revalidate the page. Five modes cover ready/loading/
empty/missing catalog/service failure, with a fresh generation on reset. The specimen makes no
API/SSE calls or production/library changes. All older checkpoints remain. Review
<http://127.0.0.1:5186/admin-health-demo.html> or persistent `/#salud-admin`.

Scoped verification: **30 Vitest** (nine new component, five existing helper, 16 source-policy),
**four preview and four built-Admin Chromium** cases at 1440/768/390 plus long mobile text.
They cover named keyboard disclosure, independent callbacks/correct issue IDs, filter query,
scan/busy/completion, repair confirmation/focus/routes, prior role gate, loading/empty/retry,
neutral instruments, fonts, three actual 8 px gaps, target sizes and viewport overflow.
All built-Admin traffic is intercepted; sample checks reject API traffic and browser errors.
Initial unit/policy RED and missing embedding RED preceded implementation.

A preview mobile failure exposed an implicit grid track expanding a 390 px viewport to 666 px;
using document clientWidth exposed it even when innerWidth auto-scaled. The new entry alone now
uses an explicit min-width-zero single-column grid and region. Four preview cases pass after
that fix, with no force-click, timeout inflation, global CSS or layer change. A built-Admin
43.999992 px report for a 44 px target was rounded to 0.01 px in the two new measurement tests;
all four built cases then passed. A unit rerender missing AuthContext and a typed exact-name
option were test harness corrections, without production behavior edits.

Admin build/types pass. Initial JS is **526766 / 532480 B gzip**, ten assets, **5714 B margin**,
15 B less than published 1AC. Final preview build, strict scoped types/lint, fresh independent
read-only review and advisory screenshot follow in this record as they complete.

Limits: no shared/Listen/Desktop, backend/provider/schema/dependency or other-page workflow
changes. Existing Health gate/empty interpretation is retained, not redesigned or certified.
Real API/SSE/runtime/worker integration, native/AT/other-engine QA, full suites/CI and phase-close
validation remain pending. No local canonical captures: 33 PNGs/manifest remain 1M; pin
`app/web@258bbaee` stays unchanged/unavailable. Task 1b.8 and later Health phase are not complete.
**Stop at 1AD uncommitted for Diego. No further group, PR/merge/rebase/deploy/release/Smart Mix.**

The nine-entry preview build, three strict scoped TS configs and scoped ESLint pass. Known
build-generated `app/ui/tsconfig.tsbuildinfo` was restored from HEAD. No dependency or source
changes are needed for those checks. Source now freezes for the one fresh read-only review;
final review rulings and advisory proof will be appended without further product edits.

### 1AD fresh review rulings and one repair pass

The one fresh-context read-only reviewer inspected all tracked/untracked pending implementation,
tests, fixtures and documentation. It reported **Critical 0 / Important 1 / Minor 1**. The reviewer
ran no checks, changed no files/index/HEAD and used no user browser tabs. Its initial verdict
held readiness for the accessible-summary repair; no second review round was requested.

Both findings are accepted and addressed together:

- Important: the short Expand/Collapse accessible name suppressed the metadata-derived summary.
  `aria-describedby` now links a stable ID on the visible summary, retaining count, severity,
  risk, scope, checked time and confirmation warning when collapsed or expanded. Explicit word
  separators and a screen-reader-only singular/plural issue noun keep the count understandable without
  changing the visible layout. Unit and both browser harnesses assert the accessible description,
  including the artist review warning. The new assertion first failed with an empty description;
  its intermediate concatenation failures guided word spacing before the green component run.
- Minor: the initial fictional health task now supplies its actual four `issue_count`, and local
  task completion emits a health count or repair `summary.applied` as appropriate, plus remaining
  issues after revalidation. The sample no longer reports zero found/applied for those operations.
  A focused preview case first failed on the missing four-issue reading; scan completion and
  repair completion now assert `4 issues found` and `1 applied, 2 open after revalidation`.
  This fixes fictional payloads only, without changing production summary/default semantics.

Executor rulings on every area the reviewer declined to certify:

- Existing Health/empty interpretation, permissions and repair eligibility remain preserved;
  later Health/data work owns redesign or certification. This group adds no health guarantee.
- Actual API/worker/filesystem/task/SSE and reconnect timing need integration QA. The AST audit
  still confirms the preserved request/effect/callback contracts; inert or intercepted samples
  do not prove live execution. No real operation was performed.
- Actual screen-reader speech, native/other-engine, exhaustive viewport/zoom and subjective
  approval remain pending. Accessible-description/name/focus checks and sampled Chromium widths
  support this checkpoint only; Diego owns visual approval.
- Full suites/CI, canonical screenshot equivalence and the unavailable site pin remain pending.
  The 33 PNGs/manifest stay at 1M; no new canonical baseline was generated or substituted.
- Broader Admin retirement and Listen/Desktop behavior are outside this group. Those sources
  remain untouched; Task 1b.8 and later Health instruments are not globally complete.
- Bundle is the only newly measured performance evidence. Runtime profiling, deployment and
  release readiness are not certified or authorised by this checkpoint.

The one repair pass preserves the structural audit: 21 helpers, 25 hooks/effects, nine API calls,
nine inline callbacks, confirmation, severity props and route builder unchanged. Final replay,
service/proof status and review stop follow. No further product edits or repeated reviewer round.

### Final 1AD evidence and review stop

After that single review repair pass, **30 scoped Vitest, four preview Chromium and four built-
Admin Chromium** pass on the final source, serially with one worker. Three strict scoped TS
configs, scoped ESLint/Prettier, contract audit, Admin build/types and nine-entry preview build
pass. Final initial JS is **526766 / 532480 B gzip**, ten assets, **5714 B margin**, 15 B below 1AC.
The final unit result is `checkpoint-1ad-unit-final.log`; the unsuffixed unit log intentionally
preserves the historical 29/30 AuthProvider harness failure. Both browser logs end in four passes.

Current advisory proofs are `.artifacts/review/checkpoint-1ad-library-health.png` and
`checkpoint-1ad-library-health-actions.png`, captured after the repairs in public IAB tab2.
The page visibly shows four found/four open, and the expanded artist group exposes the text
controls and retained chevron. Tab2 is marked deliverable; other user tabs were untouched.
Preview service remains active/running, HTTP200 at the Library Health URL; Node22/worktree and
forwarding remain in place. Generated tsbuildinfo is restored from HEAD. Final formatting/diff
checks pass. These final evidence/ruling appendices were added after the reviewer snapshot;
there is no second independent review verdict or unreviewed new product scope.

HEAD/origin remain published **439b3e78** (1AC); all 1AD changes are uncommitted. Both findings
are addressed and executor verification is green; Diego's visual review is now the next gate.
**Stop at 1AD: no commit/push, further group, full suites/CI/baselines, PR/merge/rebase/deploy/release.**

## 1AD follow-up — issue-queue sketch requested, 2026-10-18

Diego has not approved 1AD. He dislikes the current Health composition and chose option 1:
see library problems and how to resolve them. He explicitly requested a sketch before implementation.
Only the throwaway visual companion is authorised in this follow-up; no product redesign or
publication is approved. Existing 1AD product source/tests/preview remain intact and uncommitted.

The proposal is a single severity-ordered issue list with a compact last-scan line, a clear next
action per problem, and expandable case/resolution details. Activity and the check catalog move
to secondary references. It distinguishes no registered issues from no available check result.
The standalone Spanish sketch reuses current V3 fonts/tokens/CSS from :5186, with the four existing
fictional issue cases. Local controls demonstrate disclosure and the two empty/result states.
No backend, library operation, new dependency, canonical screenshot or test/build suite is involved.

Draft HTML: `.superpowers/brainstorm/873853-1792323386/content/health-inbox-v1.html` (ignored).
Connection metadata, including its local-only session key, stays in that session's ignored
`state/server-info`; do not copy the key into tracked docs. The separate public IAB tab5 is marked
deliverable; existing user tabs and persistent :5186 preview stay intact. Advisory proof is
`.artifacts/review/health-inbox-sketch-v1.png`. Await Diego's reaction to the sketch before
writing the final composition/implementation plan or changing Health. No commit/push/next group.

## Authoritative 1AD composition — approved issue queue (2026-10-18)

Diego approved the separate issue-queue sketch and requested implementation using only real
available data, with the persistent preview active and a 1AD review stop before commit. This
supersedes the prior sketch-only stop and icon-only composition, without approving publication.
The existing V3 worktree, branch and pending icon retirement remain; HEAD/origin is still
439b3e78 (published 1AC). MCP checkout remains untouched.

Production stays in Health.tsx. A flat severity-ordered issue queue replaces the large boxed
hero/impact/lanes/catalog composition. Each named Review issues button opens actual artist-grouped
cases and a How to resolve pane containing the existing catalog-driven repair/cleanup controls,
Resolve/Dismiss and artist repair links. Queue repair is an action label, not a new endpoint.
Check-level risk/scope are shown once in that pane; issue-specific severity, descriptions,
cleanup-blocked reason and alternate paths remain. Paths now wrap visibly instead of truncating.
Activity, available checks and existing type-filter pills live in secondary native disclosures.
An active filter stays explicit and can be cleared even when no loaded cases match it.

Data authority is intentionally narrow:

- Primary totals come from existing per-check open counts; the endpoint's `total` is loaded row
  count, not the whole library. The REST/SSE default is 500 rows, max 1000. Loaded/recorded
  differences are explicit globally and per check. No invented paging or completeness claim.
- `groupHealthIssues` prioritises the worst severity among all loaded cases in each check,
  preserves every case and unknown names/levels, then sorts ties deterministically. The caption
  explicitly says loaded issues; unloaded cases have no fabricated severity.
- The maximum existing per-check run timestamp is Latest check, not evidence of a full-library
  scan. No open issues recorded is distinct from No check result available and zero-match filter.
  Existing snapshot.stale is read at REST/SSE ingestion and shown as recorded data possibly old.
- Historical activity counters render only valid explicit nonnegative integer values. Zero is
  shown when supplied; missing/null/invalid values stay unavailable. Completed is a task status,
  not a healthy-library assertion. Activity history never supplies the primary queue count.
- Catalog failure still permits issue inspection/Resolve/Dismiss, but promises no automatic or
  manual repair capability. Capabilities/eligibility are exactly the existing catalog conditions.

The request/stream audit against the saved pre-composition source confirms **20 existing
helpers/mutations unchanged**, **nine API call expressions/arguments**, **12 effect/query/reference
calls** (apart from the two stale metadata assignments), **13 existing state initialisers**, all
**nine existing inline action callbacks**, shared ConfirmDialog behaviour props/flow and artist route builder.
The only new inline callback clears the existing filter. Issue path/blocked-reason derivation
is unchanged. Intentional changed presentation helpers are task summary/status and worst-severity
grouping. Evidence: `.artifacts/review/health-inbox-contract-audit.txt` and its reproducible script.
No backend, route/capability/provider/schema/dependency/shared/Listen/Desktop changes or new streams.

All five bounded Health loader/disclosure glyph sites remain; the whole-Admin policy is still
13 files / 40 sites, not whole 1b.8 completion. Bricolage headings, Mono labels/metadata and
Poppins body/actions use the existing identity. Both Detected cases / How to resolve pairs use
`.crate-form-field` at actual 8 px; action/summary targets are 44 px, pills remain 32 px fine /
44 px coarse. MonoLabel's existing div with heading role/level 4 is used without a shared API edit.
The Admin UI remains English; the separate Spanish sketch is historical brainstorming material.

The persistent entry imports actual Health with its same isolated fictional boundaries. Nine
modes now include no result, stale, limited and mixed severities. The limited sample preserves
unloaded counts through local resolve/scan revalidation; completed task counts use recorded
counts instead of loaded row length. A scoped failing browser case exposed this adapter issue
before correction. Group/dismiss/repair samples remain local and make no API/SSE/library writes.
All previous specimens and the :5186 user service are preserved.

Scoped evidence on this source: **54 Vitest** (22 helper / 16 component / 16 source-policy),
**six preview Chromium + four built-Admin Chromium** pass serially with one worker. Cases cover
mixed severity, unknown/missing/zero task data, real issue IDs/actions, confirmation/focus, role,
filter/revalidation/cleanup, actual 8 px, font families, target policy, long mobile text and
viewport bounds. New helper/page/missing-mode/limited-counter REDs preceded their fixes.
Playwright summary locators were corrected to include nested metadata; the empty-state assertion
now targets its heading rather than matching hidden catalog text. No source workaround or extra
wait/force-click was needed for these harness corrections.

Three strict scoped TS configs, scoped lint/format, Admin build/types, nine-entry preview build
and budget pass. **Initial JS 526787 / 532480 B gzip**, ten assets, **5693 B margin** (6 B above
published 1AC; 21 B above the earlier icon-only 1AD). Known generated tsbuildinfo is restored.
The fresh read-only composition review, advisory proof and final service/status ruling follow.

Limits remain: actual backend/worker/filesystem/SSE timing integration, AT/native/other engines,
exhaustive viewport/zoom, phase-close/full suites/CI and canonical recording/comparison are pending.
The 33 canonical PNGs/manifest remain 1M; app/web@258bbaee stays unchanged/unavailable. This adopts
Health's approved composition, not future HealthScan/live-provider/cursor/pagination/data work.
**1AD stays uncommitted for Diego. No next group, commit/push, PR/merge/rebase/deploy/release.**

### Fresh composition review, executor rulings and final 1AD stop

The fresh read-only review covered the full pending diff, including ten untracked sources,
tests and fixtures, against published 1AC. It returned Critical 0 / Important 0 / Minor 2 and
readiness for Diego's visual review, not publication. One combined repair pass accepted both
Minor findings: remove the duplicate screen-reader issue age now that the chip is visible at
all widths, and update guidance to name the current Queue repair control.

Executor ruling on the review's declined repair-completeness area: the preserved confirmation
copy presented a loaded count as the full batch scope, despite the existing check-wide endpoint.
That concrete UI claim is Important and belongs to this data-authority change. The same repair
pass changed only the dialog title/description/consequence: Queue artist repairs now describes
eligible repairs across the library, separately states the loaded auto-fixable count and the
recorded open count for that check (or unavailable), and names the filesystem/re-sync consequence
without using loaded count as total affected. No confirmation callback, request, eligibility,
worker or target algorithm changed. A new regression with one loaded auto-fixable case and 600
recorded open cases was observed RED before the fix, then all 54 scoped cases passed. The two
Minor fixes use existing component/browser/AX evidence; no implementation-mirroring tests added.
There was no second reviewer loop.

All declined areas have explicit rulings:

- Visual acceptance/sketch fidelity belongs to Diego. Actual :5186 overview and expanded detail
  were inspected and saved as advisory proof; no visual approval is inferred from unit tests.
- Backend permissions, worker/filesystem effects, freshness and full library coverage retain
  existing contracts. Mocked API/catalog and isolated samples do not prove live integration.
- Live SSE/reconnect races and filtered repair completion remain integration limits. Existing
  connection/callback source is unchanged (apart from stale metadata); focused tests exercise
  filtered scan refresh/cleanup, not all real timing combinations.
- The deliberate keyboard focus destination after removing the last case/group is unproved.
  Existing removal behaviour is retained; confirm cancellation/focus and correct removal IDs
  pass, but disappearance focus is reserved for accessibility QA or a targeted follow-up.
- Screen-reader/native/other-engine and exhaustive viewport/zoom QA remain pending. Chromium
  covers 1440/768/390, accessible names/keyboard, targets, font families and 8 px measurements.
- Full suites/CI/canonical capture/site parity remain pending. No canonical baseline was changed;
  the 33 PNGs/manifest still belong to 1M and app/web@258bbaee is unchanged/unavailable here.
- Future HealthScan/providers/pagination and actual repair completeness outside loaded results
  remain pending. Only the misleading UI scope claim was raised and repaired here; no hidden
  worker outcome or complete scan is certified.

Final post-repair evidence: **54 Vitest + six preview/four built-Admin Chromium**, serial one
worker; three strict scoped TypeScript configs, scoped lint/format, contract audit, Admin build
and nine-entry preview build/budget pass. **526787 / 532480 B gzip**, ten initial assets,
**5693 B margin**. Known generated tsbuildinfo was restored. Only the clarified confirmation copy
is excluded from the unchanged-props audit; open/change/confirm flow and label remain identical.

Advisory proof (ignored, not canonical):
`.artifacts/review/checkpoint-1ad-health-inbox.png` and
`.artifacts/review/checkpoint-1ad-health-inbox-details.png`. The real isolated sample is open and
marked deliverable at <http://127.0.0.1:5186/admin-health-demo.html>; the user preview service is
active and the entry returns HTTP 200. All earlier mockup checkpoints are preserved. Production
uses real existing endpoints; the no-backend specimen deliberately uses labelled fictional data.
HEAD/origin remain **439b3e78** / feat/crate_v3; no 1AD commit/push or next group.
**Stop at 1AD for Diego's review before commit.**

## Final current 1AD — visual drift corrected, review before commit (2026-10-18)

Diego authorised correcting the visual drift after comparing the approved sketch with the
initial composition. This supersedes its earlier visual-readiness claim and style/budget
measurements. Product/data composition remains the approved issue queue; no 1AD publication
approval has been given. HEAD/origin are still published 1AC `439b3e78`, branch `feat/crate_v3`.

Restored in actual Health:1 px accent-action detail rail; accent-action-hi expanded disclosure;
one primary next step per context (existing artist-review link after actual cases, or eligible
direct repair where no artist-review action is available). Existing secondary mutations remain
visible with lower weight. Case severity/age share a compact row, Dismiss all shares the repair
control row, and the existing filter disclosure shares the heading row. Case/repair data,
recorded/loaded totals, confirmations and all eligibility rules remain. Unlinked cases retain
their full paths and Resolve/Dismiss without an invented artist-review link.

The reviewed domain composition now uses1128 px maximum content width, 36–54 px/700 Bricolage
H1, 27 px/650 section and 23 px/600 issue headings, caption body and the existing Poppins/Mono,
semantic colours and shared Buttons. This applies Diego's approved sketch within Health;
it does not create a global type-scale change or app-specific foundational component. Detail
columns have32 px gap and existing `.crate-form-field`8 px spacing, actions 44 px; the narrow
layout wraps without horizontal overflow. English Admin labels/data-specific copy remain.

The grey rail was not a missing utility: shared typography.css's unlayered universal border
colour outranked the generated Tailwind utility. The only shared change moves that default to
base with `:root, :root *` so it beats preflight's later universal reset while yielding to
component/utility layers. The first base-only trial restored accent but changed the unqualified
default to currentColor; the new real CSS-entry regression caught this before final correction.
Actual Admin and Listen CSS now preserve accent, quiet, transparent and default border colours.
No `!important`, local symptom override, new token/theme/variant or shared JS/API change.

Scoped evidence:

- **55 Health/policy +71 shared Vitest pass**, one worker: existing helpers/mutations, current
  controls and the added unlinked-case preservation check. Original four colour/hierarchy
  browser regressions were observed RED before fixing.
- **30 unique Chromium cases exercised**:8 Health, 2 actual Admin/Listen CSS-entry, 4 Admin control,
  3 tabs, 9 focus preview cases +4 builtAdmin Health at 1440/768/390. Initial combined preview run:
  25/26 pass; the existing focus-motion.spec.ts "animates the ring on and fully off with the real
  Listen search timing" missed the exit animation at line 199. Exact directed replay passed
  without changes, followed by all9 focus cases passing together. Record this transient failure;
  do not describe the initial combined pass as clean or infer a proven root cause. No focus
  animation/test/timeout was modified. All Health/colour/control/tab cases passed on that pass.
- Three strict scoped TypeScript configs, scoped ESLint/Prettier, both source-contract audits,
  Admin and Listen builds/types/budgets and nine-entry preview build pass. Admin initial JS
  **526767/532480 B gzip**, ten assets, **5713 B margin** (20 B below the initial queue composition;
  14 B below published 1AC). Listen **199918/307200 B**, 23 initial assets. Generated build caches
  restored from their pre-build tracked contents.
- `.artifacts/review/health-drift-contract-audit.txt` compares saved pre-drift Health with final:
  **22 helpers/models, 9 API calls, 12 effect/query/ref calls, 13 state initialisers, 6 repair counter/
  eligibility declarations, 10 inline callbacks and whole confirmation JSX unchanged**. Artist
  route builder and canRepair/actual-ID eligibility remain identical. ArtistGroupHeader's JSX
  presentation intentionally changed to wrap cases before its existing primary repair link;
  original pre-composition audit now exempts that presentation helper, leaving 19 other helpers.

The actual real-page specimen was compared in IAB at 1310×1424 with the approved sketch. Proof:
`.artifacts/review/checkpoint-1ad-health-drift-fixed.png` (ignored advisory, not canonical).
The sample tab is marked deliverable at <http://127.0.0.1:5186/admin-health-demo.html>, user
service active/HTTP 200; previous specimens and checkpoints remain. Samples remain labelled
fictional/local, production uses unchanged actual endpoints. No backend or library operations.

Earlier review's declined areas/rulings still apply: live worker/filesystem/permissions/freshness,
SSE/races, deliberate focus destination after the final case vanishes, screen-reader/native/
other-engine/zoom, full phase-close/CI and canonical recording/comparison remain pending. No
claim of future HealthScan/providers/pagination or complete unloaded repairs. The 33 canonical
PNGs/manifest remain 1M, site pin 258bbaee unchanged/unavailable. No new reviewer loop was opened
for this bounded user-directed visual correction; audit and direct sketch comparison cover it.
**Stop at 1AD, uncommitted for Diego. No next group, commit/push, PR/merge/rebase/deploy/release.**

## 1AD approval and publication preparation — 2026-10-18

Diego approved the corrected Library Health checkpoint and explicitly requested commit/push,
then the next Admin icon group with UX retained. This supersedes every earlier 1AD local-only
stop; the approved product source and scoped evidence are unchanged. Publication commit:
`feat(ui): simplify Library Health into an issue queue`, parent439b3e78. Exact published SHA
will be recorded after verifying the push. The preview's 1AD label/footer now say published.
No full validation, CI dispatch or canonical baseline update is needed for this metadata change.

The next bounded group is Library Trash alone (`pages/Trash.tsx`), from the reviewed operations/
settings inventory. Preserve restore/delete/empty worker requests, task waits, errors and both
shared confirmations; retain actual loading glyphs and retire redundant header/action glyphs.
No new trash index, pagination, scan/instrument or backend work; those phase6.4 prerequisites
remain pending. Keep all earlier specimens and stop at1AE for Diego before publication.

## Final Linux record — 1AD published; 1AE Library Trash local review (2026-10-18)

Diego approved final 1AD, requested commit/push and the next bounded Admin icon group. Published
commit **5e1d9c8f287804a834b3143f6367f7e5a2ef8e31**, `feat(ui): simplify Library Health into an
issue queue`, is verified by push and remote ref. The worktree was clean before starting 1AE.
Original 53177736 remains an ancestor. No rebase/merge/PR/deploy/release or Smart Mix; MCP checkout
untouched. 1AD metadata now says published; its one embedding check passes after that label change.

Local 1AE covers only production **pages/Trash.tsx**. It removes the decorative header icon and
idle refresh/restore/delete glyphs; four specifically marked Loader2 sites remain for refresh,
list, bulk operation and row operation. Main/row controls use the existing shared Button and
44 px targets. Heading uses Bricolage; paths use Mono and body/technical line retain Poppins. The old
decorated translucent header is replaced by a quiet rule, and Card uses the shared solid surface.
No new design-system component/variant, dependency or backend change; 1AD cascade/visuals intact.

AST audit against published source confirms **ten helper/action functions**, the component's
**13 pre-render declarations/statements**, **three API call expressions/arguments**, **two task
waits and their 120000/600000 timeouts**, **seven state/effect calls**, **both full shared
ConfirmDialog JSX blocks**, **four disabled conditions** and **eight inline callbacks unchanged**.
Restore/hard-delete target the selected quarantine_path with their original reasons; empty uses
its existing endpoint/body and task result feedback. Busy/confirm/error semantics are preserved;
aria-busy exposes existing state. App's LIBRARY_TRACK_REMOVE route gate and shared sources stay.
Live icon policy extends to **14 complete files / 44 UX sites**, with exactly two bounded Trash
ConfirmDialog uses. Do not regenerate the historical 1V inventory snapshot.

The persistent real-page specimen is `/#papelera-admin` / `/admin-trash-demo.html`. Its exact
Trash API/tasks imports are redirected only in preview, with labelled fictional files and local
completion/failure; unknown requests fail closed. It creates no fetch/EventSource or library
operation. Ready/loading/empty and next-task failure modes keep real controls/confirmations.
All previous checkpoints remain, including 1AD published. Sample field gap is actual 8 px.

Scoped evidence: **26 Vitest** (nine new control cases + original bulk case + sixteen live
policy cases), **four preview Chromium and three built-Admin Chromium** at 1440/768/390, serial
one worker. Four intended unit failures and the missing preview entry were observed RED before
implementation. Keyboard/cancel focus, exact mutation bodies/paths, task waits/completion/error,
loading/disabled, real metadata, 44 px controls, no nested controls/overflow or specimen traffic
pass. Three strict scoped TS configs, scoped ESLint/Prettier, audit, Admin build/types/budget
and ten-entry preview build pass. Strict TS caught a test-only invalid `exact` option on Testing
Library role queries and a missing matcher setup in the temporary strict config; both corrected
without product workaround or looser assertions/timeouts. Known generated tsbuildinfo restored.
**Initial JS 526755 / 532480 B gzip**, ten assets, **5725 B margin**, 12 B below published 1AD.

Current quarantine-list source and error/toast semantics are preserved; phase 6.4's indexed/
paginated data model is not implemented here. Real worker/filesystem/backend integration,
other engines/native/AT/zoom, full phase-close suites/CI and canonical capture/comparison remain
pending. The 33 canonical PNGs/manifest are still 1M; site pin258bbaee unchanged/unavailable.
Fresh review, rulings, proof and final service verification follow; no further group is included.
**Stop at 1AE uncommitted for Diego before publication.**

### 1AE fresh review, executor rulings and final evidence

One fresh read-only review read all 20 pending files (nine untracked) and the plan/spec/evidence.
Verdict: **ready for Diego visual review, Critical 0 / Important 0 / Minor 2**. No product repair
or second review loop. This is not publication/merge approval.

Deferred minors:

1. Bulk-specific tests are narrower than originally planned: bulk confirmation/success is
   covered, individual cancellation focus and restore failure are covered; dedicated bulk
   cancellation focus, pending aria-busy/loader and bulk failure recovery remain unasserted.
   The existing bulk implementation/shared confirmation is unchanged, and this gap does not
   imply a runtime defect; it remains a scoped test follow-up rather than a clean-coverage claim.
2. Technical-line typography remains inherited Poppins; only paths explicitly use Mono. The
   earlier evidence wording has been clarified to describe actual source. A broader technical
   typography migration remains outside the icon group. No production style change for this minor.

Executor rulings on every behavior the reviewer declined to judge:

- Initial-load failure still reports a toast then shows the existing empty fallback; refresh
  failure still retains earlier items. Preserve this checkpoint's data/error contract; future
  Trash data UX must distinguish those states. Cost: existing misleading empty/stale presentation
  is not resolved or certified by this icon group.
- Refresh remains available during a row task. It is an existing read action, not a new mutation;
  preserve its disabled condition. Cost: overlapping-read timing is not independently proved.
- The row's Restore control still carries its loader when individual deletion uses the same
  busyPath. Preserve existing row-busy presentation rather than adding operation state. Cost:
  operation-specific progress clarity is deferred.
- Both void confirmation callbacks still close the shared dialog immediately. Cancel focus is
  exercised for individual deletion; focus after successful completion/disabled triggers is not
  independently proved. Preserve shared integration; cost: keyboard completion focus needs QA.
- Existing truncated paths/metadata, absent suggested-target display and technical-line body
  typography remain. Real source data is retained, no new loss identified; broader information
  layout belongs to the page phase. Cost: full visual path/target readability is not certified.
- Quarantine indexing, pagination, large-library performance and server count semantics remain
  phase 6.4 prerequisites. No backend/data rewrite or complete-library count claim is added.
  Cost: mocked small samples do not establish large-library coverage/performance.
- Worker/filesystem correctness, server permission enforcement and real task transport remain
  integration QA. Route/navigation capability and request/timeout source are unchanged. Cost:
  mocked tests cannot certify actual disk effects, authorization or live transport.
- Other engines, assistive technology, native/zoom, full suites/CI and canonical visual comparison
  stay pending by the checkpoint validation contract. Cost: current evidence is scoped Chromium,
  not universal UI/runtime certification. The 33 canonical PNGs/manifest remain 1M, pin unchanged.
- Live preview and Diego's visual acceptance are the executor/user responsibility. Actual :5186
  specimen inspected, user service active and entry HTTP200; proof saved and tab marked deliverable.
  Cost: this establishes local availability/inspection, not Diego's approval or native parity.

Final evidence remains **26 scoped Vitest, four preview + three built-Admin Chromium**, serial
one worker; three strict configs, scoped lint/format, AST audit and Admin/preview builds/budget
pass. **526755/532480 B gzip**, ten assets, **5725 B margin** (12 B below 1AD). Generated build
cache is restored. Final diffs pass whitespace/format checks. No new test run solely for review
bookkeeping; source was frozen during review, only final records/proof were added.

Advisory proof: `.artifacts/review/checkpoint-1ae-library-trash.jpg` (actual IAB 1310×1424, not a
canonical baseline). The actual page is open/marked deliverable at
<http://127.0.0.1:5186/admin-trash-demo.html>; main checkpoint is `/#papelera-admin`. All previous
specimens, including published Health, remain. HEAD/origin stay **5e1d9c8f**; 1AE is uncommitted.
**Stop at 1AE for Diego. No further group, commit/push, PR/merge/rebase/deploy/release.**

## 1AE publication approval — 2026-10-18

Diego approved Library Trash and explicitly requested commit/push and the next bounded Admin
icon group, with functional UX retained. This supersedes every older 1AE local-only stop. The
reviewed source remains unchanged; preview label/footer now say published. Earlier scoped
validation and deferred limits remain recorded. Remote publication SHA will be recorded after
push verification; next implementation stops at 1AF before another commit/push.

## Final Linux record — 1AE published; 1AF Contributions local (2026-10-18)

Diego approved1AE and authorised commit/push plus the next bounded Admin group with functional
UX retained. Published `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b`, `feat(ui): retire redundant
Library Trash icons`, is verified by push and remote ref. Publication metadata replay passes
26 scoped Vitest +one embedding Chromium. The worktree was clean before1AF. Earlier Trash
minor coverage/typography limits remain; this group does not widen that work.

**1AF production scope: pages/Contributions.tsx alone.** Retire HandHeart/decorative header tile
and idle RefreshCw. Retain two conditional Loader2 sites: contributions-refresh-loading and
contributions-list-loading, both aria-hidden, with busy from existing loading. Refresh and album
links have44px targets; Bricolage heading, Poppins body and Mono source references follow the
shared solid identity. Rows/metadata stack untilxl so the Sidebar cannot squeeze the links.
All contributor/source fallbacks, status, timestamps, track/duration metadata and real album/cover
helpers stay. Source policy expands to15 complete files/46 concrete UX sites; original1V records
remain. No new tokens, foundation variant, dependency, backend/API, auth/permission/shared source
or Listen/Desktop change. This does not complete1b.8 or contribution-management product work.

Read-only AST audit against published1AE: all three helper/action functions, four component
pre-render declarations/statements, one API request/limit, two album/cover helper calls, three
state/effect calls, existing disable condition and callback unchanged. The actual route and
Sidebar remain library.import.manage. Existing initial error toast→empty and refresh error→older
items remain; this group does not claim those states are fresh/complete data. Missing album_id
remains non-link text; the sample includes named/username/email/unknown identity fallbacks.

Real Contributions specimen: <http://127.0.0.1:5186/admin-contributions-demo.html>, persistent
`/#aportes-admin`. Only this page's API import is redirected; response-shaped fictional data,
local ready/loading/empty/error reads, manual completion and explicit sample album destinations.
Actual album route helpers still generate destinations; covers are tested at component-src level
(the sample has_cover=false), not certified visually. No fetch/EventSource/writes in the adapter;
unknown methods/paths fail closed. All earlier checkpoints remain,1AE label/footer published.

Validation: observed4 expected unit failures/22 passes before production rendering edits, then
**26 scoped Vitest** (10 page +16 policy). Missing preview entry RED, then **four preview and
three built-Admin Chromium** at1440/768/390 with one worker. Two actual layout findings corrected:
preview implicit grid track expanded to603px, fixed with explicit grid-cols-1; real Sidebar
squeezed links to30px at768, fixed by stacking untilxl and min44px link width. Target/overflow
assertions kept. Real limit150, no write, held busy/disable, source attribution, keyboard Enter/Tab,
real hrefs and local navigation covered. Sample field gap measures8px.

Ruling: the original plan/test demanded automatic focus return after a held refresh. Baseline
and current native disabled={loading}, effect and callback code are identical; Chromium drops
focus while disabled. Preserve existing behavior and verify keyboard activation plus subsequent
Tab access, rather than introduce focus orchestration in an icon group. Cost: automatic focus
restoration is a separate accessibility follow-up, not a verified promise. The immediate-promise
jsdom focus assertion was removed because it did not model that native behavior; real read and
keyboard assertions remain. No timeout inflation, forced clicks, hidden overflow or new product
error-state behavior.

Three strict scoped TS configs pass, scoped ESLint/format and Admin/11-entry preview builds pass.
Admin initialJS **526770/532480 B gzip**,10 assets, **5710B margin**,15B above1AE; ceiling unchanged.
Initial lint cwd lacked app/ui's config; corrected scoped command passes. Known generated build
cache restored. No complete suite/CI/canonical refresh. Full validation remains phase-close;
real auth/backend/ownership/import integration, actual covers, large/over150 data, native/AT/zoom
and other engines are pending. Canonical33 PNGs/manifest remain1M; app/web@258bbaee unchanged.
One fresh review, final rulings and advisory proof follow; **stop at1AF uncommitted for Diego**.

### 1AF fresh review, rulings and final stop

One fresh read-only review covered all 20 pending files, including nine untracked, against
published 1AE. Verdict: ready for Diego visual review, **Critical 0 / Important 0 / Minor 1**.
No product repair or second review loop. The review did not run tests, browser or network.

Deferred Minor: the fixture exercises long album/artist/source strings but not a long contributor;
browser checks assert the short title's accessible name, not explicitly the full long title.
Current viewport checks therefore do not certify either case. Existing min-width/word wrapping
and link text remain; no production failure was observed. Add those assertions in a future
focused coverage change; no claim that review-focus item 1 is completely covered.

Executor rulings, in review order:

1. Live access control: actual route/sidebar declarations still agree on library.import.manage.
   Keep them unchanged; mocked login is not live authorization evidence. Cost: real enforcement QA pending.
2. Import ownership: retain supplied attribution and precedence, without backend edits. Cost:
   tests prove rendering, not correctness of production ownership records.
3. Artwork: helper/src output is covered and unmodified; sample has no covers. Cost: actual cover
   delivery/appearance is not certified by the specimen.
4. Over150/pagination/performance: preserve the bounded GET, no invented completeness/count claim.
   Cost: this group establishes neither full-library coverage nor large-list performance.
5. Error data semantics: preserve tested toast→empty and refresh error→older items. Cost: their
   existing potentially misleading freshness presentation remains for separate product work.
6. Refresh focus: preserve the native disabled loading contract, with Enter/Tab checks. Cost:
   automatic focus restoration is absent, not claimed by jsdom or keyboard re-entry tests.
7. Native/AT/zoom/other engines: retain the scoped Chromium boundary. Cost: device/runtime
   qualification remains pending, not inferred from local tests.
8. Full suites/CI/canonical parity/pin: honor Diego's development restriction; no complete suite,
   CI dispatch or baseline regeneration.33 PNGs/manifest remain1M and pin258bbaee unchanged.
   Cost: scoped passes do not close phase QA or certify canonical/reference visual parity.
9. Earlier Trash limits and other Admin icon scopes: keep published1AE and its limits intact;
   no additional page changes. Cost: dedicated Trash bulk tests/technical typography and global
   icon migration remain separate work, not completed by1AF.
10. Preview/proof/acceptance: executor inspected the actual IAB page, exercised Refresh and
    manual completion, marked the tab deliverable and saved advisory proof. User service active,
    entry HTTP200. Cost: local availability/inspection does not constitute Diego's acceptance.
11. Publication: only1AE's commit/push was authorized. Keep1AF uncommitted at HEAD/origin638f4b0d;
    no next group, PR/merge/rebase/deploy/release. Cost: local changes require subsequent approval
    before publication, as explicitly requested.

Final evidence:26 scoped Vitest,4 preview +3 built-Admin Chromium, three strict configs,
scoped lint/format, AST audit, Admin build and11-entry preview build pass. Admin526770/532480B
initial gzip,10 assets,5710B margin. Known tsbuildinfo restored; diff/format checks pass. Source
was frozen during review; final closure changes only records/proof, no repeated passing suites
for bookkeeping. Original checkpoint ancestor and published remote ref verified.

Proof `.artifacts/review/checkpoint-1af-contributions.jpg` is the actual IAB1310×1424 page, not a
canonical baseline. Review <http://127.0.0.1:5186/admin-contributions-demo.html> or persistent
`/#aportes-admin`. All previous specimens remain, especially1AD's approved visual accents and
Listen's retained1S play/ring/seek. **Stop at1AF for Diego, no commit/push or further group.**

## 1AF publication approval — 2026-10-18

Diego approved Contributions and requested commit/push followed by the next bounded Admin icon
group with UX retained. Earlier 1AF local-only stops are superseded; scoped checks and documented
limits remain. Only preview publication labels change before commit. Remote SHA follows push
verification. Next implementation stops at 1AG before publication or another group.
