# Crate v3 handover

> Estado vigente: [tabla única de continuación](2026-10-19-crate-v3-current-state.md).
> Los registros cronológicos conservan sus estados históricos; las aprobaciones posteriores los sustituyen.

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
**1AF Contributions is approved and published as `1b8ab82362f696f16ea481b3789436443b199d5d`.**
**1AG Library Timeline removal is approved and published as `e5b9f087935f790d4ae2d7950dd9d52c59f7e658`.** The earlier local
icon-restyle proposal is withdrawn, not approved/published. Page/lazy/menu removed; old
/timeline redirects to Browse with its library.view gate. The old specimen URL redirects to
<http://127.0.0.1:5186/#cronologia-admin>, now a retirement record without a Timeline iframe.
Review navigation at <http://127.0.0.1:5186/admin-navigation-demo.html>. The obsolete StatStrip
reference is corrected; **1AH Bandcamp is approved and published as `58b2695b39bbd91c477a968192ff74332a220e71`.** **1AI Discovery is approved and published as `a304ecf9c41bc254dab98b9f52668e18f4d87852`.** **1AJ New Releases is approved and published as `235b892f5dadab07faf3ae7a1a1727864b7a06c9`.** **1AK Global Catalog is approved and published as `44d5f16a1eb20d6b7c89e6b22aee768d86c5bac2`.** **1AL Roles is approved and published as `d72232e9ef581248ae59a1289bd357dec0629db1`.** **1AM Users is approved and published as `b0f20194fb364e24cd3edb18e9b1c6084cb34f96`.** **1AN Translations is approved and published as `2df63f31177da67b48eec11c5da575b76d17d394`**, including the French fixture-counter correction. **1AO Upcoming is approved and published as `ba63836d2a23bb774832c1703eab4e4116e1468f`**, including metadata400 and title-right List/Calendar icon-only controls. **1AP is approved and published as `d30b1c0244e5f57026dea3f27aacae815c04b41b`**, including the authorized audit reconciliation. Local1AQ covers PlaylistEditor; stop uncommitted for review.

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
next-group request on 2026-10-18. **Next stop: 1AM before commit/push or another group.**
The retained Listen play/halo/ring and luminous seek trail
from 1S remain intact. Resume on Linux with
[`2026-10-16-crate-v3-linux-handover.md`](2026-10-16-crate-v3-linux-handover.md).
Canonical 1N–1P Linux recording/comparison and native QA remain pending.

## Where the work lives

- Active Linux worktree: `/home/diego/.codex/worktrees/crate-v3-1q/crate`, existing branch
  `feat/crate_v3`, published HEAD `d72232e9ef581248ae59a1289bd357dec0629db1` (1AL);
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

## Historical authorisation and checkpoints — see current-state table above

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
| 1b.8 / Checkpoint 1AF                                        | Approved/published `1b8ab823`: Contributions, retained UX and actual data/routes. Publication replay 26 Vitest / one embedding Chromium pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1b.8 / Checkpoint 1AG                                        | Replacement scope: Library Timeline retired at Diego's request, old route/preview redirects, A14 withdrawn. Earlier icon proposal archived. Approved and published as e5b9f087; stale StatStrip reference corrected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1b.8 / Checkpoint 1AH                                        | Bandcamp redundant icons retired with six retained loading/external UX sites. Approved and published as 58b2695b.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1b.8 / Checkpoint 1AI                                        | Discovery redundant icons retired with four retained search/loading UX sites. Approved and published as a304ecf9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1b.8 / Checkpoint 1AJ                                        | New Releases icons retired with six retained search/loading/dismiss UX sites. Approved and published as235b892f. Shared Select label minor deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1b.8 / Checkpoint 1AK                                        | Approved and published as44d5f16a, including requested specimen-copy correction. Global Catalog keeps two loading UX sites and its real void-refetch contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1b.8 / Checkpoint 1AL                                        | Roles rendering group approved and published asd72232e9. Read-only data and roles.view contracts preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1b.8 / Checkpoint 1AM                                        | Local Users list/map retirement and icon group; existing detail modal, capabilities and actions preserved. Stop for Diego before commit/push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
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

## Historical 1AD — visual drift corrected before its later publication (2026-10-18)

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

## Final Linux record — 1AF published; 1AG Timeline local (2026-10-18)

Diego approved Contributions and requested commit/push and the next bounded Admin group, UX
retained. Published `1b8ab82362f696f16ea481b3789436443b199d5d`, `feat(ui): retire redundant
Contributions icons`, verified by push and remote ref. Publication26 Vitest/one embedding
Chromium pass after labels changed. Clean worktree before1AG. Earlier Contributions long-name
coverage/native-disabled-focus limits remain recorded, no extension of that page here.

**1AG production only pages/Timeline.tsx and its private StatCard rendering contract.** Retire
Calendar/Disc3/Trophy stat decoration, private icon prop and Disc3 fallback. Keep three bounded
UX sites: timeline-computing Loader2, timeline-collapse ChevronUp, timeline-expand ChevronDown,
aria-hidden. Existing ErrorState/GridSkeleton retained. Whole-file policy grows to16 files/49
exact glyph sites, one bounded shared ErrorState use; original1V inventory untouched.

Readings use existing Bricolage/Mono with .crate-form-field actual8px pairs and top rules;
body remains Poppins. Year/album targets44px, type=button, aria-expanded and full accessible
album names. All actual counts, chronological sorting/ties, bar width/minimum, data hook/URL,
year toggle, album/asset helper inputs, callbacks and existing loading/error branches preserved.
No new foundation/token/dependency/shared export/API/backend/permission/Listen change. Actual
route/sidebar retain library.view. This does not complete1b.8, Timeline/A14, chart migration or
phase6.4. Existing bars and no-data 'being computed' semantics remain, not a new runtime job claim.

AST audit against published1AF:11 data statements/declarations,2 pure/toggle helpers,4 data/state
hook calls,3 navigation/asset calls, existing ErrorState/GridSkeleton JSX,3 activation/image
callbacks, percentage style and5 branch conditions unchanged. Audit normalizes only nonsemantic
parentheses/whitespace; changed private StatCard/JSX metadata are explicit. No data/effect rewrite.

Real specimen <http://127.0.0.1:5186/admin-timeline-demo.html>, persistent `/#cronologia-admin`.
Exact Timeline hook alias only; actual page and routing helpers, fictional response-shaped
albums, local loading/computing/error/retry and sample destinations clearly labelled. Existing
per-window asset URL resolver maps only four sample IDs to local generated fictional covers,
one deliberately invalid for original onError handling. Shared helper source unchanged; no
API/SSE/write requests. This is mock isolation, not live auth/backend/asset certification.

Observed unit RED8 expected/18 pass after correcting a harness textContent whitespace assumption;
then **26 scoped Vitest** (10 Timeline +16 policy). Scoped strict types caught invalid Testing
Library ByRole exact options; removed them, since string names are exact already. Final named
task-done replay26/26 passes after that test correction. Missing preview entry RED, then **four
preview +three built-Admin Chromium**,1440/768/390, serial workers1. Counts/order/ties, disclosure
Enter/Space/focus, full long title/artist accessible name, actual8px/44px, bounds, cover src/lazy/
error, local image success/failure, sample routing, loading/retry and no specimenAPI traffic
covered. Built test uses the actual hook/route mount and leaves independent Album rendering to
its own scope; unit/specimen verify actual router destination. No arbitrary timeout/forcedclick.

Three strict configs, scoped ESLint/format, Admin build/types and12-entry preview build pass.
Admin **526769/532480 B initial gzip**,10 assets, **5711B margin**,1B below published1AF. Known
generated tsbuildinfo restored. No complete suites/CI/canonical refresh.33 PNGs/manifest remain
1M; app/web@258bbaee unchanged/unavailable. Actual backend/auth/full data/assets, native/AT/zoom/
other engines and phase validation stay pending. Other Admin pages remain unmigrated.

Actual IAB inspected with2020 expanded, good/broken artwork and retained disclosure; proof
`.artifacts/review/checkpoint-1ag-timeline.jpg`1310×1424, tab deliverable. Service active/HTTP200
verified in final closure. Fresh review and executor rulings follow. **Stop1AG uncommitted for
Diego; no next group, commit/push, PR/merge/rebase/deploy/release.**

### 1AG fresh review, executor rulings and final stop

One fresh read-only review read all20 pending files, including nine untracked, actual source,
original source, plan/ledger/audit and validation logs. Verdict: **ready for Diego visual review;
Critical0 / Important0 / Minor0 requiring changes in this checkpoint**. No product fix or second
review loop. The reviewer did not execute tests/builds/browser/network or mutate files.

Executor rulings on every declined area, in review order:

1. Live auth, permissions and backend integration: route/sidebar library.view and data contracts unchanged; mocks do not prove operational enforcement. Cost: live integration and authorization QA pending.
2. Actual artwork delivery, caching and recovery: local good/broken covers prove rendering only, actual asset helper calls unchanged. Cost: production asset transport/auth/cache not certified.
3. Independent Album rendering: actual helper destinations tested in unit/specimen; no Album source change. Cost: destination-page behavior relies on its separate scope/tests.
4. Complete production counts, scale and data quality: bounded fictional response plus unchanged aggregation. Cost: full-library accuracy/performance require real-data QA.
5. Empty-array/malformed year buckets: inspected API creates nonempty numeric buckets; keep aggregation unchanged in icon group. Cost: defensive handling/possible invalid widths for unsupported buckets remain existing limitations.
6. Indefinite computing for null/empty data: preserve existing branch/copy without claiming a real running job. Cost: empty-data distinction and truthful job-state UX remain later data-state work.
7. Year-prefix stripping and earliest-year ties: preserve tested existing product semantics and raw helper inputs. Cost: no alternative naming/tie policy introduced.
8. Full Timeline/A14/Nivo layout: keep current bars; retire only decorative stats/cover icons and apply shared render recipes. Cost: future chart/page migration is not completed.
9. Native/AT/zoom/other engines and widths: only recorded1440/768/390 Chromium plus1310 IAB inspection. Cost: runtime/device and broader responsive qualification pending.
10. Full suites/CI/canonical/pin/unrelated surfaces: honor scoped development validation;33PNG/manifest1M and pin258bbaee unchanged, no other production app change. Cost: no phase-close or reference-parity certification.
11. Current preview/proof/acceptance: executor inspected2020 expanded, saved actual IAB proof and retained tab; serviceactiveHTTP200. Cost: local inspection/availability is not Diego visual approval.
12. Publication/deployment/release: only1AF publication authorized; keep1AG local on1b8ab823. Cost: 1AG needs subsequent review approval before commit/push; no next group or release action.

All code remains frozen from final review; only final records/proof added afterward. Final actual
26 Vitest (task-done after correcting the unsupported test option),4 preview +3 built-Admin
Chromium,3 strict configs, scoped lint/format/AST, Admin/12-entry preview builds and bundle pass.
InitialJS526769/532480B gzip,10 assets,5711B margin. Known cache restored and whitespace/format
checks pass. No full suite/CI/canonical recording. Original53177736 ancestor retained; HEAD/origin
remain published1AF `1b8ab82362f696f16ea481b3789436443b199d5d`.

Actual IAB proof `.artifacts/review/checkpoint-1ag-timeline.jpg`1310×1424 shows2020 expanded,
retained disclosure and local good/broken cover samples. User service active, specimenHTTP200,
tab marked deliverable. Review <http://127.0.0.1:5186/admin-timeline-demo.html> or persistent
`/#cronologia-admin`. All earlier checkpoints retained. **Stop1AG uncommitted for Diego; no
commit/push, next group, PR/merge/rebase/deploy/release.**

### 1AG replacement scope — Library Timeline retired at Diego's request

This final record supersedes the preceding local 1AG icon proposal and its review. Diego
requested removal after inspecting that specimen; neither version of 1AG is approved or
published. Published HEAD/origin remain 1AF `1b8ab82362f696f16ea481b3789436443b199d5d`.

Deleted Admin `pages/Timeline.tsx`, its lazy import and Sidebar destination. The old `/timeline`
URL retains the existing authentication and `library.view` gate, then replaces the history
entry with `/browse`, discarding obsolete query/hash. CommandPalette already had no Timeline
destination. Admin no longer loads that page chunk or calls `/api/timeline`. The public backend
endpoint remains compatible; no library data or backend contract was changed. Release, artist
and operational timelines are distinct functions and remain available.

The old standalone preview is now a static HTML redirect to `/#cronologia-admin`, a retirement
record with no Timeline iframe, hook, fixture or asset resolver. The active product and phase
6.4 targets withdraw Timeline/A14; historical inventories and published checkpoints remain.
The withdrawn proposal and proof were copied before deletion into ignored review storage:
`.superpowers/sdd/2026-10-18-crate-v3-timeline-removal/withdrawn-1ag/manifest.json`, 23 files with
SHA256 hashes. Its historical plan is explicitly marked withdrawn. Source icon policy returns
to the published 1AF scope: 15 whole files and 46 bounded functional glyph sites.

Observed RED: three expected retirement failures (actual App redirect, deleted source/lazy
import and Sidebar destination), with seven existing/gate checks green. Final scoped Vitest:
**31 tests across five files** (App retirement, existing App/bundle checks, Sidebar and icon
policy). **Six Chromium tests**, serial `--workers=1`: three preview compatibility/navigation
and three built-Admin old-route/Browse/palette/no-Timeline-request cases at 1440/768/390 px.
The initial mobile preview assertion addressed the hidden desktop Sidebar; opening the actual
mobile drawer corrected the harness without a product change, forced click or timeout increase.

Two scoped strict TypeScript configs, scoped ESLint, Admin build/types and preview build pass.
Preview has 12 HTML entries: 11 actual specimens plus the static retired-URL redirect. Admin
initial JS is **526680 / 532480 B gzip**, 10 assets, **5800 B margin** (90 B below published 1AF).
Generated `tsconfig.tsbuildinfo` restored. Validation logs use `.artifacts/review/1ag-removal-*`.
No full suites, CI dispatch or canonical refresh; 33 PNGs/manifest remain 1M and pin 258bbaee is
unchanged. Live auth/backend, native/AT/zoom/other engines and full phase validation are pending.

Actual IAB navigation and the retirement record were inspected. A fresh HTTP tab rendered
successfully after an earlier tab retained a connection-reset error from Vite's restart; no
browser security interstitial was bypassed. Advisory proofs are
`.artifacts/review/checkpoint-1ag-navigation-without-timeline.jpg` and
`.artifacts/review/checkpoint-1ag-timeline-retired.jpg`. The latter shows the visible final record;
the tab remains open. `crate-v3-preview.service` is active and the navigation URL responds 200.
Review <http://127.0.0.1:5186/#cronologia-admin> or
<http://127.0.0.1:5186/admin-navigation-demo.html>. **Stop at 1AG before commit/push or next group.**

### 1AG retirement — final review and stop

One fresh read-only reviewer examined all 19 pending files against published 1AF and independently
verified the 23-file preservation archive. Verdict: **ready for Diego's review; Critical 0,
Important 0, Minor 1**. No product repair or second review. Deferred minor: the design-system
StatStrip table still names Timeline StatCard as an old consumer (line 1196 at review); the
explicit retirement amendments and corrected product-design table prevail. This stale label
does not restore the page or authorize its future migration.

Executor rulings on every declined area:

