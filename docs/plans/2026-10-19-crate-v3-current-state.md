# Crate V3 — estado vigente

Actualizado: 2026-10-19. Esta tabla es el punto de entrada para continuar el trabajo. Los
registros cronológicos de los otros planes conservan el estado que tenían en su fecha;
sus stops locales anteriores quedan superados por las aprobaciones y publicaciones posteriores.

| Concepto                | Estado vigente                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace               | `/home/diego/.codex/worktrees/crate-v3-1q/crate`; rama `feat/crate_v3`                                                                                                      |
| Publicado               | 1AQ aprobado por Diego y publicado en el commit de este estado; conserva el ancestro `53177736`                                                                                      |
| Checkpoint local        | **1AQ aprobado**. Storybook R0 en inglés y primer contrato Hairline reconciliado; siguiente bloque: FormField y roles tipográficos (1AR)                  |
| Auditoría               | A1 contraste, A2/A3 tipografía, A4 chips, A7 copy, A6 guardas y A8 estados documentales publicados en 1AP. A5 conserva su deuda explícita por fase, según el orden aprobado |
| Preview                 | `http://127.0.0.1:5186/`, `crate-v3-preview.service`; editor real en `/admin-playlist-editor-demo.html` y `/#editor-playlists-admin`                                        |
| Storybook               | `http://127.0.0.1:6006/?path=/docs/system-introduction--docs`; `crate-ui-storybook.service`; 10 entradas documentadas / 81 pendientes |
| Próximo grupo de iconos | Pausado por Diego: auditar sistema completo y aprobar catálogo/contratos antes de más migraciones                                                                                           |
| Identidad y referencia  | Mockup aprobado5186 y ajustes confirmados de Diego; una identidad, fuentes/excepciones nativas. Pin histórico `app/web@258bbaee` conservado                                                                                                   |
| Evidencia canónica      | 33 PNG y manifest de 1M; comparación Linux posterior y QA nativa pendientes                                                                                                 |
| Cierre pendiente        | Global 1b.8, migraciones de página/A20/6.8, validación completa de fase, datos vivos, AT y plataformas nativas                                                              |
| Restricción             | Publicación de 1AQ autorizada; 1AR se revisa antes de commit. Sin PR, merge, rebase, deploy ni release                                                                                 |

La validación vigente de la extensión de cabeceras/filas se registra al final de este documento;
los resultados cronológicos previos no certifican los cambios posteriores. El bundle permanece
bajo el límite de532480Bgzip. Sin suites/CI completas ni actualización de capturas canónicas.

## A5 — adopción pendiente con dueño y criterio de cierre

No se considera que la migración de iconos haya completado el restyle de cada página. La
reconciliación autorizada asigna esta deuda a sus fases, sin rediseñar ahora todos los paneles.

