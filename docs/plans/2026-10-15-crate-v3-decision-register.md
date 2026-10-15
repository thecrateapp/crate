# Crate v3 decision register

Decided by Diego on 2026-10-15 (implementation plan Task 0.3). This file is the single reconciled
list; the product design (PD §6, `PDn`) and the design system spec (DS §6.12, `[Dn]`) carry the
same answers in their own registers.

Rule for the session: every decision takes the documented recommendation, except where the
"Decision" column says otherwise. Conflicts between the two registers were resolved in favour of the
product design (PD14, PD28, PD29, PD32).

Related documents:

- `2026-10-14-crate-v3-product-design.md` (PD)
- `2026-10-14-crate-v3-design-system.md` (DS)
- `2026-10-14-crate-v3-implementation-plan.md` (plan)

## Behaviour changes that ship as their own PR to `main`

Each of these changes what an operator, admin, listener or API client sees today, so each lands
alone, with its own tests and release note, not inside a v3 UI PR:

| ID | Change | Plan task |
| --- | --- | --- |
| PD24 | `library_pipeline` only auto-runs checks that do not require confirmation; `shadow_quality_tracks` stops running unattended | 2.17d |
| PD29 | Settings > Enrichment toggles are honoured by the pipeline (`setlistfm` alias, Discogs added) | 3.12c |
| PD32 | Smart EQ holds the last resolved gains while the next track resolves instead of dropping to flat | 4.4 |
| PD44 | Stack actions deny restart of `api`, `traefik`, `postgres`, `redis`, `redis-durable` | 5.5 |
| PD45 | `crate-redis` `maxmemory` lowered below `mem_limit` (for example 448mb); the site test that pins the flags updates with it | 5.4 |
| PD46 | `/api/acquisition/snapshot` and `/stream` require `library.import.manage` or `library.tidal.manage` | 2.9 |

## Product design decisions (PD1–PD54)

