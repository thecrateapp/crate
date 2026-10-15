# Crate v3 analysis: platform constraints for live visuals in the apps

Status: analysis, 2026-10-15, branch `feat/crate_v3` (4 commits over `b63e53b7`). Visual reference:
the new site only (`worktrees/website/app/web`); its language is catalogued in
`site-language.md` next to this file. This document covers the other side: what the product
platform (Admin `app/ui`, Listen `app/listen`, Desktop `app/listen-desktop`, `@crate/ui` in
`app/shared/ui`) allows, forbids and budgets when the site's instrument visuals (genre wheel, EQ
curve, mix, mood map, health scan, queues, orbit...) become real features backed by real data.

Nothing here was built or tested. Numbers marked "measured" come from reading existing artifacts or
running read-only inventory scripts; everything else comes from source.

---

## 0. The short version

1. A visual goes into `@crate/ui` only when Admin and Listen both render it in the same change.
   The export-usage test only proves "at least one app imports it"; "both" is a review rule.
2. Shared visuals take data, copy and callbacks as props. No `useApi`, no SSE, no i18n, no player
   context, no router inside `@crate/ui`.
3. Renderer by mark count: HTML/CSS for regular cells and rows, SVG up to a few hundred marks,
   Canvas 2D around a thousand soft points, WebGL2 only above ~10K points and always with a
   non-WebGL fallback. No new animation libraries.
4. Nivo stays for standard statistical charts (mostly Admin). Instruments are custom SVG. That
   needs an explicit amendment of the "charts use Nivo" rule and of Listen's "no new custom
   charts" clause (open question 1).
5. Colours only through tokens (`currentColor` / `stroke-*` classes in SVG, `readCssColorToken`
   for canvas). The accent is user-selectable (cyan, red, violet), there is a Crate Red preset and
   a light mode.
6. Real state on first paint, animate only real transitions, render the final state statically
   under reduced motion. Per-frame values live in refs, never in effect dependency arrays.
7. Every visual sits behind a lazy boundary. Listen's initial JS budget (300 KB gzip) is about
   two thirds used; Admin has no budget at all.
8. The branch is currently over the design-system drift budget (section 7.5). Fix that before
   adding visuals, because data-driven positioning is exactly what eats the inline-style budget.

---

## 1. `@crate/ui` mechanics that shape a shared visual

### 1.1 Package and build

- Source-first exports. `package.json` `exports` points at `.ts/.tsx` source; apps compile it
  through the workspace symlink. `dist/` (tsup ESM + `tsc` declarations) is only for
  `publishConfig`. A shared edit is live in Admin, Listen and Desktop at once.
- Wildcards: `./primitives/*`, `./composites/*`, `./domain/*`, `./shadcn/*`, `./icons/*` map to
  `*.tsx` only; `./lib/*` maps to `*.ts`. A `.ts` module or a folder barrel outside `lib/` (for
  example `domain/genres/taxonomy-math.ts`) needs an explicit entry in both `exports` and
  `publishConfig.exports`.
- `tsup.config.ts` walks `lib, icons, primitives, shadcn, composites, domain`, ESM only,
  `splitting` + `treeshake`, and an `external` list equal to the peers (react 19, react-dom,
  react-router 7, radix-ui, cva, clsx, tailwind-merge, sonner, `@solar-icons/react-perf`, qrcode).
  A visual that needs a runtime dependency (d3-shape, d3-force, a spring lib) must add it as a
  peer and to `external`. The site's instruments are dependency-free (only scroll choreography
  uses gsap/lenis), so the ports should stay dependency-free too.
- Tailwind: both apps scan shared classes with `@source "../../shared/ui"`. Classes built by
  string concatenation inside a visual are purged; keep full class names in source.
- Layers (`npm run design-system:layers`, CI): `primitives` may not import `composites` or
  `domain`; `composites` may not import `domain`. Domain may import primitives (EqBands imports
  StatNumber).

### 1.2 Policy tests that a visual touches

| Test / script | Scope | What it enforces for visuals |
| --- | --- | --- |
| `app/shared/ui/export-usage-policy.test.ts` | every `@crate/ui` export | each module must be imported by `app/listen/src` OR `app/ui/src`, unless it matches a base-system prefix (`shadcn/`, `tokens/`, `icons`, `composites/`, `domain/stats/Ops*`) or is in `UNUSED_EXPORT_ALLOWLIST` with a reason. Does not check "both". |
| `app/shared/ui/design-token-policy.test.ts` | `@crate/ui` | per-file budget of arbitrary `rounded-[..]`, `z-[..]`, `shadow-[..]`, `text-[..px/rem]`, `tracking-[..]`; icon sizes from `CRATE_ICON_SIZE`. Today only `ArtistHeroPresentation`, `CrateLoader`, `ShowCard` have entries. |
| `app/listen/src/design-token-policy.test.ts`, `radius-policy`, `badge-policy`, `genre-pill-policy`, `toast-policy`, `layout-policy` | Listen | same arbitrary-value budget per file; no `rounded-2xl/3xl`; Listen pins text CTAs and the shared button to `--radius-lg` (pills render 6 px); chips through `GenrePill`, badges through `CrateBadge`; toasts only via `notify`. |
| `app/listen/src/component-policy.test.ts` | Listen | raw `<button>` budget 110, `<input>` 10, `<textarea>` 1; a Listen file may not redefine a `@crate/ui` component name (`LOCAL_COPY_ALLOWLIST`). Clickable wheel nodes or chips count against the button budget unless they use primitives. |
| `app/listen/src/app-shell/AppRouter.bundle.test.tsx` | Listen | lazy boundaries for shell, providers, Home, catalogs; no `lucide-react`/`iconoir-react` dependency; Solar icons only behind feature entry files. |
| `scripts/design-system/drift-inventory.mjs --check` (CI) | `app/listen/src` + `app/shared/ui` (not Admin) | ceilings in `drift-budget.json`: actionable raw colours 0, legacy semantic utilities 0, arbitrary utilities 64, inline `style={{` 91, semantic token definitions 134 (91 foundation), unreferenced tokens 0. |
| `design-system:tokens:check` | `@crate/ui` | `tokens/themes.css` is generated from `lib/appearance-token-registry.ts`; colour values change in the registry, not in CSS. |

