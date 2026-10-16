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
byte-identical. Import all 40 PNGs and the original manifest. Comparison CI is the next gate.
