# Crate V3 — Admin icon inventory / checkpoint 1V

2026-10-17. Task 1b.8, inventory-first review. Base: published 1U
`afed5a3c2174b7ebe39c2f6a6e7fbdbd7212469a`, branch `feat/crate_v3`, isolated Linux worktree
`/home/diego/.codex/worktrees/crate-v3-1q/crate`.

**1V is local, uncommitted and awaiting Diego. No production icon has been removed.**
Review at <http://127.0.0.1:5186/#iconos-admin>. The existing preview/checkpoints stay active.
The Task 1b.8 requirement to show an inventory before deletion is this checkpoint's scope.

## Recommendation for review

Retire redundant glyphs beside labelled Admin navigation/actions, headings and metrics. Use text,
figures, rules and dots with state words, under DS §1.7. **Propose zero permanently retained action
glyphs at this point.** This is a proposal, not approval or a migration already completed.

Close, disclosure, playback and image editing receive no blanket exemption. Text is practical
for the compact controls listed below; where a shared component generates its own glyph, first
add a reviewed contract with tests in both consumers. Never remove Listen's icons globally.
The preview uses real Button/StatusDot/StatNumber/Input components with local fictional actions;
it does not mount the API-dependent Admin Shell or claim its migration is complete.

## Reproducible inventory

```bash
node scripts/design-system/admin-icon-inventory.mjs --check
node --test --test-concurrency=1 scripts/design-system/admin-icon-inventory.test.mjs
# Only when the source inventory needs a reviewed refresh:
node scripts/design-system/admin-icon-inventory.mjs --write
```

The [generated JSON](crate-v3-analysis/admin-icon-inventory-1v.json) indexes production Admin
TS/TSX/CSS files, runtime glyph imports (aliases/namespaces), JSX, references in expressions,
icon props/properties/maps and dynamic slots. It follows owned imports, named/star reexports and
local symbols to specific shared/local exports, rather than attributing every sibling export's
icons to the caller. Cycles stop. Admin files and 59 traced owned dependency files carry SHA-256
hashes; `--check` rejects a stale report. The [manual review cases](crate-v3-analysis/admin-icon-review-1v.json)
retain exact source lines at the published base, checked by the scoped tooling tests.

| Measure | Count |
| --- | ---: |
| Production Admin files scanned | 142 |
| Files with indexed references | 90 |
| Files with runtime glyph imports | 72 |
| Runtime glyph import bindings | 543 |
| `owned-icon-consumer` | 707 |
| `glyph-jsx` | 625 |
| `external-visual` | 39 |
| `icon-property` | 93 |
| `dynamic-glyph` | 51 |
| `icon-prop` | 242 |
| `glyph-reference` | 320 |

**These categories overlap; never sum them as visible icons.** `glyph-reference` includes props,
registries, aliases and other expressions. `dynamic-glyph` is a name-based inspection candidate,
including wrappers such as ActionIconButton, not proof that a glyph renders. The 707 owned-control
routes are potential dependencies: Button's loading spinner and CrateChip's optional icon produce
records even when omitted at a callsite. A route records the first supporting dependency chain,
not all paths or all icons inside it. Repetition in loops is one static site.

This is syntax analysis, not a TypeScript type checker or runtime render census. Shadowing,
computed names, opaque third-party internals and condition-dependent composition require manual
inspection during each migration group. The source locations and snippets are review evidence,
not an automatic deletion list. Native SVG/Canvas/string/CSS-vector entry kinds are supported;
there are zero direct occurrences in this Admin scope at this base. Shared provider SVGs and
runtime chart/map/QR rendering therefore also need the explicit content review below.

## Functional controls and shared contracts

All alternatives below are pending review. The complete reference list is in the generated JSON;
these are the individual compact/shared/content cases that need explicit handling before migration.
“Content” describes the purpose of an existing surface, not a retained Admin action-icon exception.