1. Public Timeline endpoint/computation/storage: retain the existing compatibility contract; this is Admin-page removal. Cost: unused first-party endpoint and maintenance remain, with API retirement requiring separate scope.
2. Release, artist and operational timelines: preserve distinct unchanged product functions. Cost: this checkpoint makes no claim about their UI or data quality.
3. Live authentication/session/server capability enforcement: retain the actual route gates and focused mock coverage. Cost: live integration and server authorization QA remain pending.
4. Independent Browse data/artwork/performance/workflows: exercise the actual destination and navigation without changing that page. Cost: complete Browse behavior relies on its own scope and tests.
5. Former Timeline aggregation, malformed buckets, computing/order/artwork states: remove the entire UI, so these rendering contracts no longer apply. Cost: no retained UI for those historical readings; public backend compatibility remains.
6. Native/AT/zoom/other engines/viewports: accept recorded Chromium 1440/768/390 checks plus actual IAB inspection. Cost: broader runtime/accessibility certification remains pending.
7. Full suites/CI/canonicals/pin/unrelated surfaces: honor scoped iteration rules and preserve the 1M references/pin 258bbaee. Cost: no phase-close or reference-parity certification.
8. Preview availability/visual acceptance: executor verified active service, HTTP 200 and rendered IAB record/navigation; reviewer did not browse. Cost: local readiness is not Diego's approval.
9. Commit/push/merge/deploy/release/next groups: stop at uncommitted 1AG on published 1AF. Cost: retirement is local until Diego reviews and authorizes publication.

Source hashes stayed frozen after final review; only closure records/proof changed. Formatting,
whitespace, archive integrity, original ancestor, HEAD/tracking ref and preview service were
checked. No rerun of already-green tests for bookkeeping alone. Ignored preservation archive
is deliberately retained. **1AG is ready for review, with no commit/push or further group.**

### 1AG approval and publication preparation — 2026-10-18

Diego approved the Timeline retirement, explicitly requested correction of the stale StatStrip
consumer reference, and authorised commit/push followed by the next bounded Admin icon group.
That reference is removed from the active design-system table; the historical deferred-minor
record above describes the previous review, not an outstanding item. The retirement specimen
and footer now say 1AG published. Its compatibility test follows the updated publication label.
Earlier local stops are superseded by this approval; the next implementation stops at 1AH
before another commit/push. No full-suite/CI/canonical or release work is authorised.

## Final Linux continuation — 1AG published; 1AH Bandcamp local (2026-10-18)

Diego approved 1AG and explicitly authorised the stale StatStrip correction, commit/push and
next bounded group. Published commit e5b9f087935f790d4ae2d7950dd9d52c59f7e658,
`feat(ui): retire Library Timeline from Admin`; push and remote ref verified, clean before 1AH.
The publication-label change passed its three affected preview cases. Earlier deferred minor
is corrected; earlier 1AG local stops and icon-only proposal remain historical.

Current 1AH covers **pages/Bandcamp.tsx only in production**, including its private metrics and
panel rendering. It retires redundant action/stat/brand-pill glyphs and private icon props,
uses existing OpsPageHero/OpsStatTile/OpsPanel and MonoLabel, and keeps six explicit UX sites:
three loading (sync/backfill/confirm), three external cues (match/confirmed/radar item). Glyphs
are aria-hidden. Whole-file policy grows to 16 files / 52 retained sites.

All eight data hooks, raw URLs/query params, refetches, task/match handlers, POSTs, toast text,
connection eligibility, busy lock, counts, filtering and 5/8-item limits remain. Album/user
metadata, covers and fallback initials retain their contracts. Typography follows existing
recipes, metric label/value gaps are real 8px, controls have 44px targets and aria-busy.
The base content grid uses an explicit zero minimum to fit mobile without hidden overflow.
No shared/Listen/backend/permission/dependency change, connection/error redesign or full A10/
phase6.5 migration. Existing absent-read counts, silent read errors and non-link card semantics
are preserved; this group does not certify successful integration or live service availability.

Real isolated specimen <http://127.0.0.1:5186/admin-bandcamp-demo.html>, persistent
`/#bandcamp-admin`. Exact Bandcamp importer-only API/hook alias, real shared data-hook factory,
response-shaped fictional data and deterministic local completion. Four sample states, failed
POST and local external destinations; no backend/write/Bandcamp request. Existing mockups and
Timeline retirement record remain. Current plan: 2026-10-18-crate-v3-bandcamp-icons.md.

**Stop at 1AH before commit/push or next group.** Validation/final review closure follows.

### 1AH verification before final review

Observed corrected RED7 expected /23 green for redundant glyphs/display/accessibility. Separate
label RED1 caught an accidental numeric MonoLabel prefix, corrected to the real count. Initial
test harness assumptions (unsupported null rejection, combined metadata, direct-vs-hook refetch
arguments and Testing Library ByRole exact option) were corrected without data/handler changes.
Actual API rejects Error objects; arbitrary null rejections remain outside this icon contract.

Final named unit gate **40/40 Vitest across three files**:14 Bandcamp,16 source policy,10 affected
Ops surfaces. **Three preview +three built-Admin Chromium**,1440/768/390, serial workers1. They
exercise keyboard sync/review, real POST/lock/refetch behavior, sample failure/checking/disconnected/
empty states, external local destination, actual fonts/8px metrics/44px controls and no overflow.
The initial390 failure exposed automatic grid minimum widths; explicit grid-cols-1 fixes the
specimen shell and actual page content. No clipping, arbitrary timeout or forced-click fix.

AST audit against published1AG proves eight hook calls, six complete functions (queue/update/
itemTitle/importStatus/cover/connection), seven state/refetch declarations, nine onClick
expressions and every metric-value expression unchanged. Two scoped strict TS configs, scoped
ESLint, Admin build/types and13-entry preview build pass (12 specimens plus static retired-URL
redirect). Admin initialJS **526656/532480 B gzip**,10assets, **5824B margin**,24B below1AG.
Known generated cache restored. Logs `.artifacts/review/1ah-*`; final40unit replay is in plan
SDD `task-1-tests.log`. No full suite/CI/canonical changes;33PNG/manifest remain1M, pin258bbaee
unchanged. Live auth/backend/real data/assets, native/AT/zoom/other engines/full phase QA pending.

Actual IAB specimen inspected with real page, fictional candidates, metrics and retained
external cues. Proof `.artifacts/review/checkpoint-1ah-bandcamp.jpg`,1310×1424. Preview service
active; final fresh review and executor rulings follow. **Stop1AH uncommitted for Diego.**

### 1AH final review, executor rulings and checkpoint stop

One fresh read-only review inspected all20 pending files, surrounding production consumers,
test/fixture infrastructure, records, saved verification logs and actual IAB proof. All13
frozen source hashes match. Verdict: **ready for Diego review; Critical0 / Important0 / Minor0
requiring action**. No product repair or second review. Reviewer made no changes and ran no
tests, builds, browser or network operations. This verdict is not publication approval.

Executor rulings on every declined area:

1. Silent read errors and zero/empty loading fallbacks: retain existing hooks/page behavior in this presentation group. Cost: absent or failed reads can still resemble an empty collection; truthful read-state redesign remains separate work.
2. Clickable cards without destination URLs: retain existing callbacks and URL guards. Cost: a card with no destination can remain focusable without navigating; interaction redesign is not claimed here.
3. Arbitrary null/non-Error rejection: preserve the actual API Error contract and unchanged handlers. Cost: unsupported custom null rejection can still fail while reading its message; no general rejection-hardening claim.
4. Confidence meters, connection instruments and detailed rows: retain current information and use existing presentation recipes only. Cost: full A10/phase6.5 Bandcamp design remains incomplete.
5. Live auth/backend/data/cover delivery: source gates and request contracts stay unchanged; tests use isolated responses. Cost: real integration, permissions, scale and asset transport need live QA.
6. Native/AT/zoom/other engines: recorded Chromium1440/768/390 plus IAB1310×1424 inspection suffice for this local checkpoint. Cost: broader runtime/accessibility certification remains pending.
7. Full suites/CI/canonicals/earlier1AG review: honor scoped iteration and preserve approved publication/history. Cost: no phase-close/reference-parity certification; the final review covers1AH only.

Final evidence:40 scoped Vitest,3preview+3built-Admin Chromium, two strict configs, scoped lint/
AST/format, Admin and13-entry preview builds, initialJS526656/532480B gzip (5824B margin).
Generated cache restored; source stayed frozen after review, only closure records/proof changed.
Original53177736 ancestor retained; HEAD/origin remain published1AG e5b9f087. Withdrawn1AG
archive23SHA256 entries still intact, shared/Listen/canonical source unchanged. Persistent
mockup inspection verifies1AF specimen,1AG retirement and1AH real iframe/footer status together.

`crate-v3-preview.service` remains active on127.0.0.1:5186, Node22 and this worktree. Standalone
sample and retired URL respond HTTP200; actual IAB proof
`.artifacts/review/checkpoint-1ah-bandcamp.jpg` is advisory, not a canonical capture. Review
<http://127.0.0.1:5186/admin-bandcamp-demo.html> or persistent `/#bandcamp-admin`. **Stop1AH
uncommitted for Diego: no commit/push, next group, PR/merge/rebase/deploy/release.**

### 1AH approval and publication preparation — 2026-10-18

Diego approved Bandcamp 1AH and authorised commit/push, then one further bounded Admin icon
group preserving UX glyphs. Specimen/footer publication labels are updated. Earlier local
stops are historical; next stop is 1AI before another commit/push. Scope and remaining QA
limits from the final review above remain. No full suites/CI/canonical or release work.

## Final Linux continuation — 1AH published; 1AI Discovery local (2026-10-18)

Diego approved 1AH and authorised commit/push followed by one bounded Admin icon group. Published
commit58b2695b39bbd91c477a968192ff74332a220e71, `feat(ui): retire redundant Bandcamp icons`;
push/remote ref verified, clean before1AI. Publication label change passed its affected persistent
preview compatibility case. Earlier1AH local stops are historical; its data/UX contracts remain.

**1AI production only pages/Discover.tsx**, including private opportunity/radar/presentation.
Retired redundant labelled action/summary glyphs and artist/album fallback decoration. Actual
image helper calls, URLs, image onError and reserved dimensions remain. Four concrete retained
UX sites: initial loading, recompute loading, release-check loading and search field, aria-hidden.
Existing shared ErrorState is bounded once. Source policy17 whole files/56 exact UX sites.

Visible Search discovery label, existing MonoLabel/Input and .crate-form-field give real8px gap;
actions/input44px and both action flags expose aria-busy. Existing Ops metric/display recipes
and Bricolage/Poppins/Mono remain; base content grids explicitly use zero-minimum single columns.
All three GET URLs/query params, memos/filter/sort/summary, six slice limits, POSTs, real task
polling/timeout/outcome handling and canonical artist/album/acquisition/full-radar destinations
remain. Independent busy states and unmount cancellation are covered with real hooks. Genre
rows/global summaries retain their existing filtering semantics. No B5/A11/phase6.5 completion,
confidence/data/backend/shared/Listen/permission/dependency rewrite or integration certification.

Real sample <http://127.0.0.1:5186/admin-discovery-demo.html>, persistent `/#discovery-admin`.
Exact Discover importer-only API/useApi/useTaskPoll aliases, response-shaped fictional data,
actual shared data-hook factory and deterministic local request/task steps (including concurrent
operations). Native unit hooks remain real, with API/waitForTask boundaries stubbed. Preview
uses the existing per-window asset resolver for sample23/24 only: local abstract artwork and
one deliberately invalid image, plus local album-cover URL substitution. Shared route/asset
source remains unchanged; raw helper/asset arguments are verified independently. No API/SSE/
external-asset/library write. Routes open clearly labelled local destinations. Prior mockups
and1AG retirement remain; no canonical capture is replaced.

Observed RED10 expected /22 green for retirement/labels/targets/busy markers. Final **43 scoped
Vitest/4files**:15 new icon/contracts,2 existing Discovery,16 policy,10 affected Ops surfaces.
**Four preview +three built-Admin Chromium**,1440/768/390, serial workers1: search/keyboard,
independent request/task steps, partial completion via real status polling in built Admin,
errors/empty/loading, canonical destinations, actual fonts/8px pairs/44px controls/no overflow,
local artwork success/failure and persistent embedding with earlier statuses. Independent
NewReleases receives an empty snapshot solely for the route assertion; its page is not qualified.

Two scoped strict TS configs, scoped ESLint, literal-preserving AST audit, Admin build/types,
14-entry preview build (13 specimens plus static retired URL) and bundle pass. AST proves
4 function bodies,12 data/route declarations,3 GET/6 memo/4 state calls/1 task poll,4 route/asset
helpers+3 navigate calls,6 onClick/1 onChange/1 onError and6 slice bounds unchanged. Admin
initialJS **526617/532480B gzip**,10assets, **5863B margin**,39B below1AH. Generated cache
restored. SVG fixture uses explicit HTML formatter/XML parsing; no new image baseline. Logs
`.artifacts/review/1ai-*`; no complete suite/CI/canonical update.33PNG/manifest remain1M and
pin258bbaee unchanged. Live auth/backend/real data/assets, native/AT/zoom/other engines/phase QA
remain pending. Actual IAB proof `.artifacts/review/checkpoint-1ai-discovery.jpg`,1310×1424,
shows real specimen/data/retained search cue. Preview remains active; final review follows.
**Stop1AI uncommitted before another group or publication.**

### 1AI final review, executor rulings and checkpoint stop

One fresh read-only review inspected all21 pending files (including10 untracked), relevant
consumers, records and verification evidence against published1AH58b2695b. All14 frozen source
hashes match. Verdict: **ready for Diego review; Critical0 / Important0 / Minor0**. No repair
or second review. Reviewer ran no tests/builds/browser/network and made no repository changes.
The verdict does not authorize publication.

Executor rulings on every declined area:

1. Live backend/task execution/SSE/auth/permissions: preserve unchanged boundaries and pending integration QA. Cost: fixtures do not certify real workers, stream reliability or authorization enforcement.
2. Real artwork and existing broken-cover handling: retain raw helpers/dimensions/handlers and local success/failure evidence. Cost: real transport, cache and cover recovery remain unverified.
3. Filtering/global summaries/partial-data/error presentation: keep the tested existing semantics, including unfiltered genres. Cost: search wording and partial-read presentation can retain existing limitations; no data-state redesign is claimed.
4. Broader loading announcements/shared retry geometry/legacy surfaces/full AT accessibility: retain existing owners and rendering recipes. Cost: this is scoped keyboard/label/spacing evidence, not comprehensive accessibility or surface migration.
5. B5/A11/phase6.5/global icon migration: leave pending and preserve the implementation targets. Cost: this checkpoint completes only the bounded Discovery icon group.
6. Independent NewReleases behavior: the empty snapshot isolates the actual navigation assertion. Cost: destination data and workflows rely on that page's own tests/QA.
7. Earlier published implementations: preserve prior decisions and compatibility references without re-reviewing them. Cost: no renewed certification of earlier checkpoints.
8. Native/zoom/other engines/full suites/CI/canonical parity: honor the user's scoped iteration rule, preserve1M references/pin258bbaee. Cost: runtime/phase-close/parity validation remains pending.
9. Publication/merge/deploy/release/next group: stop1AI uncommitted on published1AH. Cost: Diego must review and authorize any subsequent publication or continuation.

Final evidence remains43 scoped Vitest,4preview+3built-Admin Chromium,2 strict configs,
scoped lint/AST/format/XML, Admin/14-entry preview builds and initialJS526617/532480B gzip
(5863B margin). Source stayed frozen after review; only closure records/proof changed.
Generated cache restored, other apps/Bandcamp/canonical source unchanged, original53177736
ancestor retained. HEAD/origin remain published1AH58b2695b39bbd91c477a968192ff74332a220e71.
The withdrawn1AG archive23SHA256 entries remain intact. No repeated tests for bookkeeping.

`crate-v3-preview.service` remains active on127.0.0.1:5186 with Node22 and this worktree.
Discovery, Bandcamp and retired Timeline URLs respond HTTP200. Actual IAB proof
`.artifacts/review/checkpoint-1ai-discovery.jpg` is advisory, not a canonical baseline. Review
<http://127.0.0.1:5186/admin-discovery-demo.html> or persistent `/#discovery-admin`. **Stop1AI
uncommitted for Diego; no commit/push, next group, PR/merge/rebase/deploy/release.**

