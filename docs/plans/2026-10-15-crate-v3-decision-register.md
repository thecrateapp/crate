# Crate v3 decision register

Decided by Diego on 2026-10-15 (implementation plan Task 0.3). This file is the single reconciled
list; the product design (PD §6, `PDn`) and the design system spec (DS §6.12, `[Dn]`) carry the
same answers in their own registers. The accepted single-identity amendment and joint-release
protocol below supersede the former visual-variant and intermediate-release assumptions.

Rule for the session: every decision takes the documented recommendation, except where the
"Decision" column says otherwise. Conflicts between the two registers were resolved in favour of the
product design (PD14, PD28, PD29, PD32).

Related documents:

- `2026-10-14-crate-v3-product-design.md` (PD)
- `2026-10-14-crate-v3-design-system.md` (DS)
- `2026-10-14-crate-v3-implementation-plan.md` (plan)

## Behaviour changes that ship as their own PR to `main`

Each change keeps its own reviewable diff, tests and release note. `[MAIN]` work starts only when
Diego assigns it, and publication/deployment needs explicit approval. The joint P0 UI major does
not collapse the isolated operational rollouts for the projector and platform fixes:

| ID   | Change                                                                                                                      | Plan task |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| PD24 | `library_pipeline` only auto-runs checks that do not require confirmation; `shadow_quality_tracks` stops running unattended | 2.17d     |
| PD29 | Settings > Enrichment toggles are honoured by the pipeline (`setlistfm` alias, Discogs added)                               | 3.12c     |
| PD32 | Smart EQ holds the last resolved gains while the next track resolves instead of dropping to flat                            | 4.4       |
| PD44 | Stack actions deny restart of `api`, `traefik`, `postgres`, `redis`, `redis-durable`                                        | 5.5       |
| PD45 | `crate-redis` `maxmemory` lowered below `mem_limit` (for example 448mb); the site test that pins the flags updates with it  | 5.4       |
| PD46 | `/api/acquisition/snapshot` and `/stream` require `library.import.manage` or `library.tidal.manage`                         | 2.9       |

## Product design decisions (PD1–PD54)