Practical consequences:

- Data-driven geometry should be SVG attributes (`x`, `y`, `d`, `transform`, `cx`), not
  `style={{ top: ... }}`. Every `style={{` in Listen or `@crate/ui` counts against the ceiling of 91.
- Per-frame values are written through refs (`el.style.setProperty("--v", ...)`,
  `el.setAttribute("d", ...)`) for performance anyway; that does not touch the inline-style count.
- Canvas and WebGL palettes cannot use hex/rgba literals in Listen or `@crate/ui` (actionable raw
  colours budget is 0). Use `readCssColorToken` (`@crate/ui/lib/read-css-color`, re-exported in
  Listen as `lib/canvas-color.ts`), as the visualizer, waveform and share-story canvases do.
- New tokens (cyan alpha ladder, amber status pair, numeral tiers) must be referenced in the same
  change (unreferenced tokens budget 0) and raise the token-definition ceilings knowingly.

### 1.3 App conventions a shared visual must not break

| | Admin (`app/ui`) | Listen (`app/listen`, also Desktop) |
| --- | --- | --- |
| Surface | `data-surface="glass"` on `<html>` | `solid` default, user can pick `glass` |
| Appearance resolver | not applied (only `HeroCompositionCanvas` imports it) | applied: `data-crate-motion`, `data-crate-effects` (`off/subtle/expressive`), accent (`cyan/red/violet`), preset (`default/crateRed`), mode (`dark/light/system`), material, radius, typography, density |
| Icons | `lucide-react` | `@crate/ui/icons` (Solar), sized with `CRATE_ICON_SIZE` |
| Toasts | `sonner` `toast` | `notify` from `@crate/ui/lib/notify` |
| Copy | English, hardcoded | i18next + ICU, 7 catalogs (en, es, fr, de, it, ca, eu) |
| Data | `useApi` / `api` from `@/`; snapshot + SSE (`OpsSnapshotContext`, `tasks-stream`, `health-stream`, `logs-stream`, `stack-stream`) | own cache-backed `useApi`, `lib/sse.ts` channels, snapshot streams that keep the highest `snapshot.version` and degrade to polling |

So a shared visual: renders no icons itself or takes them as `ReactNode` slots; reads only
semantic tokens and works under both surfaces; takes every visible string and aria label as a prop
(English defaults are the existing convention, see `ConfirmDialog`, `LoadingState`); takes
formatted numbers or a `formatNumber` prop (Listen formats with `Intl.NumberFormat(i18n.language)`).

---

## 2. Rendering technology already in the apps

### 2.1 Nivo

| App | Declared | Actually imported | Where |
| --- | --- | --- | --- |
| Admin | `@nivo/bar, bump, chord, core, geo, heatmap, line, network, pie, radar, scatterplot` 0.99 | bar, pie, radar, scatterplot, line | `pages/Dashboard.tsx`, `pages/Insights.tsx`, `pages/SystemHealth.tsx`, `components/artist/ArtistStats.tsx`, `components/album/AudioProfileCard.tsx`, `components/album/TrackTable.tsx` |
| Listen | `@nivo/core`, `@nivo/line` | none | `vite.config.ts` reserves a `stats-vendor` chunk; Desktop mirrors it |

- Admin bundles Nivo + d3 into `charts-vendor`. Measured on the main checkout's Oct 10 build:
  436 KB raw / 138 KB gzip. It is lazy (pages are `React.lazy`), but every chart page pays it.
- Listen's first Nivo import would create its `stats-vendor` chunk; not measured, expect tens of
  KB gzip for `@nivo/line` + core + d3 pieces, parsed on phones.
- Theming is duplicated: three local `NIVO_THEME` constants (Insights, ArtistStats,
  AudioProfileCard) with hex literals, plus inline theme objects in Dashboard and TrackTable.
  Admin is outside the drift inventory, so nothing flags them.
- Pitfall for a v3 Nivo theme: CSS variables work where Nivo writes theme values into `style`
  (tooltip container, text fills), but series colours and colour modifiers
  (`{ from: "color", modifiers: [["darker", 1]] }`) are parsed with d3-color and break on
  `var(...)`. Resolve tokens to concrete colours (`readCssColorToken`) when the chart mounts and
  when appearance changes.