## 1AI approval and publication — 2026-10-18

Diego approved Discovery checkpoint 1AI and explicitly authorised commit/push to the existing
feat/crate_v3 branch plus the next bounded Admin icon group, preserving functional UX glyphs.
The previous local-only 1AI stops are superseded by this approval. Discovery presentation,
data/task/navigation contracts and earlier checkpoints remain as reviewed. No full suites/CI,
canonical refresh, PR/merge/rebase/deploy/release. The next group stops at 1AJ before publication.

## Final Linux continuation — 1AI published; 1AJ New Releases local (2026-10-18)

Diego approved1AI and explicitly authorised commit/push plus one bounded next Admin group.
Published1AI `a304ecf9c41bc254dab98b9f52668e18f4d87852`, `feat(ui): retire redundant Discovery icons`;
push/remote ref verified, clean before1AJ. Publication verification:43 scoped unit cases and one
affected persistent-preview case pass. All previous reviewed specimens/retired Timeline redirect,
original53177736 ancestor, isolated worktree and active :5186 service remain.

**1AJ production scope is NewReleases.tsx only.** Retire idle check, labelled Download/view-mode,
summary, decorative empty/cover glyphs. Six retained source sites are bounded in the18-file /
62-UX-site policy. ErrorState and the dynamic AdminSelect remain individually bounded controls.

| Marker                    | Glyph   | Reason / behavior                                                  |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| releases-search           | Search  | Visible Search releases label and native Input,44px;8px label gap  |
| releases-loading          | Loader2 | Initial loading words/status and aria-hidden glyph                 |
| releases-check-loading    | Loader2 | Existing checking lock, aria-busy and task-lifetime indicator      |
| releases-download-loading | Loader2 | Downloading state word and busy visual, not a summary decoration   |
| releases-timeline-dismiss | X       | Native dismiss action, title/name/callback retained,44px           |
| releases-grid-dismiss     | X       | Same grid action, existing detected-only eligibility retained,44px |

The two dismiss controls now use shared Button outline/icon instead of the legacy dynamic
ActionIconButton wrapper. No shared change or new foundation: functional glyphs/names survive.
View buttons expose aria-pressed; filters and type/search controls retain existing contracts.
Search/type labels use .crate-form-field with actual8px spacing, not custom label margins.

Literal-preserving TypeScript AST comparison against published1AI confirms unchanged7 complete
route/date/action functions,9 data/capability/eligibility declarations,1 GET/6 state/3 memo/1 SSE
effect,3 POST/1 SSE URL/1 task wait/2 route helper calls,12 onClick/2 onChange/2 raw src/2 alt,
and2 response interfaces. Thus snapshot/stream URL, cleanup/malformed handling, raw image URLs,
canonical paths, permission checks, local optimistic status/dismiss updates and300000ms task
wait remain intact. No auth, backend, shared export, dependency or Listen/Desktop change.

Existing limitations deliberately remain: global counts are independent of filters, upcoming
includes today's date, unknown-status actions differ by view, image URLs have no new recovery,
a completed status is the only check outcome that refetches (failed terminal tasks release the
lock without a new error toast), and SSE has its prior error/reconnect/schema behavior. These
are preserved contracts, not newly certified or expanded workflows. Future ReleaseTimeline/B6/
A10/phase6.5 and global1b.8 remain incomplete.

The isolated specimen mounts actual NewReleases and AuthContext with page-import-only api/useApi/
waitForTask aliases plus a specimen-window EventSource double. Fictional response-shaped releases,
existing local SVG, task completion/failure, curation/acquisition/read-only permissions and local
router destinations exercise the UI without backend/API/SSE/external assets or library writes.
Toolbar exposes queued request and terminal task as separate steps; local valid/malformed SSE
can replace/preserve a surface. This is neither real integration nor authorization QA.

Verification before final review: observed6 expected RED/29pass. Final47 scoped Vitest /3files
(21 page behavior,16 policy,10 Ops) green; strict unit/preview TS configs green; scoped ESLint
and literal-preserving AST audit green. Preview Chromium3cases at1440/768/390 plus1persistent
case green (the persistent mount omission was caught and fixed without test weakening). Built
Admin3cases at the same widths green, with actual useApi/real task waiting, deferred POST+GET,
canonical hrefs, filters/select, view state, download/dismiss and fonts/8px/44px/no-overflow.
Unit tests additionally cover separate capabilities, hard-error Retry, pending/empty, full/
failed/rejected checks, POST failure, filtered SSE replacement/malformed tolerance and close.

Built Admin/types pass. InitialJS **526574 /532480Bgzip**,10 assets,5906B margin (43B below1AI).
Preview build and final evidence/review closure follow below. Logs .artifacts/review/1aj-\*. No
full suites/CI/canonical refresh or new claims for native/AT/zoom/other engines/live integration.
The33 canonicalPNG/manifest remain1M, pinapp/web@258bbaee unchanged; prior checkpoints preserved.
Review <http://127.0.0.1:5186/admin-new-releases-demo.html> or persistent /#lanzamientos-admin.
**Stop1AJ uncommitted for Diego, before publication/next group/PR/merge/rebase/deploy/release.**

1AJ pre-review closure: Admin build/types and all15 preview HTML entries pass (14 specimens plus
the retired Timeline redirect). Scoped lint exit0, both strict TS configs pass. Generated Admin
tsbuildinfo restored from published1AI. Actual IAB review inspected the ready page and portalled
type selector above release actions, closed with Escape and retained focus. Review proof:
.artifacts/review/checkpoint-1aj-new-releases.jpg (1300×1413). Preview service active/HTTP200.
Source freeze and one fresh complete pending-diff review follow;1AJ remains uncommitted.

### 1AJ final review and checkpoint stop

One actual fresh read-only review covered all20 pending files and the complete105230B diff;
all13 frozen source hashes and nine untracked additions matched. The preferred-model dispatch
failed at capacity before doing any review; the available fresh gpt-6.1-sol reviewer performed
the single actual review. No tests/builds/browser/network/mutations during that review.
**Critical0 / Important0 / Minor1.** No blocking repair or second review is required.

**Minor deferred:** the visible "Release type" caption and the shared AdminSelect accessible
name "All types" differ because its existing aria-label comes from placeholder. The visible
"All types" trigger text, keyboard operation and clear option remain. A shared-control follow-up
should support an explicit label association, preserve placeholder/clear behavior and test both
consumers. This is recorded as a deferred minor, not silently fixed or treated as a policy ruling.

Executor rulings on every review area set aside, in reviewer order:

1. Global summary counts independent of filters: preserve the existing global readings while the radar list filters; this rendering checkpoint does not redefine statistics. Cost: filtered-list totals and global summary can differ, as before.

2. Today as upcoming, string-based date ordering and unknown date/type handling: preserve the actual date helpers and data contract. Cost: existing date/unknown wording and ordering limitations need their later product review.

3. Unknown-status timeline/grid action differences: preserve the distinct eligibility conditions, now characterized in tests. Cost: an unknown status may offer actions in timeline that grid does not offer; no unrequested acquisition change.

4. Failed terminal checks and rejected-wait wording: keep the existing task feedback: failed terminal status unlocks without a new error toast, rejected waits retain queue-error wording. Cost: these pre-existing feedback limits remain for later task work.

5. SSE validation/recovery/reconnection/credentials: keep the unchanged effect/URL/cleanup and malformed-JSON tolerance. Cost: live transport/reconnect/schema limitations are not repaired or certified by fixture evidence.

6. Missing/broken artwork recovery: preserve raw source URLs, existing helper inputs and reserved blank areas. Cost: no new broken-artwork retry/fallback behavior; real asset delivery remains unqualified.

7. Live backend/workers/authentication/server authorization: use fixture evidence only for rendering and boundary contracts; server enforcement and task execution are unchanged. Cost: real integration/permission QA remains pending.

8. ReleaseTimeline/B6/A10/phase6.5/global1b.8: complete only this bounded icon group. Cost: future instruments/data/product work and remaining Admin icon groups still need implementation and review.

9. Native/AT/zoom/other engines/full suite/CI/canonical parity: honor scoped iteration and retain the33 canonical1M images/manifest and pinned reference. Cost: no current full-phase or platform/reference-parity certification.

10. Publication/merge/deploy/release/next group: stop at local uncommitted1AJ on published1AI. Cost: Diego must approve before publication or further continuation; no automatic next group.

Final review verdict: ready for Diego's1AJ visual review, not merge/publication. Review evidence
and actual IAB proof remain .artifacts/review/checkpoint-1aj-new-releases.jpg1300×1413.
Sources are unchanged since47 scoped unit and7 browser cases passed; no reruns for this
documentation-only closure. Active preview and published1AI HEAD remain intact. **Stop1AJ
uncommitted for Diego; no push, next group, PR/merge/rebase/deploy/release.**

## 1AJ approval and publication — 2026-10-18

Diego approved1AJ and explicitly authorised commit/push to feat/crate_v3 plus one further
bounded Admin icon group, preserving functional UX glyphs. Previous local-only1AJ stops are
superseded. The deferred shared Select label association remains recorded; no unreviewed fix.
Next checkpoint1AK covers Global Catalog and stops before publication for Diego. No full
suites/CI/canonical refresh, PR/merge/rebase/deploy/release; prior checkpoints remain intact.

## Final Linux continuation — 1AJ published; 1AK Global Catalog local (2026-10-18)

Diego approved1AJ and explicitly authorised commit/push plus one further Admin icon group.
1AJ is published as `235b892f5dadab07faf3ae7a1a1727864b7a06c9`, `feat(ui): retire redundant New Releases icons`.
Push/remote ref verified; clean before1AK. Publication check47 scoped units and1persistent preview
case pass. The existing shared Select visible/accessiblename minor remains deferred, not fixed.
The active V3 worktree, original53177736 ancestor and :5186 service remain; leave MCP checkout alone.

**1AK production scope: GlobalCatalog.tsx only, including private rendering.** Remove redundant
Refresh, idle Reconcile/Full rebuild and read-model title icons. Retain two source sites:

| Marker                      | Glyph   | Function                                           |
| --------------------------- | ------- | -------------------------------------------------- |
| catalog-incremental-loading | Loader2 | aria-hidden busy indicator during incremental POST |
| catalog-full-loading        | Loader2 | aria-hidden busy indicator during full POST        |

Both mode buttons expose aria-busy and retain one shared disabled lock. Policy now checks19 whole
files /64 retained UX sites. Read-model content uses the existing StatusDot with its exact word:
ready=on, degraded=warn, refreshing/fallback/unknown=off. No title ornament or inferred healthy
state while unavailable. The four existing counts reuse OpsStatTile (.crate-form-field,8px),
with Bricolage figures/headings, JetBrains labels/run IDs/modes/date/source metadata and Poppins
body/controls. Native Overview/Runs/Duplicates retain state/handlers, gain explicit type,
aria-pressed and44px targets. No URL tab migration, foundation variant or shared export change.
Narrow-column wrapping preserves all source/run text rather than overflowing.

Literal-preserving TypeScript AST audit against published1AJ confirms identical5 format/action
functions (including full queueReconcile),6 data/capability/view declarations,1 auth/3 GET/2 state/
1 POST/13 format helper calls,4 onClick,3 response interfaces andTabtype. GETs retain status,
runs?limit=25 andduplicates?limit=50; refresh reads status only. Both POST bodies and policy
federation.policy.manage stay unchanged. No backend/auth/dependency/Listen or task/SSE change.

**Observed baseline contract:** useApi.refetch returns void. queueReconcile's Promise.all dispatches
status/runs refreshes, then releases the lock; it does not await those reads or worker completion.
The real-hook tests exposed the earlier plan assumption, which was corrected without changing
that handler. Tests explicitly keep buttons enabled while reads remain pending, and both modes
retain POST locking. The specimen separates POST and read steps and does not invent a completed
rebuild/run. No change to current fallback zero/unknown/error semantics, candidate order/match
metadata or source choices; live data delivery and B17 status snapshot work remain unqualified.

Actual isolated page uses page-import-only api/useApi aliases, actual hook factory and sample
AuthContext. It has response-shaped fictional data, manual POST/read steps, failure and management
permission toggles plus serving/loading/empty/read-error states. It does not contact a backend,
perform real federation/reconciliation, fetch external assets or persist preferences. Fixed identity
bootstrap is unchanged. Review /admin-global-catalog-demo.html or persistent /#catalogo-global-admin.

Scoped verification:9 expected RED/23pass; final42 Vitest /4files (15 new page cases,1 existing,
16 policy,10 Ops) pass. Preview4 cases and builtAdmin3 at1440/768/390 workers1 pass. Real hooks/
POST bodies, deferred enqueue/refetch, read-only capabilities, mode busy/failure, native keyboard
views, run/duplicate words, fonts/8px/44px/no-overflow are covered within their stated fixtures.
Two strict TS configs, final preview TS, scoped ESLint and AST audit pass. Admin/types build and
16-entry preview build pass (15 specimens + retired Timeline redirect). InitialJS **526533 /
532480Bgzip**,10assets,5947Bmargin (41B below1AJ). Generatedcache restored. Actual IAB ready-page
proof .artifacts/review/checkpoint-1ak-global-catalog.jpg1310×1424. Logs .artifacts/review/1ak-\*.

No full suites/CI/canonical refresh. The33 canonicalPNG/manifest stay1M, sitepinapp/web@258bbaee
and earlier checkpoints/withdrawn Timeline archive stay intact. Native/AT/zoom/other engines/
real backend/server authorization/full-phase QA and reference parity remain pending. This does
not complete1b.8, B17/A24/phase6.7 or add duplicate resolution. Final fresh review follows.
**Stop1AK uncommitted for Diego before publication/next group/PR/merge/rebase/deploy/release.**

### 1AK final review and checkpoint stop

One fresh read-only review covered all20 pending files, all9 additions and complete90834B diff;
tracked/new-file contents and all13 frozen source hashes matched. HEAD/origin remain published1AJ.
Existing logs/proof were inspected; reviewer ran no tests/build/browser/network and changed no
source/index/ref/service/checkout. **Critical0 / Important0 / Minor1.** No blocking repair or
second review is required. Sources remain frozen.

**Minor deferred:** tools/design-system-preview/admin-global-catalog-checkpoint.tsx23–24 still
says "bloqueo hasta terminar las lecturas". That is stale explanatory copy: the actual preserved
contract unlocks after enqueue, while status/runs reads may remain pending. Suggested follow-up:
"bloqueo durante el envío y lecturas posteriores asíncronas". Do not change the handler to match
that wording. The review's Minor-deferral policy leaves this discrepancy explicit for Diego;
standalone controls, plan, tests and this handover describe the correct enqueue behavior.
The earlier1AJ shared Select label minor remains separately deferred.

Executor rulings on every review area set aside, in reviewer order:

1. Repeated enqueue while reads/tasks are pending: preserve the current POST-only lock and void-refetch contract, rather than introduce a lifecycle fix in icon work. Cost: another enqueue remains possible before updated data or worker completion; future task work must decide prevention/dedup.

2. Unavailable-read error/unknown/zero/empty presentation: preserve the tested baseline and do not invent a new snapshot/error contract. Cost: these fallbacks are not confirmation of an empty catalog; live/error-state redesign remains pending.

3. Duplicate resolution/additional source metadata: retain the existing inspect-only candidate/source rendering and response fields. Cost: no new resolution action or expanded source presentation is provided here; later A24 work owns it.

4. Actual reconciliation effects/performance/server authorization: keep backend/API/permission contracts unchanged, with fixture-only UI evidence. Cost: real worker effects, B17 status-snapshot performance and server enforcement need integration/phase6.7 QA.