| ID   | D-ref                      | Topic                                        | Decision                                                                                                                                                          | Consequence / notes                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner task               |
| ---- | -------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| PD1  | [D1]                       | Chart rule for instruments                   | Amend the rule: Nivo for statistical charts; instruments (wheel, EQ, crossfade, orbit, lanes, gauges, maps, heatmap, ticket) are hand-built SVG/HTML/Canvas/WebGL | Update root `AGENTS.md` ("Charts use Nivo"), `app/ui/AGENTS.md`, `app/listen/AGENTS.md` and `app/shared/AGENTS.md` (the lines named in PD1)                                                                                                                                                                                                                                                                                          | 0.5                      |
| PD2  | [D19]                      | Integration order                            | Smart Mix → approved v3 rebase → website integration → joint Listen/Admin/site/docs P0 major                                                                      | Primitive work may proceed before the merge. Re-evaluate actual migration head, Camelot and Android EQ after the v3 rebase; reuse integration work and keep any renumber/stamp repair conditional and separately approved.                                                                                                                                                                                                           | 0.1, Rollout             |
| PD3  | [D2]                       | Listen pill radius                           | (b) exempt `CratePill` via `data-slot="chip"`; revisit CTAs with (c) after the shell lands                                                                        | `radius-policy.test.ts` updated                                                                                                                                                                                                                                                                                                                                                                                                      | 1.6                      |
| PD4  | [D3]                       | Brand display font in the product            | **Bricolage Grotesque (SIL OFL 1.1) in every runtime and on cratemusic.app.** Cabinet Grotesk is dropped everywhere                                               | Cabinet Grotesk's ITF Free Font License forbids distribution through a public repository and making the font available to third parties through an application, so it cannot ship in a public, self-hosted product. The font commit (now `d9df9d51`, formerly `38c7576c`) and the website commits are rewritten so no commit contains Cabinet files. Weights 500/700/800 from the variable opsz file; see "Display font notes" below | 0.0 (done)               |
| PD5  | [D32]                      | Setlist `in_library`                         | (a) worker match at setlist write plus rematch on library change, local/missing only                                                                              | (b) federated `remote` later                                                                                                                                                                                                                                                                                                                                                                                                         | 4.7a                     |
| PD6  | [D6]                       | Admin flat card contrast                     | (a) keep `#0d0e14`, add hairlines to the borderless cards in one mechanical commit                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1.0                      |
| PD7  | [D7]                       | Auto-cycling                                 | (a) dropped everywhere                                                                                                                                            | Empty states say so                                                                                                                                                                                                                                                                                                                                                                                                                  | all screens (4.10b)      |
| PD8  | [D8]                       | `StatNumber` tiers                           | `xl`, weight 800 on `lg`/`xl`, inline unit                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1.4                      |
| PD9  | [D14]                      | App display scale                            | Page titles `clamp(2.25rem, 4vw, 3.75rem)`, entities up to 4.4 rem                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.1, Phase 4 screens     |
| PD10 | [D4]                       | Failed and destructive colour                | (a) amber plus the word for failed; one `danger` token only on destructive confirm buttons                                                                        | No green or blue state colours                                                                                                                                                                                                                                                                                                                                                                                                       | 1b.1, 1b.6               |
| PD11 | [D5]                       | Amber value                                  | (a) `state-warning` = `#fbbf24` through the registry                                                                                                              | Contrast tests updated                                                                                                                                                                                                                                                                                                                                                                                                               | 0.10                     |
| PD12 | [D10]                      | Toasts                                       | Drop `richColors`, shared config, inline feedback first                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1.11                     |
| PD13 | —                          | Tests on the external disk                   | (a) CI plus (b) an internal-disk clone for local work                                                                                                             | Never rely on the unversioned Vitest timeout patch                                                                                                                                                                                                                                                                                                                                                                                   | 0.2                      |
| PD14 | [D18] conflict             | Admin sidebar                                | (a) regroup by site chapters                                                                                                                                      | Resolves the conflict against [D18]; routes and capability gates do not change                                                                                                                                                                                                                                                                                                                                                       | 3.2                      |
| PD15 | —                          | Admin pills                                  | (a) chips and CTAs as pills, inputs and selects at 6 px                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1.6, 1b.2                |
| PD16 | —                          | Imports                                      | (a) new `/imports` page for staged imports, sidecar on Album                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 5.7a, 5.7b               |
| PD17 | —                          | Enrichment scope                             | (a) Artist tab only in v3                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.12a, 3.12b             |
| PD18 | [D20], [D35]               | Genre overrides (G1)                         | (a) local edits persist in `local_*` + `eq_override` with "reset to core"; core relations hideable through `suppressed`                                           | `Generate with AI` previews (draft) instead of applying                                                                                                                                                                                                                                                                                                                                                                              | 2.18d, 2.18e, 3.8        |
| PD19 | [D21]                      | Wheel as default `/genres` view              | Yes; tree and grid stay; `GenreNetworkGraph` goes once the locator ships                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.7                      |
| PD20 | [D21]                      | Listen wheel in v3                           | (a) Admin first, Listen Explore and genre-page locator as phase 2 inside v3                                                                                       | Component moves to `@crate/ui/domain/genres` in the Listen PR                                                                                                                                                                                                                                                                                                                                                                        | 5.10                     |
| PD21 | [D24]                      | Count definitions                            | Read-plane thresholds (artist .70, album .45, union across aliases) everywhere                                                                                    | Admin and Listen list numbers drop; tests updated                                                                                                                                                                                                                                                                                                                                                                                    | 2.18b, 2.18c, 2.18c-go   |
| PD22 | —                          | Signed core release 1.0.1                    | Yes, later; runtime de-duplication now                                                                                                                            | No v3 task                                                                                                                                                                                                                                                                                                                                                                                                                           | —                        |
| PD23 | —                          | Taxonomy invalidations                       | (b) narrow only after the `genre_taxonomy` scope exists in Listen's URL mapping                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2.18b, 4.5               |
| PD24 | [D23] (gating)             | Health "fix on their own"                    | (a) gate `library_pipeline` on `requires_confirmation`                                                                                                            | **Behaviour change, own PR to `main`.** `shadow_quality_tracks` stops auto-running                                                                                                                                                                                                                                                                                                                                                   | 2.17d                    |
| PD25 | [D34]                      | Loudness and dynamic range units             | (a) `dB` in v3; LUFS only from Smart Mix measurements                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.9a, 5.14               |
| PD26 | —                          | Album readout mood and spectral complexity   | Keep `mood_top` (3 entries); drop spectral complexity                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.9a                     |
| PD27 | [D33]                      | Release timelines for non-Tidal acquisitions | (a) link at import by MusicBrainz release group, then normalised names                                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.11c                    |
| PD28 | [D23] conflict             | Library Trash claim                          | (a) factual footer (track files only) in v3; routing destructive deletes through the trash is a separate fix after the trash index                                | Resolves the conflict against [D23]'s routing clause                                                                                                                                                                                                                                                                                                                                                                                 | 3.6; routing after 2.17e |
| PD29 | [D38] conflict             | Enrichment Settings toggles                  | (a) wire them (`setlistfm` → `setlist` alias, add Discogs)                                                                                                        | **Behaviour change, own PR to `main`.** Admins who turned sources off stop getting them. Resolves the conflict against [D38]                                                                                                                                                                                                                                                                                                         | 3.12c                    |
| PD30 | —                          | Sidecar drift keys                           | Exclude artist `similar_json`, `tags_json`, `latest_release_date` from the digest                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.10a                    |
| PD31 | —                          | Artist hero Enrich button                    | (a) keep `process_new_content(force)`; scoped refresh in the tab                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.12b                    |
| PD32 | [D29] conflict             | Smart EQ while the next track loads          | (a) hold the last resolved gains                                                                                                                                  | **Behaviour change (audio), own PR to `main`**, `fix(eq)` with a runtime test. Resolves the conflict against [D29]                                                                                                                                                                                                                                                                                                                   | 4.4                      |
| PD33 | [D22]                      | Governor listener and stream thresholds      | Product default 10 listeners / 10 streams (the code value); compose 0/0 documented as an operator override; site copy "default 10/10, configurable"               | Gauges show the configured values                                                                                                                                                                                                                                                                                                                                                                                                    | 2.16, 3.5, 7.6           |
| PD34 | —                          | Radio score panel on the site                | (a) keep the weights, rename "Camelot 0.05" to "Key 0.05"                                                                                                         | Site-only copy fix                                                                                                                                                                                                                                                                                                                                                                                                                   | 7.6                      |
| PD35 | [D39]                      | Queue lane numeral                           | Live load; type count in the meta                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 3.4                      |
| PD36 | [D36]                      | Paths `plan_meta`                            | (a) persist at planning time, only inside the planning task; synchronous routes deprecated                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 4.9a                     |
| PD37 | —                          | Mix strip                                    | Show the client crossfade labelled on web/desktop; `rms_envelope` after the Smart Mix merge as a nullable column with a throttled backfill                        |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 5.13, 5.14               |
| PD38 | [D28]                      | Crate Connect build flag                     | **Build Devices in v3 even though Crate Connect is off in production**                                                                                            | Devices stays invisible while `VITE_CRATE_CONNECT_FEATURE_ENABLED` is off. "Review Crate Connect" is the next initiative after v3                                                                                                                                                                                                                                                                                                    | 5.9                      |
| PD39 | [D17]                      | Linux GTK accent                             | (a) cyan (brand accent) everywhere                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                        |
| PD40 | [D16]                      | Album palette tint                           | Fixed Crate v3 tokens; remove album-driven chrome tint overrides                                                                                                  | Artwork and data-derived visualizer palettes remain content; no alternative chrome identity. Runtime migration is pending                                                                                                                                                                                                                                                                                                            | 1.13, 4.11               |
| PD41 | —                          | Audio-reactive visuals on mobile             | Static analysed state; no new endpoint in v3                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 4.12                     |
| PD42 | [D11]                      | iOS deployment target                        | **(a) raise to 16.4**                                                                                                                                             | iOS 15 users stay on v2 (release note). Podfile, pbxproj, Tech Stack and Task 7.3 matrix change together                                                                                                                                                                                                                                                                                                                             | 0.13                     |
| PD43 | [D30]                      | Crate Pulse privacy                          | Hide the instance heatmap below 3 listeners, server-side                                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2.20, 4.6                |
| PD44 | [D40]                      | Stack restart policy                         | Deny `api`, `traefik`, `postgres`, `redis`, `redis-durable` with a reason; stop/start only for other containers                                                   | **Behaviour change, own PR to `main`** (denying `traefik` is new)                                                                                                                                                                                                                                                                                                                                                                    | 5.5                      |
| PD45 | —                          | `crate-redis` `maxmemory`                    | Lower below `mem_limit` (e.g. 448mb)                                                                                                                              | **Behaviour change, own PR to `main`** (compose); the site test updates with it                                                                                                                                                                                                                                                                                                                                                      | 5.4                      |
| PD46 | [D26]                      | Acquisition snapshot and stream permissions  | Require `library.import.manage` or `library.tidal.manage`                                                                                                         | **Behaviour change, own PR to `main`**; warn API clients                                                                                                                                                                                                                                                                                                                                                                             | 2.9                      |
| PD47 | —                          | Unused code                                  | Remove in cleanup commits                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1.12, 5.14               |
| PD48 | [D25]                      | Bundle and screenshots                       | Listen/Admin bundle gates; small Admin capture set before 1.0; 520 KiB Admin initial-JS ceiling accepted                                                          | Recorded Admin baseline 514,659 B gzip. Linux CI-only PNGs; CI/captures remain pending where not reviewed                                                                                                                                                                                                                                                                                                                            | 0.11, 0.12               |
| PD49 | [D15]                      | `<html lang>` in Listen                      | Sync with the active locale                                                                                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 4.1                      |
| PD50 | —                          | Spinners                                     | Remove `animate-spin` outside buttons, file by file                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1b.4                     |
| PD51 | —                          | Ticket header key word                       | Countdown                                                                                                                                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                      | 4.7b                     |
| PD52 | —                          | Album energy arc                             | Skip in v3                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                        |
| PD53 | [D13], [D16], [D41], [D42] | One Crate v3 identity                        | Remove full theme/skin runtime, modes and accent/material/radius/typography overrides                                                                             | Preserve semantic tokens/generation until migration, motion/accessibility and functional preferences. Inventory, saved-preference migration, compatibility and test retirement in 1.13; not implemented by this decision                                                                                                                                                                                                             | 1.13, 0.11, 7.5          |
| PD54 | [D43]                      | Stack sampler placement                      | (a) daemon thread in crate-api behind an owner-checked Redis leader lock, demand-gated                                                                            | Revisit (b) if Stack actions move to worker tasks                                                                                                                                                                                                                                                                                                                                                                                    | 5.5                      |

## Spec-only decisions (no `PDn`)

| D-ref                | Topic                          | Decision                                                                                                                                                 | Owner task |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [D9]                 | Shared motion gate             | Yes, in `@crate/ui/lib`; Admin honours the OS setting                                                                                                    | 0.7        |
| [D12]                | Grain texture                  | None in the apps                                                                                                                                         | —          |
| [D13]                | Product surfaces               | Fixed solid Crate v3 surfaces; no selectable material override (PD53)                                                                                    | 1.13       |
| [D23] (third clause) | Console scans apply safe fixes | No                                                                                                                                                       | —          |
| [D27]                | Federation in Listen           | Provenance tag only, no network view                                                                                                                     | —          |
| [D31]                | Display face `tnum`            | Resolved by PD4: Bricolage Grotesque has a `tnum` feature, so `tabular-nums` works on the display face; the reserve-width workaround is no longer needed | 1.4        |
| [D35]                | Generate with AI               | Unsaved draft (`apply=false`)                                                                                                                            | 2.18e      |
| [D37]                | Admin Dashboard chapter index  | No                                                                                                                                                       | —          |

## Execution agreements and remaining gates

- PD1–PD54 are decided, with PD40/PD48/PD53 and D13/D16/D41/D42 amended as recorded above.
- The only current implementation batch is 1.2–1.4, then Checkpoint 1A review. No continuation,
  commit, push, PR, deployment or production query is automatic.
- Checkpoint 0 remains open for 0.11/0.14/0.15 and reviews; 0.14 may wait until the wheel.
- Internal milestones replace intermediate public UI releases. Keep the integration branch through
  the joint P0 major; P1/P2 remain later unless expressly reprioritised. `[MAIN]` work is assigned
  separately, including independent critical deployments.
- Estimates/calendar assumptions must be refreshed after integration and account for planned 1.13.
  Recorded local implementation does not imply CI, screenshot or device QA approved.
- The old visual variant's contrast exception is removed with the runtime/tests in 1.13; it is not
  a new colour decision. Single-identity AA, motion and accessibility requirements remain.

