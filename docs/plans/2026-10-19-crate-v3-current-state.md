# Crate V3 — estado vigente

Actualizado: 2026-10-19. Esta tabla es el punto de entrada para continuar el trabajo. Los
registros cronológicos de los otros planes conservan el estado que tenían en su fecha;
sus stops locales anteriores quedan superados por las aprobaciones y publicaciones posteriores.

| Concepto                | Estado vigente                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace               | `/home/diego/.codex/worktrees/crate-v3-1q/crate`; rama `feat/crate_v3`                                                                                                      |
| Publicado               | 1AX aprobado y publicado: `5bc683d8`; plan Listen aprobado; conserva el ancestro `53177736`                                                                                  |
| Checkpoint local | **1AY aprobado por Diego**; autoriza commit/push y1AZ. Shell, búsqueda, colección y enmiendas aprobadas durante la iteración; detalle y validación al final |
| Prioridad de continuación | **Listen primero**, por indicación de Diego; después se retoman las migraciones específicas de Admin. Inventario y plan por recorridos aprobados.           |
| Revisión actual | `http://127.0.0.1:5186/review-1ay-shell.html`; misma escena real en Storybook `Reviews/1AY/Shell`; Listen vivo en5174 |
| Auditoría               | A1 contraste, A2/A3 tipografía, A4 chips, A7 copy, A6 guardas y A8 estados documentales publicados en 1AP. A5 conserva su deuda explícita por fase, según el orden aprobado |
| Preview                 | `http://127.0.0.1:5186/`, `crate-v3-preview.service`; editor real en `/admin-playlist-editor-demo.html` y `/#editor-playlists-admin`                                        |
| Storybook | `http://127.0.0.1:6006/?path=/story/reviews-1ay-shell--complete`; `crate-ui-storybook.service`;53entradas documentadas/40pendientes |
| Próximo grupo de iconos | Pausado por Diego: auditar sistema completo y aprobar catálogo/contratos antes de más migraciones                                                                           |
| Identidad y referencia  | Mockup aprobado5186 y ajustes confirmados de Diego; una identidad, fuentes/excepciones nativas. Pin histórico `app/web@258bbaee` conservado                                 |
| Evidencia canónica      | 33 PNG y manifest de 1M; comparación Linux posterior y QA nativa pendientes                                                                                                 |
| Cierre pendiente        | Global 1b.8, migraciones de página/A20/6.8, validación completa de fase, datos vivos, AT y plataformas nativas                                                              |
| Restricción             | 1AX publicado5bc683d8. Parar en1AY para revisión antes de commit/push. Sin PR, merge, rebase, deploy ni release                                                                                 |

La validación vigente de la extensión de cabeceras/filas se registra al final de este documento;
los resultados cronológicos previos no certifican los cambios posteriores. El bundle permanece
bajo el límite de532480Bgzip. Sin suites/CI completas ni actualización de capturas canónicas.

## A5 — adopción pendiente con dueño y criterio de cierre

No se considera que la migración de iconos haya completado el restyle de cada página. La
reconciliación autorizada asigna esta deuda a sus fases, sin rediseñar ahora todos los paneles.