5. Native/AT/zoom/other engines/canonical parity: limit evidence to scoped Chromium and advisory IAB image; preserve canonical1M and the approved site pin. Cost: no platform/full-phase/current-reference-parity certification; those checks remain pending.

6. Earlier shared Select label association: carry the existing1AJ deferred minor without changing shared controls in this group. Cost: that accessible-name association still needs its own shared-consumer follow-up.

Verdict: ready for Diego's1AK review, not publication/merge. Task1 implementation is complete;
visual approval remains pending.42 scoped unit/7 browser cases, types/lint/AST/build/budget
results remain valid against unchanged source hashes; no reruns for documentation-only closure.
Actual IAB proof .artifacts/review/checkpoint-1ak-global-catalog.jpg1310×1424. Keep :5186 active.
**Stop1AK uncommitted before another group, commit/push, PR/merge/rebase/deploy/release.**

## 1AK approval, requested copy correction and publication — 2026-10-18

Diego approved1AK and explicitly requested correcting its persistent specimen text before
commit/push, then one further bounded Admin icon group. The stale lock-copy minor is resolved:
"bloqueo durante el envío y lecturas posteriores asíncronas". The production POST-only lock and
void-refetch handler remain unchanged. Earlier1AK local/Minor-deferral stops are superseded by
this instruction. Shared Select label minor from1AJ remains separate and deferred.
Next stop1AL covers Roles & Permissions; preserve UX, preview and all checkpoints. No full
suite/CI/canonical refresh, PR/merge/rebase/deploy/release or other checkout.

## Accepted Users direction — 2026-10-18 (Diego)

When the Admin Users group is reached, remove its map. The primary view will be a user list,
with the principal available user data and current state shown in each row. User detail opens
in a modal, rather than adding detail content to the list. This explicit direction supersedes
older Users map proposals/targets. Preserve existing capability gates, actual data and actions;
choose concrete columns/detail content against available contracts in that group's review.
No Users/UserMap implementation or backend work is part of current1AL Roles. Keep the normal
visual checkpoint before publication of that later Users group.

## Final Linux continuation — 1AK published; 1AL Roles local (2026-10-18)

1AK is published as **44d5f16a1eb20d6b7c89e6b22aee768d86c5bac2**,
`feat(ui): retire redundant Global Catalog icons`. Diego's explicit copy correction is included:
“bloqueo durante el envío y lecturas posteriores asíncronas.” The affected persistent preview
case passes; approved product code and unaffected source hashes stay intact. Push/remote ref
verified; clean before1AL. The1AK mockup-copy minor is resolved; earlier Select-label minor from
1AJ remains deferred. The current preset-editing question was answered as a current limitation,
not treated as authorization for a custom-role editor.

**Production scope is Roles.tsx rendering only.** Remove ShieldCheck and its decorative header
tile. Display font on page/section titles and role names; MonoLabel/mono on slugs, group labels
and capability IDs. Role-name/slug and group/capability pairs share .crate-form-field, measured8px.
Metadata wraps at narrow widths without expanding the grid. Existing loading text gains
role=status and an accessible name; no functional glyph was present here to preserve/remove.
Whole-file icon policy now covers20 files and retains64 UX sites; no new exception/allowlist.

Literal-preserving AST audit against published1AK proves identical capabilityGroup, two state
hooks, one full mount effect/GET, one full grouped memo and two response interfaces; four map
receivers/parameters/keys and capability counts stay. Group alphabetical order, within-group
API order, role order, role counts and null/empty rendering remain. The real router/sidebar
roles.view gates are untouched; admin and a read-only role can view the actual built page.
No POST, role editor, creation, permission mutation or new action. No backend, shared, Listen,
dependencies, URL/view contract or Users/UserMap source changes. A19/phase6.6/global1b.8 remain
incomplete. The existing .finally read chain has no catch/error UI or cancellation cleanup;
that pre-existing integration limitation is neither changed nor certified here.

**Review:** <http://127.0.0.1:5186/admin-roles-demo.html> and persistent `/#roles-admin`.
Actual Roles mounts with an importer-only API fixture, response-shaped fictional presets and
real known capability strings. Only ready/loading/empty/null samples; pending read resolves
manually. No auth simulation inside the isolated page, backend/external requests, real mutation,
preferences or rejected-promise specimen. Earlier frames/checkpoints remain; footer says1AK
published/1AL in review. Actual IAB ready-page composition inspected; proof saved at
`.artifacts/review/checkpoint-1al-roles.jpg`. Preview systemd user service remains active5186.

**Scoped evidence, serial:**

- Vitest new Roles rendering6 + existing Roles1 + source policy16 = **23pass/3files**,
  --maxWorkers=1. Expected RED3/20pass before implementation, then GREEN. Real component/effect;
  external API only is stubbed. Data/order/count/group/loading/read-only/null/empty covered.
- Preview Chromium **4pass**, standalone1440/768/390 + persistent. Real fonts, measured8px,
  wrapping/no overflow/no glyph/actions, keyboard sample loading/manual finish and empty/null;
  no page errors/backend/external traffic. Corrected1AK copy and earlier frames retained.
- BuiltAdmin Chromium **6pass**,1440/768/390 × admin/read-only auth fixtures. Real /roles route,
  actual GET client, roles.view gate, rendered payload and no role-edit/POST UI. Fictional user
  grants admin.access and roles.view only. Client/browser proof does not certify server auth.
- Strict scoped unit/preview TypeScript and scoped ESLint exit0; Admin build/types and preview
  build pass (**17HTML entries:16specimens + Timeline redirect**). Literal-preserving AST audit
  passes. The first audit over-compared entire map JSX; corrected projection to business
  receivers/parameters/keys/count while retaining full effect/memo/interface checks. No logic
  change was made to satisfy that harness correction.
- **Initial JS526505/532480Bgzip**,10assets, **5975B margin**,28B below1AK526533. Existing chunk
  warning only. Generated tsbuildinfo restored. No dependency/budget-ceiling change.

Logs: `.artifacts/review/1al-{red,unit,preview,admin-browser,types,lint,contract-audit,bundle,preview-build}.log`.
Plan/ledger: `2026-10-18-crate-v3-roles-icons.md` and
`.superpowers/sdd/2026-10-18-crate-v3-roles-icons/`. One fresh final read-only review follows.
The future Users map removal/list/status/modal decision above remains binding for that later
group, with real data/actions/capability gates and its own visual review.

Executor rulings before review:

1. Scoped checkpoint tests and preserved evidence override generic full-suite/commit/cleanup/
   finish-branch skill steps. Cost: phase/native/live/canonical QA remains pending; no phase
   completion or release claim.
2. Preserve existing rejected-read/unmount behavior because changing data effects/error/
   cancellation exceeds this rendering group. Cost: Roles read-error handling and live/native
   integration remain pending; no successful-error-recovery claim.

No full suite/CI/canonical refresh.33canonicalPNGs/manifest remain1M and sitepin258bbaee unchanged.
Native/AT/live backend/server enforcement and final phase QA remain pending. **Stop1AL uncommitted
for Diego before commit/push, another group, PR/merge/rebase/deploy/release.**

### 1AL final review and checkpoint stop

One fresh independent read-only reviewer (gpt-6-astra high) reviewed all20pending files,
including9untracked, against published1AK44d5f16a. Manifest/patch agree and all13source hashes
match the freeze. **Critical0 / Important0 / newMinor0.** Ready for Diego visual review only;
no corrective pass/re-review is indicated. Existing1AJ shared Select-label association remains
deferred. Report: `.artifacts/review/1al-final-review.md`; freeze/package in this plan's retained
.superpowers workspace. Prettier20files and diffcheck pass; source unchanged by formatting.

Executor rulings on every behavior the reviewer set aside (in addition to the two workflow/
existing-error rulings above):

1. Rejected read/error/retry: preserve the pre-existing catch-less chain; no error recovery claim in a rendering-only change. Cost if wrong: failed reads still lack a page error/retry surface until a separate integration fix.
2. Unmount/cancellation: preserve the unchanged mount effect and document the lifecycle limit. Cost if wrong: late completions remain unguarded; no cancellation/lifecycle guarantee.
3. Live backend/session/server auth: fixture evidence demonstrates client behavior only. Cost if wrong: live payload/session/enforcement integration remains unverified.
4. Denied capability combinations: keep inspected unchanged roles.view router/sidebar gates and tested authorized admin/read-only fixtures. Cost if wrong: exhaustive denial combinations remain untested; no expanded authorization certification.
5. Preset editor/custom roles/mutations: retain the existing read-only catalog; Diego asked about its current limitation, not for an editor. Cost if wrong: creation/editing still requires separately scoped product/backend work.
6. Future Users implementation: record accepted no-map/list+state/modal direction, leave Users code for its own group. Cost if wrong: future actual columns/actions/modal and integration still need implementation and review.
7. Existing shared Select-label minor: carry prior1AJ deferred association issue; no shared edits in Roles. Cost if wrong: that shared accessible-name association still needs its own affected-consumer follow-up.
8. Other Admin icons/A19/phase6.6/global1b.8: claim completion of the bounded Roles icon group only. Cost if wrong: remaining app/phase work has no renewed certification.
9. Native/AT/other browsers/full accessibility: limit proof to scoped Chromium/DOM/fonts/spacing and saved IAB composition. Cost if wrong: native/real AT/other engines/full a11y behavior remains unverified.
10. Fullsuite/CI/canonical/finalphase: honor Diego scoped iteration and keep canonical1M/sitepin258bbaee. Cost if wrong: broader regressions/canonical comparison and finalphase QA remain pending.
11. Publication/deploy/release/finalvisual acceptance: stop1AL uncommitted on published1AK with preview active for Diego. Cost if wrong: the new rendering stays local until approved; no next group or publication.

Task1 is complete for local review; documentation-only review closure follows the source freeze.
HEAD/origin/remote remain **44d5f16a1eb20d6b7c89e6b22aee768d86c5bac2**, original53177736ancestor
retained.13source hashes and20pending-file scope match; backend/shared/Listen/Users/dependencies/
site/canonical/generatedcache are unchanged.17previewHTML entries verified, serviceactive and
standalone/persistent HTTP200. No full suites/CI/baselines/PR/merge/rebase/deploy/release.
**Stop1AL uncommitted for Diego; no next group.**

## 1AL approval and publication authorization — 2026-10-18

Diego approved1AL and explicitly authorized commit/push on feat/crate_v3 followed by one further
bounded Admin icon group, preserving functional UX glyphs and the persistent preview. Previous
local1AL stops are historical and superseded by this approval. Approved production source and
all13pre-publication source hashes were verified; only specimen/footer publication labels and
the affected persistent check change for publication. No full suites/CI/canonical refresh,
PR/merge/rebase/deploy/release. Next stop is1AM, uncommitted for Diego before publication.

## Final Linux continuation — 1AL published; 1AM Users local (2026-10-18)

1AL is published as **d72232e9ef581248ae59a1289bd357dec0629db1**,
`feat(ui): retire redundant Roles icons`. All13reviewed source hashes matched before publication;
only specimen/footer labels and affected assertion changed. One affected persistent case passes.
Push/remote ref verified; clean before1AM. Diego authorized the next bounded group; prior1AL
local stops are historical. His accepted Users amendment is implemented here, without a new
role-preset editor or a backend presence-query rewrite.

**Production scope: Users.tsx rendering and obsolete map-only wiring.** Remove the lazy map
import/mount, its map-only capability variable and inspect adapter; actual users.view router/
sidebar gates stay. Existing unused UserMap sources/utilities are deliberately retained for
later cleanup, with no Users route reference or map request. Repeated large cards become a
semantic table: identity/email/roles, account/activity state, presence/devices/sessions/last seen,
and existing Inspect/Delete actions. On narrow layouts presence is under identity; state and
actions remain. Current track, linked accounts, timestamps, access and session detail remain
in the actual existing modal. No invented data/API. A18/B17/phase6.6/global1b.8 are incomplete.

Remove redundant header/metric/destination/action/content glyphs throughout the file; retain
**12individual UX sites**: search1, pagination2 and loading9. Keep shared DialogContent4 close
controls and ConfirmDialog1, each bounded separately in the policy. **21whole files/76retained
UX sites**, no blanket module/wrapper exemption. Name loading and pending actions accessibly.
Bricolage headings, Poppins prose, mono metadata; shared8px readout/form pairs, including modal.
Add real Name/Email/Password labels; field values/validation/handlers are unchanged. Native action
buttons have44px targets, existing shared selectors keep fine32/coarse44px recipes.

Literal-preserving TypeScript AST audit against published1AL confirms **182identical data/type/
function declarations and67event/state/validation bindings**, excluding only the retired lazy
map, gate and adapter (including its local target). GET list/detail, list/data interfaces,
search/filter/presence sort/page20, ?inspect=/other parameters, detail abort cleanup, remaining
capabilities and role/status/session/password/create/invite/delete handlers/bodies/validation/
disabled/confirmation/feedback stay. Role picker adds pressed semantics; no API/auth/shared/
Listen/dependency change. Tests use only fictional accounts/credentials and local endpoint doubles.

**Review:** <http://127.0.0.1:5186/admin-users-demo.html> or persistent `/#usuarios-admin`.
Real Users with importer-specific API alias and actual AuthContext value, complete fictional
response fixture, ready/loading/empty states, local view-only capabilities, manually resolved
reads/mutations and deliberate action failure. In-dialog sample completion stays inside the
actual portal/focus trap; production component has no sample controls. Clipboard replacement
is isolated to the specimen document and never writes the real clipboard; invites send no mail.
No backend/external requests, real credentials/access changes or preferences. All earlier
checkpoints remain; footer says1ALpublished/1AMreview. Native/live integration is not certified.

Scoped evidence so far: **29Vitest/3files** (new10 + existing3 + policy16), --maxWorkers=1;
RED7expected/19pass before implementation. **5preview Chromium cases** (1440/768/390 + persistent

- pending-read/rejected-mutation), --workers=1. Measured final8px, no overflow, actual modal,
  view-only and local mutation behavior. Strict scoped unit/preview TS pass. AST audit passes.
  Initial audit harness had an invalid execFileSync option, then omitted the removed adapter's
  local target from its explicit removal list; both harness issues corrected without business
  logic changes. Type checks caught test-only unsupported exact options/unused parameters and a
  fixture regex optional capture; corrected. Browser geometry initially ran during dialog scale
  animation; now waits for the actual animation finish before checking8px, without widening the
  spacing tolerance or altering shared motion. Built Admin/build/budget and final review follow.

Executor rulings: scoped tests/checkpoint/preserved evidence override generic full-suite/commit/
cleanup/finish-branch skill steps (cost: broader QA remains pending). Remove only map UI/wiring,
retain unused map sources/utilities for later cleanup (cost: dead code remains; no completed
B17/A18 claim). Existing shared selector sizing wins over this task plan's overly broad44px
wording (cost: actual device/coarse-pointer QA remains pending; no shared variant is introduced).
Shared Select-label minor remains separately deferred from1AJ.33canonicalPNG/manifest stay1M,
sitepin258bbaee unchanged. **Stop1AM uncommitted for Diego before publication or another group.**

### 1AM review steering — larger avatars and wider detail

Diego requests larger user avatars and more viewport width for the detail modal. Row avatars
are56px, also visible on narrow layouts; detail avatars72px. The old sm:max-w-6xl utility was
constrained by the shared default md size (560px). Users detail explicitly opts out of that
size attribute and uses its existing viewport width minus32px, with shared chrome, animation,
focus trap, close behavior and scroll intact. No new shared variant or other modal change.
A browser regression assertion observed560px before the fix; final geometry must exceed90%
of the viewport at1440/768/390. No canonical images are regenerated.

### 1AM final validation before independent review

