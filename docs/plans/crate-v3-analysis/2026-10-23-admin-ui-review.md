# Revisión final de Admin — 23 octubre 2026

Rama `feat/crate_v3`, base `cb812597` y retirada local de iconos en SmartMixCoverage. Los findings describen el estado al iniciar esta revisión, antes de la migración posterior de Artist y Album. Listen es la referencia visual; se aplicaron ADMIN_UI_REVIEW_CHECKLIST y web-design-guidelines. No se han confirmado P0/P1. P2 corresponde a UX, accesibilidad, datos o deriva de componentes relevante; P3 a consistencia visual y jerarquía.

Se revisaron las rutas activas y sus componentes por grupos. Contraste en navegador: System Health, Browse, Discovery, detalle de artista y Listen Radar. Los estados móviles/error se verificaron principalmente en código, no se reprodujeron todos en navegador.

Artist y Album eran migraciones conocidas pendientes, confirmadas por Diego durante la auditoría; se completaron después del análisis (véase el cierre). Sus observaciones se distinguen abajo como plan de migración; no se presentan como desviaciones inesperadas del resto de Admin.

## 01 · P2 · Datos no disponibles presentados como vacío o cero

[pages/Bandcamp.tsx:299](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:299), [pages/federation/SecurityPanel.tsx:99](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/federation/SecurityPanel.tsx:99).

Bandcamp muestra que no hay matches incluso durante carga o error; Security muestra Score: 0 cuando aún no hay respuesta de riesgo. Ambos estados pueden conducir a interpretar datos no recibidos como datos confirmados.

**Corrección:** Representar loading, error, empty y data por separado; cero solo tras una respuesta válida.

**Referencia existente:** LoadingState / ErrorState compartidos; AiModels.tsx:79.

## 02 · P2 · API p95 muestra en realidad el máximo

[pages/SystemHealth.tsx:883](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/SystemHealth.tsx:883).

La tarjeta usa summary.api_latency.max, aunque la etiqueta dice API p95. El umbral también usa max; la lectura operativa es incorrecta.

**Corrección:** Renombrar a API max o recibir un percentil real antes de usar p95.

**Referencia existente:** Contrato MetricSummary en SystemHealth.tsx:29.

## 03 · P2 · System Health comprime siete métricas en columnas demasiado estrechas

[pages/SystemHealth.tsx:880](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/SystemHealth.tsx:880).

El breakpoint xl depende del viewport, sin descontar el sidebar. Verificado en navegador a unos 1280 px: 17619ms se parte y Health Score forma una columna muy alta.

**Corrección:** Usar container queries o auto-fit con anchura mínima; mantener numeral y unidad juntos.

**Referencia existente:** Patrón @lg de las métricas en Analysis.tsx:164.

## 04 · P2 · Wishlist queda invisible en dispositivos sin hover

[pages/Download.tsx:1028](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:1028).

El botón de los resultados usa opacity-0 sin condición pointer-fine. En táctil existe una zona accionable invisible.

**Corrección:** Ocultar solo para puntero fino; conservar acciones visibles en coarse pointer.

**Referencia existente:** Listen components/cards/TrackRowParts.tsx:233 y EntityCard compartido.

## 05 · P2 · Objetivos de acción diminutos

[pages/Settings.tsx:1482](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:1482), [components/genres/GenreTaxonomyTree.tsx:1060](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/genres/GenreTaxonomyTree.tsx:1060).

Remove extension solo tiene un X de 10px; expandir el árbol ronda 16px. El botón del árbol tampoco expone aria-expanded ni controla el grupo hijo.

**Corrección:** Usar el target común y TooltipHint; exponer estado y asociación de expansión manteniendo selección independiente.

**Referencia existente:** @crate/ui/primitives/ActionGroup y ActionIconButton.

## 06 · P2 · Filtros de Smart Mix simulan tabs incompletas

[components/SmartMixTracks.tsx:238](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixTracks.tsx:238), [components/SmartMixTracks.tsx:210](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixTracks.tsx:210).

