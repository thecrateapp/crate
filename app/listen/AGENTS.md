# Listen app (app/listen)

Scoped rules for the consumer listening app (`crate-listen`: web PWA + Capacitor iOS/Android). Platform-wide rules (DB, worker, deploy, `@crate/ui` placement, no emojis) live in the root `AGENTS.md`/`CLAUDE.md` and are not repeated here.

`app/listen-desktop` (Tauri) aliases `@` to `app/listen/src` and reuses this code. Every change here also ships to desktop: run its typecheck and tests too.

## Directory map (`src/`)

```
app-shell/        Router, providers, guards, route-table.tsx, feature-flags.ts
pages/            Route pages + page models (*-model.ts) + controllers (use-*-page-controller.ts)
components/       Feature components by domain (player/, cards/, home/, actions/, offline/, ...)
components/actions/  Entity action menu builders + ItemActionMenu/ContextMenu wrappers
contexts/         Providers (Player, Auth, Offline, LikedTracks, SavedAlbums, ArtistFollows,
                  Crate/PlaylistComposer) + the player runtime hooks (use-player-*.ts)
hooks/            useApi, equalizer, visualizer, jam, crate-connect WS, warmup
lib/              API client, cache, SSE, routes, playback engines, offline, Capacitor/Tauri, Sentry
lib/gapless5/     Vendored Gapless-5 (locally patched; excluded from coverage and react-doctor)
i18n/             I18nProvider, catalogs/{en,es,fr,de,it,ca,eu}.json, quality/ checks
test/             renderWithListenProviders, gesture helpers
*-policy.test.ts  Source-scanning policy tests (components, tokens, radius, toasts, layout, genre pills, badges)
```

## Player architecture

- `contexts/PlayerContext.tsx` is a thin facade. `PlayerProvider` delegates to `use-player-provider-runtime.ts`, which composes focused hooks (`use-player-engine-*`, `use-player-navigation-actions`, `use-player-jam-queue-sync`, `use-player-connect-*`, `use-playback-*`, `use-media-session`, `use-native-*`). Add behaviour as a new focused hook, not inline in the provider.
- Three contexts (`contexts/player-context.ts`), memoized separately in `use-player-context-values.ts`:
  - `usePlayerActions()`: queue, current track, and stable callbacks (`play`, `playAll`, `next`, `seek`, ...). Default choice for anything that triggers playback.
  - `usePlayerState()`: `isPlaying`, `isBuffering`, `volume`, `analyserVersion`, `crossfadeTransition`.
  - `usePlayerProgress()`: `currentTime`, `duration`; changes every tick.
  - `usePlayer()` merges all three and re-renders on every progress tick. Only full player surfaces use it (`ExtendedPlayer`, `FullscreenPlayer`, `usePlayerBarController`). Do not add it anywhere else.
- Engines: `lib/playback-engine.ts` interface, `lib/playback-engine-factory.ts` picks `androidNativeEngine` (`lib/android-native-engine.ts`) or `GaplessWebEngine` (`lib/gapless-web-engine.ts`) -> `lib/gapless-player.ts` (module singleton wrapping Gapless-5), split into `gapless-player-{controls,queue,volume,equalizer,audio-recovery}.ts`.
- Mobile audio (`lib/mobile-audio-mode.ts`): on iOS/Android runtimes the stable pipeline uses HTML5 audio with WebAudio off (1 decoded track) unless the user enabled "enhanced audio" at startup. `canUseWebAudioEffects` gates EQ/visualizer. Never assume an `AudioContext`/`AnalyserNode` exists.
- Audio recovery (`gapless-player-audio-recovery.ts`) rebuilds the Tauri output after sleep/long absence; detection uses `document.documentElement.dataset.listenRuntime === "tauri"` (set by `app/listen-desktop/src/lib/tauri-init.ts`).
- EQ: `gapless-player-equalizer.ts`, `lib/equalizer.ts`, `lib/adaptive-eq.ts`, `hooks/use-equalizer*.ts`. Visualizer: `hooks/use-audio-visualizer.ts` taps `getAnalyserNode()`; re-acquire it when `analyserVersion` changes.
- Remote targets: Cast, Crate Connect and native are separate providers in `lib/playback-target-*.ts`; Jam sessions can lock the queue (`jamQueueLocked`, `jamTransport`).