## Display font notes (PD4)

Measured with fontTools on `@fontsource-variable/bricolage-grotesque` 5.3.0 against the removed
Cabinet Grotesk files (units per em 1000 in both):

- **Files.** Variable `opsz` build (axes `opsz` 12–96, `wght` 200–800), latin (77 KB) and
  latin-ext (31 KB, loaded only by `unicode-range`), unmodified. Cabinet was three static weights
  of about 20.5 KB each (62 KB). One request instead of three for Latin pages.
- **Optical size.** Bricolage's display character lives in the `opsz` axis. The static weight files
  on Google Fonts are instanced at opsz 14 (text cut); at 48 px and above they set wider and blander
  than the display cut. The product loads the `opsz` file and leaves `font-optical-sizing: auto`
  (the CSS default), so titles and numerals get the display cut and 15–16 px player titles get the
  text cut. Do not set `font-variation-settings: "opsz"` by hand. Canvas text (share story) should
  be checked in Chromium and WebKit, which apply auto optical sizing to canvas differently.
- **Width.** A test string at weight 800: Cabinet 16.8 em; Bricolage 17.7 em at opsz 12, 16.9 at
  opsz 48, 16.0 at opsz 96. So display sizes are about 5% narrower than Cabinet and small sizes
  about 4% wider. Truncation budgets (`ch` widths, 2-line entity titles) hold.
- **Tracking.** The display tokens (-0.045em titles, -0.05em XL/L numerals, -0.035em to -0.025em
  for smaller tiers) were tuned for Cabinet. The opsz 96 cut is already tightly spaced, so keep the
  tokens unchanged in the swap (the type scale does not move) and check the `VISUAL` captures in
  Task 0.11: if counters touch at weight 800, ease the display and XL/L numeral tracking by 0.01em
  (-0.045 → -0.035, -0.05 → -0.04) in one token commit.
- **Vertical metrics.** x-height .52–.53 em (Cabinet .48–.49), cap height .66 (Cabinet .67),
  ascent .93 / descent .27 with `USE_TYPO_METRICS` (Cabinet .87 / .28). Text looks slightly larger
  at the same size; with `leading-display` .9 and numeral leading .85 the glyph box overflows the
  line box a little more than before, so check diacritics on capitals (É, Å) in line-clamped
  titles; if they clip, add `padding-block: 0.05em` to the clamped recipe rather than changing
  leading.
- **Figures.** Bricolage has `tnum` (and `pnum`, `frac`); Cabinet had none. `tabular-nums` now
  applies to display numerals, closing [D31].

## GenrePill implementation clarification — 2026-10-15

Diego requested the new percentage-bearing GenrePill preview before further infrastructure work.
The existing DS §2.2 decision is retention with a chip restyle, not replacement by CratePill or
removal of percentages. Task 1.6a preserves explicit percent / rounded share, missing/0/100%,
source provenance, row order and open/remove behavior. No weight fallback or renormalisation is
introduced. Diego approved the v3 visual treatment at Checkpoint 1C on 2026-10-15. The code remains local until a separate commit/push go-ahead.

## Focus-ring refinement — 2026-10-15

After reviewing Checkpoint 1D, Diego requested the same focus effect as the current Listen home
search. This supersedes the initial bright accent-hi outline separated by 3px/4px: use the existing
`focus-ring` action cyan, 2px flush to controls and CTAs (offset 0), with -2px inset on clipped
rows/menus. The existing search recipe is `0 0 0 2px var(--focus-ring)`; the shared outline matches
its colour and extent while preserving component shadows and selection/validation rings. Keep
keyboard/pointer behaviour, forced-colour Highlight, text selection and the single Crate identity.
The revised 1D mockup remains local for review, without automatic commit/push.

Diego clarified that the Listen reference includes an **on/off animation**, not merely its
settled appearance or a delay. The original `box-shadow` transition lasts 500 ms with
`cubic-bezier(0.22, 1.18, 0.36, 1)`; both opacity and ring extent interpolate. Carry that motion
into the shared focus indicator, including a full exit after prolonged focus and continuity when
interrupted. Animating `outline-width` was rejected: its integer rounding produces visible steps.
Use the original `box-shadow` rendering with native Web Animations and `composite: add` to preserve
underlying component shadows and hover/press transition lists. Temporarily make the static outline
transparent during motion and restore it on completion/cancellation. Reduced motion (OS or Crate) and forced colours retain the immediate CSS focus marker.
Temporal tests must check intermediate frames in both directions against the original recipe.

Direct inspection of <https://listen.lespedants.org/> confirms the desktop wrapper uses
`focus-within:shadow-focus`, a `box-shadow` transition of 500 ms and the curve above in
`TopBarSearchView.tsx`; removing focus reverses that same transition. The reference is the
rendered production search as well as its source, not only a settled screenshot. Mid-animation
spread and opacity must match the native shadow without a 1px rounding allowance.

Diego subsequently accepted the current focus implementation **provisionally to keep moving**:
“lo vamos a dejar así, por seguir avanzando, ya volveremos a ello”. Defer further visual
polishing and retain the 1D specimen; this does not mean final visual parity approval or a new
commit/push instruction.

On 2026-10-15 Diego explicitly authorised commit and push of Checkpoints 1C and provisional 1D,
then continuation with the next block. This supersedes the earlier local-only publication notes;
it does not resolve the deferred focus polish or the Linux baseline/device QA gates. Checkpoint
1C is published as `e60e6f50` and 1D as `d881a728`. Continue 0.11 → Admin contrast 1.0 → InstrumentPanel 1.7 in that dependency order.

## Capture preparation / Checkpoint 1E — 2026-10-15

Prepare Task 0.11 before Admin contrast 1.0 and InstrumentPanel 1.7. The infrastructure uses the
pinned Playwright 1.63.0 Noble Linux amd64 CI image, a manual recording job and provenance manifest.
Local renders may populate the persistent mockup as advisory references; they never replace
committed baselines. Both capture configs default to comparison-only mode and reject noncanonical
recording. Seven full-page Admin scenes and desktop/mobile Smart EQ cover the initial gate.
Keep the 22 existing Linux PNG bytes when removing platform suffixes and delete Darwin duplicates.
0.11 remains open until the published workflow records the new images, every PNG is reviewed and
comparison CI passes. No Admin restyle or final focus-polish approval is implied.

Diego approved Checkpoint 1E on 2026-10-15 and explicitly authorised its commit/push, the Linux CI
capture run and continuation with the next plan block. Verify provenance and review/import the
canonical PNGs before Admin adoption; retain the mockup and review checkpoints.

## Admin typography and Audio Profile direction — 2026-10-16

Diego clarified: “el audio profile deberia verse mas parecido a esto, tambien es un mockup de
admin en el site nuevo” and “en admin vamos a prescindir de muchisimos iconos, de practimanete todos”.
His reference shows four large BPM/key/loudness/dynamic-range figures, top rules, five thin feature
bars and a bipolar 20-value Bliss strip, without per-metric cards or icons.

The existing TrackReadout target (PD §4.7 / DS §4.5 / Task 3.9b) is reaffirmed. Checkpoint 1F's
legacy KPI hairlines are temporary contrast work, not final Audio Profile design or visual
approval. Keep the site pin `258bbaee`, Crate V3 tokens/fonts, no app grain/marketing cycling,
and `dB` until integrated LUFS is backed by the validated measurement contract. No dependency
reordering or runtime implementation is implied by recording this direction.

The prior DS §1.7 statement that icons stay on navigation/actions is superseded for Admin.
Almost all Admin icons are retired, including decorative headers/metrics and redundant icons
beside labelled actions/navigation. Text, numerals, rules and dots with state words carry the UI.
Retained functional icons require a narrow per-callsite justification and checkpoint review;
no blanket action/navigation exemption. Task 1b.8 owns the cross-screen inventory and migration,
with each page task adopting the rule. Preserve functionality, capabilities, accessible names,
keyboard operation and touch targets. `lucide-react` remains the source for any approved Admin
exception; Listen/desktop icon conventions are unchanged. This is a target, not an implemented
whole-Admin removal. No commit/push of 1F or blanket source deletion has been authorised.

Diego confirmed the existing sequence: “vale, si ya esta planificada, la abordamos cuando toque”.
Keep Task 3.9b in its planned position; the reference does not advance its implementation.

On 2026-10-16 Diego explicitly authorised commit/push of Checkpoint 1F, its Linux CI captures,
and continuation to InstrumentPanel with the persistent mockup and review checkpoints. This
supersedes the local-only publication notes above, without advancing the deferred TrackReadout
or globally deleting Admin icons. Task 1.0 visual/route QA still precedes production adoption in 1.7.