- Nivo animates through react-spring and does not follow `prefers-reduced-motion` on its own; pass
  `animate={!reducedMotion}`.

### 2.2 Canvas, WebGL and graph code

| Where | Tech | Notes |
| --- | --- | --- |
| Listen `components/player/visualizer/*` (`MusicVisualizer`, `useMusicVisualizer`) | WebGL2 (gl-matrix), bloom passes, icospheres | Only in the extended/fullscreen player, loaded through `lazy-player-surfaces.tsx`. Throws `WebGL2 not supported` and the hook silently gives up. DPR capped at 2, render size capped at 1024 px (`visualizer-quality.ts`, profiles `default` and `tauri-linux`). Stops on `visibilitychange` and zero size (ResizeObserver). `WEBGL_lose_context` on destroy; no `webglcontextlost` handler. Palette from tokens. |
| Listen `hooks/use-audio-visualizer.ts` | AnalyserNode sampling | Gated by `isMotionBlocked()` and `subscribeToMotionAvailability`; re-acquire the analyser when `analyserVersion` changes. |
| Listen `components/player/bar/WaveformCanvas.tsx` | Canvas 2D | Player bar waveform, token colours. |
| Listen `components/player/SpectrumRibbonCanvas.tsx` | Canvas 2D, rAF, persistence trails | No production importer (only its test). Candidate for removal or reuse. |
| Listen `lib/social-share-story-canvas.ts`, `lib/palette.ts` | Canvas 2D (export, colour extraction) | Raw rgba allowlisted in drift inventory with reason and review date. |
| Listen `components/stats/*` | hand-built SVG/CSS | The documented exception to "Nivo only": signal tape, heatmap, decade bars; CSS-only motion (`stats-reveal`, keyframes in shared `recipes.css`) with reduced-motion fallbacks; `CountUpNumber` writes `textContent` through a ref. |
| Admin `components/genres/GenreNetworkGraph.tsx`, `components/artist/ArtistNetworkGraph.tsx` | `react-force-graph-2d` (canvas, d3-force), `graph-vendor` chunk 35 KB gzip measured | Hardcoded rgba constants (sky blue, slate), `cooldownTicks 200`. `GenreNetworkGraph` reads `/api/genres/{slug}/graph`, with six relation styles (alias, parent, child, related, influenced_by, fusion_of). The genre wheel would replace it on `pages/Genres.tsx` next to `GenreTaxonomyTree`. |
| Admin `components/artist/HeroCompositionCanvas.tsx` | konva / react-konva | Artist hero editor. |
| Admin maps | Leaflet (`maps-vendor`, 43 KB gzip measured) | Vendor CSS overrides in `src/index.css`. |
| Cast receiver `SpectrumCanvas` + `spectrum/renderer.ts` | Canvas | Draws a precomputed spectrum artefact from the backend (`crate/cast_spectrum.py`: 24 bands, 100 ms frames, `application/vnd.crate.cast-spectrum`). |

### 2.3 What the site does, mapped to these constraints

The site picks the renderer by mark count (details in `site-language.md` section 7): HTML/CSS grid
for regular cells (168-cell heatmap, gauges), SVG for up to a few hundred marks with crisp text and
CSS state (61-node wheel, EQ, mix, federation, orbit), Canvas 2D with pre-rendered sprites for
~1K soft points (mood map), WebGL2 only for 12K–40K points (hero field). It computes layout from
data and only animates on the client, runs rAF only while visible, writes per-frame values to
`transform`/`opacity`/custom properties, caps DPR at 2 and releases everything on cleanup. All of
that transfers. What does not transfer: SSR (the apps render client-side, so layout math runs in a
`useMemo` over the payload), scripted demo loops (the product shows real state), and gsap/lenis.

The core genre taxonomy has 61 genres (`crate/genre_taxonomy.py`), the same order of magnitude as
the site wheel, so SVG is the right renderer for the real wheel too. Overlay and inferred nodes can
grow it; past a few hundred nodes the wheel should aggregate (families, top-N) rather than switch
to canvas.

---

## 3. Motion

### 3.1 Tokens available after the v3 token commit

- `tokens/animations.css` `@theme`: `--ease-snap`, `--ease-out-expo`, `--ease-dramatic`,
  `--ease-spring-snappy`, `--ease-spring-smooth` (the last two are CSS `linear()` springs copied
  from the site). Tailwind utilities `ease-snap`, `ease-spring-snappy`, etc.
- Keyframe utilities: page/pop/sheet/fade/hero/track entrances, EQ bars, play aura pulses,
  follow particles, loader dots, view-transition root fades.
- Listen stats keyframes and many Listen-only recipes live in the shared `tokens/recipes.css`
  (3,014 lines). Admin downloads them too; CSS has no budget.

### 3.2 `linear()` easing is not available on several runtime floors

`linear()` needs Chrome/Edge 113, Safari 17.2, Firefox 112. Floors that lack it: WebView2 111
(Windows Desktop), WebKitGTK 2.40 (Linux Desktop DEB/RPM), macOS 11 (Big Sur's WebKit tops out at
Safari 16.x), iOS below 17.2 (the iOS target is 15.0).

