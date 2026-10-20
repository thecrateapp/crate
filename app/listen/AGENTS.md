# Listen app (app/listen)

Scoped rules for the consumer listening app (`crate-listen`: web PWA + Capacitor iOS/Android). Platform-wide rules (DB, worker, deploy, `@crate/ui` placement, no emojis) live in the root `AGENTS.md`/`CLAUDE.md` and are not repeated here.

`app/listen-desktop` (Tauri) aliases `@` to `app/listen/src` and reuses this code. Every change here also ships to desktop: run its typecheck and tests too.

V3 shares one identity, tokens, primitives, recipes and interaction rules with the other app.
Only domain components/workflows differ; do not add app-specific foundation variants. Bootstrap
uses `@crate/ui/lib/crate-identity` and `@crate/ui/lib/interface-preferences`.

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
  - `usePlayer()` merges all three and re-renders on every progress tick. Player controllers use `usePlayerState` + `usePlayerActions` and a stable `usePlayerClock` ref; only small progress/disc/lyric leaves subscribe to ticks. Do not add aggregate subscribers to lists, controllers or pages.
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
- No arbitrary radius/z-index/shadow/text-size values beyond the budget (`design-token-policy.test.ts`, `radius-policy.test.ts`). Genre chips go through `GenrePill` (12px,32/44px targets). Informative metadata/status/counters use `InfoBadge` (`@crate/ui/primitives/InfoBadge`): Mono12/16,24px high, capsule, semantic tone variants. Filters use `FilterChip` (12px,32/44px targets); exclusive radio/tabs keep `SegmentedControl`. The old CrateBadge/CrateChip/CratePill imports are compatibility adapters to these recipes. Preserve artwork overlay surfaces and the player queue counter’s separate14px/8px contract (`badge-policy.test.ts`).
- Charts: Statistical charts (bar, line, pie, scatter, heatmap, radar) use Nivo with the app's token-resolved theme. Instruments (EQ curve, genre wheel, readouts, rails, lanes, gauges, maps, mood map, heatmap band, ticket, crossfade strip, orbit, topology) are hand-built SVG, HTML/CSS, Canvas 2D or WebGL2, following `docs/plans/2026-10-14-crate-v3-design-system.md` §3.5. No new chart libraries; recharts stays out. Precedent: `EqBands` and the Stats signal tape, heatmap and decade bars (`components/stats/`), hand-built SVG/CSS because they animate per bar and must match the Crate Digging canvas card.
- Stats (`pages/Stats.tsx`, `pages/StatsDigging.tsx`, `components/stats/`) read one `/api/me/stats/dashboard` payload per period plus `/api/me/stats/today`. Motion is CSS-only (`stats-reveal`, keyframes in `recipes.css`) with reduced-motion fallbacks.

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

## Player reconciliation — local 1AZ

PlayerBarFrame owns solid dock chrome and the 82px fine-pointer geometry; bar time/seek is one
horizontal row. Coarse desktop/tablet uses104px via the shared Shell metric so two44px targets do
not overlap or clip; clearances follow the same variable. PlayerStage keeps shorter viewports
scrollable. Conventional player actions use ActionButton; specialized play aura/ring/disc and
beam/head remain content effects. PlayerPanels uses actual text Tabs and associated panels.

PlayerClock exposes latest progress to controller/event readers without tick subscriptions.
Time/seek and CD leaves subscribe separately; SyncedLyrics keeps static rows and a small clock
leaf changes active state/underline/line scrolling. Crossfade layers read one app-local CSS clock;
they never animate independent positions/opacity clocks through large React trees. The bar canvas
owns sampling and drawing in one loop through useAudioVisualizer manual mode; stable/native
pipelines without an analyser show none. Preserve remote authority, Jam locks, authenticated
artwork recovery and lazy player chunks. Both review hosts reuse these actual player views;
app-local player components belong to Listen/Player, with no invented Admin consumer.


## Album/access reconciliation — local 1BA