Los botones role=tab no tienen roving tabindex, flechas ni panel asociado. Las versiones envuelven un badge informativo en un botón desnudo.

**Corrección:** Usar SegmentedControl para estado y FilterChip para versiones.

**Referencia existente:** Listen StatsPeriodPicker.tsx:29; shared SegmentedControl y FilterChip.

## 07 · P2 · Tooltips nativos y errores explicados solo mediante title

[components/admin/QueueLanes.tsx:222](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/QueueLanes.tsx:222), [components/SmartMixTracks.tsx:341](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixTracks.tsx:341), [components/SmartMixActivity.tsx:140](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixActivity.tsx:140), [components/admin/RelativeTime.tsx:14](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/RelativeTime.tsx:14), [components/shows/ExtractionMethodCards.tsx:67](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/shows/ExtractionMethodCards.tsx:67), [pages/Settings.tsx:1830](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:1830).

Estos son atributos title en elementos HTML reales. En Smart Mix contienen la explicación de fallos, que queda fuera del patrón accesible de teclado/táctil.

**Corrección:** TooltipHint para información auxiliar; fallo relevante visible o en detalle accesible.

**Referencia existente:** @crate/ui/shadcn/tooltip; Listen TrackRowPlaybackControl.tsx:122. title de InfoBadge o shared Button ya se transforma correctamente y se ha excluido.

## 08 · P2 · La búsqueda global desaparece en móvil

[components/layout/Shell.tsx:118](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/layout/Shell.tsx:118), [components/layout/Shell.tsx:193](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/layout/Shell.tsx:193).

El header móvil solo ofrece menú, marca y avatar. La única instancia de SearchBar está dentro del header oculto bajo md.

**Corrección:** Ofrecer un trigger compacto con búsqueda accesible también en móvil.

**Referencia existente:** Listen components/layout/topbar/TopBarSearchView.tsx:203–238.

## 09 · P2 · Insights ignora la preferencia de movimiento reducido

[pages/Insights.tsx:621](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Insights.tsx:621).

Los gráficos Nivo mantienen su animación por defecto con motionConfig gentle y no conectan animate a la preferencia común.

**Corrección:** Pasar useMotionAllowed a animate.

**Referencia existente:** @crate/ui/lib/motion-gate; GenreEqEditor.tsx:196.

## 10 · P2 · Progreso y uso de recursos reconstruidos sin semántica común

[pages/Analysis.tsx:152](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Analysis.tsx:152), [components/SmartMixCoverage.tsx:204](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixCoverage.tsx:204), [pages/SystemHealth.tsx:389](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/SystemHealth.tsx:389).

Las barras porcentuales son div locales, con sus propios fills/transiciones y sin role progressbar/meter ni valor accesible. No se incluyen instrumentos especializados como lanes o EQ.

**Corrección:** Usar ProgressHairline para cobertura/trabajo y Meter para uso de recursos.

**Referencia existente:** Shared ProgressHairline.tsx:42, Meter.tsx:58; Listen RemoteImportView.tsx:72.

## 11 · P2 · La wheel usa chips de relación propios de 10px

[components/genres/GenreTaxonomySummary.tsx:87](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/genres/GenreTaxonomySummary.tsx:87), [components/genres/genre-wheel.css:153](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/genres/genre-wheel.css:153).

Parents/Related/etc. se dibujan con botones locales de min-height30, texto10 y hover con borde accent, sin adaptación táctil ni tooltip común; captions fuerzan MonoLabel a 9px.

**Corrección:** Usar GenrePill para selección y quitar overrides de tipografía/target.

**Referencia existente:** @crate/ui/domain/genres/GenrePill.tsx:78, receta32/44 y TooltipHint.

## 12 · P2 · El cuerpo de Smart Mix conserva el lenguaje visual antiguo

[components/SmartMixCoverage.tsx:60](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixCoverage.tsx:60), [components/SmartMixActivity.tsx:105](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixActivity.tsx:105), [components/SmartMixTracks.tsx:299](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixTracks.tsx:299).