| Residuo                                                                           | Dueño                                                | Fase                                    | Criterio de cierre                                                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OpsPageHero`, `OpsStatTile`, `OpsPanel`: transparencias de panel, sombras y blur | Mantenedor de Admin UI y design system               | 3.1; adopción por 3.3, 3.5b, 3.6 y 3.9b | Receta compartida de superficie sólida; retirar los tokens heredados registrados y verificar cada consumidor                        |
| Paneles de Bandcamp, Upcoming y ShowCard                                          | Mantenedor de páginas de catálogo de Admin           | 6.5                                     | Mismos tokens sólidos, sin skins locales; conservar acciones, contenido y glifos UX                                                 |
| Paneles de Users y Roles                                                          | Mantenedor de acceso de Admin                        | 6.6                                     | Adoptar la superficie compartida preservando lista, modal ancho, avatares y capacidades reales                                      |
| Playlists, editor y Translations                                                  | Mantenedor de curación/i18n de Admin                 | 6.8 / A20–A21                           | Eliminar paneles heredados y completar estados/tabs por página; conservar reglas, payloads y edición                                |
| Otras utilidades de color y estructuras anteriores en el inventario de Admin      | Dueño de cada página, con revisión del design system | 3.x o 6.x de la página correspondiente  | Clasificar por rol antes de migrar. No confundir tokens semánticos válidos con desviaciones; cerrar mediante pruebas del consumidor |
| Adaptadores que reexportan Select/Popover/skeleton                                | Mantenedor de fundamentos compartidos y Admin        | 3.1 y migraciones de consumidores       | Retirar nombres de compatibilidad cuando no tengan consumidores, sin crear una implementación duplicada                             |

El [registro ejecutable de adopción](../../scripts/design-system/admin-adoption-debt.json)
enumera los archivos y las ocurrencias exactas de las superficies confirmadas, con dueño,
motivo y fase. La guarda rechaza tokens nuevos o más ocurrencias de los existentes. Los
presupuestos anteriores de Listen/shared no se han aumentado. Los 528 candidatos léxicos del
inventario original no son 528 errores ni una autorización para conservar cualquier clase nueva.

## Límites que permanecen abiertos

Los menores anteriores de sticky header de Users y asociación de label visible del Select
compartido siguen registrados para sus consumidores. La presentación de error de lectura de
Playlists y garantías de concurrencia no se han rediseñado. Las muestras y pruebas focalizadas
no certifican backend vivo, imágenes autenticadas, AT, zoom, otros motores o runtime nativo.

La [auditoría con disposiciones](2026-10-19-crate-v3-plan-audit.md) y el
[handover final](2026-10-15-crate-v3-handover.md) contienen evidencia y límites. Se conservan
los checkpoints y registros históricos completos.

## Regla de acciones y formularios — enmienda de 1AQ

Remove y acciones básicas convencionales pueden ser icon-only, con objeto reconocible, nombre
accesible, title y objetivo compartido44px. No vuelven los iconos decorativos junto a etiquetas.
Category, Match y Sort usan Select en creación y edición (7sitios); los filtros y toggles
conservan chips. La guarda registra los sitios y cardinalidades exactos.

El [inventario de acciones](2026-10-19-crate-v3-admin-action-icons.md) identifica42sitios:
4aplicados,23propuestas,15existentes para alinear en sus fases. Las propuestas se revisan antes
de implementarse; no equivalen a una autorización de migración masiva.1AQ continúa sin commit.

Revisión independiente final de1AQ: sin Critical/Important/Minor pendientes. El único menor
de la muestra (IDs de fila repetidos al añadir dos veces) se corrigió con regresión. Los nueve
límites revisados están resueltos como disposiciones explícitas en el handover; no se considera
cerrada la fase ni su QA. **Detenido para revisión de Diego, sin commit/push de1AQ.**

### 1AQ search and form-height feedback — 2026-10-19

The editor search icon was displaced14px because its wrapper stretched to stacked scope chips.
Search scope now uses shared Select with the same values/callback/query and static-mode gate;
two Field recipes retain8px label gaps. Search copy reflects the selected scope. This eighth
amended form Select site is registered explicitly (editor7total shared Select consumers).
Diego then confirmed the input/Select height mismatch in the other editor rows. Six Input-only
min-h-11 overrides are removed, including range/text rule values: both controls use the shared
40px fine-pointer/44px coarse-pointer form geometry. Creation already used that geometry and
is covered by the same regression checks. Basic action buttons retain their44px targets.
No shared runtime, backend, hook, data, playback, canonical or pin change. Still the same local
1AQ, stopped before commit; previewactive5186. Final evidence follows in the current handover.

Final feedback validation: 52 affected Admin unit/policy cases and8short-Select policy cases
GREEN;7geometry/workflow browser cases (1310/768/390 fine,390coarse and creation1440/768/390)
and4builtAdmin editor capability/payload cases GREEN. Strict scoped types/lint and Admin build
pass; initial JS526295Bgzip/532480, margin6185B,9assets. AST122/66/94contracts unchanged
with the explicit scope-adapter disabled-gate equivalence. Current42action anchors/hashes
refreshed; historical1V/canonical1M untouched. Same-seat read-only delta review has no remaining
findings; its sole test-fixture premise Minor was corrected (12/12GREEN) without changing the
production default. IAB proof: checkpoint-1aq-form-heights.png and checkpoint-1aq-search-corrected.png.
The pre-existing async-loading scope default can differ from a synchronous mock; preserved here.
No live/backend/native/AT/fullsuite/CI certification. Preview remainsactive5186; stop1AQ
UNCOMMITTED for Diego, preserving all earlier checkpoints and original open owning-phase debt.

### 1AQ responsive rule row feedback — 2026-10-19

Campo, Operador y Valor comparten fila cuando la tarjeta dispone de 576 px; se apilan por debajo
de ese ancho. La condición usa el contenedor real de cada regla en creación y edición, evitando
el breakpoint de viewport que apilaba los campos dentro del iframe pese a tener espacio. Se
conservan las columnas 180 px / 160 px / resto, los 8 px bajo etiquetas, las alturas compartidas,
los glifos y todas las acciones/datos. Continúa el mismo 1AQ local sin commit, preview activo.

### 1AQ header standard and applicability — 2026-10-19

Diego approved compact header actions at the upper right, without border/permanent fill, using
shared Button ghost/icon-lg44px, Tooltip and descriptive accessible names. PlaylistEditor moves
Back outside identity, aligns its112px cover with copy, and uses Copy/Eye/ListRestart/Save with
existing callbacks, smart/static gates and busy states. Header layout follows available width;
Save + generate keeps its dynamic name. The later question about arrow-only Back is recorded
as a proposal; the actual Back text/destination remain unchanged.
The [standard and18-page applicability audit](2026-10-19-crate-v3-admin-header-actions.md) records
1applied reference,10Refresh candidates,6workflow adaptations and1page without actions. Other
headers are analysis only. The action inventory is now45sites:8applied,22proposed,15owning-phase;
current scan163lexical candidates/52files, including Preview. No historical1V/1M rewrite.
Keep the same local1AQ review stop, no commit/push or next group; preview remainsactive5186.

Final local evidence after rule/header/standard feedback: 63 affected Admin unit/policy cases
GREEN (new toolbar13/13 after removing unsupported Testing Library exact options),11real-editor
preview cases GREEN including exact1464host iframe and five responsive/focus/tooltip cases,
4builtAdmin gate/payload cases GREEN. Earlier creation-rule geometry3/3 remains valid; no new
production change there after its check. Strict scoped types/lint and Admin build pass. Bundle
526326Bgzip/532480, margin6154B,9initialassets. AST122non-render/66API-hook/94bindings unchanged
with the previously recorded scope-adapter gate equivalence. Header adds four specifically
registered UX sites (editor20direct, whole reviewed scope123), no new shared runtime.
Same-seat read-only review: no actionable production/standard defects; one documentary Minor
(Logs Refresh line anchor) repaired to338 and all header action anchors rechecked as exact
visible text or quoted action labels. Current action inventory45sites/8applied/22proposed/15
existing,13glyphfamilies; header applicability18files and hashes validated. No proposal was
implemented in another header; Back glyph-only remains a recorded proposal from a question.
IAB proof: checkpoint-1aq-header-standard.png and checkpoint-1aq-rule-row.png. Previewactive
5186/HTTP200; original phase/native/AT/live/canonical limits remain. Stop same1AQ UNCOMMITTED.

### 1AQ — migración autorizada de todas las cabeceras y filas de playlists

Diego autorizó aplicar el patrón a las18cabeceras inventariadas antes de otro grupo, y después
lo extendió a las3acciones de las filas de playlists. Esto supera las notas anteriores de
«otras cabeceras solo propuestas». PageHeaderLayout/Actions/Action es una composición de Admin
de Button/Tooltip existentes:38sitios de acción en17páginas; Roles adopta solo la composición
read-only. Ocho OpsPageHero hacen opt-in; Tasks/Insights/Genres mantienen el default anterior.
Glifos distintos y nombres precisos por trabajo, busy/disabled/pressed y capacidades preservados.

Las filas usan Pencil/Power/PowerOff/Trash2, ghost44px sin borde. Tooltips solo Edit, Activate/
Deactivate y Delete; aria-label conserva el objeto. Se corrige el padding duplicado Card24px +
fila16px: ahora solo16px. Sin hover de fondo en filas. Navegación, stopPropagation y confirmación
textual permanecen. Back de Editor sigue con texto fuera de la identidad: la consulta sobre
icon-only no lo cambió. Los inventarios tienen71sitios/45aplicados/11propuestos/15en su fase,
y18cabeceras con líneas/hashes actuales. Las demás propuestas no están implementadas.

AST18/18: non-render, hooks/API y todos los bindings nativos iguales; gates de capacidad/render
previos conservados. Solo cambian gates de presentación del glifo. Pruebas y evidencia final
focalizadas siguen abajo. Misma parada1AQ sin commit/push ni siguiente grupo; preview5186activo.

### Validación final de la extensión 1AQ — 2026-10-19

-307/307casos Vitest en30archivos afectados, serial `--maxWorkers=1`.
-80casos de preview de cabeceras/Editor/Playlists cubiertos:79pasaron en el lote final; el caso
 de tooltip deshabilitado se corrigió para esperar la salida real de Radix y pasó en los3anchos
 con3repeticiones (9/9). Otros45casos de checkpoints afectados:40pasaron inicialmente y5/5tras
 corregir un selector de badges que incluía wrappers y la espera del iframe persistente.
-26/26casos sobre el build de Admin en7archivos seleccionados: rutas/capacidades, consultas,
 mutaciones, confirmaciones y contratos de creación/edición; Playwright `--workers=1`.
-Tipos estrictos de cambios/pruebas y lint focalizado verdes. Build/budget inicial de Admin:
 **526396Bgzip/532480**,8assets,margen6084B. AST18/18conserva código no visual, hooks/API,
 bindings nativos y gates previos. Hashes/anchors de18cabeceras y71sitios únicos verificados.
-Revisión independiente: tooltip de acciones disabled corregido con prueba RED→GREEN; trigger
 estable mantiene el mismo Button nativo y relación `aria-describedby`. Las10pruebas anteriores
 de Ops se conservan junto con las2nuevas. Sin hallazgos nuevos pendientes del pase.

Rulings: Tasks/Insights/Genres conservan el default por quedar fuera de las18cabeceras
inventariadas; esas3migraciones siguen pendientes en su fase. La evidencia focalizada no
certifica backend vivo, AT, motores adicionales ni plataformas nativas; problemas específicos
podrían aparecer en la QA de fase. Se conservan el pin258bbaee,33PNG/manifest1M y todos los
checkpoints. Sin suites completas, CI, nuevos baselines, commit/push ni siguiente grupo.
Preview `crate-v3-preview.service` activo en5186. **Parada local1AQ para revisión**.

La discusión posterior de legibilidad de chips es una propuesta de diseño y no modifica el
runtime. Véase el [inventario de familias](2026-10-19-crate-v3-badge-legibility-audit.md).


### Estado más reciente: normalización compartida y auditoría de filas

Diego aprobó implementar la colección InfoBadge/FilterChip junto a GenrePill y SegmentedControl:
InfoBadge24px/12px, controles12px/32–44px; QualityBadge y OfflineBadge usan la base. Esto supera
la nota histórica anterior de «propuesta de chips sin runtime». Ejemplos reales en
`/badge-normalization-demo.html#calidad-badges` y `/#badges-compartidos`.
También autorizó acciones icon-only en Incoming, labels de formulario en mayúsculas y Solar
como iconset oficial para nuevo trabajo. Bot Outline visual20px en slot16px, sin cambio de
geometría del botón; estado loading conserva su spinner. ShowCard no ha cambiado en esta
ampliación: permanece desplegable. Incoming release adopta avatar88px y todos sus badges debajo.
El distinto tamaño de fecha de show/release NO se considera ya normalizado.

