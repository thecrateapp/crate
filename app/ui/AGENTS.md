# app/ui — Admin web app (crate-ui)

Scope: everything under `app/ui/`. Platform rules (DB, workers, deploy, testing policy) live in the root `AGENTS.md`; this file only adds admin-specific guidance. Shared UI rules live in `app/shared/AGENTS.md`.

## Directory map

```
src/main.tsx, App.tsx      Entry + router. All pages are React.lazy() routes wrapped in ProtectedRoute/CapabilityRoute
src/pages/                 One file per route (32 pages) + pages/federation/ (panel components for Federation.tsx)
src/components/layout/     Shell.tsx (sidebar + Outlet + CommandPalette + keyboard), Sidebar.tsx (navItems + capabilities), SearchBar
src/components/ui/         Admin barrel (index.ts): re-exports @crate/ui shadcn/primitives + admin-local widgets
src/components/<domain>/   album, artist, genres, users, scanner, shows, track, playlists, auth, admin (ops-surfaces.tsx)
src/contexts/              AuthContext (cookie session + capabilities), OpsSnapshotContext (ops-snapshot + ops-stream)
src/hooks/                 use-api, use-sse, use-task-events, use-task-poll, use-notifications, use-llm, use-keyboard
src/lib/                   api.ts (client instance), library-routes.ts / utils.ts (wrap app/shared/web), tasks, sentry
src/test/                  render-with-admin-providers.tsx (MemoryRouter + mocked AuthContext)
index.html                 Sets data-surface="glass" on <html>
src/index.css              Imports Poppins, @crate/ui tokens, Tailwind; @source "../../shared/ui"
```

## Hard rules

- Data fetching: `useApi<T>(url)` from `@/hooks/use-api` and `api<T>(url, method?, body?)` from `@/lib/api`. Do not import `createApiClient`/`createUseApi` from `app/shared/web` directly; the admin instances wire Sentry (`captureApiError`) and the 401 redirect to `/login?redirect=...`.
- Auth is cookie-based (`/api/auth/me`, `/api/auth/heartbeat` with `app_id: "admin-web"`, `/api/auth/logout`). No bearer tokens, no localStorage tokens. Gate UI by capability via `useAuth().hasCapability(...)` / `hasAnyCapability(...)`, not by role name.
- Every route must be gated: `CapabilityRoute anyOf={[...]}` in `App.tsx`, and the matching `navItems` entry in `Sidebar.tsx` must declare the same `capabilities`.
- Pages are named exports (`export function Tasks()`); `App.tsx` maps them with `lazy(() => import(...).then(m => ({ default: m.X })))`.
- Surface is glass (`index.html`). Do not set `data-surface="solid"` on admin subtrees and do not hardcode card backgrounds; use token classes (`bg-card`, `border-border`, `text-foreground`).
- Charts: Nivo only (`@nivo/*` already in package.json, bundled into the `charts-vendor` chunk by `vite.config.ts`). recharts is not installed in app/ui; do not add it.
- Icons: `lucide-react` is the admin convention. Toasts: `toast` from `sonner`.
- No emojis in UI text.

## Snapshot streams and SSE

Admin surfaces are snapshot-backed: REST snapshot for first paint, then an SSE stream pushes full replacement payloads.