| Residuo                                                                      | Dueño                                                | Fase                                    | Criterio de cierre                                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OpsPageHero`, `OpsStatTile`: transparencias de panel, sombras y blur        | Mantenedor de Admin UI y design system               | 3.1; adopción por 3.3, 3.5b, 3.6 y 3.9b | Receta compartida de superficie sólida; retirar los tokens heredados registrados y verificar cada consumidor                        |
| Paneles de Bandcamp, Upcoming y ShowCard                                     | Mantenedor de páginas de catálogo de Admin           | 6.5                                     | Mismos tokens sólidos, sin skins locales; conservar acciones, contenido y glifos UX                                                 |
| Paneles de Users y Roles                                                     | Mantenedor de acceso de Admin                        | 6.6                                     | Adoptar la superficie compartida preservando lista, modal ancho, avatares y capacidades reales                                      |
| Playlists, editor y Translations                                             | Mantenedor de curación/i18n de Admin                 | 6.8 / A20–A21                           | Eliminar paneles heredados y completar estados/tabs por página; conservar reglas, payloads y edición                                |
| Otras utilidades de color y estructuras anteriores en el inventario de Admin | Dueño de cada página, con revisión del design system | 3.x o 6.x de la página correspondiente  | Clasificar por rol antes de migrar. No confundir tokens semánticos válidos con desviaciones; cerrar mediante pruebas del consumidor |
| Adaptadores que reexportan Select/Popover/skeleton                           | Mantenedor de fundamentos compartidos y Admin        | 3.1 y migraciones de consumidores       | Retirar nombres de compatibilidad cuando no tengan consumidores, sin crear una implementación duplicada                             |

El [registro ejecutable de adopción](../../scripts/design-system/admin-adoption-debt.json)
enumera los archivos y las ocurrencias exactas de las superficies confirmadas, con dueño,
motivo y fase. La guarda rechaza tokens nuevos o más ocurrencias de los existentes. Los
presupuestos anteriores de Listen/shared no se han aumentado. Los 528 candidatos léxicos del
inventario original no son 528 errores ni una autorización para conservar cualquier clase nueva.

## Límites que permanecen abiertos

El menor anterior de sticky header de Users sigue registrado para su consumidor. 1AR corrige
la asociación del label de FormField con AdminSelect, tanto normal como searchable; la adopción
de esos contratos en las páginas restantes sigue pendiente por fase. La presentación de error de lectura de
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

### 1AR — familia completa de formularios (local, antes de commit)

Diego amplió el bloque a todos los componentes de formulario juntos: FormField, Input,
Textarea, SearchInput, Select, AdminSelect, Checkbox, Switch, RadioGroup, SegmentedControl,
FilterChip y Slider general. Storybook contiene sus contratos, props reales, estados y ejemplos
compuestos; Readout y la leyenda de StatNumber conservan sus roles explícitos. No se restilan
cabeceras ni se migra toda la aplicación por esta entrega.

El mockup sigue como referencia y no recibe nuevas secciones ni muestras. Diego detectó controles
auxiliares nativos: se reemplazaron 18 checkboxes y un input ya existentes por componentes reales,
conservando las acciones de sus fixtures. Hay una guarda AST que impide añadir controles nativos
en esas escenas y 14 pruebas de navegador que comprueban los controles y callbacks compartidos.

FormField incorpora layout horizontal para Checkbox/Switch: control primero, caption Poppins
400 a 14/20 px a la derecha, siguiendo la muestra aprobada. El apilado mantiene Mono 400 y 8 px
reales. Se corrigen asociación de grupos/AdminSelect, readonly/IME de SearchInput, peso heredado,
radio con tono/área táctil comunes y opciones largas sin recorte. El Slider nativo se adopta en
Settings de ambas apps; reproducción/EQ conservan sus controles especializados.

Se preservan los checks completos de fase, QA nativa/AT, datos vivos y canónicas para su cierre
correspondiente. [Plan y evidencia de 1AR](2026-10-19-crate-v3-forms-reconciliation.md).
Ambos previews permanecen activos; **1AR no se publica antes de la revisión de Diego**.

## 1AR — familia de formularios lista para revisión local

Las12familias de formulario tienen entradas reales en Storybook: FormField, Input, Textarea, SearchInput, Select, AdminSelect, Checkbox, Switch, RadioGroup, SegmentedControl, FilterChip y Slider. Readout y los roles de valores/ayudas completan el bloque. Mockup aprobado y ajustes confirmados siguen siendo referencia; no se añadieron muestras al mockup. Sus18checkboxes y1input auxiliares ahora usan componentes compartidos, con guarda AST y14pruebas de escena. FormField ofrece stacked/inline y caption de grupo; los espaciados/roles viven en el componente/receta.

Validación:207pruebas unitarias focalizadas y60casos browser distintos; tipos shared/Listen/Admin/Desktop/Storybook y builds shared/Listen/Admin/Storybook verdes; lint52archivos y guarda21/92/119verdes. Admin526410/532480Bgzip (6070Bde margen); Listen199942/307200B. Revisión independiente sin Critical/Important; un Minor de borde en radio checked+aria-invalid individual queda en el [plan1AR](2026-10-19-crate-v3-forms-reconciliation.md), con responsable y cierre. Invalid de grupo correcto.

Ambos previews activos; composición en `http://127.0.0.1:6006/?path=/story/patterns-forms--complete`. La adopción global de páginas/cabeceras, QA de backend vivo/AT/nativa y comparación canónica permanecen pendientes.1AR sin commit/push, detenido para Diego.

### Corrección de etiquetas de 1AR

Diego confirmó que MonoLabel siempre va en mayúsculas y que las etiquetas de checkbox no son otra familia. Se elimina la excepción inicialPoppins14/20: FormField stacked/inline compone el mismo MonoLabel (Mono400uppercase11/15.4, caps tracking y color subtle). Inline solo cambia posición. Las3muestras antiguas de checkbox/switch en1O usan MonoLabel: los2checkboxes adoptan FormField y el switch conserva su posición original; sin añadir escenas. Esta corrección prevalece sobre cualquier nota anterior que describa una etiqueta lateral Poppins como aprobada.

Tras esta corrección, las pruebas de tipografía comparan igualdad real de estilos entre etiquetas laterales y etiquetas de campos. Pasan 22 casos de Storybook, 15 de mockup y los consumidores afectados. Builds y guarda verdes. Bundle vigente: Admin **526402 / 532480 B gzip**, Listen **199955 / 307200 B**. Ambos previews activos; 1AR continúa sin commit/push.