Diego detectó después diferencias entre familias de filas y pidió **análisis/propuesta antes
de migrar**. El [análisis de filas](2026-10-19-crate-v3-row-normalization-proposal.md) explica el
CSS del mockup que compensa HairlineRow y presenta arquitectura, contratos y orden. Inventario
AST en `crate-v3-analysis/rows-1aq.json`. Esa propuesta todavía no está implementada ni aprobada;
no afirmar que1AQ cierre esta deuda. Preview5186activo; misma rama y stop sin commit/push.

La revisión independiente de la colección detectó recorte de controles en badges compuestos,
falta de título completo y pérdida de color del icono offline: corregidos con regresiones
RED→GREEN. Revisión de la ampliación: valores de pistas heredaban mayúsculas del label;
corregido con marca semántica y prueba de estilo calculado. El caso de artista largo y la
comparación de fechas se incorporan al nuevo contrato propuesto de filas. La guarda regex de
Listen aún no cubre todos los aliases/prefijos responsive: menor registrado, sin afirmar una
prevención exhaustiva. La evidencia final de tipos/bundles/pruebas se refresca por alcance;
los totales anteriores no certifican automáticamente las ampliaciones posteriores.


### Pausa solicitada: reconciliación global de componentes

Diego amplía el análisis de filas al sistema completo: revisar lo existente y lo definido,
proponer el catálogo antes de seguir construyendo. Se detienen migraciones/pantallas nuevas.
La [auditoría y catálogo propuesto](2026-10-19-crate-v3-component-reconciliation-audit.md)
contiene10familias de hallazgos/disposiciones, catálogo por responsabilidades y ordenR0–R4;
la propuesta de filas queda integrada. Inventario AST:1.069archivos,92módulos visuales y
2.271sitios shared (414glifos);727ajustes léxicos candidatos, no727defectos. Confirmación DOM:
HairlineRow sin ayuda tiene inset0; ejemplo1B compensa con12px/text-left desde CSS del mockup.
Ni el catálogo ni la migración se consideran aprobados/implementados por existir estos docs.
Previewactivo;1AQsin commit/push. No se avanza con retirada de iconos hasta resolver esta pausa.