| Case and source at 1U | Proposal | Reason / dependency |
| --- | --- | --- |
| Menú de navegación — [`app/ui/src/components/layout/Shell.tsx:107`](../../app/ui/src/components/layout/Shell.tsx#L107) | Navegación | El nombre puede quedar visible; conserva apertura, Escape y foco. |
| Volver — [`app/ui/src/components/layout/Shell.tsx:139`](../../app/ui/src/components/layout/Shell.tsx#L139) | Atrás | La palabra identifica la acción y conserva la navegación del historial. |
| Avanzar — [`app/ui/src/components/layout/Shell.tsx:147`](../../app/ui/src/components/layout/Shell.tsx#L147) | Adelante | La palabra identifica la dirección y conserva el estado deshabilitado. |
| Contraer barra lateral — [`app/ui/src/components/layout/Sidebar.tsx:340`](../../app/ui/src/components/layout/Sidebar.tsx#L340) | Contraer / Expandir | Retirar iconos de las entradas exige conservar nombres también al contraer. |
| Destinos y acciones de la paleta — [`app/ui/src/components/layout/CommandPalette.tsx:378`](../../app/ui/src/components/layout/CommandPalette.tsx#L378) | Nombres y atajos | Mantener filtrado, permisos, selección y teclado; los mapas no justifican una excepción. |
| Reducir zoom — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:568`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L568) | Reducir | El texto conserva la operación sin depender de una lupa. |
| Ampliar zoom — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:575`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L575) | Ampliar | La misma pareja verbal distingue las dos direcciones. |
| Reflejar imagen — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:582`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L582) | Reflejar | Conservar el estado pulsado y el eje horizontal en el nombre accesible. |
| Girar a la izquierda — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:592`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L592) | Girar −90° | La cifra comunica dirección y magnitud. |
| Girar a la derecha — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:599`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L599) | Girar +90° | La cifra diferencia la acción opuesta. |
| Restablecer recorte — [`app/ui/src/components/artist/HeroCompositionCanvas.tsx:606`](../../app/ui/src/components/artist/HeroCompositionCanvas.tsx#L606) | Restablecer | La palabra ya nombra la acción; no requiere un glifo. |
| Descargar pista — [`app/ui/src/components/album/TrackTable.tsx:1029`](../../app/ui/src/components/album/TrackTable.tsx#L1029) | Descargar | El texto evita depender de la flecha; conservar permisos y descarga de la pista correcta. |
| Valoración — [`app/ui/src/components/ui/star-rating.tsx:43`](../../app/ui/src/components/ui/star-rating.tsx#L43) | Valores 1–5 y Borrar | La cifra comunica la puntuación; probar lectura, selección y eliminación. |
| Reordenar pista — [`app/ui/src/pages/PlaylistEditor.tsx:1733`](../../app/ui/src/pages/PlaylistEditor.tsx#L1733) | Ordinal y marcador CSS | El agarre puede usar un marcador simple; revisar acceso por teclado en el grupo, no ocultarlo con la retirada del glifo. |
| Cerrar imagen — [`app/ui/src/components/ui/image-lightbox.tsx:39`](../../app/ui/src/components/ui/image-lightbox.tsx#L39) | Cerrar | El cierre no es una excepción automática. Mantener Escape, foco de retorno y área táctil. |
| Cierre heredado de overlays — [`app/shared/ui/shadcn/overlay-close-button.tsx:24`](../../app/shared/ui/shadcn/overlay-close-button.tsx#L24) | Cerrar en Admin | Requiere contrato compartido explícito y pruebas de consumidores en ambas apps antes de migrar. |
| Carga heredada de Button — [`app/shared/ui/shadcn/button.tsx:95`](../../app/shared/ui/shadcn/button.tsx#L95) | Procesando y marcador CSS | El spinner es condicional. Conservar aria-busy y disabled; no quitarlo globalmente de Listen. |
| Indicador y desplazamiento de Select — [`app/shared/ui/shadcn/select.tsx:51`](../../app/shared/ui/shadcn/select.tsx#L51) | Opciones / Subir / Bajar | Revisar cada consumidor, apertura y desplazamiento. Sin exención general para disclosure. |
| Play en la presentación del hero — [`app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:1045`](../../app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx#L1045) | Conservar la representación de Listen | Es un span dentro de una vista pointer-events-none: representa el resultado de otra app, no un transporte Admin. Revisar fidelidad al migrar el editor. |
| Follow en la presentación del hero — [`app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx:1056`](../../app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx#L1056) | Conservar la representación de Listen | Mismo contexto de presentación; no autoriza iconos en las acciones del editor. |
| Código QR — [`app/ui/src/components/ui/QrCodeImage.tsx:19`](../../app/ui/src/components/ui/QrCodeImage.tsx#L19) | Conservar los datos codificados | El patrón comunica una URL a un lector; es contenido funcional, no un glifo decorativo. |
| Marca de Google — [`app/shared/ui/domain/auth/OAuthButtons.tsx:121`](../../app/shared/ui/domain/auth/OAuthButtons.tsx#L121) | Conservar la marca; revisar botón con texto en su fase | Activo de identidad del proveedor. No constituye excepción general para iconos de acciones. |
| Marca de Apple — [`app/shared/ui/domain/auth/OAuthButtons.tsx:140`](../../app/shared/ui/domain/auth/OAuthButtons.tsx#L140) | Conservar la marca; revisar botón con texto en su fase | Activo de identidad del proveedor; mantener accesibilidad y disponibilidad. |
| Marca de Crate en cubierta — [`app/ui/src/components/playlists/PlaylistArtwork.tsx:33`](../../app/ui/src/components/playlists/PlaylistArtwork.tsx#L33) | Conservar la cubierta | La imagen pertenece al contenido de la playlist; no es decoración de navegación. |
| Mapa de usuarios y marcadores — [`app/ui/src/components/users/UserMap.tsx:280`](../../app/ui/src/components/users/UserMap.tsx#L280) | Conservar posiciones, agrupación y datos | Es un instrumento. Los glifos de sus acciones y leyendas siguen sujetos a retirada. |

Nivo statistical charts, Leaflet location/cluster markers and crop/hero composition remain
instruments/data. Their action buttons, headers, tooltips and legends are still subject to the
Admin action policy. Google/Apple marks and the Crate cover mark are identity assets; preserving
an asset does not justify an icon-only login button. The later auth group must review visible
provider names. The hero Play/Heart sites are inert spans in `pointer-events-none` presentation
of Listen, so preserving their represented output does not exempt the editor's own controls.
There is no new permanent functional exception allowlist in 1V.

## Proposed migration groups after approval

1. **Navigation/chrome:** `components/layout/Sidebar.tsx`, `CommandPalette.tsx`, `Shell.tsx`.
   Replace entry/action glyphs with names; reconcile collapsed navigation, mobile trigger,
   back/forward disabled state and palette keyboard/search/capability gates. Preserve 1U's
   first-focus skip link/main target. Add render/accessibility and scoped source-policy tests.
2. **Shared/local controls:** loading, overlay close, Select/submenus, pills/chips, context menus
   and image/lightbox/rating controls. Inventory actual consumers first. Omit existing icon props
   in Admin. Add opt-outs only where needed, with both apps' contract tests and no Listen change.
3. **Operations/settings:** Dashboard, Tasks, Analysis, Health/SystemHealth, Logs, Stack,
   Resources, Settings, Scanner/Download, Sources/Watchers and associated ops surfaces. Preserve
   streaming, permissions, action states and 1T's neutral risk/severity rules.
4. **Library/editor routes:** Artists/Artist/Album, Tracks, Genres, Playlists/PlaylistEditor,
   Shows/upcoming/discovery/new releases, Users/auth/federation and their domain components.
   Subdivide into small reviewable groups; retain selection, download/edit and keyboard access.

Each group starts with failing tests for the affected behaviours and the source policy. The
future `app/ui/src/admin-icon-policy.test.ts` must cover imported, passed, mapped and wrapped
entry points in its migrated scope, with only individually reviewed retained exceptions. The
unmigrated inventory is pending work, never a bulk approved exception list or permission to add
icons. Expand the policy as groups are migrated; the completed task enforces the whole scope.

Per group: scoped serial Vitest (`--maxWorkers=1`), relevant types/lint, Admin bundle budget and
focused browser checks (`--workers=1`), preview + review stop before publication/next group.
No first production migration group is included in 1V.

## Validation and limits

The 1V scanner has ten passing serial Node tests: direct/aliased/namespace imports, type-only
exclusion, maps/props, dynamic slots, raw vectors, external visuals, precise owned exports,
star-barrel cycles, source hashes, CLI freshness and exact manual case locations. Its original
seven cases failed before implementation; the star/cycle fixture also exposed a failing branch
before repair. The preview's new scoped desktop/mobile browser cases pass (filter, pagination,
keyboard/details, local actions, actual 8 px field gap, 44 px targets, URL preservation and no API
requests/page errors/overflow). Strict preview types/lint/static build pass; the affected six 1U
browser cases also pass. The independent read-only review found no critical/important issue.
Its minor cycle-negative-cache issue was reproduced with two consumer entry points and repaired;
all ten scanner tests pass and the generated report is unchanged. Final evidence is in the handover.

No production imports, package/lock changes, production icon removal or shared API changes.
Admin's last measured bundle remains **529225 / 532480 B gzip** from 1U, headroom **3255 B**;
this inventory-only checkpoint does not claim a new production build measurement.

The 33 canonical PNGs/manifest are still 1M. No local baseline generation, full suite/full CI,
PR/merge/rebase/deploy/release or Smart Mix integration. Canonical Linux recording/import/
comparison, real-data geometry, cross-engine/native/assistive-technology QA and fidelity against
the unavailable `app/web@258bbaee` pin remain pending. No replacement reference is substituted.

**Stop at 1V for Diego's inventory/proposal review, before publication or the first migration group.**


## Publication and 1W amendment — 2026-10-17

Diego approved/published 1V as `cd5bf5e7` and authorised the Sidebar/CommandPalette/Shell group.
The JSON inventory and manual cases above remain the original 1U-source review snapshot. Their
zero-permanent-action-glyph proposal is historical: Diego subsequently retained conventional UX
glyphs (back/forward, collapse/expand, menu, close, search, etc.). The final decision/handover and
DS §1.7 supersede the earlier proposal; nine concrete 1W uses are bounded in the source policy.

Do not overwrite the 1V snapshot after migration. Its original `--check` command applies to that
source base and intentionally becomes stale as sources change. The current migrated scope is
checked by `app/ui/src/admin-icon-policy.test.ts`, using the live scanner; it covers direct,
passed/mapped/dynamic and wrapped/library/native-vector routes. The manual-case test now reads
its exact published 1U source revision, preserving the old review evidence across later groups.