Final widened detail and enlarged avatars pass5preview cases and6builtAdmin cases, including
admin/view-only at1440/768/390. Width regression RED1 observed560px; GREEN exceeds90%viewport
at each width with the existing32px outer gutter. Final native role-selector target sizing and
formatting were additionally checked by one390px preview replay and one390px builtAdmin replay;
no broad suite rerun. Full app build/types and scoped ESLint exit0, strict unit/preview TS exit0,
18preview HTML entries build. **InitialJS526491/532480Bgzip**,9assets, **5989Bmargin**,14B below
published1AL526505. Existing chunk/NO_COLOR warnings only. Generated tsbuildinfo restored.
AST182data/type/function declarations and67event/state/validation bindings match1AL; only map
wiring and the explicit visual-only avatar dim variable are excluded. No data/effect/handler
change was made to satisfy audit or browser fixtures.

Built-browser helper originally checked the underlying navigation while ?inspect intentionally
made it inert; the local test now settles the list then visits the actual deep link. No shared
fixture or production behavior change. A relative cache-restoration trap initially ran after
cd app/ui and failed; final trap uses the absolute tracked cache path and restores it correctly.
All checks are serial. Logs `.artifacts/review/1am-{unit,preview,preview-pending,admin-browser,
final-layout,final-admin-layout,types,contract-audit,bundle,preview-build,lint,format}.log`;
width RED log `1am-modal-width-red.log`. Actual IAB list and final wide detail inspected; proof
`checkpoint-1am-users.jpg` and `checkpoint-1am-users-detail.jpg` in the same review directory.
Preview service remains active5186; source freeze and one fresh full-diff read-only review follow.
No full suites/CI/canonical refresh or publication of1AM.

### 1AM final independent review, single tested fix pass and stop

One fresh gpt-6-astra high reviewer inspected all21pending files and14source hashes against
published1AL; all matched, read-only, no test reruns. Report `.artifacts/review/1am-final-review.md`:
Critical0/Important2/Minor2. Executor regraded the pending password-name omission from Minor to
Important because a focused test proves the active submit loses its name during the real
pending request. Cost: one additional rendering-only accessibility fix, no business/API change.
The sticky header remains a deferred Minor (DS§5.5); the separate1AJ Select-label minor remains.

One tested fix pass, no re-review:

- Direct label measurements reproduced14px for Account status and20px for New password; align
  the selector at row top and password label at row bottom, retaining44px action targets. Both
  now measure exactly8px to their actual control, not merely to the wrapper.
- Sample completion selected the underlying dialog during nested password submit. Select the
  last visible/open dialog-or-alertdialog, retaining the real portal/focus trap. New nested
  password completion test fails before and passes after the fix.
- Focused pending-password-name test fails before and passes after a persistent Set/Reset
  password accessible name; disabled/loading behavior and request body stay.
- A new delete sample test initially assumed the confirmation waits for backend completion.
  Inspection and snapshot establish unchanged void handleDelete dispatch: confirmation closes
  before API completion, leaving the sample header available. Preserve that existing contract
  and test closed-confirmation/header completion. Cost: inherited mutation concurrency/error
  behavior and lack of a backend-long confirmation lock remain outside this rendering change.
- ES2020 preview types reject Array.at; use equivalent indexed last-element access without
  raising the target. This remained inside the same fix pass until all scoped gates passed.

Final evidence: **30unit/3files** (new11/existing3/policy16), **9preview +6builtAdmin Chromium**,
serial workers1. Strict scoped types, app build/types, scoped lint, AST182declarations/67bindings,
18-entry preview build, formatting and diffcheck pass. **InitialJS526482/532480Bgzip**,9assets,
**5998Bmargin**,23B below1AL526505. Generatedcache restored. Fix logs:
`.artifacts/review/1am-review-{name-red,browser-red,unit,preview,admin-browser,types,format}.log`;
final bundle/build/lint/audit logs retain the normal1am names. Original reviewed14source freeze
is preserved alongside source-freeze-after-fixes.json; only4expected source files changed in
the tested pass (page, its new unit tests, specimen controller and browser regression checks).
No request/effect/mutation/capability/dependency/shared/Listen/source-map change in that pass.

Executor rulings on every behavior the reviewer set aside:

1. Backend presence/aggregation/query performance: keep actual unchanged API data and defer A18/B17/phase6.6 backend work. Cost if wrong: live accuracy and query performance remain unverified.
2. Unused map sources/utilities: retire only Users UI/wiring and retain source for later cleanup. Cost if wrong: dead source remains; no map-runtime or B17 completion claim.
3. Role-preset editor: preserve current Roles catalog and existing per-user role assignment; no preset creation/editing. Cost if wrong: custom presets still require separately authorized product/API work.
4. Live credentials/invites/sessions/server authorization: use fictional request fixtures and unchanged capability gates only. Cost if wrong: live delivery/credential/enforcement behavior is not certified.
5. Inherited concurrency/refetch/errors: preserve all action/effect bodies including void delete dispatch and immediate confirmation close. Cost if wrong: existing retry/refetch/race/error semantics remain; no backend-long lock claim.
6. Native/coarse pointer/AT/other engines: limit evidence to actual scoped Chromium/DOM/IAB and existing shared recipes. Cost if wrong: device/real AT/non-Chromium behavior still needs QA.
7. Earlier shared Select-label association: carry the separate1AJ deferred minor with no shared changes. Cost if wrong: that shared accessible-name association still needs its own consumer follow-up.
8. Shared selector fine32/coarse44: preserve the existing shared identity recipe while native action/role buttons are44. Cost if wrong: actual coarse-device geometry remains unverified.
9. Other modal widths: widen only User Detail at Diego request; retain existing password/add/invite widths. Cost if wrong: their inherited size defaults and geometry are not redesigned here.
10. External avatar loading/auth/fallback: change only displayed dimensions; fixtures use initials and existing image path stays. Cost if wrong: external photo delivery/failure behavior remains untested.
11. Other icons/routes/shared/Listen/canonical: complete only this bounded Users checkpoint; preserve all previous work and pin. Cost if wrong: global1b.8/remaining phase work and canonical comparison stay pending.
12. Fullsuite/CI/publication/deploy/release: honor scoped checkpoint validation and stop1AM uncommitted for Diego. Cost if wrong: full phase/release readiness and publication require later authorized work.

Deferred minors: sticky Users table header (new); shared Select-label association (existing1AJ).
Task1 and local1AM implementation are complete for Diego's visual review, not publication or
phase/release completion. Source14post-fix hashes and21file scope are retained; workspace and
proofs stay. Preview remains active5186. **Stop1AM uncommitted on published1AL d72232e9 before
another group, commit/push, PR/merge/rebase/deploy/release.**

### 1AM approval and publication — 2026-10-18

Diego approved the final Users checkpoint, including enlarged avatars and the wider detail
modal, and explicitly authorized commit/push on feat/crate_v3 and the next bounded Admin
icon group. Approved source14 hashes match the post-fix freeze. Only publication labels
change before committing; existing scoped verification and deferred minors remain recorded.
Next stop is 1AN, uncommitted for review. Preview stays active5186; preserve UX glyphs and
all prior checkpoints. No PR, merge, rebase, deploy, release or broad CI.

### 1AM published; 1AN Translations local — 2026-10-18

Diego approved1AM, including larger avatars and the viewport-wide User Detail modal.
Published1AM is `b0f20194fb364e24cd3edb18e9b1c6084cb34f96`, origin/feat/crate_v3 matches.
Publication-only label regression passed1case; approved14source hashes matched before publish.
Previous local1AM stop is superseded by that explicit approval. Deferred Users sticky-header
and shared Select-label minors remain; no hidden fixes were included in publication.

Next bounded group1AN is actual Admin Translations (I18nReview.tsx), admin.access gated through
App and Sidebar. CommandPalette maintains a separate list without a Translations entry;
leave that inherited navigation scope unchanged. Profile
redirects to Users and was not restyled. Remove redundant Languages/Clock/RefreshCw/CheckCircle2/
XCircle glyphs in headings, states and labelled actions. Preserve8concrete Loader2 UX sites;
whole-file policy now22files/84UX sites. Inventory /icon/i matches the boolean aiConfigured:
a single exact page/component/prop/initializer exception is bounded and negative-tested.
No shared foundation variant, dependency, Listen/backend/auth/capability/API change.

Bricolage headings, Poppins body and JetBrains metadata; actual8px native-filter, editor-field
and metadata readouts through crate-form-field. Editor rows stack on narrow screens, action
buttons wrap and remain44px minimum. Original tab state/native-select and all request/effect/
filter/sort/count/payload/validation/disable/feedback contracts remain; phase6.8 page-tab/URL
adoption is separate. Correct inherited Import/Export prose to describe the existing Editor
export and unavailable import, without adding tooling.

Review http://127.0.0.1:5186/admin-translations-demo.html or persistent /#traducciones-admin.
Real page, importer-only API fixture, full fictional response data; manual loading, failures,
AI-draft/save/publish/reject/export and dev-workspace JSON simulation. Only the specimen's exact
Listen dev-catalog fetch URLs are intercepted locally; no real dev catalog, backend, auth,
external traffic, preferences or translation files. BuiltAdmin checks use actual route and
boundary fixtures; no real publishing occurs. Existing1AM and all previous checkpoints remain.

Evidence before final review:28scoped Vitest/3files (new3, existing8, policy17);5preview and
3builtAdmin Chromium cases at1440/768/390, workers1. Strict scoped unit/preview TS, Admin build/
types, scopedESLint, AST70data/type/function declarations and33event/state/validation bindings
unchanged,19-entry preview build and diffcheck pass. InitialJS526475/532480Bgzip,9assets,
6005Bmargin (7B below1AM526482). Tracked buildcache restored. Logs .artifacts/review/1an-\*.
Browser RED detected inherited4px Meta margin (12px actual), corrected to8px. Browser export
assertion caught a specimen-only regex capture error (undefined key), fixed to preserve actual
edited key. No production handler was altered to satisfy fixtures. Existing chunk/NO_COLOR
warnings only. One fresh complete-pending-diff review and actual IAB proof follow.

Keep preview serviceactive5186. Canonical33PNG/manifest remain1M and app/web@258bbaee pinned.
No broad suites/CI/baselines/native/live server certification. A21/phase6.8 and global1b.8 remain
pending. **Stop1AN uncommitted for Diego before next group, commit/push, PR/merge/rebase/deploy/
release.** Historical local stops above are superseded only by their recorded user approvals.

### 1AN final independent review, tested boundary fix and review stop

One fresh gpt-6-astra high read-only review checked all20pending files, including9untracked,
and all13source hashes; each matched. Report .artifacts/review/1an-final-review.md:
Critical0/Important1/Minor1. Executor keeps Important severity: an environment override could
bypass the specimen interceptor and reach a real Listen dev catalog. One tested fix pass,
no re-review: derive exact simulated catalog endpoints from the same effective
VITE_LISTEN_DEV_ORIGIN/default and trailing-slash normalization as the actual unchanged page.
New boundary tests observe RED2fail/1pass (alternate localhost and path-prefixed origin escaped
to the mocked original503), then GREEN3/3 proving both GET and PATCH stay simulated and other
resources retain original fetch. No real server/file was contacted or changed by those tests.

Final evidence:31scoped Vitest/4files,5finalpreview Chromium cases, strict scoped TS and scoped
ESLint pass.19-entry preview rebuild passes. Earlier3builtAdmin Chromium and Admin build/types/
AST70declarations/33bindings/bundle526475/532480Bgzip remain applicable: production source did
not change in the fix pass.6005Bmargin,9initialassets. Only specimen interceptor changed plus
one boundary regression file; final pending21files/14source hashes saved separately from the
original reviewed13hash freeze. All checks serial; final logs 1an-review-{origin-red,unit,types,
lint,preview,preview-build,format}.log. ActualIAB editor proof checkpoint-1an-translations.jpg.
Preview serviceactive5186. No further implementation or publication after this closure.

New Minor deferred: French fictional summary/detail reports2messages but contains1editor row.
This is a specimen discrepancy, not a production-data change. Earlier Users sticky-header and
shared Select-label minors also remain deferred. Full phase/native/live QA and global1b.8/A21/
phase6.8 are not completed. **Stop1AN uncommitted for Diego on published1AM b0f20194.**

Executor rulings on all reviewer-declined behaviors (in addition to ledgered task rulings):

1. URL tabs/arrow-key tab navigation/shared adoption: preserve the inherited local contract
   for this bounded rendering group; phase6.8 remains responsible. Cost if wrong: incomplete
   inherited tab keyboard/URL behavior remains until that migration; no conformance claim.
2. CommandPalette omission/Profile redirect: preserve existing navigation; Translations remains
   available through the gated Sidebar/route. Cost if wrong: palette discovery remains absent.
3. English source/quality interpretation/server publish validation: retain actual unchanged
   data and validation contracts, including Source unavailable. Cost if wrong: existing missing
   source/quality interpretation and live enforcement limitations remain.
4. Concurrent detail/save races and unsaved edits: preserve handler/effect bodies/dependencies.
   Cost if wrong: inherited races/refetch losses remain; this checkpoint does not certify them.
5. Full AI job progress/quality recompute/publication timestamps in specimens: simulate request
   boundaries only. Cost if wrong: local completion is not evidence of real workers or quality.
6. Workspace writes in built static preview: preserve actual productionDEV guard; active Vite
   development specimen and boundary tests exercise simulation. Cost if wrong: static specimen
   intentionally lacks workspace actions, with no claim of catalog-writing functionality there.
7. Future aiConfigured values: accept only existing typed Boolean/state binding at exact site;
   changing its meaning requires policy review. Cost if wrong: future identifier reassignment
   could evade this syntactic false-positive exception; current source/type/audit show none.
8. Earlier Users stickyheader/Selectlabel: keep deferred and out of current source. Cost if
   wrong: their known accessibility/layout limitations remain for a separate consumer change.
9. Native/AT/non-Chromium/live servers/broad suites/CI/canonical refresh: honor scoped checkpoint
   validation. Cost if wrong: those device/integration/release properties remain unverified.
10. A21/phase6.8/global1b.8 completion: claim only bounded1AN rendering/icon retirement. Cost if
    wrong: remaining page, product and phase integration work still needs implementation/QA.

Task rulings retained: active Translations chosen because Profile redirects (another group
waits); preserve legacy tabs/selectors/async contracts (inherited limitations remain); stop and
retain evidence instead of generic commit/fullsuite/cleanup (phase readiness pending); exact
boolean inventory exception (future channel must be reviewed); review pending full diff and
manifest instead of empty committed range (untracked scope guarded by hashes/manifests).

### 1AN approval, French count correction and publication — 2026-10-18

Diego approved1AN and explicitly requested correction of the French fixture counter before
commit/push and the next bounded Admin group. Approved14hashes matched before changes.
French summary and detail now report1message, matching their actual single editor row;
fixture coherence regression observed RED1fail/3pass before correction. No production-data
or action change. Publication labels updated; next stop1AO uncommitted, UX/preview retained.
This resolves the French specimen Minor; earlier Users stickyheader/Selectlabel minors remain.
No PR/merge/rebase/deploy/release, broadCI or canonical refresh.

### 1AN published; 1AO Upcoming and show cards local — 2026-10-18

Diego approved1AN and requested the French counter fix. Published1AN is
`2df63f31177da67b48eec11c5da575b76d17d394`, origin matches. French fictional summary/detail
now report1message and match the single editor row: focused fixture test RED1fail/3pass→GREEN4/4,
plus2targeted preview checks (French row and published persistent label) pass. That Minor is
resolved. Previous local1AN stop is superseded by Diego's explicit approval; earlier Users
sticky-header/sharedSelect-label minors remain.

