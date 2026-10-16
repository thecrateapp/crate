# Crate v3 product design

Status: product design, revised 2026-10-15. Canonical clone `/Users/diego/Code/crate-v3`, branch
`feat/crate_v3`. The handover records implementation and QA status; historical analysis is not a
current progress report. Checkpoints through 1R are approved and published (`093dcb1f`).
Task 1b.5 / checkpoint 1S is local on Linux at `#pistas`, awaiting review before publication or
1b.6. The final handover supersedes historical local-only notes. Diego's 1S review explicitly
preserves the current Listen play essence (halo, layers and progress ring) and seek trail,
adapted to V3 with 1–2 px strokes; see DS §5.5.


Scope: Admin (`app/ui`), Listen (`app/listen`, which also ships as Capacitor iOS/Android and inside the
Tauri shell `app/listen-desktop`), shared `@crate/ui` (`app/shared/ui`), and the backend work in
`app/crate` and `app/readplane` that the screens need so the site's visualisations become real
features on real data.

Visual reference: the new site only, `app/web` at the approved git reference, pinned at `feat/website`
`258bbaee` (the commit `crate-v3-analysis/site-visuals.md` read). Site line numbers and ported math
in this document refer to that commit. Each port PR records the site SHA it copied (PR body or test
fixture). Before each internal milestone that ports site math, a deliberate re-sync step reviewed with
Diego moves the pin and lists what changed. No other design branch is a reference.

Relation to other documents:

- `docs/plans/2026-10-14-crate-v3-design-system.md` (the design-system spec, `DS`). The committed
  version (`bce7dd92`) covered the language migration only; the 2026-10-15 revision (Track A
  language, Track B instruments, decision register `[D1]`–`[D43]`, where `[D43]` is PD54) is
  complete. Division of ownership: the spec owns tokens, primitives, panel anatomy, motion and
  accessibility rules; this
  document owns information architecture, per-screen design, data contracts, backend work and
  product decisions. Where the documents name a route, field or file differently, the contract in
  this document is canonical (table below). Section 3.1 restates the spec's layer only as far as
  the screens need it and defers to the spec's values; 3.1.7 lists what the committed version got
  wrong. Decisions here are numbered `PDn` to avoid colliding with the spec's `[Dn]`; section 6 maps
  every `PDn` to its `[Dn]`.
- `docs/plans/2026-10-14-crate-v3-implementation-plan.md` (the plan). Its phases (0–7) and its
  Rollout → Internal milestones (Foundation, Genres, player/EQ, Ops, Health, Stats) define dependencies
  for the joint P0 major; R0 is separately assigned and P1/P2 remain later (5.5).
- Evidence: `docs/plans/crate-v3-analysis/{site-visuals,site-language,v3-state,admin-audit,
listen-audit,genres,backend-admin,backend-listen,platform,coverage}.md`. The mapping cards and
  their verification passes used while writing were working notes and are not in the repository;
  every verified correction is already written into this document and the spec, so neither needs
  another source.
- Tracking: all five canonical v3 docs and `crate-v3-analysis/` are tracked. The reports preserve
  the original investigation evidence; their counts, paths and implementation snapshots are
  historical. Use the handover for current state, not the old evidence baseline.