Checkpoint 1F was published as `6e793ebd`, followed by reviewed Linux images in `82f14594`.
Recording run `38859757212` produced 33 PNGs (31 unchanged, two new); full comparison/frontend
CI `38860652793` passes. The local 34-pattern route walkthrough is recorded with deeper-state
limits and the pre-existing Artist-alias shadowing issue, already assigned to 3.2.

Checkpoint 1G implements InstrumentPanel with real Settings Section and Admin Resources adopters.
Diego spotted text close to the Settings frame; spec review identified its inherited full-border
and fill recipe. Remove that unused recipe with its last class consumer; keep the open top-rule
panel contract and add spacing within the demo composition. Browser checks cover the actual
Section's transparent fill/zero side and bottom borders on desktop/mobile. Code/spec reviews
pass; this is a local review diff, without 1G publication or canonical capture approval yet.

The real Admin view also exposed the new figure's `m-0` overriding parent `space-y-6`.
InstrumentPanel resets inline margins only (`mx-0`), leaving block spacing to the page.
A browser regression reproduced the collapsed gap and verifies 24px before Metric Streams.

Diego also identified a 6px rule-to-heading mismatch in the Resources specimen. Its unstyled
status wrapper inherited a taller line box, shifting the shared header baseline. Use MonoLabel
with a flex wrapper for the isolated live status; retain the 22px top padding. Desktop/mobile
browser assertions now compare actual heading offsets; the desktop case reproduced the defect
before the fix, and both pass afterward with matching 22px offsets.

On 2026-10-16 Diego approved Checkpoint 1G with the corrected spacing and explicitly authorised
commit/push, Linux CI captures and continuation to Meter (Task 1.8). Keep extending the persistent
mockup and stop at the next visual checkpoint for review. This supersedes the local-only approval
notes above without authorising a merge, release or deployment.

Checkpoint 1G is published as `473604f7`. Linux recording `38864631250` passes; artifact
`12030469443` has verified SHA256 `d351c4876b8b862e3949a848ba866e41cfb14597b1b4f8d4d1ee82f5442a3d45`.
Manual review covers the seven changed images (System and six Settings); the other 26 are
byte-identical. The original manifest/all 33 PNGs are published in `c44b31f3`; comparison and full
frontend CI pass in run `38865107324`.

Checkpoint 1H implements Task1.8 locally and stops for visual review. Meter keeps actual numeric
text when its fill/ARIA range clamps; missing/invalid ranges are described groups, not incomplete
ARIA meters. Native offline file bytes cannot be measured against browser quota; fall back to
count/byte readings there. Web quota uses profile totalBytes and never unrelated origin usage.
Real browser QA found a 0px track in the five-column Admin tile; use a full-width row, as in
Offline. Preserve 1G's 33 Linux PNGs and manifest until 1H publication/recording is approved.

1H local verification and spec/quality reviews pass: 3,927 frontend unit tests, 31 preview checks,
Admin 17 and Listen 40 browser checks (four existing Listen skips), types/lints/builds/gates within
unchanged ceilings. Keep local workspace suites sequential with `--maxWorkers=2` after unrestricted
parallel runs saturated the host. This result stops for Diego's visual review; 1H stays unpublished.

On 2026-10-16 Diego approved Checkpoint 1H, explicitly authorising commit/push, Linux CI captures
and continuation to Readout (Task 1.9). This supersedes the local-only publication notes above.
Keep the persistent mockup and stop at the next visual checkpoint; no merge/release/deploy is implied.

1H is published as `6a5b3366`. Linux run `38869057068` passes; reviewed artifact `12032298795`
has verified SHA256 `9ddb9de0b2cf3beb5dda5d125cc609dffecb13fe1b840f22071e7028b3f57a12`.
35 PNGs: 32 identical, System changed and two new Offline scenes. The original manifest and all
images are published in `ef5e7f52`; comparison/full frontend CI `38869556811` passes. This closes
the 1H publication/capture checkpoint.

Checkpoint 1I implements Task 1.9 locally. Readout separates aria-hidden preview text from a
persistent polite/atomic sr-only announcement and reserves width through a CSS variable/ref.
Listen announces committed EQ modes, not transient manual input; committed external mode changes
cancel a pending preview so its flag cannot suppress later announcements. Admin uses its existing
commit-only dirty/synced status. A real editor browser test checks local commit/reset without writes.
Preview 33, Admin 18 and Listen 40 browser checks pass; spec/quality reviews approve. All 3,937
frontend unit tests and types/lints/builds/gates pass within unchanged bundle ceilings. Visual
review and publication/Linux QA remain gates. Preserve the 35 reviewed Linux PNGs from 1H and
stop before 1.10.

On 2026-10-16 Diego approved Checkpoint 1I and explicitly authorised commit/push, canonical Linux
CI captures and continuation to ProgressHairline (Task 1.10). This supersedes the local-only
publication notes above. Keep the persistent mockup and stop at the next visual checkpoint.

1I is published as `a80f396b`. Linux recording `38871597394` passes; artifact `12033384073`
has verified SHA256 `c6e2230780326e0da172db9fc9e74627efb7dd18415f14ba0a5abca7b6414cd2`.
Review covers two changed Listen EQ headers and one new GenreEqEditor scene; 33 images are
byte-identical. All 36 PNGs and the original manifest are published in `dd71eb72`;
comparison/full frontend CI `38872274120` passes. This closes the 1I publication/capture checkpoint.

Checkpoint 1J implements ProgressHairline (Task 1.10) locally. The 1/2px primitive uses a ref-written
normalized fill and an ARIA 0–100 range; unknown values omit `aria-valuenow`. Indeterminate motion
matches the pinned site (36% block, 2.4s easing), gated by intersection and OS/Crate/document motion
availability, with a static fallback and no JavaScript animation loop. Tasks preserves its existing
stream and server percentage. Upload preserves chunk callbacks/requests and reports confirmed
bytes per file after successful chunks; direct fetch has no byte telemetry and stays indeterminate.
ScanProgress is component-tested without inventing a production consumer. Removing Admin shadcn
imports/barrel does not change the Listen/shared-only drift metric of 96. Keep the ceiling unchanged.
Task terminal events remove the unknown bar while retaining context and last known numeric values.
Diego requested the percentage align with the full track's right edge; inherited text alignment
keeps Readout's reserve, with actual-text geometry tests at 50%/75% on desktop/mobile. Mockup
`#progreso` passes 35 browser checks; Admin 20 and Listen 42 pass with four existing Listen skips.
All 3,962 frontend unit tests, types/lints/builds, 49 tooling tests, 15 drift budgets and layer gates
pass. Initial JS gzip is Admin 514,803 B / 532,480 and Listen 204,762 B / 307,200; no ceiling
increased. Spec/quality reviews approve. Visual review and publication/Linux QA remain gates.
Preserve the 36 Linux PNGs from 1I and stop before toaster Task 1.11.

On 2026-10-16 Diego approved Checkpoint 1J and explicitly authorised commit/push, canonical Linux
CI captures and continuation to the shared toaster configuration (Task 1.11). This supersedes the
local-only publication notes above. Keep the persistent mockup and stop at the next visual checkpoint.

1J is published as `0660fbd2`. Linux recording `38876594597` passes; artifact `12035801498`
has verified SHA256 `716889696d8d273628c6dd5878e4c5df8fe36b358a8bc5b2cf32ef556291225a`.
Review covers one changed Tasks page and four new Tasks/Upload progress scenes; 35 images are
byte-identical. All 40 PNGs and the original manifest are published in `3f470ec6`;
comparison/full frontend CI `38877216337` passes. This closes the 1J publication/capture checkpoint.

Checkpoint 1K implements shared toaster configuration (Task 1.11) locally. Admin and Listen use
one typed presentation/duration config, remove richColors and retain their placement, existing
4000ms lifetime, caller overrides and Listen's runtime/native/mobile-offset behaviour. No notify
API or operation payload changes. The mockup uses actual scoped Sonner with fictional manual
examples; only its local review toasts stay open indefinitely. DS §5.10 contextual type words,
task links and inline-first consumer feedback remain pending; this checkpoint does not claim the
whole section complete. Preserve the 40 reviewed Linux PNGs from 1J and stop before Task 1.12.

