# app/shared — @crate/ui design system and shared web code

Scope: `app/shared/ui/` (npm workspace `@crate/ui`) and `app/shared/web/` (plain TS modules imported by relative path). `app/shared/cast/` (`@crate/cast-protocol`, used by listen + cast-receiver) and `app/shared/fonts/` are not covered here. Platform rules live in the root `AGENTS.md`.

## Consumers (verify before changing any export)

| Consumer               | Uses                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app/listen`           | `@crate/ui` heavily (~360 files), `shared/web/{api,use-api,utils,library-routes,sentry,artist-hero-contract}` |
| `app/ui` (admin)       | `@crate/ui` (~100 files), `shared/web/{api,use-api,utils,library-routes,sentry}`                              |
| `app/listen-desktop`   | `@crate/ui/lib/theme-skin` and listen code it pulls in; tsconfig includes `../shared/web/**`                  |
| `app/site`, `app/docs` | `shared/web/sentry` only                                                                                      |
| `app/cast-receiver`    | none of these (only `@crate/cast-protocol`)                                                                   |

Find real usage with `git grep -n "@crate/ui/<path>" -- app/ui/src app/listen/src app/listen-desktop/src` and `git grep -n "shared/web/<file>" -- app`.

## Directory map

```
ui/tokens/        CSS tokens: index.css (entry), surfaces.css (solid|glass), themes.css, semantic, colors, radius, z-index, typography, animations, recipes
ui/lib/           Hooks + utils: cn, use-breakpoint (useIsDesktop), use-dismissible-layer, use-sheet-drag, appearance-resolver/registry, theme-skin, notify, offline
ui/icons/         Icon catalogue (Solar icons wrapped as CrateIcon, CRATE_ICON_SIZE scale); import from "@crate/ui/icons"
ui/shadcn/        19 curated shadcn/Radix components (button, dialog, select, sheet, table, tooltip, ...)
ui/primitives/    App-level building blocks: AppModal, AppPopover, ActionIconButton, CrateBadge, IconButton, ThemeScope, VtNavLink, ...
ui/composites/    Composed blocks: ConfirmDialog, AdminSelect, Card/Grid/TableSkeleton
ui/domain/        Music-domain UI: actions, auth, brand, entity, filters, genres, hero, lists, media, navigation, player, playlists, shows, states, stats, user
ui/*.test.ts      Package policy tests (export-usage-policy, design-token-policy)
web/api.ts        createApiClient({ base, credentials, defaultHeaders, onUnauthorized, onError }) + ApiError; dedupes in-flight GETs
web/use-api.ts    createUseApi(reactHooks, apiFn) factory; catalog-warming retry
web/library-routes.ts  Canonical page/API/asset path builders for artists, albums, tracks, genres
web/utils.ts      Formatters (formatDuration, formatSize, timeAgo, ...) and encPath
web/sentry.ts     Shared Sentry scrubbing + API error reporter
web/artist-hero-contract.ts  Artist hero composition contract types (versioned)
```

## Hard rules

- A component goes in `@crate/ui` only when BOTH admin and listen use it. Single-app components stay in that app. `export-usage-policy.test.ts` fails if a `@crate/ui` module is not imported by `app/listen/src` or `app/ui/src`, unless it matches a base-system prefix (shadcn, tokens, icons, composites, `domain/stats/Ops*`) or is listed in `UNUSED_EXPORT_ALLOWLIST` with a reason.
- Domain components take data and callbacks via props (`onPlay`, `onClose`, `onToggle`, ...). Do not read app contexts (auth, player, router state, i18n) or call app API clients inside `@crate/ui`; apps inject behavior through thin wrappers (see `app/ui/src/components/auth/OAuthButtons.tsx`).
- `shared/web` factories stay framework-injected: `createUseApi` receives React hooks and an `api` function; `createApiClient` receives callbacks. Do not hardcode app behavior (redirects, token storage, Sentry init) here.
- Use tokens, not raw values. `design-token-policy.test.ts` budgets arbitrary `rounded-[..]`, `z-[..]`, `shadow-[..]`, `text-[..px]`, `tracking-[..]` per file, and icon sizes must come from `CRATE_ICON_SIZE`.
- Surfaces: `[data-surface="solid"]` (also the `:root` default, listen) and `[data-surface="glass"]` (admin sets it on `<html>`). Components must read `--color-card`, `--surface-*` etc. and work under both; never branch on app identity. `lib/appearance-resolver.ts` may set `data-surface` at runtime.
- Peer deps only (react 19, react-router 7, radix-ui, sonner, cva, clsx, tailwind-merge, @solar-icons/react-perf). Do not add runtime dependencies without updating `package.json` peers and the `external` list in `tsup.config.ts`.
- No emojis in UI text.

## How apps import

- `@crate/ui` resolves through the npm workspace symlink (`node_modules/@crate/ui` -> `app/shared/ui`). The `exports` map points at SOURCE `.ts/.tsx` files, so apps compile the source directly; `dist/` (tsup + tsc) is only used by `publishConfig`. A shared edit is live in every consumer immediately.
- Subpath imports only: `@crate/ui/shadcn/button`, `@crate/ui/primitives/AppModal`, `@crate/ui/composites/ConfirmDialog`, `@crate/ui/lib/cn`, `@crate/ui/domain/shows/ShowCard`, `@crate/ui/icons`. CSS: `@import "@crate/ui/tokens/index.css"`.
- Wildcard subpaths (`./domain/*`, `./primitives/*`, ...) map to `*.tsx` only. Folder barrels (`index.ts`) and `.ts` modules (`domain/actions`, `domain/media/MediaEntity`, `domain/shows/show-types`, ...) need an explicit entry in BOTH `exports` and `publishConfig.exports`; `lib/*` maps to `*.ts`.
- `shared/web` is not a package: import by relative path (`../../../shared/web/api`). Admin and listen wrap it in `src/lib/api.ts`, `src/hooks/use-api.ts`, `src/lib/utils.ts`, `src/lib/library-routes.ts`; app code should import those wrappers.
- Consumers scan shared classes via Tailwind `@source "../../shared/ui"` in their CSS entry. A new consumer must add it or shared component classes will be purged.

## Adding a component

1. Confirm both apps need it now. Otherwise keep it in the app.
2. Pick the layer: shadcn (unchanged Radix wrapper) < primitives (app-agnostic) < composites (composed blocks) < domain (music concepts, props/callbacks only).
3. Add `Thing.tsx` + `Thing.test.tsx` next to it. If it is a `.ts` module or a barrel outside `lib/`, add explicit `exports` + `publishConfig.exports` entries.
4. Replace the app-local copies in the same change so the export-usage policy stays green and no duplicate survives.
5. Run the commands below, then typecheck and test BOTH apps.

## Commands

```bash
npm run --workspace=app/shared/ui typecheck   # tsc --noEmit
npm run --workspace=app/shared/ui test        # vitest (jsdom); includes policy tests
npm run --workspace=app/shared/ui build       # tsup ESM + tsc declarations into dist/
npm run design-system:tokens:check            # theme token CSS snapshot (root script)
npm run design-system:drift                   # drift inventory (scripts/design-system)
# After any shared change, also:
npm run --workspace=app/ui typecheck && npm run --workspace=app/ui test
npm run --workspace=app/listen typecheck && npm run --workspace=app/listen test
npm run --workspace=app/listen-desktop typecheck
```

`shared/web/*.test.ts` run under the listen suite (`app/listen/vitest.config.ts` includes `../shared/web/**/*.test.ts`), not under `@crate/ui` or admin. Run `npm run --workspace=app/listen test` after touching `shared/web`.

## Pitfalls and breaking changes

- Renaming or removing a prop, export, token or CSS variable breaks listen, admin and listen-desktop at once. Grep all consumers first and say so explicitly in the PR; prefer additive changes plus a follow-up removal.
- Changing a token value in `tokens/` changes both surfaces in both apps. Check solid and glass.
- `library-routes.ts` builds URLs the backend and readplane serve; changing a path shape is a cross-stack change.
- `api.ts` in-flight GET dedupe and abort semantics are relied on by both `useApi` instances; keep behavior stable.
- Admin still keeps local duplicates of composites/primitives (`app/ui/src/components/ui/`) and of `ShowCard`; consolidate instead of adding a third copy.
