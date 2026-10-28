# Shared Crate labels — local 1AQ collection

Approved normalization, implemented for Admin and Listen, pending Diego's visual review.
Import by descriptive subpath; no app-specific foundation or separate size recipes.

| Component | Role | Text / geometry | Behavior |
| --- | --- | --- | --- |
| `@crate/ui/primitives/InfoBadge` | Metadata, state, inline counters | JetBrains Mono400,12px/16px;24px high;1px border;3px8px padding;capsule | Static span, semantic `tone` and `surface` variants; `active` is visual emphasis only |
| `InfoBadge variant="counter"` | Standalone numeral, e.g. Sidebar issues | Same24/12 geometry,3px6px padding and tabular numerals | Shared role variant balances the numeral's ink; no local sizing override |
| `@crate/ui/primitives/FilterChip` | Filter toggle or explicit action | Mono12/16;minimum32px fine,44px coarse | Native button; `aria-pressed` for toggle; `variant="action"` omits selection state |
| `@crate/ui/primitives/SegmentedControl` | Exclusive radio/tabs | Same12px and32/44 minimum | Roving focus, arrows/Home/End and disabled skipping remain independent of toggles |
| `@crate/ui/domain/genres/GenrePill` / `GenrePillRow` | Musical identity and provenance | Name and percentage12/16;minimum32/44 | Percent/share/0/100/missing semantics and separate select/remove buttons retained |
| Listen `QualityBadge` | Audio quality tier and source/stream detail | Uses InfoBadge24/12 | Retains tier glyph, color, hi-res glow and quality detail; five tiers + streaming examples in preview |
| Shared `OfflineBadge` | Offline availability | Uses InfoBadge24/12 when boxed | Keeps labeled and compact overlay variants; compact gets an accessible label |

`InfoBadge` tones: neutral/info/success/warning/danger/accent. Surfaces: default/overlay.
The existing artwork overlay background/blur is retained. Short metadata remains sentence case;
format/product labels such as FLAC retain their content. Long string labels retain their full
text in `title`, with max-width/overflow containment. Native tools/AT validation remains phase QA.

CrateChip and CrateBadge are compatibility entries to InfoBadge; historical sm/md requests now
share24px, not two sizes. CratePill delegates static information to InfoBadge and interactive
controls to FilterChip. Shadcn Badge retains six variants and asChild but uses the same static
recipe. These adapters do not implement another foundation. New consumers use the role names.

Categorical form choices remain Select; content navigation keeps shared underlined Tabs.
Do not change generic text-badge/text-label tokens: readouts, axes and the player's14px/8px queue
counter have different roles. No new geometry/font/padding overrides at badge call sites.

Preview: `/badge-normalization-demo.html`, including `#calidad-badges`, and the persistent mockup
`/#badges-compartidos`. Uses real shared components and Listen quality/offline renderers with
fictional sample data, no backend. All earlier checkpoints stay mounted; no canonical baseline
regeneration. Spec: approved badge-legibility-audit; execution: badge-normalization plan.


Los badges compuestos derivan el title completo de texto/children nativos; los controles hijos
mantienen su sitio y no se recortan al truncar el texto. Overlay conserva el color semántico del
icono, incluido el error offline. Título explícito del consumidor tiene prioridad.
Los labels nativos y captions `data-slot="form-field-label"` se muestran en mayúsculas;
controles, ayudas y valores `data-slot="form-field-value"` conservan su capitalización.
Solar vía @crate/ui/icons es el catálogo oficial de nuevo trabajo en ambas apps; la retirada
acotada de Lucide heredado conserva sus dueños/fases. AIButton usa el Bot Outline oficial,
visual20px/slot16px, sin aumentar el botón44px.
La [propuesta de filas](2026-10-19-crate-v3-row-normalization-proposal.md) queda pendiente de
aprobación; no es una migración completada por la normalización de badges.
