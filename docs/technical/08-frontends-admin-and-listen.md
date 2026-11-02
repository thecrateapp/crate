---
title: Frontend architecture: Admin and Listen
summary: Separate application responsibilities and shared UI boundaries.
section: architecture
audience: [developer]
status: canonical
order: 97
verified: 2026-11-01
sources:
  - app/ui
  - app/listen
  - app/shared/ui
  - app/shared/web
  - app/crate/api/smart_mix_admin.py
  - app/crate/api/crates.py
  - app/crate/api/share.py
  - app/crate/db/queries/crates.py
  - app/crate/worker_handlers/crate_download.py
  - app/crate/download_cache.py
  - app/listen/src/lib/collaboration-access.ts
  - app/tests/test_crates_api.py
  - app/tests/test_crate_downloads.py
  - app/listen/src/components/crates/crate-download.test.ts
  - app/ui/src/pages/Stack.tsx
  - app/ui/src/components/admin/StackMap.tsx
  - app/crate/stack_inventory.py
  - app/crate/observability/live_activity.py
  - app/crate/observability/prometheus_adapter.py
---

# Frontend Architecture: Admin and Listen

## Two products, one backend

Crate has two frontend applications and they are intentionally not the same app
with two skins.

### Admin

- source: `app/ui/src`
- purpose: library management, operations, repair, acquisition, analytics,
  settings
- orientation: desktop-first

### Listen

- source: `app/listen/src`
- purpose: playback, browsing, discovery, social, offline/mobile/PWA use
- orientation: consumer-first, mobile-aware, Capacitor-ready

This split remains one of the most important product decisions in Crate.

## Shared frontend core

Shared code now has two layers:

- `app/shared/web` for thin API/route/util helpers
- `app/shared/ui` (`@crate/ui`) for the shared design system package

The shared layer is intentionally bounded. Most app state and product logic
remains app-specific.

## Listen design-system contract

Listen consumes `@crate/ui` through CSS variables and semantic Tailwind names.
The token barrel is split into layers under `app/shared/ui/tokens/`:

- primitives and shared color/surface definitions;
- semantic roles and reusable visual recipes;
- theme-only overrides in `themes.css`;
- motion, radius, typography and z-index contracts.

The current appearance remains `dark + default`, but the runtime contract now
separates the color-mode preference from the visual identity. The mode can be
`dark`, `light`, or `system`; `system` resolves through
`prefers-color-scheme` and reacts to operating-system changes. The supported
skins are `default` and `crateRed`, and each skin has explicit dark and light
token variants. Legacy `aurora` selections migrate to `crateRed`, while old
high-contrast selections fall back to `dark + default`.

Runtime state is exposed through `data-crate-app="listen"`,
`data-crate-mode`, `data-crate-mode-preference`, and `data-crate-skin`, so Admin
does not inherit Listen appearance rules accidentally. Skins are limited to an
explicit variable allowlist covering identity colors, surfaces, rings, radii,
shadows, and brand typography; they cannot change layout, spacing, motion or
component behavior. Settings applies the selection immediately and persists it
per device. The shared appearance store also keeps the Listen Toaster aligned
with the resolved mode. `ThemeScope` applies the same resolver to an isolated
preview or portal without writing storage or mutating the main scope. The
presentation density is orthogonal to the skin: `comfortable` is the baseline
and `compact` changes only bounded content metrics and virtualized row
estimates; hit targets, player geometry and safe areas remain stable.

The appearance browser gate lives in
[`listen-design-system-visual-qa.md`](listen-design-system-visual-qa.md).
The shared Artist Hero frame and the versioned artifact/rollback lifecycle are
documented separately in
[`artist-hero-theming-rollout.md`](artist-hero-theming-rollout.md).

The quality gates also enforce the shared UI layer graph, explicit WCAG AA
pairings for supported skins and destructive controls, and a reproducible
`@crate/ui` build that emits both ESM and DTS without relying on tsup's DTS
worker. Runtime progress geometry remains a calculated CSS custom property,
not a new semantic token.

## Admin app architecture

The admin app is still a fairly traditional operator SPA:

- auth context
- lightweight preview player
- notifications and tooling affordances
- snapshot-backed ops/dashboard contexts
- route-driven page composition
- acquisition surfaces for Tidal, Soulseek, uploads, imports, and Bandcamp
  matching/sync visibility

One notable current addition is the admin dashboard's visibility into runtime
eventing:

- domain-event stream diagnostics
- cache invalidation runtime
- SSE surface catalog

That data is exposed through the ops snapshot surface rather than being wired as
one-off dashboard fetches.