1K verification passes: 3,971 frontend units (four existing Listen skips), preview 37 / Admin 21 /
Listen 42 browser checks, four typechecks, both lints, all shared/app/preview builds, 49 tooling
tests, 15 drift budgets and layer boundaries across 144 source files. Initial JS gzip is Admin
514,933 B / 532,480 and Listen 204,904 B / 307,200; no ceiling increased. Spec/quality reviews
approve. Browser regressions reproduced Sonner's late dark-description override, rear content
remaining visible in collapsed stacks and missing keyboard focus after unstyled mode. Scoped
selectors now preserve muted descriptions, collapsed/expanded content and a 2px focus outline;
desktop/390px and real Admin focus checks pass. Diego's visual approval/publication and subsequent
Linux capture/review/comparison remain gates; 1K is local and the 40 canonical images stay intact.

On 2026-10-16 Diego approved Checkpoint 1K and explicitly authorised commit/push, canonical Linux
captures and continuation to unused shared component cleanup (Task 1.12). This supersedes the
local-only approval notes above. Keep the persistent mockup and stop at the next review checkpoint.

1K is published as `7b46021d`. Linux recording `38880022435` passes; artifact `12037047924`
has verified SHA256 `476048805f9b0ab4b6115f65bdbe1d944afea9e9ace3bc2c127d54d1f54ca41e`.
All 43 PNGs and the original manifest are reviewed/imported: 40 byte-identical, plus three new
Admin-save/Listen-Upload desktop/mobile toast scenes, published in `181ca4d4`. Comparison/full
frontend CI `38880774591` passes against that commit. This closes the 1K publication/capture checkpoint.

Checkpoint 1L implements unused shared component cleanup (Task 1.12) locally. Production import
review confirms no consumers of shared OpsPageHero, OpsPanel, OpsStatTile or ShowCard; remove
them and their two exclusive test files (nine obsolete cases). Preserve app-local Ops/ShowCard
and shared show-types/test/explicit exports. Remove their export/token/GenrePill/local-copy policy
exceptions and obsolete active guidance; wildcard exports need no manifest change. Drift ceilings
drop from 54 to 53 arbitrary utilities and 89 to 88 inline styles. The mockup at #limpieza uses
current primitives, retains all previous examples and records zero consumers; no deleted UI is
recreated. Spec/quality reviews approve after a browser regression caught unnamed preview panels
and verified their real label/heading API. Preserve all 43 reviewed Linux PNGs/provenance and stop
for Diego's review before publishing 1L or starting Task 1.13.

1L verification covers 3,962 current unit cases: full Shared 763 / Admin 268 / Desktop 50 pass;
Listen's full run has 2,880 passing/four existing skips and only the stale ShowCard local-copy
exception failure, corrected with all three policy cases passing on rerun. Browser preview 39 /
Admin 21 / Listen 42 pass, including final desktop/390px heading/spacing checks. Four typechecks,
both lints, all builds, 49 tooling tests, token sync, 15 drift budgets and layer boundaries across
140 source files pass. Initial JS gzip is Admin 514,932 B / 532,480 and Listen 204,904 B / 307,200;
no ceiling increased. Clean generated shared output contains none of the retired modules.

On 2026-10-16 Diego approved Checkpoint 1L and explicitly authorised commit/push, canonical Linux
captures and continuation to theme runtime retirement (Task 1.13). This supersedes the local-only
approval notes above. Keep the persistent mockup and stop at the next review checkpoint.

1L is published as `2c90a6f2`. Linux recording `38883592145` passes; artifact `12038349206`
has verified SHA256 `602c29a1e4de41fa8e48ade0da41907b497623c5b2ad2a6d679a8360d279e8b4`.
All 43 PNGs are byte-identical to the reviewed 1K references; the original manifest is imported.
Capture/provenance commit `bf1fa793` is pushed; comparison/full Frontend Tests pass in
`38885478542`.

On 2026-10-16 Diego explicitly reconfirmed PD53: Listen and Admin share one Crate identity,
tokens, primitives, recipes and interaction rules. Only domain-specific components/data/workflows
differ. Do not introduce app-level visual variants. Legacy local duplicates converge through
block 1b and page migrations; cross-app checkpoints and drift/export gates enforce convergence.

Task 1.13 / Checkpoint 1M is assigned and implemented locally, not published. Consumer inventories
find no technical Smart Mix dependency, so the earlier integrated-baseline scheduling condition
is relaxed for this task only. Preserve integration order/site pin, and reconcile any newly added
Smart Mix settings after integration. Functional motion/effects/density migrate to
`crate.interface-preferences.v1`; palette, material and typography choices retire. Keep Cast v1
compatibility with fixed outgoing identity values and real reduced motion. Local verification and
independent spec/quality reviews pass; Diego reviews the updated mockup before commit/push.

1M remains uncommitted for visual review. Shared 746 / Admin 268 / Desktop 52 / receiver 66 /
protocol 20 full suites pass. Listen full has 2,884 passing/four skipped and only the stale
raw-input budget failure; its measured 10→8 correction passes seven focused policy/theme-color
cases. Chromium 41, WebKit 41, preview 41 and Admin 21 pass. Listen browser 43 pass plus one
interrupted mobile Smart EQ case passing on isolated replay; four existing skips remain.
WebKit test portability preserves all outline/order/clipping assertions without new skips.
Six types, three lints, i18n, Rust collector seven cases/format, builds, 49 tooling tests, token
sync and drift/layer gates pass. Raw-input and direct-shadcn ceilings decrease; none increases.
Exact invocations, bundle sizes and pending hardware/Linux capture QA are in the handover.

Diego approved Checkpoint 1M on 2026-10-16 and authorised commit/push, canonical Linux captures
and continuation with Task 1b.1. Retire the ten obsolete variant PNGs and record/review the
33 remaining single-identity references in Linux CI. Preserve later review/publication stops.
This supersedes earlier local-only 1M notes; rebase/PR/release remain gated.

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

### Checkpoint 1N review corrections — 2026-10-16

Diego requires the close in the panel's top-right corner with suitable margins, not inline
with the title. One OverlayCloseButton now supplies all four overlay routes (AppModal,
ConfirmDialog, Radix Dialog and Sheet): 40 px control, 24 px decorative icon, transparent
hover and shared keyboard focus, inset 16 px. Title space is reserved only when the close
is shown. The sample label/control gap is 8 px using the existing FormField; full form
restyling remains 1b.2. Independent SPEC and QUALITY reviews pass; 1N publication still
awaits Diego's visual review.

Diego also establishes the development test policy: only tests scoped to changed behavior
and affected consumers while developing; run full validation once when development or the
phase closes. This overrides earlier instructions to rerun all suites after every shared edit.

### Checkpoint 1O scope and review — 2026-10-16

Continue locally with form foundations while Diego reviews the preview; continuation does
not approve publication of 1N. Preserve its separate source patch and the review checkpoint.
1O covers the nine used shared controls, AdminSelect consolidation and ConfirmDialog's typed
field label. Keep APIs, caller-owned validation, refs, debounce/clear, keyboard/IME behavior
and the functional iOS 16 px field exception. No new token is needed for the existing 6 px radius.

Split 1P for the 28 fixed short selects (22 Admin, six effective Listen), six SegmentedControl
caller reviews, new-short-select policy and Radio seed debounce. Dynamic option sources stay
selects; do not infer their maximum cardinality from fixtures. Panel switchers keep tab
semantics until their planned migration. RadioGroup has zero importers and is not restyled.
SPEC and final QUALITY reviews pass for 1O; Diego's visual/publication review remains pending.

### Global stacked label spacing — Diego, 2026-10-16

"hay que definir una separacion estandar entra label e input, o lavel y componente que lleve
debajo, y aplicarlar en todas partes"

The standard is 8 px, matching DS §5.6 and the reviewed FormField sample. Apply it throughout
Listen and Admin, including existing forms, searches, sliders, read-only values and chip
groups. One shared `.crate-form-field` grid recipe owns that geometry; do not depend on child
margins or per-app variants. Keep horizontal rows and use an 8 px vertical gap when they wrap.
Section headings and result-list spacing are separate from a field's label/control pair.
This correction is part of the current 1P publication cut, before commit/push and Linux handoff.

### Checkpoints 1N–1P publication and Linux continuation — 2026-10-16

Diego explicitly authorises finishing the next cut through commit/push and transferring the
continuation to a Linux Codex agent without a local checkout. This supersedes earlier local-only
1N/1O publication stops. The combined cut closes Task 1b.1 and Task 1b.2, including the global
8 px label/control correction above. Independent final SPEC/QUALITY reviews and focused tests
pass; no full suites or new CI workflow are run during iteration. Canonical 1N–1P Linux
recording/comparison and native QA remain pending; preserve the 33 existing 1M references and
original manifest. Rebase, PR, deploy and release remain outside this publication authorisation.