| Stream                                 | Consumer                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/api/admin/ops-stream`                | `src/contexts/OpsSnapshotContext.tsx` (single shared connection; Dashboard and ops widgets read `useOpsSnapshot`) |
| `/api/admin/tasks-stream?limit=...`    | `src/pages/Tasks.tsx`, `src/pages/Health.tsx`                                                                     |
| `/api/admin/health-stream`             | `src/pages/Health.tsx`                                                                                            |
| `/api/admin/logs-stream?limit=100`     | `src/pages/Logs.tsx`                                                                                              |
| `/api/admin/stack-stream`              | `src/pages/Stack.tsx`                                                                                             |
| `/api/events`, `/api/events/task/{id}` | `hooks/use-notifications.ts` (via `useSse`), `hooks/use-task-events.ts`, `lib/tasks.ts`                           |

Rules for stream code:

- Effect dependency arrays that open an `EventSource` must contain only connection identity (URL, query, auth/capability booleans). Never include the payload state, timers, or anything the stream itself updates; that reconnects on every message.
- Follow the `OpsSnapshotContext` pattern: `disposed` flag, close + `setTimeout(connect, 5000)` on `onerror`, clear the timer and close in cleanup, `withCredentials: true`.
- Keep mutable bookkeeping (in-flight refresh, last refresh time, reconnect timer) in refs, not state.
- Reuse the existing connection: read ops data from `OpsSnapshotContext` instead of opening another `ops-stream` per component.
- Snapshot endpoints are precomputed by the projector. Do not add `?fresh=1` polling loops; `OpsSnapshotContext.refresh(true)` is already throttled (1.5s) and fired on focus/online.
- `react-hooks/exhaustive-deps` is OFF in `eslint.config.mjs`, so the linter will not catch bad or missing deps. Review dependency arrays by hand.

## Adding a page

1. Create `src/pages/MyPage.tsx` with `export function MyPage()`.
2. Register a lazy import and a `<Route>` inside the Shell route in `src/App.tsx`, wrapped in `CapabilityRoute anyOf={[...]}`.
3. Add a `navItems` entry in `src/components/layout/Sidebar.tsx` with the same capabilities and, if it should be reachable from Cmd+K, the capability-gated page list in `src/components/layout/CommandPalette.tsx` (it is maintained separately from navItems).
4. Fetch with `useApi`; build entity URLs with `@/lib/library-routes` and encode path segments with `encPath` from `@/lib/utils`.
5. Add `src/pages/MyPage.test.tsx` using `renderWithAdminProviders` from `src/test/render-with-admin-providers.tsx`.

## Adding a component

- Admin-only: put it in `src/components/<domain>/`. Generic admin widgets go in `src/components/ui/` and get exported from `src/components/ui/index.ts`.
- Needed by listen too: move it to `@crate/ui` (see `app/shared/AGENTS.md`), then keep a thin admin wrapper only if admin needs to inject behavior (example: `components/auth/OAuthButtons.tsx` wraps `@crate/ui/domain/auth/OAuthButtons` and injects `api`).
- Import shared pieces by subpath: `@crate/ui/shadcn/button`, `@crate/ui/primitives/AppModal`, `@crate/ui/lib/cn`. The `@/` alias maps to `src/`.

## Commands

```bash
npm run --workspace=app/ui dev          # Vite on 5173; proxies /api to API_URL or http://localhost:8585
npm run --workspace=app/ui test         # vitest run (jsdom, src/**/*.test.{ts,tsx})
npm run --workspace=app/ui test:watch
npm run --workspace=app/ui typecheck    # tsc --noEmit
npm run --workspace=app/ui lint         # eslint --max-warnings=0
npm run --workspace=app/ui build        # tsc -b && vite build
```

CI (`.github/workflows/test-frontend.yml`) runs lint, typecheck, test and build for app/ui (lint also runs in the `eslint-ui` pre-commit hook). Coverage thresholds in `vitest.config.ts`: 50% lines/functions/statements, 40% branches.

## Pitfalls

- `src/components/ui/` still holds local copies of `AdminSelect`, `confirm-dialog`, `card-skeleton`, `grid-skeleton`, `table-skeleton`, `error-state`, `image-lightbox`, `star-rating`, `QrCodeImage`, while equivalents exist in `@crate/ui/composites/*` and `@crate/ui/primitives/*`. Check `@crate/ui` before adding another local variant; do not create a third copy.
- `src/components/shows/ShowCard.tsx` is a local copy; `@crate/ui/domain/shows/ShowCard` is the shared one.
- Large pages (`Tasks.tsx` ~2200 lines, `Download.tsx` ~2000, `Health.tsx` ~1200) own their own streams. Extract hooks rather than adding more effects inline.
- Do not trigger heavy recomputation from the UI (aggregate counts, snapshot rebuilds). If data is missing, it belongs in a snapshot/projector change on the backend.
- Filesystem-mutating actions (tags, delete, move) must call endpoints that enqueue worker tasks; track progress with `use-task-events` / `use-progress-toast`.
