# Crate v3 decision register

> Estado vigente: [tabla única de continuación](2026-10-19-crate-v3-current-state.md).
> Los registros cronológicos conservan sus estados históricos; las aprobaciones posteriores los sustituyen.

Decided by Diego on 2026-10-15 (implementation plan Task 0.3). This file is the single reconciled
list; the product design (PD §6, `PDn`) and the design system spec (DS §6.12, `[Dn]`) carry the
same answers in their own registers. The accepted single-identity amendment and joint-release
protocol below supersede the former visual-variant and intermediate-release assumptions.

Rule for the session: every decision takes the documented recommendation, except where the
"Decision" column says otherwise. Conflicts between the two registers were resolved in favour of the
product design (PD14, PD28, PD29, PD32).

Current implementation:1AP is approved/published (`d30b1c02`); local1AQ covers PlaylistEditor text actions, typography and fields, preserving UX glyphs and existing contracts. Stop uncommitted
for review; the latest handover owns validation and limitations.

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

Task 1.13 / Checkpoint 1M was later approved and published as `21873d24`; this replaces its former local-only status. Consumer inventories
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

## Linux 1AH — bounded Bandcamp icon group (2026-10-18)

Published 1AG e5b9f087 removes Library Timeline and corrects the obsolete StatStrip reference.
Diego authorised the next bounded group. Local 1AH changes Bandcamp rendering only: retire
redundant metrics/action icons and private icon props, reuse existing Ops presentation/MonoLabel
recipes, preserve six marked loading/external UX sites and all eight data/action contracts.
Source policy16 whole files/52 retained sites. Metric gaps8px, targets44px, existing fonts.
No full Bandcamp/A10/phase6.5 instruments or data/error-state rewrite; no shared/Listen/backend/
permissions/dependency change. Specimen mounts the real page with isolated fictional data.
See 2026-10-18-crate-v3-bandcamp-icons.md and final main handover for evidence and limits.
Stop uncommitted1AH for Diego; no next group or publication. Canonical1M/pin258bbaee preserved.

## Linux 1AI — bounded Discovery icon group (2026-10-18)

Published1AH58b2695b retains Bandcamp contracts/UX. Diego authorised the next bounded group.
Local1AI changes Discover.tsx presentation only: redundant action/summary/placeholder glyphs
retired, four search/loading UX sites retained, actual data/task/navigation/image contracts
unchanged. Visible search label uses existing MonoLabel/Input/8px field recipe;44px action/input
targets and aria-busy. Source policy17wholefiles/56exactUXsites, bounded shared ErrorState once.
Real isolated specimen includes local data/task steps/assets/destinations; prior checkpoints
remain. No full B5/A11/phase6.5 instrument/data migration, shared/API/permission/Listen change.
See 2026-10-18-crate-v3-discovery-icons.md and final main handover for evidence/review/limits.
Stop uncommitted1AI for Diego; no next group/publication, canonical1M/pin258bbaee unchanged.

## 1AI approval and publication — 2026-10-18

Diego approved Discovery checkpoint 1AI and explicitly authorised commit/push to the existing
feat/crate_v3 branch plus the next bounded Admin icon group, preserving functional UX glyphs.
The previous local-only 1AI stops are superseded by this approval. Discovery presentation,
data/task/navigation contracts and earlier checkpoints remain as reviewed. No full suites/CI,
canonical refresh, PR/merge/rebase/deploy/release. The next group stops at 1AJ before publication.

## Linux 1AJ — bounded New Releases icon group (2026-10-18)

1AI Discovery is approved and published as `a304ecf9c41bc254dab98b9f52668e18f4d87852`;
push and remote ref verified. Diego authorised the next bounded group preserving UX glyphs.
Local 1AJ changes NewReleases.tsx presentation only: remove redundant labelled view/action and
summary glyphs, cover placeholders and empty illustration. Retain six marked search/loading/
dismiss sites. Dismiss uses the shared Button outline/icon recipe, retaining X, title, native
keyboard behavior and callback. Search/type pairs use the shared8px recipe; controls are44px.

Data shaping, raw artwork, canonical links, capabilities, snapshot/SSE lifecycle and action/task
contracts remain unchanged. Existing global counts, date/upcoming/filter semantics, independent
loading/error and timeline/grid action eligibility differences are preserved. No invented stages,
endpoint, backend, shared API, dependency or Listen/Desktop change. This does not complete1b.8,
ReleaseTimeline/B6/A10/phase6.5. Actual isolated specimen: /admin-new-releases-demo.html and
persistent /#lanzamientos-admin, with local fixtures/tasks/SSE/assets/capabilities/destinations.
Evidence, final review and remaining QA are owned by the final handover. Stop1AJ uncommitted
for Diego; no next group or publication. Canonical1M/pin258bbaee remain unchanged.