Las métricas, actividad y tabla siguen con fondos negros/blancos por opacidad, captions manuales de 10px y overrides de tamaño en badges. Los iconos del encabezado ya retirados no forman parte de este finding.

**Corrección:** Aplicar tokens semánticos, MonoLabel e InfoBadge sin geometría local.

**Referencia existente:** Shared MonoLabel / InfoBadge; Listen LibraryContributionRow.tsx:48. CrateChip es un alias compartido válido; el problema son sus overrides.

## 13 · P3 · Secciones neutras que deberían ser accent y captions locales

[components/admin/ops-surfaces.tsx:160](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/ops-surfaces.tsx:160), [pages/PlaylistEditor.tsx:1995](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1995).

OpsPanel reenvía titleTone indefinido y MonoLabel adopta subtle. Se verifica visualmente en System Health y Discovery. Status/Generation history de PlaylistEditor mantienen CardTitle con tamaño y tracking locales.

**Corrección:** Dar tono accent a captions de sección, conservar gris en campos y metadatos; usar MonoLabel en los captions locales.

**Referencia existente:** Checklist aprobada; MonoLabel tone=accent; secciones de Listen Radar.

## 14 · P3 · StatusBadge mantiene una fundación paralela

[components/admin/StatusBadge.tsx:26](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/StatusBadge.tsx:26).

Agents, AI y Add show usan una receta rectangular sans/medium con padding propio, diferente de InfoBadge. El mapeo warning/accent de Admin no se considera por sí mismo un error de color.

**Corrección:** Convertirlo en adaptador de InfoBadge, conservando la semántica y el vocabulario del dominio.

**Referencia existente:** @crate/ui/primitives/InfoBadge.

## 15 · P3 · Persisten iconos redundantes en acciones con texto y estados

[pages/Download.tsx:1284](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:1284), [pages/Download.tsx:1500](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:1500), [pages/Settings.tsx:1334](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:1334), [pages/Bandcamp.tsx:462](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:462), [components/shows/ShowSourcePanel.tsx:50](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/shows/ShowSourcePanel.tsx:50), [components/SmartMixTracks.tsx:359](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/SmartMixTracks.tsx:359).

Quedan glyphs junto a Add to library, Find alternate, Download all, Save Sources, Open, Reanalyze e instrucciones de imágenes; switches añaden Check/X pese a exponer ya el estado.

**Corrección:** Retirar decoración y conservar solo glyphs de acciones icon-only, shell aprobado e indicadores de trabajo.

**Referencia existente:** Checklist de iconos y ActionGroup compartido.

## 16 · P3 · Formularios con captions y controles fuera de la receta

[components/ai-models/ProviderCard.tsx:169](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ai-models/ProviderCard.tsx:169), [components/ai-models/ProfileForm.tsx:274](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ai-models/ProfileForm.tsx:274), [components/shows/ShowSourcePanel.tsx:213](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/shows/ShowSourcePanel.tsx:213), [pages/Login.tsx:89](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Login.tsx:89), [pages/Setup.tsx:118](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Setup.tsx:118), [pages/federation/PoliciesPanel.tsx:45](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/federation/PoliciesPanel.tsx:45).

AI y Shows usan labels sans locales; Login rehace Input/Button; Setup usa placeholders sin captions persistentes; Federation representa un campo categórico con botones y límites sin captions visibles.

**Corrección:** Componer FormField con Input/Select/Button comunes, preservando acciones y valores.

**Referencia existente:** Listen components/auth/CredentialsForm.tsx; shared FormField y Select.

## 17 · P3 · Controles de vista y navegación tienen recetas distintas

[pages/Browse.tsx:449](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Browse.tsx:449), [pages/agents/Agents.tsx:12](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/agents/Agents.tsx:12).

Browse usa Grid/List locales de 36px sin tooltip compartido y Select/Done con icono junto al texto; Agents dibuja Approvals/Connections con botones de ruta y selección propios.