AuthFrame/CredentialsForm, ServerSetupView and AuthCallbackView compose canonical shared forms
without local label, size or glass overrides; pages own cookie/native secure session, invite,
probe and deep-link behavior. AlbumHeroFrame preserves the tested mobile/native placement and
measured offsets; its poster is content without a decorative chrome shadow. AlbumActionsView
and AlbumSelectionToolbar share actual production/review actions. Countdown uses the solid
surface and MonoLabel/StatNumber. Album queue conversion preserves the API length_sec as duration;
read failures keep retry instead of claiming not-found. Artist entry sections use SectionHeader,
MediaGrid and TrackList. OfflineLibraryView only receives verified groups; its progress/ring
leaves own clock subscriptions. No app-local auth/storage/engine behavior moves to shared UI.

TrackRowContent owns reserved quality/BPM/key/duration/action columns through the shared recipe;
missing values keep their slots. Use the actual Listen QualityBadge in hero, row and player
(Solar soundwave, tier colors, InfoBadge anatomy); never derive a track's quality from an album.
The artist Top Tracks API must preserve per-track depth/rate/bitrate in the existing batch read.
Show items retain optional genre_profile. Artist pages pass their already loaded canonical
profile to that artist's shows; GenrePillRow preserves its percentages/source, including0%.
Name-only show responses do not acquire synthetic percentages or per-row API fetches.

Diego's expanded show card is the composition reference for the next Listen migrations: strong
display title, uppercase contextual labels, real GenrePill profiles, clear content regions and
deliberate spacing. Month/group captions use FormField kind="group": the bottom separator stays
inside the caption and the first item begins8px below it. UpcomingMonthGroupView owns that frame.

Compact artist identity beside a name uses EntityAvatar: xs24px in AlbumHero and inline28px
in PlayerTrackIdentity, preserving V2. CrateImage retains credential recovery and only final
errors reach the shared fallback. Adjacent artist text names the action; the avatar is decorative.
Standalone track/album/artist list thumbnails retain48px, including circular artist media.
Do not apply crate-media-thumbnail to compact identity avatars or override Avatar dimensions.

Diego's1BA track-row amendment restores enabled fine-pointer hover illumination. TrackRowView
and HairlineRow share crate-row-highlight for the8%-to-transparent selected/current surface;
selected tracks get the2px marker without becoming the current track. SuggestedTab composes
TrackList/SuggestedTrackRow -> actual TrackRow, with existing data/callbacks and no extra fetches.
Collection children use the same listen-nav-item recipe as first-level navigation (44px),
including collapsed popovers and mobile sheets; HairlineRow is a text-list role, not navigation.

SpinningDisc uses one compositor transform animation at120deg/s, with a single RAF fallback;
ordinary coarse media-clock corrections must not reset its visible phase. Pause, buffering,
hidden/reduced motion and jog freeze/capture that phase; jog starts from the visible rotation
and resumes without snapping to the audio-clock angle. Large seeks may reposition it. Keep
artwork authentication in SpinningDiscArtwork and audio authority in the player controller.
SpinningDiscFrame is the actual visual frame used in production and the isolated review.
PlayerSurfaceModeSwitch uses unboxed44px ActionButton radios: active accent, other glyphs primary
white, tooltip only, arrow/Home/End navigation. Preserve each renderer's visualizer capability
gate and existing preference/haptic callbacks. Expanded Collection stays open on its routes;
collapsed popovers and mobile sheets retain their normal dismissal/focus behavior.

Image scale follows V2 by role, with Diego's confirmed48px thumbnail minimum and compact-artist
24/28px exceptions. ArtistAlbumGroupFrame uses MediaGrid comfortable:2/3/4/5 columns,16px gap,
no additional columns above1024px; compact density is not the discography default. Do not shrink
image roles as a side effect of adopting a shared frame. ModalBody is a full-width layout/scroll
region; do not reintroduce the60ch cap or repair it in ArtistBioProfile callers.
Fullscreen EQ access follows renderer capability, independently of whether the effect is on.
Opening the existing EQ panel does not enable processing or alter preferences. The desktop
header has no added Now Playing caption. Both fullscreen lyrics renderers use the flat
PlayerLyricsSurface; keep timed text, seek, masks and scroll behavior without a colored backdrop.

## Home/Library — local1BB first batch