Evidencia de la ampliación previa1AQ conservada al iniciar la pausa:4typechecks de app/shared
verdes; tipos de preview separados por contexto de alias Admin/Listen verdes.8archivos Admin
89/89; Listen20archivos261/263y los2casos de localizar el span exterior corregidos,123/123en
sus2archivos; shared11archivos127/127. Incoming13/13, lote previo22casos con18pasadasy4selectores corregidos de Upcoming; Incoming13/13posterior y regresión
de herencia de label1/1. Builds/budgets:Admin526389/532480Bgzip(9assets),Listen199953/307200
(23assets). No suites completas. El build es verificación técnica del trabajo local, no inicio
de una migración nueva. Datos vivos/AT/nativo/CI/canónicas siguen pendientes.

Último lote focalizado antes de detener las migraciones:23/23casos Playwright de Incoming,
controlesAIy colección/labels verdes, workers1. Lint del alcance verde; cn.test conserva una
expresión constante preexistente que el config de Admin señala: se documentó la excepción del
run diagnóstico de ese archivo, sin cambiar la regla del repositorio. El catálogo global y la
propuesta de filas están revisados y pendientes de decisión de Diego; ninguna nueva migración
se implementó por esas propuestas.


Requisito posterior de Diego: integrar un playbook/showcase mantenido en Git y la documentación
viva del sistema de diseño en R0. Toda alta/modificación de componente actualiza su entrada.
Propuesta de plataforma: Storybook React/Vite, aislado de las entradas y bundles de producción;
sección final de la auditoría de reconciliación. No se ha instalado ni aprobado el diseño
completo del tooling. Preview5186/checkpoints conservados;1AQsin commit/push.