The next task is 1b.3 / proposed checkpoint 1Q, with a review stop before later blocks or further
publication. Follow the tracked Linux bootstrap in `2026-10-16-crate-v3-linux-handover.md`;
use the existing `feat/crate_v3` remote branch and preserve the persistent component preview.

### Checkpoint 1Q — text tabs and app-local URL state, 2026-10-16

Diego assigned only Task 1b.3 and requested isolation from the agent working on Crate MCP.
Use the managed Linux worktree `/home/diego/.codex/worktrees/crate-v3-1q/crate`, branch
`feat/crate_v3`, based on published `53177736a7643c232cbb19e744a2b2ee9077efaf`.
The MCP checkout remains on `feat/crate_mcp`; its working files are not part of this diff.

Preserve shared Radix props/variants; `default` and `line` now share one text-tab identity.
Keep helpers separate per app and adopt them in production pages only in their assigned phases.
The helper contract validates reads/writes, falls back without canonicalizing unknown links,
pushes navigation by default and supports explicit replacement. Preserve unrelated/repeated
query values, hash, route state and scroll. Keep existing path-based Library links unchanged.
The persistent `#pestanas` preview exercises both real helpers and back/forward navigation;
its second named parameter is confined to sample routing.

1Q is local and awaits Diego's visual review. No authorisation to commit/push this block,
advance to 1b.4, merge/rebase, deploy, release or regenerate canonical baselines is inferred.
Focused checks only, with one test/browser worker; full validation remains at phase close.
Canonical 33 Linux PNGs/1M manifest and pending 1N–1P Linux/native QA remain unchanged.

### Checkpoint 1Q approval — 2026-10-16

Diego approved 1Q and authorised its commit/push and continuation to Task 1b.4, preserving
the active preview and stopping for review at checkpoint 1R. This supersedes 1Q's local-only
publication stop above. No CI/baseline update, PR, merge/rebase, deployment or release is implied.

### Checkpoint 1R — states, local review, 2026-10-16

1Q is published as `e863c22715de39b974fc1cf527003fc498d59215`; Diego's continuation authorises
Task 1b.4 locally with the next review stop at 1R. The shared state recipes retain public
compatibility aliases and worker/router callbacks. Three Admin skeleton import subpaths stay
as re-exports; their duplicate implementations and the dead local ErrorState retire.

Section loading accepts final-layout children. Fix the explicitly composed Library card and
sort-row dimensions, Home/Radio rail shapes and user avatar rows. Complex legacy sections and
direct CrateLoader users still need their assigned page migrations; do not certify all page
geometry or global spinner retirement from this foundation checkpoint. Keep focused checks and
one worker per test/browser chain. Preserve canonical captures and the phase-close full run.

Diego questioned the yellow dot beside the large page error title: “puede que tenga sentido un
identificador visual, pero no ahi”. Move it into the eyebrow beside `Error de servicio · 503`;
he confirmed “pefecto, ese es su sitio”. This approves that placement, not the whole 1R checkpoint.
Keep the title clean; compact error text still uses the shared warning state treatment.

### Checkpoint 1R publication / 1S local review — 2026-10-16

Diego approved complete 1R and authorised commit/push and continuation to Task 1b.5, keeping
:5186 active and stopping at 1S. Published `093dcb1fbfe67d1f994ee49e27aefd802d258c54`;
remote verified. This supersedes the earlier local-only 1R stop and marker-only approval.

1S applies DS §5.5 to shared lists/grids/covers/play, Listen row/card foundations and Admin's
existing management TrackTable. Admin has no player capability here; do not invent playback.
Preserve selection, virtualization, offline/remote/native artwork pipelines and action controllers.
Metadata uses supplied analysis/quality/explicit/provenance, never fabricated values. Container
queries hide lower-priority metadata before narrow queue/recommendation titles collapse.

During review Diego required the current Listen play button's essence: halo, layers and a ring
that advances with playback. This explicitly supersedes the author's initial flat-control
interpretation. Restore the progress leaf and original visual structure, adapted to shared V3
tokens with a 2 px ring. Only that leaf subscribes to ticks. Diego also retained the current
player's luminous seek trail, made finer: horizontal GlowSeekBar is 2 px (thin 1 px), with native
keyboard/scrubbing and broad touch targets. Production and mockup reuse the actual local control
and CSS. Respect motion/effects preferences. No global player redesign follows from this scope.

Pinned site object `258bbaee` is unavailable on this Linux clone even after fetching feat/website;
GitHub commit lookup returns 422. Preserve the pin, use the explicit DS contract and report this
fidelity limit; never substitute current website HEAD or vnext. Stop at 1S before publication or
1b.6. The existing 33 canonical PNGs and 1M manifest, Linux comparisons, native QA and phase-close
validation remain separate.

### 1S review correction — attached seek head, 2026-10-16

Diego observed the progress head moving separately from the luminous beam. The beam animated
its transform for 150 ms while both head variants changed left position immediately. Keep their
existing appearance and geometry, but share the same duration/easing through `motion-duration-fast`.
Reduced motion must suppress movement transitions on both beam and heads. This is a local 1S
bugfix, not checkpoint approval or authorisation to publish or continue to 1b.6.

### 1S review correction — one moving beam edge and smaller head, 2026-10-16

Diego confirmed the continuous drag still detached the head, clarifying that the beam advanced
before the point. He also requested a smaller point and a matching beam. This supersedes the
previous equal-duration/easing fix: use a single app-local PlayerProgressBeam in both the native
range seek control and desktop PlayerBarProgress. One absolute moving edge owns the fill, trail
and both head variants; no head has its own positional animation. Keep 1–2 px core strokes,
reduce the head to 4 px idle / 6 px engaged, with an 8 px trail envelope and proportionate glow.
The interaction area remains 40/44 px. Preserve existing seek, Jam and keyboard controllers.

Natural rAF sampling during uninterrupted/reversing dragging reproduced the old separation.
The earlier test artificially aligned animation times and missed it; replace that test with
observations of actual frames. These corrections stay local at 1S, pending Diego's review.

## Linux checkpoint 1T — status-colour application, 2026-10-16

Diego approved 1S and authorised publication (`124b36a8`) plus Task 1b.6 locally; 1T is the next
review/publication stop. PD10(a)/D4 remain settled. Code review identified semantic exceptions
to the hue codemod: synced lyrics and running delivery are active; translation review is waiting;
inactive users/exited services and descriptive links/types/shows/quality are neutral or accent,
not warnings. These are implementation corrections, with representative consumer assertions.
Severity/error distinctions in translation reports retain both the severity word/neutral meter
and the issue code. Task logs and playlist refinement follow the same level treatment.

No new dependency, backend/API/permission/subscription behaviour, site pin or release decision.
Existing Admin icons remain until 1b.8. The source policy has zero exceptions and rejects local
identifier-bound destructive variants/icon tones as well as literals; it does not claim arbitrary
runtime data-flow analysis. Actual danger still belongs only to the shared confirmation action.
Diego's no-baseline/no-full-CI iteration rule overrides this task's historical capture re-record
instruction. Advisory real-component preview checks support 1T; canonical Linux record/import/
comparison and native/AT checks remain phase-close work. Stop before 1T publication or 1b.7.

## Linux checkpoint 1U — Skip navigation, 2026-10-17

Diego approved and authorised publication of 1T (`5308c391`) and Task 1b.7 locally, with a stop
at 1U. Shared SkipLink is now used by both app shells; app-local target IDs and translated labels
are injected. Existing main elements gain id/tabIndex only; no route, permission, player, API,
subscription or page-layout contract changes. Successful activation preserves query/hash state.
DS3.10's automatic route-change h1 focus/announcements stay in Tasks3.2/4.1. The 1U specimen uses
isolated documents with actual SkipLink/main, not nested main landmarks or real app API chrome.
These choices preserve existing deep-link state and avoid expanding this accessibility task
into later navigation redesigns. Canonical Linux CI/native/AT gates remain pending; stop before
1U publication or 1b.8. No new dependency or site-pin change.

## Task 1b.8 inventory gate — checkpoint 1V, 2026-10-17