**Corrección:** Acciones compartidas para vistas y tabs de navegación con estado semántico.

**Referencia existente:** ActionButton/PageHeaderAction; Listen CollectionTabs.tsx:35.

## 18 · P3 · La gráfica de uso IA conserva paleta y tooltip antiguos

[components/ai-models/UsageChart.tsx:9](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ai-models/UsageChart.tsx:9), [components/ai-models/UsageChart.tsx:35](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ai-models/UsageChart.tsx:35), [components/ai-models/UsageChart.tsx:81](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ai-models/UsageChart.tsx:81).

Los colores cyan/red/white y la rejilla RGBA están fijados en el componente. El tooltip vuelve a usar transparencia, blur y sombra local.

**Corrección:** Resolver tema y paleta mediante tokens y usar la superficie opaca acordada.

**Referencia existente:** Tema token-resolved de SystemHealth.tsx:284–311. Se conserva Nivo.

## 19 · P3 · Estados de carga y vacío no comparten presentación

[pages/PlaybackDelivery.tsx:123](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaybackDelivery.tsx:123), [pages/Trash.tsx:295](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Trash.tsx:295), [pages/Stack.tsx:330](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Stack.tsx:330).

Se alternan texto centrado, spinner suelto y cajas discontinuas; cambian altura, jerarquía y comunicación accesible.

**Corrección:** LoadingState / EmptyState / ErrorState con variantes correspondientes.

**Referencia existente:** Listen CatalogSearchView.tsx:94.

## 20 · P3 · Discovery repite todas las cifras de la cabecera inmediatamente debajo

[pages/Discover.tsx:463](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Discover.tsx:463), [pages/Discover.tsx:487](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Discover.tsx:487).

Los cuatro pills y las cuatro tarjetas repiten acquisition targets, detected releases, incomplete artists y momentum signals. Verificado en navegador: añade volumen sin información nueva.

**Corrección:** Reservar pills para estado/contexto y mostrar métricas una sola vez.

**Referencia existente:** Checklist: datos útiles sin repetición injustificada.

## 21 · P3 · La cabecera de Bandcamp no identifica la página

[pages/Bandcamp.tsx:209](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:209).

El H1 dice Support layer for the collection; el usuario que entra desde Bandcamp pierde la correspondencia entre destino y título.

**Corrección:** Usar Bandcamp como título; mover la explicación al subtítulo.

**Referencia existente:** Patrón de identidad Browse/Discovery.

## Migración conocida: Artist y Album

- Hero y acciones: ArtistHeroSection.tsx:167 y 355, AlbumHeader.tsx:232. Componer PageHero/ArtistHeroFrame y acciones comunes; quitar glyphs etiquetados y metadatos decorativos. Referencia: Listen ArtistHeroView.tsx:61.
- Tabs de artista: ArtistTabsNav.tsx:24. Sustituir botones de tabs locales por Tabs compartidas con selección/panel y teclado.
- Tarjetas/filas: ArtistCard.tsx:53, ArtistRow.tsx:52, AlbumCard.tsx:129. EntityCard/EntityRow y enlace nativo; selección con estado accesible. Estos componentes también afectan Browse y discografía.
- Acciones de tracks: TrackTable.tsx:1019 (descarga 32px y title nativo) y 384 (Lyrics 10px). ActionIconLink/acciones comunes, target táctil y tooltips.
- Artwork: ArtistHeroArtworkEditor.tsx:602 y694. Switch y FormField compartidos; preservar callbacks.
- Charts: ArtistStats.tsx:116 fuerza animate=true. Conectar useMotionAllowed y resolver colores/tipografía con tokens.
- Badges y captions: AlbumCard.tsx:229 y TrackTable.tsx:269 usan microbadges locales. InfoBadge/MonoLabel sin overrides.

## Cobertura por página