Local1AO covers actual Upcoming.tsx and Admin ShowCard.tsx only. Remove redundant title/metric/
location/labelled-action glyphs; Download and Clear caches are text. Keep8Upcoming UX sites:
search,4busy/loading sites, dismissX and calendar previous/next. ShowCard retains external-ticket
link and closeX sites; its labelled/location glyphs retire.24whole-file policy/94UX sites. Two
AdminSelect and two ShowCard mounts remain bounded. Existing Leaflet default marker config
stays: its2icon-property scanner matches are accepted only as exact original static literals at
L.Icon.Default.mergeOptions, with negative tests. No general icon-slot whitelist.

Bricolage titles/Poppins body/JetBrains metadata, actual8px labelled fields through crate-form-field.
Release actions wrap; controls44px; seven-day calendar geometry is bounded by local horizontal
scroll on narrow views. All input types/normalization/helpers/state/effects/filters/grouping/
counts/status/API/mutations/toasts/timer/refetch gates stay. AST74declarations/21event bindings
for Upcoming and36/3 for ShowCard match published1AN. Internal ActionButton's icon-only parameter
and calls retire; exported ShowCard props/compact/static/controlled variants remain. No shared,
Listen/backend/auth/dependency/map/library-writing change, or A9/phase6.5 feature completion.

Review http://127.0.0.1:5186/admin-upcoming-demo.html or persistent /#proximamente-admin. Real
components/router/AuthContext value, full fictional response data and importer-only API/image
helpers. Manual loading/failure/download/dismiss/sync/clear samples. The actual sync handler's
10second wait after response remains and is tested. Internal destinations retain real paths
and land in local sample placeholders; tickets are localized, images dataURI only. No backend,
external request, real worker/library operation or preference persistence.

Before final review:30scoped Vitest/4files (9new UI/3existingfilter/18policy),5preview+6builtAdmin
Chromium at1440/768/390 workers1. Actual admin and acquire-only route/context/gates/payloads,
calendar/detail popovers, expansion keyboard, closed/expanded/static/compact cards, filters,
empty/loading/failure/sync timer and font/8px/overflow checks. Strict scoped unit/preview TS,
Admin build/types, scoped ESLint,20entry preview build and AST/diffchecks pass. InitialJS526437/
532480Bgzip,9assets,6043Bmargin,38B below1AN526475. Logs .artifacts/review/1ao-\*; actualIAB proof
checkpoint-1ao-upcoming.jpg. Generated buildcache restored. Existing chunk/NO_COLOR warnings only.

Test adaptations were boundary corrections, not production logic repairs: shared searchable
Select keeps its placeholder accessible name after selection; JSON fixture string type narrowed
at the test; acquire-only auth must omit admin.access because the actual context derives isAdmin
from it. Demo Admin includes admin.access consistently. Real gates stay unchanged. Fixture lineup
artists include the known primary id to avoid duplicate primary as support, using existing data.
One fresh full pending review follows. Stop1AO uncommitted for Diego; previewactive5186. Keep all
previous checkpoints, canonical33PNG/manifest at1M and sitepin258bbaee. No fullsuite/CI/baseline
refresh/native or live certification. Global1b.8/A9/phase6.5 stay incomplete. No nextgroup,
commit/push/PR/merge/rebase/deploy/release before review.

### 1AO final independent review and stop

One fresh gpt-6-astra high reviewer checked all22pending paths,10untracked files and15source
hashes against published1AN2df63f31; all matched. Full report .artifacts/review/1ao-final-review.md.
Critical0/Important0/Minor1. Executor agrees with Minor severity: inconsistent metadata family/
weight affects visual consistency, without a functional regression. No source repair pass or
re-review is needed. Final source15freeze remains unchanged, pending22filemanifest matches,
indexempty and HEAD=origin1AN.30unit/4files,5preview+6builtAdmin Chromium, scopedtypes/lint,
AST74/21+36/3, Admin/20entrypreviewbuilds and526437/532480Bgzip6043Bmargin remain applicable.
Actual IAB list and expanded card inspected; proofs checkpoint-1ao-upcoming.jpg and
checkpoint-1ao-show-card.jpg. Preview serviceactive5186/HTTP200; generatedcache restored.

New Minor deferred: finish metadata typography in ShowCard/Upcoming. New font-mono+font-black/
font-bold dates should use DS400; adjacent time, release-popover date and downloading status
still use body font. A later focused typography pass needs family/weight geometry assertions.
Earlier Users sticky-header/sharedSelect-label minors stay. French fixture Minor was resolved
before1ANpublication and is not pending. No fullsuite/CI/canonical/native/live certification or
phase/global completion claim. All previous checkpoints and pin258bbaee/canonical1M preserved.
**Stop1AO uncommitted for Diego before next group, commit/push, PR/merge/rebase/deploy/release.**

Executor rulings on every reviewer-declined behavior:

1. Initial fetch failures: preserve unchanged fetchItems error behavior in this rendering group.
   Cost if wrong: an inherited read failure can still resemble empty data; separate error UX work.
2. Duplicate pending mutations/timer cancellation/refetch races: retain actual handler/lifecycle
   contracts. Cost if wrong: inherited retry/concurrency and lifecycle behavior remain unverified.
3. Calendar date/timezone,3items/day truncation and overflow navigation: keep existing product
   semantics. Cost if wrong: calendar limitations remain until the A9/phase6.5 product migration.
4. Shared Select placeholder names/visual labels: retain meaningful existing names and exact8px
   geometry; carry association under existing sharedSelect follow-up. Cost if wrong: new visual
   labels do not improve the shared programmatic association; native/AT QA still required.
5. Full geometry/small text/displayfont minimums/colors/contrast: bounded icon/typography adoption
   does not certify a complete page migration; keep the explicit new typography Minor separate.
   Cost if wrong: inherited visual/accessibility debt remains for the page/design-system phase.
6. Live authorization/workers/media/ticket destinations: preserve actual gates/URLs/requests and
   use fictional response boundaries. Cost if wrong: live enforcement, task effects and providers
   are not certified by fixture checks; no real operation was performed.
7. Leaflet fetching/maps/tiles: keep unchanged instrument setup; only exact marker-property policy
   exemption reviewed. Cost if wrong: actual map/media-network behavior remains unverified.
8. Native/mobile/non-Chromium/broadCI/canonical/fulllegacyShows integration: honor scoped checks;
   compact/static/controlled card variants are tested only in the bounded current runtime.
   Cost if wrong: native/other-engine/full legacy page integration still requires QA.
9. Earlier Users stickyheader and A9/phase6.5/global1b.8: retain earlier deferred issue and claim
   only this bounded1AO. Cost if wrong: global/page/phase completion and earlier polish remain open.

Task rulings retained in order: include directly checked Admin ShowCard with Upcoming (legacy
Shows integration still needs QA); preserve gates/helpers/timers/error behavior instead of A9
scope expansion (inherited limitations remain); honor uncommitted/scoped stop and retain evidence
(phase readiness pending); use existing Button for3UX wrappers with same handlers/names/glyphs
(intentional hover/shape change); bound2original Leaflet marker literals only (future instrument
changes need review); model actual capability-derived isAdmin in fixtures (live enforcement still
needs QA); review the full pending/untracked package rather than empty committed range (scope
protected by independent22path/15hash verification). All are recorded with costs in the ledger.

### 1AO approval amendments and publication — 2026-10-18

Diego approved1AO, requested the metadata correction and explicitly authorized commit/push and
next Admin group. Approved15source hashes matched before changes. Date/month/day/weekday/time
and downloading metadata now use JetBrains Mono400; remove introduced bold/black/medium mono
weights and complete the adjacent popover/status families. Browser RED observed500 instead400,
then computed family/weight checks cover list, collapsed/expanded show and release popovers.
The metadata Minor is resolved; Users stickyheader/sharedSelectlabel remain deferred.

Diego additionally requested List/Calendar as icon-only buttons to the right of the card title.
Use existing shared Button44px, lucide List/CalendarDays, accessible names List/Calendar, titles
and aria-pressed. Preserve setView callbacks/state; buttons align beside Upcoming at1440/768/390
and native Enter/Space switches views. This explicit functional UX amendment adds2bounded
reviewed sites, now10Upcoming/2ShowCard and96totalUX across24checked files. It does not restore
redundant content/action glyphs elsewhere. Source types/effects/requests/gates stay unchanged.

The first targeted view test was outside its describe fixture setup and failed before its
assertion; move it into the actual setup. Reproduce text-control failure with only those local
button children temporarily changed, restore exact source in finally, then GREEN. No gitreset
or user changes overwritten. Targeted computed typography/placement/keyboard tests pass.
Publication labels updated; retain previewactive5186 and stop next1AP uncommitted for review.
No PR/merge/rebase/deploy/release, broadCI or canonical refresh.

Publication validation:28affected unit cases/3files,9preview+6builtAdmin Chromium, scoped types/lint and unchanged AST contracts pass. Actual bundle in1ao-publication-bundle.log; generatedcache restored, source15publicationfreeze retained.

### 1AO published; 1AP System Playlists and row amendments local — 2026-10-19

Diego approved1AO; published `ba63836d2a23bb774832c1703eab4e4116e1468f` includes metadata
JetBrains Mono400 and title-right List/Calendar icon-only44px UX controls. The metadata Minor
is resolved. Earlier Users stickyheader/sharedSelect-label issues remain deferred.

Local1AP retires redundant System Playlists title/empty/labelled-action glyphs, preserving6UX
sites (search,3loaders,2closeX), actual data/requests/rules/actions/navigation and route capability
`curation.playlists.write`.26whole-file icon policy/102UX sites,4bounded AdminSelect calls.
Shared PlaylistArtwork adds optional showFallbackIcon defaulttrue; Admin pinsfalse after spread
and omits it from its public type. Gradients/covers/collages/Crate mark/URL helpers/renderImage
stay. Existing Listen/default consumers retain the glyph. PlaylistEditor receives only this
artwork behavior, the explicit operator amendment and quiet-row styles; its icon group is next.

Diego additionally requests uniform playlist row chips, no row hover background illumination,
and Operator chips replaced with standard selects. Remove local11px chip overrides. Quiet
content-list/table row surfaces apply to both apps/shared foundations, with45inventoried roots
across33TSX files, the offline-row helper and4CSS recipes. Active/selected/offline surfaces,
focus, playback halo/ring/trail and internal button/menu/grid-card interactions remain. Operator
selects in create and editor retain the exact ops arrays and reset callbacks, with no clear
option. This explicit2field amendment overrides the short-selector-chip policy there. Every
label/component remains8px via crate-form-field; three-font identity retained.

Review actual page at <http://127.0.0.1:5186/admin-playlists-demo.html> or persistent /#playlists-admin.
Response-shaped fictional data, manual read/mutation/failure states, local route placeholders,
shared row specimens and copied existing brand bytes. No backend/external media/library writes
or persistence. Latest handover and `.superpowers/sdd/2026-10-18-crate-v3-playlists-icons/progress.md`
record final scoped evidence, review and executor rulings. **Stop1AP uncommitted for Diego.**
A20/phase6.8/global1b.8 incomplete. Keep canonical1M33PNG/manifest/pin258bbaee; no fullsuite,
CI/baseline refresh/native/live certification, PR/merge/rebase/deploy/release or nextgroup.

### 1AP pre-review validation — 2026-10-19

Scoped Admin87cases/13files, shared45/6, Listen65/5 and Desktop-alias40/3 pass, all maxWorkers1.
The final small-heading correction has10affected Admin cases/3files plus9preview/6builtAdmin
Chromium checks at1440/768/390, workers1. Bricolage stays on20px+ titles; compact headings
and row names use Poppins, metadata JetBrains Mono400. A primary-family browser RED catches
the compact-display mismatch before correction; checking a fallback family substring was too
loose. Shared/base row hover stays visually quiet; selected/active/playback state remains.

Strict scoped Admin/shared/Listen/preview/Desktop types and50changed TS/TSX ESLint pass.
Playlists73declarations/63bindings and Editor115/66 remain, with onValueChange→onChange widget
callback equivalence explicitly audited. Thirty additional TSX files differ only in reviewed
row hover/background classes; exact shared artwork opt-out and underlying image helpers remain.
Admin/21entrypreview builds pass. Initial JS526371/532480Bgzip,9assets,6109Bmargin. Generated
buildcache restored. Logs `.artifacts/review/1ap-*`, full ledger under the1APplan workspace.
One fresh read-only pending-package review follows; source remains uncommitted on published1AO.
Diego additionally requests an audit of any plan deviation, not just visual examples. Its
read-only findings will separate approved amendments, inherited/unmigrated scope, involuntary
drift and outstanding QA. No further implementation or publication is authorized by that audit.

### 1AP final local stop and broad plan audit — 2026-10-19

One fresh read-only review verified all 65 pre-repair pending paths, 58 source/asset hashes and
full diff against published 1AO. Critical 0 / Important 0 / Minor 4. One focused repair pass
closed all four directly requested gaps: preserve two menu-action hover surfaces, quiet three
omitted content rows, support actions on newly created preview playlists, and complete the
filter-options fixture with all seven actual response fields. No second review was opened.
Final row scope is **45 roots / 33 TSX files**, plus the offline helper and four CSS recipes;
32 additional TSX files are audited as style-only. Active/selected/focus/playback state remains.

Post-repair checks pass: 13 affected Admin cases / four files, four shared row-policy cases,
actual Pydantic response validation, five strict scoped type configurations, changed-source
lint and AST contracts, nine preview + six built-Admin Chromium checks at 1440/768/390, workers 1.
Admin and 21-entry preview builds pass. **526379 / 532480 B gzip**, nine assets, **6101 B margin**.
Generated build cache restored; initial reviewed and final post-repair freezes remain separate.
Actual IAB proof: `.artifacts/review/checkpoint-1ap-operator.jpg`. Preview stays active at :5186.

Diego requested an audit of **any** plan deviation after this group. The
[read-only audit](2026-10-19-crate-v3-plan-audit.md) records confirmed contrast, typography,
chip geometry, copy, documentation and enforcement gaps; approved product amendments,
unmigrated scope and QA debt are classified separately. Forty browser observations at 1440/390
show 303 visible field pairs at 8 px, all three fonts available and no horizontal overflow.
This is sampled evidence, not a whole-product accessibility or native certification.
The audit does not silently repair earlier published checkpoints or start the next group.

**1AO remains published as ba63836d2a23bb774832c1703eab4e4116e1468f. Stop at local 1AP, without
commit/push, for Diego's review.** Canonical 1M images/manifest and pin 258bbaee remain intact.
A20, phase 6.8, global 1b.8, full-phase CI and native/live QA remain pending.

### Executor rulings for behaviors the independent review did not certify

| Behavior                                                                | Ruling                                                                                                                                             | Concrete cost / limit                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remaining PlaylistEditor icons and typography                           | Next bounded group; 1AP reviews only its changed operator/artwork/row contracts.                                                                   | Editor remains partially migrated; no claim of page completion.                                                                                       |
| Existing Playlists read-error presentation and concurrent mutations     | Preserve existing handlers/state/requests; affected tests and AST show no introduced contract change. Future page-state adoption remains separate. | A read error can resemble empty data after its toast; no new concurrency guarantees.                                                                  |
| Earlier Users sticky header and shared Select visible-label association | Carry both known Minors without unrelated source changes.                                                                                          | Sticky overlap and complete combobox label/AT qualification remain unresolved. Native-input names sampled by the audit do not close the Select issue. |
| Live image auth, retries and native transport                           | Existing helpers and delegation unchanged; shared/Admin/Listen consumer tests plus Desktop aliases pass.                                           | Real authenticated media, runtime retries and native-device behavior remain uncertified locally.                                                      |
| Full suites, CI, canonical/native/AT certification                      | Defer under Diego's scoped serial testing policy and documented phase-close procedure.                                                             | Forty diagnostic views and focused tests cannot qualify all data/states/devices. Canonical evidence remains 1M.                                       |
| Broad plan deviations and incomplete Smart Mix/A20/6.8/global 1b.8      | Execute a separate read-only audit and persist findings; do not turn it into another implementation group.                                         | Confirmed historical typography/contrast/geometry and adoption debts remain listed until a correction iteration; no global completion claim.          |
| Inherited solid-surface/token drift beyond changed rendering            | Additional row files are style-only; classify existing panels/utilities in the broad audit and assign later adoption.                              | Translucent/shadowed local ops surfaces and other legacy styles still diverge from the final target.                                                  |