1U is approved/published (`afed5a3c`). The local [1V inventory](2026-10-17-crate-v3-admin-icon-inventory.md)
is ready for Diego before deletion. It proposes zero permanent action-glyph exceptions and records
25 compact/shared/content cases individually. A conditional shared dependency is not a rendered
icon or an approved exception. Marks, QR, maps/charts and inert Listen hero output are content;
their own action controls still follow Admin's text policy. No new icon allowlist or production
migration is included. The proposed first later group is Sidebar/CommandPalette/Shell, with tests
for permissions, keyboard, collapsed/mobile navigation and unchanged skip links. Stop at 1V
before publication/first group; this records a proposal, not Diego's approval of its details.

## Functional UX glyphs retained — Diego, 2026-10-17 / checkpoint 1W

During the first Admin retirement group Diego clarified: “los iconos de back y forward y demas
glyphs de UX lo podemos mantener”, then “back nextm collapse, etc”. This supersedes the zero
permanent-exception proposal in the historical 1V inventory for conventional functional UX.
Keep back/forward, collapse/expand, menu, close, search and comparable UX affordances. Preserve
accessible names, keyboard/focus behaviour and 44px targets. Continue retiring redundant Admin
page/destination/action/header/metric glyphs. Listen/Desktop icons and player essence are unchanged.

The first group's policy bounds nine concrete sites: Shell history-back/history-forward/mobile-
navigation/help-close; Sidebar sidebar-collapse/sidebar-expand/drawer-close; CommandPalette
palette-search/palette-close. The existing shared close glyph is reused without changing shared
contracts; direct Admin UX glyphs remain Lucide. Other nested SearchBar/role-Select surfaces are
pending migration. A family preference is not a blanket exception for decorative navigation.
1W remains local for review before publication/another group.

### 2026-10-17 — 1W visual review: current destination and contained focus

Diego requested balanced spacing around navigation counts and a dot/bar to identify the current
page. 1W retains the boxed count with mono tabular numerals and balanced measured ink spacing;
it adopts the existing DS §5.4 2px accent-hi active bar in expanded, compact and drawer navigation.
His palette feedback is addressed with the existing shared focus-inset utility: keyboard focus
stays visible inside the search field/header. No shared APIs, Listen/Desktop or historical
checkpoints change. Keep the 1W review stop; no publication or next group is authorised yet.

### 2026-10-17 — 1W published; 1X reusable controls and standard Select geometry

Diego approved/published 1W (`52eaa6a5`) and authorised the next bounded Admin group while
retaining UX glyphs. 1X removes redundant search-result/recent/empty icons and the AI sparkle;
search/clear/loading/Select/rating/image UX remains. No shared API opt-out or Listen icon removal.
His report of clipped source options is a shared Select geometry bug: the inner viewport must
fit its outer menu instead of forcing the trigger width through an explicit narrower menu.
Repair that common foundation and verify both consumers. Stop again at 1X before publication
or operations/page migrations; do not treat group 2 as whole-Admin completion.

During the same 1X review Diego identified search suggestions behind the AI action. Repair the
stacking context with the common portalled dropdown and its anchored primitive; do not add
another z-index scale. Replace document-based outside detection so native portal result clicks
are preserved. This needs only an additive PopoverAnchor export; existing consumers keep their API.

### 2026-10-17 — 1X published; 1Y operational headings and readings

Diego approved 1X and authorised commit/push plus the next bounded Admin group, preserving UX
glyphs and another review stop. 1X is `b628a438` at origin. 1Y retires the decorative icon prop
from Admin-local OpsPageHero/OpsPanel/OpsStatTile and adapts all 125 page uses and the older 1T
specimens. The action/children slots keep their behavior and functional glyphs; this approval
does not cover deleting other page icons. Read-only label/value pairs follow the shared real
8px `.crate-form-field` contract. No shared or Listen/Desktop contract change is required.
Review `#superficies-admin`; do not publish 1Y or begin the following group before Diego.

### 2026-10-17 — 1Y published; 1Z Logs/Stack controls

Diego approved 1Y and authorised commit/push plus the next bounded group with UX glyphs retained
and a review stop. 1Y is `ea6ebdc8` at origin. 1Z migrates Logs and Stack only: remove summary and
labelled refresh/restart decoration, name service controls visibly, and retain conventional live
pause/resume, service start/stop, disclosure, search, busy and external-navigation glyphs at exact
reviewed sites. A chevron replaces the decorative logs icon because it communicates expansion.
This keeps shared contracts, capability gates, streaming, action eligibility and mutation paths.
The separate planned Stack core-service restrictions are not implemented in this visual group.
Review `#operaciones-admin`; do not publish 1Z or begin another group before Diego's approval.

Diego's 1Z Service filters feedback also adopts the shared SegmentedControl instead of bespoke
CratePill selection with forced 44px height. Its 32px fine / 44px coarse geometry and radio/arrow
semantics match the existing Log level selector; page/service actions and searches remain 44px.

### 2026-10-18 — 1Z published; 1AA Analysis

Diego approved 1Z and authorised commit/push plus one further Admin icon group, preserving UX
glyphs, the preview and the next review stop. 1Z is `2efb4754` at origin. 1AA covers entire
Analysis and its local components only: remove redundant labelled action/header/coverage/output
glyphs and private icon props. Retain nine exact Loader2 sites (initial + eight actions), with
named loading and busy state. Static header summaries use CrateChip consistently with Diego's
1Z sizing feedback; readonly values use the shared 8px recipe, actions retain 44px targets.
Five helpers/action functions, both status/metrics memos and eight queue call ASTs are unchanged.
No provider, API/queue contract, stream, permission, route, shared primitive or Listen/Desktop
change. Preview data and action adapters are isolated specifically to the Analysis import;
old action timers cannot change a subsequently selected sample state. This guard belongs only
to the mockup; production refresh remains 800ms. Review `#analisis-admin`; do not publish 1AA
or begin another group before Diego's approval. Remaining 1b.8 pages stay pending.

1AA same-checkpoint amendment (2026-10-18): Diego explicitly requested removing Operator notes
because it adds no value. Remove all four static tips and the enclosing split layout; Recent
outputs now fills the available width. Both recent-track cards and all queue/snapshot behavior
remain. Focused content/layout regressions verify absence and full width at 1440/768/390.
This is a user-directed content change after the first review, not permission to publish 1AA.

1AA further user amendment (2026-10-18): Recent outputs must include audio fingerprints. Since
the current snapshot only exposes last_analyzed/last_bliss, implement a narrow additive
last_fingerprinted projection end to end rather than a preview-only sample card. Reuse existing
library timestamp/source columns; no schema migration, raw hash, new endpoint, poll or stream.
The existing 120s worker step gathers it off-request; HTTP serves the cached payload. The model
has an empty default and Admin accepts older snapshots. Preserve all eight queue actions and
other data calculations. Three explicit result kinds prevent misleading Bliss copy on the new
card; fingerprint source comes from its own stored result. Later unified recent/instruments and
other action output histories remain pending. This amendment supersedes the original 1AA
no-backend-change scope only for this field; publication/next group still requires Diego.

## 2026-10-18 — 1AA published; 1AB provisional, typography and Dashboard analysis

1AA is approved/published as 13272706. Local Dashboard icon changes retain loading and disclosure
UX; data/action/chart contracts remain intact. User font review exposed Poppins inherited by
Admin Ops headers/labels/numerals and local Analysis. Their existing V3 face hierarchy is now
applied, with Poppins body/controls and native/shared exceptions preserved. Container-based
metric columns keep long Mono labels inside their own field, with 8px label/value spacing.

Diego rejected Dashboard's density and asked for analysis. His confirmed priority is checking
whether the system and its jobs function. See
[Dashboard simplification analysis](2026-10-18-crate-v3-dashboard-simplification-analysis.md).
It proposes three information blocks and identifies evidence missing from the current healthy/
worker/progress summaries. This is a proposal pending review, not an approved change of PD §4.1
or implementation Task 3.3. **1AB remains provisional; no further product implementation, commit/
push or next group at this analysis stop.** Final handover records validation and limits.

## 2026-10-18 — approved and locally implemented 1AB composition

Diego approved implementing the three-block Dashboard using only data already available and
reviewing it before commit. This supersedes the provisional analysis stop: report/service state,
reported work and fresh offline-service interruptions replace the four-tile/library/diagnostics
composition. Future health/governor/worker-liveness contracts are not implemented or invented.
The existing ops provider supplies all values; old/unknown data stays explicit, progress is
derived only from valid reported fields and a local deadline expires the display without polling.
Maintenance moves to a named shared secondary dialog with original typed callbacks and matching
endpoint capabilities; functional loading/close glyphs remain. Admin/Listen identity, 8px/44px
contracts and prior checkpoints stay intact. See final handover and
[execution plan](2026-10-18-crate-v3-dashboard-implementation.md). **Stop at 1AB before publication.**