### Render-loop rules (hard)

- `eslint` has `react-hooks/exhaustive-deps` OFF. Dependency arrays are reviewed by hand, so be deliberate.
- Never put `currentTime`, `duration`, `isPlaying`, or other per-frame/per-tick values in `useEffect`/`useCallback`/`useMemo` deps of effects that open sockets, SSE, timers, or fetch. Read them via a ref (`useRef` + assign on render) inside the callback.
- Per-frame drawing (visualizer, spectrum ribbon, spinning disc) uses `requestAnimationFrame` + refs and must not `setState` at frame rate in large trees. Respect `lib/motion-availability.ts`.
- Subscribe to `usePlayerProgress()` in the smallest leaf that renders time (progress bar, timestamp), never in a list or page.

## Data fetching

- `useApi<T>(url)` from `@/hooks/use-api` (Listen's own version, not the shared one): cache-backed via `lib/cache.ts`, refetches on scoped invalidation and SSE reconnect, retries 502/503/504. Pass `null` to skip.
- Imperative: `api<T>(path, method?, body?)` from `@/lib/api`. Use `apiUrl()`/`ensureMediaAccessUrl()` for media URLs, never hand-build them.
- Snapshot streams: follow `pages/use-home-discovery-stream.ts` (initial `useApi` + EventSource via `apiSseUrl`, channel state in `lib/sse.ts`, keep the highest `snapshot.version`, degrade to polling).
- Routes and API paths: always use helpers from `@/lib/library-routes` (re-exports `app/shared/web/library-routes.ts`: `albumPagePath`, `artistPagePath`, `albumApiPath`, `albumCoverApiUrl`, `trackStreamApiPath`, ...). Never concatenate `/albums/...` strings.
- Auth: web uses cookie sessions; Capacitor and Tauri store bearer tokens per server (`lib/server-store.ts`, `lib/native-secure-session.ts`, `lib/api-auth-transport.ts`). Runtime flags live in `lib/platform.ts` (`listenRuntime`, `usesConfigurableServer`, `usesSecureSessionStore`, `usesMobileShell`) and `lib/capacitor-runtime.ts` (`isIosRuntime`, `isAndroidRuntime`). Use these, not ad hoc `Capacitor.isNativePlatform()` checks.
- Offline: `OfflineContext` + `lib/offline-*.ts` with web/native/Tauri storage backends. Anything that plays or lists tracks must handle offline-only state.

## UI rules

- Toasts: `notify` from `@crate/ui/lib/notify`. Importing `sonner` directly fails `toast-policy.test.ts`.
- Icons: `@crate/ui/icons`, sized with `CRATE_ICON_SIZE`. `lucide-react` is not a Listen dependency (bundle test enforces it).
- Prefer `@crate/ui` primitives over raw `<button>`/`<input>` (budgeted in `component-policy.test.ts`; raw buttons need an explicit `type`). Do not redefine a `@crate/ui` component name locally.
- No arbitrary radius/z-index/shadow/text-size values beyond the budget (`design-token-policy.test.ts`, `radius-policy.test.ts`). Genre chips go through `GenrePill`; every other badge goes through `CrateBadge` (`@crate/ui/primitives/CrateBadge`): rectangular, white text, sentence case, the tone colors only the icon (`badge-policy.test.ts`).
- Charts: Nivo only.

## i18n (hard rule)

- All visible copy goes through `useTranslation()` / `t("domain.key")` (i18next + ICU plurals). No hardcoded strings on migrated surfaces (`i18n/phase2-hardcoded-copy.test.ts`).
- Every new key goes into ALL 7 catalogs in `src/i18n/catalogs/` (`en` is the source). Placeholders must match English. Missing/extra keys, placeholder mismatches and untranslated English copies under the fully localized prefix lists in `catalogs.test.ts` (selected `settings.`, `stats.`, `player.`, `library.` prefixes) fail `catalogs.test.ts` and `npm run --workspace=app/listen i18n:check`.
- Changing an English string marks other locales stale (`catalogs/.metadata/*.json` source hashes). After updating translations run `node scripts/i18n-check.mjs --write-metadata` from `app/listen`.
- Product terms (`i18n/product-terms.ts`) stay untranslated.

## Recipes

Add a page:

1. `src/pages/Foo.tsx` with a named export `export function Foo()`; put data shaping in `foo-model.ts` and orchestration in `use-foo-page-controller.ts` when non-trivial.
2. Register a `React.lazy` import and a route entry (`deferred(<Foo />)`, or `heroRoute` for transparent headers) in `app-shell/route-table.tsx` (`protectedAppRoutes` vs `publicAppRoutes`). Add a path helper to `app/shared/web/library-routes.ts` if the route is linkable.
3. Add i18n keys to all catalogs, plus `Foo.test.tsx`.

Add an entity action / menu entry:

- Builders live in `components/actions/<entity>-actions.ts` as pure `buildXMenuItems` / `buildXActions` / `buildAlbumMenuEntries` functions returning `ItemActionMenuEntry[]` (via `action()` from `shared.ts`), plus a `useXActionEntries`/`useXActionMenu` hook that wires player, offline and composer contexts.
- Cards and pages share the same builder (e.g. `buildAlbumMenuEntries` is used by `pages/use-album-presentation.ts` and, through `useAlbumActionEntries`, by `components/cards/AlbumCardParts.tsx`). Add the entry once in the builder; never fork menus per surface.
- Render with `ItemActionMenu`/`ContextMenu` from `components/actions/ItemActionMenu.tsx`. Labels via `t`, icons from `@crate/ui/icons`. Extend the builder's test (`*-actions.test.ts`, `action-hooks-i18n.test.tsx`).

Gate an unfinished feature: add a flag to `app-shell/feature-flags.ts` (see `JAM_ROOMS_ENABLED`).

## Testing and checks

Run from the repo root (CI order in `.github/workflows/test-frontend.yml`):

```bash
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen i18n:check
npm run --workspace=app/listen test              # or: cd app/listen && npx vitest run src/pages/Foo.test.tsx
npm run --workspace=app/listen lint              # --max-warnings=0, also in CI
npm run --workspace=app/listen build && npm run --workspace=app/listen check:bundle
npm run --workspace=app/listen-desktop typecheck && npm run --workspace=app/listen-desktop test
npm run test:listen-visual                       # Playwright, playwright.listen-visual.config.ts, tests/listen-visual/
```

- Vitest: jsdom, globals, `src/test-setup.ts` loads all 7 catalogs and an in-memory `localStorage`. Also runs `app/shared/web/**/*.test.ts`. Tests sit next to sources (`Foo.test.tsx`).
- Component/page tests render with `renderWithListenProviders` (`src/test/render-with-listen-providers.tsx`), which accepts partial `auth`, `offline`, `playerActions`, `playerState`, `playerProgress`, `locale`, `route`. Do not mount the real `PlayerProvider`.
- Page tests `vi.mock("@/hooks/use-api")` and drive `vi.mocked(useApi).mockReturnValue(...)`; context hooks (`LikedTracksContext`, `SavedAlbumsContext`, `ArtistFollowsContext`, `use-lazy-crate-options`) are mocked per file (see `pages/Stats.test.tsx`).
- Visual snapshots: desktop 1480x900 and mobile 375x812; update only intentionally.
- react-doctor runs on PRs over changed files (`.github/workflows/react-doctor.yml`, config `app/listen/doctor.config.json`). Fix findings; add per-file overrides only with a reason.

## Pitfalls

- `exhaustive-deps` is off: stale closures and runaway effects are not caught by lint.
- `gapless-player.ts` is a module singleton; tests that touch it must reset state. Patches to `lib/gapless5/gapless5.js` are intentional local forks; keep them minimal and covered by `gapless5-buffering.test.ts`.
- Capacitor builds use `vite build --mode capacitor`; Capacitor plugins must be guarded by runtime flags so web and Tauri do not crash.
- Service worker registers only on web (`shouldRegisterServiceWorker`).
- Shared code in `app/shared/web` is also tested by Listen's Vitest config; breaking it breaks both apps.