- Biblioteca: Browse, Artist, Album, Genres, Playlists, PlaylistEditor, Insights y sus componentes de dominio.
- Operaciones: Dashboard, SystemHealth, Tasks, Stack, Health, Logs, Analysis, PlaybackDelivery, Download, Trash; SmartMix, governor, gate y lanes.
- Gestión: Upcoming/Shows, Imports, Contributions, Bandcamp, Users, Roles, AiModels, Settings, I18nReview, Agents y subrutas, Federation y paneles, GlobalCatalog, NewReleases, Discover.
- Shell y entrada: Sidebar, PageHeader, HeaderUserMenu, SearchBar, CommandPalette, Login, Setup; Profile es redirección y no se reporta su componente fuera del runtime.

## Validación inicial de las políticas y límites

Este apartado conserva el resultado de la auditoría inicial. El estado después de las correcciones figura en el cierre de los 21 findings.

Ejecutadas cinco suites de políticas: admin-icon-policy, font-role-policy, admin-consistency-policy, surface-tokens y status-colour-policy. Resultado: 67 tests pasan y 4 fallan; una suite pasa y cuatro fallan.

- Icon policy: 58 entradas, NO equivalentes a 58 iconos decorativos. Mezcla glyphs, consumidores sin registrar y controles aprobados. El scope es una lista parcial de archivos (admin-icon-policy.test.ts:20), de modo que no cubre sistemáticamente los componentes internos donde persiste drift.
- Font policy: 8 avisos; varios falsos positivos (Summary hereda display por CSS y usa MonoLabel en sus headings; nodos de wheel son instrumentos). Los overrides de 9/10px sí se verificaron en fuente.
- Surface policy: exige una superficie glass (surface-tokens.test.ts:91) aunque el sistema acordado es solid. Es un test obsoleto, no prueba de que haya que recuperar glass.
- Status policy: 3 sitios de tono de acciones en Genres; el alcance de las excepciones debe reconciliarse con las decisiones posteriores del usuario. No se ha convertido automáticamente ese resultado en hallazgo visual.

Las correcciones recientes Add show/Merge duplicates/Import all pending y la retirada del icono Smart Mix pasan la revisión específica. title de InfoBadge, Button y ActionIconButton ya consume TooltipHint y no se cuenta como tooltip nativo. No se reportan SVGs de instrumentos, spinners ni componentes sin consumidores activos.

## Cierre de implementación y validación

Artist y Album ya están migradas en esta rama. Se usan PageHero/ArtistHeroFrame, EntityCard/EntityRow, InstrumentPanel, MonoLabel, InfoBadge, GenrePill, Tabs, campos y acciones compartidos. Se conservan permisos, operaciones, selección, navegación y confirmaciones. Browse mantiene explícitamente covers de artista cuadrados en cuadrícula y lista, conforme a la corrección posterior de Diego.

Las cards de análisis incorporan cobertura Smart Mix, calidad/versiones de perfil, LUFS, true peak, cues y medidas intro/outro, confianza/estabilidad de tempo, revisiones de fuente/perfil y referencias Bliss con estado, fecha y dimensiones. El resumen de álbum identifica las medias de pistas y no las presenta como una medición LUFS integrada del álbum. El endpoint expone identidad estable y conserva títulos duplicados sin mezclar álbumes; no envía vectores ni grids binarios.

Validación de los cambios:

- Artist: 23 archivos / 105 tests; secundarios: 4 suites / 20 tests. Excepción Browse: 3 archivos / 8 tests.
- Album y análisis: 11 archivos / 29 tests. Upload y compatibilidad Browse: 2 archivos / 6 tests.
- Entity compartido: 31 tests. Regresión de consumidores Listen: 3 archivos / 45 tests.
- Backend: 47 tests de contrato, análisis e integración PostgreSQL y límites de acceso DB.
- Política de iconos: los nuevos controles Artist/Album pasan su scope y regresiones. La suite completa mantiene exactamente las 58 entradas anteriores fuera de esta migración (25 tests verdes y uno fallido por ese inventario).
- Typecheck Admin y Listen verdes; ESLint de los archivos migrados, Ruff y git diff --check verdes. Los grupos pueden solaparse: no deben sumarse como tests distintos.
- Typecheck de shared se detiene por un error previo en domain/shows/UpcomingEventRow.test.tsx:36 (Element | null | undefined frente a Node | null), ajeno al contrato Entity modificado.
- El catálogo actualiza las tres entradas Entity afectadas. El check global mantiene entradas stale previas de fundamentals/Meter/ProgressHairline/progress y dos componentes Upcoming sin entrada; no se han actualizado sus fingerprints para ocultarlas.