### Stack map

The Stack page draws the host and both Compose projects (application and
optional monitoring) as a topology map. Services, health and allowed actions
come from a Docker inventory built off-request into the cached stack snapshot.
If Docker cannot be read the map says so, or keeps the last snapshot marked
stale, instead of showing an empty healthy host. Container actions keep the
existing allowlist and are limited to the application project.

A live layer animates the map while someone has the page open. The projector
samples aggregate counters every five seconds and publishes a frame on the
existing `stack-stream` SSE as `event: activity`: requests per minute by client
(Listen web, Android, iOS and desktop, Admin, Subsonic, readplane fallback),
completed and failed tasks per queue, projected events and devices listening
now. Frames carry counts only, never user, track or route identifiers, and stop
when nobody watches. Pulses follow declared connections only, are capped per
frame and are disabled under reduced motion.

With `CRATE_PROMETHEUS_URL` set and the projector joined to the internal
`prometheus-query` network, the same frames add CPU and memory per service and
for the host every 30 seconds, plus requests per minute through Traefik for each
service when Traefik's metrics entrypoint is enabled. Readings older than 90
seconds are ignored; a missing reading shows nothing rather than zero.
`CRATE_GRAFANA_URL` adds links from the inspector to the infrastructure
dashboards. The overlays and the Traefik change are described in the monitoring
README (`deploy/observability/README.md`).

## Listen app architecture

The Listen app changed substantially during the refactor and is now more
explicitly composed.

### Composition root

`app/listen/src/App.tsx` is now intentionally tiny:

- `AppErrorBoundary`
- `AuthProvider`
- `AppRouter`

The bulk of routing and provider composition lives in `app-shell/`:

- `AppProviders.tsx`
- `AppRouter.tsx`
- `RouteGuards.tsx`
- `route-table.tsx`

Listen also owns the user-facing pieces of contribution-based acquisition:

- Settings exposes Bandcamp connection/sync controls.
- Upload lets a user contribute audio files or ZIP archives.
- Library has a Contributions tab for portable export and withdrawal.
- Album and Artist pages can show Bandcamp support CTAs when confirmed links
  exist.

### Routing

`route-table.tsx` defines public and protected route definitions and keeps lazy
imports centralized. `AppRouter` stitches them together under:

- `ServerGate` for native multi-server setup
- `ProtectedRoute` for auth gating
- `Shell` for the authenticated app chrome

### Providers

`AppProviders.tsx` composes the app-specific runtime providers:

- player
- follows
- likes
- offline
- saved albums
- playlist composer

## State management approach

Neither app uses Redux-style global state. The current strategy is:

- React contexts
- route-local `useApi(...)`
- focused hooks
- small shared utilities/mappers

The important architectural change is that several large contexts were split
internally while keeping their public hook contracts stable.

## Listen context boundaries

### Auth

`AuthContext.tsx` is now a thin facade over:

- `use-auth-session`
- `use-auth-oauth-sync`
- `use-auth-heartbeat`

### Offline

`OfflineContext.tsx` is now a thin facade over `use-offline-runtime`, which
keeps storage/sync logic out of the context shell itself.

### Player

`PlayerContext.tsx` is still the heaviest runtime module in Listen, but it is
no longer one undifferentiated monolith.

Important internal slices now include:

- `use-player-runtime-state`
- `use-player-engine-callbacks`
- `use-player-engine-sync`
- `use-player-queue-actions`
- `use-player-auth-sync`
- `use-play-event-tracker`
- `use-playback-persistence`
- `use-soft-interruption`
- `use-playback-intelligence`

The public `usePlayer()` contract remains stable while the implementation is
increasingly hook-oriented.

## Listen auth and platform boundary

The native boundary is also thinner now:

- `lib/capacitor.ts` is a facade
- OAuth parsing/persistence and runtime init live in dedicated modules
- server selection and per-server token storage live in `server-store.ts`

This is what supports the current multi-server Capacitor model.

## Test and quality gates

Listen now has an explicit quality gate:

- ESLint config in `app/listen/eslint.config.mjs`
- `npm run --workspace=app/listen lint`
- `npm run --workspace=app/listen typecheck`
- Vitest + Testing Library behavior tests
- reusable render harness in `src/test/render-with-listen-providers.tsx`

That test harness gives the app better behavior coverage around auth, routing,
offline state, and playback metadata flows.

## Data-fetching philosophy

Both apps still mostly use:

- declarative `useApi(...)` for page/section fetches
- imperative `api(...)` or `apiFetch(...)` for mutations and commands