- Tailwind's `ease-*` utilities write the longhand `transition-timing-function: var(--ease-...)`;
  an unsupported `linear()` becomes invalid at computed-value time and falls back to `ease`. That
  degradation is acceptable.
- Inside a shorthand (`transition: transform 300ms var(--ease-spring-snappy)` or `animation:`
  in custom CSS) the whole declaration becomes invalid and the transition disappears. Use the
  longhand, or a cubic-bezier fallback with `@supports (transition-timing-function: linear(0, 1))`.
- JS springs for data (the site's `stepSpring`) do not depend on CSS support and are the right
  tool for data-driven motion anyway.

### 3.3 Reduced motion and effects

| Layer | Listen | Admin |
| --- | --- | --- |
| CSS, user setting | `[data-crate-motion="reduced"] *` forces 0.01 ms animations and transitions (set by the appearance resolver from the user setting or the OS) | not set; Admin never applies the resolver |
| CSS, OS | `@media (prefers-reduced-motion: reduce)` lists in `animations.css` and `recipes.css`; Tailwind `motion-reduce:` (10 usages) | same media queries and variants |
| JS | `lib/motion-availability.ts`: `isMotionBlocked()` (user preference, `data-crate-motion`, media query, or document hidden) + `subscribeToMotionAvailability()` | nothing |
| Effects | `data-crate-effects="off/subtle/expressive"` | not set |

Consequences:

- A shared animated visual needs a gate that works in both apps: check `matchMedia` and
  `document.documentElement.dataset.crateMotion`, and treat a hidden document as blocked. Today
  that logic lives in Listen only. Moving the DOM part of `motion-availability.ts` into
  `@crate/ui/lib` (Listen keeps its module as a wrapper for the preference store) is the clean
  path once a shared visual needs it.
- Glow, bloom and WebGL extras should honour `data-crate-effects` in Listen (`off` means none).
- The reduced-motion state of every visual is the real final state, rendered statically. This is
  also what the visual tests capture (section 9.3).

### 3.4 Animation patterns already in the code

- `CountUpNumber` (Listen stats): rAF, eased count-up, writes `textContent` via ref, skips when
  motion is blocked. The site's count-up and scramble map onto this.
- `StatsReveal`: one IntersectionObserver per instance, flips `data-revealed`, CSS does the rest.
  The site uses one shared observer; worth consolidating if many panels reveal on a page.
- `use-spinning-disc-playback.ts`, `useMusicVisualizer`: rAF owned by refs, restarted through
  `subscribeToMotionAvailability`, stopped on `visibilitychange`.
- `EqBands` (shared, v3): React-rendered SVG, no rAF; handle position animates with
  `transition-[top] duration-500 ease-snap motion-reduce:transition-none`, disabled while dragging.
- No animation library in either app (no framer-motion, react-spring direct use, gsap). Keep it
  that way: CSS transitions with tokens, rAF with refs, WAAPI where a one-shot is easier.

---

## 4. React performance rules applied to visuals

- `react-hooks/exhaustive-deps` is OFF in both apps. Dependency arrays are reviewed by hand;
  react-doctor runs on PRs over `app/shared/ui`, `app/ui`, `app/listen`, `app/listen-desktop`.
- Effects that open an `EventSource`, socket, timer or fetch depend only on connection identity
  (URL, query, auth/capability booleans). Never the payload, never `currentTime`, `duration`,
  `isPlaying`.
- A visual never subscribes to a stream itself. The page or context owns the stream
  (`OpsSnapshotContext`, `tasks-stream`, `health-stream`, Listen snapshot streams) and passes the
  latest payload down. Inside the visual, a new payload only re-targets springs held in refs; the
  loop interpolates. This is the site's model and it satisfies the SSE rule by construction.
- Player time: `usePlayer()` re-renders every tick and is reserved for full player surfaces. A
  visual that needs the playhead (mix preview, waveform) reads it in its rAF loop from a ref fed by
  a tiny `usePlayerProgress()` leaf or from engine `positionChanged` events, not from React state.
- No `setState` at frame rate in large trees. Text nodes change only when the formatted string
  changes; class toggles are cached.
- `memo` the visual and keep props stable (`useMemo` for derived layout from the payload,
  `useCallback` for handlers). Layout math (radial layout, curve paths, springs) lives in pure
  modules with unit tests, as `eqCurvePath` does.
- Loop lifecycle: start only while intersecting (IntersectionObserver) and while the document is
  visible; clamp `dt` (50 ms on the site); cancel rAF, disconnect observers and abort listeners on
  cleanup. Desktop sets `backgroundThrottling: "disabled"` on the main window (audio reasons), so
  the webview will not throttle hidden loops for you; self-gating is mandatory.

---

## 5. Data feeding (backend rules that bound what a visual may ask for)

- Visuals read precomputed payloads: `ui_snapshots` warmed by `crate-projector`, served by the Go
  read plane when the route is registered there, FastAPI as fallback. Never trigger a snapshot
  rebuild from a request, never add `?fresh=1` polling loops.
- No `COUNT/SUM/AVG` over `library_tracks` per request; batch with `ANY(:ids)`; one CTE per
  surface instead of several `read_scope()` calls. Listen Stats is the model: one
  `/api/me/stats/dashboard` payload per period plus `/api/me/stats/today`.
- The genre wheel's per-genre counts are currently `COUNT(DISTINCT ...)` over artist/album genre
  tables at request time (`db/queries/genres_library_catalog.py`). Not `library_tracks`, but a
  Listen-facing wheel on a hot path should come from a warmed payload.
- Audio-reactive visuals cannot assume an `AnalyserNode`: the iOS/Android stable pipeline runs
  HTML5 audio with WebAudio off unless "enhanced audio" was enabled at startup
  (`canUseWebAudioEffects`), the Android native engine has no analyser, and Smart Mix (unmerged,
  `smart-mix-phase-1`) moves mixing into native Android code. Options per visual: hide, show the
  static analysed state (bliss vector, BPM, energy, EQ preset), or play back the precomputed Cast
  spectrum artefact, which already exists server-side.
- Progress visuals (health scan, queues, enrichment, imports) are driven by real task events
  (`use-task-events`, `tasks-stream`, `ops-stream`), not by timers.

---

## 6. Budgets

### 6.1 JavaScript

| App | Budget | Enforced where | Current use |
| --- | --- | --- | --- |
| Listen | 300 KB gzip initial JS (`scripts/check-bundle-budget.mjs`: `index.html` module scripts + `modulepreload`; env `CRATE_LISTEN_INITIAL_GZIP_BUDGET`) | CI only in `build-android.yml` on the Capacitor build. `test-frontend.yml` builds Listen web but does not run `check:bundle`. | Measured on the main checkout's Oct 7 dist: 202,612 B (about 198 KB) of 307,200 B. About 100 KB headroom. |
| Cast receiver | 150 KB gzip | `test-frontend.yml` | n/a |
| Admin | none | none | Vendor chunks measured (Oct 10 build): charts 138 KB, react 70 KB, ui 41 KB, maps 43 KB, graph 35 KB gzip. |
| Desktop | none (Listen code, own `vite.config.ts` with `stats-vendor`) | none | n/a |

Lazy chunks are not counted by any budget. That makes lazy boundaries the real budget: a visual
that leaks into the shell, a provider, the layout or Home's eager path costs every user on every
launch, including phones.

### 6.2 Fonts and CSS

- v3 ships Cabinet Grotesk 500/700/800 (about 20.5 KB each) and JetBrains Mono 400 latin (21 KB)
  + latin-ext (7 KB) on every runtime, `font-display: swap`; Poppins stays web-only in Listen
  (`main.tsx` skips it on Capacitor). No more weights or families for visuals.
- CSS has no budget. Shared `recipes.css` already carries Listen-only recipes that Admin downloads.
  Visual-specific CSS belongs in the app that uses it (or Tailwind utilities in the component),
  not in shared tokens.

### 6.3 Design-system ratchets

Measured on `feat/crate_v3` with the read-only inventory script
(`node scripts/design-system/drift-inventory.mjs --check`), the branch currently fails the CI step
"Check design-system drift budget":

| Metric | Actual | Ceiling | Cause on this branch |
| --- | --- | --- | --- |
| `totals.inlineStyles` | 93 | 91 | `EqBands.tsx` went from 2 to 4 `style={{` |
| `totals.legacySemanticUtilities` | 1 | 0 | `app/listen/src/components/upcoming/ShowCard.tsx` |
| `semanticTokens.definitions` | 138 | 134 | new v3 tokens |
| `semanticTokens.foundationDefinitions` | 95 | 91 | new v3 tokens |
| `totals.arbitraryUtilities` | 61 | 64 | slack (the script asks to lower the ceiling) |

The v3 spec says "budgets are not widened". Either the overruns are removed (SVG attributes for
EqBands scale and handles, token utility in ShowCard) or the token ceilings are raised
deliberately with the new tokens listed. Data-driven visuals will keep pushing on `inlineStyles`,
so the SVG-attribute and ref patterns in section 1.2 matter.

---

## 7. Runtimes

| Runtime | Engine and floor | WebGL2 | `linear()` | Notes |
| --- | --- | --- | --- | --- |
| Web (Listen PWA, Admin) | evergreen; Tailwind 4 needs Safari 16.4 / Chrome 111 / Firefox 128 | yes | yes on current browsers | Service worker only on web. |
| iOS (Capacitor 8) | WKWebView, deployment target 15.0 (`Podfile`, pbxproj) | Safari 15+ | iOS 17.2+ | Target 15.0 sits below Tailwind 4's Safari 16.4 floor (open question 2). `viewport-fit=cover`, status bar overlays the webview, fixed scale. Low Power Mode caps rAF at 30 fps: animate by `dt`, not frame count. WebContent memory limits make two live WebGL contexts risky. |
| Android (Capacitor 8) | Android System WebView (Chromium, updated from Play), `minSdkVersion 24`, target 36, no `minWebViewVersion` override | depends on GPU/driver | yes on current WebView | Native engine and Smart Mix have no analyser. `check:bundle` runs here. |
| macOS Desktop (Tauri 2) | WKWebView, macOS 11.0 | Safari 15+ WebKit | Safari 17.2+ | Big Sur cannot reach Safari 17. `backgroundThrottling: "disabled"`. Ad-hoc signed. |
| Windows Desktop | WebView2 >= 111.0.1661.34, Windows 10 1803 | yes | no at the floor (needs 113) | Bootstrapper updates WebView2 when online. |
| Linux Desktop | WebKitGTK 4.1 >= 2.40 (DEB/RPM, host), AppImage bundles 2.50.4 | depends on host GL; Tauri forces `HardwareAccelerationPolicy::Always` | no at 2.40 | Visualizer has a `tauri-linux` quality profile. Software GL hosts will be slow. |

Rules that follow:

- Every WebGL visual needs a non-WebGL fallback (SVG/CSS static state) for no WebGL2, context
  loss, reduced motion and `effects=off`. One WebGL context per screen; create lazily, handle
  `webglcontextlost`/`restored`, call `WEBGL_lose_context` on unmount.
- Canvas DPR capped at 2; size from `ResizeObserver`, rounded to integer pixels.
- Fonts are bundled assets, so they work offline in Capacitor and Tauri. Artist names in the
  display face fall back per glyph to the brand/system font for non-Latin scripts; the visual
  must not assume Cabinet metrics for every name.
- Desktop reuses Listen code: a Listen visual change also needs Desktop typecheck and tests, and
  Capacitor plugins must stay behind runtime flags (`lib/platform.ts`, `lib/capacitor-runtime.ts`).

---

## 8. i18n

- Listen: every visible string through `t("domain.key")`; new keys in all 7 catalogs with matching
  placeholders; `catalogs.test.ts` and `npm run --workspace=app/listen i18n:check` fail on missing
  keys, placeholder mismatches and untranslated copies under the fully localized prefixes;
  changing English marks other locales stale (`node scripts/i18n-check.mjs --write-metadata`).
  Product terms (`i18n/product-terms.ts`) stay untranslated. Catalogs load lazily per locale
  (`catalog-loader.ts`, guarded by the bundle test); remote bundles can override them per server.
- Admin: English only, no i18n library.
- Shared visuals: copy and aria labels as props, numbers preformatted or via a format prop.
- Mono uppercase tracked labels grow fast in German and Basque. Reserve width for readouts,
  allow two-line labels or truncate with a title; never size panels to the English string.
- Listen does not sync `<html lang>` with the active locale (fixed `lang="en"` in `index.html`).
  `text-transform: uppercase`, hyphenation and screen-reader pronunciation follow `lang`, so the
  site's uppercase label recipe uses English casing rules in every locale (open question 7).

---

## 9. Testing

### 9.1 Vitest

| Package | Env | Setup | Notes |
| --- | --- | --- | --- |
| `@crate/ui` | jsdom, globals | `test-setup.ts`: jest-dom + in-memory storage | Includes the policy tests. Coverage thresholds 50/40/50/50. |
| Admin | jsdom, globals | `src/test-setup.ts`: jest-dom + in-memory storage | `renderWithAdminProviders`; Nivo is `vi.mock`ed in page tests (`TrackTable.test`, `Album.test`). Same thresholds. |
| Listen | jsdom, globals | loads all 7 catalogs, in-memory storage, polyfills `matchMedia` and `ResizeObserver` | Also runs `app/shared/web/**/*.test.ts`. `renderWithListenProviders` with partial contexts; never mount the real `PlayerProvider`. Gapless-5 excluded from coverage. |

jsdom gaps to design around:

- `canvas.getContext()` returns `null`: canvas/WebGL code must no-op cleanly, and tests spy on
  `getContext` (see `MusicVisualizer.test.ts`).
- `IntersectionObserver` is missing everywhere and `ResizeObserver`/`matchMedia` are missing in
  `@crate/ui` and Admin tests: guard with `typeof ... === "undefined"` (as `StatsReveal` and
  `useMusicVisualizer` do) or polyfill in the test.
- SVG geometry (`getTotalLength`, `getBBox`) is not implemented: use `pathLength={1}` with
  `stroke-dasharray` for line-draw effects instead of measuring paths.
- What to unit test: pure layout and spring math (table-driven), the static/reduced-motion render
  (data in, marks and labels out), interaction callbacks, and the lifecycle (loop stops on unmount
  and when hidden). The site's `taxonomy-math.test.ts` and `eq-math.test.ts` port with the code.

External disk: on `/Volumes/MacData` worker startup is slow. Vitest 4.1.6 ships
`START_TIMEOUT = 6e4` (60 s pool start) and `WORKER_START_TIMEOUT = 9e4` in
`dist/chunks/cli-api.*.js` (checked in the main checkout). The `crate-v3` worktree's copy has been
hand-patched to `6e5`/`9e5`; that patch is unversioned and disappears on the next `npm ci`. The
policy tests walk `listen/src` and `ui/src` from disk and already carry 15 s per-test timeouts.
Run single files locally and let CI run the suites.

### 9.2 Playwright

- `npm run test:listen-visual` (`playwright.listen-visual.config.ts`): Chromium only, projects
  `desktop` 1480x900 and `mobile` 375x812 (touch), `deviceScaleFactor 1`, dark scheme, `en-US`,
  UTC, service workers blocked, `animations: "disabled"`, `maxDiffPixels: 250`. The fixture
  installs a fixed clock, stubs `EventSource`, fulfils every `/api/**` from a table and throws on
  unknown paths, stores appearance with `accessibility.motion: "reduced"`, waits for
  `document.fonts.status === "loaded"`, and fails on any console error. Web server: Listen
  `vite --force` dev server (120 s start timeout).
- Baselines exist for darwin and linux: home-player, artist (default and Crate Red, dark and
  light), genre (Explore), radar, settings, stats. A new visual means fixture entries for its
  endpoints and intentional re-baselines on both platforms.
- Determinism comes from the reduced-motion contract: with motion reduced, a visual must render
  its final state without rAF. A WebGL canvas in headless Chromium renders through a software
  rasterizer and will not match across machines; mask it or render the static fallback.
- `npm run test:admin-e2e`: functional flows only, Chromium 1440x900, builds and previews Admin
  (240 s). Admin has no screenshot baselines today.
- `npm run test:appearance`: token contracts on a harness, Chromium and WebKit locally; CI runs
  the Chromium project only.

---

## 10. Rules

### 10.1 Where a visual lives

1. Both apps render it in the same change: `@crate/ui`.
   - `primitives/`: app-agnostic instrument parts (panel shell with top rule and mono header,
     chip, meter with limit tick, legend, readout with reserved width, status badge). The v3
     primitives `MonoLabel`, `StatusDot`, `StatNumber`, `HairlineList` already live here.
   - `domain/`: music concepts (`domain/player/EqBands` exists; a genre wheel would be
     `domain/genres/`, a bliss vector or track readout `domain/tracks/`).
   - `lib/`: hooks and pure helpers used by both (visible loop, motion gate, spring stepping,
     colour reading). `.ts` modules outside `lib/` need explicit exports.
   - Not `composites/` (admin-oriented by plan) and not `domain/stats/Ops*` (admin exception kept
     by plan, not a pattern to extend).
2. One app renders it: keep it in that app (`app/ui/src/components/<domain>/`,
   `app/listen/src/components/<domain>/`), including its math. Move it to `@crate/ui` the day the
   second app adopts it, deleting the local copy in the same change (the component policy forbids
   a Listen redefinition of a shared name; Admin already has duplicates to consolidate, do not add
   a third).
3. Never park a single-app visual in `@crate/ui` behind an `UNUSED_EXPORT_ALLOWLIST` entry.
4. Apps own data, streams, copy, routing and icons; thin app wrappers inject them (the
   `OAuthButtons` pattern).

Candidate placement for the site's visuals, applying the rule above (confirm per feature):

| Visual | Home | Renderer |
| --- | --- | --- |
| Panel shell, chip, meter, legend, readout | `@crate/ui/primitives` | HTML/CSS |
| EQ curve | `@crate/ui/domain/player/EqBands` (done) | SVG |
| Genre wheel | `@crate/ui/domain/genres` if a Listen genre surface ships with it, otherwise `app/ui/src/components/genres` replacing `GenreNetworkGraph` | SVG |
| Track readout / bliss vector | shared only if Admin analysis and Listen track info adopt it together | HTML/CSS bars |
| Mix crossfade | Listen (`components/player`), waits on Smart Mix | SVG |
| Mood map | Listen | Canvas 2D + HTML labels |
| Heatmap | Listen stats (already hand-built) | HTML grid |
| Devices | Listen | SVG |
| Health scan, queue lanes + governor gauges, enrichment orbit, album sidecar, release timeline, federation, API terminal/token allowlist, system map | Admin | HTML lists, SVG for orbit/federation/map |
| Hero field, bliss dives (WebGL) | not in the apps for v3 | n/a |

### 10.2 How to build it

- Renderer: HTML/CSS for rows, cells and bars; SVG for anything up to a few hundred marks that
  needs text, focus, hit areas or CSS states; Canvas 2D for about a thousand soft points with
  sprites; WebGL2 only above ~10K points or for shader effects, with the fallback and lifecycle
  rules from section 7.
- Nivo vs custom: Nivo for standard statistical charts (bar, line, pie, scatter, heatmap, radar),
  mostly Admin, with one token-resolved theme per app instead of the current duplicated
  constants. Custom SVG for instruments (wheel, EQ curve, crossfade, orbit, rails, gauges,
  readouts), which Nivo does not model. Listen should not adopt Nivo for an instrument just to
  satisfy the rule; the first Nivo import costs a vendor chunk.
- No new runtime dependencies for visuals in `@crate/ui`; in the apps, justify any addition
  against its gzip size and lazy placement. No gsap, lenis or motion libraries.
- Colours from tokens only: SVG via `currentColor` and `stroke-*`/`fill-*`/`text-*` token classes
  (EqBands), canvas/WebGL via `readCssColorToken`, re-read when appearance changes. Never a
  literal cyan; accents, presets and modes vary.
- Geometry as SVG attributes in a fixed `viewBox` with `vector-effect="non-scaling-stroke"`;
  per-frame writes through refs; `style={{}}` only for static values with no attribute
  alternative (it counts against the drift ceiling).
- Motion: first paint shows the real current state; animate only real transitions (spring
  re-targeted by new data, path draw when an edge appears, count-up on first view); no idle
  auto-cycling over real data unless the product decides otherwise; final state under reduced
  motion; loops gated by visibility, motion and effects.
- Accessibility: decorative SVG `aria-hidden` with an accessible HTML equivalent (list, table or
  readout with `aria-live="polite"`), or `role="img"` with a label; interactive nodes reachable by
  keyboard with visible focus; prefer existing primitives over raw `<button>` in Listen.
- Easing: Tailwind `ease-*` longhand utilities only for `linear()` springs; no `linear()` inside
  shorthands.

### 10.3 How to keep the budgets

- Import visuals only from lazy pages or lazy surfaces (`React.lazy` routes,
  `lazy-player-surfaces.tsx`); never from the shell, providers, layout or Home's eager path. Add
  an assertion to `AppRouter.bundle.test.tsx` when a heavy surface gets its own boundary.
- Run `npm run --workspace=app/listen build && npm run --workspace=app/listen check:bundle`
  for any Listen change that adds a visual or a dependency; CI only checks it on the Android
  build.
- Keep the drift ceilings green: SVG attributes and refs for data-driven values, token utilities
  instead of legacy ones, new tokens referenced at once, ceilings raised only deliberately.
- No new font weights or families.
- Prefer one shared IntersectionObserver for reveals on a page and one rAF loop per visual, never
  one per mark.

### 10.4 Checklist for a visual PR

1. Placement justified (both apps in this change, or app-local).
2. Data from a precomputed payload or existing stream; no per-request aggregates, no stream inside
   the visual.
3. Static real state renders without rAF; reduced motion, `effects=off` and no-WebGL covered.
4. Works under solid and glass, dark and light, default and Crate Red, cyan/red/violet accents.
5. Copy through props (shared) or `t()` in all 7 Listen catalogs; German and Basque fit.
6. Unit tests for math, static render, interactions and lifecycle; jsdom gaps guarded.
7. Fixtures and intentional re-baselines in `tests/listen-visual` (darwin and linux) when a
   snapshotted Listen page changes.
8. Listen `check:bundle`, drift `--check`, layers, policy tests, and typecheck/tests for Admin,
   Listen and Desktop.

---

## 11. Open questions

1. Amend the root rule "charts use Nivo" and Listen's "do not add new custom charts elsewhere" to
   allow custom SVG instruments in both apps (also asked in `site-language.md`)?
2. iOS deployment target 15.0 is below Tailwind 4's Safari 16.4 floor and below Safari 17.2 for
   `linear()`. Raise the target, or accept degraded styling and easing on older devices?
3. Should Admin apply the motion part of the appearance resolver (`data-crate-motion`), or keep
   relying on the OS media query only?
4. Move the DOM half of `lib/motion-availability.ts` into `@crate/ui/lib` so both apps share one
   motion gate?
5. Run Listen `check:bundle` in `test-frontend.yml` (web build), and give Admin a budget?
6. Fix or deliberately re-baseline the current drift overruns on `feat/crate_v3` before more
   screens land?
7. Sync `<html lang>` with the Listen locale?
8. Does Cabinet Grotesk support `tnum`? Count-up numerals jitter without it; otherwise reserve
   width.
9. Add Admin screenshot coverage for its new visuals, or keep Admin functional-only?
10. Remove the unused `SpectrumRibbonCanvas` and the unused Nivo packages (Admin: bump, chord,
    geo, heatmap, network; Listen: core, line), or keep them for planned work?
11. Audio-reactive visuals on the mobile stable pipeline: hide them, show analysed static state,
    or replay the precomputed Cast spectrum?

---

Sources read: `app/shared/AGENTS.md`, `app/listen/AGENTS.md`, `app/ui/AGENTS.md`,
`app/listen-desktop/AGENTS.md`, `app/readplane/AGENTS.md`, `app/shared/ui/{package.json,
tsup.config.ts, vitest.config.ts, test-setup.ts, design-token-policy.test.ts,
export-usage-policy.test.ts}`, `app/shared/ui/tokens/{index,animations,typography,semantic}.css`,
`app/shared/ui/lib/{appearance-resolver,appearance-token-registry,read-css-color}.ts`,
`app/shared/ui/domain/player/EqBands.tsx`, v3 primitives, `app/shared/fonts/*`,
`app/listen/{package.json, vite.config.ts, vitest.config.ts, capacitor.config.ts, index.html}`,
`app/listen/scripts/check-bundle-budget.mjs`, Listen policy tests and `AppRouter.bundle.test.tsx`,
`app/listen/src/{lib/motion-availability.ts, lib/mobile-audio-mode.ts, lib/platform.ts,
i18n/*, components/player/visualizer/*, components/stats/*}`,
`app/ui/{package.json, vite.config.ts, vitest.config.ts, index.html, src/index.css}`, Admin Nivo
and graph components, `app/listen-desktop/src-tauri/{tauri.conf.json, src/lib.rs}`,
`docs/technical/tauri-desktop-support.md`, `.github/workflows/{test-frontend,build-android,
react-doctor}.yml`, `playwright.*.config.ts`, `tests/listen-visual/*`,
`scripts/design-system/*`, `app/crate/{genre_taxonomy.py, cast_spectrum.py}`, the site's
`src/scripts/viz/*` and `site-language.md`.
