# Crate V3 — grupos de componentes para los siguientes checkpoints

2026-10-19 · propuesta solicitada por Diego durante la continuación de 1AS a 1AT.

## Decisión propuesta

Continuar por **familias con una responsabilidad compartida**, completando su contrato,
catálogo y primeros consumidores juntos. Una familia puede contener varios componentes;
no hace falta un checkpoint por archivo. Tampoco conviene un componente universal de tarjetas,
filas o controles que mezcle todos los negocios.

**1AT de superficies es el siguiente grupo adecuado.** Después: cabeceras, imágenes e identidad,
eventos/fechas, entidades, colecciones, lecturas, estados, capas, menús y navegación/búsqueda.
Los instrumentos y flujos especializados conservan sus fases. Las etiquetas 1AU–1BD de este
documento son una secuencia propuesta, no aprobación de todas sus migraciones.

1AR y 1AS están aprobados por Diego. La publicación de 1AS y la implementación de 1AT pertenecen
al trabajo principal; este documento no las certifica ni modifica su alcance. Referencia de
inspección: 1AS `9b5356862db1cef1d014c0b56c7a7e61bd7cad18`, sin considerar terminados los cambios
posteriores de 1AT que puedan coexistir en el workspace.

## Evidencia y límites de la foto actual

- El [catálogo versionado](../../tools/crate-ui-showcase/catalogue.json) contiene **93 entradas:
  25 documentadas y 68 pendientes** antes de 1AT. «Documentada» no significa adopción completa
  ni QA de todas las páginas. Las categorías de Storybook organizan el catálogo; un checkpoint
  puede reunir categorías relacionadas cuando comparten contrato y prueba de consumidor.
- Ya están documentadas las doce familias de formularios, roles MonoLabel/Readout/StatNumber,
  HairlineRow, badges/filtros y las cuatro familias de acciones. No se rehacen ahora. Persisten
  adopciones parciales: por ejemplo HairlineRow en Listen, y la incorporación progresiva de
  FormField a Admin. Véanse los [formularios](2026-10-19-crate-v3-forms-reconciliation.md),
  [acciones](2026-10-19-crate-v3-actions-reconciliation.md) y
  [HairlineRow](2026-10-19-crate-v3-hairline-reconciliation.md).
