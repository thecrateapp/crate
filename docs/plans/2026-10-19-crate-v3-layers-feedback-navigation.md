# 1AX — Layers, feedback and minimum navigation

Approved after1AW publication5ff7296c. Reference: approved5186mockup and later Diego amendments.
Keep5186/6006/5174 active. Stop before commit/push of1AX. No full suites/CI or baseline changes.

## Scope and preflight

Existing shared families: AppModal, AppPopover, AppErrorBoundary, ErrorState, LoadingState and
SkipLink. Complete their six pending English entries before modifying their sources. Reuse
already documented SearchInput, Select, FormField, Button and BackLink. Tabs has the approved1Q recipe but still a pending catalogue entry; document it with its actual URL helper evidence. Other menu/sheet/
dialog/skeleton/navigation families remain with their real H1/H2 consumers; no duplicate kit.

Real Listen consumers: TopBarSearch, CollectionSortDropdown, PlaylistCreateModal/IdentitySection,
AppFallbacks/global AppErrorBoundary and Shell skip. Admin shared consumers receive focused
regressions/bundle checks, without a CommandPalette/page redesign. API contracts, authentication,
playback, artwork transport, recents and preload semantics remain in their apps.

1. Sort adopts canonical Select; playlist visibility adopts Select with associated FormField,
   preserving values/capability gates. Remove local control typography/geometry repairs in the
   touched identity fields and retain their edit/readonly behavior and8px associations.
2. Search adopts SearchInput and AppPopover, active-descendant/listbox wiring, solid shared
   surface and current48px thumbnails. Preserve collapse/hover/recents/results/200ms debounce,
   remote resolution and navigation. Defer API emission during IME; restore trigger focus on
   Escape. Position follows the anchor and stays within the viewport; no per-caller layer fixes.
3. AppModal preserves1N appearance, labels, mobile drag and close gates. Prove nested Select/
   Tooltip behavior; make nested custom modals own only their topmost Escape/Tab/focus and
   retain scroll lock until the last locking modal closes, including out-of-order unmount.
4. Global render fallback composes ErrorState rather than a second raw failure screen. Keep
   report/reset/custom fallback behavior. Route loading/skip keep their existing contracts.
5. Same small scene in Storybook and5186: nested layers/Select/Tooltip, busy/disabled/long options,
   search feedback, loading/error/empty fallback, retry/reset, keyboard/restore/scroll and8px
   fields. Actual Listen browser fixture proves real consumers; URL-tab probe uses the existing
   app-local helper for unknown values/query/hash/history. Pages adopt URL helpers in1AY/H1.
6. Focused Vitest maxWorkers1 and Playwright workers1, types/lint/build/budget/catalogue. One fresh
   source reviewer at the checkpoint. Native/AT/live/canonical phase QA stays pending.

No new runtime dependencies, universal layer library or wholesale Shell/page restyle. Optional
props preserve existing callers. New presentation shared only where both apps genuinely use it.

Diego added the clipped Artist/Genre page regression during this checkpoint. PageHero now stretches
its inner frame through its minimum height, rather than resolving a percentage height against an
auto-sized parent. Cover media/editorial/artist roles and the real Listen ArtistHeroSection and
GenreHero consumers at390/1200; preserve native Album composition and content-height CrateHero.

## Decisiones y cierre local

- Los helpers URL se prueban/corrigen sin migración masiva; coste: adopción por página1AY/H1.
- Se mantiene AppModal/drag y Radix; coste: interoperabilidad acotada y QA nativa pendiente.
- Tabs pasa de pendiente a documentado al necesitarlo esta revisión; coste: una ficha adicional,
  sin nueva API runtime. El brief inicial lo describía erróneamente como documentado.
- La revisión deja fuera comportamientos previos de búsqueda stale/completion y la inertness
  general del modal; coste: esos límites lifecycle/AT quedan para su fase propietaria.

Revisión independiente única: tres importantes, corregidos tras tres regresiones browser fallidas
(3/3 verdes antes de ampliar la cadena): readonly de texto largo, scroll de la opción activa y
escena de búsqueda faltante. La vista de resultados sigue local a Listen, con traducciones y
renderer managed inyectados; ambos hosts reutilizan esa presentación. Ningún hallazgo importante
permanece abierto. [Validación vigente y límites](2026-10-19-crate-v3-current-state.md).