## 1AJ approval and publication — 2026-10-18

Diego approved1AJ and explicitly authorised commit/push to feat/crate_v3 plus one further
bounded Admin icon group, preserving functional UX glyphs. Previous local-only1AJ stops are
superseded. The deferred shared Select label association remains recorded; no unreviewed fix.
Next checkpoint1AK covers Global Catalog and stops before publication for Diego. No full
suites/CI/canonical refresh, PR/merge/rebase/deploy/release; prior checkpoints remain intact.

## Linux 1AK — bounded Global Catalog icon group (2026-10-18)

1AJ New Releases is approved and published as `235b892f5dadab07faf3ae7a1a1727864b7a06c9`;
push/remote verified. Diego authorised another bounded Admin group preserving UX glyphs.
Local1AK changes GlobalCatalog.tsx rendering only: redundant refresh/idle reconciliation and
read-model title glyphs retire. Retain two marked aria-hidden mode-specific busy glyphs and
aria-busy buttons. StatusDot with state word lives in content; four existing readings reuse
OpsStatTile with the standard8px label/value pair. Display/mono/body fonts and44px native controls
follow existing recipes; view selection stays local (no URL migration or new shared contract).

Three GET URLs/limits25+50, response shapes/formatters, mode POST bodies, capability and handler
behavior stay unchanged. Real refetch returns void: buttons unlock after enqueue while status/
runs refresh asynchronously; no worker completion is inferred. Existing zero/unknown/error and
candidate/run limitations remain; no backend, auth, task polling, SSE, dependency or Listen change.
This does not complete1b.8, B17/A24/phase6.7 or add duplicate resolution. Actual isolated specimen
is /admin-global-catalog-demo.html, persistent /#catalogo-global-admin. Prior checkpoints and
Select-label deferred minor remain; canonical1M/pin258bbaee unchanged. Main handover owns scoped
verification/review/limits. Stop1AK uncommitted for Diego before publication/next group.

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

## Linux 1AL — bounded Roles & Permissions icon group (2026-10-18)

1AK Global Catalog is approved and published as `44d5f16a1eb20d6b7c89e6b22aee768d86c5bac2`.
Diego's requested specimen-copy correction is included; its actual enqueue/refetch contract is
unchanged. Shared Select-label association remains the separate deferred1AJ minor.

Local1AL changes Roles.tsx rendering only: remove the decorative header shield, use Bricolage
for headings/role names and MonoLabel/mono for slugs, group labels and capability identifiers.
Role-name/slug and group/capability readouts use the shared8px .crate-form-field recipe; narrow
metadata wraps. Existing textual loading gains status semantics. There are no functional glyph
sites on this page. Whole-file policy now covers20 files and retains64 UX sites elsewhere.

GET /api/auth/roles, response interfaces, state/effect, grouping/sort, API order, counts and
null/empty behavior are unchanged. The actual route/sidebar roles.view gates remain; the page
is read-only, with no editor, role creation or permission mutation. Diego's question about
editing presets was answered as a description of the current limitation, not an editor request.
The existing rejected-read path has no catch/error surface; this rendering group does not
change or certify that behavior. No backend/shared/Listen/dependency change.

Review /admin-roles-demo.html or /#roles-admin on the persistent5186 preview. The real page
uses importer-only API fixtures and manual read completion; ready/loading/empty/null sample
states do not call a backend. Evidence:23 scoped unit cases,4preview and6builtAdmin Chromium
cases at1440/768/390; strict scoped types/lint, literal-preserving AST audit, Admin and17-entry
preview builds pass. Initial JS526505/532480Bgzip,5975Bmargin. The handover owns final review,
proof and QA limits. A19/phase6.6/global1b.8 remain incomplete. The accepted future Users
list/status/modal direction stays separate; Users/UserMap code is untouched.

**Stop1AL uncommitted for Diego before publication or another group.** No full suites/CI,
canonical refresh, PR/merge/rebase/deploy/release. Canonical1M and app/web@258bbaee remain.

## 1AL approval and publication authorization — 2026-10-18

Diego approved1AL and explicitly authorized commit/push on feat/crate_v3 followed by one further
bounded Admin icon group, preserving functional UX glyphs and the persistent preview. Previous
local1AL stops are historical and superseded by this approval. Approved production source and
all13pre-publication source hashes were verified; only specimen/footer publication labels and
the affected persistent check change for publication. No full suites/CI/canonical refresh,
PR/merge/rebase/deploy/release. Next stop is1AM, uncommitted for Diego before publication.

## Linux 1AM — Users list and bounded icon group (2026-10-18)