Executor also accepts the four Minor findings as real requirement gaps, fixes them in one scoped
pass and stops without another review loop. The original reviewed snapshot is preserved; final
post-repair hashes identify exactly what changed. This is local readiness for Diego's review,
not approval to publish or a claim that the broad audit findings are already corrected.

### 1AP authorized audit reconciliation — local validation, 2026-10-19

Diego authorizes the confirmed audit fixes in report order, with preview active and review
before commit. A1 count foreground, A2 Mono400, A3 compact Poppins, A4 shared-tag geometry and
consumer overrides, A7 published-bundle copy, A6 Admin guard and A8 state reconciliation are
implemented locally. Bricolage numerals16px+ and titles20px+, native exceptions, content/actions
and actual8px fields remain. A5 has explicit owner/phase/acceptance criteria in the single
[current-state table](2026-10-19-crate-v3-current-state.md) and an exact executable surface
register; its page migrations remain pending as the approved audit proposed.

Validation: eight new computed browser checks plus nine existing1AP preview checks pass, and
six builtAdmin cases pass (Chromium1440/768/390, workers1). Shared26cases, existing Listen38,
actual adaptive-chip Listen1 and Desktop-alias1 pass. Admin affected18files initially167pass/1
old assertion failure: Roles expected compact Bricolage, contradicting the corrected DS role.
Update that specific assertion; all six Roles cases plus15guard cases pass. The remaining17
files passed without changes. Three new actual-page cases cover zero/one/two published bundles.
No whole-suite repeat was run. Five strict scoped type configurations and final lint pass.
Node drift-inventory17cases and CLI pass; the CLI includes Admin16files/12pending-adoption
records without raising any existing budget. Unchanged non-render declarations and behavior/
route bindings in all ten corrected consumers are independently AST-compared to the pre-fix
snapshot (except the dead private UserPresence size variable, explicitly removed).

Admin and21-entrypreview builds pass. Initial JS **526377 / 532480 B gzip**, nine assets,
**6103 B margin**. Generatedcache restored; no dependency/lockfile, backend, pin or baseline
change. Formatter used the existing Prettier3.6.2 cache; shared lint used the explicit existing
Listen config because the shared package has no local ESLint config. Two pre-existing redundant
regex escapes in the touched drift tool were removed after lint RED;17Node cases remain green.
One fresh independent review of this new authorized amendment follows; the earlier reviewed
1AP freeze remains historical. **Stop1AP without commit/push; preview stays active at :5186.**

### 1AP audit reconciliation — final local stop, 2026-10-19

Fresh independent review verified86/86pendingpaths,77/77source/asset hashes and the22source-path
amendment against the preserved earlier1AP freeze. Critical0/Important0/Minor2. No product
regression identified. The two Minors were new A6 prevention correctness gaps: Tailwind variant
prefixes and lexical constant resolution. Executor retains their severity and closes both in
one focused tested pass under Diego's explicit prevention requirement. Variant utility parsing
now preserves bracketed selectors/values; exceptions still require the exact original token.
Constant resolution uses the nearest lexical binding and respects runtime parameter shadowing.
RED4fail/15pass → GREEN19/19; Node17, CLI, scopedAdmin types and lint pass. No second reviewer
or change to UI rendering after the17preview+6builtAdmin checks and526377/532480B bundle result.

All A1–A4/A6–A8 corrections are local and reviewable. A5 follows its approved owner/phase path:
12exact pending surface records and the current-state acceptance table remain visible. Existing
phase/native/live/canonical debt is not marked complete. Actual IAB screenshots are
`.artifacts/review/checkpoint-1ap-reconciliation.jpg` and `checkpoint-1ap-analysis-reconciled.jpg`.
The persistent1AP section now links the eight affected real-page specimens. Previewactive5186.
**Stop1AP, without commit/push. PublishedHEAD/origin stays ba63836d (1AO).**

#### Executor rulings on all behaviors set aside by the fresh review

| Behavior                                                                     | Ruling                                                                                                                          | Concrete cost / limit                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Full legacy panel/surface migration                                          | A5 is ownership/phase assignment in this approved order; exact records and acceptance criteria exist.                           | Translucent/shadowed inherited panels remain until the owning page migration.                                                            |
| Remaining PlaylistEditor icons, compact typography and tag overrides         | Keep the next bounded group separate; changed operator/artwork/row contracts are covered here.                                  | Editor remains partially migrated; this is no A20/6.8 completion claim.                                                                  |
| Existing Playlists read-error and concurrent mutations                       | Preserve actual handlers and API/state semantics, verified by affected tests/AST.                                               | Read error may still look empty after the toast; no stronger concurrency guarantee.                                                      |
| Users sticky header and shared Select visible-label association              | Carry the two earlier known Minors to their consumer work.                                                                      | Sticky overlap and complete combobox label/AT qualification remain unresolved.                                                           |
| Every untouched element/unvisited contrast or typography state               | Accept recorded representative computed tests only.                                                                             | No whole-product conformance certificate; further states can still expose drift.                                                         |
| Arbitrary runtime-generated classes and files outside registered guard scope | Static guard covers registered roles/literal branches and exact pending surfaces; dynamic classes remain outside its guarantee. | Runtime/unsampled file drift still requires consumer review. Ordinary variant and lexical-constant gaps inside the guarantee were fixed. |
| Live backend, authenticated artwork and retries                              | Helpers/contracts unchanged; use fixtures/delegation tests locally.                                                             | Production service freshness, credentials and runtime retry behavior remain uncertified.                                                 |
| Native/AT/zoom/other engines/canonical/fullsuite/CI                          | Follow Diego's phase-close procedure and scoped serial iteration policy.                                                        | Native accessibility, engines and full-phase qualification remain pending; canonical evidence stays1M.                                   |

Ruling: complete the two directly requested new-guard correctness gaps in the single repair
pass rather than leave A6 partly effective under the generic Minor-defer guideline. Cost: the
guard gains bounded parsing/binding logic and four focused tests; no second review or broad
source repair. Both original reviewed packages and final repair freezes are retained.

### 1AP approved — publication preparation, 2026-10-19

Diego approved the final1AP and explicitly authorized commit/push followed by PlaylistEditor,
with functional UX preserved and the preview active. All77approved source/asset hashes match
before publication metadata changes. The persistent1AP label/footer now say published; only
its embedding expectation changes. Earlier1AP local stops are historical. The next checkpoint
is1AQ, to stop uncommitted for Diego; no PR/merge/rebase/deploy/release or fullCI/baselines.
The resulting verified publication SHA is recorded in the subsequent1AQ continuation record.

### 1AP published; 1AQ PlaylistEditor local — 2026-10-19

Diego approved1AP. Commit/push `d30b1c0244e5f57026dea3f27aacae815c04b41b` verified on HEAD, origin and remote,
with original53177736 ancestor preserved. Prior1AP local stops are historical.
Local1AQ removes redundant editor heading/labelled-action glyphs and names rule/track removals.
13direct UX sites remain (back/search/drag and10loaders); bounded Select3, AIButton2 and artwork2
consumers preserve their shared functional glyphs. Header uses Bricolage, compact titles Poppins,
labels/readings/track timing/history use Mono400; default static chip geometry,44px native
controls and actual8px crate-form-field pairs. Narrow grid minima corrected at390px.
Data/helpers/callbacks/effects/dependencies, route capability, API/SSE/drag/refinement contracts
are preserved; no backend/shared/Listen change. New actual-page persistent/standalone specimen
uses importer-only API/useApi/LLM/SSE boundaries and full local fixtures, manual pending/failure/
stream controls. No global EventSource override or live requests. A5editor hero stays an exact
owned6.8/A20 debt record, without increasing earlier budgets.
Final scoped evidence and reviewer rulings are recorded in the main handover/current-state table.
**Stop1AQ without commit/push. Previewactive5186; no next group, fullsuite/CI or canonical refresh.**

### 1AQ focused verification before independent review — 2026-10-19

- Vitest: 4 affected files, 50 cases green, `--maxWorkers=1`.
- Chromium preview: 6 cases green at 1440/768/390, plus the extended native drag/cover/search/
  refinement case green. Actual 8px fields, 16px static tags (10px/10px Mono400), 44px native
  controls, operator keyboard/focus, quiet rows, loading/missing/failure, SSE retaining unsaved
  edits, IA availability, local navigation and zero unexpected API/external requests checked.
- Built Admin: 4 cases green, `--workers=1`: curator-only capability at all three widths,
  actual metadata/preview payloads and denial without `curation.playlists.write`. The initial
  harness expectations were corrected to await Radix focus and honor the existing operator
  value reset, selecting a value again before preview. Denied account uses another genuine
  console-entry capability to test the inner route gate. No production contract changed.
- Strict scoped unit/preview types and lint green. Admin build/typecheck and all 22 preview
  entries build. Initial JS **526294 B gzip**, budget **532480 B**, **6186 B margin**, 9 assets;
  83 B below published 1AP. Generated Admin build cache restored to HEAD.
- AST audit: 122 non-render declarations, 66 API/SSE/state/hook/dependency contracts and 94
  event/state/validation/drag bindings unchanged. Two explicit replacement button types match
  original ActionIconButton defaults. Five fixture groups validate with actual Pydantic model
  definitions and validators; only FastAPI package startup is skipped because it is absent.
- Source policy covers 27 whole files with 115 bounded direct UX sites. The Admin consistency
  registry adds the editor scope and exact inherited hero debt (13 pending records); prior
  Listen/shared budgets remain unchanged. Logs `.artifacts/review/1aq-*` and the plan ledger.

No full suites, full CI, baseline recording/comparison, native/live/AT certification, dependency
or backend change. One fresh read-only review follows; **1AQ remains uncommitted**.

### 1AQ later steering — basic actions and form Selects, 2026-10-19

This supersedes the text-only Remove and count-only short-selector instructions above for the
explicitly amended controls. Diego allows basic Remove icon-only actions and explicitly confirms
Select for Category, Match and Sort, preserving filter/state chips. Creation+editor now use7
sharedSelect sites with unchanged values, defaults, handlers and empty-category semantics.
Four Remove sites (editor cover/rule/track and create-rule) use sharedButton icon-lg44px, Trash2,
accessible name/title.16direct editor UX sites and119total bounded direct sites are reviewed;
Select consumers are bounded at6editor/8creation-list page. Primary/combined actions retain text.
The shared source policy has exact form-field cardinality/site allowances, not a file exemption;
it also records the two previously approved dynamic operator sites missing from the old guard.
Only the policy test changes in Listen; its runtime/player/shared primitives are untouched.

Diego also requested an action inventory. See [action families and concrete locations](2026-10-19-crate-v3-admin-action-icons.md)
and its42siteJSON:4implemented,23proposed,15existing/owning-phase. ASTscan142productionfiles
finds159lexical candidates in52files; these are not159rendered controls or approved changes.
A persistent1AQ disclosure shows the ten real glyph families and their usage. No broad restore
of Admin icons, no decorative heading/navigation icons, and no Listen/Desktop migration.

One reviewer Minor in the local fixture was reproduced: adding a candidate twice reused rowid3.
Monotonic per-sample row identities now preserve repeated-add/reorder/remove; production
callbacks remain unchanged. This is the same1AQ review, without commit or next-group work.

### 1AQ amendment validation — final package for the same review, 2026-10-19

Admin focused Vitest:6files61cases green; shared Select policy:1file8cases green (serial
maxWorkers1). Fifteen preview cases cover both affected pages, new Select values/keyboard,
real8px/44px geometry, icon removals, inventory disclosure and repeated-add/native reorder.
Fourteen passed in the final grouped run; the remaining1AP embedding case was repaired by
scrolling its actual iframe into view and passes11s. No extra source repair or delay loop.
BuiltAdmin10cases pass43.1s, workers1, across1440/768/390 and admin/curator capabilities,
including the denied inner route and new categorical request values. Adminbuild/TSC green.
InitialJS **526298Bgzip/532480**, **6182Bmargin**,9assets,79B below1AP. Earlier526294 measurement
is pre-amendment evidence. All22preview entries build. Strict amended scopes/lint pass;
Listen change is a policy test only, no native/player/runtime behavior changes.
AST additionally preserves Playlists73non-render declarations/40API-hook calls/80bindings;
editor122/66/94. Only Select adapter prop names are normalized, supplied handlers/values exact.
Current inventory42source hashes and concrete line anchors verified; old1V/canonical1M untouched.
IAB proof shows the actual Selects and44px named papeleras, with previewactive5186.

The same fresh reviewer includes the later human amendments and action inventory. The one
fixture Minor is closed after RED malformed duplicate IDs and GREEN repeated-add/reorder;
no production callback changed. Final verdict and declined-behavior rulings follow.
**Stop1AQ without commit/push; publication remains1APd30b1c02.**

### 1AQ final independent review and local stop — 2026-10-19

One fresh read-only reviewer (same seat for the later human amendments and inventory) checked
all32pending manifest hashes, actual source, final evidence and scope. **Critical0/Important0/
Minor0 remain.** The one local-fixture identity Minor is fixed and regression-tested. The
reviewer considers1AQ ready for Diego’s local review. This is not phase/release certification.

Executor rulings on every behavior the reviewer declined:

| Behavior                                     | Ruling and reason                                                | Cost / remaining acceptance                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Inherited panel opacity/shadows              | Keep exact owned6.8/A20 surface debt; preserve bounded scope     | Final solid-surface migration remains open                                              |
| Keyboard reorder                             | Preserve drag contracts; defer new interaction to6.8/A20         | Keyboard-only reorder remains unavailable; not covered by Select/action keyboard checks |
| Read error/missing presentation              | Preserve existing data handling                                  | Failed reads can still look like missing data; phase/live QA remains                    |
| Concurrent mutations / duplicate submissions | Preserve current callbacks/gates                                 | Races remain possible; no new concurrency guarantee                                     |
| Refetch resets unsaved fields                | Preserve existing initialization effect                          | Another draft may reset after a mutation; future state-contract work                    |
| Stale simulation after rule edits            | Preserve preview behavior                                        | No automatic preview invalidation/freshness guarantee                                   |
| Wholesale artist/album text conversion       | Keep body copy Poppins; scoped labels/readings use Mono400       | Investigate specific metadata role evidence in its consumer                             |
| Shared Select visible-label association      | Preserve shared implementation with descriptive accessible names | Earlier label activation/AT limitation remains; AT certification open                   |
| Other action-icon locations                  | Keep23proposals/15owning-phase sites as inventory                | Visual consistency across those sites awaits reviewed groups; global1b.8 stays open     |

Final evidence:69unit/policy cases,25browser cases across the documented final run and one
embedding retest; scoped types/lint/AST/schema checks, Admin and22-entry preview builds. Initial
JS526298Bgzip,6182Bmargin. PreviewHTTP200, serviceactive withRestartonfailure. ActualIAB proof:
`.artifacts/review/checkpoint-1aq-controls.png`. Index empty; HEAD/upstream remain published1AP
`d30b1c0244e5f57026dea3f27aacae815c04b41b`; original53177736 ancestor retained.
**Stop1AQ uncommitted for Diego. No next group or publication.**

### 1AQ search and form-height feedback — 2026-10-19