## 2026-10-18 — 1AB published; bounded SystemHealth icon group 1AC

Diego approved1AB, published as `2d047fecd4721ac4575faadbf9bd8781eec37c5b`, and authorised the
next bounded Admin icon group with UX retained. SystemHealth retires redundant glyphs and its
local ResourceCard icon prop; shared radio window/text refresh preserve existing queries and
callbacks. Typographic readings use the shared 8 px recipe, established fonts and responsive
geometry. Nivo/meter instruments, calculations and data authority stay unchanged. This is
Task 1b.8 continuation, not completion of SystemHealth Task 3.4, other pages or phase validation.
The real-page fictional preview is `#sistema-admin`; older checkpoints and the unavailable
site pin 258bbaee remain. See [execution plan](2026-10-18-crate-v3-system-health-icons.md) and
final handover for evidence/limits. **1AC stays local for Diego before commit/push/next group.**

## 2026-10-18 — 1AC published; bounded Library Health icon group 1AD

Diego approved 1AC, published as `439b3e78daf2719d86cee72dd5726f7bc210c504`, and authorised
one next Admin icon group with functional UX retained. Local 1AD covers Health.tsx and its local
issue/artist headers only. Redundant action/severity/header glyphs become text; three loaders,
two disclosure chevrons and neutral SeverityMeter instruments remain. Group disclosure and
sibling actions replace nested buttons, preserving keyboard/focus and action isolation. Text
actions have 44 px targets; three Repair lanes fields use the actual 8 px recipe with Mono labels,
Bricolage titles/numerals and Poppins body. Shared filter sizes and all requests/streams/repair
eligibility/gates/task completion are preserved. No Health data authority redesign is included.

The actual page joins the persistent mockup at `#salud-admin` / `admin-health-demo.html`, using
isolated fictional API/events and local task completion. All previous checkpoints remain. See
[execution plan](2026-10-18-crate-v3-library-health-icons.md) and final handover for scoped evidence,
bundle and limits. This continues Task 1b.8, without completing it or later Health product work.
**Stop at 1AD before commit/push or another group; no full CI/baselines during iteration.**

## 2026-10-18 — approved Health issue queue implemented locally at 1AD

Diego approved the issue-queue sketch and authorised implementation using only available real
data, retaining the active preview and an uncommitted 1AD stop. The queue and actual cases/actions
are primary; task activity, check catalog and filters are secondary disclosures. This supersedes
HealthScan as the mandatory primary Health visual. Future scan instrumentation may enrich the
secondary check reference or scan status, preserving the queue-first composition; its data,
provider/event/pagination/backend prerequisites remain pending and are not silently implemented.

Local Health uses existing counts/runs/catalog/history. It distinguishes loaded/recorded counts,
no result/no open issues/filter-empty/stale, prioritises worst loaded severity and shows only
explicit valid task counters. It preserves endpoints, repair/role eligibility, streams and
confirmation flow. Confirmation copy distinguishes check-wide repair scope, loaded auto-fixable
cases and recorded open counts; no new data or repair capability is invented. Both detail field gaps are actual
8 px, fonts/tokens and bounded UX stay shared. Evidence/limits and the final review are in the
handover and [execution plan](2026-10-18-crate-v3-health-inbox.md). This is a bounded 1AD
composition amendment, not completed HealthScan/Task 3.6 or whole Task 1b.8/phase QA.
**Stop at 1AD for Diego before commit/push or another group.**

## 2026-10-18 — 1AD visual fidelity correction, local review

Diego requested recovery of the approved Health sketch's accents, hierarchy and spacing. The
same real data/actions remain. Health restores a 1128 px content cap, reviewed 36–54 px/700 title,
27 px/650 section and 23 px/600 issue headings with existing fonts;1 px accent rail, cyan expanded
state and a primary artist-review action after actual cases. Eligible direct repairs remain
primary where no artist review is available; metadata/secondary actions stay visible and
filters share the queue heading row. Actual 8 px fields and 44 px actions remain.

These reviewed domain composition dimensions do not create an app-specific foundation variant
or change the global type scale. The sole shared CSS change puts the default border colour in
base, preserving its precedence over preflight but allowing explicit component/utility colours.
It corrects the grey rail's cause in both Admin and Listen; no caller `!important`, new colour,
API/provider/backend change or identity/theme branch. Real CSS-entry browser regressions cover
accent, quiet, transparent and default borders in both apps. Existing repair eligibility/routes,
callbacks, confirmation, counts and streams are unchanged; see the main handover for audit,
focused evidence, the recorded transient focus-test failure/replay and remaining QA limits.
**Stop at 1AD for Diego before commit/push or another group; preview remains active at :5186.**

## 2026-10-18 — 1AD approved; next bounded icon group 1AE

Diego approved Library Health after its visual drift correction and authorised commit/push.
Existing evidence and product contracts remain; this supersedes its local-only review stop.
Next group is Library Trash alone: retire redundant header/action glyphs, retain functional
loading indicators, requests/task tracking and shared confirmations. No phase6.4 data/index/
pagination work is implied. Keep preview/checkpoints active; stop1AE before commit/push.

## 2026-10-18 — 1AD published; bounded Library Trash group 1AE

Diego approved the corrected 1AD and authorised publication. Commit/push is verified as
`5e1d9c8f287804a834b3143f6367f7e5a2ef8e31`, feat/crate_v3. This supersedes the former 1AD stop.
The next bounded group is Library Trash alone: its redundant heading/idle refresh/restore/delete
icons are retired; four explicit loading sites remain. Existing helpers, worker requests/body,
task waits, error handling, busy/disabled conditions, route capability gate and both complete
shared confirmations are unchanged. Text controls use 44 px targets and the existing identity/
fonts/solid surfaces. No shared foundation, dependency or backend changes in 1AE.

The actual page is in the persistent mockup at `#papelera-admin` / `admin-trash-demo.html`, with
labelled fictional tracks and local task success/failure/completion. No API/SSE/library operation;
all previous specimens, including published 1AD, remain. Live policy now covers 14 whole files /
44 concrete UX sites; the historical 1V inventory remains untouched. This does not complete
whole Task 1b.8 or phase 6.4's Trash index/pagination/data work. Evidence/review/limits are in the
main handover and [execution plan](2026-10-18-crate-v3-library-trash-icons.md).
**Stop at local 1AE for Diego before commit/push or another group. Keep preview :5186 active.**

## 1AF execution record — Contributions, 2026-10-18

1AE Library Trash approved/published `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b`, verified at
origin. The next authorised group is Contributions alone, extending the existing DS §1.7 decision,
not creating another icon policy: redundant header/idle refresh removed, two named loading glyphs
retained. Real attribution, source/status fields, album/cover helpers and GET limit150 stay intact.
Only rendering/shared-identity containment changes; no backend, new foundation variant or Listen
change. Exact preview isolation and source policy continue. 1AF stays local for Diego before
publication; no next group. See final handover for focused evidence and remaining QA.

## 1AG execution record — Timeline, 2026-10-18

1AF Contributions approved/published `1b8ab82362f696f16ea481b3789436443b199d5d`, verified at
origin. The next bounded group applies existing DS1.7 to Timeline: retire decorative stats and
cover fallback glyphs, retain three exact loading/disclosure sites and shared loading/error UX.
Private StatCard drops its icon prop, uses shared display/Mono and8px field recipe. Data, bars,
order/ties, toggle/navigation/asset/retry contracts remain. No new foundation/API or Listen change.
The real local specimen is #cronologia-admin. Whole1b.8 and Timeline/A14 are not completed. Stop
at1AG for Diego before commit/push; final handover owns exact focused evidence and limits.

## Diego amendment — remove Library Timeline (2026-10-18)

After reviewing local1AG Diego explicitly requested removal of Timeline. Retire Admin Library
Timeline page/navigation/active mockup and withdraw its future A14/phase6.4 target. This
supersedes earlier1AG icon-retirement records, not the separate release/artist/ops chronologies.
Keep old /timeline as a library.view-protected replace redirect to Browse; keep the old specimen
URL only as a redirect to its persistent retirement record. Preserve the withdrawn proposal and
proof in ignored review storage and historical documentation; no active feature is retained.
Backend endpoint remains compatible; no API/data removal. Published1AF is1b8ab823. Current1AG
is the uncommitted retirement, awaiting Diego; no publication or next-group authorization.