Canonical names (the plan's Task 0.4 alignment table carries these rows; the spec follows them):

| Item                                  | Use                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin live stream                     | `GET /api/admin/live-stream?surfaces=` (5.3.1), `app/ui/src/contexts/AdminLiveProvider.tsx` plus `app/ui/src/hooks/use-admin-live.ts`; one stream per tab, no per-surface streams, no polling fallbacks |
| Health contract                       | 4.2 (`unattended`, `fix_mode`, `last_scan`, `running.phase`, `trash.albums_quarantined`); one surface `health` carrying the events `health` and `health-scan`                                           |
| Effective EQ inheritance field        | `genrePath` (4.12)                                                                                                                                                                                      |
| Paths metadata column                 | `music_paths.plan_meta` (4.16)                                                                                                                                                                          |
| Setlist helpers                       | `@crate/ui/domain/shows/setlist.ts` with explicit `exports` entries (4.18)                                                                                                                              |
| Admin page header                     | `app/ui/src/components/layout/PageHeading.tsx`                                                                                                                                                          |
| Route map layout math                 | `app/listen/src/components/paths/path-route-layout.ts`                                                                                                                                                  |
| Admin instrument homes                | domain folders (5.4), no `components/viz`; `StatStrip` and `StepRail` in `app/ui/src/components/admin/` until Listen adopts them (3.1.4)                                                                |
| EQ blast radius                       | client-side re-resolve over the wheel snapshot (4.6.1), never a request-time aggregate; tie-break = Python's BFS path order (4.6.1)                                                                     |
| Admin-only genre and enrichment reads | `GET /api/admin/genres/wheel` (4.6.3), `GET /api/admin/artists/{id}/enrichment/sources` (4.5)                                                                                                           |
| Curator override columns (G1)         | `genre_taxonomy_nodes.local_eq_gains`, `eq_override`, `local_name`, `local_description`; core values stay in `eq_gains`, `name`, `description` (4.6.3 item 5)                                           |
| Governor runtime key                  | `crate:runtime:governor` (4.8), like the other `crate:runtime:*` keys                                                                                                                                   |
| Imports surface                       | `GET /api/imports/queue` with `ImportsSurface` (4.3)                                                                                                                                                    |
| Health drill-down                     | `GET /api/admin/health-checks/{check_type}/issues` (4.2)                                                                                                                                                |
| Coalesced refresh due set             | `crate:coalesce:due` (5.3.2)                                                                                                                                                                            |

Conventions:

- Paths are relative to the `crate-v3` worktree.
- `site:` means `app/web/` at the approved pinned SHA, read from its git tree until integration.
- `sm:` means `/Users/diego/Code/Ninja/musicdock/worktrees/smart-mix-phase-1/` (unmerged).
- Priorities: P0 means v3 does not read as one product without it; P1 is a site chapter or spec
  rollout screen; P2 is the rest. Sizes: S (about 2 days, front end), M (a few days, small additive
  backend), L (a week or more, or blocked on a backend precondition).
- Token names are the product names (3.1.1).
- `B1`–`B24` are the platform findings in 2.4. `V1`–`V12` are the violations in `backend-admin.md`
  section 3; `G1`–`G12` are the genre defects in `genres.md` section 3.
- `UNCERTAIN:` marks a fact that was not confirmed on production or needs a measurement.

---

## 1. Goal and principles

Goal: Admin and Listen look and behave like the site's live visualisations. The site's instruments
(health scan, sidecar, release rail, enrichment orbit, genre wheel, track readout, queue lanes,
governor gauges, EQ curve, mix strip, mood map, heatmap, setlist ticket, sound field, devices,
federation, system map) become product features that read real state, and every other screen
adopts the same visual language.

Principles:

1. **The product is an instrument.** A screen is a figure: a mono header over a hairline, display
   numerals for quantities, hairline rows for lists, a dot plus a word for state. No glass, no
   lifted cards, no icon tiles, no decorative gradients. Boxed cards only for objects (ticket, JSON
   sidecar, terminal, toast, dialog). Admin removes almost all icons, including icons beside
   labelled navigation/actions; retain only individually reviewed functional exceptions. Listen
   player/navigation icons are unaffected (Diego, 2026-10-16; DS §1.7, Task 1b.8).
2. **Real data only.** First paint shows the current state from a warmed payload. Motion happens
   only when data changes: a spring re-targets, a new edge draws, a counter counts up on first view,
   a task event moves a cursor. The site's marketing devices are not ported: no auto-cycling
   (`EQ_CYCLE`, genre walk chips, mood cycle, readout cycle), no scripted phase loops, no seeded or
   example data, no simulated thread pool. Empty, warming and error states show the real state,
   never a demo.
3. **Honest labels.** A label claims only what the data proves. Loudness is `dB` until it is
   measured as LUFS (Smart Mix profiles); the mix strip never says beatmatch, sync, lock, handoff or
   automix; automatic repairs read "fixes in next pipeline", not "fixed"; enrichment reads "last
   fetch", not "cached"; count definitions are shared between Admin and Listen.
4. **Site parity at app scale.** Same tokens, panel anatomy, chip, meter, readout, motion curves and
   accessibility contract. Macro scale adapts to a shell: page titles are capped (3.1.2), the site's
   `vh` rhythm becomes fixed 32/48/64 px steps.
5. **Performance rules are design constraints.**
   - The request path reads a precomputed payload by key: `ui_snapshots`, `ops_runtime_state`, a
     cache entry or a primary-key read. Heavy work runs in workers, the projector or deduplicated
     tasks.
   - Never `COUNT/SUM/AVG` over `library_tracks` in a request; batch with `ANY(:ids)`; one CTE per
     surface; never rebuild a snapshot in a request (no `?fresh=1` builds).
   - One stream per concern per tab. A visual never opens its own stream; the page or a provider
     owns it.
   - Per-frame values (springs, playhead, spectrum, `currentTime`, `isPlaying`) live in refs, never
     in state or effect dependencies.
   - Every visual sits behind a lazy boundary. The drift budgets in `scripts/design-system/` and
     both apps' bundle ceilings (PD48) stay green.
6. **Accessibility.**
   - Each figure carries an `aria-label` sentence built from the real numbers.
   - Every SVG, canvas or WebGL layer has an accessible HTML equivalent (list, table or readout).
   - Interactive marks are keyboard reachable with a visible focus ring.
   - Informative text never goes below `text-text-subtle` (fg-3, 4.99:1 on the canvas, DS 1.1.3);
     on popovers use `text-text-muted`.
   - State is never colour alone (text, filled vs ring dot, dashed vs solid).
   - Every visual gets a `forced-colors` pass, which the site lacks.
   - Reduced motion renders the final state; interaction still works.
7. **One focal instrument per screen.** Secondary instruments sit below it in the panel rhythm and
   never compete above the fold.
8. **Placement and conventions.**
   - A component goes into `@crate/ui` only when both apps render it in the same change. Otherwise it
     stays in the app, math included.
   - Admin uses `sonner` and English copy; almost all icons are retired, with `lucide-react`
     reserved for reviewed functional exceptions (DS §1.7). Listen uses `@crate/ui/icons`, `notify`
     and i18n in 7 catalogs (en, es, fr, de, it, ca, eu).
   - Shared visuals take data, copy, icons and callbacks as props; no `useApi`, SSE, i18n or player
     context inside `@crate/ui`.

---

## 2. Status today

### 2.1 Branch and execution state

The canonical working clone is `/Users/diego/Code/crate-v3`, branch `feat/crate_v3`; assigned agents
use isolated internal-disk worktrees. Product changes remain on the integration branch until the
joint major. Smart Mix merges first, then the integrator rebases v3 and integrates website with
approval. No current commit count or stale remote-distance estimate is an execution instruction.

### 2.2 Implemented foundation versus pending QA

The handover records 0.0, 0.1 steps 1–2, 0.2–0.10, 0.12 and 0.13 as locally implemented. That
includes Bricolage, token/drift corrections, EQ morph, ticket notches, contrast coverage, bundle
checks and the iOS target. CI, screenshots and device QA remain separate and are not declared green.

Tasks 1.2–1.4 have local implementation/focused results reported under Checkpoint 1A; integration,
full-suite status and Diego review remain pending in the handover.
Runtime theme retirement (1.13 / Checkpoint 1M) is implemented locally for review. Listen and
Admin share one identity, tokens, primitives, recipes and interaction rules; only domain
components/data/workflows differ. Legacy duplicates converge through block 1b/page migrations.
Other instruments/backend contracts
remain pending unless the integrator records a verified result after the Smart Mix rebase.

### 2.3 Historical findings and remaining gates

`crate-v3-analysis/v3-state.md` records the original four-commit audit: static EQ/handle mismatch,
painted ticket notches, drift violations and external-disk Vitest timeouts. Do not reapply fixes
from that snapshot. Refer to task diffs and the handover for the current state.

Checkpoint 0 remains open: 0.11 Linux CI baselines/reviews, 0.15 runtime qualification and relevant
reviews; 0.14 production graph measurement may wait until the wheel and needs explicit assignment.
The obsolete variant's contrast exception is removed with 1.13, not converted into another theme
requirement. Semantic Crate v3 AA, keyboard, forced-colors and reduced motion remain mandatory.

Bricolage is the accepted OFL face, with font history rewritten. The documents do not grant push,
PR, commit, deployment or production access permission.

### 2.4 Platform findings that block live visuals

All pre-existing on `main`. The fixes are in 5.1; IDs are reused across the document.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                                                                                       | Impact                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `list_domain_events` reads id `0` first; with an empty PEL Redis returns `[[stream, []]]`, which is truthy, so `>` is never read. The verification pass reproduced it on redis 7 with the repo's redis-py                                                                                                                                                                                                     | `app/crate/db/domain_events.py:243-255`                                                                     | The projector has not consumed new domain events since `1c371d6e` (2026-04-27). Projector-warmed snapshots (ops, home, stats) refresh only through read-through or tasks. UNCERTAIN: confirm on production with `XINFO GROUPS crate:domain_events` |
| B2  | `ops/dashboard` rebuilds inside the request after 60 s or on `?fresh=1`, with `COUNT/SUM/AVG` over `library_tracks`. Admin fires `fresh=1` on focus, visibility and online                                                                                                                                                                                                                                    | `db/ui_snapshot_building.py:14`, `OpsSnapshotContext.tsx:364-376`                                           | Rule violation (V3); thundering herd                                                                                                                                                                                                               |
| B3  | `/api/admin/metrics/system` and `/dashboard` run `COUNT(*)` on `library_tracks` and evaluate the governor in the API (50 ms sleep, two scans, API env without the governor variables)                                                                                                                                                                                                                         | `api/admin_metrics.py:173,199`                                                                              | Rule violation (V1, V2); wrong thresholds shown                                                                                                                                                                                                    |
| B4  | SSE generators read the DB synchronously on the event loop, once per message per client                                                                                                                                                                                                                                                                                                                       | `api/admin_ops.py:44`, `api/management.py:191`, `api/events.py:92`                                          | V4                                                                                                                                                                                                                                                 |
| B5  | `/api/insights` runs 10+ `read_scope()` calls with `COUNT/SUM` over `library_tracks` per request                                                                                                                                                                                                                                                                                                              | `api/analytics.py`                                                                                          | Blocks Insights and Discover                                                                                                                                                                                                                       |
| B6  | Mood counts run `COUNT(*) FILTER` x8 over the global catalog join on every cache miss; mood playback runs `ORDER BY RANDOM()` on every click                                                                                                                                                                                                                                                                  | `api/browse_media.py:1680`, `db/queries/browse_media_mood.py`                                               | Blocks MoodMap                                                                                                                                                                                                                                     |
| B7  | Sound Intelligence health scans `library_tracks` per request (G4); catalog and explore genre fallbacks run the global CTE in the request (G5)                                                                                                                                                                                                                                                                 | `db/queries/sound_intelligence.py:21-79`, `api/catalog.py:221`, `api/browse.py:54`                          | Blocks the genre pages                                                                                                                                                                                                                             |
| B8  | Effective EQ opens up to 6 `read_scope()` calls per track change (8 on the catalog route Listen uses)                                                                                                                                                                                                                                                                                                         | `crate/equalizer.py`, `db/repositories/equalizer_presets.py`                                                | Hot path, every Smart EQ listener                                                                                                                                                                                                                  |
| B9  | `/api/acquisition/stream` rebuilds per client every 3 s with a synchronous slskd call (up to 10 s) in the async generator; `/new-releases/stream` polls every 5 s; `/snapshot` and `/stream` require only authentication, so any Listen user can read Soulseek usernames and paths                                                                                                                            | `api/acquisition.py:129-176,283-291,343`                                                                    | Perf and security                                                                                                                                                                                                                                  |
| B10 | `/tasks` opens one `EventSource` per running and pending task                                                                                                                                                                                                                                                                                                                                                 | `pages/Tasks.tsx` (`ActiveTaskCard`)                                                                        | N+2 streams per tab                                                                                                                                                                                                                                |
| B11 | The projector maps any `federation.*` scope to an `ops/dashboard` rebuild, so every remote stream event rebuilds it                                                                                                                                                                                                                                                                                           | `projector.py:231-238`                                                                                      | Load grows with remote playback                                                                                                                                                                                                                    |
| B12 | `StatsDashboardResponse` does not declare `snapshot` and `SnapshotMetadataResponse` has no `pending`, so FastAPI drops them; the cold payload also renders the empty state                                                                                                                                                                                                                                    | `api/schemas/me.py:791`, `api/schemas/common.py:32`, `use-stats-page-controller.ts`                         | Pending polling is dead in production                                                                                                                                                                                                              |
| B13 | A health check that raises still resolves all its open issues as `fixed` and records 0 issues; `health_check` and `library_pipeline` never publish the health signal                                                                                                                                                                                                                                          | `health_check.py:244-256`, `db/health.py:168-188`, `worker_handlers/management.py:98,589`                   | The Health instrument would lie                                                                                                                                                                                                                    |
| B14 | Federation approve posts `node_uid` where the API expects `pairing_uid`, so it always returns 404; Approve is also offered on outbound pairings                                                                                                                                                                                                                                                               | `pages/federation/PeersPanel.tsx:56`, `api/admin_federation.py:317`                                         | Pairing approval broken in Admin                                                                                                                                                                                                                   |
| B15 | `/api/radio/next`, `/feedback` and `DELETE /session` do not check the session owner                                                                                                                                                                                                                                                                                                                           | `api/radio.py`                                                                                              | Security                                                                                                                                                                                                                                           |
| B16 | `/api/events/task/{id}` requires only authentication; any user with a task id reads its events                                                                                                                                                                                                                                                                                                                | `api/events.py`                                                                                             | Security; matters for task-driven Paths                                                                                                                                                                                                            |
| B17 | `/api/admin/global-catalog/status` runs 4 `COUNT(*)`, a `COUNT(DISTINCT)` and band counts per request; the users presence query joins every play event through an `OR` join                                                                                                                                                                                                                                   | `db/queries/admin_global_catalog.py:15-104`, `db/queries/auth_presence.py:48-82`                            | Rule violations                                                                                                                                                                                                                                    |
| B18 | `POST /api/paths`, `/regenerate` and `/preview` plan synchronously in the request (up to 100 KNN queries, graph loads, an LLM call)                                                                                                                                                                                                                                                                           | `api/paths.py:49`, `db/paths_llm_refinement.py`                                                             | Do not promote Regenerate until planning is a task                                                                                                                                                                                                 |
| B19 | The ops snapshot persists `recent_events` with `payload_json` (user ids, titles) and `/api/admin/ops-stream` sends it raw                                                                                                                                                                                                                                                                                     | `db/domain_events.py` (`_decode_stream_messages`)                                                           | Privacy                                                                                                                                                                                                                                            |
| B20 | `Download.tsx` reads the Last.fm API key from the API and calls Last.fm from the browser                                                                                                                                                                                                                                                                                                                      | `pages/Download.tsx`                                                                                        | Security                                                                                                                                                                                                                                           |
| B21 | Crate Connect presence is written only on socket connect; the WS heartbeat refreshes nothing, so REST `active` is wrong after 90 s and cross-worker `connected_instances` drop after 120 s                                                                                                                                                                                                                    | `api/connect_ws.py`                                                                                         | Devices would lie                                                                                                                                                                                                                                  |
| B22 | Setlist reads: one cache read per artist per request; the process L1 keeps `setlistfm:*` for days and no invalidation clears it                                                                                                                                                                                                                                                                               | `api/me.py:423`, `db/home_builder_upcoming_feed.py:42`, `db/cache_store.py`                                 | N+1 and stale reads                                                                                                                                                                                                                                |
| B23 | The genre seeder overwrites curator edits to the 61 core genres on every boot (G1); clearing a core preset does nothing in Python but inherits in Go (G2)                                                                                                                                                                                                                                                     | `db/jobs/genre_taxonomy.py:219-252`, `genre_taxonomy.py:910-919`, `readplane/internal/catalog/genre.go:447` | Wheel editing would lie                                                                                                                                                                                                                            |
| B24 | Client render loops: `useAudioVisualizer` pushes 1024/2048-float arrays into state at about 20 fps; lyrics lists subscribe to progress at list level; `useCrossfadeProgress` runs its own rAF `setState` loop per mounted instance, and the bar controller (`usePlayerBarController`), `ExtendedPlayer` and `FullscreenPlayer` each mount one, so up to three per-frame loops run together during a crossfade | `hooks/use-audio-visualizer.ts:44-72`, `LyricsPanel.tsx:41`, `hooks/use-crossfade-progress.ts`              | Player jank                                                                                                                                                                                                                                        |

---

## 3. Experience map

### 3.1 Shared anatomy

#### 3.1.1 Tokens

The token layer from the spec stays. Mapping and remaining gaps:

| Site          | Product                                                                                                                                                                                                                | Default dark value              | Use                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bg`        | `surface-app`, `color-background`                                                                                                                                                                                      | `#0a0a0f`                       | canvas, text on accent fills                                                                                                                                                                                                      |
| `--fg`        | `text-text-primary`                                                                                                                                                                                                    | `#f1f5f9`                       | primary text, numerals                                                                                                                                                                                                            |
| `--fg-2`      | `text-text-muted`                                                                                                                                                                                                      | `#999ca0`                       | body secondary, idle chips, readouts on popovers                                                                                                                                                                                  |
| `--fg-3`      | `text-text-subtle`                                                                                                                                                                                                     | `#7e8084`                       | mono labels, meta, axes                                                                                                                                                                                                           |
| `--line`      | `border-border-quiet`                                                                                                                                                                                                  | `rgba(241,245,249,.1)`          | panel top rule, borders                                                                                                                                                                                                           |
| row divider   | `border-border-quiet-subtle`                                                                                                                                                                                           | `rgba(241,245,249,.06)`         | rows inside lists                                                                                                                                                                                                                 |
| `--cyan`      | `accent-action`                                                                                                                                                                                                        | `#06b6d4`                       | fills, CTA, play disc, glows                                                                                                                                                                                                      |
| `--cyan-hi`   | `accent-action-hi`                                                                                                                                                                                                     | `#67e8f9`                       | strokes, key words, active chips                                                                                                                                                                                                  |
| `--amber`     | `state-warning`                                                                                                                                                                                                        | `#f59e0b` today, site `#fbbf24` | status only (PD11)                                                                                                                                                                                                                |
| `#0d0e14`     | new alias `surface-object` (today only legacy `bg-card`)                                                                                                                                                               | `#0d0e14`                       | objects: ticket, JSON, terminal, toast, dialog, tooltip                                                                                                                                                                           |
| `#0b1d24`     | new `--surface-accent-active` (`bg-`/`fill-surface-accent-active`, DS 1.9.4): `color-mix(in srgb, var(--accent-action) 11%, var(--surface-canvas))`                                                                    | about `#0a1d25`                 | active node fill (wheel pinned node, system map). Added in its first consumer's commit (GenreWheel pinned node, plan 3.7) with the definition ceiling raised by 1 and the registry and contrast tests in the same commit (DS 6.2) |
| alpha ladders | opacity modifiers on tokens: `bg-accent-action/4` (hover), `/8` (active row wash), `/14` (halo), `border-accent-action-hi/40` (chip hover). Tailwind 4 compiles them to `color-mix()`, which sets the iOS floor (PD42) |                                 | no new tokens                                                                                                                                                                                                                     |

Crate v3 is the only visual identity: fixed brand accent, surfaces, radii and typography. No theme,
skin, mode or accent selectors remain in the target product (PD53). Visuals use semantic tokens:
SVG uses `currentColor` and token classes; canvas/WebGL read tokens on mount and restoration.
The current registry/generator stays in place until the full migration in plan 1.13. Motion and
accessibility preferences remain supported independently.

#### 3.1.2 Type tiers

The values are DS 1.2.2 (sizes and tokens) and DS 1.2.3 (tracking); this table only maps them to
the screens. If the two ever differ, the spec wins.

| Tier         | Recipe                                                                                                                                | Use                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Page title   | `text-display-page`: `font-display` 800, `leading-display`, -0.045em, `clamp(2.25rem, 4vw, 3.75rem)`, `text-balance`                  | every page header                                                                                     |
| Entity title | `text-display-entity`: same, `clamp(2.6rem, 5vw, 4.4rem)`, two lines max with ellipsis                                                | artist, album, playlist, genre, profile, ticket artist                                                |
| Readout word | `text-display-readout`: 800, `clamp(2.2rem, 4.2cqi, 3.8rem)`, -0.045em, one line                                                      | track readout title, EQ preset word                                                                   |
| Numeral XL   | `StatNumber size="xl"`: 800, `leading-numeral` (.85), -0.05em, `clamp(3.2rem, 8.4cqi, 8.4rem)`                                        | stats counters, release clock                                                                         |
| Numeral L    | 800, `clamp(2.8rem, 5.6cqi, 5.4rem)`, .85, -0.05em                                                                                    | health totals, library scale                                                                          |
| Numeral M    | 700, `clamp(1.6rem, 2.6cqi, 2.4rem)`, 1, -0.035em                                                                                     | readout figures, lane counts                                                                          |
| Numeral S    | 700, `clamp(1.1rem, 2.1cqi, 1.9rem)`, 1, -0.03em                                                                                      | gauges, EQ band values, legend values                                                                 |
| Sub-head     | `text-subhead`: Bricolage 700, `clamp(1.25rem, 1.7vw, 1.6rem)`, 1.1, -0.025em (`tracking-tight`)                                      | section and rail titles                                                                               |
| Lede         | Bricolage 500, 1.15–1.5rem, -0.025em, `text-text-muted`, 36ch                                                                         | page and bio ledes                                                                                    |
| Label        | `MonoLabel`: JetBrains Mono 11 px, .14em, uppercase, `text-text-subtle`, tabular; key word in `accent-action-hi`; parts joined by `·` | every panel header, meta line                                                                         |
| Eyebrow      | `text-eyebrow`: mono 11.5 px, .16em; `<accent>03</accent> / Acquisition`                                                              | page headers backing a site chapter                                                                   |
| Micro mono   | `text-label` (11 px) and `text-badge` (10 px); smaller sizes only through instrument recipe classes                                   | units, axes, badges. No arbitrary `text-[Npx]` in shared or Listen code (design-token policy budgets) |

- Numeral `cqi` utilities use guarded rem fallbacks inside `@supports not (font-size: 1cqi)`
  alongside `@theme inline` clamps, verified after Tailwind compilation and LightningCSS
  minification (Task 1.4). Consecutive rem/clamp declarations are pruned by the minifier. Other
  display/readout tiers need the same production-output verification when their later tasks land.
- Bricolage Grotesque only at 20 px and up for titles and 16 px and up for numerals. Exception (DS
  1.2.1): player bar and mini-player track titles at 15–16 px, weight 700 (4.11). The variable
  `opsz` axis picks the display cut at large sizes and the text cut at 15–16 px
  (`font-optical-sizing: auto`, never set by hand).
- Non-Latin names fall back per glyph, so no layout assumes display-face metrics.
- Bricolage has `tnum` ([D31], closed by PD4), so `tabular-nums` applies to display numerals and
  counting numerals need no reserved width.

#### 3.1.3 Motion

Values are DS 1.8 (easings 1.8.1, durations 1.8.2, entrances 1.8.3, data motion 1.8.4); if they
ever differ, the spec wins.

| Rule                      | Value                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Colour and state changes  | 0.3 s `ease-snap`                                                                                                                                                                                                                                                                                                                                                  |
| Line and path drawing     | `pathLength=1`, dashoffset 1 → 0, `ease-out-expo` (the site's `--ease-out`); hairlines 500–600 ms, long draws 900 ms, the Paths route 1.2 s                                                                                                                                                                                                                        |
| Entrances                 | panel: opacity plus a 12 px rise, 500–700 ms, `ease-spring-snappy` (longhand) with an `ease-out-expo` fallback; page transition: opacity plus 8 px, 350 ms `ease-out-expo`; list stagger 70 ms (setlist rows 55 ms, devices 140 ms), capped at 8 items (20 for a setlist). Once per mount, never on refetch. No `filter: blur` on Android WebView or WebKitGTK     |
| CSS springs               | `ease-spring-snappy` / `ease-spring-smooth` only through longhand properties, behind `@supports (transition-timing-function: linear(0, 1))` with an `ease-snap` fallback. Never inside `transition:` or `animation:` shorthands (iOS < 17.2, WebView2 111, WebKitGTK 2.40, macOS 11 drop the whole declaration). No final state may depend on an animation running |
| Data springs              | JS `stepSpring` (semi-implicit Euler), `dt` clamped to 50 ms (1/60 on the first frame), stop when `abs(delta)` and `abs(velocity)` < 0.01. Defaults 170/18; EQ 120/14; genre mini EQ 140/15; readout `90 + (i % 7) * 8` / 13                                                                                                                                       |
| Following a moving target | `x += (target - x) * (1 - exp(-dt * 7))`                                                                                                                                                                                                                                                                                                                           |
| Text swap                 | scramble without I/O/Q, settles left to right, 320–1100 ms, one per element; the scrambled node is `aria-hidden` and a sibling sr-only node holds the final text                                                                                                                                                                                                   |
| Count-up                  | ease-out cubic over 1600 ms, from the previous value, only on first view or a real change                                                                                                                                                                                                                                                                          |
| Loops                     | one rAF per visual, running only while intersecting, `document.visibilityState === "visible"`, motion allowed and something is unsettled (DS 3.8 rule 3). A loop stops once every spring and position settles, even while a task keeps running. The Tauri window disables background throttling, so loops must stop themselves                                     |
| Elapsed time              | running clocks (`0:42` on a health row, a running chip's elapsed slot) come from one 1 s timer per visual that writes a text node when the formatted string changes; never from a rAF                                                                                                                                                                              |
| Reduced motion            | final state at once; no springs, scramble, stagger or count-up; interaction unchanged. Gate: Listen `isMotionBlocked()` (`app/listen/src/lib/motion-availability.ts`); shared code uses the new `@crate/ui/lib/motion-gate.ts` (media query, `data-crate-motion`, hidden document); Admin has only the media query                                                 |

#### 3.1.4 Primitives

| Primitive                                                             | Today                                                                                                                                                                                                                                                    | v3 change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Home                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MonoLabel`                                                           | exists                                                                                                                                                                                                                                                   | pass through `id`, `role`, `aria-*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `@crate/ui/primitives`                                                                                                                                                                                        |
| `StatusDot`                                                           | `on` / `off` / `warn`                                                                                                                                                                                                                                    | add a motion-gated `pulse` for warming; no other tones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | same                                                                                                                                                                                                          |
| `StatNumber`                                                          | `sm/md/lg`, 700, label below                                                                                                                                                                                                                             | `xl` tier; weight 800 on `lg`/`xl`; inline mono `unit` slot; `forwardRef`; value node writable by ref                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | same; visual check in both apps                                                                                                                                                                               |
| `HairlineList` / `HairlineRow`                                        | Listen only; children in `span.truncate`                                                                                                                                                                                                                 | `as`/`href`/`onSelect`, pass-through `id`/`aria-*`, `active` state (2 px `accent-action-hi` bar plus `from-accent-action/8` wash). Admin adopts it in Health                                                                                                                                                                                                                                                                                                                                                                                                                                                           | same                                                                                                                                                                                                          |
| `CratePill`                                                           | about 24 px, always `aria-pressed`                                                                                                                                                                                                                       | `min-h-8`; action variant without `aria-pressed`; Listen radius per PD3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `primitives/CrateBadge.tsx`                                                                                                                                                                                   |
| `InstrumentPanel`                                                     | new                                                                                                                                                                                                                                                      | `<figure>` with `pt-5.5 border-t border-border-quiet` and `@container` (`container-type: inline-size`), header row of two `MonoLabel`s, right status slot (`aria-live="polite"`), required `aria-label` sentence (DS 2.3)                                                                                                                                                                                                                                                                                                                                                                                              | `@crate/ui/primitives`                                                                                                                                                                                        |
| `Meter`                                                               | new                                                                                                                                                                                                                                                      | 2–4 px track, `scaleX(var(--v))` fill in `accent-action-hi`, optional limit tick, `over` state (`state-warning` plus label text change), `role="meter"`, values written by ref                                                                                                                                                                                                                                                                                                                                                                                                                                         | same                                                                                                                                                                                                          |
| `Readout`                                                             | new                                                                                                                                                                                                                                                      | one mono line with reserved width plus a separate sr-only live node (hover never announces)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | same                                                                                                                                                                                                          |
| `ProgressHairline`                                                    | new                                                                                                                                                                                                                                                      | determinate `--p` or indeterminate (site Roadmap bar), visibility-gated, static under reduced motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | same                                                                                                                                                                                                          |
| `surface-object`                                                      | missing                                                                                                                                                                                                                                                  | semantic alias generated from the registry, referenced in the same change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `@crate/ui/tokens`                                                                                                                                                                                            |
| Motion gate, `eq-curve`, `stepSpring`, `useEqMorph`, `useVisibleLoop` | Listen-only gate                                                                                                                                                                                                                                         | the `EqBands` morph fix (plan 0.7) adds only `@crate/ui/lib/motion-gate.ts` and `@crate/ui/lib/eq-curve.ts`. `stepSpring` and `useEqMorph` stay in `@crate/ui/domain/player/eq-morph.ts` (not exported) until an app imports them directly, because `export-usage-policy.test.ts` checks every `lib/*` export and only follows `export … from`: the spring helpers move to `@crate/ui/lib/spring.ts` in whichever of plan 3.5 (GovernorGauges) or 4.3 (EQ glyph) lands first, and `useEqMorph` to `@crate/ui/lib/use-eq-morph.ts` in 4.3. `useVisibleLoop` is created with its first importer (`QueueLanes`, plan 3.4) | `@crate/ui/lib` once imported by an app                                                                                                                                                                       |
| Scramble                                                              | none                                                                                                                                                                                                                                                     | Admin-local first; moves to `@crate/ui/lib/scramble.ts` in the first Listen consumer (plan 4.5, the EQ trail word), before Stats (4.6) and the mood map (4.8b) use it                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `app/ui/src/lib/motion/scramble.ts` (plan 3.1), then `@crate/ui/lib/scramble.ts`                                                                                                                              |
| Count-up                                                              | `CountUpNumber` in Listen                                                                                                                                                                                                                                | Listen-local until Admin calls it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | app `lib/motion`                                                                                                                                                                                              |
| Toaster config                                                        | two `richColors` toasters                                                                                                                                                                                                                                | shared class names and durations, no `richColors`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `@crate/ui/lib/toaster-config.ts`                                                                                                                                                                             |
| `PageHeading`                                                         | `OpsPageHero` plus 7 ad-hoc `h1` recipes                                                                                                                                                                                                                 | Admin-local page header                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `app/ui/src/components/layout/PageHeading.tsx`                                                                                                                                                                |
| `PageHeader`                                                          | Listen, shared                                                                                                                                                                                                                                           | restyle in place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `@crate/ui/domain/navigation`                                                                                                                                                                                 |
| `StatStrip`                                                           | `OpsStatTile`, Settings `StatTile`, Timeline `StatCard`                                                                                                                                                                                                  | 2–6 `StatNumber`s on hairlines (DS 2.5); also the legend recipe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `app/ui/src/components/admin/StatStrip.tsx`; moves to `@crate/ui/primitives` in the Listen Library change (4.20), deleting the Admin copy                                                                     |
| `StepRail`                                                            | ad-hoc rails                                                                                                                                                                                                                                             | stages with a `--p` progress, vertical under 900 px container width                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `app/ui/src/components/admin/StepRail.tsx`; moves to `@crate/ui/domain/tasks/StepRail.tsx` (`app/shared/ui/domain/tasks/StepRail.tsx`) in the Listen Upload change (4.22, plan 6.15), deleting the Admin copy |
| `nivoTheme`                                                           | 3 `NIVO_THEME` constants (`AudioProfileCard.tsx:30`, `ArtistStats.tsx:9`, `Insights.tsx:67`) plus 6 inline `theme={{…}}` objects (`TrackTable.tsx:647`, `ArtistStats.tsx:237`, `Dashboard.tsx:1080`, `:1124`, `:1177`, `SystemHealth.tsx:483`), 9 in all | one token-resolved chart configuration per app for the single Crate v3 identity, `animate={!reducedMotion}`; the nivo-theme task replaces all 9                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | per app                                                                                                                                                                                                       |

GenrePill remains the specialised genre component, including its percentage-bearing form. Its
planned chip alignment preserves explicit `percent` or rounded `share × 100`, source tooltip,
missing/0/100% cases, ordering and independent open/remove actions. It is not replaced by a generic
chip and does not migrate or renormalise backend profiles. DS §2.2 and implementation Task 1.6a
make this contract explicit; Diego approved the v3 visual treatment at Checkpoint 1C on 2026-10-15.

There is no fifth shared legend primitive: a legend is an inline `dl` inside each instrument
(swatch or `MonoLabel` key, values as `StatNumber size="sm"`) until two apps share one. The two
moves above are moves of existing blocks, not new primitives, and happen in the change where Listen
first renders them.

`.ts` modules outside `@crate/ui/lib` need explicit `exports` and `publishConfig.exports` entries.
Delete the dead `app/shared/ui/domain/stats/Ops*` and `app/shared/ui/domain/shows/ShowCard.tsx`
(update the policy allowlists and `app/shared/AGENTS.md:49` in the same change).

#### 3.1.5 Recipes

Details are in `coverage.md` section 2 and `site-language.md` section 2; the rules:

| Recipe               | Rule                                                                                                                                                                                                                                                                                                                                                                            | Applies to                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Page header          | optional mono back link; eyebrow `MonoLabel`; display title (3.1.2); optional lede; meta as a `MonoLabel` list or a `StatStrip` of 2–4 numerals; actions on the title baseline (desktop) or wrapped below (mobile); no card, glow or icon tile                                                                                                                                  | every page                                                                                                                           |
| Panel and section    | data sections use `InstrumentPanel`; content rails use the restyled shared `SectionHeader` (mono eyebrow, Bricolage 700 title, mono count, "See all →" underline link with a 44 px hit area)                                                                                                                                                                                    | all panels, Listen rails                                                                                                             |
| Hairline list        | 9 px rows, `border-border-quiet-subtle` dividers, list starts on a `border-border-quiet` rule, mono index `01`, meta in fixed `ch` columns, hover `bg-accent-action/4`, active bar                                                                                                                                                                                              | lists                                                                                                                                |
| Table                | semantic `<table>` when 3+ comparable columns or sorting; mono uppercase `thead`; no zebra or cell borders; numbers right-aligned tabular; status cell = dot plus word; `aria-sort`; columns drop at 1000 and 760 px                                                                                                                                                            | Users, Roles, history, routes, streams                                                                                               |
| Track row            | index (play glyph on hover/focus) / title over artist / mono `124 · 8A` meta on desktop / tabular duration (never re-rendered per tick) / actions; playing row gets the active bar and `accent-action-hi` title; quality and explicit flags as mono tags; remote rows carry `via <node>`                                                                                        | every track list                                                                                                                     |
| Media grid           | square covers, no shadow, 1 px inset hairline; title sans 14/500; mono meta; hover tints hairline and title, no lift; 40 px play disc overlay; placeholder `accent-action/16` with mono initials                                                                                                                                                                                | grids and rails                                                                                                                      |
| Forms                | `MonoLabel` above; 40 px fields (44 on coarse pointers); focus 2 px flush `focus-ring` outline (the existing Listen search ring); errors as `StatusDot warn` plus text, `aria-invalid`, never a toast; selects of 7 or fewer options become chip groups                                                                                                                         | forms                                                                                                                                |
| Buttons              | primary: pill with `accent-action` fill (Listen radius per PD3); secondary: `CratePill` action variant; round play disc 40 / 56–64 px; icon buttons ghost, 32 px (44 coarse); destructive per PD10                                                                                                                                                                              | everywhere                                                                                                                           |
| Tabs                 | `role="tablist"`, mono 11.5 px .14em text, 2 px underline; selected tab in the URL: `?tab=` by default (the plan 1b.3 helper), a path segment where the route already has one (Listen `/collection/:section`), `?section=` for Settings sections, `?queue=` for Tasks                                                                                                           | Admin Artist, Federation, Download, Settings; Listen Library (already `?tab=` on `/library` and `/collection/:section`), player tabs |
| Dialogs and popovers | object surface, hairline, `rounded-panel`; overlay canvas at .72 without blur; `MonoLabel` eyebrow plus Bricolage 700 title; confirm dialogs carry a mono consequence line (`12 files · 1.4 GB · moves to Library Trash`) and typed confirmation for wipe and rebuild; Admin moves to the shared `ConfirmDialog`                                                                | all overlays                                                                                                                         |
| Toasts               | inline feedback first; toast only when the result outlives the control; object card, `MonoLabel` type word (`SAVED`, `QUEUED` in `accent-action-hi`; `FAILED` in `state-warning`); Admin task toasts link `/tasks?task=`                                                                                                                                                        | both apps                                                                                                                            |
| States               | loading keeps the final geometry with `—` values (no shimmer, no spinner inside instruments); empty = one readout, one sentence, at most one CTA; inline error keeps the last data, marks it stale, offers Retry; warming = `MonoLabel BUILDING` plus pulsing warn dot, driven by push or task events; offline (Listen) = mono `OFFLINE` tag and disabled actions with a reason | every surface                                                                                                                        |
| Progress             | 2 px hairline, `role="progressbar"`, mono `07 / 17` or `42%`; fixed-phase tasks use the step rail                                                                                                                                                                                                                                                                               | task progress                                                                                                                        |
| Status colour        | 3.1.6                                                                                                                                                                                                                                                                                                                                                                           | everywhere                                                                                                                           |
| Numbers              | `tabular-nums`; real minus `−`; `·` separators; `→` for flows; lower-case mono units after the numeral; `~` for approximations; `m:ss` / `h:mm:ss`; relative time in mono with absolute time in `title`; countdowns `T−12 d`; zero-padded indices                                                                                                                               | everywhere                                                                                                                           |
| Charts (Nivo)        | hairline grid, mono ticks in `text-text-subtle`, `accent-action-hi` series and crosshair, object-card tooltips, area fill ≤ .08; pies become a proportional hairline bar with a mono legend; radars become feature bars                                                                                                                                                         | Admin Insights, System, Dashboard diagnostics, ArtistStats                                                                           |
| Focus                | `:focus-visible` 2 px flush `focus-ring` outline at offset 0 (-2 inset on edge-to-edge rows), matching the existing Listen search ring, including its 500 ms on/off fade and expansion with `cubic-bezier(0.22, 1.18, 0.36, 1)` and no delay (immediate under reduced motion/forced colours); roving tabindex in chip groups and node sets; skip link in both shells            | everywhere                                                                                                                           |
| Remote provenance    | mono `via north.crate` tag with a ring dot when stale or unhealthy                                                                                                                                                                                                                                                                                                              | Listen rows and search, Admin global catalog                                                                                         |

#### 3.1.6 Status colour policy

| Meaning                                                            | Visual                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| ok, done, active, on, in library                                   | `StatusDot on` and `accent-action-hi`                     |
| waiting, needs confirmation, deferred, degraded, stale, over limit | `StatusDot warn` and `state-warning`                      |
| off, never run, missing, idle                                      | `StatusDot off` (ring) and `text-text-subtle`             |
| failed                                                             | warn dot plus the word "failed" (PD10)                    |
| severity, risk, log level                                          | 3-segment grey meter plus a word; never red/orange/yellow |
| destructive action                                                 | PD10                                                      |

Decorative state colours go: Listen `MOOD_COLORS`, Info tab `tone="warm"`, profile badge tones
(`pages/user-profile-model.ts:47`), affinity band tint; Admin's 398 emerald/green/red/rose, about
288 amber/yellow/orange and about 48 violet/fuchsia/blue/sky classes; both toasters' `richColors`.
Whether `StatusDot on` follows a non-cyan accent is PD53.

#### 3.1.7 Corrections to the committed design-system spec

The 2026-10-15 revision of the spec already applies these; they are listed for the committed
version (`bce7dd92`).

- Site path: `site:src/components/viz/*.astro` and `site:src/scripts/viz/*`, not `components/lab/viz`.
- `accent-action-hi` contrast on the canvas is 13.6:1 (spec says about 12:1).
- `StatNumber` gains the tiers in 3.1.2 (spec stops at `text-5xl`, weight 700).
- Rollout: replaced by the plan's phases and milestones (5.5), which also supersede the revised
  spec's own rollout (DS 6.11).
- Scope: real-data features are in scope; behaviour changes are listed in 3.4.2.
- "Budgets are not widened": the branch currently widens them (2.3); fixed in plan Phase 0
  (Tasks 0.6 and 0.7).

### 3.2 Admin information architecture

#### 3.2.1 Shell

- **Sidebar** (`components/layout/Sidebar.tsx`): group labels become `MonoLabel`; items sans 14; the
  active item gets a 2 px `accent-action-hi` bar on the left instead of a filled pill; badges become
  a mono tabular count plus `StatusDot` (`warn` for issues, `on` for running); the collapsed 72 px
  rail keeps only the dots.
- **Header**: flat canvas, no glass; bottom hairline after scroll; mono breadcrumb
  `ADMIN · 07 / OPERATIONS · TASKS` with the chapter number in `accent-action-hi`; ghost back and
  forward buttons; search per the form recipe.
- **Command palette** (Cmd+K): popover recipe; task actions show their queue in mono (from the
  task-catalog flags in 4.8).
- **Page transition**: opacity plus 8 px, 0.35 s `ease-out-expo`; nothing under reduced motion.
- **Live data**:
  - `OpsSnapshotContext` (one `/api/admin/ops-stream` per tab) stays for sidebar badges and the
    Dashboard, without `fresh=1` (B2).
  - New `AdminLiveProvider` (`contexts/AdminLiveProvider.tsx`, read through
    `hooks/use-admin-live.ts`) owns one `/api/admin/live-stream?surfaces=...` connection per tab
    for every v3 instrument (5.3.1). Hooks read surfaces from it; no instrument opens its own
    `EventSource` and no instrument polls instead.
  - Per-task streams (`/api/events/task/{id}`) only for a task the user selected or launched.
  - One `useSnapshotStream` reconnect hook replaces the 6 copies of the reconnect effect.

#### 3.2.2 Navigation groups (PD14)

Proposed regrouping along the site's /admin chapters. Chapter numbers appear in eyebrows and the
breadcrumb only for pages that back a chapter. Every page sits in the group of its chapter (3.2.3),
so the sidebar group, eyebrow and breadcrumb agree; the Sidebar test (plan Task 3.2) asserts it.

| Group                  | Pages                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| (top)                  | Dashboard                                                                                        |
| Library                | Browse, Timeline                                                                                 |
| 01 Health              | Health, Library Trash                                                                            |
| 02 Imports             | Imports (new, PD16), Contributions                                                               |
| 03 Acquisition         | Acquisition (`/download`), New Releases, Upcoming, Bandcamp, Discover (discography completeness) |
| 04 Enrichment          | no page: the Artist page Enrichment tab carries the chapter                                      |
| 05 Genres              | Genres                                                                                           |
| 06 Analysis & Insights | Analysis, Insights                                                                               |
| 07 Operations          | Tasks, System, Stack, Logs                                                                       |
| Curation               | System Playlists, Translations                                                                   |
| Access                 | Users, Roles                                                                                     |
| Federation             | Federation, Global Catalog                                                                       |
| Settings               | Settings                                                                                         |

#### 3.2.3 Admin routes and focal visuals

| Route                                                                                                                                                                                  | Page          | Chapter            | Focal visual (site source)                                                                                                                                              | P · size |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `/`                                                                                                                                                                                    | Dashboard     | Operations summary | tile row: Health tile (`site:src/components/InsideCrate.astro`), Operations, Listeners, Library                                                                         | P0 · M   |
| `/health`                                                                                                                                                                              | Health        | 01                 | HealthScan (`site:src/components/viz/HealthScan.astro`)                                                                                                                 | P0 · L   |
| `/trash`                                                                                                                                                                               | Trash         | 01                 | `StatStrip` plus hairline review rows                                                                                                                                   | P2 · S   |
| `/imports` (new)                                                                                                                                                                       | Imports       | 02                 | staging queue rail (PD16)                                                                                                                                               | P1 · M   |
| Album detail                                                                                                                                                                           | Album         | 02 / 06            | AlbumSidecar panel (`site:src/components/viz/AlbumSidecar.astro`) plus TrackReadout                                                                                     | P1 · M   |
| `/contributions`                                                                                                                                                                       | Contributions | 02                 | hairline review queue                                                                                                                                                   | P2 · S   |
| `/new-releases`                                                                                                                                                                        | New Releases  | 03                 | ReleaseTimeline (`site:src/components/viz/ReleaseTimeline.astro`)                                                                                                       | P1 · L   |
| `/download`                                                                                                                                                                            | Acquisition   | 03                 | acquisition lanes (QueueLanes model)                                                                                                                                    | P1 · L   |
| `/upcoming`                                                                                                                                                                            | Upcoming      | 03                 | month cell grid; ticket for shows                                                                                                                                       | P2 · M   |
| `/bandcamp`                                                                                                                                                                            | Bandcamp      | 03                 | cover rows, sync dot                                                                                                                                                    | P2 · M   |
| `/discover`                                                                                                                                                                            | Discover      | 03                 | completeness row meters                                                                                                                                                 | P2 · M   |
| Artist, tab `enrichment`                                                                                                                                                               | Artist        | 04                 | EnrichmentOrbit (`site:src/components/viz/EnrichmentOrbit.astro`)                                                                                                       | P2 · L   |
| `/genres`, `/genres/:slug`                                                                                                                                                             | Genres        | 05                 | GenreWheel plus EQ inheritance panel (`site:src/components/viz/GenreWheel.astro`)                                                                                       | P0 · L   |
| `/analysis`                                                                                                                                                                            | Analysis      | 06                 | TrackReadout (`site:src/components/viz/TrackReadout.astro`) plus coverage                                                                                               | P1 · L   |
| `/insights`                                                                                                                                                                            | Insights      | 06                 | Nivo small multiples                                                                                                                                                    | P1 · M   |
| `/tasks`                                                                                                                                                                               | Tasks         | 07                 | QueueLanes (`site:src/components/viz/QueueLanes.astro`, P0 · L); GovernorGauges (`site:src/components/viz/GovernorGauges.astro`) embedded later (P1 · M, 4.8, plan 3.5) | P0 · L   |
| `/system`                                                                                                                                                                              | System        | 07                 | GovernorGauges standalone; event pipeline (`site:src/components/viz/OutboxSequence.astro`) and Redis pair (`site:src/components/viz/RedisPair.astro`) below             | P1 · M   |
| `/stack`                                                                                                                                                                               | Stack         | 07                 | SystemMap (`site:src/components/architecture/SystemMap.astro`)                                                                                                          | P1 · L   |
| `/logs`                                                                                                                                                                                | Logs          | 07                 | terminal console                                                                                                                                                        | P1 · M   |
| `/federation`                                                                                                                                                                          | Federation    |                    | topology (`site:src/components/viz/Federation.astro`)                                                                                                                   | P2 · L   |
| `/browse`, `/timeline`, `/users`, `/roles`, `/playlists*`, `/i18n`, `/settings`, `/global-catalog`, `/login`, `/setup`                                                                 |               |                    | recipes only (4.9, 4.10)                                                                                                                                                | P1–P2    |
| Route-level states: `PageSpinner` (`App.tsx:108`, `components/auth/ProtectedRoute.tsx:5`), "Admin console access required", "Permission required", "No console landing page available" |               |                    | `ErrorState` page variant (4.10)                                                                                                                                        | P1 · S   |

Orphans: `pages/Shows.tsx` and `pages/Profile.tsx` are unrouted; delete them. Verify whether
`artists/:artistId/:slug` is shadowed by the album route.

### 3.3 Listen information architecture

#### 3.3.1 Shell and chrome

- **Desktop** (`components/layout/Shell.tsx` → `DesktopShell`): sidebar items as in Admin; the
  Discovery-radio glow driven by `useAudioVisualizer` state goes (B24); the top bar keeps its
  transparent header but replaces blur with the site's gradient fade where content scrolls under.
- **Mobile** (`MobileShell`, `MobileBottomNav.tsx`): existing items, icon 22 px plus mono 10 px
  label; active item in `accent-action-hi` with a 2 px top bar that draws in; no filled pill; 44 px
  targets and `--listen-safe-*` respected. The mini player carries a 1 px `accent-action-hi`
  progress line written by ref from a `usePlayerProgress` leaf.
- **Tauri**: macOS native titlebar unchanged; Linux titlebar uses `@crate/ui/icons` instead of the
  undeclared `lucide-react`; GTK accent per PD39.
- Heavy surfaces stay lazy (`components/player/lazy-player-surfaces.tsx`, `React.lazy` routes);
  Listen's initial JS budget is 300 KB gzip with about 100 KB of headroom.

#### 3.3.2 Listen routes and focal visuals

| Route                                                                                                                                                                                               | Focal visual (site source)                                                                                                                                      | Data                                               | P · size |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| Player bar, fullscreen, extended                                                                                                                                                                    | EQ glyph (`site:src/components/InsideCrate.astro` EQ tile); hairline seek; Info readout; queue mix strip (`site:src/components/viz/MixViz.astro`)               | player state, `/api/tracks/*`                      | P0 · M   |
| EQ panel, popover, sheet                                                                                                                                                                            | EqViz (`site:src/components/viz/EqViz.astro`) plus inheritance walk                                                                                             | effective EQ chain                                 | P0 · M   |
| `/` Home                                                                                                                                                                                            | Listening DNA heatmap tile (desktop); ticket header for upcoming                                                                                                | home discovery snapshot, stats dashboard           | P1 · L   |
| `/explore`                                                                                                                                                                                          | MoodMap (`site:src/components/viz/MoodMap.astro`); genre wheel (phase 2, desktop)                                                                               | `explore:moods` snapshot; `genre-wheel/crate-core` | P1 · M   |
| `/radio`                                                                                                                                                                                            | sound map (`site:src/components/listen/RadioDive.astro`)                                                                                                        | radio session explain, bliss map                   | P1 · L   |
| `/paths`, `/paths/:id`                                                                                                                                                                              | route map (`site:src/components/listen/PathsDive.astro`, InsideCrate path tile)                                                                                 | path `plan_meta`, steps                            | P1 · L   |
| `/stats`, `/stats/global`, `/users/:u/stats`                                                                                                                                                        | heatmap band plus XL counters (`site:src/components/viz/Heatmap.astro`)                                                                                         | stats dashboard snapshot                           | P0 · M   |
| `/upcoming` (Radar)                                                                                                                                                                                 | setlist ticket (`site:src/components/viz/Setlist.astro`)                                                                                                        | `/api/me/upcoming`                                 | P1 · M   |
| Artist, Album, Library, Crates, Playlists, Search                                                                                                                                                   | recipes (track rows, media grid, entity header)                                                                                                                 | existing                                           | P1 · M–L |
| `/home/playlist/:playlistId` (`pages/HomePlaylist.tsx`), `/curation/playlist/:id` (`pages/CuratedPlaylist.tsx`, `CuratedPlaylistContent.tsx`), `/home/section/:sectionId` (`pages/HomeSection.tsx`) | playlist entity header and track rows (4.20); the section page as a media grid under `SectionHeader`                                                            | existing                                           | P1 · S   |
| `/artists/:artistSlug/top-tracks` (`pages/ArtistTopTracks.tsx`)                                                                                                                                     | track rows with mono plays and `124 · 8A` (4.19)                                                                                                                | existing                                           | P2 · S   |
| `/people` (`pages/People*.tsx`), `/users/:username/followers` and `/following` (`pages/UserConnections.tsx`)                                                                                        | hairline user rows with presence dots and mono counts (4.22 Social)                                                                                             | existing                                           | P2 · S   |
| `/users/:username` (`UserProfile`)                                                                                                                                                                  | 4.22 Social: affinity numeral, reasons list, `StatStrip` (plan 6.15, coverage L22)                                                                              | existing                                           | P2 · M   |
| `/catalog/artists/:globalArtistUid`, `/catalog/albums/:globalAlbumUid` (global-catalog `Artist` and `Album`)                                                                                        | 4.19 entity headers and track rows, with the remote-provenance tag `via <node>` (3.1.5) on the header and remote rows (plan 6.13, coverage L14/L15)             | existing                                           | P1 · M   |
| `/crate/:crateRef`                                                                                                                                                                                  | 4.20 Crates (plan 6.14, coverage L17)                                                                                                                           | existing                                           | P2 · M   |
| `/library`, `/collection`, `/collection/:section`                                                                                                                                                   | 4.20 Library; the tab stays where it is today (`?tab=` on `/library`, the path segment on `/collection/:section`) (plan 6.14, coverage L16)                     | existing                                           | P1 · M   |
| `/stats/digging`                                                                                                                                                                                    | 4.17 Digging: XL story numerals (plan 6.16, coverage L19)                                                                                                       | stats dashboard snapshot                           | P2 · M   |
| `/bandcamp`                                                                                                                                                                                         | coverage L23: sync `StatusDot`, cover rows (plan 6.15)                                                                                                          | existing                                           | P2 · S   |
| `/settings`                                                                                                                                                                                         | Devices row (`site:src/components/viz/Devices.astro`); Access tokens after the Smart Mix merge (`site:src/components/viz/TokenAllowlist.astro`); offline meters | devices, Connect WS                                | P1–P2    |
| Social, Upload, Offline, Auth, Share                                                                                                                                                                | recipes                                                                                                                                                         | existing                                           | P2       |
| Jam                                                                                                                                                                                                 | out of scope (`JAM_ROOMS_ENABLED = false`)                                                                                                                      |                                                    |          |

#### 3.3.3 Runtime matrix for visuals

| Runtime                                                | Live spectrum                         | EQ                | Crossfade                                                                                                                                                                                                  | WebGL2                   | CSS `linear()`                                                        |
| ------------------------------------------------------ | ------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Web browsers, Tauri desktop                            | yes (`AnalyserNode` per song, pre-EQ) | Web Audio biquads | Gapless-5 `EqualPower` (gains sqrt(1−p) / sqrt(p)); smart: 2/3/4/6 s (`SMART_TRANSITION_*_SECONDS` in `contexts/player-smart-transition.ts`, 3 s for mixed queues); manual: 0–12 s (`PlaybackSection.tsx`) | yes                      | yes on current engines; not on WebView2 111, WebKitGTK 2.40, macOS 11 |
| iOS Capacitor, iPhone PWA, Android web stable pipeline | no (unless enhanced audio at startup) | no                | 0 s                                                                                                                                                                                                        | yes (iOS floor per PD42) | iOS 17.2+ only                                                        |
| Android native                                         | no FFT                                | native `setEq`    | Smart Mix decks after the merge                                                                                                                                                                            | GPU-dependent            | current WebView                                                       |

Mobile visuals are data-driven (analysis fields, snapshots), never analyser-driven (PD41).

### 3.4 What changes and what stays

#### 3.4.1 Changes and constants

| Area              | Changes                                                                         | Stays                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visual language   | tokens, primitives and recipes above in every screen                            | product behaviour except 3.4.2                                                                                                                                     |
| Admin navigation  | regrouped sidebar (PD14), breadcrumb, new `/imports` (PD16), tabs in the URL    | every existing route and capability gate                                                                                                                           |
| Listen navigation | Settings gets a top-level Devices section                                       | route table, tab bar items; Library tabs keep their URL state (`?tab=` on `/library`, path segment on `/collection/:section`), so existing deep links keep working |
| Data              | additive fields, new snapshot-backed endpoints, request-time aggregates removed | existing response shapes (additive only, so shipped Capacitor builds keep working)                                                                                 |
| Realtime          | one Admin live stream per tab; per-task streams only on demand                  | `/api/cache/events`, home discovery stream, Connect WS                                                                                                             |
| Charts            | Nivo themed by tokens; instruments hand-built (PD1)                             | Nivo for statistical charts                                                                                                                                        |

#### 3.4.2 Behaviour changes to warn about before merging

| Change                                                                                                                                                                                                                                                                                    | Section              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `library_pipeline` stops auto-applying `shadow_quality_tracks` (destructive, needs confirmation)                                                                                                                                                                                          | PD24                 |
| `fix-type` requires a server-side confirm flag for checks that need confirmation; `POST /health-check` and `fix-type` deduplicate                                                                                                                                                         | 4.2                  |
| A failing health check no longer resolves its open issues                                                                                                                                                                                                                                 | 4.2                  |
| `/api/acquisition/snapshot` and `/stream` require acquisition capabilities                                                                                                                                                                                                                | PD46                 |
| Genre "Generate with AI" previews instead of applying; core-genre EQ and metadata edits persist across restarts and image rollbacks (G1, plan 2.18d)                                                                                                                                      | 4.6, PD18            |
| Smart EQ keeps the last resolved gains while the next track's EQ loads (today the audio dips to flat for about 80 ms)                                                                                                                                                                     | PD32                 |
| Enrichment Settings toggles start doing something (today the pipeline ignores them)                                                                                                                                                                                                       | PD29                 |
| `GET /api/artists/{id}/enrichment` stops calling providers inline; Listen's bio hook receives `{}` on a cold artist and a task is enqueued                                                                                                                                                | 4.5                  |
| Federation projector routing: remote stream events stop rebuilding `ops/dashboard`                                                                                                                                                                                                        | B11                  |
| Projector consumption fixed (B1): projector work resumes, so ops rebuilds must be coalesced in the same change                                                                                                                                                                            | 5.1                  |
| The projector resumes its side-effecting projections (post-acquisition `process_new_content`, per-user home rebuilds, recently-played refreshes) behind `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED`, off at deploy (plan 2.10)                                                                 | 5.1, B1              |
| `/api/admin/metrics/system` shows the worker's real governor values (0/0 listeners/streams and the window) instead of the API's defaults                                                                                                                                                  | 4.8                  |
| Stack restart denied for `traefik` (restartable today) and the other core services; stop/start only for non-core containers                                                                                                                                                               | PD44                 |
| Camelot maps flat keys (`Bb`, `Eb`, `Ab`, …) through enharmonics, so key scoring in Radio and Paths changes for tracks Essentia tagged with flats                                                                                                                                         | 4.7, PD2 (plan 2.9b) |
| `/api/events/task/{id}` and `GET /api/tasks/{id}` require the task owner or the capability that queued the task (B16); Listen tasks queued before the deploy carry no owner and lose their stream                                                                                         | B16                  |
| Genre counts drop under the shared count definition, in FastAPI and in the Go read plane (`/api/genres`, genre detail)                                                                                                                                                                    | PD21, 4.6.3          |
| `GET /api/admin/health-snapshot?check_type=` is replaced by `GET /api/admin/health-checks/{check_type}/issues`; the old route stays one release as a deprecated alias; `/api/admin/health-stream` is deprecated the same way (alias for one release) and the Health page stops opening it | 4.2                  |
| `POST /api/paths`, `/regenerate` and `/preview` (synchronous) skip the LLM refinement, get a per-user rate limit and a deprecation date; new Listen builds plan through the task route                                                                                                    | 4.16, B18            |
| Mood playback samples from a stored pool of at most 400 uids per mood instead of `ORDER BY RANDOM()` over every match                                                                                                                                                                     | 4.14                 |
| `/api/me/upcoming` moves probable setlist songs into a top-level `probable_setlists` map keyed by artist; the per-show field stays, deprecated, until the minimum supported Listen client reads the map                                                                                   | 4.18                 |
| Below 3 listeners the instance stats builder hides the heatmap: `heatmap.cells` is an all-zero 7×24 grid (shipped Listen builds call `cells.flat()`), `peak` and `night_share` are `null` and `hidden_reason` is `"few_listeners"`; `heatmap_utc` follows the same rule (plan 2.20)       | 4.17, PD43           |
| The v2 genre tree shows `—` counts while the wheel snapshot is cold (its counts come from the snapshot, B7)                                                                                                                                                                               | 4.6.3                |
| `reanalyze_album` is deduplicated: a second click attaches to the running task                                                                                                                                                                                                            | 4.7                  |

The plan task that carries each row is tagged `[BEHAVIOUR]` and ships in its own PR with a
release-note line. Besides the tasks tagged today, that includes plan 2.2 (task-stream ownership),
2.17c (health dedup, the `health-snapshot` and `health-stream` aliases), 2.18c (genre counts and
the cold tree), 3.9a (`reanalyze_album` dedup), 4.7a (upcoming setlists), 4.8a (mood playback),
4.9a (Paths planning as a task, synchronous routes without LLM refinement) and the Camelot PR in
PD2 (plan 2.9b).

---

## 4. Screen-by-screen design

Format per screen: purpose, focal visual, data, states, interactions, mobile. The instruments the
site sells as Admin chapters (Health, Imports, Acquisition, Enrichment, Genres, Analysis,
Operations) and the main Listen instruments carry their data contract. Shared states (3.1.5) apply
everywhere and are only repeated when a screen deviates.

**Admin screens (4.1–4.10)**

### 4.1 Dashboard `/` (P0 · M)

- **Purpose**: first-glance operator state; the entry to each chapter.
- **Focal visual**: a row of four tiles following the site's Inside Crate tile recipe
  (`site:src/components/InsideCrate.astro`, `site-language.md` 2.15): hairline row, numbered mono
  label, 120 px mini, display title, one body line with `→`. The four current `OpsStatTile`s are
  restyled together so the row stays consistent.
  1. **Health**: 17 bars in catalog order (unattended checks full width, confirm checks 82%); tone
     per check state (clean fg/.16, open unattended `accent-action`/.35, waiting `state-warning`,
     never run dashed, failed amber outline); `StatNumber` of waiting issues; the bar of the check
     being scanned lights up from real scan events. Data and contract: 4.2.
  2. **Operations**: running and queued summed from the ops snapshot's
     `worker_live.queue_breakdown` (per-queue running and pending, written every 15 s); governor
     status word (`Allowed`, `Deferring · load`) from the persisted verdict through
     `GET /api/admin/governor` (Redis key, else `ops_runtime_state('resource_governor')`), fetched
     on mount and focus and at most once per 60 s on ops-snapshot pushes; omitted until the
     governor ships (plan 2.16). The Dashboard does not subscribe to the `queues` or `governor`
     live surfaces, so an idle Dashboard never sets their viewer keys and never holds those
     samplers on their fast cadence (5.3.1).
  3. **Listeners**: `active_users_5m` and plays in the last 3 minutes from the ops runtime block
     (label "plays · 3 min", never "streams").
  4. **Library**: albums and tracks from the ops snapshot counts, ScaleFigures style, `~` when
     approximate.
- **Below**: "Needs attention" `HairlineList` with warn dots (health checks waiting, failed tasks,
  stale snapshots, deferred tasks; sources already in the ops snapshot and surfaces, no new
  query); recent albums as a cover row with mono `added 3 h ago`; Advanced diagnostics (formats as
  a proportional hairline bar, decades as a hairline histogram, the event bus card collapsed to a
  pipeline summary line linking `/system#event-pipeline` when the user has `ops.health.view`; the
  "SSE surfaces" tile stays); Maintenance panel last (rebuild, wipe) with typed confirmation.
- **States**: each tile has its own warming state; without `library.repair.run` the Health tile
  falls back to `health_counts` from the ops snapshot.
- **Interactions**: the tile title links to its page (the link is the title, not the whole tile,
  so rows and the Scan pill are not nested interactive content); Health rows link to
  `/health?check=<type>`; a Scan pill starts a deduplicated scan.
- **Mobile**: tiles 4 → 2 → 1, border moves from left to top.
- **Preconditions**: B1, B2, and the health surface (4.2, plan 2.17c) before the Health tile.
  Test: new `pages/Dashboard.test.tsx`, including that the Dashboard never subscribes to the
  `queues` or `governor` surfaces (so it sets neither `admin:live:viewers:queues` nor
  `admin:live:viewers:governor`).

### 4.2 01 Health `/health` (P0 · L+)

- **Purpose**: see every library check, what it found, what fixes itself and what waits for a
  person; run a scan; fix or review.
- **Focal visual**: HealthScan (`site:src/components/viz/HealthScan.astro`,
  `site:src/scripts/viz/health-view.ts`) replacing the inline hero section and the "Repair catalog"
  card in `app/ui/src/pages/Health.tsx`. The per-check drill-down below it is extracted to
  `components/health/HealthIssueDrilldown.tsx` (`fixAllMode` and `groupIssuesByArtist` keep their
  tests).
- **Anatomy**:
  - Header: `MonoLabel` `HEALTH · last scan 3 h ago`; right-hand live status line.
  - Three L numerals: Open, Fix on their own (open issues on unattended checks), Ask first (waiting
    issues on confirm checks).
  - 17 rows in catalog order, 6-column grid (`2.4ch minmax(0,1fr) 11ch 16ch 9ch 12ch`): index; label
    over description; scope; 3-segment risk meter plus word (Safe / Needs review / Destructive);
    `auto` or `confirm` badge; result.
  - Results: `not run`, `clean`, `N found`, `N waiting` (amber), `N fixed` (`accent-action-hi`),
    `failed` (warn dot).
  - Footer: `M track files in Library Trash →` (link to `/trash` with `library.track.remove`; the count comes from the `trash_track_files` index, plan 2.17e) and
    `N albums quarantined` without a link (album quarantine is a DB flag; `/trash` lists only track
    files).
- **Live scan**: the cursor (2 px `accent-action-hi` bar plus `bg-accent-action/8` wash) sits on the
  check that is actually running, moved by per-check scan events. Minimum 150 ms per row so fast DB
  checks do not flash; the active row shows elapsed time (a 1 s timer writing a text node, 3.1.3)
  so slow filesystem walks do not look frozen. The cursor's rAF stops once it rests on a row. Status line: `scanning 07/17 · Unindexed Files · 0:42`, `applying automatic fixes` during
  the pipeline repair phase, `queued · waiting for resources` when the governor defers the scan
  (console scans are governed: `console` is not in `MANUAL_TRIGGER_VALUES`). Artist-scoped rechecks
  never move the cursor.
- **Interactions**:
  - `Run scan`: `POST /api/manage/health-check`, deduplicated; a second click attaches to the
    running task.
  - `Fix` chip only on checks that can fix globally or in bulk (6 of 17 today: the 4 automatic
    checks, `shadow_quality_tracks` and `artist_layout_fix`); deduplicated per check;
    disabled while that repair runs; labelled `Fix 500 of N` when the 500-issue cap applies.
  - `Review` expands the per-artist drill-down for the 11 confirm checks that cannot fix globally;
    the per-artist "Review and repair" link stays. It reads the paginated issues route below
    (artists are never split across pages, so `groupIssuesByArtist` and the per-artist fix-all keep
    working) and refetches only when a `health` live event changes that check's `open`. The page
    opens no stream of its own: the v2 `/api/admin/health-stream?check_type=` `EventSource`
    (`Health.tsx:404`) goes.
  - Every confirm or destructive action goes through `ConfirmDialog`, including the
    `shadow_quality_tracks` fix-all and `dismiss-type`, which are one-click today.
  - `Run cleanup now` for `duplicate_tracks` stays.
  - `?check=<type>` deep link (filter moves from `useState` at `Health.tsx:312` to search params).
  - Toasts (sonner) only on transitions that outlive the control.
- **States**: warming (catalog rows from code, `—` results, "warming up"); never scanned (all
  `not run`, CTA `Run first scan`); stale (`updated 4 min ago` in the meta); failed checks counted in
  the header; offline (keep last payload, `offline · retrying`, reconnect 3 s → 30 s).
- **Accessibility**: figure sentence with real numbers; the visible scan status is `aria-hidden`;
  an sr-only polite region announces only scan start, finish, fixes applied and failure; action
  buttons are named (`Fix 14 Stale Tracks issues`).
- **Mobile**: under 1000 px hide scope and risk; under 760 px hide index and description.

Contract:

This is the canonical Health contract (field names, phases and events); the spec's HealthScan and
HealthScanTile entries follow it.

```ts
// GET /api/admin/health-checks  (library.repair.run). Reads ui_snapshots('ops:health','checks') by PK.
// Stale rows are served and a debounced refresh is scheduled; no row returns state 'warming' with
// the catalog built from code. Never builds in the request.
interface HealthChecksSurface {
  state: "ready" | "warming";
  checks: Array<{
    index: number;
    check_type: string;
    label: string;
    description: string; // from RepairCatalogEntry
    risk: "safe" | "caution" | "destructive";
    scope: "db" | "filesystem" | "hybrid";
    unattended: boolean; // runs in library_pipeline without confirmation (PD24 decides the rule)
    fix_mode: "global" | "bulk" | "per_artist";
    state:
      | "unknown"
      | "never_run"
      | "clean"
      | "open"
      | "waiting"
      | "fixed"
      | "failed";
    open: number | null;
    found_last_run: number | null;
    fixed_last_run: number | null;
    last_run_at: string | null;
    duration_ms: number | null;
    last_error: string | null;
  }>;
  totals: {
    checks: number;
    unattended: number;
    confirm: number;
    open: number;
    open_unattended: number;
    waiting: number;
    fixed_last_run: number;
  } | null;
  last_scan: {
    task_id: string | null;
    task_type: "health_check" | "library_pipeline";
    trigger: "schedule" | "console";
    finished_at: string;
    failed_checks: number;
  } | null;
  running: {
    task_id: string;
    task_type: "health_check" | "library_pipeline" | "repair";
    status: "queued" | "running";
    phase: "scan" | "repair" | "sync" | "revalidate";
    scope: "full" | "selected";
    index: number;
    total: number;
    check_type: string | null;
    check_started_at: string | null;
  } | null;
  trash: {
    track_files: number;
    albums_quarantined: number;
    updated_at: string;
  } | null;
  snapshot: SnapshotMeta; // existing decorate_snapshot block
}
// Live, on /api/admin/live-stream?surfaces=health. One surface with two event types; `health-scan`
// is not a separately requested surface:
//   event "health"       → the surface, re-read by PK when ui_snapshots publishes a new version
//   event "health-scan"  → { task_id, index, total, check_type, phase: "started"|"completed"|"failed"|"fixed",
//                            found?, fixed?, duration_ms?, at } forwarded from crate:sse:admin:health:scan.
//                            "fixed" is emitted per check by repair runs (pipeline repair phase and
//                            manual repairs, plan 2.17d); scans emit started, completed and failed.

// GET /api/admin/health-checks/{check_type}/issues?cursor=&limit=  (library.repair.run). The drill-down.
// One query over open issues of one check (idx_health_issues_open_identity), no snapshot write. Keyset
// pagination by artist: artists ordered by name then artist_id, issues without an artist last; the cursor is
// the last artist key; limit = artists per page (default 25, max 100). Artists are never split across pages.
interface HealthCheckIssuesPage {
  check_type: string;
  total_issues: number;
  total_artists: number;
  artists: Array<{
    artist_id: number | null;
    artist: string | null;
    issue_count: number;
    issues: HealthIssue[];
  }>; // existing issue shape (id, description, severity, details_json, …), ≤100 per artist
  next_cursor: string | null;
}
// Refetched when a "health" event changes that check's open count. GET /api/admin/health-snapshot?check_type=
// and /api/admin/health-stream stay one release as deprecated aliases (3.4.2).
```

Backend:

1. `crate/repair_catalog.py`: `label` and `description` as keyword arguments appended to each
   `RepairCatalogEntry` (the site's positional parser keeps working); also in
   `repair_catalog_payload()` and `RepairCatalogEntryResponse`. Remove the three client copies
   (`Health.tsx:147,167`, `components/artist/ArtistRepairDialog.tsx:107`, `prettifyHealthType` in
   `Dashboard.tsx`); labels in Title Case.
2. `crate/health_check.py` `_run_entries`: time each check; a check that raises records
   `last_error`, keeps its previous `issue_count` and does not resolve its issues (B13); publish
   `health-scan` events for full and selected scans only, never for per-artist rechecks.
3. Persistence in `db/repositories/health_issues.py` (`persist_health_check_results`: upserts,
   `ANY(:ids)` stale resolution, run records in one transaction), not in `health_check.py`
   (layering rule).
4. Surface: the CTE in `db/queries/health_issues.py` (`GROUP BY check_type` on open issues using
   `idx_health_issues_open_identity`, 17 run rows, quarantined album count); orchestration in
   `db/admin_health_surface.py`; the trash track-file count is maintained by the worker (quarantine,
   restore and hard-delete handlers and the health run), never by walking the disk per refresh.
5. `running`: a Redis key with a 90 s TTL, refreshed by each scan event and by a 30 s heartbeat
   thread that runs for the whole task (scan events alone fire only at the start and end of each
   check, so a filesystem check slower than 90 s would let the key expire mid-check), deleted in the
   task's `finally` on completion or failure, merged at read time and dropped when the task is no
   longer pending or running. `queued` is written by a hook in the `actors.py` dispatch path
   (governor deferral and DB-heavy lock wait).
6. Writers: the worker refreshes the snapshot at start and end of `health_check`, `repair` and
   `library_pipeline` (fixes V10, part of B13). API mutations enqueue `refresh_admin_surface(surface="health")`
   on the fast queue (new task type, dedup key `admin-surface:health`, trailing-edge coalescing per
   5.3.2 so a mutation committed during a running refresh is not lost).
7. `POST /api/manage/health-check`: `create_task_dedup(dedup_key="health-check:full")`, returning
   the existing task id when deduplicated (pattern of `run_duplicate_track_cleanup`).
8. `fix-type`: per-check dedup; body `{confirm: bool}`, 409 without it for confirm checks. Repair
   per-item events go only to `crate:sse:task:{id}`, never `crate:sse:global` (they would trigger
   B2/B4 rebuilds per item).
9. Drill-down: `GET /api/admin/health-checks/{check_type}/issues` (contract above; query in
   `db/queries/health_issues.py`, no snapshot write in the request) replaces
   `GET /api/admin/health-snapshot?check_type=`, which stays one release as a deprecated alias of
   the new read (3.4.2), with a test. `/api/admin/health-stream` (`api/management.py:235`,
   `_health_stream`, a B4 site) is deprecated in the same change (plan 2.17c, alias for one
   release) and the Health page drops its `EventSource` (plan 3.6).
10. `library_pipeline` (`worker_handlers/management.py`): phases health → repair → sync; close the
    health part after repair; build the repair report from persisted issues so repaired issues get
    `resolution='repaired'`; record per-check fixed counts (also for manual repair runs) and emit
    one `health-scan` event with `phase: "fixed"` per check that fixed something.
11. Migration (number at rebase, 5.3.4): `health_check_runs.task_id`, `last_error`
    (`duration_ms` already exists and becomes per check); `health_issues.resolution`
    (`repaired | disappeared | manual | dismissed`), `resolved_task_id`.
12. `open_pubsub`/`close_pubsub` (`api/redis_sse.py`) accept several channels (needed by the live
    stream).

Tests: `test_health_check.py` (events, failed check keeps issues, per-check duration, a 120 s
check keeps `running` in the surface, the key is gone after completion and after failure),
`test_health_issue_persistence.py`, new `test_admin_health_surface.py` (payload, totals, cold, stale
schedules without building), `test_repair.py` (pipeline set), API tests (permission, dedup, 409,
the issues route keeps an artist on one page and the cursor round-trips, the deprecated
`health-snapshot` and `health-stream` aliases), `test_openapi_contract.py`, Vitest for the reducer
(dwell queue, reconnect merge), `HealthScan` states (the loop stops once the cursor rests while the
scan still runs), `Health.test.tsx` after the extraction (the page opens no `EventSource` of its
own; the drill-down refetches on a `health` event that changes its check's `open`), and the
Dashboard tile.

Site coupling: `site:src/content/admin/viz.test.ts` parses `CHECK_LABELS` and `CHECK_DESCRIPTIONS`
in `Health.tsx`. Whichever branch merges second updates that test to read `repair_catalog.py`.

### 4.3 02 Imports (P1 · M)

#### Album sidecar panel (Album detail)

- **Purpose**: answer, for one album, what `.crate/album.json` carries, whether it matches the
  catalog, and whether identity tags are in every file; write or restore.
- **Focal visual**: AlbumSidecar (`site:src/components/viz/AlbumSidecar.astro`,
  `site:src/scripts/viz/sidecar-view.ts`, `site:src/lib/json-lines.ts`) as a full-width band in
  `pages/Album.tsx` between `TrackTable` and `RelatedAlbums`, shown when `canEditMetadata` and the
  album is not a pre-release. Fetched the first time the panel scrolls into view.
- **Anatomy**:
  - Header: `PORTABLE METADATA · schema_version N` and `written 3 d ago · in sync` /
    `catalog changed · 2 tracks` (warn) / `never written` / `sync unknown`.
  - Left (4fr): folder tree from DB paths (storage v2 paths are UUIDs: segments truncated, track
    title as secondary text), artwork files, `.crate/album.json` with a status dot; files are
    `aria-pressed` buttons selecting a track; changed files get a warn dot. Below: the 6 identity
    tag chips from a new `IDENTITY_TAG_KEYS` constant (it does not exist yet; plan 3.10a creates it) with catalog coverage (`crate_audio_fingerprint 8/10`) and
    `tags written 10/10 · 0 errors`.
  - Right (8fr): object card with the JSON preview (sorted keys, strings in `accent-action-hi`,
    lyrics summarised, bliss vector inline with `… 20 values`, only the selected track rendered,
    plus a hand-added `… N more tracks` line).
  - Step rail: `01 write_portable_metadata` (`Write sidecar + tags`) and
    `02 rehydrate_portable_metadata` (`Restore from sidecar`, behind `ConfirmDialog` stating that
    it also reverts name, artist, year, genre and track titles, not only analysis and lyrics).
- **Live**: while a task for this album runs, per-track events light the file being tagged, advance
  the hairline and follow the JSON (auto-follow stops on wheel, pointer or key). At the end: one
  refetch, a single 2.4 s highlight sweep over changed sections, sonner toast, `aria-live` message.
- **States**: loading keeps the geometry; never written (step 01 is the primary CTA, step 02
  disabled); `queued` while the task waits in the maintenance queue; error inline with retry.
- **Mobile**: stack at 860 px; tree one column at 760 px.

Contract:

```ts
// GET /api/manage/albums/{album_id}/portable-metadata  (+ /by-entity/{album_entity_uid})
// library.metadata.write, checked before resolving the album. One read_scope: album PK, artist,
// tracks (idx_tracks_album_id) with lyrics laterals, album_portable_metadata, active task by
// (type, dedup_key). Never get_portable_metadata_status (COUNT over library_tracks), never /music.
interface AlbumPortableMetadataView {
  album_id: number;
  album_entity_uid: string | null;
  schema_version: number; // PORTABLE_SCHEMA_VERSION (payload stops hardcoding 1)
  folder: {
    segments: string[];
    files: Array<{
      relative_path: string;
      title: string;
      track_entity_uid: string | null;
      has_fingerprint: boolean;
      changed: boolean | null;
    }>;
    artwork_files: string[] | null;
  }; // from the last write
  identity_tags: Array<{
    key: string;
    tracks_with_value: number;
    tracks_total: number;
  }>;
  preview: { artist: object; album: object; tracks: object[] }; // compact, all tracks, keys sorted server-side
  preview_digest: string; // excludes volatile and local keys (PD30)
  state: {
    sync: "never" | "in_sync" | "drift" | "unknown";
    sidecar_written_at: string | null;
    audio_tags_written_at: string | null;
    rehydrated_at: string | null;
    written_schema_version: number | null;
    changed_sections: {
      album: boolean;
      artist: boolean;
      tracks: string[];
    } | null; // tracks by relative_path
    tracks: number;
    tags_written: number;
    tag_errors: number;
    last_error: string | null;
    active_task: {
      id: string;
      type: string;
      status: "pending" | "running";
      progress: object | null;
    } | null;
  };
}
// Live: /api/events/task/{task_id} event "portable_track" {phase, index, total, relative_path} in the tag loop.
```

Backend: extend `album_portable_metadata` (migration 022) with `schema_version`, `payload_digest`,
`section_digests`, `artwork_files`, `rehydrated_at`, `last_task_id`, `last_error` and
`catalog_changed_at` (`ADD COLUMN IF NOT EXISTS`). `catalog_changed_at` is set by the writers that
change album, track or artist metadata the sidecar carries (tag edits, renames and repairs,
rehydrate), with a nightly maintenance task that recomputes current digests in batches as the
floor; the library-wide drift count (4.7) is then `catalog_changed_at > sidecar_written_at`, never a
per-album payload build. `portable_payload_digest` and `portable_section_digests` over the output of
`get_portable_album_payload` (exclude `generated_at`, `*updated_at`, `enriched_at`, `computed_at`,
`size`, `total_size`, popularity metrics, `id`, `album_id`, `path`; PD30 for the enrichment-driven
artist keys); the write and rehydrate handlers live in `worker_handlers/management.py`; enqueue
with `create_task_dedup(dedup_key="portable-metadata:album:{id}")` from both the header and the
panel; rehydrate takes `album_id` and resolves the path from the DB (`get_library_album_by_id`);
rehydration gets its own mark function that does not touch `sidecar_written_at`, `tags_written` or
`tag_errors` (today it resets them). Keep the literals the site's drift test reads
(`PORTABLE_SCHEMA_VERSION = 1`, identity tag strings, `"bpm": track.get("analysis_bpm")`).

Components: `app/ui/src/components/album/portable-metadata/` (panel, tree, JSON, flow, hooks) and
`app/ui/src/lib/json-lines.ts` ported without `typedAt`. Tests: digest stability, view states,
event, dedup, rehydrate preserving tag counts, `Album.test.tsx` wiring.

#### `/imports` (PD16)

- **Purpose**: see and act on staged filesystem imports, which have an API
  (`/api/imports/pending|import|import-all|remove`, `library.import.manage`) and no UI.
- **What runs today**: staged imports run `import_queue_item` and `import_queue_all`
  (`worker_handlers/acquisition.py:2597,2645`), not `process_new_content`. `import_queue_item`
  emits only info events and ends with `start_scan()`; `import_queue_all` reports one `importing`
  phase with a per-item count. `import_queue_items` has no task link, and the enqueue paths
  (`api/imports.py`) use `create_task` without dedup.
- **Focal visual**: a hairline queue, one row per staged item: status dot and word (pending,
  queued, importing, imported, failed), artist and album, mono source and path, `discovered 3 h ago`,
  the error inline. Stages are drawn with `StepRail` only for phases the handler actually emits
  (backend below); until then rows carry status dots only. Actions: Import, Import all, Remove
  (confirm), Open task (`/tasks?task=`).
- **Contributions** stays its own page in the same group (hairline review rows, status dots).

Contract:

```ts
// GET /api/imports/queue (library.import.manage). One CTE: import_queue_items by status
// (idx_import_queue_items_status_updated) plus tasks by task_id = ANY(:ids). Never walks /music or the
// staging folders: the crate-worker service loop (ImportQueue.refresh_pending_state) keeps the table current.
interface ImportsSurface {
  items: Array<{
    id: number;
    source: string;
    path: string;
    artist: string | null;
    album: string | null;
    status: "pending" | "queued" | "importing" | "imported" | "failed";
    discovered_at: string;
    updated_at: string;
    task: { id: string; status: string; phase: string | null } | null;
    error: string | null;
  }>; // pending, queued, importing and failed first, then the last 50 imported
  totals: {
    pending: number;
    queued: number;
    importing: number;
    failed: number;
  };
}
// Live: the row that started a task follows /api/events/task/{id}; the list refetches on task_done and on focus.
// POST /import and /import-all return TaskEnqueueResponse {task_id, deduplicated}.
```

Backend: migration `import_queue_items.task_id`, `last_error`; enqueue with
`create_task_dedup(dedup_key="import:{source}:{path}")` (`import:all` for import-all) and set
`status='queued'` plus `task_id` in the same transaction; `_handle_import_queue_item` reports its
real phases through `TaskProgress` and writes `importing`, `imported` or `failed` with `last_error`;
`import_queue_all` does the same per item. Tests: pg_db for the surface query, dedup and status
transitions; `test_openapi_contract.py`; Vitest for the page states. Plan Task 5.7 splits into
5.7a (backend) and 5.7b (UI).

### 4.4 03 Acquisition

#### New Releases `/new-releases` (P1 · L)

- **Purpose**: follow a release from detection to analysed, and act (download, retry, dismiss).
- **Focal visual**: ReleaseTimeline (`site:src/components/viz/ReleaseTimeline.astro`,
  `site:src/scripts/viz/release-view.ts`) as a full-width band replacing `OpsPageHero` and the four
  stat tiles; each list row gets a compact 5-dot rail; grid cards get the current-stage dot.
- **Focus**: `?release=<id>` wins; otherwise the snapshot's `focus_id` (latest in-flight release,
  then next pre-release, then last analysed). An unknown id falls back and clears the parameter.
- **Anatomy**: `ACQUISITION release lifecycle` / `Artist · Title · type`; release clock as an XL
  numeral computed client-side from `release_date` (`T−N d`, `Day 0`, `Day +N`, `—` when unknown);
  `Now` stage title in `accent-action-hi` with its real task name; 5-stage rail (Detected, Release
  day, Fetched, Imported, Analysed); step chips per stage from real data (the 9 real
  `process_new_content` phases, `features N/M · bliss N/M` during analysis).
- **Special states**: Release day `skipped` (detected after release), `waiting for a source`
  (promote found no URL, with the caveat that promote looks up 10 URLs per run within 60 days),
  Fetched `skipped` (already in library), Fetched or Imported `failed` with the error and Retry,
  Analysed active with N/M (failed tracks count as terminal, marked amber).
- **Actions**: Download when `status === "detected" && tidal_url` (parity with today, including
  future pre-releases); Retry; Dismiss; Open album; Open task (`/tasks?task=`); Check now in the
  page header. Rows: a focus button on the title or cover, links and actions as siblings (no nested
  interactive content).
- **Live**: snapshot pushes re-target the band without remounting; only real transitions animate
  (dot fill, chip state, `--p` advance, scramble of the `Now` title when the stage changes).
  Latency about 5–10 s (projector polling).
- **Mobile**: rail vertical under 900 px.

Contract:

```ts
// GET /api/acquisition/new-releases/snapshot → ui_snapshots('acquisition:new_releases','global'),
// stale-first, max age ~3600 s; cold = { snapshot: { version: 0, stale: true, pending: true } }.
// GET /api/acquisition/new-releases/stream → pubsub on the snapshot channel; row read in asyncio.to_thread.
// GET /api/acquisition/new-releases?status=&upcoming= → filtered in memory from the snapshot (top 200).
type StageId = "detected" | "release_day" | "fetched" | "imported" | "analysed";
type StageState = "done" | "active" | "pending" | "failed" | "skipped";
interface NewReleasesSurface {
  releases: NewRelease[]; // ≤200, no dismissed, no tracklist_json / preview_tracks_json
  focus_id: number | null;
  catalog: {
    stages: Array<{
      id: StageId;
      task: string;
      steps: Array<{ id: string; label: string }>;
    }>;
  };
  last_checked_at: string | null;
  snapshot: SnapshotMeta;
}
interface NewRelease {
  id: number;
  artist_name: string;
  artist_id: number | null;
  album_title: string;
  library_album_id: number | null; // named to avoid the existing "alb.id AS album_id" alias
  release_type: string | null;
  release_date: string | null;
  status: "detected" | "downloading" | "downloaded";
  tidal_url: string | null;
  detected_at: string;
  prerelease: boolean;
  lifecycle: {
    stages: [StageState, StageState, StageState, StageState, StageState];
    current: StageId | null;
    step: string | null;
    task_id: string | null;
    reason:
      | "waiting_for_source"
      | "already_in_library"
      | "detected_after_release"
      | null;
    error: string | null;
    at: {
      detected: string;
      download_queued: string | null;
      downloaded: string | null;
      imported: string | null;
      analysed: string | null;
    };
    analysis: {
      tracks: number;
      features_done: number;
      bliss_done: number;
      failed: number;
    } | null;
    updated_at: string;
  };
}
```

Backend:

- Migration: `new_releases` gains `library_album_id`, `download_task_id`, `download_queued_at`,
  `import_task_id`, `imported_at`, `analysed_at`, `failed_stage`, `last_error`, `lifecycle_reason`,
  `lifecycle_updated_at`; one-off backfill (album link by lower-cased names with `MIN(id)`,
  timestamps for legacy downloaded rows, stuck `downloading` rows without an active task → failed).
- Atomic writers: `queue_release_download` (status, task id and task insert in one transaction) and
  `queue_release_import` (the `process_new_content` task and `import_task_id` in one transaction,
  because `create_task_dedup` dispatches after commit); `mark_download_failed` (fixes rows stuck
  in `downloading`); `link_downloaded_albums`; `mark_imported` (also on the `content_unchanged`
  early return); all append `acquisition.release.updated` in the same session. `check_new_releases`
  and `promote_due_releases` emit one event per run; dismiss emits too.
- `PROCESS_NEW_CONTENT_PHASES` tuple feeds the catalog and the hardcoded `phase_count=8`.
- Builder: one CTE in `db/queries/new_releases_surface.py` (album by PK, tasks by `ANY(:ids)`,
  analysis counts by `library_album_id = ANY(:ids)` for the handful of releases pending analysis);
  `derive_release_lifecycle` is a pure function with a table test; rebuilt by the projector on
  release events; `refresh_new_releases_surface` (fast) only for cold reads.
- Reconciler in the crate-worker service loop every 60 s, only when releases are downloading,
  importing or pending analysis.
- Non-Tidal acquisitions: PD27.

#### Acquisition workspace `/download` (P1 · L, P0 preconditions)

- **Focal visual**: acquisition lanes, the QueueLanes model reused locally: one lane per source
  (Tidal, Soulseek, Upload), zones queued / transferring / processing / done, chips labelled by
  album in mono with the real progress fill; Soulseek chips carry `2.3 MB/s · user`.
- **Rest**: search results as hairline rows with mono quality tags (`FLAC · 16/44.1 · 312 MB`;
  suspected fake FLAC as an amber tag with text); tabs as text tabs in the URL; quality select as
  chips; wishlist and history as tables; artist suggestions as a cover row.
- **Preconditions**: B9 (sampler below; stream forwards on pubsub; capability gate PD46), B20
  (covers server-side, contract below).

Cover lookup (B20). Today `Download.tsx` (`loadLastFmAlbumCover`) reads the Last.fm key from the
API and calls `album.getinfo` once per search result from the browser. Moving that one-to-one into
a handler would put N synchronous provider calls per search page on the API threadpool (the V7
problem), so the request only reads a cache:

```ts
// POST /api/acquisition/covers {items: Array<{artist: string; album: string}>}  (≤50; acquisition
// capabilities, PD46). One MGET (or one "= ANY(:keys)" read) of a cover cache keyed by normalised
// (artist, album); returns hits only. No provider call in the request.
interface AcquisitionCoversResponse {
  covers: Record<string, string | null>; // key → URL; null = known miss (negative cache)
  pending_task_id: string | null; // set when misses were enqueued
}
// Misses enqueue one deduplicated fast task (quiet; batch; 3 s provider timeout; positive and negative
// results cached with a TTL). Results arrive through publish_task_signal on the task channel, or on the next
// request for the same page.
```

Tests: the endpoint makes zero HTTP calls (provider client patched to raise); misses enqueue a single
task; a second request inside the window attaches to it; `Download.tsx` no longer reads the Last.fm
key.

Contract:

```ts
// GET /api/acquisition/snapshot (library.import.manage or library.tidal.manage, PD46). Reads the Redis
// runtime key crate:runtime:acquisition (TTL 120 s), else ops_runtime_state('acquisition'); {status: "warming"}
// when neither exists. GET /api/acquisition/stream forwards publishes on crate:sse:admin:acquisition: no slskd
// call and no rebuild per client. The existing fields (tidal_authenticated, tidal_queue, soulseek_queue)
// stay for shipped clients; `lanes` is additive.
interface AcquisitionLanesSurface {
  sampled_at: string;
  sampled_by: string;
  interval_seconds: number;
  tidal_authenticated: boolean;
  lanes: Array<{
    source: "tidal" | "soulseek" | "upload"; // upload = active library_upload tasks
    available: boolean;
    reason: string | null; // "slskd unreachable", "not authenticated"
    counts: {
      queued: number;
      transferring: number;
      processing: number;
      done_24h: number;
      failed_24h: number;
    };
    chips: Array<{
      id: string;
      zone: "queued" | "transferring" | "processing" | "done";
      artist: string | null;
      album: string;
      percent: number | null;
      bytes_per_second: number | null;
      peer: string | null; // Soulseek username
      task_id: string | null;
      status: string;
      error: string | null;
    }>; // ≤12 per lane, zone then age
  }>;
}
```

Writer: an `acquisition-sampler` daemon thread in crate-worker, never the serial service loop (a
slskd call can stall the scheduler and zombie cleanup). slskd calls use a 2 s timeout. Cadence:

- every 2 s only while `admin:live:viewers:acquisition` exists (set by `/api/acquisition/stream`,
  5.3.1);
- every 30–60 s while nobody watches but the previous sample showed an active transfer (a Tidal row
  downloading or a Soulseek transfer in progress), enough to keep `ops_runtime_state('acquisition')`
  and the release lifecycle reconciler current; a Soulseek or Tidal backlog lasts hours, so the
  2 s cadence never runs for nobody;
- not at all when idle and unwatched.

Samples go to the Redis key plus a publish; `ops_runtime_state('acquisition')` is written only when
the lane counts change or at most once per 60 s (5.3.2). Tests: no slskd call and no DB write while
idle with no viewers; with no viewer and an active transfer, at most one slskd call per 30 s;
cadence switches when the viewer key appears; a slow slskd marks the lane unavailable without
blocking; OpenAPI contract.

#### Upcoming, Bandcamp, Discover (P2 · M)

- Upcoming: month view as a 7-column cell grid (day numerals Bricolage 700, filled dot for a show,
  ring for a release); list grouped by month under `MonoLabel`s; releases link to the release rail;
  expanded shows use the shared ticket (4.18); popover filters become chip groups; the Admin
  `/api/upcoming` (`api/browse_artist.py:2038-2060`) adds `source` per show (Listen's
  `/api/me/upcoming` already returns it); the expanded card measures with `ResizeObserver` (setlist loads after
  expanding).
- Bandcamp: connection `StatusDot`; counts only if the payload already carries them; cover rows;
  match review with a confidence meter.
- Discover: completeness rows as row meters (`local_count / mb_count`, limit tick at 100%, sorted by
  gap); release radar uses the compact rail. Blocked by B5.

### 4.5 04 Enrichment: Artist Enrichment tab (P2 · L)

- **Purpose**: per artist, which sources were fetched, when they expire, what failed, and a live
  view of a refresh.
- **Focal visual**: EnrichmentOrbit (`site:src/components/viz/EnrichmentOrbit.astro`,
  `site:src/scripts/viz/enrichment-view.ts`, `pool-math.ts`) in a new `enrichment` tab of
  `pages/Artist.tsx` (before About), VizSplit 5fr/7fr: orbit and pool lanes on the left, source list
  and actions on the right.
- **Anatomy**:
  - Core: artist name, `enriched 2 d ago`.
  - Inner ring: the 6 artist sources with TTL arcs (Last.fm 7 d, Spotify 3 d, MusicBrainz 30 d,
    Setlist.fm 1 d, Fanart.tv 30 d, Discogs 30 d). Node states: fresh (filled), expired or error
    (amber stroke plus a short code), empty (hollow plus dash), never (hollow), unconfigured
    (dashed, shows the environment variable name), disabled (PD29).
  - Outer dashed ring: secondary coverage for this artist with provider-agnostic copy (`covers
11/12`, `artist photo`, `Wikidata linked`, `3 upcoming shows`, `84 lyrics`, `Bandcamp`); never
    animated by a run.
  - Pool lanes: the last real run, one lane per executor thread actually used, wait and fetch
    segments, cache hits as chips.
  - Right: `HairlineList` of the 6 sources with status word, fetched, expires, wait + fetch,
    error code and a `Refetch` chip; hover links row, node and bar.
- **Live**: the panel follows `/api/events/task/{id}` for its own refresh, an active run found in
  the status payload, or (best effort, ops capabilities only) a running enrichment task for this
  artist seen in the ops snapshot. Signals light spokes, draw packets with the previous fetch
  duration as period, fill lanes; `run_done` or `task_done` triggers one refetch.
- **Actions**: `Refresh expired` (expired, never and error sources; `Refetch all` with
  confirmation when everything is fresh); per-row `Refetch`; link to Settings > Enrichment for
  toggles (with `settings.manage`, `?section=enrichment`). The hero Enrich button keeps its current
  task (PD31) but stops reloading the page and switches to this tab.
- **Mobile**: under 760 px labels hide and secondary sources become chips.

Contract:

```ts
// GET /api/admin/artists/{artist_id}/enrichment/sources (+ /by-entity/{uid}); library.view.
// One CTE in db/queries/artist_enrichment_status.py plus one HGETALL. Zero library_tracks reads.
// Admin-only reads live under /api/admin/*: on the api.<domain> host Traefik sends GET /api/artists/ and
// /api/genres to the read plane first (docker-compose.yaml:460), and Admin's nginx proxies /api/ straight to
// crate-api, so the /api/admin prefix keeps every deployment on FastAPI with uniform capability gating.
interface ArtistEnrichmentSources {
  artist: {
    id: number;
    entity_uid: string | null;
    name: string;
    enriched_at: string | null;
  };
  parallelism: number;
  sources: Array<{
    id: "lastfm" | "spotify" | "musicbrainz" | "setlist" | "fanart" | "discogs";
    label: string;
    ttl_seconds: number;
    min_interval_seconds: number;
    configured: boolean;
    config_hint: string | null;
    enabled: boolean;
    status:
      | "fresh"
      | "expired"
      | "empty"
      | "error"
      | "never"
      | "unconfigured"
      | "disabled";
    fetched_at: string | null;
    attempted_at: string | null;
    expires_at: string | null;
    estimated: boolean;
    error_code: string | null; // codes only, never messages, URLs or keys
    last_run: {
      run_id: string;
      lane: number;
      start_ms: number;
      wait_ms: number;
      fetch_ms: number;
      outcome: "ok" | "empty" | "error" | "cache";
    } | null;
  }>;
  last_run: {
    run_id: string;
    task_id: string;
    started_at: string;
    threads: number;
    duration_ms: number;
  } | null;
  secondary: Array<{
    id: string;
    label: string;
    scope: "album" | "track" | "artist";
    done: number;
    total: number | null;
    approximate: boolean;
  }>;
  active_run: {
    task_id: string;
    run_id: string;
    started_at: string;
    sources: Record<
      string,
      {
        state: "queued" | "waiting" | "fetching" | "done" | "cache";
        lane: number;
        outcome?: string;
      }
    >;
  } | null;
}
// POST /api/artists/{artist_id}/enrichment/refresh {sources?: string[], force_all?: boolean}
//   → TaskEnqueueResponse {task_id, deduplicated}; library.metadata.write; 409 when no task id resolves.
// Live: /api/events/task/{task_id}?generic=1, event "task_event" with event_type "enrichment.source"
//   {artist_id, run_id, source, state: queued|waiting|fetching|done|cache|skipped|run_done, lane, ...};
//   Redis-only publish on crate:sse:task:{id} (no task_events row, no worker_logs, no global channel).
```

Backend: table `artist_enrichment_sources (artist_id, source)` PK, batched `unnest` upsert per run
in `db/jobs/`; `crate/enrichment.py` instrumentation (fetch outcome, lane from the thread name or 0
when inline, wait and fetch ms, `force_sources` that bypasses the 24 h minimum age and clears the
provider caches `spotify:artist:*`, `mb:detail:*`, `setlistfm:probable:*`), run key as a Redis hash
per source with a 600 s TTL, per-artist worker lock (dedup does not cross `process_new_content`
and `enrich_artists`); one-off `backfill_enrichment_sources` from Redis TTLs (estimated); fix V7
(`GET /api/artists/{id}/enrichment` returns cached data and enqueues instead of calling providers;
Listen's `use-artist-bio-enrichment.ts` sees `{}` on a cold artist); tighten the
`api/cache_events.py:490` regex so the new POST does not broadcast a `library` invalidation. Do not
reshape or mention `_ENRICHMENT_FETCH_ORDER`, `_SOURCE_TTLS_SECONDS`,
`_PROVIDER_MIN_INTERVAL_SECONDS` or the `enrichment_parallelism` literal above their definitions
(site drift test).

### 4.6 05 Genres `/genres`, `/genres/:slug` (P0 · L)

The genre taxonomy wheel is the key Admin feature. The taxonomy is real: 61 core genres, 14
families, 47 parent links, 102 related pairs, 4 relation types (`parent`, `related`,
`influenced_by`, `fusion_of`; the website design doc's "five" is wrong), 40 genres with their own EQ
and 21 that inherit, 17 EQ templates. Core seeds only `parent` and `related`; influence and fusion
edges come from MusicBrainz, AI proposals and curators.

#### 4.6.1 Page

- **Purpose**: see the whole taxonomy, where each genre's EQ comes from and what it drives, and
  curate relations, aliases and EQ.
- **Focal visual**: GenreWheel (`site:src/components/viz/GenreWheel.astro`,
  `site:src/scripts/viz/genre-view.ts`, `taxonomy-math.ts`) as the default view of `GenreList`,
  full-width band (wheel 7fr, inspector 4fr, stacked under 1000 px). The view toggle becomes Wheel /
  Tree / Grid; tree and grid stay as the list views and the accessible alternative (PD19).
- **Header**: `TAXONOMY crate-core 1.0.0 · ed25519` with a StatusDot that turns warn and reads
  `signature unverified` when the release is degraded; right label: digest prefix and
  `· N local overrides` (`totals.overridden_nodes`). Centre numeral: visible genre count. Legend as an
  inline `dl` (3.1.4): Families · Parent links · Related links · Relation types, plus Overlay and
  Unmapped (warn when > 0). A mono line lists `relation_types` from the payload.
- **Marks** (site styles): own-preset node filled fg at .55 (not cyan); inheriting node hollow; no
  preset in the chain = amber ring (status); local override (`flags.overridden`) = small `accent-action-hi` tick.
  Primary-parent edges are radial cubics; extra parents thin secondary arcs; related edges faint
  quadratics; influence and fusion edges hidden by default, shown through the relation-type chips.
- **Idle state**: no auto-walk. With nothing selected the inspector shows EQ coverage (direct /
  inherited / none with `eq_reach` in albums and tracks) and a chip row "Inheriting presets" with
  the 7 inheriting genres of largest reach (alphabetical until reach exists).
- **Hover or focus** (preview, no commit): lights the inheritance walk (`is-path` on `eq.path`
  nodes, `is-on` parent edges keyed by `child>parent`, `is-from` on the owner, `is-start` on the
  node) and the node's related edges; the readout shows `powerviolence → hardcore punk`, the preset
  name (template key, else the owner's name plus `custom curve`) in `accent-action-hi` with a
  scramble, `its own preset` or `inherited from X`; the mini EQ springs (140/15).
- **Click or Enter** pins. The inspector shows name and origin badge (core / overlay / local
  override), family, direct and roll-up counts as `StatNumber`s, the EQ block (4.6.2), relations
  grouped by the 4 types as `HairlineList` rows with textual provenance (`crate-core · locked`,
  manual, musicbrainz, ai_proposal, other), aliases with origin (`nodes[].aliases`), and `Open
genre`. Escape clears.
- **Modes**: chips `EQ coverage` (default), `Content` (radius and label weight by
  `rollup.artists`, empty dimmed), `Provenance` (edge alpha by source); 4 relation-type filters.
  Clicking a family label zooms its sector (layout over 300°, `ease-spring-smooth` transform).
  Until G3 ships (plan 2.18d), MusicBrainz sync stores its edges with `source='manual'`, the same value
  as curator edges; curator edges always set `created_by` (`api/genres.py:606,654`), so the builder
  maps `source='manual' AND created_by IS NULL AND NOT locked` to `other` and Provenance mode never
  labels a MusicBrainz edge as a curator's.
- **Curator actions** (`curation.genres.write`; `library.view` sees a read-only wheel):
  1. Edit EQ: `GenreEqEditor` in the inspector. When it opens, the wheel highlights the blast
     radius and the panel shows `applies to N genres · M albums · K tracks`. The blast radius is
     computed client-side from the wheel snapshot, never by a request-time aggregate:
     `genre-wheel-math` re-resolves `eq.path` for every node with the edited node's preset set and
     unset, diffs the owners, and sums `nodes[].eq.reach` (albums, tracks) over the nodes whose owner
     changes. The sum is exact because reach follows each track's single
     primary genre. For a node that currently inherits, multi-parent paths can switch, so the
     client mirrors Python's `resolve_genre_eq_preset` (`genre_taxonomy.py:1043-1095`): a BFS over
     parents sorted at each level, so the nearest owner wins and ties at equal depth resolve in path
     order. Go does not match it today: `genrePresetSQL` and the inline preset subquery
     (`readplane/internal/catalog/genre.go:369-405,447-471`) use `ORDER BY depth, slug`, the owner's
     slug. With owners `c` (via parent `b`) and `z` (via parent `a`) both at depth 2, Python picks
     `z` and Go picks `c`. Plan 2.18a moves Go to `ORDER BY depth, path COLLATE "C"` with the path
     compared element-wise as a `text[]` (a joined string would sort `a-b` before `a`), and the G2
     parity test (plan 2.18d) pins it. The `a`/`b`/`z`/`c` case goes into the `genre-wheel-math`
     tests and the Python/Go parity tests. Save via `PATCH /api/genres/{slug}/eq-preset`.
  2. Link mode: pick a relation chip, click targets; provisional edges draw in; save via
     `PUT /api/genres/taxonomy/{slug}/relations`. Locked core edges cannot be deleted. After G1, a
     curator can hide a locked core edge on this server (PD18): the same PUT accepts
     `{target, type, suppressed: true}` for a locked edge (and `false` to show it again), which sets
     `genre_taxonomy_edges.suppressed` (migration with G1, plan 2.18d); suppressed edges leave the
     runtime graph, so inheritance and roll-ups follow. The inspector offers `Hide on this server` /
     `Show again` on locked rows; the wheel draws suppressed edges only in Provenance mode, dashed.
     Parent targets that would form a cycle are disabled (server enforces after G7).
  3. Unmapped tags: the readout opens the top 50; selecting a raw tag highlights candidates (name
     match, or the existing proposal endpoint when the LLM is available); clicking a node assigns
     the alias. Raw tags are never drawn as nodes.
  4. Existing task buttons (index, infer, MusicBrainz sync, descriptions, cleanup, rebuild
     proposal) stay in the header; on completion the wheel refetches and new nodes and edges draw
     in (positions transition by transform; path `d` cross-fades).
  - G1, G2, G3, G7 and suppression (plan 2.18d) ship in the Genres group before the wheel (plan
    3.7), so EQ writes on core genres stay enabled and nothing is disabled in any release.
    `Generate with AI` loads as an unsaved edit instead of applying (PD18).
- **States**: loading (labels plus orbits, legend `—`); warming (`BUILDING` plus pulse, waits on the
  returned task); stale (`updating`); empty library (structure still drawn, Content mode dimmed,
  `Index genres` CTA); unplaced sector after a dashed separator for orphans and overlays with no
  path to a family; cycle flagged with an amber ring; empty overlay genres collapsed into `+N` per
  sector with a `Show empty genres` toggle; error with retry while Tree and Grid keep working.
  Mutation responses patch local state at once (the 30 s per-process revision TTL means a refetch
  can be stale).
- **Level of detail**: ring-1 labels always; rings 2–3 labelled only for the hovered or pinned node,
  its walk and neighbours, and the top N per sector; related edges all drawn at .06 only up to 300
  pairs. Depth 3+ gets extra rings (`256 + 34 · (ring − 3)`) or a clamp with a list. These rules
  are tuned for the 61 core nodes; MusicBrainz sync adds an overlay node for every related genre it
  meets, and the production overlay is unmeasured. Before plan 2.18b and 3.7, run one read-only
  production query (plan Task 0.14, with Diego's approval): nodes by origin, orphans, unmapped raw
  tags, and edges grouped by `source`, `locked` and `created_by IS NULL`. Top N, the 300-pair threshold, the
  unplaced sector and the `+N` collapse are set from those numbers.
- **Accessibility**: figure sentence (`61 genres in 14 families; 40 have their own EQ, 21
inherit`); SVG `role="group"`, nodes focusable `<g>` with labels (`thrash metal, metal family,
inherits thrash from metal, 12 artists`); roving tabindex (left/right along the ring, up/down
  to parent or first child); `/` focuses a search combobox matching names and `nodes[].aliases`
  (tested with an alias-only query).
- **Genre detail `/genres/:slug`**: compact locator (family sector, walk, direct neighbours) next to
  `GenreEqEditor`. The walk renders outside the curator gate so `library.view` users see it.
  `GenreNetworkGraph` (react-force-graph-2d) is retired once the locator ships (PD19). The dead
  "Generate playlist" action (`GenreTaxonomyTree.tsx:951`) goes (G9).
- **Tree and grid residue**: tree as a `HairlineList` with indentation, mono counts and an EQ-source
  dot; grid as `GenrePill`s; the amber "needs taxonomy mapping" box becomes a status note with a
  count. The tree inspector passes `initialGains` only for direct presets (today it passes resolved
  gains, so inheriting nodes show "Direct preset" and Save would persist inherited gains).

#### 4.6.2 EQ inheritance panel (both apps)

- Admin: the inspector EQ block and the `GenreEqEditor` header. `MonoLabel` `GENRE EQ · inherited
from the nearest preset`; walk path in mono (each segment selects that genre); preset word in
  Bricolage 800 `accent-action-hi`; source line (`its own preset`, `inherited from hardcore punk`, or
  warn dot `no preset · plays flat`); 10-band mini EQ bars (`--g` per bar, written by ref, signed
  values with 0.1 dB precision via the shared `formatGain`); `drives 312 albums · 3,904 tracks`
  when reach exists; chips of genres inheriting this preset (at most 12 plus `+N`). Clear previews
  the result first (`powerviolence will inherit hardcore from hardcore punk` after a local preset
  on powerviolence is cleared), computed client-side from the payload.
- Listen: a compact read-only walk under the Smart EQ chain when the source is the genre preset,
  and in Genre adaptive mode instead of the v2 chip box; segments link to `/explore?genre=<slug>`.
- Shared piece: `@crate/ui/domain/genres/GenreEqWalk.tsx` (presentational, copy by props, token
  utilities only), adopted by both apps in one change.

#### 4.6.3 Contracts and backend

```ts
// Admin: GET /api/admin/genres/wheel (library.view). Snapshot only:
//   200 {status: "ready" | "stale", ...GenreWheelPayload} | 200 {status: "warming", task_id: string | null}
// Admin-only, so under /api/admin (see 4.5: never routed to the read plane). The handler returns the stored
// JSON as is: the response model documents the schema in OpenAPI, and the builder validates once at write
// time, not per request. Payload budget: set from Task 0.14's production numbers and recorded in the PR
// (target ≤ 300 KB gzip). Aliases stay inline with their origin while the payload fits; if it does not,
// aliases become plain strings (enough for the "/" search) and the inspector reads alias origin per node
// from a small GET /api/admin/genres/{slug}/aliases (one query scoped by the node's id).
type RelationType = "parent" | "related" | "influenced_by" | "fusion_of";
interface GenreCounts {
  artists: number;
  albums: number;
  tracks: number;
}
interface GenreWheelPayload {
  taxonomy: {
    id: "crate-core";
    version: string;
    digest: string;
    released_at: string | null;
    key_id: string | null;
    release_status: "ok" | "degraded";
    revision: string | null;
  };
  relation_types: RelationType[]; // from VALID_RELATION_TYPES
  eq_templates: Record<string, number[]>; // _EQ_* plus flat
  totals: {
    nodes: number;
    families: number;
    parent_edges: number;
    related_pairs: number;
    overlay_nodes: number;
    overridden_nodes: number; // nodes with flags.overridden
    unplaced_nodes: number;
    eq: { direct: number; inherited: number; none: number };
    eq_reach: Record<
      "direct" | "inherited" | "none",
      { albums: number; tracks: number }
    >;
  };
  families: Array<{
    slug: string;
    name: string;
    order: number;
    node_count: number;
    counts: GenreCounts;
  }>;
  nodes: Array<{
    slug: string;
    name: string;
    origin: "core" | "overlay";
    top_level: boolean;
    family: string | null;
    primary_parent: string | null; // sorted-first parent, same order as the BFS
    parents: string[];
    depth: number;
    alias_count: number;
    aliases: Array<{
      alias: string;
      origin: "core" | "manual" | "inferred" | "legacy";
    }>; // genre_taxonomy_aliases.origin
    counts: { direct: GenreCounts; rollup: GenreCounts };
    eq: {
      source: "direct" | "inherited" | "none";
      from: string | null;
      path: string[]; // live value: COALESCE(local, core)
      template: string | null;
      gains: number[] | null; // gains only when template is null
      overridden: boolean; // eq_override <> 'none'
      reach: { albums: number; tracks: number };
    };
    flags: {
      orphan: boolean;
      cycle: boolean;
      multi_parent: boolean;
      empty: boolean;
      overridden: boolean;
    }; // eq_override <> 'none' OR local_name IS NOT NULL OR local_description IS NOT NULL
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: RelationType;
    provenance:
      | "crate-core"
      | "manual"
      | "musicbrainz"
      | "ai_proposal"
      | "other"; // see Modes
    locked: boolean;
    suppressed: boolean;
    confidence: number;
  }>; // related deduplicated as unordered pairs
  unmapped: {
    total: number;
    top: Array<{
      slug: string;
      name: string;
      artist_count: number;
      album_count: number;
    }>;
  };
  snapshot: SnapshotMeta; // decorate_snapshot
}
// Mutation responses (eq-preset PATCH, generate-eq apply, relations PUT incl. suppression, aliases PUT,
// taxonomy PATCH, both DELETEs) gain wheel_patch: {revision, nodes (structure and eq only), edges?,
// refresh_task_id: string | null}.

// Listen phase 2: GET /api/catalog/genre-wheel (auth). Go read plane relay of
// ui_snapshots('genre-wheel','crate-core'); the FastAPI fallback reads the same row. A missing row returns
// {status: "warming"} and Listen hides the wheel (as it does on 404 from an older server).
interface ListenGenreWheelPayload {
  status: "ready" | "stale" | "warming";
  taxonomy: { id: "crate-core"; version: string; digest: string };
  families: Array<{
    slug: string;
    name: string;
    order: number;
    node_count: number;
  }>;
  nodes: Array<{
    slug: string;
    name: string;
    family: string | null;
    primary_parent: string | null;
    parents: string[];
    depth: number;
    rollup: { artists: number; albums: number }; // counts follow the catalog serving mode
    eq: {
      source: "direct" | "inherited" | "none";
      from: string | null;
      path: string[];
      template: string | null;
    };
  }>; // core nodes only
  edges: Array<{ source: string; target: string; type: RelationType }>; // no provenance, lock or suppression flag
  snapshot: SnapshotMeta;
}
// Core nodes only: no unmapped tags, overlay nodes, provenance, suppression flags or custom gains. eq.* is
// resolved from the live, override-aware runtime graph (the one Smart EQ and /eq genrePath use), so a curator
// override on a core genre shows the same source and path here as in the EQ panel; a custom curve reads
// template null. Suppressed edges are absent, as in the runtime graph. Written by the same
// refresh_genre_wheel_snapshot run as the Admin row (one more upsert), and scheduled through the same
// coalescing when the global catalog serving mode flips. Listen maps /api/catalog/genre-wheel to its own
// genre_wheel invalidation scope (5.3.5); the run broadcasts it only when this row's payload digest changes.
```

Count rules (shared with the Listen genre page, PD21): artist member when `weight >= 0.70`; album
member when `GREATEST(album_weight, artist_weight * 0.70) >= 0.45`; union across aliases; track
counts from `library_albums.track_count`; never `library_tracks`. Reach follows
`_pick_track_primary_genre` (first canonical album genre by weight then name, else the artist's
genres), weighted by album track count.

Backend, in order (genres.md section 10 with the verification corrections):

1. Wheel builder `db/jobs/genre_wheel.py` plus orchestration `db/genre_wheel_surface.py`
   (serve-stale pattern of `instance_stats_dashboard_surface.py`): read `genre_taxonomy:revision`
   first; one CTE over `artist_genres`, `album_genres`, aliases and `library_albums`; structure,
   path, template and flags from the runtime graph after invalidation; roll-ups as set unions over
   runtime-graph descendants; explicit read of node origin, edge provenance and alias origin. The
   same transaction writes per-genre thresholded counts (PD21 rules) to a `genre_counts` table
   (`genre_id` PK, `artists`, `albums`, `tracks`, `computed_at`), which item 6 points the Go read
   plane at.
2. Triggers through `schedule_genre_wheel_refresh()` with trailing-edge coalescing (5.3.2, due set,
   key `genre-wheel:local`) and a window of at least 120 s; the handler clears the dirty key before
   building and schedules again if it is set during the build. Triggers come from the choke points
   that change genre membership or taxonomy, not from a list of tasks:

   - `set_artist_genres` and `set_album_genres` (`db/repositories/genres_assignments.py`) call it
     after commit, only when the stored set changed. That covers `index_genres`
     (`genre_indexer.py`), `enrich_artist`/`enrich_artists` writing Last.fm tags
     (`enrichment.py:487`), the scoped `POST …/enrichment/refresh` (4.5) and `process_new_content`;
     bulk enrichment is absorbed by the coalescing window;
   - the direct `artist_genres` writers in `db/jobs/repair_artist_jobs.py` (artist rename and
     merge), artist and album deletion, and genre deletion (`db/repositories/genres_delete.py`);
   - curator taxonomy mutations through `invalidate_runtime_taxonomy_cache_after_commit(session)`;
   - a nightly floor, like the mood map and insights, so counts, `eq.reach` and the client blast
     radius are never stale for more than a day even if a writer is missed.

   No generic `library` invalidation trigger: `library` reaches the projector on every cover, tag,
   crate and enrichment change (`api/cache_events.py:470-500`). Batch jobs (MusicBrainz sync,
   cleanup, infer) suppress per-row invalidation: today `sync_musicbrainz_genre_graph_batch` calls
   `upsert_genre_taxonomy_node`/`_edge` without a shared session, so every row commits and
   invalidates on its own. They publish one revision and one schedule at the end of the task. PD23
   decides whether `genre:*` invalidations reach the projector.

3. Task `refresh_genre_wheel_snapshot` (`TaskPoolConfig("fast", 1, 300, 1)`) registered in
   `actors.py`, the `worker.py` handler groups, `task_registry.py` and a handler dict.
4. `resolve_genre_eq_preset` returns `path` and `template`; one Python helper builds preset
   payloads with the path for `equalizer.py:443`, `browse_media.py:809` and `api/catalog.py:1098`
   (the last returns `preset: None` for global-catalog tracks today, so Genre adaptive mode on
   global uids never gets a preset); export `EQ_TEMPLATES` without changing the `_EQ_*` literals.
5. G1 (migration, plan 2.18d, in the Genres group before the wheel ships): curator overrides live
   in new columns the pre-v3 seeder never writes, so an image rollback cannot overwrite them (the
   old seeder runs on every boot and rewrites `eq_gains`, `name` and `description` of core genres,
   `db/jobs/genre_taxonomy.py:219-252`).

   - `genre_taxonomy_nodes.local_eq_gains`, `eq_override` (`none | set | cleared`; `cleared` makes
     "clear to inherit" representable on a core node), `local_name`, `local_description`;
     `genre_taxonomy_edges.suppressed` (PD18; the seeder never clears it and the runtime graph
     skips suppressed edges).
   - `eq_gains`, `name` and `description` keep meaning "the core release value"; the seeder
     refreshes only those. The live value is `COALESCE(local, core)`, with `eq_override =
'cleared'` meaning inherit.
   - The PATCH endpoints write the `local_*` columns; "reset to core" clears them.
   - `nodes[].eq.overridden` is `eq_override <> 'none'`; `flags.overridden` and
     `totals.overridden_nodes` use `eq_override <> 'none' OR local_name IS NOT NULL OR
local_description IS NOT NULL`.

   G2: the DB is authoritative; NULL means inherit; Go reads the same live value and moves to the
   path tie-break (4.6.1), with a parity test. G3: MusicBrainz edges get `source="musicbrainz"`;
   the health AI filter reads `ai_proposal`. G7: parent-cycle guard (400).

6. Remove request-time aggregates:
   - FastAPI: `/taxonomy/tree` counts and Sound Intelligence health read the snapshot (B7); catalog
     and explore fallbacks serve stale and enqueue; the per-request ed25519 verification in
     `/api/catalog/genres` moves to the builder.
   - Go read plane (plan 2.18c): `GET /api/genres` (`catalog/store.go` `genresSQL`: a full
     `GROUP BY` over `artist_genres` and `album_genres`, a non-sargable `OR` join on aliases and a
     `LATERAL` per row, on every request, with no thresholds) and the per-request counts in genre
     detail (`genre.go` `relatedGenresSQL`) read `genre_counts` instead, so Listen and Admin see one
     count definition (PD21) and no request computes it. Go table tests and the read-plane contract
     smoke cover both.
7. `eq_preset_path` and an `eq_clear_effective` flag on `/taxonomy/tree` nodes and on the PATCH
   response (FastAPI-only routes). Exposing the path on the genre detail requires the same change in
   the Go read plane (`genre.go`) or the read-plane contract smoke fails.
8. Hygiene: runtime de-duplication of the dangling `folk → americana` (code fix waits for a signed
   release, PD22); Go family-map drift test (G10).

Tests for this list: 100 triggers inside the window produce one build that includes the last
change; a MusicBrainz sync of N rows schedules once; an `enrich_artist` run that changes an
artist's tags schedules exactly one build after the window, and one that leaves the set unchanged
schedules none; the provenance fallback maps legacy MusicBrainz edges to `other`; suppression (a
locked edge can be suppressed and shown again, never deleted; non-curators get 403; a suppressed
parent edge changes `eq.path`); aliases with origin in the payload; the Listen row carries core
nodes only, and an overridden core node's Listen `eq.path` equals the `/eq` `genrePath` for a track
in that genre; G1 rollback safety (the pre-v3 seeder SQL, copied verbatim into a fixture, run over a
v3 row with overrides leaves every override intact; seed, edit and reseed keep the edit; reset
restores core); `genre_counts` matches the snapshot counts; the Go `genresSQL` and genre detail
read it (Go table tests, contract smoke); the stored payload is served without per-request
validation and stays within the recorded budget.

Frontend: `app/ui/src/components/genres/{GenreWheel,GenreWheelInspector,GenreEqInheritancePanel,
MiniEqBars}.tsx`, `app/ui/src/lib/genre-wheel-math.ts` (port of `buildTaxonomy` and `radialLayout`
with visited-set guards, unplaced sector, ring extension, LOD, and the blast-radius re-resolve
in Python's BFS path order (4.6.1); copy the site tests plus cycle, multi-parent, orphan and
blast-radius cases, including the `a`/`b`/`z`/`c` equal-depth case). Only `stepSpring` is ported from `eq-math.ts`; `formatGain` comes
from `EqBands`; `resolveEq` is only used for previews and the blast radius; `genreRoute` is not
ported (the server owns routes). SVG with refs and `classList`, memoised on revision; hover is O(degree). Listen adoption
(Explore desktop wheel and genre-page locator, 4.14) moves `GenreWheel` and the math to
`@crate/ui/domain/genres` in that change.

Site coupling: `site:src/content/admin/viz.test.ts` parses `_RAW_GENRE_DEFINITIONS`, the
`eq_gains=_EQ_X` syntax, `VALID_RELATION_TYPES` and the release JSON; and
`site:src/content/listen/viz.test.ts` reads `EQ_PRESETS` in `app/listen/src/lib/equalizer.ts`. Keep
those shapes and that file where they are. Adding task types or migrations requires regenerating the
site's `src/data/scale.json`.

### 4.7 06 Analysis & Insights

#### Analysis `/analysis` (P1 · L)

- **Focal visual**: TrackReadout (`site:src/components/viz/TrackReadout.astro`,
  `site:src/scripts/viz/analysis-view.ts`) as "Latest analysed", replacing `RecentTrackCard`s. The
  page reorganises into Coverage (left, 5fr) and Latest analysed (right, 7fr).
- **Readout anatomy**: title in display (truncate with `title`, scrambled on arrival in Admin only);
  four figures as a `dl` (BPM; key as `D major` plus Camelot computed client-side; loudness in
  `dB`; dynamic range in `dB` with an "analyser estimate" tooltip); five feature bars (energy,
  danceability, valence, acousticness, instrumentalness); bliss strip of 20 bipolar bars
  (`scaleY(clamp(v, −1, 1) * −1)`); up to 6 track chips with "Latest" following new arrivals
  (a chip pins; no hold timer); 8 nearest neighbours under the strip (title, artist, mono distance;
  links to the album with `?track=`).
- **Coverage panel**: one row per pipeline (features, bliss, fingerprints, lyrics, portable
  metadata; Smart Mix after its merge): stacked hairline bar (done `accent-action-hi`, active
  `accent-action`, pending track, failed `state-warning`), mono `39,876 / 48,112 · 1.2% failed`,
  backfill actions as ghost chips with live state from the ops stream. The empty-state CTA is not
  "Re-analyze all" (it resets the whole library); the copy says the daemons process pending tracks.
- **Smart Mix row** (after the merge, plan 5.14 item 3; the site's Analysis chapter sells
  "Backfills you control": the profile backfill can be paused, resumed and cancelled). Today
  `sm:app/ui/src/components/SmartMixCoverage.tsx` renders it with `idle | running | paused` from
  `sm:app/crate/api/smart_mix_admin.py`. In v3 it is one row of the Coverage panel: the stacked bar
  and mono count as the other rows; `StatusDot` plus the word `idle`, `running` or `paused`;
  `Start`, `Pause` and `Resume` as `CratePill` actions (`POST /api/admin/smart-mix/backfill`,
  `/backfill/pause`, `/backfill/resume`); `Cancel` through `ConfirmDialog` stating that the
  campaign stops and completed profiles stay (`/backfill/cancel`). Campaign state comes from
  `GET /api/admin/smart-mix/status`, refetched after each action and on the backfill task's
  `task_done` (no new stream, no polling). Tests: each control state shows only its valid actions;
  Cancel asks first; a `task_done` refetches once.
- **Data**: the coverage counters come from `ops_runtime_state('analysis_status')`, written by the
  crate-worker service loop (`worker.py:449-470`, from `db/jobs/analysis_status.py`). Most fields
  exist already: analysis and bliss counters (done, pending, active, failed), fingerprint
  `fingerprint_done`, `fingerprint_pending`, `fingerprint_chromaprint`, `fingerprint_pcm`, and,
  through `get_portable_metadata_status()` (`db/repositories/portable_metadata.py:135`, spread at
  `db/jobs/analysis_status.py:173`), `total_tracks`, `total_albums`, `lyrics_cached`,
  `lyrics_found`, `lyrics_missing`, `portable_sidecar_albums`, `portable_audio_tag_albums`,
  `portable_audio_tag_tracks`, `portable_tag_errors`, `rich_export_albums` and
  `rich_export_tracks`. Nothing declares them, so the GET drops them. The Coverage rows read these
  existing names. Changes (plan 3.9a, 3.10a):

  - `AnalysisStatusResponse` and `_empty_analysis_payload` declare the existing lyrics and
    portable fields plus `recent`, `stale`, `unavailable` and `updated_at`.
  - New: `fingerprint_failed` (one more `FILTER` in the existing query); `recent` (6 items) in the
    ops snapshot `analysis` block, built off-request; `portable_drift` (null until 4.3's columns
    exist), counted as `catalog_changed_at > sidecar_written_at` over `album_portable_metadata`
    (4.3), never by building per-album payloads (about 3 queries per album, about 13K queries per
    run).
  - Cadence split: the cheap `track_processing_state` `GROUP BY` stays at 120 s. The full scans
    (the lyrics `MATERIALIZED` regexp CTE over every `library_tracks` row, the fingerprint counts,
    the portable counts and drift) move to a 15 min step, run sooner when the lyrics, fingerprint or
    portable tasks set a dirty flag. Counting any of them in a request would break the
    `library_tracks` rule.

  Tests: pytest (pg_db) for `fingerprint_failed` and the drift count; the declared fields
  round-trip through the schema; the 120 s step issues no per-album query and runs the lyrics CTE
  at most once per 15 min unless the dirty flag is set.

#### Album readout (Admin) and Info tab (Listen)

- **Visual target reaffirmed 2026-10-16:** Diego's site reference is the Admin Audio Profile
  direction: large figures with top rules, five thin feature bars and bipolar Bliss values,
  without metric cards or icons. Checkpoint 1F only repairs contrast on the legacy component;
  it is not the final design. The app keeps V3 tokens and honest units (`dB` until validated LUFS),
  no marketing grain or automatic cycling. Implementation remains Task 3.9b with its prerequisites.
- Admin Album: the readout replaces `AudioProfileCard` and the per-track radar tooltip; `TrackTable`
  selects the track. The existing `Analyze` header button becomes `Re-analyse album`
  (`library.analysis.manage`, deduplicated); after `done` the panel refetches and then polls the
  album endpoint every 10 s while tracks are pending or analysing (visible page only, 10 min cap),
  because the task only resets state and the daemons do the work. The readout keeps today's
  tooltip's top-3 moods as `mood_top` (PD26); spectral complexity is dropped.
- Listen Info tab (`components/player/extended/InfoTab*`): compact readout with the same component;
  it keeps the previous item while `useTrackInfo` loads so values spring between cached tracks;
  replaces `InfoTabAudioProfile`, `InfoTabBliss`, `InfoTabQuietMetrics` and the duplicate loudness
  rows in `InfoTabSource`; no palette tint, no `tone="warm"`; reuses `player.info.metric.*` keys.
- Shared component: `@crate/ui/domain/analysis/TrackReadout.tsx` (props only; title slot for the
  Admin scramble; reduced-motion prop) because both apps render it in the same change; Camelot in
  `@crate/ui/lib/camelot.ts` with enharmonic support and a fixture shared with pytest against
  `app/crate/camelot.py`.

Contract:

```ts
interface TrackAnalysisItem {
  track: {
    id: number;
    entity_uid: string | null;
    title: string;
    artist: string | null;
    album: string | null;
    album_id: number | null;
    disc_number: number | null;
    track_number: number | null;
  };
  state: {
    analysis: "done" | "pending" | "analyzing" | "failed";
    bliss: "done" | "pending" | "analyzing" | "failed";
    analysis_completed_at: string | null;
    bliss_computed_at: string | null;
    attempts?: number;
    last_error?: string | null;
  }; // last two only with library.analysis.manage
  figures: {
    bpm: number | null;
    key: string | null;
    scale: "major" | "minor" | null;
    loudness: number | null;
    dynamic_range: number | null;
  }; // labelled dB in v3 (PD25)
  features: {
    energy: number | null;
    danceability: number | null;
    valence: number | null;
    acousticness: number | null;
    instrumentalness: number | null;
  }; // clamped 0..1
  bliss: { vector: number[] | null }; // 20 floats, clamped to [-1, 1], 3 decimals
  mood_top: Array<{ mood: string; score: number }> | null; // ≤3, highest scores from mood_json (PD26)
}
// GET /api/admin/albums/{album_id}/analysis (+ by-entity) → {album_id, items}: one CTE, album_id index.
// GET /api/admin/tracks/{track_id}/neighbours?limit=8 (1..12): get_track_bliss_neighbours, HNSW probe
//   with "bliss_embedding IS NOT NULL", "id <> :id" and playable_track_clause; returns album link fields.
// Ops snapshot analysis.recent: TrackAnalysisItem[] (≤6, no attempts/errors).
// Listen: /api/tracks/{id}/info (+ by-entity, by-storage, catalog) adds bliss_vector (20 | null),
//   rounded and clamped identically in FastAPI and Go; the read-plane smoke asserts the shape;
//   federation allowlist validates length ≤ 20.
```

Queries live in `db/queries/track_analysis_readout.py` (not `portable_metadata.py`, whose literal
lines the site reads); `mood_top` is computed in the serializer from the `mood_json` the album
query already reads (serializer and test steps in plan 3.9a/3.9b). Camelot moves to a new
`app/crate/camelot.py`: today `CAMELOT` lives in `crate/bliss.py:31` and Essentia's flats (`Bb`,
`Eb`, `Ab`) fall back to neutral key compatibility. The new module is
`sm:app/crate/smart_mix/camelot.py` (which already handles enharmonics and which Smart Mix's
`bliss._key_compatibility` uses), moved in a small `[MAIN]` PR tagged `[BEHAVIOUR]` that both
branches use (PD2); `bliss.py` and the Paths serializer (4.16) import it. v3 does not write a second
copy.

#### Insights `/insights` (P1 · M, blocked by B5)

Nivo theme (3.1.5 Charts) and small multiples. Every panel `pages/Insights.tsx` renders today gets
a treatment:

| Panel today                                                                                                                                         | v3 treatment                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Summary tiles (Countries, Decades, Feature Coverage, Standouts Surfaced, Most Represented Genre, Collection Center of Gravity, Best-Mapped Feature) | one `StatStrip`; text values as a `GenrePill` or a mono value            |
| Genre Footprint                                                                                                                                     | top genres as `GenrePill`s plus hairline bars                            |
| Artists by Country                                                                                                                                  | hairline bar rows (mono country, count, share), top 12 plus `+N`; no map |
| Albums by Decade                                                                                                                                    | hairline histogram                                                       |
| Artist Momentum                                                                                                                                     | hairline rows with mono listeners and popularity                         |
| Album Standouts                                                                                                                                     | cover row with mono meta                                                 |
| Artist Depth vs Popularity                                                                                                                          | Nivo scatter, `accent-action-hi` points at .35, object-card tooltip      |
| Feature Coverage                                                                                                                                    | `Meter` rows per feature                                                 |
| BPM Distribution                                                                                                                                    | Nivo bar histogram                                                       |
| Energy vs Danceability                                                                                                                              | Nivo scatter, `accent-action-hi` at .35                                  |
| Acousticness vs Instrumentalness                                                                                                                    | Nivo scatter, same recipe                                                |

Contract:

```ts
// GET /api/insights (auth, unchanged) → ui_snapshots('insights','global') by PK, stale-first, max age 24 h;
// cold → the empty shape plus snapshot {version: 0, stale: true, pending: true}. Never builds in the request (B5).
interface InsightsResponse /* existing fields unchanged: countries, bpm_distribution, energy_danceability,
  top_genres, popularity, albums_by_decade, feature_coverage, artist_depth, top_albums, acoustic_instrumental */ {
  snapshot: SnapshotMeta; // declared in the response model
}
```

Writer: `refresh_insights_snapshot` (maintenance queue, deduplicated) runs today's 10+ queries as
one transaction off-request, nightly and after `process_new_content` and analysis backfills through
trailing-edge coalescing with a 30 min window (5.3.2). Tests: pytest (pg_db) for the builder, the
endpoint never building (builder patched to raise) and the cold shape; OpenAPI contract; Vitest per
panel state.

### 4.8 07 Operations

#### Tasks `/tasks` (P0 · L)

- **Focal visual**: QueueLanes (`site:src/components/viz/QueueLanes.astro`,
  `site:src/scripts/viz/queue-view.ts`) as a full-width band headed `OPERATIONS · 125 task types ·
five queues`, with GovernorGauges embedded below. Replaces the per-pool chips of
  `WorkerControlPanel` and the `ActiveTaskCard` list as the live view.
- **Lanes**: maintenance, default, fast, heavy, playback. Lane meta: queue name in mono
  `accent-action-hi`, live load numeral (running + pending; PD35 if the site's type count is
  preferred), mono meta with type count and consumers (`maintenance-worker ×1`; default and fast
  share `worker ×3`, fast also `fast-worker ×2`; heavy shows the analysis and bliss daemon state
  because analysis work runs in daemons, not heavy tasks); `no consumer` with a warn dot when no
  heartbeat.
- **Chips**: real tasks in three zones (queued 0–34%, running 34–84%, done 84%+). Queued: top 5 by
  priority then age, packed by available width, plus `+N`. Running: all running, delegated and
  completing tasks (cap 10), non-overlapping, fill = real percent (none when total ≤ 0, elapsed
  time in a fixed-width slot instead, written by the lane's 1 s timer, 3.1.3). Done: latest
  finished chip plus a count, static in `text-text-subtle` (failed carries the word). Governed types dashed; deferred pending chips amber
  with `waits · 14:05` and the reason in the title. Chips are `<button>`s keyed by task id with a
  roving tabindex per lane; selecting one opens the existing detail, the only place a per-task
  stream opens (fixes B10).
- **Header actions** (`CratePill` action variant): `Restart crate-worker` (confirm; it is the queue
  writer, so the band goes stale during restart), `Cancel all`, whose confirm copy states the real
  cap: `api_cancel_all_tasks` (`api/tasks.py:418-428`) calls `list_tasks` once for `running` and
  once for `pending`, each with the default `limit=50` (`db/queries/tasks.py:75-77`), so one click
  cancels at most 50 running and 50 pending tasks (with 300 pending, 250 stay). The copy says "at
  most 50 running and 50 pending per click" (Vitest asserts it) until the endpoint changes; a
  single bounded `UPDATE` would change the copy in the same PR. The slots stepper goes: it only
  affects the legacy orchestrator. No `fresh=1`.
- **Below**: `StatStrip` (today, completed, failed, success rate, average duration); history table
  with filter chips and `?queue=` (needs a pool filter on the history query); "Needs attention"
  amber rows with retry; repair runs with a risk meter; playback delivery as `Meter`s (the 15 s
  poll stays); task detail drawer with a progress hairline, phase line and the terminal log recipe.
- **States**: loading with lane rows from the catalog; idle (`all queues idle · last task 3 min
ago`); stale when `generated_at` is older than 45 s (`stale · 2 min`, fills frozen); reconnecting.
- **Accessibility**: figure sentence rebuilt per snapshot; polite region announces only failures
  and deferral start or clear, throttled; zone captions decorative.
- **Motion**: chip positions follow targets with exponential smoothing, written by ref in one
  visibility-gated rAF that stops once every chip has settled, even while tasks keep running (a
  running task alone never keeps a 60 fps loop alive); reduced motion places chips at final
  positions with no loop. Test: the loop stops after settle while a task is still running.

```ts
// GET /api/admin/queues (ops.tasks.manage) → ui_snapshots('ops:queues','global'), never builds;
// {warming: true, task_types, queues: [...static counts]} when missing.
interface QueuesSurface {
  generated_at: string; // excluded from the change hash
  task_types: number;
  queues: Array<{
    queue: "maintenance" | "default" | "fast" | "heavy" | "playback";
    task_types: number;
    consumers: Array<{ service: string; processes: number }>; // [] means no live consumer
    daemons?: { analysis: string; bliss: string }; // heavy lane only
    pending: number;
    running: number;
    deferred: number;
    oldest_pending_at: string | null;
    completed_5m: number;
    failed_5m: number;
    running_tasks: Array<{
      id: string;
      type: string;
      status: "running" | "delegated" | "completing";
      started_at: string;
      percent: number | null;
      item: string | null;
      governed: boolean;
    }>;
    pending_tasks: Array<{
      id: string;
      type: string;
      created_at: string;
      priority: number;
      governed: boolean;
      deferred: { family: string; reason: string; until: string } | null;
    }>;
    recent: Array<{
      id: string;
      type: string;
      status: "completed" | "failed" | "cancelled";
      finished_at: string;
      duration_ms: number | null;
    }>; // finished_at = updated_at
  }>;
  db_heavy_gate: { active: number; pending: number; blocking: boolean };
}
// GET /api/admin/task-catalog adds per type: queue, priority, governed, db_heavy, listener_sensitive,
//   maintenance_window: "none" | "unscoped" | "unscoped_or_large_limit"   (see the governor header below)
```

Backend:

- Query: one CTE in `db/queries/task_queues.py`: per-pool counts on active statuses; pending top N
  as one `LATERAL` per pool (`WHERE status = 'pending' AND pool = :p ORDER BY priority, created_at
LIMIT 5`, plus a `pool IS NULL` branch read as `default`), which uses the partial index
  `(pool, priority, created_at) WHERE status = 'pending'`. Not `ROW_NUMBER() OVER (PARTITION BY
COALESCE(pool,'default') …)`, which sorts every pending row on each run (thousands during an
  import or enrichment backlog) and cannot use that index. Running rows, recent terminal rows and
  5-minute throughput bounded by a `created_at` bound or a partial index on terminal rows, checked
  with `EXPLAIN` on production; deferred counted by a canonical progress prefix, never a jsonb cast.
- Payload assembly in `crate/ops_queues.py` (outside `db/`).
- Writer: a dedicated `queue-lanes-writer` daemon thread in crate-worker, not the serial service
  loop (there it would stall behind `ImportQueue.refresh_pending_state()`, a filesystem walk, and
  the scheduler). `publish_tasks_surface_signal` fires after every `update_task` progress write, so
  with any active task the dirty flag is always set; the writer therefore:

  - while `admin:live:viewers:queues` exists (5.3.1): honours the dirty flag, never rebuilding more
    often than every 3 s, and upserts `ui_snapshots('ops:queues','global')` when the hash changes,
    the row is missing (for example after a `*` invalidation) or 30 s have passed (keepalive; the
    client marks the band stale after 45 s);
  - otherwise: rebuilds every 15 s only to feed `worker_live` (kept at its 15 s cadence; it derives
    from the same query and retires the full-table scan) and does not upsert the row.

  An unwatched GET may therefore serve an older row, shown as `updating`, until the first watched
  tick (about 1–3 s after the viewer key appears: the writer checks the key once per second,
  5.3.1). Unwatched readers that need queue counts (the Dashboard Operations tile, the Stack
  workers group) read `worker_live` from the ops snapshot instead.

- Structured deferral progress (V12) from a helper in `resource_governor.py`, written only when
  family, reason or until change (every `update_task` wakes `tasks-stream`); `start_task` clears it.
- Worker heartbeats in one Redis hash plus a sorted set (no `SCAN`).
- The `tasks-stream` in-request rebuild (2 s max age) is fixed separately, since History still uses
  it.
- Tests: the number of rebuilds under a stream of `update_task` calls with and without a viewer;
  no rebuild faster than the 3 s minimum; no upsert without a viewer; a new viewer gets a fresh row
  within about 3 s; top N per pool including the NULL pool.

#### Governor gauges (Tasks embedded, System standalone; P1 · M)

- **Focal visual**: GovernorGauges (`site:src/components/viz/GovernorGauges.astro`,
  `site:src/scripts/viz/governor-view.ts`): five gauges (load ratio, iowait, swap, listeners,
  plays in the last 3 minutes) with value, 4 px track, limit tick and `max N` (`any listener
defers` when the limit is 0); status line `Allowed · background work runs` or `Deferring governed
work · load 0.91>0.85 · iowait 31.0%>25.0% · retry in 300 s` with the server's reasons verbatim;
  `· 3 tasks waiting` links to the pending block; secondary line `last deferral 4 min ago · Library
pipeline · iowait`.
- **Header**: maintenance window (`window 02:00–07:00 Europe/Madrid · closed · opens in 4 h 12 m`),
  shown separately from the resource verdict. The window applies only when
  `CRATE_MAINTENANCE_WINDOW_ENABLED` is true (code default false; `docker-compose.yaml` and the home
  compose set true) and the task does not pass `ignore_maintenance_window`. Per
  `resource_governor._requires_maintenance_window`, 14 task types are window-governed and none
  always: the 11 `MAINTENANCE_WINDOW_TASK_TYPES` plus `library_sync` and `repair` (13) only when
  unscoped, and `backfill_track_audio_fingerprints` when unscoped or when its `limit` exceeds
  `CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT`. A scoped run (`album_id`, `artist_id`, `path`, …),
  for example `write_portable_metadata` for one album, bypasses the window.
- **States**: warming; disabled (`Governor off`); stale after 30 s or more measured with the local
  clock (`No sample for 2 min`, gauges dimmed, re-GET every 15–30 s); a null value shows `n/a` (no
  `/proc`, e.g. dev on macOS).
- **Live**: each sample re-targets one spring per gauge (170/18); values and bars written by ref;
  React state only for the discrete verdict, window and staleness.
- **On `/system`** the Nivo series stay as history, renamed "Load at deferral" unless the sampler
  records continuous samples (`worker.resource.sample.*` at 30–60 s).

```ts
// GET /api/admin/governor (ops.health.view or ops.tasks.manage) → Redis runtime key crate:runtime:governor
// (TTL 3 × interval), else ops_runtime_state('resource_governor'); {status: "warming"} when neither exists.
// Live: surface "governor" on the admin live stream.
interface GovernorSurface {
  enabled: boolean;
  sampled_at: string;
  sampled_by: string;
  interval_seconds: number;
  allowed: boolean; // resource gate only; the window is separate
  reasons: string[]; // exact evaluate_resources wording
  defer_seconds: number;
  gauges: Array<{
    id:
      | "load_ratio"
      | "iowait_percent"
      | "swap_used_percent"
      | "active_users"
      | "active_streams";
    value: number | null;
    limit: number;
    over: boolean;
    window_minutes?: number;
  }>;
  swap_gate: {
    active: boolean;
    min_swap_used_mb: number;
    min_memory_available_percent: number;
  };
  window: {
    enabled: boolean;
    start: string;
    end: string;
    tz: string;
    in_window: boolean;
    seconds_until_start: number;
  };
  governed: {
    count: number;
    window_rule: Record<string, "unscoped" | "unscoped_or_large_limit">; // 14 entries
    listener_insensitive: string[];
  };
  waiting: {
    deferred_now: number; // from a FILTER in get_task_activity_snapshot, persisted in worker_live
    last_deferral: {
      at: string;
      task_type: string;
      source: string;
      reason: string;
      reason_family: string;
      defer_seconds: number;
    } | null;
  };
}
```

Backend:

- Pure `load_limits()` and `evaluate_snapshot()` extracted in `resource_governor.py` (`DEFAULT_*`
  names and the `RESOURCE_GOVERNED_TASK_TYPES = frozenset(` literal unchanged for the site).
- A `governor-sampler` daemon thread in crate-worker, purely for the UI (the dispatch path evaluates
  resources itself). Every 5 s while `admin:live:viewers:governor` exists (5.3.1), every 60 s
  otherwise; each sample costs one `count_recent_playback_activity` query, so an unwatched 5 s
  cadence would be 17,280 upserts and 17,280 queries a day for nobody. Each sample goes to the Redis
  key `crate:runtime:governor` plus a publish on `crate:sse:admin:governor` (registered in the SSE
  surface catalog); `ops_runtime_state('resource_governor')` is written only when the verdict
  (allowed, reasons, window state) changes or at most once per 60 s (5.3.2).
- Serialisation in `crate/resource_governor_surface.py` (outside `db/`); `record_decision` keeps the
  last deferral (read with a 5 s cache max age).
- One `count_recent_playback_activity()` in `db/queries/management.py` reused by the governor,
  `actors.py:393,409` and `build_runtime_payload`, returning `None` on failure; migration index
  `user_play_events (ended_at DESC)` with `autocommit_block` (V8).
- `_build_metrics_system` derives `resource_pressure` from the latest sample (Redis key, else the
  row) and the analysis
  block from `build_analysis_payload()` (fixes B3). V9: `artwork_variant_health_sample()` stats up
  to 100 artwork files on disk per `/api/admin/metrics/system` request behind a 10 s cache
  (`api/admin_metrics.py:231-233`), and System keeps reading it through `/metrics/dashboard`. It
  moves to a 10-minute crate-worker service-loop step that writes
  `ops_runtime_state('artwork_variants')`; `_build_metrics_system` reads that row by primary key.
  `api/management.py:1479` remains noted.
- Tests: no DB write while idle and unwatched beyond the 60 s floor; cadence switches when the
  viewer key appears; the verdict-change write; the window rule covers all 14 types against
  `_requires_maintenance_window` (drift test, also for the task-catalog flag); `metrics/system` with
  `artwork_variant_health_sample` patched to raise.
- PD33 decides the listener and stream threshold default.

#### System `/system` (P1 · M)

- **Focal visual**: GovernorGauges standalone at the top of Resources.
- **Above it**: score as an XL numeral with a mono readout (`3 warnings · p95 182 ms · governor
allowed`); API latency `StatStrip` (p50, p95, p99).
- **Below**: 14 metric streams as Nivo small multiples with period chips (`?period=`); route latency
  table with mono p95/p99 and inline 2 px bars; transcoding as `Meter`s.
- **Event pipeline band** `#event-pipeline` (P2 · M, `site:src/components/viz/OutboxSequence.astro`):
  5 lanes (writers api · worker, postgres outbox, relay as a phase inside crate-projector, redis
  stream, projector group) with readouts (outbox pending, leased, dead letter, oldest pending age;
  relay claimed/delivered/failed and tick ms; stream latest sequence, length, DLQ; projector
  pending, lag, consumers); 6-row trace of the latest processed event (`INSERT … · claim … ·
XADD … seq … · XREADGROUP … · UPSERT ui_snapshots … (batch) · XACK … · 2.4 s enqueue→ack`),
  played once per new event, or for a selected event with typing; list of the 12 latest events with
  redacted subjects and status dots. States: unknown, idle, flowing, degraded (Redis unreachable,
  dead letters, oldest pending over 60 s, consumer lag above a batch or no ack for N s), stalled
  (no record for 90 s+ with a 15 s heartbeat while watched). Data: `GET /api/admin/event-pipeline`
  (`ops.health.view`). While `admin:live:viewers:pipeline` exists (5.3.1), the projector writes the
  record after each `XACK` batch to the Redis key `crate:runtime:event_pipeline` (TTL 120 s),
  publishes on `crate:sse:admin:pipeline` and sends the 15 s heartbeat; without a viewer it skips
  the key, the publish, the heartbeat and the trace. Either way it writes
  `ops_runtime_state('domain_event_pipeline')` only when the state word changes or at most once per
  60 s. The GET reads the Redis key, else the row, so an unwatched read may be up to 60 s old and
  shows `updating` until the first watched batch or heartbeat. Telemetry is collected through an optional `trace=`
  collector so existing return shapes and strict-equality tests stay; user ids are redacted before
  anything is stored. Requires B1 and its coalescing first.

  ```ts
  interface EventPipelineSurface {
    status: "unknown" | "idle" | "flowing" | "degraded" | "stalled";
    reasons: string[];
    updated_at: string;
    heartbeat_at: string | null;
    outbox: {
      pending: number;
      leased: number;
      dead_letter: number;
      oldest_pending_age_s: number | null;
    };
    relay: {
      claimed: number;
      delivered: number;
      failed: number;
      tick_ms: number | null;
    };
    stream: { latest_seq: string | null; length: number; dlq: number };
    projector: {
      pending: number;
      lag: number | null;
      consumers: number;
      batch_ms: number | null;
    };
    latest: Array<{
      id: string;
      type: string;
      subject: string; // redacted
      status: "ok" | "retry" | "dead";
      enqueued_at: string;
      acked_at: string | null;
      trace: Array<{
        step: "insert" | "claim" | "xadd" | "xreadgroup" | "project" | "xack";
        at: string;
        detail: string;
      }> | null;
    }>; // ≤12; trace for the latest only
  }
  ```

  Tests: while watched the projector writes the Redis key per batch; the row only on a state change
  or after 60 s; no key write, publish, trace or heartbeat without a viewer; subjects redacted; the
  endpoint reads without Redis stream or builder calls; OpenAPI contract.

- **Redis band** (P2 · M, `site:src/components/viz/RedisPair.astro`): two panes. Cache: live flags
  from `CONFIG GET` (INFO fallback), 10×4 waffle (filled = used/maxmemory, cyan share = keys with a
  TTL, grey = no TTL, labelled as a share of keys), memory meter with RSS and fragmentation, hit
  ratio and ops/s, 6-line log of real sample deltas (eviction lines amber). Durable: flags, last 6
  real domain events, broker queues from Dramatiq DB 1 labelled "waiting in Redis (not prefetched)"
  with delayed and dead letters, projector lag and dead letters, memory meter against the
  instance's `maxmemory` (384 MB in both composes), never the container `mem_limit` (512m in the
  base compose, 384m in the home compose), with the warn at 75% of `maxmemory` because
  `noeviction` rejects writes there; AOF line. Single-instance installs render one pane with a
  note. Data: `GET /api/admin/redis` (`ops.health.view`). A `redis-sampler` thread in crate-worker
  with its own short-timeout clients and `pipeline(transaction=False)` samples every 15 s while
  `admin:live:viewers:redis` exists and every 300 s otherwise, into the Redis key
  `crate:runtime:redis` plus a publish; `ops_runtime_state('redis_runtime')` is written at most once
  per 60 s. The GET reads the key, else the row. Ops note PD45.

  ```ts
  interface RedisRuntimeSurface {
    sampled_at: string;
    interval_seconds: number;
    single_instance: boolean;
    instances: Array<{
      role: "cache" | "durable";
      available: boolean;
      flags: {
        maxmemory_bytes: number;
        maxmemory_policy: string;
        appendonly: boolean;
        source: "config" | "info";
      };
      memory: {
        used_bytes: number;
        rss_bytes: number;
        fragmentation: number;
        warn: boolean;
      }; // warn ≥75% of maxmemory on durable
      keys: { total: number; with_ttl: number };
      hit_ratio: number | null;
      ops_per_sec: number | null;
      log: Array<{ at: string; text: string; level: "info" | "warn" }>; // ≤6, real sample deltas
      durable?: {
        recent_events: Array<{ seq: string; type: string; at: string }>; // ≤6, subjects redacted
        broker: Array<{
          queue: string;
          waiting: number;
          delayed: number;
          dead: number;
        }>;
        projector: { lag: number | null; dead_letter: number };
        aof: string | null;
      };
    }>;
  }
  ```

  Tests: no sample faster than 300 s without a viewer; the 60 s persistence floor; an unreachable
  instance renders `available: false` without blocking the thread; OpenAPI contract.

#### Stack `/stack` (P1 · L)

- **Focal visual**: SystemMap (`site:src/components/architecture/SystemMap.astro`,
  `site:src/content/architecture/map.ts`, `site:src/lib/system-map.ts`) as the hero, replacing the
  hero, stat tiles and service cards. Node boxes show a `StatusDot` (running and healthy on;
  starting, unhealthy, restarting or OOM warn; exited or dead off with a dashed box), the tech line,
  `412 MB / 1.5 GB · /music ro · 2 restarts since created` and a memory meter (amber at 85%).
  Limits come from the sampler (the container's real `mem_limit`), never from the site's `map.ts`,
  whose values match the base `docker-compose.yaml` but not the production overlay (5.3.6). The
  frontends node aggregates crate-ui, crate-listen and crate-cast-receiver; the workers group shows
  running and queued from the ops snapshot's `worker_live` (the queues row is not written while
  nobody watches Tasks); the Listen client shows listeners. Services absent from
  the project are ghosts (`not deployed`); containers outside the topology go to an "Other
  containers" hairline list.
- **Interactions**: select a node (`?service=`): detail panel with image, digest, state, uptime,
  restarts, last exit code and OOM (carried forward across restarts), memory, `/music` mount, ports,
  lazy logs (`tail=30`); Restart through `ConfirmDialog` per a server-side policy by compose label
  (PD44); Stop/Start only for other containers.
- **States**: warming, docker unavailable (ghost topology plus explanation), stale (`sampled 6 s
ago`; `SAMPLER STALLED` computed client-side from server time), partial.
- **Data**: `GET /api/admin/stack-snapshot` and `/api/admin/stack-stream` stay but never sample.
  Each sample goes to the Redis key `crate:runtime:stack` (TTL 3 × interval) plus a publish on
  `crate:sse:admin:stack`, like the other runtime samplers (5.3.2); `ui_snapshots('ops:stack','global')`
  is written only when a node's state, health, restart count or the container set changes, or at
  most once per 60 s, never on every 10 s sample. The GET reads the Redis key, else the row; the
  stack-stream forwards published payloads.

  - Sampler placement is PD54. As proposed: crate-api is the only service with the Docker socket
    and also serves all Admin and the Listen fallback traffic, while `docker_ctl._request` is
    synchronous Unix-socket I/O (30 s timeout today). So the sampler is a dedicated daemon thread in
    crate-api, never an asyncio task or a call on the event loop, behind an owner-checked Redis
    leader lock with renewal (pattern of the Jam heartbeat lock).
  - Stats: `GET /containers/{id}/stats?stream=false&one-shot=true` (without `one-shot` Docker waits
    for a second CPU sample, about 1–2 s per container), a 2 s per-call timeout, a bounded pool of at
    most 4 calls, and a total budget below the interval; when the budget would be exceeded the
    remaining containers keep their previous stats, marked stale.
  - Cadence: 10 s while `admin:live:viewers:stack` exists (set by the Stack endpoints through the
    shared key constant in `app/crate/admin_viewers.py`, 5.3.1); otherwise only a container list
    every 10 minutes and no stats.
  - `docker_ctl.get_container()` extended (health, OOM, exit code, RW mount, labels, memory limit);
    `_request` takes a per-call timeout and reports real status (today a timeout reads as success).
  - PD54 (b) moves the sampler to crate-worker behind a read-only docker-socket-proxy instead; the
    data contract and cadence do not change.
  - Schema additions keep `available: bool` and add `warming`; actions stay 200.
  - Restart policy: today `api/stack.py` allows only the prefixes `librarian-`, `tidarr`, `tidalrr`,
    `slskd`, `soulsync`, `traefik` and `nginx`, so every `crate-*` container returns 403 while
    traefik is restartable. A server-side policy by compose label replaces it (PD44, a behaviour
    change for traefik, 3.4.2) and also applies to logs and detail reads.
  - Tests: the sampler never runs on the event loop; a slow stats call does not delay requests; no
    stats call without a viewer; the endpoints and the sampler use the same viewer-key constant;
    the row is written only on a state change or after 60 s, never per sample; the restart policy
    table; OpenAPI contract for the additive fields.

  ```ts
  // GET /api/admin/stack-snapshot and /stack-stream (ops.runtime.manage, unchanged), never sample in the request;
  // they read crate:runtime:stack, else ui_snapshots('ops:stack','global').
  interface StackSurface /* existing: snapshot, stack {available, total, running, containers} */ {
    warming: boolean;
    sampled_at: string | null;
    sampled_by: string | null;
    interval_seconds: number;
    nodes: Array<{
      id: string; // topology id: api, readplane, worker, projector, postgres, redis, durable, …
      container: string | null; // null = ghost ("not deployed")
      image: string | null;
      digest: string | null;
      state:
        | "running"
        | "starting"
        | "unhealthy"
        | "restarting"
        | "exited"
        | "dead"
        | "unknown";
      health: string | null;
      oom_killed: boolean;
      last_exit_code: number | null;
      restarts: number;
      started_at: string | null;
      memory: {
        used_bytes: number | null;
        limit_bytes: number | null;
        stale: boolean;
      };
      music_mount: "ro" | "rw" | null;
      ports: string[];
      actions: { restart: boolean; reason: string | null }; // PD44 policy, evaluated server-side
    }>;
    other_containers: Array<{
      name: string;
      image: string;
      state: string;
      actions: { restart: boolean; stop: boolean; start: boolean };
    }>;
  }
  ```

- **Layout**: wide/tall switch by container query at about 1100 px; tall worker rows re-spaced; SVG
  `role="group"` with focusable nodes.

#### Logs `/logs` (P1 · M)

Terminal recipe: object card, chrome row `LOGS · live · 100 lines` with a stream dot; lines in mono
12/1.7 `HH:MM:SS level worker category message`, level column 5ch (info subtle, warn amber, error
warn plus `ERR`); task ids link to the task; filter chips plus search; auto-follow that yields to
user input (shared with the sidecar); worker roster as hairline rows (seen within 60 s is on). Drop
`fresh=1` from the loader.

### 4.9 Library pages (Admin)

| Page          | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                               | Data                                  | P · size |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| Browse        | media grid with mono `12 albums · 143 tracks`; filter and sort chips; list mode as a table; header shows filtered and total counts                                                                                                                                                                                                                                                                                                                      | `/api/artists`, `/api/browse/filters` | P1 · M   |
| Artist        | entity header (`ARTIST · 12 albums · 143 tracks · MBID linked · enriched 2 d ago`); text tabs in `?tab=`; overview lede and mono facts; top tracks as track rows; discography grouped under `MonoLabel`s; Similar graph retinted through tokens with `/api/shows/artists-with-shows` fetched once per page; Stats with the Nivo theme; artwork editor chrome; Shows use the ticket; Setlist tab uses the shared setlist rows (4.18); Enrichment tab 4.5 | existing                              | P1 · L   |
| Album         | entity header (`ALBUM · 2019 · 10 tracks · 41 min · FLAC 16/44.1`); `TrackTable` per the track-row recipe with analysis and bliss dots; `TagEditor` with mono keys and file-tag diff highlighted; `MatchCard` with a confidence meter; readout 4.7; sidecar 4.3                                                                                                                                                                                         | existing                              | P1 · M   |
| Timeline      | hairline year bars (`--v` = count/max), decade dividers, `StatStrip` (span, total, peak year), expanded year as a cover row                                                                                                                                                                                                                                                                                                                             | `/api/timeline` (fine at 4.4K albums) | P2 · S   |
| Trash         | `StatStrip` (files, size); hairline rows with restore/delete chips. Precondition: `/api/manage/tracks/quarantine` walks the disk per request; the worker maintains the index                                                                                                                                                                                                                                                                            |                                       | P2 · S   |
| Contributions | hairline review queue with status dots                                                                                                                                                                                                                                                                                                                                                                                                                  |                                       | P2 · S   |

### 4.10 Access, curation, federation, settings (Admin)

| Page                                                                                                                                                                                             | Treatment                                                                                                                                                                                                                                                                                                                                                                                                          | P · size |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Users                                                                                                                                                                                            | presence `StatStrip` computed from the loaded list; table with role, presence dot, now playing, last seen, sessions; Leaflet with a dark desaturated basemap and token markers. Precondition B17 (presence query as a per-user `LATERAL` top-1, batched now-playing reads); rows refresh on focus                                                                                                                  | P2 · M   |
| Roles                                                                                                                                                                                            | capability matrix table (mono ids grouped by domain, roles as columns, on/off dots); role chips on mobile                                                                                                                                                                                                                                                                                                          | P2 · S   |
| Playlists, editor                                                                                                                                                                                | hairline rows with mono `smart · 48 tracks · regenerated 2 d ago`; rule builder as chip rows; preview count numeral; generation phase line on the playlist stream (with reconnect)                                                                                                                                                                                                                                 | P2 · M   |
| Translations                                                                                                                                                                                     | one row per locale with a status dot and a stacked coverage meter (translated, stale, missing) from `/quality`; bundles as a table; editor two columns with mono keys                                                                                                                                                                                                                                              | P2 · M   |
| Settings                                                                                                                                                                                         | section navigation in `?section=`; v3 primitives replace the local `Section`, `StatTile`, `PanelCard` and `StatusDot` (name collision); schedules as hairline rows with an elapsed/interval hairline (amber past 1.5x) and Run now, using an additive `last_runs` read of `schedule:last_run:{task}` keys; connections as dot rows; storage meters; audit log table; Downloads quiet-hours heatmap (4.17, phase 2) | P2 · L   |
| Federation                                                                                                                                                                                       | Overview hero is the topology (below); Peers, Policies, Streams (filter by `?node=`), Imports, Security (key rotation step rail), Audit as tables and rails; tabs in `?tab=`; `PanelState` gains Retry and loses red                                                                                                                                                                                               | P2 · L   |
| Global catalog                                                                                                                                                                                   | `StatStrip` of artists, albums, tracks, sources; serving mode dot; taxonomy id and digest; last reconcile as a step rail with real counts; runs table; duplicate review with a confidence meter (ticks at .85 and .90). Precondition B17 (status snapshot written at reconcile completion)                                                                                                                         | P2 · M   |
| Login, Setup                                                                                                                                                                                     | header anatomy; forms; Setup as a 3-step rail whose last step follows the real `library_pipeline` task                                                                                                                                                                                                                                                                                                             | P2 · S/M |
| Route-level states (`App.tsx` `PageSpinner` and "No console landing page available"; `components/auth/ProtectedRoute.tsx` `PageSpinner`, "Admin console access required", "Permission required") | `ErrorState` page variant: `MonoLabel` eyebrow, sub-head title, one sentence naming the missing capability, one CTA; loading keeps the shell and shows a `ProgressHairline` instead of a spinner                                                                                                                                                                                                                   | P1 · S   |
| LLM-gated actions (`components/ui/AIButton.tsx`, `LLMStatusProvider` in `hooks/use-llm.tsx`)                                                                                                     | the action stays a normal button; when no LLM is configured it is disabled with a neutral mono `LLM · not configured` tag and the reason in `title` (the site's "optional LLM" badge); no sparkle icon tile, no colour                                                                                                                                                                                             | P2 · S   |

**Federation topology** (`site:src/components/viz/Federation.astro`,
`site:src/scripts/viz/federation-view.ts`): your node in the centre with display name and key
fingerprint; approved peers on an arc (max 9 plus `+N`, pending first); the listener phone below
with `N listeners · never see the peer URL` (true: playback goes through a local relay ticket). Edge
styles by health and trust; relay edges light when outbound relay sessions exist (`sessions (last
5 min)`, not "bytes now"); `serving N` when peers stream from you. Animations only from diffs
between consecutive snapshots (descriptor packet for a new pending peer, check mark on approval,
stream and ticket pills when relay sessions rise, delta dots when a catalog delta lands). Inspector
rail Descriptor → Pairing → Grant → Relay with Approve (inbound, unexpired), Change grant (warns
that it revokes tickets), Sync catalog (`federation.catalog.sync.manage`), Disable, View tickets.
Data: `GET /api/admin/federation/topology` and the `federation` live-stream surface from
`ui_snapshots('ops:federation','topology')`, built by one CTE over federation tables (no catalog
item `COUNT`; counts written by the sync worker), effective pairing state derived from `expires_at`
(`expire_pairings` is never called), stale amber only from the server flag. Preconditions: B14 fix
(independent), B11 routing fix, and domain events emitted by every federation mutation after commit.

Rebuild discipline (otherwise B11 moves from ops to this snapshot):
`federation.stream.ticket.created` (`api/federation.py:2071`) and
`federation.stream.proxy.completed` (`api/federation_remote.py:858`) fire on every remote track play.

- Structural events (pairing, grant, peer changes, `federation.catalog.sync.completed`,
  `federation.health.polled`) rebuild with trailing-edge coalescing over a window of at least 5 s
  (5.3.2).
- Stream and relay events (`federation.stream.*`) only set `ops:federation:topology:dirty`. The
  projector honours it only while `admin:live:viewers:federation` exists, at most one rebuild per
  5 s; otherwise relay counts wait for the 60 s health-poll floor.

Tests: N stream events inside the window produce one build; with no viewer, stream events never
rebuild; a structural event rebuilds after the window.

```ts
// GET /api/admin/federation/topology (federation.nodes.view) → ui_snapshots('ops:federation','topology'),
// stale-first, never builds; cold → {snapshot: {version: 0, stale: true, pending: true}}. Rebuilt by the
// projector on structural federation events (coalesced ≥5 s) and on stream events only while watched
// (≤1 per 5 s), with the health poll as a 60 s floor (rebuild discipline above).
// Live: surface "federation" on the admin live stream.
interface FederationTopologySurface {
  node: {
    uid: string;
    display_name: string;
    fingerprint: string;
    listeners: number;
    serving: number;
  };
  peers: Array<{
    uid: string;
    display_name: string;
    url_host: string | null;
    pairing: {
      uid: string;
      direction: "inbound" | "outbound";
      state:
        | "pending"
        | "approved"
        | "awaiting_peer"
        | "expired"
        | "failed"
        | "disabled";
      expires_at: string | null;
    }; // state derived from expires_at
    health: {
      ok: boolean;
      stale: boolean;
      failures: number;
      checked_at: string | null;
    };
    grant: { preset: string | null; scopes: string[] } | null;
    relay: { sessions_5m: number; serving_5m: number }; // sessions, never "bytes now"
    catalog: {
      item_count: number | null;
      last_delta_count: number | null;
      synced_at: string | null;
    };
  }>; // pending first; the client draws ≤9 plus +N
  snapshot: SnapshotMeta;
}
```

Tests: pytest (pg_db) for the CTE (no catalog item `COUNT`), derived pairing state, the endpoint
never building; OpenAPI contract; Vitest for the diff-driven animations (no animation without a
diff).

**Listen screens (4.11–4.22)**

### 4.11 Shell and player chrome (P0 · M)

- **Player bar** (`components/player/PlayerBar.tsx`, `bar/*`): title in display 700 at 15–16 px;
  artist and album sans muted; tabular mono time codes written by ref; seek as a 1 px hairline that
  grows to 3 px on hover with an `accent-action-hi` fill; round play disc; ghost secondary icons;
  volume slider recipe; `QualityBadge` as a mono tag (`FLAC · 24/96`). `WaveformCanvas` and
  `SpectrumPlayButton` only where an analyser exists, token colours. Fix B24 in the same pass
  (analyser store in refs read in rAF; progress subscribed only in leaves; one shared crossfade
  clock in a ref-backed store instead of a `useCrossfadeProgress` `setState` loop per mounted
  instance, with a test that one crossfade runs one rAF loop with the bar, extended and fullscreen
  players all mounted).
- **EQ glyph** (the site's Inside EQ tile): a 10-band curve of about 32×14 px replacing the
  `SlidersHorizontal` icon in the bar's EQ button (`PlayerBarDesktopActionButtons.tsx:74`, inside
  the `PlayerBarActionIconButton` at `:68-75`), the
  extended header and the fullscreen 48 px button. It shows exactly the gains the engine applies
  (published by `useEqualizerRuntime` to a client store `lib/equalizer-live-store.ts`, initialised
  from the saved prefs), with the mono label (`ROCK`, `CUSTOM`, `SMART · Thrash ← metal`,
  `ADAPTIVE`, `GENRE`, `resolving`). Springs 120/14 only on real changes; the glyph never animates
  from flat on first paint. Not rendered when the EQ is unavailable on the engine, off, or remote
  Connect is active (current visibility rules per surface; the extended header falls back to the
  icon when unavailable). The button owning the `aria-label` subscribes to the store
  (`Equalizer: Smart, Thrash metal, from Metal`; thrash metal has no preset of its own and inherits
  metal's `thrash` template) and gains `aria-expanded`. The glyph imports `@crate/ui/lib/eq-curve`
  and `@crate/ui/lib/use-eq-morph` (promoted from `domain/player/eq-morph.ts` in this change, plan
  4.3; 3.1.4), so the eager player bar does not import `EqBands`.
- **Fullscreen player** (`FullscreenPlayer*`): artwork with an inset hairline; title Bricolage 700
  `clamp(1.6rem, 6vw, 2.2rem)`; mono artist/album; seek with 44 px targets; 64 px disc; text tabs;
  the EQ sheet loses its glass.
- **Extended player**: header `NOW PLAYING · from <source>` from `playSource`; text tabs; Suggested
  tab rows with mono `92% · 124 BPM · 8A` from the existing `distance`; fixed Crate v3 chrome per PD40; content-derived artwork/visualizer palettes remain content.
- **Queue** (panel, extended tab, fullscreen tab): header `QUEUE · 24 tracks · 1 h 42 min`; source
  line; track rows with drag handles; past tracks subtle.
- **Mix strip** (`site:src/components/viz/MixViz.astro`, P2 · L, Smart Mix dependent):
  - Mounted between Now playing and Next up in the extended queue tab, as a memoised prop-less
    island in `FullscreenPlayerQueueTab` (`FullscreenPlayerTabs.tsx`), and compact in `QueuePanel`
    on desktop only. Not in the player bar.
  - Compact line `NEXT TRANSITION · 6 s · 124 BPM · 8A → 9A` with a fade glyph; the seconds come
    from the planned transition and cover every value (smart 2/3/4/6 s, manual 0–12 s, fractional
    native values rounded to 0.1 s; 3.3.3); a disclosure expands
    the instrument (deck lanes, fade zone, curves crossing at −3 dB, cue markers, playhead, A/B
    meters).
  - States: hidden (no next, repeat one, remote Connect, Cast, 0 s and not gapless); gapless
    (`Gapless · album sequence`); planning; planned; live (playhead from a clock ref); ended;
    cancelled; degraded (amber dot plus the localised fallback reason); local fallback.
  - Phase A (now, web and desktop): built from the queue and `CrossfadeTransition`, Gapless-5's
    sqrt equal-power law, label `Smart crossfade · this device`; no bars or beat ruler (web
    durations are not bar-quantised); during a live fade the edge comes from the transition's ids
    (Gapless-5 fires `onnext` at fade start); client fixes: clear the transition on
    prev/jump/seek and freeze the playhead while paused.
  - Phase B (after the merge, Android): installed plans published from `installTransitionPlans`,
    native clock via `resolveNativeCrossfadeTransition` resynced on `transitionProgress`,
    `effectiveCueMs` for zero cues, staging gains or a "nominal −3 dB" label, profile facts behind a
    server capability (the request model is `extra='forbid'`).
  - Phase C (lanes): `rms_envelope` (PD37).
  - Copy never says beatmatch, sync, lock, handoff or automix in any locale; a Vitest checks every
    mode and reason string in all 7 catalogs.
- **Lyrics**: synced lines in Bricolage 700 (active primary, past subtle, future muted); active line
  underline at `scaleX(lineProgress)` written by ref from a leaf; footer `LYRICS · synced · lrclib`.
- **Visualizer family**: Crate v3 chrome tokens, with data-derived palettes inside the visualizer where they represent content (PD40); no selectable skin/chrome opt-in; gated by
  `data-crate-effects`; `SpectrumRibbonCanvas` removed (PD47).
- **Resume prompt and sleep timer**: object card `RESUME · <device> · 2:14` with a hairline at the
  saved position; mono sleep countdown.

### 4.12 EQ panel (P0 · M)

- **Focal visual**: EqViz (`site:src/components/viz/EqViz.astro`, `site:src/scripts/viz/eq-view.ts`)
  as the first element of the popover (`EqualizerPopover.tsx`, which gets a max height and its own
  scroll), the extended header panel and the mobile sheet. Chart 200–240 px on desktop (the site
  uses `clamp(260px, 44vh, 460px)`; this is a deliberate app reduction), 220 px on mobile.
- **Anatomy**: `MonoLabel` `EQ · 10 bands · ±12 dB · 21 presets` with a trail `previous → current →
fallback` (the current word scrambles for 420 ms when it changes; this is Listen's first scramble
  consumer, 3.1.4); bars from 0 dB with separate up and down gradients; curve with glow and area fill;
  ghost curve for the target during a morph and for hover previews of a preset chip or a shadowed
  chain link; handles positioned by ref in the same frame as the curve (fixes the regression;
  initial position in `useLayoutEffect`); numerals written through a ref'd span inside
  `StatNumber`. The progress hairline means "resolving" (indeterminate), not a dwell.
- **Chips**: 21 presets as `CratePill`s with `aria-pressed`; labels from i18n
  (`lib/equalizer-labels.ts`; `EQ_PRESETS` stays in `lib/equalizer.ts` for the site drift test).
- **Smart EQ chain** (visible in Smart mode): six links from the server `chain[]` (applied in
  `accent-action-hi` with `aria-current`, shadowed focusable with a ghost preview, absent subtle
  with its reason), then the inheritance walk (4.6.2) when the genre link applies. The global manual
  preset, Adaptive and Genre adaptive modes are client modes outside the chain and never light
  "your preset" (only `user_track_preset` does). The mode badge duplicate goes.
- **Actions**: apply preset (leaves Smart, as today); drag or keyboard per band (↑/↓ 0.5 dB, PgUp/PgDn
  3 dB, Home/End limits; dragging bypasses the spring); Smart and EQ toggles; `Save for this track`;
  `Clear track preset` (curve morphs to the next link); reset to flat.
- **Drag and key repeat write path.** Today every `onBandChange` goes through
  `setCustomEqualizerGains` (`lib/equalizer-prefs.ts:123-131`: three synchronous `localStorage`
  writes plus `EQ_PREFS_EVENT`), every `useEqualizerSnapshotState` subscriber sets state, and
  `useEqualizerRuntime` re-runs its effect, which on Android native is a Capacitor bridge call
  `androidNativeEngine.setEq(…, 80)` (`hooks/use-equalizer-runtime.ts:96-101`). Batching that to
  one write per frame is still 60 writes a second (DS 3.8 rule 4). So, during a drag or key repeat:

  - gains go to the engine imperatively through a ref: Web Audio `setTargetAtTime` on web and
    desktop; native `setEq` throttled to 15–20 Hz with its ramp;
  - curve and handles are drawn by ref; the live store (glyph) gets at most one publish per
    animation frame; prefs are not touched;
  - prefs commit once (`localStorage` plus one `EQ_PREFS_EVENT`) on pointerup, on blur, or 150 ms
    after the last key press.

  Tests (Vitest): a 60-move drag causes 1 `localStorage` commit and 1 `EQ_PREFS_EVENT`; the native
  `setEq` call count stays within the throttle; key repeat commits once after 150 ms.

- **States**: loading (PD32 decides between showing flat, which is what the audio plays today, and
  holding the last gains); unavailable (`Flat · Smart EQ unavailable` with a warn dot); remote track
  (flat, chain absent with reason); EQ off (40% opacity, sliders `aria-disabled`); engine without EQ
  (panel not mounted, current gating).
- **Accessibility**: each band is a vertical `role="slider"` with `aria-valuetext` (`1 kHz, +4 dB`)
  passed as props (no i18n in `@crate/ui`); chain as an `<ol>`; trail announced only on settle.
- **Admin counterpart**: `GenreEqEditor` loses the box-in-box and `white/*` colours, shows the ghost
  of the persisted curve while editing, and consumes the PATCH response (merged over the follow-up
  refetch).

Contract:

```ts
// GET /api/tracks/{id}/eq, /by-entity/{uid}/eq, /api/catalog/tracks/{uid}/eq — additive fields.
// One resolver input query keyed by global_track_uid | entity_uid | track_id, one read_scope (B8);
// genre inheritance from the in-memory runtime graph; forced revision check (one Redis GET) so a
// curator edit served by another API worker is not 30 s stale.
interface EffectiveEq /* existing fields unchanged */ {
  source: EqSource | "unavailable";
  genrePath: Array<{ slug: string; name: string }> | null;
  chain: Array<{
    source: EqSource; // fixed order: user track, curator track, curator album, genre, analysis, flat
    status: "applied" | "shadowed" | "absent";
    label: string | null;
    gains: number[] | null; // applied and shadowed only
    reason:
      | "no_preset"
      | "no_canonical_genre"
      | "no_genre_preset"
      | "no_analysis"
      | "remote_track"
      | null;
    genre?: { slug: string; name: string } | null;
    genrePath?: Array<{ slug: string; name: string }> | null;
  }>;
}
// GET /api/tracks/{id}/genre and /api/catalog/tracks/{uid}/genre: preset gains path (cache key bumped to v2;
// useTrackGenre moves to the reactive cache so taxonomy edits reach Genre adaptive mode).
```

Tests: resolver per chain position, shadowing, absent reasons, one `read_scope` (graph stubbed);
paths in Python and Go; Python `_EQ_X` equals Listen `EQ_PRESETS[x]` for every template (subset
check, Listen has extra presets); shared fixture for adaptive gains parity
(`lib/adaptive-eq.ts` vs `compute_audio_analysis_gains`); Vitest for springs, sliders, chain,
glyph store, popover height; i18n keys in 7 catalogs plus metadata hashes.

### 4.13 Home `/` (P1 · L)

- **Focal visual**: the Listening DNA tile on desktop (the site's Inside heatmap tile, inside
  `components/home/HomeReplaySection.tsx`): a mini 7×24 grid from the 30-day `heatmap` the Home
  already fetches (`STATS_DASHBOARD_LIMITS`), header `STATS · 30 days · night 34%`, mono line `Peak
Sat 23:00 · now Thu 22:00`; the now outline moves once per hour (one timeout computed in the
  dashboard timezone; DST and :30/:45 offsets tested); the tile links to `/stats#listening` (needs
  an `id` through `StatsReveal`, a scroll effect after load and `scroll-margin-top`). Hidden when
  pending, empty or failed; not added to mobile Home (no new mobile fetch).
- **Rest**: greeting as a page-tier title with a mono eyebrow (date, time of day); hero without glow;
  rails through `SectionHeader`; Recently played as a `HairlineList` with mono `played_at`; Just
  landed and Custom mixes as cover rows with mono meta (`24 tracks · 92–128 BPM` from the mix
  tracks' `bpm`); upcoming preview and show prep use the ticket header and the setlist summary
  (4.18).
- **Data**: home discovery snapshot (read plane) and the existing desktop stats request.

### 4.14 Explore `/explore` (P1 · M)

#### Mood map

- **Focal visual**: MoodMap (`site:src/components/viz/MoodMap.astro`, `site:src/scripts/viz/
mood-view.ts`, `mood-math.ts`) replacing `MoodBrowseSection` and its `MOOD_COLORS`
  (`pages/ExploreLandingSections.tsx:194`). The figure keeps the site's composition: header
  `MOODS from audio analysis` / `energy × valence`, square stage, readout and CTA below.
- **Content**: up to 1,500 real points (700 on mobile, a prefix of the same hash-ordered sample) on
  Canvas 2D with token-coloured sprites (`lighter` compositing on the fixed Crate v3 canvas); points that
  belong to no mood as pale dust; 8 mood labels as DOM buttons at the real centroids of this library
  with a tested deterministic nudge so `energetic` and `intense` do not overlap; 4×4 grid; dashed
  threshold rectangle for the active mood.
- **Interactions**: hover (fine pointers) previews the nearest label within 16% (state set only when
  the chosen index changes); click, tap, Enter or Space confirms (`aria-pressed`); readout gives the
  thresholds (`energy ≥ 0.70 · danceability ≥ 0.50 (third axis)`), track count with count-up and
  share; `Play <mood> mix` keeps today's playback through `/api/browse/mood/{mood}`; Escape clears.
  Offline-only disables Play with a reason.
- **States**: loading (grid and axes, disabled labels); warming (labels at region centres, `Mapping
moods from audio analysis`); empty (`No analysed tracks yet`); stale (meta shows the build time);
  error (moods as a `HairlineList` with counts and Play); live (on a new snapshot version, points
  cross-fade, counters count from the previous value, selection kept).
- **Accessibility**: canvas `aria-hidden`; labels are buttons in preset order; a separate sr-only
  live node updates only on confirmed selection; the scrambled name is `aria-hidden`.

```ts
// GET /api/browse/mood-map (auth) → ui_snapshots('explore:moods','map'), one PK read; fresh ≤24 h (nightly
// build plus events), served stale ≤7 d with a coalesced refresh; missing → status "warming" with thresholds only.
interface MoodMapResponse {
  status: "ready" | "warming" | "empty";
  snapshot: { version: number; built_at: string; stale: boolean };
  axes: { x: "valence"; y: "energy" };
  coverage: {
    analysed_tracks: number;
    plotted_tracks: number;
    catalog_tracks: number;
  };
  moods: Array<{
    id: string;
    filters: Record<string, number>;
    region: { energy: [number, number]; valence: [number, number] };
    third_axis: string[];
    track_count: number;
    share: number;
    centroid: { energy: number; valence: number } | null;
    spread: { energy: number; valence: number } | null;
  }>;
  sample: { count: number; encoding: "u8x3"; data: string } | null; // energy·255, valence·255, mood bit mask
}
// /api/browse/moods and explore-page read counts from the same snapshot (shape unchanged).
// /api/browse/mood/{mood}: random.sample from ui_snapshots('explore:moods','pool:<mood>') (≤400 uids)
// plus one ANY(:uids) hydration; status "warming" when no pool.
```

Backend: `MOOD_PRESETS` moves to `crate/moods.py` (the site's drift test path is updated in the
website branch); one-pass builder with a `MATERIALIZED` features CTE in `db/jobs/explore_mood_map.py`
writing the 9 rows in one transaction; `refresh_explore_mood_map` (fast) scheduled from the
projector with trailing-edge coalescing (5.3.2: the due time lives in the Redis due set, so the
stale-pending redispatcher cannot collapse the window to 5 minutes) and a window of at least 900 s
(named constant, asserted in the coalescing test), because `track.analysis.updated` is emitted per
track (`db/jobs/analysis_state_events.py`) and a 300 s window would rebuild for days during a
backfill. Triggers: `track.analysis.updated` with state
`done`, `global_catalog.reconcile.completed`, `federation.catalog.sync.completed` (both emitted
today: `db/jobs/global_catalog_reconciliation.py:1250`, `federation/events.py:68`) and
`global_catalog` invalidations, plus nightly. `library.scan.completed` and
`federation.catalog.synced`, also listed in `_OPS_EVENT_TYPES`, are never emitted, so they are not
triggers. The handler broadcasts a new `explore` invalidation scope only when the mood counts or
the sample hash change. Listen's `lib/cache.ts` maps every URL starting with `/api/browse` to
`library` (`cache.ts:200-205`), and `library` is broadcast by crate edits, covers, tags and artist
enrich (`api/cache_events.py` `_INVALIDATION_RULES`), so `scopesForUrl` gets explicit branches for
`/api/browse/mood-map` and `/api/browse/explore-page` that map them to `explore` only, placed before
the `/api/browse` prefix rule. `count_mood_presets` kept only as a test reference. Fixes B6. The
backend half can ship before the visual as a performance fix. Tests: a burst of analysis events
inside the window produces one build; nothing is dispatched before the window ends (at 360 s with a
900 s window); an unchanged rebuild broadcasts nothing; Vitest that both URLs never resolve to
`library`.

#### Other Explore content

Radio and Paths feature rows with display titles and `→`; Just landed and crate playlists as cover
rows; time tunnels as a chip row; genre tiles as `GenrePill`s with mono artist counts until the
wheel ships; decade detail with year hairline bars; playlist categories as hairline rows; genre
detail page with display name, mono `family · 214 artists · EQ inherited from metal` and the
locator (phase 2).

**Genre wheel in Listen** (phase 2, desktop at 1000 px and wider): read-only browse wheel from
`/api/catalog/genre-wheel` (4.6); node size by `rollup.artists`; tapping a family zooms its sector;
tapping a genre opens `?genre=slug`. Below 760 px only the genre-page locator applies (ring-1
labels, sector tap opens a list). Copy through the 7 catalogs. `scopesForUrl` maps
`/api/catalog/genre-wheel` to the dedicated `genre_wheel` scope through an explicit branch before
the `/api/catalog` prefix rule (which maps to `library`), so a crate edit by any user never makes
open Explore pages refetch the wheel (plan 5.10; Vitest that the URL never resolves to `library`).

### 4.15 Radio `/radio` (P1 · L)

- **Focal visual**: the sound map (`site:src/components/listen/RadioDive.astro`,
  `site:src/scripts/listen/radio.ts`, `scene.ts`, `site:src/scripts/field/*`) as the hero, replacing
  `RadioHero`'s glow card. Split 5fr (title, intro, Discovery CTA as a plain pill button, session
  status) / 7fr (figure `RADIO · <seed> · <profile>`). Score, Queue and Feedback panels overlay the
  map on desktop and stack below on mobile; station rails and seed search move below.
- **Not a scroll story**: the site's five scroll phases become states of the real session.
  - Idle: the library cloud (real sample) rendered as one static frame, with the count of analysed
    tracks. It moves only during a reveal or while the user drags or zooms; no idle orbit (it
    would keep WebGL drawing 14K points for as long as `/radio` is open, draining battery on
    Capacitor and Tauri). Test: no frame is requested after the reveal settles.
  - Session (detected from `usePlayerActions().playSource.radio.shapedSessionId`, so it survives
    navigation): a 2.2 s reveal on a new session: seed ring; lines to the next picks that belong to
    the session (matched by `libraryTrackId`); Score panel with the real profile weights (discovery
    .34/.22/.16/.09/.08/.05/.03; track and contextual profiles override sound, artists and genre
    with .16/.30/.20 and .01/.44/.26 and keep the other four) and the selected
    pick's breakdown (`weight × (1 − penalty)`, `n/a` for terms with no data; BPM, energy, key and
    era measured "vs the previous pick"); key penalty labelled "Key" (it is not Camelot); Queue panel
    with row 00 (playing) and 01–04, each with fit, BPM and Camelot.
  - Feedback: a like moves the focus from the old target to the new one (`target 16% · cap 40%`,
    blend measured from `initial_target`), the liked row turns cyan with the word "liked"; a dislike
    removes the row (`removeFromQueue` for a row, `next()` for the current track).
- **Caveat in the UI**: the map is a PCA projection; the engine's cosine distance is shown as a
  number and the 0.10 dislike radius is never drawn.
- **Fallbacks**: no WebGL2 or context lost → static Canvas 2D of up to 6K points; reduced motion →
  one static frame per data change; global-catalog sessions show BPM and key only
  (`explainable=false`); a 404 explain (expired or other user's session) returns to idle; legacy
  persisted sources without a session id read "This queue does not come from a radio session".
- **Performance**: 14K points desktop, 6K mobile (an explicit exception to the ~10K WebGL2 rule;
  measure on a mid-range Android and lower with `deviceMemory ≤ 4`); one draw call; DPR ≤ 2;
  explain refetched only on a new session, queue growth (500 ms debounce) and feedback responses.
  Seed search debounced and `/api/genres` fetched once (today every keystroke fires a search plus
  the full genre list; `pages/use-radio-controller.ts:42-63`).

```ts
// GET /api/radio/session/{session_id} (owner only, 404 otherwise): Redis session read, no DB.
interface RadioSessionExplain {
  session_id: string;
  mode: "seeded" | "discovery";
  profile: "discovery" | "track" | "contextual" | "global_catalog";
  explainable: boolean;
  seed: { type: string; label: string; vector: number[] | null };
  weights: {
    sound: number;
    artists: number;
    genre: number;
    bpm: number;
    energy: number;
    key: number;
    era: number;
  };
  target: {
    initial: number[] | null;
    current: number[] | null;
    like_blend: number;
    blend_step: 0.08;
    max_blend: 0.4;
    liked_count: number;
    session_disliked_count: number;
    dislike_radius: 0.1;
  };
  picks: Array<{
    track_id: number;
    order: number;
    source: string;
    camelot: string | null;
    distance: number;
    pool: { size: number; by_source: Record<string, number> };
    terms: Record<
      "sound" | "artists" | "genre" | "bpm" | "energy" | "key" | "era",
      number | null
    >; // penalty, null = no data
    adjustments: {
      source: number;
      variant: number;
      curation: number;
      artist_repeat: 1 | 2;
    };
    cost: number;
  }>; // ring of the last 60 picks, penalties at 4 decimals
}
// POST /api/radio/feedback adds the same target block. Client fit = clamp(1 − Σ w·p / Σ w, 0, 1) over available terms.
// GET /api/bliss/map → ui_snapshots('bliss:map','global'): {status: "ready"|"warming"|"empty", revision, count,
//   points: {desktop, mobile}, radius, basis: {mean[20], components[3][20], scale}}; warming enqueues build_bliss_map.
// GET /api/bliss/map/{revision}.bin?tier=desktop|mobile → int16 xyz, private immutable cache, ETag, 304,
//   revision validated against the snapshot, resolved with resolve_confined_path; fetched with apiFetch.
```

Backend: per-pick terms captured inside `_select_radio_candidate_from_rows` (no new queries);
per-session lock for `next` and `feedback`; owner checks on `next`, `feedback`, `DELETE` and the new
GET (B15); `build_bliss_map` task (maintenance) writing `{rev}.desktop.bin`/`{rev}.mobile.bin`
atomically (2 revisions kept), PCA with sign normalisation and Procrustes alignment to the previous
revision, rebuilt when the vector count changes by 2% or more, coalesced trailing-edge over 6 h
(5.3.2, Redis due set) from the bliss daemon
and nightly; always upserts (also `empty`); router registered with the `radio` tag.

### 4.16 Paths `/paths`, `/paths/:id` (P1 · L)

- **Focal visual**: route map on `/paths/:id` replacing `PathRouteVisualization`
  (`pages/PathDetailParts.tsx`), from the site's PathsDive (`site:src/components/listen/
PathsDive.astro`, `site:src/scripts/listen/paths.ts`) and Inside path tile.
  - Phase A (2D, existing data): x = step progress, y = energy (interpolated across unanalysed
    steps; flat line with `N OF M ANALYSED` when none); nodes `START`, `NN` (index + 1) and `END`
    with `NN BPM · 8A` labels (all when 8 steps or fewer; else ends, active and focused); a genre rail
    below for scene planners (`JAZZ → SOUL → FUNK`, one text node or `GenrePill`s) with edge chips
    (`PARENT 1.0`, `FUSION 1.6`, `RELATED 2.5`, `JUMP`); header `MUSIC PATH · 20 STEPS · 92 → 128
BPM` and `PLANNER · GENRE MAP | SCENES | SOUND LINE` plus `LLM REVIEW · N SWAPS` when it ran;
    footer `SAVED · 3 d ago` with Regenerate and Delete as ghost buttons.
  - Traveller: the step whose track is playing (`currentTrack`, conditioned on `playSource` being
    this path) gets a ring; the segment up to it is lit. Changes per track, never per frame.
  - Interactions: click or Enter plays from that step (`playFromStep`); roving tabindex; focus
    scrolls the track list.
  - Motion: one draw-in per path id (endpoints, polyline, staggered nodes via `:nth-child` delays in a
    recipe, label scramble); no inline styles (drift budget).
  - Layout math in `app/listen/src/components/paths/path-route-layout.ts` (pure, table-tested).
  - Planning runs as a task from the first v3 Paths change (B18): `compute_music_path` and its
    routes ship with the `plan_meta` backend (plan 4.9a), ahead of the route map. New Listen builds
    create, preview and regenerate only through the task route; nodes enter as `path_steps`
    batches arrive on the task stream (PD36). The footer's Regenerate calls the task route.
  - Phase B (bliss map): the same SVG over the WebGL cloud with steps projected from their
    `bliss_vector`; falls back to phase A.
- **List `/paths`**: each row's leading slot is a 64×24 energy sparkline with endpoints; meta `20
STEPS · 92 → 128 BPM · 3 d`; bliss rows keep origin → waypoints → destination.
- **Edge cases**: genre → same genre falls back to the sound line; fewer than 2 steps shows endpoints
  and `NO ROUTE · REGENERATE`; a regenerate dims the old route until the new one draws.

```ts
// music_paths.plan_meta JSONB (migration with a summary backfill), written only inside compute_music_path after
// LLM refinement (never on the synchronous routes); exposed by get_music_path_row, serialize_music_path_row and
// the hand-built payloads.
interface PathPlanMeta {
  planner: "genre_graph" | "artist_scene" | "bliss_line";
  genre_route: Array<{
    slug: string;
    name: string; // name capitalised client-side
    edge:
      | "start"
      | "parent"
      | "child"
      | "influence"
      | "fusion"
      | "related"
      | "excursion"
      | "jump";
    cost: number | null;
  }>; // from path_genre changes in the final tracks, edge looked up both ways
  review: { ran: boolean; replaced: number };
  planned_at: string;
  summary: {
    bpm_start: number | null;
    bpm_end: number | null;
    energy: Array<number | null>;
  }; // list glyph
}
// Each step adds camelot (derived in the serializer from app/crate/camelot.py with enharmonics, 4.7).
// Legacy rows: plan_meta null; planner shown as "—"; scenes inferred when path_genre exists.
// Task route (with plan 4.9a): POST /api/paths/plan {…create body, preview?: boolean} and
//   POST /api/paths/{id}/regenerate?mode=task → 202 {task_id, deduplicated}; events path_planner,
//   path_genre_route, path_steps (≤5 batches, no bliss vectors), path_review, task_done; owner check (B16).
```

B18 (warning): `POST /api/paths`, `/regenerate` and `/preview` plan synchronously in the request (up
to 100 KNN queries, graph loads, an LLM call). Adding `plan_meta` and a visible Regenerate there
would grow that path, so the task route lands first, inside plan 4.9a, and:

- new Listen builds call only the task route; the route map's Regenerate (plan 4.9b) uses it;
- the synchronous routes stay for shipped Capacitor builds with a deprecation date in the release
  note, a per-user rate limit, and no LLM refinement (`refine_music_path_with_llm` is skipped);
- `plan_meta` is written only inside the task, plus the one-off summary backfill.

Tests: the synchronous routes never call `refine_music_path_with_llm` (patched to raise); the rate
limit returns 429; task events and dedup; ownership; the Listen client deduplicates steps by index.

### 4.17 Stats `/stats`, `/stats/global`, `/users/:u/stats` (P0 · M) and Digging

- **Focal visual**: the listening heatmap band (`site:src/components/viz/Heatmap.astro`,
  `site:src/scripts/viz/heatmap-view.ts`) at full width, replacing the one-third
  `StatsHeatmapCard`; XL counters replace `StatsHeadlineNumbers`.
- **Counters**: hours listened (`overview.minutes_listened / 60`, minutes under 10 h), artists
  (hidden when null), top genre scrambled only when it changes, plays and active days at tier M,
  `Today` with an on dot (own stats only). Count-up from the previous value.
- **Grid**: 168 cells in an HTML grid; alpha by minutes/max through a `::before` with opacity (no
  per-cell `color-mix`); peak outlined; night band from `night_hours` labelled `night 22–05 · 31%`;
  glow only on cells at level ≥ .6. Readout `Peak Saturday 23:00 · 412 min`, replaced on hover, tap
  or focus (no `aria-live` on hover). One `style` per cell shared by the tile and the band. The
  `.stats-heatmap*` recipe moves from the shared `app/shared/ui/tokens/recipes.css` (line 2440) into
  Listen CSS in `app/listen/src` in the same change and is extended there (DS 6.7: visual-specific
  CSS lives in the app; Admin does not use it today). It moves back to shared when Admin adopts the
  heatmap (Admin phase 2 below).
- **States**: pending (skeleton plus `building`, polling 1.5 s ×40 once B12 is fixed); empty;
  zero minutes (flat grid, `No listening in this period`); stale served as is; Crate Pulse labelled
  `listener local time` with no now outline and hidden below 3 listeners (PD43).
- **Accessibility**: figure sentence; `role="grid"` where each `role="row"` is its own grid
  (`grid-template-columns: repeat(24, minmax(0, 1fr))`). No `subgrid` (Safari 16 and Chrome 117
  floors; it breaks iOS 15 and the WebView2 111 Windows floor) and no `display: contents` (it drops
  the role in older WebKit); roving tabindex; forced-colors outlines.
- **Other cards**: become panels; signal tape, decade bars and genre trend stay hand-built SVG
  restyled; top lists as hairline rows; sound profile as feature bars (readout component).
- **Digging**: chapters as full-bleed XL numerals with the artist name scrambled on reveal; the share
  story canvas loads Bricolage Grotesque and JetBrains Mono with `FontFace` before drawing.
- **Admin phase 2**: Settings > Downloads quiet hours (`DownloadWindowCard`): instance heatmap in
  UTC (`heatmap_utc`) with the download window overlaid, `02:00–07:00 UTC · 3% of listening`, and
  `Use quietest window` (circular search, updates local state and calls the existing PUT). The
  shared component then moves to `@crate/ui/domain/stats` and the `.stats-heatmap*` recipe back to
  the shared `recipes.css`.

Contract: existing `heatmap {cells[7][24], peak, night_share}` plus `night_hours`; instance payload
adds `heatmap.listener_count` and `heatmap_utc` (one CTE with the local heatmap in the instance
builder). PD43 is enforced by the instance builder, not the UI: below 3 listeners `heatmap.cells`
is an all-zero 7×24 grid (shipped Listen builds call `cells.flat()`), `peak` and `night_share` are
`null`, and `hidden_reason: "few_listeners"` is set; `heatmap_utc` follows the same rule (plan 2.20,
5.12; behaviour change, 3.4.2); `StatsDashboardResponse` declares `snapshot` with `pending` and the new fields (B12); one
limits constant (`albums_limit` 14) for user prewarm, instance prewarm, API defaults, worker
fallbacks and Listen, with a pytest asserting the subject keys match.

### 4.18 Radar `/upcoming` and setlists (P1 · M)

- **Focal visual**: the setlist ticket (`site:src/components/viz/Setlist.astro`), already ported in
  `components/upcoming/UpcomingShowExpandedView.tsx`, completed:
  - real notches with a CSS mask on two stacked boxes (`-webkit-mask` for iOS 15);
  - header `MonoLabel` with the countdown as key word (PD51) and `date · time · Ticketmaster`;
  - setlist line `PROBABLE SETLIST · 12 recent shows · Setlist.fm` (or tour name, or `N shows`);
  - rows with `in library` (filled dot) or `missing` (ring, dimmed title), at most 20, keys by title;
  - footer `9 of 11 playable from your library` with the round play button; N always equals the
    queue `Play setlist` builds (same stored match, same cap).
  - States: pending (`Preparing setlist`, warn dot, arrives by SSE), missing (`No recent setlists on
Setlist.fm`), partial (old entries without a match: rows without status until the rematch
    lands), zero local (Play disabled with the reason).
  - Row entrance only on mount (55 ms stagger, longhand animation properties, no `opacity: 0` base).
- **Shared**: `@crate/ui/domain/shows/{SetlistTicket,ProbableSetlist}.tsx` plus `setlist.ts`
  (explicit exports), used by Listen Radar, the Listen artist setlist modal (`ArtistSetlistModal`),
  Admin `/upcoming` and the Admin Artist setlist tab (with its frequency/plays columns via a detail
  slot). Deletes the unused shared `ShowCard` and the local ticket pieces.
- **Home**: show prep and the upcoming feature use the ticket header and the summary.

```ts
interface ProbableSetlistSong {
  title: string;
  position?: number;
  frequency?: number;
  play_count?: number;
  last_played?: string;
  on_tour?: boolean;
  library_status?: "local" | "missing";
  library_track_id?: number;
  track_entity_uid?: string;
}
interface ProbableSetlistContext {
  mode: "active_tour" | "recent_shows" | "historical_weighted";
  source_show_count: number;
  source_date_from: string | null;
  source_date_to: string | null;
  tour_name?: string;
  matched_at?: string;
}
// /api/me/upcoming: shows gain probable_setlist_status ("ready" | "pending" | "missing"); source already exists
// (api/me.py:1553; only the Admin /api/upcoming adds it, 4.4); a top-level
// probable_setlists map keyed by artist carries {songs (≤20), context} so 120 shows do not repeat songs. The
// per-show probable_setlist (≤8 today, api/me.py:1557) stays, deprecated, until the minimum supported Listen
// client reads the map; the release note names that version (3.4.2).
// home:discovery upcoming section: same fields. setlist-playable (+ by-entity): {tracks, songs, context, status}
// from the stored match (ANY(:ids), existing columns incl. bliss_vector, ids that vanished trigger a rematch).
// Enrichment payloads overlay the stored setlist and use context.source_show_count (fixes total_shows in 4 places).
```

Backend (PD5): matcher moved to `crate/setlist_matching.py` with a hardened `contains` rule (word
boundary, 4+ characters, both directions; tests moved from `test_track_versions.py`); batched
candidate query by `LOWER(a.artist) = ANY(:names)`; the worker stores `library_status` and
`matched_at` with the setlist; `refresh_probable_setlist` gains `mode='rematch'` (own pending key,
keeps the remaining TTL with `KEEPTTL`, no Setlist.fm call), triggered after `process_new_content`
(only if a setlist entry exists) and artist or album deletion; invalidations emitted only when the
payload or status changes; one batched read without L1 (`get_cache_many`) everywhere a setlist is
read; capped rematch enqueues per request plus a one-off backfill after deploy (fixes B22).
`/api/me/upcoming` stays per request in v3; turning it into a snapshot depends on how `near_me`
mode stores the listener's location (section 7).

### 4.19 Artist and Album (Listen) (P1 · L / M)

- Artist: entity header (`ARTIST · 12 albums · listened 41 h` when the user stats payload carries
  hours; no new aggregate); top tracks as track rows with mono plays and `124 · 8A`; albums rail; bio
  lede; community sections as hairline rows; Radio CTA pill; setlist modal per 4.18.
- Album: mono meta `ALBUM · 2019 · 10 TRACKS · 41 MIN · FLAC`; `AlbumTrackList` showing the `bpm`,
  `audio_key` and `energy` the rows already carry; `ReleaseCountdown` as an XL clock `T−12 d`; no
  glass toolbar. No energy arc unless PD52 says otherwise.

### 4.20 Library, Crates, Playlists, Search (P1 · M)

- Library: `StatStrip` of artists, albums, liked, crates from `get_user_global_library_counts`; text
  tabs that keep today's URL state (`pages/Library.tsx:97-132` reads `useParams().section` on
  `/collection/:section` and `?tab=` on `/library`, and writes them back), so `?tab=` deep links and
  the path form keep working and match the plan 1b.3 helper; media grids; Liked as track rows. This change moves `StatStrip` from
  `app/ui/src/components/admin/` to `@crate/ui/primitives` (copy by props, token-only class names),
  deletes the Admin copy and repoints Admin's imports (3.1.4).
- Crates: keep `CrateCoverFlow`; header `5 members · 18 albums`; album order as a `HairlineList`
  with drag handles; ZIP download as a `ProgressHairline` on the task stream.
- Playlists: entity header `PLAYLIST · smart · 48 tracks · 3 h 12 min`; rule chips; collaborators
  with dots; track rows; composer forms.
- Search (page and dropdown): grouped `HairlineList`s under `ARTISTS · 4`, match highlighted in
  `accent-action-hi`, keyboard active bar, remote results with `via <node>`.

### 4.21 Settings (P1 · L)

- Sections in the panel shell (restyle `SettingsPrimitives.Section` once); connection states as
  dots (scrobble, Bandcamp, servers, OpenSubsonic).
- **Devices** (P2 · M, `site:src/components/viz/Devices.astro`): a new top-level section after
  Playback, promoted from Account. A bottom-aligned row of line-art glyphs (desktop, Android, iOS,
  Cast while this sender has a session, Subsonic, generic) with mono captions, then a `HairlineList`
  with Play on <device> / Play here and Forget.
  - Glyph states: active (playing or paused, from the session status), online (live Connect
    instance), recent (5 min), offline, unavailable (reason as caption).
  - The shared session position is a progress line re-anchored on each server message and moved by
    a CSS linear transition to the end (no per-frame JS); offline devices show their own checkpoint
    (`stopped at 2:14 · 3 h ago`).
  - Header `DEVICES · 2 online · 1 recent · playing on Desktop`; `Reconnecting` when the WS status
    is not connected.
  - The playback target popover rows use mini glyphs.
  - Data: `/api/me/devices` adds a raw `checkpoint` (one LEFT JOIN, presence through one cache
    `MGET`); client capability keys `form_factor`, `os`, `display_mode`; Connect WS fixes (B21);
    `status` added to `PlayerConnectValue`; refetch on device set, active instance or pause/stop
    changes. Behind the Crate Connect build flag (PD38).
- **Access tokens** (P2 · M, after the Smart Mix merge, `site:src/components/viz/
TokenAllowlist.astro`): list of tokens (display name, 12-character prefix bright plus masked
  rest, scope chips, created/expires/last used, status dot: used in 7 days on, never or idle off,
  expiring in 7 days or expired warn); per token a folded `Reach · N routes` list (method badge plus
  route, reachable rows lit; HEAD not shown for the stream route that returns 405); create form
  where toggling scopes lights the draft's reach; secret shown once; Rotate hidden on expired
  tokens; first-use confirmation (`<name> connected`) on focus refetch. Data: new
  `GET /api/auth/access-tokens/policy` (interactive session only; no DB; route metadata defined
  after `_is_vdj_access_token_request` so the site's drift test keeps parsing the allowlist) plus
  `/api/capabilities` for server flags. Precondition: `last_used_at` touched only on allowed
  requests.
- **Offline**: two `Meter`s (`readyTrackCount / trackCount`, `totalBytes` against
  `navigator.storage.estimate()`), errors as an amber count with text.
- **Playback**: crossfade and smart-transition controls with a static equal-power glyph sized by the
  chosen seconds.
- Language as chips; servers as a list with reachability dots; shows location field; sleep timer
  chips; independent motion/accessibility controls. The visual theme editor is removed in plan 1.13.

### 4.22 Social, Upload, Offline library, Auth, Share (P2)

- Social: `affinity_score` as an L numeral plus the band word (no band colours); reasons as a
  `HairlineList`; plays and minutes `StatStrip`; badges as mono tags without tones.
- Upload: per-file byte `ProgressHairline` with mono speed and ETA; after upload, the returned
  `library_upload` task's phases (`preparing`, `importing`, `syncing`, from its `TaskProgress`) as
  a `StepRail`, drawing only phases the task emits. This change
  moves `StepRail` from `app/ui/src/components/admin/` to `@crate/ui/domain/tasks/StepRail.tsx`
  (`app/shared/ui/domain/tasks/StepRail.tsx`; copy by props, token-only class names) and deletes the
  Admin copy (3.1.4, plan 6.15).
- Offline library: status rows with ready, error and downloading dots; storage meter.
- Login, Register, callback, Server setup: header anatomy, forms, the probe status line as a 7 px dot
  plus mono text.
- Share sheet per the dialog recipe; story canvas with v3 faces loaded via `FontFace` and colours via
  `readCssColorToken`.
- Remote provenance tag (3.1.5) and an Info tab "Source" mini route (`north.crate → your node → this
device · relayed`) from `Track.remote` and `lib/playback-provenance.ts`.

---

## 5. Data and backend changes

### 5.1 Preconditions (fix first)

| ID       | Fix                                                                                                                                                                                                                                                                                                                                                       | Size | Ships                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| B1       | `list_domain_events` checks `any(msgs for _, msgs in entries)`; reads the PEL and `>` in the same tick (or `XAUTOCLAIM`) so deferred events do not block; fake Redis in tests returns `[(stream, [])]`. In the same change coalesce ops refreshes to one per 60 s, trailing-edge (5.3.2), otherwise V5 rebuilds `ops/dashboard` every 5 s during analysis | M    | before any snapshot-driven visual                              |
| B2       | Serve-stale-and-schedule for `ops/dashboard`, health, tasks, stack and logs surfaces; drop `fresh=1` from HTTP and from focus refreshes                                                                                                                                                                                                                   | M    | first                                                          |
| B3       | Metrics system reads the persisted governor sample and `build_analysis_payload()`                                                                                                                                                                                                                                                                         | S    | with the governor                                              |
| B4       | SSE generators read in `asyncio.to_thread`, debounce, never build                                                                                                                                                                                                                                                                                         | S    | first                                                          |
| B5       | `insights` snapshot built by `refresh_insights_snapshot` (4.7)                                                                                                                                                                                                                                                                                            | M    | before Insights and Discover                                   |
| B6       | Mood snapshot and pools (4.14)                                                                                                                                                                                                                                                                                                                            | M    | can ship alone                                                 |
| B7       | Genre counts and Sound Intelligence from the wheel snapshot; catalog fallbacks serve stale; the Go read plane's `/api/genres` and genre detail read the `genre_counts` the builder writes (4.6.3 item 6)                                                                                                                                                  | M    | with the wheel                                                 |
| B8       | One-query EQ resolver (4.12)                                                                                                                                                                                                                                                                                                                              | M    | with the EQ panel                                              |
| B9       | Acquisition sampler in its own crate-worker thread (2 s slskd timeout; every 2 s while watched, every 30–60 s while transfers are active and nobody watches, off otherwise; 4.4), pubsub stream, capability gate                                                                                                                                          | M    | before Download                                                |
| B10      | Per-task streams only for the selected task                                                                                                                                                                                                                                                                                                               | S    | with QueueLanes                                                |
| B11      | Projector routes only `federation.import` to ops; other federation events to the topology, where structural events rebuild coalesced (≥5 s) and `federation.stream.*` events rebuild only while the topology is watched (4.10)                                                                                                                            | S    | can ship alone                                                 |
| B12      | Declare `snapshot` (with `pending`) and the new fields in the stats schemas; treat pending as not empty                                                                                                                                                                                                                                                   | S    | can ship alone                                                 |
| B13      | Failed checks keep their issues; health signals published                                                                                                                                                                                                                                                                                                 | S    | can ship alone                                                 |
| B14      | Approve with `pairing_uid`, inbound only; `approve_pairing` checks `expires_at`                                                                                                                                                                                                                                                                           | S    | hotfix                                                         |
| B15, B16 | Owner checks on radio routes and task event streams (`params_json->>'user_id'` with an admin bypass)                                                                                                                                                                                                                                                      | S    | hotfix                                                         |
| B17      | Global catalog status snapshot at reconcile completion; presence query rewrite                                                                                                                                                                                                                                                                            | M    | before those pages                                             |
| B18      | Paths planning as a task (`compute_music_path`); synchronous routes deprecated, rate-limited and without LLM refinement (4.16)                                                                                                                                                                                                                            | L    | with the `plan_meta` backend (plan 4.9a), before the route map |
| B19      | Strip `payload_json` and redact user subjects before persisting runtime state                                                                                                                                                                                                                                                                             | S    | hotfix                                                         |
| B20      | Server-side cover lookup for Download: cache read only in the request, misses through one deduplicated task (contract in 4.4)                                                                                                                                                                                                                             | M    | before Download                                                |
| B21      | WS heartbeat refreshes presence and hub TTLs; disconnect touches `last_seen_at`                                                                                                                                                                                                                                                                           | S    | before Devices                                                 |
| B22      | Batched setlist reads without L1                                                                                                                                                                                                                                                                                                                          | S    | with the ticket                                                |
| B23      | G1, G2, G3, G7 (`local_*` override columns, 4.6.3 item 5)                                                                                                                                                                                                                                                                                                 | M    | plan 2.18d, in the Genres group before the wheel (3.7)         |
| B24      | Client loops to refs; one shared crossfade clock                                                                                                                                                                                                                                                                                                          | M    | with the player                                                |

Small bug seen on the way: `api/curation.py` deletes `listen:explore_page:v1:{user}` but the key is
`v2` (Explore follow state stale up to 600 s).

### 5.2 Visual → contract

| Visual                                                                                                                                                                                  | Contract                                                                                                                                              | Exists           | Computed where                                                                                                                                 | Freshness                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health scan and tile                                                                                                                                                                    | `GET /api/admin/health-checks`, live surface `health` (events `health`, `health-scan`); drill-down `GET /api/admin/health-checks/{check_type}/issues` | partial          | worker at scan start/end, `refresh_admin_surface` after mutations; CTE in `db/queries/health_issues.py`                                        | push (seconds), per-check events live                                                                                                                                                   |
| Album sidecar                                                                                                                                                                           | `GET /api/manage/albums/{id}/portable-metadata`                                                                                                       | partial          | per request, one `read_scope` scoped by album                                                                                                  | on mount, after task done; per-track task events                                                                                                                                        |
| Release timeline                                                                                                                                                                        | `acquisition:new_releases` snapshot and stream                                                                                                        | partial          | projector on release events; reconciler 60 s                                                                                                   | ~5–10 s; analysis counts ≤60 s                                                                                                                                                          |
| Acquisition lanes                                                                                                                                                                       | `GET /api/acquisition/snapshot` (+ `lanes`), `/stream`; `POST /api/acquisition/covers`                                                                | partial          | `acquisition-sampler` thread in crate-worker, Redis key; DB row on change or ≤ 1 per 60 s; covers from a cache filled by one deduplicated task | 2 s while watched; 30–60 s while transferring unwatched; off otherwise                                                                                                                  |
| Imports                                                                                                                                                                                 | `GET /api/imports/queue`                                                                                                                              | no               | per request, one CTE over `import_queue_items` and tasks                                                                                       | on mount, task events, focus                                                                                                                                                            |
| Enrichment orbit                                                                                                                                                                        | `GET /api/admin/artists/{id}/enrichment/sources`, `POST /api/artists/{id}/enrichment/refresh`, `enrichment.source` signals                            | partial          | per request (one CTE); worker writes source rows                                                                                               | on mount, run signals live                                                                                                                                                              |
| Genre wheel                                                                                                                                                                             | `GET /api/admin/genres/wheel`; Listen `/api/catalog/genre-wheel`                                                                                      | partial          | `refresh_genre_wheel_snapshot` (fast, deduped, trailing-edge ≥120 s), also writing `genre_counts`                                              | membership choke points, taxonomy events, nightly floor; mutation patches immediate                                                                                                     |
| EQ inheritance                                                                                                                                                                          | path on preset payloads, `chain[]`                                                                                                                    | partial          | in-memory runtime graph per request                                                                                                            | per track change, invalidations                                                                                                                                                         |
| Track readout                                                                                                                                                                           | album analysis, neighbours, ops `analysis.recent`, `/info` `bliss_vector`                                                                             | partial          | per request by index; recent off-request                                                                                                       | static per track; recent ≤120 s                                                                                                                                                         |
| Queue lanes                                                                                                                                                                             | `GET /api/admin/queues`, live `queues`                                                                                                                | partial          | `queue-lanes-writer` thread in crate-worker, single writer                                                                                     | ≥3 s apart while watched; row not written otherwise (an unwatched GET may serve an older row, shown as `updating`, until the first watched tick, about 1–3 s); `worker_live` every 15 s |
| Governor gauges                                                                                                                                                                         | `GET /api/admin/governor`, live `governor`                                                                                                            | no               | `governor-sampler` thread, Redis key; DB row on verdict change or ≤ 1 per 60 s                                                                 | 5 s while watched, 60 s otherwise                                                                                                                                                       |
| Event pipeline                                                                                                                                                                          | `GET /api/admin/event-pipeline`, live `pipeline`                                                                                                      | partial          | projector after `XACK` batches; Redis key and publish only while watched; DB row on state change or ≤ 1 per 60 s                               | push and 15 s heartbeat while watched; row ≤ 60 s old otherwise, shown as `updating`                                                                                                    |
| Redis pair                                                                                                                                                                              | `GET /api/admin/redis`, live `redis`                                                                                                                  | no               | `redis-sampler` thread in crate-worker, Redis key; DB row ≤ 1 per 60 s                                                                         | 15 s while watched, 300 s otherwise                                                                                                                                                     |
| System map                                                                                                                                                                              | `stack-snapshot`, `stack-stream`                                                                                                                      | partial          | sampler thread (placement PD54) with leader lock, one-shot stats, bounded pool; Redis key plus publish; row on state change or ≤ 1 per 60 s    | 10 s while watched; container list every 10 min otherwise                                                                                                                               |
| Federation topology                                                                                                                                                                     | `GET /api/admin/federation/topology`, live `federation`                                                                                               | no               | projector: structural events coalesced ≥5 s; stream events only while watched; health poll floor 60 s                                          | structural ~5–10 s; relay counts ≤5 s while watched, ≤60 s otherwise                                                                                                                    |
| EQ curve, glyph                                                                                                                                                                         | effective EQ + client live store                                                                                                                      | partial          | resolver per track; client                                                                                                                     | per change                                                                                                                                                                              |
| Mix strip                                                                                                                                                                               | client model (phase A); plans and profiles (phase B)                                                                                                  | partial / branch | client; Smart Mix planner                                                                                                                      | live clock                                                                                                                                                                              |
| Mood map                                                                                                                                                                                | `GET /api/browse/mood-map`, pools                                                                                                                     | no               | `refresh_explore_mood_map`                                                                                                                     | trailing-edge ≥900 s, nightly; max age 24 h                                                                                                                                             |
| Insights                                                                                                                                                                                | `GET /api/insights` (+ `snapshot`)                                                                                                                    | partial          | `refresh_insights_snapshot` (maintenance, deduped)                                                                                             | nightly plus coalesced events (30 min)                                                                                                                                                  |
| Heatmap                                                                                                                                                                                 | stats dashboard (+ `night_hours`, instance `heatmap_utc`)                                                                                             | yes              | stats projections in workers                                                                                                                   | 300 s, history invalidation                                                                                                                                                             |
| Setlist ticket                                                                                                                                                                          | upcoming fields, setlist-playable                                                                                                                     | partial          | worker match at setlist write, rematch task                                                                                                    | minutes after library changes                                                                                                                                                           |
| Radio sound map                                                                                                                                                                         | session explain, bliss map                                                                                                                            | partial          | engine (Redis); `build_bliss_map`                                                                                                              | per session event; map ≤ daily                                                                                                                                                          |
| Paths route map                                                                                                                                                                         | `plan_meta`, steps; planning task events                                                                                                              | partial          | inside `compute_music_path`                                                                                                                    | static per path                                                                                                                                                                         |
| Devices                                                                                                                                                                                 | devices + checkpoint, Connect WS                                                                                                                      | partial          | per request (one join)                                                                                                                         | WS push                                                                                                                                                                                 |
| Access tokens                                                                                                                                                                           | policy endpoint                                                                                                                                       | branch           | code constants                                                                                                                                 | on mount                                                                                                                                                                                |
| Coverage-only data visuals: schedules, presence strip, reconcile rail, setup and upload rails, offline meters, i18n meters, completeness meters, lyrics line progress, affinity numeral | existing payloads plus the additive `last_runs` settings read                                                                                         | yes              | existing                                                                                                                                       | existing                                                                                                                                                                                |

### 5.3 Cross-cutting backend

#### 5.3.1 One Admin live stream

- `GET /api/admin/live-stream?surfaces=queues,governor,health,pipeline,redis,federation` (FastAPI).
  This name is canonical for all three documents; `/api/admin/live` (`backend-admin.md` section 5)
  is not used. Settled: Traefik sends only the listed GET prefixes to the read plane
  (`docker-compose.yaml:460-478`: `/api/catalog/`, `/api/me/…`, `/api/genres`, `/api/artists/`,
  `/api/albums/`, `/api/search`, `/api/tracks/`, and the SSE paths `/api/cache/events` and
  `/api/me/home/discovery-stream`), so `/api/admin/*` goes straight to crate-api. The `-stream`
  suffix is a naming convention shared with `ops-stream`, `stack-stream` and `tasks-stream`, not a
  routing need. Permission per surface at connect (403 only when no requested surface is allowed);
  unknown surfaces rejected.
- One stream per tab and nothing else: no separate per-surface stream (Health included) and no
  polling fallback "until the stream exists"; the stream ships (plan 2.14) before any instrument
  that reads it. `health` is one surface carrying the `health` and `health-scan` events (4.2).
- Demand signal (helper `app/crate/admin_viewers.py`): on connect and on every 30 s heartbeat the
  stream sets `admin:live:viewers:<surface>` with `EX 60` for each allowed surface. The routes that
  keep their own streams or polls set their key the same way: the tasks stream (`tasks`), the
  acquisition stream (`acquisition`) and the Stack endpoints (`stack`). Samplers and writers use
  their fast cadence only while that key exists (queues 4.8, governor 4.8, pipeline and Redis 4.8
  System, stack 4.8, acquisition 4.4, federation topology 4.10). While slow or idle they check the
  key once per second (one Redis `EXISTS`), so a new viewer gets a fresh sample within about a
  second instead of reading a stale one. Endpoints and samplers import the key names from
  `admin_viewers.py`, never a literal.
- An open stream is not proof that someone is watching. `OpsSnapshotContext`, the pattern the
  provider copies, keeps its `EventSource` open in hidden tabs, and the Dashboard is the landing
  page. So:
  - `AdminLiveProvider` closes the live stream once `document.visibilityState` has been `hidden`
    for about 30 s and reopens it when the tab is visible again (the reconnect sends the current
    surface versions). A closed stream stops renewing its keys, which expire within 60 s. The
    same rule applies to the clients of the tasks and acquisition streams and to the Stack page's
    reads.
  - Surfaces are subscribed only by the instruments that show them live. The Dashboard reads its
    Operations numbers from the ops snapshot and the persisted governor verdict (4.1), so it never
    sets the `queues` or `governor` keys.
  - Tests: a tab hidden for more than 30 s stops renewing viewer keys and resumes on visible; the
    Dashboard sets neither `admin:live:viewers:queues` nor `admin:live:viewers:governor`.
- Snapshot surfaces: on each publish (which carries only a version) the row is re-read by PK in
  `asyncio.to_thread`; versions already sent are skipped. Runtime surfaces (governor, health scan)
  forward the published payload verbatim. Heartbeat 30 s, server time in each message (stale is
  computed client-side).
- `open_pubsub`/`close_pubsub` accept several channels; channels registered in the SSE surface
  catalog (`db/ops_snapshot_eventing.py`).
- Client: `AdminLiveProvider` (pattern of `OpsSnapshotContext`: disposed flag, credentials, 5 s
  reconnect, plus the hidden-tab close above), gated per capability; effects depend only on the
  URL, the surface list and the visibility state.
- Stack, acquisition and new-releases keep their existing stream routes, made read-only.

#### 5.3.2 Refresh discipline

- Request handlers serve the cached row, mark it stale, and schedule a deduplicated refresh
  (serve-stale pattern of `db/instance_stats_dashboard_surface.py:125-200`). Cold reads return a
  warming or pending payload.
- Coalescing is trailing-edge everywhere (ops refreshes, `refresh_admin_surface`, genre wheel, mood
  map, insights). The debounce in `schedule_instance_stats_dashboard_refresh`
  (`instance_stats_dashboard_surface.py:190-198`) is leading-edge: it drops every trigger inside the
  window, so the last change of a burst is not shown until another event or a read; do not copy
  that part.
- The task row must not exist before it is due. The crate-worker service loop runs
  `redispatch_stale_pending_tasks(age_seconds=300)` every 60 s (`worker.py:328-333`,
  `db/repositories/tasks_maintenance.py:174`), which re-dispatches with no delay any pending task
  whose `updated_at` is older than 300 s. Creating the row up front and sending the Dramatiq message
  with `delay=window` would collapse every window over 300 s (mood map 900 s, insights 30 min, bliss
  map 6 h) to about 5 minutes, and the delayed message would then fire a second build. Recipe:

  - the first trigger sets `<key>:dirty` and `ZADD NX crate:coalesce:due <now + window> <key>`;
    later triggers only set the dirty key (`NX` keeps the first due time);
  - a due check in the crate-worker service loop (the projector loop for projector actions) reads
    `ZRANGEBYSCORE crate:coalesce:due -inf <now>`, claims each key with `ZREM` (only the caller
    that removed it proceeds) and only then calls `create_task_dedup` with no delay;
  - the handler clears the dirty key before building and, if it is set again during the build,
    `ZADD`s a new due time.

  Tests per surface: a burst of N events produces exactly one build after the window, and that
  build reflects the last event; with a 900 s window nothing is dispatched at 360 s (the
  redispatcher cannot pick it up) and exactly one build runs after 900 s.

- Runtime samples (governor, Redis, acquisition, event pipeline, stack) live in a Redis key with a TTL
  plus a publish. They are persisted to `ops_runtime_state` (an `INSERT … ON CONFLICT UPDATE` of
  JSONB, `db/ops_runtime.py:41`) only on a verdict or state change or at most once per 60 s, never
  on every sample. Samplers run fast only while their viewer key exists (5.3.1). Tests per sampler:
  no DB write and no external call while idle and unwatched; when the viewer key appears, the next
  sample arrives within about 1 s.
- `create_task_dedup` returns `None` on a duplicate; endpoints resolve the active task with
  `find_active_task_by_type_params` and return `TaskEnqueueResponse {task_id, deduplicated}`.
- Surfaces with an owner refresh themselves (queues and governor in crate-worker, health and
  portable metadata at task end, stack in its sampler, pipeline in the projector).

#### 5.3.3 New task types

`refresh_admin_surface`, `refresh_genre_wheel_snapshot`, `refresh_new_releases_surface`,
`refresh_explore_mood_map`, `refresh_insights_snapshot`, `build_bliss_map`,
`reconcile_trash_index` (maintenance, deduplicated, quiet; plan 2.17e), `lookup_acquisition_covers`
(fast, deduplicated, quiet; 4.4), `backfill_enrichment_sources` (one-off),
`backfill_setlist_matches` (one-off rematch of every stored setlist after deploy, plan 4.7a),
`compute_music_path` (with plan 4.9a, 4.16). Each needs a `TASK_POOL_CONFIG` entry, a
`TaskTypeInfo` in `task_registry.py`, a handler in a `*_TASK_HANDLERS` dict and the `worker.py`
handler groups (`test_task_runtime_contract.py`), plus a regenerated site `src/data/scale.json`.

Notifications (confirmed): `actors.py:821` calls `notify_task_completed` for every completed task,
and `telegram.py` sends whenever `telegram_enabled` is true, with no task-type filter. Several new
types run very often (`refresh_admin_surface` after every health mutation, the wheel, mood map and
insights refreshes), so production would send a Telegram message per run. Rule: a fifth
registration point, flags on `TaskTypeInfo` checked in `actors.py`: `notify: bool = True` gates
`notify_task_completed`; `quiet: bool = False` also skips the tasks-surface signal, the
`crate:sse:global` publish and default visibility in history and lanes, and implies no
notification. Every new `refresh_*` and `build_*` type, `reconcile_trash_index` and
`lookup_acquisition_covers` are `quiet=True`; every new `backfill_*` type (including
`backfill_setlist_matches`) and `compute_music_path` is `notify=False`; existing types keep
notifying. A test in
`test_task_runtime_contract.py` asserts both sets (plan Conventions, Task 2.11).

#### 5.3.4 Migrations

`main` is canonical for migration numbers. After Smart Mix merges and v3 rebases, inspect the
actual head, schema and integration tooling before allocating a new revision. Keep immutable
`db/schema_sections/*_vNNN.py` DDL, `ADD COLUMN IF NOT EXISTS`, concurrent-index
`autocommit_block` and the single-head test. The original analysis's 108/109–114 inventory and
reported dev/lab versions are historical, not current deployment instructions. Reuse resolved
Camelot/migration work; add or extend a renumber helper only if an actual unmerged collision
remains (plan 2.13). Never renumber deployed revisions. Any schema-version repair needs verified
mapping, backup and separate operational approval; there is no unconditional stamp step.

| Change                                                                                                                                            | For                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `health_check_runs.task_id`, `last_error`; `health_issues.resolution`, `resolved_task_id`                                                         | Health                                                 |
| `trash_track_files` (`quarantine_path` PK, size, mtime, artist, album, title, format, quarantined_at, source_track_id)                            | Health footer and Trash (plan 2.17e)                   |
| `album_portable_metadata` digest, section digests, artwork files, rehydrated_at, last task, last error, `catalog_changed_at`                      | Sidecar, coverage drift (4.3, 4.7)                     |
| `new_releases` lifecycle columns plus backfill                                                                                                    | Release timeline                                       |
| `artist_enrichment_sources`                                                                                                                       | Enrichment                                             |
| `genre_taxonomy_nodes.local_eq_gains`, `eq_override` (`none\|set\|cleared`), `local_name`, `local_description`; `genre_taxonomy_edges.suppressed` | Genres (G1, PD18; plan 2.18d)                          |
| `genre_counts` (`genre_id` PK, artists, albums, tracks, computed_at)                                                                              | Genre counts for FastAPI and the read plane (B7, PD21) |
| `import_queue_items.task_id`, `last_error`                                                                                                        | Imports                                                |
| `music_paths.plan_meta` plus summary backfill                                                                                                     | Paths                                                  |
| `user_play_events (ended_at DESC)` concurrent index                                                                                               | Governor (V8)                                          |
| partial index on terminal `tasks` (if `EXPLAIN` needs it)                                                                                         | Queue lanes                                            |
| `federation_catalog_cursors.item_count`, `last_delta_count`                                                                                       | Federation                                             |
| later: `track_mix_profiles.rms_envelope`, token telemetry columns                                                                                 | Mix lanes, tokens phase 2                              |

#### 5.3.5 Invalidation scopes

New Listen scopes, each mapped by an explicit `scopesForUrl` branch placed before the
`/api/browse` and `/api/catalog` prefix rules, which map everything else to `library`
(`lib/cache.ts:200-205`):

- `explore`: `/api/browse/mood-map` and `/api/browse/explore-page`, mapped to `explore` only;
  broadcast only when the mood counts or sample change (4.14);
- `genre_wheel`: `/api/catalog/genre-wheel`, broadcast by `refresh_genre_wheel_snapshot` only when
  the Listen row's payload digest changes (4.6.3).

Without those branches every crate edit, cover, tag or artist enrich (all broadcast `library`) would
make every Listen client with Explore open refetch the mood map and the whole wheel. Vitest asserts
the three URLs never resolve to `library`. PD23 for `genre:*` reaching
the projector and a possible `genre_taxonomy` scope mapped for `/eq` and `/genre` URLs before
narrowing taxonomy broadcasts. The `history` scope is global today (up to 8 broadcasts per aggregate refresh); visuals
reuse URLs so they do not add fetches.

#### 5.3.6 Site drift coupling

The site (`feat/website`) and v3 merge into the same monorepo; the site's Vitest suite reads these
product files. Whichever branch lands second updates the site tests.

| Product file                                                                     | Pinned shape                                              | v3 change touching it                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/ui/src/pages/Health.tsx`                                                    | `CHECK_LABELS`, `CHECK_DESCRIPTIONS` literals             | labels move to `repair_catalog.py`                                                                                           |
| `app/crate/repair_catalog.py`                                                    | positional `RepairCatalogEntry(` strings                  | kwargs appended at the end only                                                                                              |
| `app/listen/src/lib/equalizer.ts`                                                | `EQ_PRESETS` block, `label:` entries, `EQ_GAIN_MAX = 12;` | none (labels go to a new file)                                                                                               |
| `app/crate/genre_taxonomy.py`, `genres_taxonomy_edges.py`, taxonomy release JSON | definitions, `_EQ_*`, `VALID_RELATION_TYPES`              | none in shape; new release only by PD22                                                                                      |
| `app/crate/enrichment.py`                                                        | constants and the parallelism literal                     | instrumentation below the definitions                                                                                        |
| `app/crate/resource_governor.py`                                                 | `DEFAULT_*`, governed `frozenset(`                        | pure helpers added, names kept                                                                                               |
| `app/crate/actors.py`                                                            | `TASK_POOL_CONFIG` entries                                | new task types: regenerate `scale.json`                                                                                      |
| `app/crate/portable_metadata.py`, `db/queries/portable_metadata.py`              | keys, schema version literal, feature lines               | session refactor keeps the lines                                                                                             |
| `app/crate/api/browse_media.py`                                                  | `MOOD_PRESETS` dict                                       | moves to `crate/moods.py`: site test path updated                                                                            |
| `docker-compose.yaml`                                                            | redis flags                                               | PD45 lowers `crate-redis` `maxmemory`; the second-landing branch updates the site test (plan Task 7.6 lists the redis flags) |
| `app/crate/api/auth.py` and token repositories (after the Smart Mix merge)       | allowlist block between the constant and the def          | metadata after the def                                                                                                       |

Claims on the site with no test that the product contradicts:

- Radio score: the weights are right. `radio_engine.py` imports `_W_*` from
  `db/paths_candidates.py` (.34/.22/.16/.09/.08/.05/.03) and `_seeded_radio_weights` returns them
  for the discovery profile, which is what `RadioDive.astro` and `content/listen/en.ts:75` show.
  Only the label "Camelot 0.05" is wrong: the term is key/scale compatibility, so it reads "Key"
  (PD34). Optional note: track and contextual profiles override sound, artists and genre
  (.16/.30/.20, .01/.44/.26).
- System map memory: `map.ts`'s memory figures follow the base `docker-compose.yaml` and no site
  test checks them (`content/architecture/map.test.ts` does not read memory; `viz.test.ts` reads
  only the redis-server flags). Production deploys with `docker-compose.project.yaml`
  (`scripts/deploy.sh`), whose limits
  differ: crate-api 1536m (site 768 MB), readplane 256m (128 MB), postgres 4g (1 GB), projector 768m
  (512 MB), worker 2g (1.5 GB), maintenance-worker 1536m (1 GB), analysis-worker 4g (2 GB),
  playback-worker 2g (1 GB), media-worker 512m (256 MB). The product's Stack map reads real limits
  from its sampler, never from `map.ts` (4.8).
- Relation count in the website design doc ("five"; there are four).

Checked and consistent, not on this list: the Paths edge costs (parent, child and influence 1.0,
fusion 1.6, related 2.5, as in `db/paths_scene._genre_neighbors`), `NIGHT_HOURS` (`[22, 23, 0..5]`
as `_NIGHT_HOURS` in `db/queries/user_library_stats_signal.py`) and `redis-durable`. Two
different settings apply there: the container `mem_limit` is 512m in the base `docker-compose.yaml`
(`:167-176`) and 384m in the home compose, while Redis `--maxmemory 384mb --maxmemory-policy
noeviction` is the same in both. The site test (`content/architecture/viz.test.ts`) pins the
`--maxmemory` and policy flags (`viz.ts:10`, `384mb`), not the container limit. The Redis band's
durable meter measures against `maxmemory` (384 MB), never the container limit (4.8 System).

### 5.4 Shared frontend plumbing

- `@crate/ui/lib`, each module added in the change where an app first imports it (3.1.4, the
  export policy): motion gate and curve path helpers (plan 0.7), `useVisibleLoop` (3.4), `spring`
  with settle and `dt` clamp (3.5 or 4.3), `use-eq-morph` (4.3), `scramble` (4.5), `camelot`
  (3.9b), toaster config; `.ts` exports added where needed.
- Admin: `hooks/use-snapshot-stream.ts` (replaces `use-sse.ts` and 6 reconnect copies),
  `contexts/AdminLiveProvider.tsx` with `hooks/use-admin-live.ts`, `components/layout/PageHeading.tsx`,
  `components/admin/{StatStrip,StepRail}.tsx` (until Listen adopts them, 3.1.4), `lib/nivo-theme.ts`,
  `lib/motion/scramble.ts` (until plan 4.5 moves it to `@crate/ui/lib`). Admin instruments live in domain folders (`components/health`,
  `components/acquisition`, `components/imports`, `components/album/portable-metadata`,
  `components/artist/enrichment`, `components/genres`, `components/analysis`, `components/ops` for
  queue lanes, governor, event pipeline, Redis pair and stack map, `components/federation`), not in a
  `components/viz` folder.
- Listen: `lib/equalizer-live-store.ts`, `lib/equalizer-labels.ts`, `lib/sound-map/*` (projection,
  cloud decode), `components/sound-map/*`, `components/radio/*`, `components/paths/*` (including
  `path-route-layout.ts`), `components/explore/mood-map/*`, `components/devices/*`,
  `components/stats/ListeningHeatmap.tsx`.
- AGENTS.md amendments per PD1.

### 5.5 Delivery order

The implementation plan owns dependencies and internal milestones; the handover owns live status.
The accepted sequence is Smart Mix → approved v3 rebase → website integration → one joint P0 major
for Listen, Admin, site and docs. Foundation, Genres, player/EQ, Ops, Health and Stats are internal
review groups, not intermediate UI releases. Keep the integration branch until that major.

- Only 1.2–1.4 may proceed before integration/Checkpoint 0 under the approved Checkpoint 1A.
  Stop for Diego's review afterwards. 0.11 must precede 1.0; 0.14 may wait until the wheel.
- Retire the complete visual theme runtime in 1.13 before the major; retain semantic design tokens,
  accessibility and motion. No runtime removal is claimed by this documentation change.
- Independent R0 `[MAIN]` fixes require explicit assignment. Critical deployments, especially the
  projector restart and 2.11a–c, retain isolated operational observation and approval.
- Contracts precede instruments: Health before its tile, genre overrides/count parity before the
  wheel, task-based Paths planning before its map. Smart Mix overlap is reconciled after rebase.
- Preserve the existing P0 boundary for the joint major; P1/P2, Phase 6 coverage and follow-ons
  remain later unless expressly reprioritised. The single identity applies to every released screen.
- Small reviewable task diffs, tests and intentional CI baselines remain required. One integrator
  owns status, shared token/cn/budget serialisation and integration. Commit/push/PR/deploy/production
  actions still require Diego's go-ahead.

---

## 6. Decisions (decided 2026-10-15)

All decided on 2026-10-15 (plan Task 0.3); the reconciled list is
`2026-10-15-crate-v3-decision-register.md`. Every decision takes the recommendation below unless the
Status column says otherwise. The four conflicts were resolved for the product design: PD14 over
`[D18]` (regroup the sidebar), PD32 over `[D29]` (hold the last gains, own PR), PD29 over `[D38]`
(wire the toggles), PD28 over `[D23]`'s routing clause (factual trash footer now, routing later).
Behaviour changes that ship as their own PR to `main`: PD24, PD29, PD32, PD44, PD45, PD46.

The `[Dn]` column maps each decision to the spec's register (DS 6.12). Spec-only decisions with no
`PDn`, decided the same day: `[D9]` shared motion gate (yes), `[D12]` grain (none), `[D13]` glass
(none), `[D27]` federation in Listen (tag only, 7), `[D31]` display-face `tnum` (Bricolage has it,
closed by PD4), `[D35]` Generate with AI as a draft (part of PD18 here), `[D37]` chapter index (no,
7), and `[D23]`'s third clause (console scans apply no fixes).

| ID   | `[Dn]`                         | Decision                                                                                                                      | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD1  | [D1]                           | Chart rule for instruments                                                                                                    | (a) keep "charts use Nivo" literally; (b) amend root `AGENTS.md:69`, `app/ui/AGENTS.md:28`, `app/listen/AGENTS.md:60` and `app/shared/AGENTS.md`: Nivo for statistical charts, hand-built SVG/HTML/Canvas/WebGL for instruments                                                                                                                                                                                                                           | (b). Precedent: `EqBands`, Listen Stats. Without it every card in this document conflicts with a repo rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | decided 2026-10-15: (b); plan 0.5 amends the four `AGENTS.md` files                                                                                                                                                                                                                                                                                                                      |
| PD2  | [D19]                          | Smart Mix and v3 integration                                                                                                  | Smart Mix merges to `main` first; then approved v3 rebase and website integration                                                                                                                                                                                                                                                                                                                                                                         | Reconcile Camelot, migrations, Android EQ and catalogs against the actual merged code before running stale recipes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | decided 2026-10-15; integration sequence confirmed                                                                                                                                                                                                                                                                                                                                       |
| PD3  | [D2]                           | Listen pill radius                                                                                                            | (a) keep 6 px everywhere; (b) exempt `CratePill` (a `data-slot="chip"` the rule skips) and update `radius-policy.test.ts`; (c) lift the rule for all text pills                                                                                                                                                                                                                                                                                           | (b) now; revisit CTAs with (c) after the shell lands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD4  | [D3]                           | Brand fonts in the product (all runtimes)                                                                                     | The Cabinet Grotesk licence (ITF Free Font License, 2.3 item 9, not legal advice) forbids distribution through a public repository and making the font available to third parties through an application, so it cannot ship in a public, self-hosted product. (a) written permission from ITF; (b) an OFL display face. `--font-display-stack` stays, so a swap is a token change and the type scale is unchanged                                         | (b): Bricolage Grotesque (SIL OFL 1.1) in every runtime and on cratemusic.app; check the Capacitor asset list and `tnum` ([D31])                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | decided 2026-10-15: (b) with no Cabinet anywhere. Bricolage Grotesque, weights 500/700/800 from the variable `opsz` file (latin + latin-ext), every runtime including Capacitor, plus cratemusic.app and the docs site. `d9df9d51` and the website commits are rewritten so no commit contains Cabinet files. Bricolage has `tnum`, closing [D31]. Metric notes in the decision register |
| PD5  | [D32]                          | Setlist `in_library`                                                                                                          | (a) worker match at setlist write plus rematch on library change, local/missing only; (b) also `remote` for federated copies; (c) per-request match                                                                                                                                                                                                                                                                                                       | (a), hardened title matching, staleness accepted until the next refresh or rematch. (b) later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD6  | [D6]                           | Flat card contrast in Admin when the token commit merges                                                                      | (a) keep `#0d0e14` and add hairlines to the ~36 borderless card usages in one mechanical commit; (b) a lifted value for Admin until each screen migrates                                                                                                                                                                                                                                                                                                  | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD7  | [D7]                           | Auto-cycling                                                                                                                  | (a) drop everywhere; (b) idle-state only                                                                                                                                                                                                                                                                                                                                                                                                                  | (a). The product shows real state; empty states say so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD8  | [D8]                           | `StatNumber` tiers                                                                                                            | add `xl`, weight 800 on `lg`/`xl`, inline unit                                                                                                                                                                                                                                                                                                                                                                                                            | yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD9  | [D14]                          | App display scale                                                                                                             | cap page titles at `clamp(2.25rem, 4vw, 3.75rem)`, entities at 4.4 rem                                                                                                                                                                                                                                                                                                                                                                                    | yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD10 | [D4]                           | Failed and destructive colour (both apps)                                                                                     | (a) amber plus the word for failed; one `danger` token only on destructive confirm buttons; (b) keep red for failures                                                                                                                                                                                                                                                                                                                                     | (a); no green or blue anywhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD11 | [D5]                           | Amber value                                                                                                                   | (a) align `state-warning` to the site's `#fbbf24`; (b) keep `#f59e0b`                                                                                                                                                                                                                                                                                                                                                                                     | (a), through the registry, contrast tests updated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD12 | [D10]                          | Toasts                                                                                                                        | drop `richColors`, shared config, inline feedback first                                                                                                                                                                                                                                                                                                                                                                                                   | yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD13 | —                              | Tests on the external disk                                                                                                    | (a) CI only; (b) internal-disk clone; (c) version the Vitest timeout patch                                                                                                                                                                                                                                                                                                                                                                                | (a) plus (b) for local work; never rely on the unversioned patch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD14 | [D18] conflict                 | Admin sidebar                                                                                                                 | (a) regroup by site chapters (3.2.2); (b) keep Tools / Music / Insights / System                                                                                                                                                                                                                                                                                                                                                                          | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: (a); conflict with `[D18]` resolved for PD14                                                                                                                                                                                                                                                                                                                         |
| PD15 | —                              | Admin pills                                                                                                                   | (a) chips and CTAs as pills, inputs and selects at 6 px; (b) everything pill                                                                                                                                                                                                                                                                                                                                                                              | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD16 | —                              | Imports                                                                                                                       | (a) new `/imports` page for staged imports, sidecar on Album; (b) staging inside `/download`                                                                                                                                                                                                                                                                                                                                                              | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD17 | —                              | Enrichment scope                                                                                                              | (a) Artist tab only; (b) plus a library-wide coverage view                                                                                                                                                                                                                                                                                                                                                                                                | (a) in v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD18 | [D20], [D35]                   | Genre overrides (G1)                                                                                                          | (a) local edits to core genres persist with "reset to core", core relations hideable through a suppressed column (not a fifth relation type); (b) core read-only, curators only add overlays                                                                                                                                                                                                                                                              | (a), as the site copy promises: `genre_taxonomy_edges.suppressed`, set through the relations PUT, `edges[].suppressed` in the payload and a `Hide on this server` inspector action (4.6.1, 4.6.3). Overrides live in `local_*` columns plus `eq_override`, so they survive restarts and image rollbacks (4.6.3 item 5); they ship in plan 2.18d before the wheel, so EQ writes on core genres are never disabled. `Generate with AI` previews instead of applying                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD19 | [D21]                          | Wheel as default `/genres` view; retire `GenreNetworkGraph`                                                                   | yes / no                                                                                                                                                                                                                                                                                                                                                                                                                                                  | yes; tree and grid stay; the force graph goes once the locator ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD20 | [D21]                          | Listen wheel in v3                                                                                                            | (a) Admin first, Listen Explore and genre-page locator as phase 2 inside v3; (b) Admin only                                                                                                                                                                                                                                                                                                                                                               | (a); the component moves to `@crate/ui/domain/genres` in the Listen PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD21 | [D24]                          | Count definitions                                                                                                             | adopt the read plane genre-page thresholds (`genre.go:15-17`: artist 0.70, album 0.45, union across aliases) everywhere, including the Go `/api/genres` list (`genresSQL`, unthresholded today) and the genre-detail related counts, which read the builder's `genre_counts` (4.6.3 item 6)                                                                                                                                                               | yes; Admin and Listen list numbers drop compared with today; tests updated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD22 | —                              | Signed core release 1.0.1                                                                                                     | bundle the `folk → americana` fix and any EQ retunes                                                                                                                                                                                                                                                                                                                                                                                                      | yes, later; runtime de-duplication now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD23 | —                              | Taxonomy invalidations                                                                                                        | (a) keep `library`, `home`, `curation`, `genre:<slug>`; (b) narrow after adding a `genre_taxonomy` scope to Listen's `/eq` and `/genre` URL mapping; also whether `genre:*` reaches the projector                                                                                                                                                                                                                                                         | (b), never narrow before the Listen mapping exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD24 | [D23] (gating)                 | Health "fix on their own"                                                                                                     | (a) gate `library_pipeline` on `requires_confirmation` (4 unattended checks; `shadow_quality_tracks` stops auto-running); (b) keep `globally_runnable` (5, including a destructive check) and show it                                                                                                                                                                                                                                                     | (a); behaviour change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | decided 2026-10-15: recommendation; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                                                   |
| PD25 | [D34]                          | Loudness and dynamic range units                                                                                              | (a) label `dB` in v3, LUFS only from Smart Mix measurements; (b) add `analysis_method` now                                                                                                                                                                                                                                                                                                                                                                | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD26 | —                              | Album readout loses mood top-3 and spectral complexity                                                                        | keep (add `mood_top`) / drop                                                                                                                                                                                                                                                                                                                                                                                                                              | keep `mood_top` (3 entries); drop spectral complexity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD27 | [D33]                          | Release timelines for non-Tidal acquisitions                                                                                  | (a) link at import by MusicBrainz release group, then normalised names; (b) stop at "detected"                                                                                                                                                                                                                                                                                                                                                            | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD28 | [D23] conflict (trash routing) | Library Trash claim                                                                                                           | (a) keep the footer factual (track files only); (b) route destructive deletes through the trash first                                                                                                                                                                                                                                                                                                                                                     | (a) in v3; (b) as a separate fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | decided 2026-10-15: (a) factual footer in v3; trash routing as a separate fix after 2.17e                                                                                                                                                                                                                                                                                                |
| PD29 | [D38] conflict                 | Enrichment Settings toggles                                                                                                   | (a) wire them into the pipeline (alias `setlistfm → setlist`, add Discogs); (b) hide `disabled`                                                                                                                                                                                                                                                                                                                                                           | (a); behaviour change for admins who turned sources off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | decided 2026-10-15: (a); conflict with `[D38]` resolved for PD29; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                     |
| PD30 | —                              | Sidecar drift keys                                                                                                            | exclude artist `similar_json`, `tags_json`, `latest_release_date` from the digest                                                                                                                                                                                                                                                                                                                                                                         | yes (they change with every enrichment)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD31 | —                              | Artist hero Enrich button                                                                                                     | (a) keep `process_new_content(force)`, add the scoped refresh in the tab; (b) switch to scoped `enrich_artist`                                                                                                                                                                                                                                                                                                                                            | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD32 | [D29] conflict                 | Smart EQ while the next track loads                                                                                           | (a) hold the last resolved gains (audio change); (b) show and play flat as today                                                                                                                                                                                                                                                                                                                                                                          | (a), as a separate `fix(eq)` with a runtime test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | decided 2026-10-15: (a); conflict with `[D29]` resolved for PD32; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                     |
| PD33 | [D22]                          | Governor listener and stream thresholds                                                                                       | compose 0/0 vs code and site 10/10                                                                                                                                                                                                                                                                                                                                                                                                                        | the UI shows configured values; choose the product default and align the site copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | decided 2026-10-15: product default 10/10 (code value), compose 0/0 documented as an operator override, site copy "default 10/10, configurable"                                                                                                                                                                                                                                          |
| PD34 | —                              | Radio score panel on the site                                                                                                 | (a) keep the weights (they are the Discovery Radio weights: `radio_engine.py` imports `_W_*` from `db/paths_candidates.py` and `_seeded_radio_weights` returns them for the discovery profile, also listed in 4.15) and rename the "Camelot 0.05" term to "Key 0.05" in `RadioDive.astro` and `content/listen/en.ts:75`; optionally note that track and contextual profiles override sound, artists and genre (.16/.30/.20, .01/.44/.26); (b) leave as is | (a). The only site fix is the "Key" label; the product shows the real profile weights per session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD35 | [D39]                          | Queue lane numeral                                                                                                            | live load vs the site's task-type count                                                                                                                                                                                                                                                                                                                                                                                                                   | live load; type count in the meta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD36 | [D36]                          | Paths                                                                                                                         | (a) persist `plan_meta` at planning time; (b) derive at read                                                                                                                                                                                                                                                                                                                                                                                              | (a), written only inside the planning task; the task route ships with `plan_meta` (plan 4.9a, B18) and the synchronous routes are deprecated (4.16)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD37 | —                              | Mix strip                                                                                                                     | web/desktop: show the client crossfade labelled vs hide outside Android; `rms_envelope` before or after the merge                                                                                                                                                                                                                                                                                                                                         | show labelled; envelope after the merge as a nullable column with a throttled backfill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD38 | [D28]                          | Crate Connect build flag                                                                                                      | Devices is invisible if `VITE_CRATE_CONNECT_FEATURE_ENABLED` is off in production                                                                                                                                                                                                                                                                                                                                                                         | confirm the production flag before building Devices; keep P2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | decided 2026-10-15: build Devices in v3 although Crate Connect is off in production; "review Crate Connect" is the next initiative after v3                                                                                                                                                                                                                                              |
| PD39 | [D17]                          | Linux GTK accent                                                                                                              | (a) cyan everywhere; (b) derive both accents from GTK                                                                                                                                                                                                                                                                                                                                                                                                     | (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD40 | [D16]                          | Album palette tint                                                                                                            | Fixed Crate v3 chrome and token palette; no album-driven visual identity override                                                                                                                                                                                                                                                                                                                                                                         | Retire saved chrome tint in 1.13; artwork/data-derived visualizer palettes remain content; visualizer follow-up 4.11 stays P2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | amended 2026-10-15 with PD53                                                                                                                                                                                                                                                                                                                                                             |
| PD41 | —                              | Audio-reactive visuals on mobile                                                                                              | hide / static analysed state / a Listen endpoint for the Cast spectrum artefact                                                                                                                                                                                                                                                                                                                                                                           | static analysed state; no new endpoint in v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD42 | [D11]                          | iOS deployment target (today 15.0: `Podfile` `platform :ios, '15.0'`, pbxproj `IPHONEOS_DEPLOYMENT_TARGET = 15.0`)            | (a) raise to 16.4, Tailwind 4's own floor; (b) keep 15.0 and state that 15.0–16.3 gets a degraded, unsupported rendering                                                                                                                                                                                                                                                                                                                                  | (a), decided in Phase 0 (plan 0.3) and applied in plan 0.13, with the Podfile, pbxproj, the plan's Tech Stack and Task 7.3 matrix and a release note updated together. Keeping 15.0 fails in three places: (1) Tailwind 4.2.4's `color-mix()` fallback cannot resolve `var()`-based token colours and falls back to `transparent`, so every alpha ladder in 3.1.1 (`bg-accent-action/4`, `/8`, `/14`, `border-accent-action-hi/40`) disappears below Safari 16.2, and the token CSS already has 374 `color-mix` uses ("no `color-mix` in instruments" cannot be met); (2) the numeral and readout tiers use `cqi` and `InstrumentPanel` uses `@container`, which iOS 15 lacks, so XL numerals fall back to about 15 px; (3) the heatmap's subgrid rows. Whatever the target: no `subgrid` (4.17) and minifier-safe guarded rem numeral fallbacks (3.1.2). If 15.0 is kept anyway: literal rgba tokens for the four alpha steps, `@supports (container-type: inline-size)` guards on panels, and a named real iOS 15 device at Checkpoint 4 (CI cannot test it) | decided 2026-10-15: (a) raise to 16.4; iOS 15 users stay on v2                                                                                                                                                                                                                                                                                                                           |
| PD43 | [D30]                          | Crate Pulse privacy                                                                                                           | hide the instance heatmap below 3 listeners                                                                                                                                                                                                                                                                                                                                                                                                               | yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD44 | [D40]                          | Stack restart policy (today a prefix allowlist returns 403 for every `crate-*` container while `traefik` is restartable, 4.8) | deny `api`, `traefik`, `postgres`, `redis`, `redis-durable` with a reason; stop/start only for other containers                                                                                                                                                                                                                                                                                                                                           | yes; denying `traefik` is a behaviour change (3.4.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | decided 2026-10-15: recommendation; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                                                   |
| PD45 | —                              | `crate-redis` `maxmemory` equals `mem_limit` (512m)                                                                           | lower `maxmemory` (e.g. 448mb)                                                                                                                                                                                                                                                                                                                                                                                                                            | yes, separate compose change; the site test pins these flags, so the second-landing branch updates it (5.3.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | decided 2026-10-15: recommendation; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                                                   |
| PD46 | [D26]                          | Acquisition snapshot and stream permissions                                                                                   | require `library.import.manage` or `library.tidal.manage`                                                                                                                                                                                                                                                                                                                                                                                                 | yes; warn API clients                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | decided 2026-10-15: recommendation; behaviour change, own PR to `main`                                                                                                                                                                                                                                                                                                                   |
| PD47 | —                              | Unused code                                                                                                                   | remove `SpectrumRibbonCanvas`, unused Nivo packages (Admin bump, chord, geo, heatmap, network; Listen core, line), Listen `leaflet`, Admin `components/ui/error-state.tsx`, orphan pages                                                                                                                                                                                                                                                                  | remove in cleanup commits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD48 | [D25]                          | Bundle and screenshot checks                                                                                                  | Listen/Admin bundle checks; small Admin capture set (Dashboard, Tasks, Health, Genres, Album, Settings, System) before 1.0                                                                                                                                                                                                                                                                                                                                | Admin ceiling accepted at 520 KiB, recorded baseline 514,659 B gzip. Linux CI PNGs only; implementation does not imply screenshots/CI approved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | decided 2026-10-15; confirmed                                                                                                                                                                                                                                                                                                                                                            |
| PD49 | [D15]                          | `<html lang>` in Listen                                                                                                       | sync with the active locale                                                                                                                                                                                                                                                                                                                                                                                                                               | yes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD50 | —                              | Spinners                                                                                                                      | remove `animate-spin` outside buttons as a migration rule                                                                                                                                                                                                                                                                                                                                                                                                 | yes, file by file as screens migrate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD51 | —                              | Ticket header key word                                                                                                        | countdown (implemented) vs the site's `Upcoming show`                                                                                                                                                                                                                                                                                                                                                                                                     | countdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD52 | —                              | Album energy arc (coverage A6/L15, not a site visual)                                                                         | add / skip                                                                                                                                                                                                                                                                                                                                                                                                                                                | skip in v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |
| PD53 | [D13], [D16], [D41], [D42]     | One Crate v3 visual identity                                                                                                  | Remove the entire selectable theme/skin system, modes and accent/material/radius/typography overrides; fixed brand accent for `StatusDot on`                                                                                                                                                                                                                                                                                                              | Keep semantic tokens, accessibility, motion and functional preferences. Full runtime/preferences/tests migration is plan 1.13, still pending; no variant matrix or retired contrast exception remains in the target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | amended and accepted 2026-10-15                                                                                                                                                                                                                                                                                                                                                          |
| PD54 | [D43]                          | Stack sampler placement (4.8 Stack)                                                                                           | (a) a dedicated daemon thread in crate-api behind an owner-checked Redis leader lock (crate-api already holds the Docker socket for restart, logs and detail reads); (b) crate-worker behind a read-only docker-socket-proxy, keeping crate-api, which serves all Admin and the Listen fallback traffic, free of background work (one more container in every compose)                                                                                    | (a) for v3: the thread never runs on the event loop, takes stats only while `admin:live:viewers:stack` exists, has a bounded pool and budget, and the socket stays where the actions already need it. Revisit (b) if Stack actions move to worker tasks. Asked in Task 0.3's Phase 4–5 row; plan 5.5's files follow the answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | decided 2026-10-15: recommendation                                                                                                                                                                                                                                                                                                                                                       |

---

## 7. Out of scope or later

- Site-only visuals: hero particle field, screencast, like-trace scroll story, roadmap cards, API
  terminal, UUID derivation (optional later as the global catalog duplicate readout), scale figures
  (used only as a recipe).
- Scroll-scrubbed stories, GSAP, Lenis and any new animation library; the site's grain texture.
- Alternative visual identities or theme editors: retired by PD53, not a future v3 art-direction pass.
- Jam (gated off) and Decks.
- Cast receiver styling.
- `/api/me/upcoming` as a snapshot (depends on the `near_me` location model).
- A Listen federation network view (only provenance tags and the relay chip).
- Library-wide enrichment coverage view.
- A Listen per-track spectrum endpoint for mobile visuals.
- `analysis_method` column and LUFS labels outside Smart Mix.
- `rms_envelope` mix lanes (after the Smart Mix merge), access token telemetry (`last_denied`).
- Admin routes on the Go read plane.
- Admin Dashboard chapter index (site `Explore` rows).
- Album energy arc (PD52).
- Remaining coverage P2 surfaces beyond their recipes (they reuse the recipes, no new primitives).