But many complex surfaces now sit on top of snapshot/read-model endpoints rather
than bespoke “dashboard-only” assembly code inside the page itself.

Home discovery is snapshot-backed and streamed through
`/api/me/home/discovery-stream`. Listen also subscribes to the replayable cache
invalidation feed for catalog-like scopes (`home`, `library`, `upcoming`,
`artist:*`, `album:*`, `playlist:*`) and forces a fresh home discovery fetch
when those events arrive. This is important for Bandcamp imports and uploads:
the user expects sections such as Just Landed to update after the worker commits
new library content.

## Smart Mix surfaces

Smart Mix section verified against source on 2026-10-21.

Admin's Analysis page embeds `SmartMixCoverage`, exposing coverage by version/quality,
paginated profile and processing states, activity and campaign controls. It uses the Admin
Smart Mix API; viewing its status can enqueue coverage refresh. This surface is distinct
from the read-only MCP authority granted to Hermes.

Listen discovers server capabilities and applies user preferences. In the current engine
adapter, server transition planning and native continuation are selected for
`android-native`. Sharing TypeScript with web/desktop/iOS does not establish equivalent
native execution. See [Smart Mix operation](smart-mix-operations.md) for the consumer matrix,
flag dependencies and outstanding platform/physical acceptance gates.

## Listen Crates: permissions, sharing and downloads

Verified against implementation and tests on 2026-10-21. A Crate is an album collection,
not a track playlist. Its ordered album identities come from the global catalog; playback
resolves currently available tracks, while offline transfer and ZIP download select local
tracks. Neither operation acquires missing remote music.

`app/crate/db/queries/crates.py` computes `access` as `owner`, `collaborator`, `public` or
`none`. Collaboration requires both membership and `is_collaborative=true`; disabling it
removes collaborator access to private Crates until enabled again. Owners edit content,
change visibility/collaboration, manage members and delete the Crate. Collaborators edit
content and can leave; public viewers cannot edit. Private or inaccessible details return 404. Listen derives controls from access through `app/listen/src/lib/collaboration-access.ts`;
the server rechecks authority, so a hidden button is not the permission boundary.

Owners add collaborators by user ID or username. The create/list/accept invitation-link
routes return 410; old invite tables do not mean invitation links are supported. Public
Crates can be followed by signed-in users (owners cannot follow themselves), and accessible
Crates can be copied into an independent private Crate. Owned/shared and followed lists
have separate endpoints under `/api/me/crates` and `/api/me/crates/followed`.

Public details are readable anonymously at `/api/crates/{ref}`, without member data.
The reference can be a UUID, eight-character short code or `{slug}-{short_code}`. Renaming
changes the slug while the code still resolves; `/share/crate/{ref}` redirects legacy
references to the canonical public reference. The share landing page and scoped artwork
are public only while the Crate is public. Sharing does not grant anonymous playback or
ZIP access: those endpoints require authentication and current Crate access.

`POST /api/crates/{id}/download` returns `ready` with an artifact URL on a cache hit,
or HTTP 202 `pending` with a deduplicated `crate_download` task. No local tracks yields
404; disabled download cache or inability to queue yields 503. The worker builds a ZIP
under the download cache with a cache-key lock, capacity/free-space checks and temporary
file cleanup. Keys include the Crate ID/name and ordered local track IDs, paths, artist/album, size and
`updated_at` values; publication uses the worker's current source selection. A prepared artifact GET validates
current access, cache-key shape, expiry and the artifact's `crate_id` before serving it.
A URL is not a permanent grant and a pending task is not a ready download.

Listen follows task SSE progress/completion and falls back to bounded task polling when
SSE is unavailable or closed. Failed/cancelled tasks and the client deadline produce a
failure state; the client deadline does not cancel the server task. Offline device storage
is a separate flow, not proof that a ZIP exists. Hermes' read-only pilot cannot start a
download or change visibility. Without current task/cache/access evidence it must describe
these contracts and report the live state as unavailable.

Source and regression map: `app/crate/api/crates.py`, `app/crate/api/share.py`,
`app/crate/db/queries/crates.py`, `app/crate/worker_handlers/crate_download.py`,
`app/crate/download_cache.py` and `app/listen/src/components/crates/crate-download.ts`.
`app/tests/test_crates_api.py` covers anonymous/public/private detail, short-code redirects,
owner/collaborator control and disabled invites. `app/tests/test_crate_downloads.py` covers
deduplication, cache reuse, access/expiry, archive limits and disk pressure;
`app/listen/src/components/crates/crate-download.test.ts` covers the client task lifecycle.