### 1AQ — Storybook R0 y primera reconciliación de HairlineRow

Diego autorizó montar el catálogo, después pidió inglés, identidad propia y categorías funcionales.
Storybook 10.6.2 está activo en `http://127.0.0.1:6006/`, con fuentes locales y tema obtenido de
CRATE_IDENTITY_VARIABLES. El preview histórico en 5186 sigue activo y enlaza el catálogo.
Registro: 91 entradas / 118 fuentes; 10 documentadas y 81 pendientes, clasificadas por propósito.
Las stories tienen IDs estables: moverlas de categoría conserva URLs y pestañas abiertas.

Toda alta o cambio visual compartido actualiza entrada, contrato/escenario y pruebas en el mismo
cambio. Hook sobre el índice de Git, test compartido y guarda del workflow existente con SHA base
explícito. Rechaza metadata inválida, fuentes sin ficha, huellas obsoletas, refresh de pendientes
y downgrade de documentado a pendiente. La revisión semántica sigue siendo humana.
Storybook/addons solo son devDependencies; no cambian exports, peers ni imports de producción.

Después de revisar esa base, Diego autorizó empezar la reconciliación por HairlineRow. El layout
compartido aporta ahora 12 px horizontales y alineación izquierda, tanto en filas simples como en
hijos link/button. Se retiran esas ayudas de .rows-preview/.focus-rows. Texto multiline sin espacios
se envuelve; el truncado conserva su comportamiento. Se mantienen 10 px verticales, gap 14 px,
mínimos 32/44, índices/trailing, refs, callbacks, semántica y señal activa 2 px.
Solo cambia una fuente visual de producción en este segundo bloque. El consumidor real actual es
el setlist expandido de Listen; Admin todavía debe adoptarlo. No se han migrado otras familias.