MonoLabel resuelve `uppercase` desde el componente, después de las clases del consumidor: `normal-case`, `lowercase` y `capitalize` no sustituyen ya su utilidad de mayúsculas. La transformación es CSS; conserva el texto original. Contrato y muestra en Storybook,27pruebas unitarias y7browser focalizadas verdes, tipos/lint/guarda verdes.1AR permanece local.

### Regla vigente: una vista pequeña por paso

Diego sustituye las revisiones acumulativas en el mockup grande por una página aislada en cada paso, limitada a lo que se está probando. Se conserva el mockup histórico como referencia, sin nuevos bloques. La escena se comparte con Storybook y usa componentes reales; el inventario/documentación sigue siendo obligatorio. Regla en los AGENTS de preview/showcase y en shared.

Vista actual: `http://127.0.0.1:5186/review-1ar-labels.html`. El texto “First Song · FLAC” estaba marcado erróneamente como valor; se retira ese marcador de la etiqueta y se prueba la capitalización del texto visible. El input mantiene su valor mixto. Cinco casos browser focalizados y la guarda de componentes pasan; tipos, lint y ambos builds de herramientas pasan. No se cambian los valores reales ni las recetas de datos. Ambos previews activos,1AR local sin commit/push.

### La vista aislada cubre el checkpoint completo de 1AR

La vista anterior solo mostraba las etiquetas. Diego señaló que faltaban Slider y otros controles: el alcance aprobado de 1AR sigue siendo la familia completa de12formularios, con sus roles tipográficos. La revisión actual incorpora FormField, Input, Textarea, SearchInput, Select, AdminSelect, Checkbox, Switch, RadioGroup, SegmentedControl, FilterChip y Slider; añade estados disabled/readonly/invalid/indeterminate y los Readout/StatNumber revisados. No son migraciones de nuevas páginas.

URL principal `http://127.0.0.1:5186/review-1ar-forms.html`; la URL anterior `review-1ar-labels.html` monta la misma vista. Scene única `reviews/FormsReview.tsx`, Storybook `Reviews/1AR/Forms`, conservando su meta.id anterior para mantener enlaces. Antes de compartir un paso se compara su inventario con todo el alcance aprobado del checkpoint.

Regresión de cobertura: fallaba por ausencia del slider antes de ampliar. Pasan5casos browser (alias antiguo más página/Storybook × móvil/escritorio), con teclado de slider, búsqueda, portales y selección, filtros/modos, estados,8px de gap y40/44px. Guarda, tipos, lint y builds de herramientas verdes. El acceso visual manual de este turno fue rechazado por la política de navegador con motivo de protocolo no permitido; no se genera ni se atribuye una nueva captura. Las pruebas browser se completaron antes de ese rechazo. Ambos servicios activos;1AR continúa sin commit/push.

### Aprobación de 1AR

Diego aprueba la familia completa de formularios y autoriza commit/push de 1AR. La evidencia y los límites anteriores se conservan; no se repiten suites completas. El siguiente checkpoint será 1AS, acciones compartidas según el orden R1 de la reconciliación, con referencia en el mockup, actualización de Storybook y vista aislada. Ambos previews permanecen activos.

### 1AS — acciones compartidas, listo para revisión local

1AR publicado en `a3ba497ddfdf05835441686fbd8c874c07e4cea6`. 1AS completa Button/IconButton, la composición ActionGroup/ActionButton/ActionLink y la ficha de compatibilidad ActionIcon. El patrón aprobado de cabecera pasa a shared; Admin conserva sus alias y enlaces asChild, y Listen adopta Remove en servidores. Las áreas táctiles44px ocupan espacio real. Estados unavailable/loading bloquean navegación/callbacks y los tooltips conservan las descripciones accesibles.

Revisión pequeña: `http://127.0.0.1:5186/review-1as-actions.html`; misma escena en Storybook `Reviews/1AS/Actions`. Catálogo25/93/120. Pasan125pruebas unitarias focalizadas y15casos browser, tipos/lint/builds de herramientas y apps. Admin527150/532480Bgzip; Listen200102/307200B. Revisión independiente sin bloqueos; discrepancia documental de radio corregida a4px. Evidencia/límites en el [plan1AS](2026-10-19-crate-v3-actions-reconciliation.md). Ambos previews activos. **1AS sin commit/push, detenido para Diego.**

### Aprobación de 1AS

Diego aprueba 1AS y autoriza commit/push. Siguiente grupo1AT: superficies y contenedores según R1, con el mockup como referencia, catálogo actualizado y vista aislada; detener antes de commit. Solicita además un análisis paralelo documentado de agrupaciones para checkpoints posteriores.

## 1AS publicado; 1AT — superficies y contenedores