The editor search icon was displaced14px because its wrapper stretched to stacked scope chips.
Search scope now uses shared Select with the same values/callback/query and static-mode gate;
two Field recipes retain8px label gaps. Search copy reflects the selected scope. This eighth
amended form Select site is registered explicitly (editor7total shared Select consumers).
Diego then confirmed the input/Select height mismatch in the other editor rows. Six Input-only
min-h-11 overrides are removed, including range/text rule values: both controls use the shared
40px fine-pointer/44px coarse-pointer form geometry. Creation already used that geometry and
is covered by the same regression checks. Basic action buttons retain their44px targets.
No shared runtime, backend, hook, data, playback, canonical or pin change. Still the same local
1AQ, stopped before commit; previewactive5186. Final evidence follows in the current handover.

Final feedback validation: 52 affected Admin unit/policy cases and8short-Select policy cases
GREEN;7geometry/workflow browser cases (1310/768/390 fine,390coarse and creation1440/768/390)
and4builtAdmin editor capability/payload cases GREEN. Strict scoped types/lint and Admin build
pass; initial JS526295Bgzip/532480, margin6185B,9assets. AST122/66/94contracts unchanged
with the explicit scope-adapter disabled-gate equivalence. Current42action anchors/hashes
refreshed; historical1V/canonical1M untouched. Same-seat read-only delta review has no remaining
findings; its sole test-fixture premise Minor was corrected (12/12GREEN) without changing the
production default. IAB proof: checkpoint-1aq-form-heights.png and checkpoint-1aq-search-corrected.png.
The pre-existing async-loading scope default can differ from a synchronous mock; preserved here.
No live/backend/native/AT/fullsuite/CI certification. Preview remainsactive5186; stop1AQ
UNCOMMITTED for Diego, preserving all earlier checkpoints and original open owning-phase debt.

### 1AQ responsive rule row feedback — 2026-10-19

Campo, Operador y Valor comparten fila cuando la tarjeta dispone de 576 px; se apilan por debajo
de ese ancho. La condición usa el contenedor real de cada regla en creación y edición, evitando
el breakpoint de viewport que apilaba los campos dentro del iframe pese a tener espacio. Se
conservan las columnas 180 px / 160 px / resto, los 8 px bajo etiquetas, las alturas compartidas,
los glifos y todas las acciones/datos. Continúa el mismo 1AQ local sin commit, preview activo.

### 1AQ header standard and applicability — 2026-10-19

Diego approved compact header actions at the upper right, without border/permanent fill, using
shared Button ghost/icon-lg44px, Tooltip and descriptive accessible names. PlaylistEditor moves
Back outside identity, aligns its112px cover with copy, and uses Copy/Eye/ListRestart/Save with
existing callbacks, smart/static gates and busy states. Header layout follows available width;
Save + generate keeps its dynamic name. The later question about arrow-only Back is recorded
as a proposal; the actual Back text/destination remain unchanged.
The [standard and18-page applicability audit](2026-10-19-crate-v3-admin-header-actions.md) records
1applied reference,10Refresh candidates,6workflow adaptations and1page without actions. Other
headers are analysis only. The action inventory is now45sites:8applied,22proposed,15owning-phase;
current scan163lexical candidates/52files, including Preview. No historical1V/1M rewrite.
Keep the same local1AQ review stop, no commit/push or next group; preview remainsactive5186.

Final local evidence after rule/header/standard feedback: 63 affected Admin unit/policy cases
GREEN (new toolbar13/13 after removing unsupported Testing Library exact options),11real-editor
preview cases GREEN including exact1464host iframe and five responsive/focus/tooltip cases,
4builtAdmin gate/payload cases GREEN. Earlier creation-rule geometry3/3 remains valid; no new
production change there after its check. Strict scoped types/lint and Admin build pass. Bundle
526326Bgzip/532480, margin6154B,9initialassets. AST122non-render/66API-hook/94bindings unchanged
with the previously recorded scope-adapter gate equivalence. Header adds four specifically
registered UX sites (editor20direct, whole reviewed scope123), no new shared runtime.
Same-seat read-only review: no actionable production/standard defects; one documentary Minor
(Logs Refresh line anchor) repaired to338 and all header action anchors rechecked as exact
visible text or quoted action labels. Current action inventory45sites/8applied/22proposed/15
existing,13glyphfamilies; header applicability18files and hashes validated. No proposal was
implemented in another header; Back glyph-only remains a recorded proposal from a question.
IAB proof: checkpoint-1aq-header-standard.png and checkpoint-1aq-rule-row.png. Previewactive
5186/HTTP200; original phase/native/AT/live/canonical limits remain. Stop same1AQ UNCOMMITTED.

## Enmienda local 1AQ — cabeceras y filas autorizadas, 2026-10-19

Diego pidió migrar las18cabeceras revisadas antes del siguiente grupo y después aplicar el
patrón a las3acciones de fila de playlists. La autorización supera las notas anteriores de
«solo propuestas» de esas cabeceras. Se comparte la composición Admin PageHeaderLayout/
PageHeaderActions/PageHeaderAction sobre Button ghost icon-lg44px y Tooltip existentes:
38sitios en17páginas; Roles adopta solo composición read-only. OpsPageHero hace opt-in para
ocho consumidores revisados; Tasks/Insights/Genres conservan el default. Sin nuevo @crate/ui
export, contrato de datos/API/SSE ni cambio Listen/Desktop. La adaptación responde al ancho
real del contenedor. Nombres precisos, busy/disabled/pressed, callbacks, permisos y peticiones
permanecen; cada trabajo tiene un glifo distinto, sin usar Refresh para sincronizar/generar.

Filas de playlists: Edit con Pencil, Activate/Deactivate con Power/PowerOff y Delete con
Trash2, sin borde/fondo permanente, con tooltip solo de acción y aria-label con el objeto.
Se corrige Card24px + fila16px duplicados: una sola capa16px. No se ilumina la fila al hover;
navegación, stopPropagation y ConfirmDialog textual permanecen. Back del Editor sigue con
flecha/texto fuera de la identidad: la pregunta de Diego fue una consulta, sin cambio de contrato.

[Estándar y sitios aplicados](2026-10-19-crate-v3-admin-header-actions.md),
[inventario general](crate-v3-analysis/admin-action-icons-1aq.json):71sitios,45aplicados,
11propuestos y15existentes en su fase. El inventario de cabeceras tiene18archivos con hashes
actuales; las propuestas restantes no se han aplicado. Datos manuales del preview no representan
certificación backend vivo/AT/nativo/canónica. **Mismo1AQ local sin commit/push ni siguiente
grupo; preview5186activo**. Evidencia final y límites: [estado vigente](2026-10-19-crate-v3-current-state.md).

### Validación final de la extensión 1AQ — 2026-10-19

-307/307casos Vitest en30archivos afectados, serial `--maxWorkers=1`.
-80casos de preview de cabeceras/Editor/Playlists cubiertos:79pasaron en el lote final; el caso
de tooltip deshabilitado se corrigió para esperar la salida real de Radix y pasó en los3anchos
con3repeticiones (9/9). Otros45casos de checkpoints afectados:40pasaron inicialmente y5/5tras
corregir un selector de badges que incluía wrappers y la espera del iframe persistente.
-26/26casos sobre el build de Admin en7archivos seleccionados: rutas/capacidades, consultas,
mutaciones, confirmaciones y contratos de creación/edición; Playwright `--workers=1`.
-Tipos estrictos de cambios/pruebas y lint focalizado verdes. Build/budget inicial de Admin:
**526396Bgzip/532480**,8assets,margen6084B. AST18/18conserva código no visual, hooks/API,
bindings nativos y gates previos. Hashes/anchors de18cabeceras y71sitios únicos verificados.
-Revisión independiente: tooltip de acciones disabled corregido con prueba RED→GREEN; trigger
estable mantiene el mismo Button nativo y relación `aria-describedby`. Las10pruebas anteriores
de Ops se conservan junto con las2nuevas. Sin hallazgos nuevos pendientes del pase.

Rulings: Tasks/Insights/Genres conservan el default por quedar fuera de las18cabeceras
inventariadas; esas3migraciones siguen pendientes en su fase. La evidencia focalizada no
certifica backend vivo, AT, motores adicionales ni plataformas nativas; problemas específicos
podrían aparecer en la QA de fase. Se conservan el pin258bbaee,33PNG/manifest1M y todos los
checkpoints. Sin suites completas, CI, nuevos baselines, commit/push ni siguiente grupo.
Preview `crate-v3-preview.service` activo en5186. **Parada local1AQ para revisión**.

La discusión posterior de legibilidad de chips es una propuesta de diseño y no modifica el
runtime. Véase el [inventario de familias](2026-10-19-crate-v3-badge-legibility-audit.md).

### Enmienda local1AQ: colección compartida y propuesta de filas — 2026-10-19

La normalización de badges fue autorizada después de la auditoría inicial: InfoBadge24/12,
FilterChip/SegmentedControl/GenrePill12px con32/44px de objetivo. Adaptadores anteriores
conservan contratos; QualityBadge y OfflineBadge usan InfoBadge. Incoming release tiene
acciones compactas y avatar88px; ShowCard conserva su desplegable. Labels de formulario en
mayúsculas con valores protegidos; nuevo trabajo de iconos Solar, Bot AI visual20px/slot16px.
Misma revisión1AQ sin commit/push; no equivale a cierre de fase ni QA completa.
Diego pide ahora analizar y proponer la normalización de filas similares de ambas apps.
[Propuesta e inventario](2026-10-19-crate-v3-row-normalization-proposal.md): HairlineRow depende
de padding/alineación del CSS del mockup; fechas show/release y filas Upcoming/NewReleases
siguen divergentes. La migración está PENDIENTE de aprobación. No aplicar el antiguo hover
iluminado de notas históricas; se conserva la prohibición aprobada de iluminar filas al hover.
El [estado vigente](2026-10-19-crate-v3-current-state.md) prevalece sobre stops y propuestas
históricos. Preview5186activo, pin258bbaee y33PNG/manifest1M conservados.

Última instrucción de Diego: pausar migraciones visuales para reconciliar el sistema completo.
[Auditoría y catálogo propuesto](2026-10-19-crate-v3-component-reconciliation-audit.md): revisar
contratos/adopción/overrides y aprobar el set común antes de seguir por pantallas. La propuesta
de filas se integra en ese trabajo. No se considera aprobada la implementación del catálogo.
Se preservan1AQlocal,preview5186y todos los checkpoints, sin commit/push.

### 1AQ — Storybook y primera reconciliación (estado local vigente)

Storybook R0 está implementado en inglés, con identidad Crate, categorías funcionales y enlaces
estables. Catálogo: 10 fichas documentadas / 81 pendientes; mantenimiento obligatorio en el mismo
cambio, hook staged y comparación histórica en CI. Después de revisarlo, Diego autorizó comenzar
por HairlineRow: inset/alineación garantizados, texto largo contenido y ayudas del mockup retiradas.
Admin aún no adopta esa fila; el resto de R1–R4 sigue pendiente. Previews 6006/5186 activos.
[Estado y evidencia vigentes](2026-10-19-crate-v3-current-state.md),
[tooling](2026-10-19-crate-v3-storybook.md) y
[contrato Hairline](2026-10-19-crate-v3-hairline-reconciliation.md).
**Misma parada local 1AQ, sin commit/push; no se cierra la fase ni su QA.**

Enmienda de Diego en esta revisión: el mockup aprobado y sus ajustes confirmados son la fuente
visual de verdad. Storybook/shared lo reproducen; dudas, drift o conflictos móviles se resuelven
con Diego. HairlineRow queda Poppins40012/18también en móvil por su confirmación explícita,
con mínimo táctil44px; se retiran los tamaños locales anteriores. Estado/evidencia en el enlace
vigente anterior. El pin histórico258bbaee y los baselines canónicos se conservan.

1AQ aprobado por Diego el 2026-10-19; commit/push autorizados. El siguiente bloque es FormField
y roles tipográficos, con parada de revisión en 1AR. Prevalece el [estado vigente](2026-10-19-crate-v3-current-state.md).

1AQ publicado como `da8a4358`. 1AR agrupa toda la familia de formularios y sus roles tipográficos,
con ejemplos nuevos solo en Storybook. Las escenas existentes conservan sus callbacks y usan
los componentes compartidos. [Estado y límites vigentes](2026-10-19-crate-v3-current-state.md);
[plan de 1AR](2026-10-19-crate-v3-forms-reconciliation.md). Parada local antes de commit/push.

### 2026-10-19 — revisiones aisladas por paso

Diego pide una página pequeña por paso, solo con el alcance en prueba, y dejar de ampliar el mockup grande. Se conserva como referencia. La escena se comparte con Storybook, cuyo inventario/documentación sigue siendo obligatorio. Primera vista: `http://127.0.0.1:5186/review-1ar-labels.html`, también `Reviews/1AR/Field labels`. Detalle/evidencia en el estado vigente y plan1AR; sin commit/push.

## 1AR publication and 1AS action reconciliation

Diego approved 1AR; published commit `a3ba497ddfdf05835441686fbd8c874c07e4cea6` on `feat/crate_v3`. Previous local review stops are historical. Next local checkpoint 1AS covers Button, IconButton, ActionGroup/ActionButton/ActionLink and the ActionIcon compatibility entry. The approved header pattern moves into shared composition; Admin aliases preserve asChild router usage and Listen adopts the conventional server Remove action. Typography/form approval remains intact.

Review: `http://127.0.0.1:5186/review-1as-actions.html` and Storybook `Reviews/1AS/Actions`. One scene, no new main mockup section. See [plan/evidence](2026-10-19-crate-v3-actions-reconciliation.md) and [current state](2026-10-19-crate-v3-current-state.md). Keep both previews active; stop before 1AS commit. No full suites, CI, canonical baseline updates or native/backend QA claimed.

## 1AS publication and 1AT surface reconciliation — 2026-10-19

1AS published as `9b5356862db1cef1d014c0b56c7a7e61bd7cad18`; previous local stops are historical.
1AT is local for review: Card object, InstrumentPanel section, Separator, solid card controls and
two thin app adapters. Sample captions compose FormField with real8px gaps; equivalent artwork
controls use the same canonical component/size. No repair CSS or new main-mockup section.
[Current state and evidence](2026-10-19-crate-v3-current-state.md),
[1AT scope and limits](2026-10-19-crate-v3-surfaces-reconciliation.md), and
[requested future groups proposal](2026-10-19-crate-v3-component-checkpoint-groups.md).
Both previews active; stop before1AT commit/push. Broader adoption and phase/native/canonical QA remain open.


## 1AT publication and 1AU header reconciliation — 2026-10-19

1AT published `67486e4c7414d7c6bca7a6701b35c73440f0dfce`. 1AU completes the five header families
and their catalogue, using the approved mockup and later confirmations: shared container-aware
PageHeaderLayout, PageHeader identity/meta, SectionHeader, PageHero, HeroActionBar and BackLink.
Initial consumers: Admin compatibility layout/PlaylistEditor and Listen Settings/AlbumHero;
CrateHero content sizing is preserved through a shared option. Actions/metadata fragments own
8/16px gaps; sample captions use FormField8px. Broader adoption/native composition remain open.
[Current state](2026-10-19-crate-v3-current-state.md) and
[1AU plan/evidence](2026-10-19-crate-v3-headers-reconciliation.md) supersede older stops.
Both previews active; stop before1AU commit/push. No main-mockup growth, baselines or full CI.

## 2026-10-19 — 1AU published; local 1AV image and identity

Diego approved1AU and the Listen-first plan; published `5593d68d`.1AV reconciles the six existing
image/identity/brand families and their English Storybook entries, with initial real Listen
adoption and a shared small review scene. Managed artwork transport stays local to the app.
Live Listen5174 uses the authorized habitual API; Diego confirmed login after the dev-only
loopback cookie proxy fix. [Current state](2026-10-19-crate-v3-current-state.md) and
[1AV evidence](2026-10-19-crate-v3-image-identity-reconciliation.md) govern continuation.
Both original previews remain active. Stop1AV before commit/push; no full CI or canonical refresh.