La API local se reinició para cargar el contrato nuevo. Se verificaron en navegador artista, discografía, álbum y diálogo de análisis de pista con datos reales (Arboreal: 9 perfiles, 9 vectores de 20 dimensiones). El servicio Vite de esta rama está supervisado con reinicio automático en 127.0.0.1:5175 y proxy a la API local 8585; PostgreSQL, Redis y workers siguen activos.

## Cierre de los 21 findings

Los 21 findings se han corregido en la misma rama, tras la autorización de Diego. Las secciones anteriores conservan la evidencia inicial; los enlaces con número de línea corresponden a esa revisión y pueden haberse desplazado.

| Finding | Corrección aplicada                                                                                     | Regresión cubierta                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 01      | Bandcamp separa carga, error y vacío; Security no presenta riesgo pendiente como cero.                  | Estados de cada feed, riesgo pendiente/error y respuesta válida.                         |
| 02      | La métrica se llama API max y sigue usando el máximo real.                                              | Etiqueta y dato del resumen.                                                             |
| 03      | Las métricas usan auto-fit con anchura mínima; numeral y unidad permanecen juntos.                      | Contrato de grid y presentación del valor.                                               |
| 04      | Wishlist solo se oculta con puntero fino; queda visible en táctil.                                      | Visibilidad coarse/fine en la receta del botón.                                          |
| 05      | Remove extension y expandir árbol usan acción compartida; el árbol expone expansión y grupo controlado. | Eliminación, expansión independiente de selección y grupos únicos con múltiples parents. |
| 06      | Smart Mix usa SegmentedControl y FilterChip.                                                            | Selección con teclado, estado, versión y URLs de consulta.                               |
| 07      | Los títulos HTML del alcance se sustituyen por TooltipHint; los errores relevantes permanecen visibles. | Tooltips, fechas accesibles y detalle de fallo.                                          |
| 08      | El header móvil ofrece búsqueda global en AppModal.                                                     | Apertura, foco, cierre, retorno de foco, IDs únicos y navegación.                        |
| 09      | Los diez gráficos de Insights respetan useMotionAllowed.                                                | Preferencia de movimiento reducido.                                                      |
| 10      | Cobertura y trabajo usan ProgressHairline; recursos usan Meter.                                         | Valores, rangos y semántica accesible.                                                   |
| 11      | El resumen de wheel usa GenrePill y MonoLabel sin microtipografía ni hover local.                       | Selección y relaciones completas conservadas.                                            |
| 12      | Smart Mix usa tokens semánticos, MonoLabel y badges sin geometría local.                                | Cobertura, actividad, filtros y tabla.                                                   |
| 13      | OpsPanel usa accent por defecto; PlaylistEditor usa captions MonoLabel.                                 | Tono de secciones y captions de estado/historial.                                        |
| 14      | StatusBadge es un adaptador de InfoBadge.                                                               | Mapeo intencional del dominio Admin y receta compartida.                                 |
| 15      | Se retiran los glyphs redundantes inventariados y los del menú móvil de playlists.                      | Acciones, trabajo en curso e inventario de excepciones funcionales.                      |
| 16      | AI, Shows, Login, Setup y Federation usan campos y controles comunes.                                   | Guardado, login, pasos de setup, valores y políticas.                                    |
| 17      | Browse usa ActionGroup/ActionButton; Agents usa tabs compartidas con enlaces nativos.                   | Vistas, covers cuadrados, teclado, detalle/lista y clics modificados.                    |
| 18      | UsageChart resuelve tema y paleta con tokens y tooltip opaco.                                           | Tokens y movimiento reducido.                                                            |
| 19      | PlaybackDelivery, Trash y Stack usan estados comunes.                                                   | Carga, error, vacío y contenido.                                                         |
| 20      | Discovery reserva pills para estado; las cifras permanecen una sola vez en las métricas.                | Cifras presentes sin duplicado en cabecera.                                              |
| 21      | El H1 identifica Bandcamp.                                                                              | Cabecera y acciones conservadas.                                                         |