1AS publicado en `9b5356862db1cef1d014c0b56c7a7e61bd7cad18`. 1AT distingue Card como
objeto sólido (surface-object, radio14, slots24, título Poppins16/24) e InstrumentPanel como
sección sin relleno (regla1, inset22 y separación de cabecera20). Se completan semántica nativa,
descripción, acciones y nombres accesibles. Separator conserva orientación y ARIA. Las variantes
card de controles usan la superficie sólida; sus contratos de tamaño siguen diferenciados.
Admin OpsPanel delega al panel compartido y Listen Settings Section delega su descripción.
OpsPageHero/StatTile y las demás adopciones A5 permanecen pendientes; no se declara A5 cerrada.

Diego detectó una composición incorrecta en la propia review: captions sueltos con gap0 y mezcla
de IconButton40 con ActionIconButton36. Las escenas 1AS/1AT usan ahora FormField kind=group para
captions de muestras, con8px reales y grupos nombrados. El ejemplo sobre artwork usa dos
IconButton card equivalentes (40px fine /44px coarse, glyph18), sin overrides. La galería
explícita de compatibilidad conserva sus tamaños. Una regresión reprodujo los dos fallos antes
de corregirlos; las medidas de composición se verifican en ambos hosts y quedan en sus AGENTS.

Revisión: `http://127.0.0.1:5186/review-1at-surfaces.html` y Storybook `Reviews/1AT/Surfaces`.
Sin nueva sección en el mockup grande. [Plan y evidencia](2026-10-19-crate-v3-surfaces-reconciliation.md).
El [documento solicitado de grupos](2026-10-19-crate-v3-component-checkpoint-groups.md) propone
cabeceras, imágenes/identidad, eventos/fechas, entidades, colecciones, métricas, estados, capas,
menús y navegación. Es una propuesta, no autorización de todas las migraciones. Incluye la deuda
de la guarda de exports: su uso combinado no demuestra adopción en ambas apps.

Validación focalizada:81pruebas unitarias (41shared,36Admin,4Listen),21casos browser de superficies
/acciones y2del editor real;25guardas focalizadas, tipos shared/Storybook, lint, catálogo28/93/120 y builds de ambas apps
y herramientas verdes. Admin527161/532480Bgzip (5319Bde margen); Listen200102/307200B. Una revisión
independiente detectó el gap ausente de acciones en fragmentos de OpsPanel: corregido en el slot
compartido y probado con los4botones reales a390/1200. Backend vivo, AT, otros motores/native,
validación completa de fase y comparación canónica siguen pendientes. No se genera captura
manual tras el rechazo de protocolo del navegador. Ambos servicios activos; **parada1AT antes
de commit/push**.

### Aprobación de 1AT

Diego aprueba1AT y autoriza commit/push. Continúa1AU con PageHeader, SectionHeader, PageHero,
HeroActionBar y BackLink, usando el mockup como referencia y actualizando Storybook y la vista
pequeña del checkpoint. Ambos previews permanecen activos;1AU se detiene antes de commit/push.


## 1AT publicado; 1AU — familia de cabeceras

1AT publicado en `67486e4c7414d7c6bca7a6701b35c73440f0dfce`. 1AU completa PageHeader y su
PageHeaderLayout, SectionHeader, PageHero, HeroActionBar y BackLink con contratos reales en
Storybook. PageHeader posee h1 Bricolage60024/30, contexto MonoLabel, subtítulo, artwork y
metadata; SectionHeader usa Bricolage70018/24/30 y contador Mono12, incluido0. Los captions de
muestra usan FormField con8px reales. Acciones upper-right conservan ActionGroup y44px.

Admin PageHeaderLayout es un adaptador al layout compartido. PlaylistEditor usa la identidad,
metadata y BackLink comunes sin cambiar acciones, estados, gates o payloads. Back conserva su
texto/destino; su glyph ahora procede de Solar compartido, registrado en la guarda de iconos.
Listen Settings conserva PageHeader; AlbumHero usa su título compacto24/36 compartido. CrateHero
adopta height=content y el mismo título compacto para conservar el tamaño por contenido de las
crates vacías. No se migra todo Admin, ni OpsHero/tiles, perfiles, portadas o reproducción.

La revisión independiente confirmó dos P2: los mínimos nuevos imponían460px al hero vacío y
las acciones largas desbordaban280px en escritorio. Se reproducen antes del fix y se corrigen
en las recetas compartidas, con casos de consumidor/viewport. También se reproducen y corrigen
los gaps de fragmentos:8px entre acciones y16px antes del error de generación. Las captions no
usan margins locales. El contrato de cuerpo respeta la variable de fuente nativa; esto no
certifica ejecución nativa. Los controles de reproducción conservan su papel48px mínimo/56px;
las etiquetas largas pueden aumentar su altura.