HomeGreeting composes PageHeader; HeroActions keeps Button and ActionButton/FollowHeartButton
contracts without local visual skins. LibrarySection composes SectionHeader. Contributions and
Bandcamp imports share LibraryContributionRow plus managed ContributionArtwork56px; icon actions
retain short tooltips, contextual accessible names and the existing withdrawal confirmation.
StatNumber receives actual counts including0. Read failures without cached data use ErrorState
and existing refetch; never silently turn a failed source into empty/zero. CrateIndexGrid keeps
V2 2/3/6 columns and20px gap. Details/editors/coverflow/card variants remain the next1BB batch.
ArtistCard contextual subtitles/counts, scalar metadata and PlaylistCard count slots use actual
MonoLabel; the component forces uppercase. Titles, artist names, summaries and descriptions keep
their case. Home history and replay metric captions use the same role. Do not globally uppercase
EntityCard/EntityRow subtitles: they also carry identity and prose.

## Secondary action captions — 1BC

Hero secondary actions use actual MonoLabel as="span" with inherited color for the text below
the glyph, including the injected Follow/Add/Share/Bandcamp slots on Album/Artist/Crate. Ordinary
Button text and primary Play/Shuffle are unchanged. HeroActionBar owns generated captions/More;
app adapters retain callbacks/media/menu/permission authority. Apply this to future equivalents.

## Sharing and imports — local1BD

ShareSheetView composes AppModal/EntityRow/MediaCover with actual MonoLabel action captions.
ShareSheet retains native/canvas/font/capability/cancellation/storage authority; busy sharing
blocks dismissal and duplicate actions. BandcampPageView uses the actual EntityCard for tiles: upper-left artwork menu, full-width
identity and canonical album spacing without a bordered row beneath the cover. Import/Open live
in that menu; tapping the card opens Bandcamp through the app adapter. Collection rows reuse
EntityRow with56px managed artwork and direct actions. Original guards/FLAC payloads and menus remain. Failed uncached reads offer retry; cached content remains usable.

UploadView owns the real drop target: decorative CrateLogo, centered canonical picker Button,
hidden native Input, grouped8px caption spacing and format hint. Dropping stages files only;
explicit Import starts the existing multipart/chunked flow. Empty/text drops keep the queue,
active uploads reject replacements, and confirmed bytes alone drive determinate progress.
The page retains request/error/task authority. RemoteImportView uses caption/ProgressHairline/
ConfirmDialog; unknown download progress is indeterminate, never a fabricated percentage.
Contributions use the album-style EntityCard grid and specific contextual actions; withdrawal retains explicit confirmation.
The small review/English stories import these actual views, not production adapters or copies.

Diego’s Upload amendment removes the entire What happens next section; do not reintroduce
processing/enrichment/attribution instructions into this end-user view or its stories.

### Contributions and Bandcamp navigation amendment

Collection now has six sections: Artists, Crates, Playlists, Albums, Liked and Contributions.
Bandcamp is removed from both sidebar children and Collection tabs; /bandcamp is the single
canonical view, reachable through the existing Settings connection link while its future main
navigation placement is undecided. Old /library?tab=bandcamp and /collection/bandcamp URLs
replace-redirect to it, preserving unrelated query/hash/state. The obsolete LibraryBandcampTab
controller/purchases composition is removed, so it cannot diverge into a second live screen.

Contributions use LibraryContributionCard: actual EntityCard in the default MediaGrid, matching
Albums. The adapter reuses AlbumCard artwork/model/playback helpers and the lazy AlbumCardMenu;
Export and Remove contribution are specific menu entries, with withdrawal still confirmed.
Source metadata stays below title/artist as actual uppercase MonoLabel, without a chip or border:
Upload uses subtle gray with a 12px Solar upload icon; Bandcamp uses accent with its 12px brand
mark. Icons are decorative and inherit the caption color. Missing local album IDs keep navigation, playback and
export unavailable while allowing withdrawal. The current review uses the actual card view and
pure contribution action builder with local callbacks; it never starts real playback.

Upload receipts/toasts and withdrawal notices use end-user copy without task IDs. Receipts
show file counts; withdrawal identifies the album and does not claim the background operation
has already completed. Failed withdrawal keeps its confirmation open with a friendly error.
All seven catalogs cover the messages; internal task IDs remain in response types only.