1AL Roles is approved and published as `d72232e9ef581248ae59a1289bd357dec0629db1`;
Diego explicitly authorized one further Admin group, keeping UX and the preview. Local1AM
implements his accepted Users amendment: remove the map and repeated large cards, show
identity/email/roles, account/activity state and presence in a semantic list table, and reuse
the existing detail modal for secondary data/actions. On narrow layouts presence moves under
the identity; state and Inspect/Delete stay available. No unavailable data or new endpoint.

Production scope: Users.tsx rendering plus obsolete map-only wiring. Remove decorative and
label-redundant glyphs; retain12 individual search/pagination/loading UX sites and shared close/
confirmation controls. Policy covers21whole files/76retained UX sites. Existing UserMap source
and utilities are unused by Users and left for later cleanup; no map request/mount remains.
Bricolage headings, Poppins prose, mono metadata and shared8px readout/form pairs. Native
buttons>=44px; existing shared selectors preserve32px fine-pointer/44px coarse-pointer recipes.

GET list/detail, ?inspect=, other parameters, filters/search/presence sort/page20, all remaining
capabilities, abort cleanup and existing role/status/session/password/create/invite/delete
handlers, validation, payloads, confirmations and feedback remain. No role-preset editor or
backend/presence-query rewrite. A18/B17/phase6.6/global1b.8 are incomplete. The real standalone
and persistent specimen use complete fictional responses, actual auth context values and
importer-only API fixtures; actions/pending/failure/copy are local, with no real access changes,
mail delivery, clipboard mutation, backend or preferences.

Review /admin-users-demo.html or /#usuarios-admin on the active5186 preview. The handover owns
validation/bundle/final-review evidence and QA limits. Earlier checkpoints, deferred1AJ shared
Select-label minor, canonical1M and sitepin258bbaee remain. **Stop1AM uncommitted for Diego**,
with no next group, full suites/CI/baselines/PR/merge/rebase/deploy/release.

### 1AM review steering — larger avatars and wider detail

Diego requests larger user avatars and more viewport width for the detail modal. Row avatars
are56px, also visible on narrow layouts; detail avatars72px. The old sm:max-w-6xl utility was
constrained by the shared default md size (560px). Users detail explicitly opts out of that
size attribute and uses its existing viewport width minus32px, with shared chrome, animation,
focus trap, close behavior and scroll intact. No new shared variant or other modal change.
A browser regression assertion observed560px before the fix; final geometry must exceed90%
of the viewport at1440/768/390. No canonical images are regenerated.

1AM review closure: one independent complete-diff review and one tested fix pass. Actual
password/status label gaps now8px; nested sample completion uses the active dialog and pending
password submit keeps its name.30unit/9preview/6builtAdmin, types/lint/AST/builds pass;
initialJS526482/532480Bgzip. Deferred minors: sticky table header and earlier1AJ Select label.
Main handover records every ruling/limit. Previewactive;1AM uncommitted for Diego.

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

Final audit-reconciliation review: Critical0/Important0/Minor2; both new A6 prevention gaps
(variant-prefixed utilities and lexical constant shadowing) closed in one tested pass,19guard
cases/17Node cases/CLI/types/lint green. UI remains the validated17preview+6builtAdmin build,
526377/532480B gzip,6103Bmargin. Full final review rulings and costs are in both handovers.
See the single current-state table; **stop1AP uncommitted, previewactive5186**.

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

## 1AS — shared action contracts (local review)

1AR published at `a3ba497d`; 1AS is local for review. Button retains text/form/link semantics; ActionGroup, ActionButton and ActionLink compose the approved header/row Button ghost/icon-lg + Tooltip pattern,44px with4px corners, contextual accessible names and short action tooltips. IconButton retains compact round/glow utility controls;44px coarse targets reserve real layout space. Admin aliases preserve asChild router links; Listen adopts conventional server Remove. Loading/disabled discovery and activation guards belong to shared controls. Existing card surfaces and specialized playback/AI/navigation stay in their documented families. Storybook records the live contracts; [1AS plan/evidence](2026-10-19-crate-v3-actions-reconciliation.md) is the current checkpoint record. No new main-mockup section. Stop before1AS commit.

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

## Enmienda 1AW — 2026-10-19 · local para revisión

Diego confirma que la miniportada independiente de pista, álbum o artista nunca baja de48px,
también en filas compactas; MediaCover y la receta de compatibilidad shared poseen ese mínimo.
Avatares personales, marcas y celdas de collage son roles separados. El track play conserva V2:
glyph blanco18px (slot24px) sobre cover48px y control activo40px con ring2px, aura/efectos y progreso en
hoja activa. Sin círculo azul que tape la portada. Selección no implica aria-current; títulos
de entidad mantienen14/500 y HairlineRow12/18. Catálogo y consumidores actualizados, adopción
completa y QA de fase pendientes. Ver el estado vigente y la reconciliación de1AW; sin commit.