- Se contrastaron componentes, imports reales, adaptadores y escenas del mockup. No se ejecutaron
  suites ni navegación de navegador para este análisis. No es una revisión visual nueva de todos
  los estados. Los inventarios históricos de la
  [auditoría global](2026-10-19-crate-v3-component-reconciliation-audit.md#alcance-y-evidencia)
  son candidatos clasificados, no recuentos de defectos actuales.
- El mockup aprobado y los ajustes confirmados por Diego siguen siendo la referencia. Se
  conservan [main.tsx](../../tools/design-system-preview/main.tsx), sus escenas y el pin histórico
  `app/web@258bbaee`. No se obtuvo otra referencia ni se declara una comparación nueva con ese
  objeto Git. Las revisiones futuras usan páginas pequeñas y Storybook; no más secciones en el
  mockup principal.

## Qué se comparte y qué se conserva

| Caso observado                                                                           | Disposición                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card contiene `shadow-card`/`backdrop-blur-xl`; OpsPanel/OpsPageHero añaden vidrio local | Superficie heredada confirmada, ya registrada como A5. Resolver la base y adoptar por lotes con dueño; no llamar a todas las páginas «migradas» al cambiar Card.                                   |
| InstrumentPanel es una sección/figura con regla, label, meta y estado                    | Es un papel diferente de Card. No añadirle fondo para que parezca una tarjeta ni convertir objetos independientes en instrumentos.                                                                 |
| EntityCard, Card y ShowCard comparten la palabra «card»                                  | No son duplicados por el nombre: entidad interactiva, contenedor de objeto y evento desplegable son contratos diferentes. Compartir sus fundamentos, no fusionar sus negocios.                     |
| EventRow/EventDate locales, ReleaseTimelineRow y fechas de show/release                  | Hay duplicación y diferencias confirmadas de anatomía para información equivalente. Es la primera familia de dominio a converger, conservando el despliegue del show.                              |
| EntityRow y AlbumRow/ArtistRow/filas de playlists/personas                               | Compartir estructura y roles; admitir variantes justificadas editorial/perfil. La portada de un álbum, el avatar de usuario y el collage no se vuelven una única imagen sin significado.           |
| TrackRow, QueueTrackRow, TrackList y TrackTable                                          | Especialización legítima: reproducción, drag, cola, virtualización y columnas. Unificar ritmo/estados, sin sustituirlas por EventRow.                                                              |
| Reexports de AdminSelect/Popover/skeleton y PageHeaderAction                             | Compatibilidad útil mientras quedan consumidores. Retirar al quedar sin uso; no mantener una segunda receta ni crear otra para ocultar el adaptador.                                               |
| Valores, roles tipográficos y variantes de un mismo componente                           | La pieza posee su geometría/tipografía interna. El consumidor conserva colocación exterior, datos y callbacks. Un `className` no es automáticamente drift: comprobar su efecto antes de cambiarlo. |

Fuentes: [Card](../../app/shared/ui/shadcn/card.tsx),
[InstrumentPanel](../../app/shared/ui/primitives/InstrumentPanel.tsx),
[Ops surfaces](../../app/ui/src/components/admin/ops-surfaces.tsx),
[EntityCard](../../app/shared/ui/domain/entity/EntityCard.tsx),
[EntityRow](../../app/shared/ui/domain/entity/EntityRow.tsx) y la
[propuesta de filas](2026-10-19-crate-v3-row-normalization-proposal.md#diferencias-de-filas-equivalentes).

## Orden y tamaño de los grupos

«Preparado» significa que hay suficiente contrato para redactar el plan concreto, no que el
grupo esté implementado o validado. Cada pareja de consumidores es un **lote inicial propuesto**;
los usos adicionales conservan deuda de adopción. Un módulo nuevo solo entra en shared cuando
ambas apps lo adoptan en ese mismo alcance, salvo fundamentos ya exceptuados por las reglas.

| Stop propuesto | Grupo y piezas canónicas                                                                                                                                            | Lote de consumidores / dependencia                                                                                                                                                                         | Preparación y límite                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1AT**        | **Superficies:** Card y sus slots, InstrumentPanel, Separator; superficies `variant=card` de IconButton/ActionIconButton ya documentados                            | Admin OpsPanel como adaptador a InstrumentPanel; Listen SettingsPrimitives.Section delegando descripción al panel. Base para todos los grupos siguientes.                                                  | Alcance principal confirmado: objeto sólido y sección ruled; retirar blur/sombra en los variants de acción indicados. Hero, tiles, media cards y overlays quedan fuera; no certificar toda la adopción A5.                                                                                                |
| **1AU**        | **Cabeceras:** PageHeader, SectionHeader, PageHero y HeroActionBar; BackLink como navegación complementaria                                                         | Admin PageHeaderLayout + cabecera de PlaylistEditor; Listen Settings/AlbumHero. Reutilizar ActionGroup de 1AS y superficies de 1AT.                                                                        | Requiere resolver los papeles plain/media/editorial y su escala contra el mockup. El título Bricolage no debe depender del body de la app. Back conserva destino/nombre; las acciones primarias de dominio no se vuelven icon-only por defecto.                                                           |
| **1AV**        | **Imagen e identidad:** Avatar, EntityAvatar, MediaCover, PlaylistArtwork; CrateLogo y BandcampLogo en el mismo inventario de activos                               | Admin Users y portada de playlist; Listen UserAvatar y AlbumCard/PlaylistCard.                                                                                                                             | Preparado para tamaños/forma/fallback por papel. Conservar avatares grandes y modal ancho de Users. Logos son activos de marca, no nuevos tipos de avatar.                                                                                                                                                |
| **1AW**        | **Eventos y fechas:** CalendarDate y EventRow compartidos; RowLayout interno solo si evita estructura duplicada                                                     | Incoming + NewReleases + show cerrado de Admin; ReleaseRow + show cerrado de Listen. Depende de 1AS/1AV; conserva expansiones y adaptadores.                                                               | **Necesita decisión visual** sobre la fecha común y la banda responsive: aplicar 10/24/10 y columna 48 px a todos los casos sigue siendo propuesta. El formato de tres líneas y las imágenes 88 px actuales sirven de referencia. Enseñar misma release lado a lado y show desplegable antes de publicar. |
| **1AX**        | **Entidades en filas y tarjetas:** EntityRow, EntityCard, EntityPrimaryAction                                                                                       | Admin AlbumRow/ArtistRow y un lote de filas Playlists; Listen AlbumCard/ArtistCard/PlaylistCard y UserRow como comprobación de perfil. Depende de 1AV; reutiliza estados de HairlineRow sin copiar su CSS. | Decidir variantes normal/compacta/editorial/perfil y slots de badges. Mantener enlaces nativos, menú, selección y acción primaria separada. No migrar todas las entidades/páginas simultáneamente.                                                                                                        |
| **1AY**        | **Colecciones y pistas:** TrackList, MediaGrid, MediaRail, Table y ScrollArea                                                                                       | Admin TrackTable y un listado ya existente; Listen TrackRow/cola y una Library/rail. Depende de 1AX para anatomía de entidad.                                                                              | Preparado para lista/grid/rail/tabla como formatos distintos. Mantener umbral de virtualización, keys, drag, selección, columnas, sticky y contenido accesible. Playback se prueba como contrato preservado.                                                                                              |
| **1AZ**        | **Lecturas y métricas:** Meter, ProgressHairline, Progress; adopción de StatusDot, StatNumber y Readout ya documentados                                             | Admin SystemHealth/Settings; Listen OfflineSection/Settings. StatStrip solo si existe el lote real de ambas apps; en otro caso se mantiene local según el plan.                                            | Preparado para lecturas con dato real, ausente, límite y actualización. Retirar StatusDot local al adoptarlo. Un metadato o badge no se agranda a StatNumber; una barra de progreso no sustituye al seek del player.                                                                                      |
| **1BA**        | **Estados y reserva de contenido:** LoadingState, EmptyState, ErrorState, AppErrorBoundary, Spinner, Skeleton, Card/Grid/TableSkeleton, CrateLoader y PullIndicator | Una ruta y una sección de Admin; una ruta y una lista de Listen, con sus formas finales. Depende de 1AT/1AY para reservar el espacio correcto.                                                             | Preparado: recuperar contratos de 1R, no rediseñarlos desde cero. Ruta con demora 200 ms, n/a distinto de cero, error con reintento/retorno, estados silenciosos y reduced motion.                                                                                                                        |
| **1BB**        | **Capas y ayuda contextual:** AppModal, ConfirmDialog, AppPopover; Dialog, AlertDialog, Popover, Sheet, Tooltip y OverlayCloseButton; ImageLightbox                 | Modal/confirmación de Admin y modal/sheet de Listen con Select y Tooltip anidados. Reutilizar 1N, formularios y acciones aprobados.                                                                        | Preparado como una familia de interacción, con dos sublotes internos: fundamentos y consumidores anidados. Portal, foco, Escape, scroll lock y z-index se prueban juntos. No subir z-index por componente para tapar fallos.                                                                              |
| **1BC**        | **Menús y acciones contextuales:** ItemActionMenu, ContextMenu, MobileActionSheet, useEntityMenu, dropdown/context-menu y UserMenu                                  | Menú real de entidad Admin; menú/long press y cuenta de Listen. Depende de 1BB.                                                                                                                            | Preparado con adaptación por app. Mismo catálogo de capacidades; presentación desktop/coarse y restauración de foco. UserMenu compartido y TopBarUserMenu local deben clasificarse antes de sustituir uno por otro.                                                                                       |
| **1BD**        | **Navegación, filtros y búsqueda:** Tabs, SkipLink, VtNavLink, FilterBar y SearchBar                                                                                | Admin Shell/CommandPalette/SearchBar y una página con `?tab=`; Listen Shell/Explore y una página con tabs. Depende de capas y cabeceras; SearchInput de 1AR es fundamento, no otra receta.                 | **Decidir convergencia de SearchBar**: el shared es query simple; el local de Admin incluye resultados/recientes. Conservar debounce, IME, permisos, historial, otros parámetros y helpers URL separados por app. Shells y routers siguen locales.                                                        |

### Evidencia concreta que orienta estos grupos

- **Cabeceras:** [PageHeader](../../app/shared/ui/domain/navigation/PageHeader.tsx) y
  [SectionHeader](../../app/shared/ui/domain/lists/SectionHeader.tsx) definen tamaño/peso pero
  no `font-display`. Se debe comprobar la familia calculada, no asumir que todos sus montajes
  se ven mal. [PageHero](../../app/shared/ui/domain/hero/PageHero.tsx) y
  [HeroActionBar](../../app/shared/ui/domain/hero/HeroActionBar.tsx) tienen variantes/recetas propias;
  requieren disposición explícita, no sustitución global por la cabecera de Admin.
- **Imágenes:** [MediaCover](../../app/shared/ui/domain/media/MediaCover.tsx) resuelve carga y
  fallback; [Avatar](../../app/shared/ui/primitives/Avatar.tsx) y
  [EntityAvatar](../../app/shared/ui/domain/entity/EntityAvatar.tsx) añaden persona/tamaño/ring.
  Se documentan juntas y conservan responsabilidades distintas.
- **Eventos:** [EventDate](../../app/ui/src/components/ui/EventDate.tsx) valida fecha civil y
  muestra tres líneas; [EventRow](../../app/ui/src/components/ui/EventRow.tsx) es local Admin.
  [NewReleases](../../app/ui/src/pages/NewReleases.tsx) mantiene ReleaseTimelineRow;
  [UpcomingShowCollapsedView](../../app/listen/src/components/upcoming/UpcomingShowCollapsedView.tsx)
  mantiene CollapsedShowDate y el [ReleaseRow de Listen](../../app/listen/src/components/upcoming/ReleaseRow.tsx)
  usa EntityRow. Es la diferencia concreta que 1AW debe cerrar sin perder acciones.
- **Colecciones:** [TrackList](../../app/shared/ui/domain/tracks/TrackList.tsx) decide
  virtualización a partir de 80 elementos; [MediaRail](../../app/shared/ui/domain/lists/MediaRail.tsx)
  tiene ajuste content/columns. Son contratos diferentes de un simple contenedor `div`.
- **Métricas:** [Settings Admin](../../app/ui/src/pages/Settings.tsx) conserva StatusDot local;
  [OfflineSection](../../app/listen/src/components/settings/OfflineSection.tsx) ya usa Meter y
  StatNumber. El [plan de StatStrip](2026-10-14-crate-v3-implementation-plan.md#task-31-admin-building-blocks)
  condiciona su traslado a shared al primer uso real de Listen.
- **Búsqueda:** [SearchBar shared](../../app/shared/ui/domain/navigation/SearchBar.tsx) conserva
  input/receta propios; [SearchBar Admin](../../app/ui/src/components/layout/SearchBar.tsx)
  contiene recents/resultados. La consolidación no puede borrar comportamiento para igualar
  dos nombres.

## Familias especializadas que conservan su fase

Estas diez entradas pendientes completan el inventario de 68. Se agrupan por flujo real;
no se inventa un checkpoint de «utilidades restantes» para juntarlas sin relación.

| Grupo                          | Entradas y consumidor de referencia                                                                | Condición para consolidar                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Perfil y contenido editorial   | ArtistHeroFrame, ArtistHeroPresentation, ArtistBioProfile, ArtistBioText; Artist de Admin y Listen | Tras cabeceras/imagen. Comparar miembros, texto largo, enlaces, imagen y contenido faltante. La biografía estructurada no se reduce a un Card ni se mezcla con formularios.                                                             |
| Reproducción y ajuste de audio | PlayButton, FollowHeartButton, EqBands; controles de entidad/player y EQ de ambas apps             | Continuar en fase 4 y sus adopciones Admin; preservar esencia del play, ring, estela y sincronía dot/haz. EqBands mantiene su instrumento y datos; no se cambia por Slider general. No integrar Smart Mix.                              |
| Valoración de biblioteca       | StarRating; copias locales de rating Admin/Listen                                                  | Lote explícito con ambos consumidores, teclado, fracciones/ausencia y modo readonly. La excepción actual de export no significa adopción completada. Puede acompañar un checkpoint de metadatos de entidad.                             |
| Acceso y compartir             | OAuthButtons y QrCodeImage; adaptadores auth de ambas apps y Jam/Share                             | Pueden seguir sus flujos separados de fase 6. OAuth preserva redirects/capacidades/feedback; QR preserva valor, error/async y alternativa legible. No se fuerzan al mismo componente ni se modifica autenticación por motivos visuales. |

### Cobertura verificable de los pendientes

Asignación de las **68 entradas pendientes del catálogo inspeccionado**, sin contar componentes
nuevos propuestos como CalendarDate/EventRow/RowLayout:

| Grupo            | IDs de catálogo pendientes asignados                                                                                                                                                                                                                                                               |  Total |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| 1AT              | `shadcn-card`, `primitives-instrumentpanel`, `shadcn-separator`                                                                                                                                                                                                                                    |      3 |
| 1AU              | `domain-navigation-pageheader`, `domain-lists-sectionheader`, `domain-hero-pagehero`, `domain-hero-heroactionbar`, `domain-navigation-backlink`                                                                                                                                                    |      5 |
| 1AV              | `primitives-avatar`, `domain-entity-entityavatar`, `domain-media-mediacover`, `domain-playlists-playlistartwork`, `domain-brand-cratelogo`, `domain-brand-bandcamplogo`                                                                                                                            |      6 |
| 1AW              | Ninguna entrada existente: propuestas nuevas y consumidores locales que hay que reemplazar                                                                                                                                                                                                         |      0 |
| 1AX              | `domain-entity-entityrow`, `domain-entity-entitycard`, `domain-entity-entityprimaryaction`                                                                                                                                                                                                         |      3 |
| 1AY              | `domain-tracks-tracklist`, `domain-lists-mediagrid`, `domain-lists-mediarail`, `shadcn-table`, `shadcn-scroll-area`                                                                                                                                                                                |      5 |
| 1AZ              | `primitives-meter`, `primitives-progresshairline`, `shadcn-progress`                                                                                                                                                                                                                               |      3 |
| 1BA              | `domain-states-loadingstate`, `domain-lists-emptystate`, `primitives-errorstate`, `primitives-apperrorboundary`, `primitives-spinner`, `shadcn-skeleton`, `composites-cardskeleton`, `composites-gridskeleton`, `composites-tableskeleton`, `domain-brand-crateloader`, `primitives-pullindicator` |     11 |
| 1BB              | `primitives-appmodal`, `composites-confirmdialog`, `primitives-apppopover`, `shadcn-dialog`, `shadcn-alert-dialog`, `shadcn-popover`, `shadcn-sheet`, `shadcn-tooltip`, `shadcn-overlay-close-button`, `primitives-imagelightbox`                                                                  |     10 |
| 1BC              | `domain-actions-itemactionmenu`, `domain-actions-contextmenu`, `domain-actions-mobileactionsheet`, `domain-entity-useentitymenu`, `shadcn-dropdown-menu`, `shadcn-context-menu`, `domain-user-usermenu`                                                                                            |      7 |
| 1BD              | `shadcn-tabs`, `primitives-skiplink`, `primitives-vtnavlink`, `domain-filters-filterbar`, `domain-navigation-searchbar`                                                                                                                                                                            |      5 |
| Perfil/editorial | `domain-artistheroframe`, `domain-artistheropresentation`, `domain-artistbioprofile`, `domain-artistbiotext`                                                                                                                                                                                       |      4 |
| Playback/audio   | `domain-media-playbutton`, `primitives-followheartbutton`, `domain-player-eqbands`                                                                                                                                                                                                                 |      3 |
| Valoración       | `primitives-starrating`                                                                                                                                                                                                                                                                            |      1 |
| Acceso/compartir | `domain-auth-oauthbuttons`, `primitives-qrcodeimage`                                                                                                                                                                                                                                               |      2 |
| **Total**        | **Una asignación por entrada pendiente**                                                                                                                                                                                                                                                           | **68** |

Esta tabla es un mapa de trabajo de la foto inicial, no una segunda base de hashes ni un
objetivo de declarar «documentado» todo a la vez. Las entradas compartidas ya documentadas
siguen actualizándose cuando un grupo cambie su contrato.

## Cómo cerrar cada grupo sin volver a acumular drift

1. **Contrato y mapa de reemplazo:** nombre existente, papel, variantes finitas, fuentes y
   medidas contra el mockup; estado definido/implementado/adoptado/validado por separado.
   Enumerar consumidores exactos, adaptadores que quedan y retirada concreta de cada override.
   Un desacuerdo con referencia/mobile se lleva a Diego antes de escoger otra presentación.
2. **Una escena completa del grupo:** actualizaciones de entradas individuales y un patrón
   compuesto en Storybook, en inglés. La misma escena real sirve a la página pequeña de review
   en 5186. Sin CSS que arregle interiores, sin nuevas secciones del mockup histórico.
3. **Pruebas de fundamento y de ambos consumidores afectados:** DOM nativo/refs, navegación y
   callbacks conservados; tamaños/roles calculados; 390/768/1440 cuando sea relevante, fine/coarse,
   texto largo, ausencia y error de datos, 0/1/muchos elementos, foco/disabled/busy, reduced motion.
   Añadir las pruebas de interacción específicas indicadas en el grupo, no ejecutar todo el
   catálogo por cambiar una pieza.
4. **Evidencia de adopción real:** la
   [guarda actual de exports](../../app/shared/ui/export-usage-policy.test.ts) combina los imports
   de ambas apps en un conjunto: comprueba uso en Listen **o** Admin, no en las dos. No usar su
   resultado como prueba de doble adopción. Registrar explícitamente las dos rutas consumidoras
   para piezas nuevas compartidas y los casos todavía solo Listen/Admin. Endurecer la guarda,
   si se acuerda, merece un alcance propio con las excepciones heredadas clasificadas.
5. **Salida revisable:** catalogue refresh/check por IDs afectados, lint/tipos/builds focalizados,
   Vitest `--maxWorkers=1`, Playwright `--workers=1`, presupuesto Admin **532480 B gzip** y Listen
   **307200 B**. El último 1AS deja solo **5330 B** de margen Admin; preferir subpaths y composición
   existente. Sin dependencia runtime nueva por catálogo.
6. **Stop antes de commit:** Diego revisa el grupo completo; ambos previews permanecen activos.
   QA backend vivo, AT, otros motores/native, cierre de fase y comparación canónica se registran
   por separado. No regenerar los 33 PNG/manifest 1M ni lanzar CI/suites completas en cada bloque.

## Deuda que este orden no cierra por sí solo

Cambiar una base no certifica todos sus montajes. El
[estado vigente](2026-10-19-crate-v3-current-state.md#a5--adopción-pendiente-con-dueño-y-criterio-de-cierre)
y el [registro de adopción](../../scripts/design-system/admin-adoption-debt.json) conservan las
superficies Ops, catálogo, acceso y curación por fases 3.x/6.x. La reconciliación tipográfica y de
estados de Tasks/Insights/Genres, las copias locales de campos, métricas y filas y la migración
restante de iconos se cierran mediante lotes de consumidor, no por completar una ficha.

No se reabre Timeline, no se inventan datos para instrumentos y no se modifica el pin. Al cerrar
estas familias se vuelve al plan de producto con un catálogo mantenido; el catálogo no sustituye
las dependencias backend ni las decisiones de UX que siguen pendientes.