| ID | D-ref | Topic | Decision | Consequence / notes | Owner task |
| --- | --- | --- | --- | --- | --- |
| PD1 | [D1] | Chart rule for instruments | Amend the rule: Nivo for statistical charts; instruments (wheel, EQ, crossfade, orbit, lanes, gauges, maps, heatmap, ticket) are hand-built SVG/HTML/Canvas/WebGL | Update root `AGENTS.md` ("Charts use Nivo"), `app/ui/AGENTS.md`, `app/listen/AGENTS.md` and `app/shared/AGENTS.md` (the lines named in PD1) | 0.5 |
| PD2 | [D19] | Merge order of `smart-mix-phase-1` and v3 code | (a) Smart Mix first, whenever it is ready | Gates no migration (`main` is canonical; the unmerged branch renumbers). 4.3 and 4.4 build on the Smart Mix Android EQ path; Camelot moves to `app/crate/camelot.py` in a `[MAIN]` PR | Rollout; 2.9b, 4.3, 4.4 |
| PD3 | [D2] | Listen pill radius | (b) exempt `CratePill` via `data-slot="chip"`; revisit CTAs with (c) after the shell lands | `radius-policy.test.ts` updated | 1.6 |
| PD4 | [D3] | Brand display font in the product | **Bricolage Grotesque (SIL OFL 1.1) in every runtime and on cratemusic.app.** Cabinet Grotesk is dropped everywhere | Cabinet Grotesk's ITF Free Font License forbids distribution through a public repository and making the font available to third parties through an application, so it cannot ship in a public, self-hosted product. The font commit (now `d9df9d51`, formerly `38c7576c`) and the website commits are rewritten so no commit contains Cabinet files. Weights 500/700/800 from the variable opsz file; see "Display font notes" below | 0.0 (done) |
| PD5 | [D32] | Setlist `in_library` | (a) worker match at setlist write plus rematch on library change, local/missing only | (b) federated `remote` later | 4.7a |
| PD6 | [D6] | Admin flat card contrast | (a) keep `#0d0e14`, add hairlines to the borderless cards in one mechanical commit | | 1.0 |
| PD7 | [D7] | Auto-cycling | (a) dropped everywhere | Empty states say so | all screens (4.10b) |
| PD8 | [D8] | `StatNumber` tiers | `xl`, weight 800 on `lg`/`xl`, inline unit | | 1.4 |
| PD9 | [D14] | App display scale | Page titles `clamp(2.25rem, 4vw, 3.75rem)`, entities up to 4.4 rem | | 3.1, Phase 4 screens |
| PD10 | [D4] | Failed and destructive colour | (a) amber plus the word for failed; one `danger` token only on destructive confirm buttons | No green or blue state colours | 1b.1, 1b.6 |
| PD11 | [D5] | Amber value | (a) `state-warning` = `#fbbf24` through the registry | Contrast tests updated | 0.10 |
| PD12 | [D10] | Toasts | Drop `richColors`, shared config, inline feedback first | | 1.11 |
| PD13 | — | Tests on the external disk | (a) CI plus (b) an internal-disk clone for local work | Never rely on the unversioned Vitest timeout patch | 0.2 |
| PD14 | [D18] conflict | Admin sidebar | (a) regroup by site chapters | Resolves the conflict against [D18]; routes and capability gates do not change | 3.2 |
| PD15 | — | Admin pills | (a) chips and CTAs as pills, inputs and selects at 6 px | | 1.6, 1b.2 |
| PD16 | — | Imports | (a) new `/imports` page for staged imports, sidecar on Album | | 5.7a, 5.7b |
| PD17 | — | Enrichment scope | (a) Artist tab only in v3 | | 3.12a, 3.12b |
| PD18 | [D20], [D35] | Genre overrides (G1) | (a) local edits persist in `local_*` + `eq_override` with "reset to core"; core relations hideable through `suppressed` | `Generate with AI` previews (draft) instead of applying | 2.18d, 2.18e, 3.8 |
| PD19 | [D21] | Wheel as default `/genres` view | Yes; tree and grid stay; `GenreNetworkGraph` goes once the locator ships | | 3.7 |
| PD20 | [D21] | Listen wheel in v3 | (a) Admin first, Listen Explore and genre-page locator as phase 2 inside v3 | Component moves to `@crate/ui/domain/genres` in the Listen PR | 5.10 |
| PD21 | [D24] | Count definitions | Read-plane thresholds (artist .70, album .45, union across aliases) everywhere | Admin and Listen list numbers drop; tests updated | 2.18b, 2.18c, 2.18c-go |
| PD22 | — | Signed core release 1.0.1 | Yes, later; runtime de-duplication now | No v3 task | — |
| PD23 | — | Taxonomy invalidations | (b) narrow only after the `genre_taxonomy` scope exists in Listen's URL mapping | | 2.18b, 4.5 |
| PD24 | [D23] (gating) | Health "fix on their own" | (a) gate `library_pipeline` on `requires_confirmation` | **Behaviour change, own PR to `main`.** `shadow_quality_tracks` stops auto-running | 2.17d |
| PD25 | [D34] | Loudness and dynamic range units | (a) `dB` in v3; LUFS only from Smart Mix measurements | | 3.9a, 5.14 |
| PD26 | — | Album readout mood and spectral complexity | Keep `mood_top` (3 entries); drop spectral complexity | | 3.9a |
| PD27 | [D33] | Release timelines for non-Tidal acquisitions | (a) link at import by MusicBrainz release group, then normalised names | | 3.11c |
| PD28 | [D23] conflict | Library Trash claim | (a) factual footer (track files only) in v3; routing destructive deletes through the trash is a separate fix after the trash index | Resolves the conflict against [D23]'s routing clause | 3.6; routing after 2.17e |
| PD29 | [D38] conflict | Enrichment Settings toggles | (a) wire them (`setlistfm` → `setlist` alias, add Discogs) | **Behaviour change, own PR to `main`.** Admins who turned sources off stop getting them. Resolves the conflict against [D38] | 3.12c |
| PD30 | — | Sidecar drift keys | Exclude artist `similar_json`, `tags_json`, `latest_release_date` from the digest | | 3.10a |
| PD31 | — | Artist hero Enrich button | (a) keep `process_new_content(force)`; scoped refresh in the tab | | 3.12b |
| PD32 | [D29] conflict | Smart EQ while the next track loads | (a) hold the last resolved gains | **Behaviour change (audio), own PR to `main`**, `fix(eq)` with a runtime test. Resolves the conflict against [D29] | 4.4 |
| PD33 | [D22] | Governor listener and stream thresholds | Product default 10 listeners / 10 streams (the code value); compose 0/0 documented as an operator override; site copy "default 10/10, configurable" | Gauges show the configured values | 2.16, 3.5, 7.6 |
| PD34 | — | Radio score panel on the site | (a) keep the weights, rename "Camelot 0.05" to "Key 0.05" | Site-only copy fix | 7.6 |
| PD35 | [D39] | Queue lane numeral | Live load; type count in the meta | | 3.4 |
| PD36 | [D36] | Paths `plan_meta` | (a) persist at planning time, only inside the planning task; synchronous routes deprecated | | 4.9a |
| PD37 | — | Mix strip | Show the client crossfade labelled on web/desktop; `rms_envelope` after the Smart Mix merge as a nullable column with a throttled backfill | | 5.13, 5.14 |
| PD38 | [D28] | Crate Connect build flag | **Build Devices in v3 even though Crate Connect is off in production** | Devices stays invisible while `VITE_CRATE_CONNECT_FEATURE_ENABLED` is off. "Review Crate Connect" is the next initiative after v3 | 5.9 |
| PD39 | [D17] | Linux GTK accent | (a) cyan (brand accent) everywhere | | — |
| PD40 | [D16] | Album palette tint | Cyan default, palette opt-in | | 4.11 |
| PD41 | — | Audio-reactive visuals on mobile | Static analysed state; no new endpoint in v3 | | 4.12 |
| PD42 | [D11] | iOS deployment target | **(a) raise to 16.4** | iOS 15 users stay on v2 (release note). Podfile, pbxproj, Tech Stack and Task 7.3 matrix change together | 0.13 |
| PD43 | [D30] | Crate Pulse privacy | Hide the instance heatmap below 3 listeners, server-side | | 2.20, 4.6 |
| PD44 | [D40] | Stack restart policy | Deny `api`, `traefik`, `postgres`, `redis`, `redis-durable` with a reason; stop/start only for other containers | **Behaviour change, own PR to `main`** (denying `traefik` is new) | 5.5 |
| PD45 | — | `crate-redis` `maxmemory` | Lower below `mem_limit` (e.g. 448mb) | **Behaviour change, own PR to `main`** (compose); the site test updates with it | 5.4 |
| PD46 | [D26] | Acquisition snapshot and stream permissions | Require `library.import.manage` or `library.tidal.manage` | **Behaviour change, own PR to `main`**; warn API clients | 2.9 |
| PD47 | — | Unused code | Remove in cleanup commits | | 1.12, 5.14 |
| PD48 | [D25] | Bundle and screenshot checks | Listen and Admin `check:bundle` from Phase 0; Listen screenshots; Admin functional tests only until instruments stabilise | | 0.11, 0.12 |
| PD49 | [D15] | `<html lang>` in Listen | Sync with the active locale | | 4.1 |
| PD50 | — | Spinners | Remove `animate-spin` outside buttons, file by file | | 1b.4 |
| PD51 | — | Ticket header key word | Countdown | | 4.7b |
| PD52 | — | Album energy arc | Skip in v3 | | — |
| PD53 | [D41], [D42] | Light mode, Crate Red and accents; `StatusDot on` hue | (a) every v3 visual works in all appearances without a redesign; `StatusDot on` follows the accent | Definition of done gains "no literal colours; canvas and WebGL re-resolve on appearance change" | 0.11, 7.5 |
| PD54 | [D43] | Stack sampler placement | (a) daemon thread in crate-api behind an owner-checked Redis leader lock, demand-gated | Revisit (b) if Stack actions move to worker tasks | 5.5 |

## Spec-only decisions (no `PDn`)

| D-ref | Topic | Decision | Owner task |
| --- | --- | --- | --- |
| [D9] | Shared motion gate | Yes, in `@crate/ui/lib`; Admin honours the OS setting | 0.7 |
| [D12] | Grain texture | None in the apps | — |
| [D13] | Glass on panels | None; Admin `data-surface` solid by default; Listen keeps the material setting | — |
| [D23] (third clause) | Console scans apply safe fixes | No | — |
| [D27] | Federation in Listen | Provenance tag only, no network view | — |
| [D31] | Display face `tnum` | Resolved by PD4: Bricolage Grotesque has a `tnum` feature, so `tabular-nums` works on the display face; the reserve-width workaround is no longer needed | 1.4 |
| [D35] | Generate with AI | Unsaved draft (`apply=false`) | 2.18e |
| [D37] | Admin Dashboard chapter index | No | — |

## Still open

- Plan Task 0.3 step 4: Diego confirms the per-group estimates, the calendar critical path and the
  release-gate days (Rollout → Milestones).

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