La revisión cruzada también corrigió la navegación de Agents al volver del detalle a la lista y evitó que Meta/Shift/Alt-click cambiase la ruta actual antes de abrir el enlace nativo. La cobertura móvil se verifica con tests de interacción y contratos de receta; no se afirma una inspección visual en todos los tamaños o dispositivos.

La captura posterior de Trash permitió detectar una composición incorrecta adicional: un EmptyState inline estaba dentro de una Card sin padding. Se retiró la Card de los estados de carga/error/vacío y se conserva para la lista con pistas. La regresión cubre esa composición y se verificó en el navegador local.

También se corrigió la carga diferida de ArtistAlbumRoute, sin alterar rutas ni capacidades. Las políticas ahora distinguen los glyphs funcionales concretos de los decorativos, reconocen las fuentes declaradas por componentes compartidos/CSS/instrumentos y exigen la identidad solid vigente. Las tres acciones de borrado de Genres autorizadas conservan su excepción acotada; no hay exenciones generales nuevas.

La deuda de validación registrada arriba queda resuelta: el test UpcomingEventRow admite un nodo ausente correctamente; el typecheck de shared pasa. El catálogo actualiza contratos y ejemplos de Fundamentals, Meter, ProgressHairline y Progress y registra UpcomingDateStamp/UpcomingEventRow, conservando Entity. Su comprobación global pasa con 81 entradas documentadas de 95 y 124 fuentes. Durante esa revisión se corrigió Progress: value/max se reenvían a Radix y el relleno utiliza el mismo rango que ARIA, con estados indeterminados conservados.

### Validación final de las correcciones

- Suite completa de Admin: 190 archivos y 1.835 tests ejecutados. La primera pasada dejó 185 archivos verdes y siete fallos en cinco archivos: la frontera lazy de ArtistAlbumRoute y expectativas antiguas de los pills, GenrePill y RelativeTime. Tras corregirlos se repitieron juntos esos cinco archivos: 55/55 tests verdes. No quedan fallos conocidos de esa ejecución sin resolver.
- Las cinco políticas centrales pasan juntas: 83/83 tests. La cobertura incluye fixtures negativos para evitar que las excepciones permitan glyphs, fuentes o tonos arbitrarios.
- ESLint global y typecheck de Admin verdes; build de producción y presupuesto de bundle verdes (512.789 bytes gzip frente a un máximo de 532.480). Vite mantiene su aviso informativo de chunk individual superior a 500 kB; el presupuesto inicial se cumple.
- Typecheck de shared y de Storybook verdes. Bloque compartido de instrumentos/Progress/Upcoming: 57 tests; consumidor Listen DateStamp: 5 tests. Los grupos se solapan y no se suman como pruebas distintas.
- Catálogo global correcto: 81/95 entradas documentadas, 124 fuentes registradas, sin fingerprints obsoletos o componentes Upcoming ausentes.
- Formato de los archivos modificados y git diff --check verificados. No se han vuelto a ejecutar las suites de backend: estas correcciones no modifican el contrato de análisis validado anteriormente.
- Navegador local: System Health confirma etiqueta y distribución; Bandcamp distingue la carga inicial del vacío confirmado; Discovery muestra cifras una sola vez; Trash presenta el estado inline sin tarjeta vacía. Los casos móviles, movimiento reducido y error se cubren en tests y no se presentan como una revisión visual de todos los dispositivos.

No se ha hecho commit ni push de estas correcciones.