Evidencia R0: 122 casos de componentes y 24 de guardas verdes; 12 casos de navegador del catálogo,
tipos/build/lint. Revisión independiente cerró tres huecos de enforcement y la muestra Poppins,
con RED→GREEN. Menor explícito: props interactivos/modo tabs de SegmentedControl pendientes.
Evidencia Hairline: 33 shared/política, 15 del consumidor Listen y 18 de Storybook verdes.
Los 3 casos afectados del preview histórico pasaron; se repitieron los 2 de composición y
selección tras el ajuste tipográfico. La regresión nueva reprodujo padding 0 y desbordamiento de 2419 px en
una fila de 280 px antes del arreglo. La revisión independiente no encuentra defectos de runtime
Critical/Important; menor de cobertura hover del hijo nativo conservado en el registro de tarea.

[Tooling y decisiones](2026-10-19-crate-v3-storybook.md),
[primer contrato reconciliado](2026-10-19-crate-v3-hairline-reconciliation.md) y
[guía obligatoria](../../tools/crate-ui-showcase/README.md).
No se certifica adopción completa, datos vivos, AT o runtime nativo. Se conservan pin258bbaee,
33 PNG/manifest1M y todos los checkpoints; sin suites completas ni ejecución de CI.
**1AQ permanece local para revisión, sin commit/push.**


Validación final de esta primera R1: tipos shared/Listen/showcase y builds shared/Listen/Admin/
Storybook verdes; lint focalizado verde. Admin **526383/532480 B gzip**, margen 6097 B, 9 assets;
Listen **199948/307200 B**, 23 assets. Fixture TS2353 corregida con tipo de mapa explícito y sus
2 pruebas verdes. Correspondencia de catálogo y aislamiento de runtime verificados; fuentes
estáticas locales presentes en el build. Muestras de revisión en
`.artifacts/review/checkpoint-1aq-hairline-reconciled.png`. Sigue la parada local1AQ sin commit.


### Fuente de verdad visual confirmada por Diego

El mockup aprobado en 5186, con sus ajustes posteriores confirmados, fija la referencia visual.
Shared y Storybook deben reproducirlo. Dudas, desviaciones y conflictos de tamaños en móvil se
ponen en común con Diego antes de elegir otra presentación. El pin histórico 258bbaee se conserva;
no se sustituye silenciosamente. La herencia 16/24 de Hairline frente a 12/18 del mockup se confirmó
como drift: el componente fija Poppins 400 a 12/18 px. Diego confirmó expresamente **12/18 también
en móvil**, por legibilidad; se retira la reducción histórica a 11 px. Los objetivos táctiles
siguen con mínimo 44 px en punteros coarse. El ajuste tipográfico posterior a la revisión
independiente está verificado con regresiones de estilos calculados y comparación visual/DOM
entre ambos previews; no se atribuye al revisor del delta anterior.


### Aprobación y publicación de 1AQ — 2026-10-19

Diego aprueba 1AQ y autoriza commit/push en feat/crate_v3. Se conserva todo el checkpoint,
Storybook en inglés, las categorías funcionales, el mantenimiento obligatorio y HairlineRow
a 12/18 px también en móvil. Los stops locales anteriores son registros históricos superados
por esta aprobación. Siguiente alcance autorizado: FormField y roles tipográficos, con el
mockup aprobado como referencia; ambos previews activos y parada en 1AR antes de commit.
No se reanuda la migración de pantallas ni se declara cerrada la QA de fase.