[Review pequeña](http://127.0.0.1:5186/review-1au-headers.html), Storybook `Reviews/1AU/Headers` y
[plan/evidencia](2026-10-19-crate-v3-headers-reconciliation.md). Misma escena para ambos hosts;
no se amplía el mockup histórico. El documento de próximos grupos sigue siendo una propuesta.
Ambos previews activos; **parada1AU antes de commit/push**.


Validación final1AU:158unitarias focalizadas (74shared,51Admin,33Listen),20browser de cabeceras
más2del editor real,5typechecks y lint/builds/guarda33/93/120 verdes. Admin527180/532480Bgzip
(5300Bde margen); Listen200109/307200B. Las dos incidencias importantes de la revisión y los gaps
de slots tienen regresiones RED→GREEN; no queda Critical/Important ni Minor diferido de esa
revisión. Se preservan los overrides nativos de Album, cuya composición/QA sigue en su fase;
no se certifican AT, backend vivo, plataformas nativas ni comparación canónica.1AU continúa
sin commit/push, con ambos previews activos.

## Dirección de Diego después de 1AU — Listen primero

Diego pide centrar la continuación en las primitivas, componentes y superficies que necesita
Listen para llegar antes a una experiencia V3 usable, y retomar después Admin. Se solicita un
análisis por agente con inventario y plan de implementación. El
[inventario de Listen](2026-10-19-crate-v3-listen-inventory.md) y el
[plan propuesto](2026-10-19-crate-v3-listen-implementation-plan.md) distinguen el primer recorrido
de escucha de la cobertura restante del producto. La secuencia futura del
[roadmap anterior de familias](2026-10-19-crate-v3-component-checkpoint-groups.md) deja de ser el
orden de continuación; sus contratos y deuda siguen como referencia.

Esta dirección no aprueba nuevos checkpoints ni publica 1AU, que continúa pendiente de revisión
antes de commit/push. Tampoco modifica el alcance de release conjunta, integra Smart Mix o
certifica datos, dispositivos o QA pendientes. Se conserva Admin y se verifican sus consumidores
afectados por cada cambio compartido. Ambos previews permanecen activos.

### Aprobación de 1AU y del plan de Listen

Diego aprueba1AU y el plan de Listen, autoriza commit/push y ejecutar1AV Imagen e identidad.
La nueva prioridad Listen primero ya está aprobada; Admin conserva sus contratos y comprobaciones
de consumidores afectados.1AV usa mockup/Storybook y review pequeña, con stop antes de commit.
Se solicita además Listen vivo en5174 con API habitual `https://api.lespedants.org`.

## 1AU publicado; 1AV — imagen e identidad

1AU y el plan de Listen publicados en `5593d68d`.1AV completa seis fichas: Avatar, EntityAvatar,
MediaCover, PlaylistArtwork, CrateLogo y BandcampLogo. Conserva medidas/activos/roles existentes;
las geometrías se miden contra los tokens del mockup, sin inventar una nueva escala. MediaCover
acepta un renderer inyectado y AlbumCardArtwork adopta el frame común sin una segunda portada
de fallback. ArtworkSurface/CrateImage conserva srcSet/sizes, lazy/decode, identidad lógica,
ready y reintentos de credenciales. UserAvatar y PlaylistArtwork conservan sus adaptadores.
PlaylistArtwork nativo recupera errores y nombra collages/placeholders; no desmonta el renderer
gestionado por los errores transitorios de su transporte. Admin conserva su opt-out del glyph.

[Review pequeña](http://127.0.0.1:5186/review-1av-images.html), Storybook `Reviews/1AV/Images` y
[plan/evidencia](2026-10-19-crate-v3-image-identity-reconciliation.md). Catálogo39/93/120;54pendientes.
Misma escena, captions FormField8px y controles equivalentes; no se amplía el mockup histórico.

Listen vivo: `http://127.0.0.1:5174/`, servicio `crate-v3-listen-live.service`, proxy a la API
habitual autorizado por Diego. El login volvía sin error porque las cookies de producción no
servían en la dirección local. Corrección solo del proxy dev y solo para loopback: host-only,
HttpOnly intacto, SameSite=Lax y sin Secure para HTTP local; HTTPS conserva Secure.6regresiones
y smoke real de Vite con upstream ficticio verdes; Diego confirma que ya entra. No se inspeccionan
credenciales ni se ejecutan mutaciones de producción. La app viva aún contiene vistas legacy
pendientes: verla abierta no certifica ListenV3 ni todos sus consumidores.

**1AV local, sin commit/push; previews5186/6006 y Listen5174 permanecen activos.**

Validación final1AV:173unitarias/políticas (92shared,56Listen,25Admin),9browser,5typechecks,
lint y builds de ambas apps y herramientas verdes. Admin527169/532480Bgzip,margen5311B;
Listen200105/307200B. Revisión fresca sin defecto de producción P1/P2; la marca ausente en la
escena se reprodujo y corrigió con el caso browser. Premisa de radio8px corregida a6px según
tokens sin modificar runtime. No queda menor accionable pendiente de ese pase. Límites nativos/
AT/backendvivo/canónicos y adopción amplia siguen explícitos en el plan1AV. **Detenido para
Diego, sin commit/push de1AV; los tres servicios siguen activos.**

### Aprobación de 1AV — 2026-10-19

Diego aprueba1AV y autoriza commit/push. Continúa1AW: entidades, pistas y colecciones según el
plan Listen aprobado, con el mockup como referencia, Storybook y review pequeña compartida.
Mantener5186/6006/5174 activos y detener1AW antes de commit/push para revisión de Diego.

## 1AW — Entidades, pistas y colecciones · revisión local · 2026-10-19

1AV aprobado y publicado en `a2b374f3`. 1AW sigue **sin commit/push**, detenido para revisión de
Diego. Vista pequeña: http://127.0.0.1:5186/review-1aw-collections.html; misma escena en Storybook
`Reviews/1AW/Collections`. Listen sigue en http://127.0.0.1:5174 con la API habitual autorizada.

Se completan las seis fichas existentes EntityCard, EntityRow, EntityPrimaryAction, TrackList,
MediaGrid y MediaRail. Selección y reproducción actual se separan; ARIA/ref nativos, texto largo,
perfiles de artista y metadatos quedan en sus componentes. ArtistCard retira sus mapas locales de
anchura; AlbumTrackList usa TrackList conservando discos/IDs/selección; PlaylistTrackList conserva
IDs de entrada y virtualizador; LibraryAlbumsTab distingue error inicial de colección vacía.

Enmiendas de Diego: glyph blanco de18px dentro de un slot visual de24px sobre la portada, sin disco azul; control activo de40px
con ring2px, aura, efectos y suscripción de progreso solo en la hoja activa. Todas las miniportadas
independientes de pista/álbum/artista tienen mínimo48px, también compactas. MediaCover posee el
mínimo y la receta shared `crate-media-thumbnail` lo aplica a marcos managed/raw heredados de
ambas apps hasta su adopción por fase. Avatares de personas, marcas y celdas internas de collage
son roles separados. Se mantienen HairlineRow12/18 y título de entidad14/500; ningún hover rellena
el fondo de las filas revisadas.

Incidencia corregida durante la iteración: envolver TrackCoverThumb en un marco de altura auto
hizo desaparecer sus imágenes. Se retiró ese wrapper; ArtworkSurface/CrateImage conservan su
renderer y recuperación anteriores. La nueva prueba de navegador monta el renderer real con
una imagen local, verifica decode/pintado48x48 en ambas densidades y el WindowVirtualList real
con80entradas y scroll hasta la última. No necesita sesión ni escribe en producción.

La revisión independiente encontró tres mínimos pendientes (CrateAlbumPicker, ArtistRow y tooltip
HTML de ArtistNetworkGraph) y una story Callback que heredaba href. Se corrigen con regresiones
RED→GREEN. La guarda inspecciona marcos JSX y el tooltip HTML conocido; no sustituye QA visual.
Catálogo:45documentadas/93entradas/120fuentes;48pendientes. Las fichas y la adopción siguen siendo
estados distintos.

Decisiones conservadoras: mantener los roles14/500 y12/18 ya aprobados (otro tamaño requiere
revisión medida); no inventar imports Admin para bases existentes sin consumidor directo (la
adopción real de Admin queda pendiente); conservar la semántica y el teclado nativos de filas,
sin introducir un nuevo modelo grid (AT y runtime nativo siguen pendientes). No se reescribe
el renderer, la autenticación, el motor, el drag ni la virtualización.

Las validaciones focalizadas y sus límites finales se consolidan en el estado vigente. Sin suites
completas/CI, sin regenerar33PNG/manifest1M, sin PR/merge/rebase/deploy/release. Las tres instancias
permanecen activas; conservar los checkpoints y el pin histórico app/web@258bbaee.

### Cierre de validación local1AW

99pruebas shared,289Listen,13Admin y12de escritorio:413unitarias/política focalizadas; tipos
shared/Listen/Admin/Desktop/Storybook y lint de archivos modificados verdes.20comprobaciones de
navegador de colecciones e imagen/identidad (11+9), más9históricas de pistas:8pasaron en la
cadena inicial; el arrastre390px falló por movimiento al hacer scrollIntoView y pasó en el
reintento aislado1/1. No se cambió el control de seek para ese reintento. Se conserva este límite
de estabilidad del mockup grande; las escenas nuevas y el renderer real tienen evidencia propia.

Builds Admin/Listen/Storybook/preview verdes; presupuestos bajo532480/307200Bgzip. La medida final
se registra en los logs1aw-final-*-budget. Catálogo45/93/120,48pendientes. Revisión fuente independiente
más regresiones de sus hallazgos cerradas. La auditoría de tamaños arbitrarios amplió la guarda
y detectó ShowCard compacto18px: ahora48px, con el aumento de altura correspondiente en calendario.
El mínimo de miniaturas tiene cobertura para marcos JSX y el tooltip HTML existente; no equivale
a una certificación de todas las rutas ni de credenciales/imágenes reales de producción.

Tres servicios persistentes activos5186/6006/5174. 1AVpublicadoa2b374f3;1AWsin commit ni push,
parado para Diego. Pendientes QA nativa/AT y grabación/comparación canónicaLinux de fases previas.

Medida final tras el último ajuste: Admin527199/532480Bgzip (margen5281B), Listen200128/307200B.
Los cuatro builds están verdes; la documentación de MediaCover queda pendiente de revisión1AW,
conservando la aprobación1AV de las otras familias de imagen. No se ha cambiado ningún baseline.

## Aprobación y continuación — 2026-10-19

Diego aprueba1AW y autoriza commit/push. Continúa1AX: capas, feedback y navegación mínima
según el plan Listen aprobado. Mantener5186/6006/5174 activos y detener1AX antes de commit/push.
La aprobación visual1AW no cierra QA nativa/AT ni los baselines pendientes.

1AW publicado en5ff7296c21e4d91bb8d639e1e00e52b43939a2da. Alcance1AX: [plan local](2026-10-19-crate-v3-layers-feedback-navigation.md).


## Cierre local 1AX — pendiente de revisión de Diego

1AW publicado5ff7296c;1AX no se publica ni avanza a1AY. Escena pequeña en
[preview1AX](http://127.0.0.1:5186/review-1ax-layers.html) y
[Storybook1AX](http://127.0.0.1:6006/?path=/story/reviews-1ax-layers--complete).
Las tres instancias persistentes5186/6006/5174 siguen activas; Listen usa la API aprobada.

Siete fichas cerradas documentalmente: AppModal, AppPopover, AppErrorBoundary, ErrorState,
LoadingState, SkipLink y Tabs. Las seis primeras estaban pendientes; Tabs tenía la receta1Q
pero su ficha seguía pendiente. Catálogo52/93,120fuentes,41pendientes. La revisión visual1AX
sigue pendiente y no equivale a adopción de todas las páginas.

Consumidores reales: Sort y visibilidad de playlist usan Select; FormField/Switch preservan
valores y capacidades. TopBarSearch usa SearchInput/superficie sólida, ARIA activo, IME sin
emisiones prematuras, foco de retorno, posición acotada y scroll de la opción activa. La vista
pura local de resultados se usa en ambos hosts; artwork, traducciones, recents, resolución remota
y navegación siguen en Listen. AppModal conserva1N/drag con propiedad de teclado anidada y
bloqueo de scroll hasta el último propietario. AppErrorBoundary compone ErrorState.
Ambos helpers URL evitan duplicar historial antes del render, preservando query/hash/state.

Diego detectó el recorte de páginas de artista/género. Causa: el frame interno PageHero tenía
height100% dentro de una sección con solo min-height; ahora se estira por el eje transversal.
No se añaden parches en cada página. Regresiones de roles media/artist/editorial y consumidores
ArtistHeroSection/GenreHero reales a390/1200; CrateHero content-height conserva su contrato.

Revisión fuente independiente: tres hallazgos importantes corregidos con RED→GREEN — texto
readonly largo de playlist, opción activa fuera del popup y falta de búsqueda en la escena.
La muestra estática AppPopover aísla su contexto para no interceptar el modal de la escena.
Sin revisión repetida. No quedan hallazgos importantes abiertos en el alcance implementado.

Validación focalizada:112shared (63+49),58Listen,37Admin (26+11),26Desktop:233pruebas. Tipos
shared/Listen/Admin/Desktop/Storybook y fixtures; lint de fuentes modificadas.17comprobaciones
browser de capas/búsqueda/URL/readonly y cabeceras, con un worker. Las escenas no hacen llamadas
API; la integración Listen usa red interceptada y no escribe en producción. Builds Admin,
Listen, Storybook y preview correctos. Admin527168/532480Bgzip (margen5312B),
Listen201557/307200B. Catálogo y correspondencia documental correctos.

Decisiones y costes: se mantienen los helpers sin migración masiva (adopción por página1AY/H1);
se conserva la infraestructura de modal/Radix (interop y QA nativa acotadas, sin reemplazo);
se añade la ficha Tabs que el brief describía erróneamente como completa (una ficha adicional,
sin nueva API runtime); quedan fuera comportamientos previos de búsqueda stale/completion e
inertness general (límites lifecycle/AT para su fase). Ver el plan1AX y el registro de ejecución.
No se cierran QA nativa/AT/datos vivos ni la grabación/comparación Linux de los33baselines1M.
No suites/CI completas, nuevos baselines, PR, merge, rebase, deploy ni release.

### Aprobación final de 1AX — 2026-10-19

Diego aprueba 1AX y autoriza commit/push y continuar con 1AY (Shell, búsqueda y colección),
con el mockup aprobado como referencia, Storybook actualizado y las tres instancias activas.
1AY se detiene para revisión antes de su commit/push. Se mantienen los límites de QA registrados.


## 1AY — Shell, búsqueda y colección, local para revisión

1AX aprobado/publicado en5bc683d8. 1AY detiene su trabajo antes de commit/push.
[Alcance y decisiones](2026-10-19-crate-v3-shell-search-collection.md). Instancias persistentes:
5186mockup/review,6006Storybook y5174Listen conectado por proxy a la API habitual.

- Shell desktop/mobile: chrome plano, reglas al hacer scroll, marca sin suscripción al audio,
  navegación44px y marcadores activos; Collection conserva siete destinos, portal acotado y
  navegación/retorno de foco con teclado. Safe areas y geometría del player se conservan.
- Búsqueda: forms/feedback/entidades/listas compartidas; transporte de imágenes, IME, recientes,
  teclado y colas conservados. La escena reutiliza las views reales de results, liked y sort;
  sus fixtures de inglés no consultan API ni escriben preferencias.
- Colección: tabs con contadores reales mediante InfoBadge (0 visible; sin cifras inventadas),
  filtro/ordenación/Play All alineados abajo y estados reservados con la geometría del FormField.
  El helper conserva path/query/hash/state/historial; cambiar sección retiene foco en su pestaña.
- Select: base fija12rem/192px, limitada al contenedor, manteniendo anchos explícitos de formulario.
  Medición previa95→297px según la opción; tras la corrección192→192px.
- Tabs: una raya cian de2px viaja con aceleración y pequeño rebote (spring-snappy450ms), con
  destino ajustado a la pestaña y fallback de movimiento reducido. Se prueban vertical/RTL/resize.
- Artista desktop: imagen100px más abajo, degradado original, según aprobación fotográfica de
  Diego. Sin anclaje superior ni recorte del fade. Geometría del hero conservada.

Revisión independiente: dos Important (robo de foco al cambiar tabs por path; cobertura parcial de
la escena) y dos Minor (reserva de sort; portal en viewport bajo), todos corregidos. Las pruebas
adicionales detectaron vínculos menores de44px y scroll de foco que cerraba el portal; corregidos.
Las guardas reducen presupuestos y siguen dueños reales; no se amplía el hover-fill permitido.

Validación focalizada, serial, con un worker:

| Grupo | Resultado |
| --- | --- |
| Listen: Shell, ruta/foco, tabs/Library, búsqueda/TopBar y ArtistHero |95pruebas verdes |
| Shared: Select/Tabs/FilterBar y recetas de forms |17pruebas verdes |
| Listen: modelo de destinos y guardas afectadas |30pruebas verdes |
| Shared: catálogo, preview, exports, tokens, hover, miniportadas y overlays |47pruebas verdes |
| Admin: Select y helper de tabs |12pruebas verdes |
| Desktop: título/arranque |26pruebas verdes |
| Navegador: dos hosts desktop/mobile, portal bajo, controles liked, Select estable y motion/RTL/vertical |11casos distintos verdes |
| Tipos |Listen, shared, Admin, Desktop y Storybook verdes |
| ESLint y whitespace |archivos TypeScript cambiados,0warnings; diff-check verde |
| Builds |Listen, Admin, Storybook y preview verdes |
| Presupuestos JS inicial |Listen201569/307200Bgzip; Admin527207/532480Bgzip |
| Catálogo |53documentadas/93entradas/120fuentes;40pendientes, sin refrescar deuda pendiente |

Los11casos de navegador se consolidan de la pasada con9verdes y la repetición de los3casos de
navegación/portal corregidos (uno era un caso ya verde). No se confunde suma de ejecuciones con
casos distintos. Evidencia local en `.artifacts/review/1ay-*`; comprobación visual en Listen con
portadas autenticadas y contadores reales. Hubo una interrupción del proceso de tipos de Admin;
la repetición de esa parte, Desktop y Storybook acabó verde.

Límites: no suites/CI completas, motores adicionales ni QA nativa/AT/zoom de fase.33PNG y manifest1M
sin modificar. No se certifica la migración de todas las páginas de Admin ni el player (1AZ),
Album/native (1BA) o Smart Mix. No hay commit/push de1AY, PR, merge, rebase, deploy ni release.

### Aprobación de1AY — 2026-10-19

Diego aprueba1AY y autoriza commit/push y continuar con1AZ (reproductor), actualizando Storybook,
con el mockup como referencia y las tres instancias activas. Parar en1AZ antes de commit para revisión.
