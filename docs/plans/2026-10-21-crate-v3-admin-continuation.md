# Crate V3 — continuación de Admin

Actualizado: 2026-10-22

Estado: A0 reconciliado. A1a (Shell), A1b (superficies operativas compartidas), A1c (cabeceras
abiertas), A2a (superficies operativas anidadas), A2b (streams de tarea compartidos), A2c
(vigencia/recuperación operativa), A2d (recuperación de Library Health), A3a (Browse + Genres),
A3b (Artist + Album), A3c (Discover + Insights/Analysis), A4a–A4c (Acquisition), A4d (New Releases
+ Upcoming/Shows), A4e (Bandcamp + Global Catalog), A4f (Staged Imports + cuenta del Shell), A5a
(Playlists + editor), A5b (Users + Roles), A5c (Settings + Translations), A5d (Federation) y A5e
(Contributions) están implementados localmente y aprobados visualmente. A5f confirma el alcance de
Orphans; A5 queda cerrado en local. A1, A2, A3 y A4 siguen abiertos. No hay commit/push.

## Objetivo

Retomar la migración visual y funcional de Admin con el Dashboard aprobado como referencia de
lenguaje visual. Primero se reconcilia el inventario antiguo con las rutas y el código actuales;
después se avanza por grupos de trabajo que puedan revisarse en la aplicación real y en Storybook.
Listen queda fuera de este alcance salvo que aparezca una dependencia compartida imprescindible.

El Dashboard aporta una gramática visual, no una plantilla que deba repetirse en cada ruta:
superficies sólidas, reglas hairline, tipografía Bricolage Grotesque + Roboto + JetBrains Mono,
acentos cyan/amber contenidos, jerarquía clara y datos que expresan su procedencia y estado. Cada
página de Admin conserva la composición que mejor explica su propio flujo.

## Estado de partida

- Rama `feat/crate_v3`, en `9c14f396` (`fix(listen): finish web review and show locations`),
  sincronizada con `origin/feat/crate_v3` al iniciar esta hoja de ruta.
- El trabajo web de Listen está prácticamente cerrado. Los cambios recientes están publicados en
  la rama; el despliegue de producción y los paquetes nativos son una fase posterior.
- Dashboard V3 se conserva como referencia aprobada en
  [`2026-10-18-crate-v3-dashboard-implementation.md`](2026-10-18-crate-v3-dashboard-implementation.md).
  Su implementación 1AB no se vuelve a abrir como parte del plan Admin.
- La deuda de superficies confirmada y sus archivos concretos siguen en
  [`admin-adoption-debt.json`](../../scripts/design-system/admin-adoption-debt.json). Los trece
  registros son puntos de adopción por consumidor, no trece componentes nuevos ni una migración
  masiva autorizada.
- No hay cambios de producto Admin pendientes de revisión al abrir este plan. La primera tarea es
  reconciliar la cobertura para separar lo ya terminado, lo parcial, lo obsoleto y lo pendiente.

## Referencias y autoridad

Este documento es el punto de partida para la continuación de Admin. Los inventarios antiguos
siguen siendo material de análisis, no una lista cerrada de requisitos:

- [Estado vigente del proyecto](2026-10-19-crate-v3-current-state.md) para rama, estado publicado,
  previews y límites actuales.
- [Diseño e implementación de Dashboard](2026-10-18-crate-v3-dashboard-implementation.md) para
  decisiones aprobadas y su evidencia.
- [Auditoría de Admin](crate-v3-analysis/admin-audit.md) y
  [matriz de cobertura](crate-v3-analysis/coverage.md) como inventarios que deben reconciliarse
  antes de convertirse en trabajo.
- [`app/ui/AGENTS.md`](../../app/ui/AGENTS.md), [`app/shared/AGENTS.md`](../../app/shared/AGENTS.md)
  y el [AGENTS raíz](../../AGENTS.md) para reglas técnicas obligatorias.
- El [plan V3 maestro](2026-10-14-crate-v3-implementation-plan.md) conserva la cronología; las
  paradas descritas allí son registros históricos y no reemplazan este estado vigente.

## Arquitectura y criterios de diseño

Admin sigue siendo una aplicación React 19 + Vite independiente. Consume capacidades, clientes,
componentes y tokens compartidos; los flujos y los instrumentos propios de administración siguen
en `app/ui`. Las piezas pasan a `@crate/ui` solo si Listen también las necesita.

Antes de crear un instrumento nuevo, la fase debe especificar qué decisión o lectura facilita,
qué fuente real lo alimenta, cómo expresa carga/error/vacío/desactualización y qué interacción
ofrece. Reutilizar `InstrumentPanel`, `MonoLabel`, `StatNumber`, `HairlineRow`, formularios y los
tokens existentes cuando encajen. Los gráficos estadísticos usan Nivo con tema de tokens; las
visualizaciones operativas y de dominio usan SVG/HTML/CSS/Canvas según su función, sin incorporar
otra biblioteca de gráficos.

No convertir todas las rutas en paneles iguales, ni añadir brillos, blur, degradados o fondos
locales para forzar una apariencia “dashboard”. El color indica estado o semántica; las métricas
deben corresponder a datos recibidos y no a inferencias visuales. Mantener controles, capacidades,
acciones, URLs, orden y payloads salvo que el objetivo aprobado de una fase exija cambiar alguno.

## Secuencia de trabajo propuesta

Cada fase entrega una unidad pequeña, Storybook representativo y una revisión en el preview y en
las rutas reales. Se detiene al completar cada unidad para revisión antes de commit. No se mezclan
cambios de esquema/API, de producto y de diseño en una misma fase sin aprobar su contrato.

### A0 — Reconciliar la cobertura actual · completado

El [apéndice de cobertura vigente](crate-v3-analysis/coverage.md#10-admin-inventory-reconciliation--2026-10-21)
contrasta A1–A26 con las rutas reales de `App.tsx`, el sidebar, archivos de página y tests de página.
También separa las rutas añadidas después del inventario, las rutas legacy y la entrada huérfana que
no tiene pantalla. Los tests marcados indican que hay un archivo de test, no que toda la página
esté certificada para V3.

Al concluir A0, la deuda conservaba sus trece entradas: el test de la política Admin pasó 21/21.
El inventario original queda explícitamente marcado como histórico, no como backlog comprometido.

**Resultado:** Dashboard (1AB) queda cerrado como referencia aprobada; Shell mantiene sus dos
ocurrencias de blur registradas; Timeline requiere una decisión de alcance porque la ruta vive sin
entrada en Sidebar; Orphans no es una ruta y se mantiene como dato/issue bajo Genres y Health. La
ruta dinámica `/artists/:artistId/:slug` comparte forma con `/artists/:artistSlug/:albumSlug` y
queda señalada para verificar, sin cambiar su comportamiento en A0.

### A1 — Chrome y adopción de fundamentos

Revisar Shell, Sidebar, cabeceras y superficies de operaciones contra las decisiones aprobadas de
Dashboard. Priorizar la adopción de fundamentos compartidos en los consumidores existentes
(`OpsPageHero`, `OpsStatTile`, `OpsPanel` y los registros vigentes del JSON de deuda). Crear una
composición nueva de cabecera o tira estadística solo si la reconciliación encuentra un hueco real
que las piezas compartidas no cubren.

**Aceptación:** navegación, capacidades y Cmd+K conservan su comportamiento; rutas estrechas y
largas no comprimen la identidad; las superficies migradas usan tokens comunes y dejan de añadir
deuda. Stories muestran estados normal, carga, error/vacío y capacidades cuando corresponda.

#### A1a — Chrome sólido · local para revisión

Cabeceras fijas desktop y mobile de `Shell` usan `bg-app-surface` sin transparencia ni blur. Se
retira su única entrada (dos ocurrencias) del registro ejecutable de deuda; los otros doce registros
siguen intactos. El preview independiente
[`review-admin-shell.html`](http://127.0.0.1:5186/review-admin-shell.html) y Storybook
`Reviews/Admin/Shell` comparten `AdminNavigationReview`, que monta el Shell real con sesión y
acciones ficticias. Comprobación focalizada: `Shell.test.tsx` y
`admin-navigation-checkpoint.spec.ts` en 1440, 768 y 390 px. No altera callbacks ni navegación.

**Revisión local actualizada (2026-10-22):** `admin-shell-review.spec.ts` pasa 3/3 en 1440, 768
y 390 px. Los dos tamaños mayores comprueban la cabecera desktop y el drawer se abre y conserva la
navegación a 390 px. Las capturas están en `.artifacts/review/admin-shell-{1440,768,390}.png`;
la vista real montada en Storybook y `review-admin-shell.html` siguen disponibles. La inspección de
Storybook también confirma que el punto y su estela avanzan por el carril transparente del sidebar
con el scroll. Falta la aprobación visual del usuario; no commit/push. OpsPageHero/OpsStatTile y
adopción en páginas operativas continúan pendientes dentro de A1.

#### A1b — Superficies operativas sólidas · local para revisión

`OpsPageHero` y `OpsStatTile` usan `bg-panel-surface`/`bg-raised-surface`, borde quiet común y
sin sombra/blur. Al ser piezas compartidas, el cambio alcanza sus consumidores actuales: Agents,
AI Models, Analysis, Bandcamp, Discover, Genres, Global Catalog, Insights, Logs, New Releases,
Stack, System Health y Tasks. No cambia datos, consultas, capacidades ni acciones. Se retira
únicamente `ops-surfaces.tsx` del registro de deuda; quedan once entradas.

Storybook `Reviews/Admin/Operations` y el preview aislado
[`review-admin-operations.html`](http://127.0.0.1:5186/review-admin-operations.html) montan el
checkpoint real de Admin con acciones locales. La prueba verifica que Hero y stat tiles pintan
superficies opacas sin sombra/blur en desktop y móvil; Vitest cubre tokens y semántica. No commit ni
push antes de revisión.

**Validación local:** `ops-surfaces.test.tsx` 14/14; `admin-consistency-policy.test.ts` 21/21;
typecheck, build y lint focalizado de Admin; typecheck y build de Storybook; build de preview;
`admin-operations-checkpoint.spec.ts --grep A1b` 1/1 (1440/390 px). El checkpoint Shell pasó sus
tres tamaños; la prueba persistente de iframe pasó al repetirse aislada. `git diff --check` pasa.
El escaneo general `status-colour-policy.test.ts` sigue detectando desviaciones de color en otros
componentes/páginas (41/1); no se modificaron para este bloque. La suite histórica del editor de
playlists tiene expectativas desfasadas de altura/nombre de acción y no es gate de estas
superficies.

#### A1c — Cabeceras abiertas como Dashboard · local para revisión

Los encabezados dejan de usar una tarjeta exterior: se quitan borde, fondo, sombra y padding del
contenedor. `OpsPageHero` propaga la composición a Agents, AI Models, Analysis, Bandcamp, Discover,
Genres, Insights, Logs, New Releases, Stack, System Health y Tasks. También se migran los
encabezados escritos a mano de Settings, Users, Playlists, Upcoming, Acquisition, Roles,
Translations, Contributions, Trash y Playlist Editor. Global Catalog y Health ya compartían el
layout abierto de Dashboard. Los paneles de datos, filtros y superficies internas conservan su
propio borde/fondo.

`AdminPageHeader` concentra el contenedor sin superficie para consumidores legacy. Storybook
`Reviews/Admin/A2 Operational surfaces` y `review-admin-operations.html` muestran el OpsPageHero
real; el preview comprueba la cabecera en System Health y Stack además de sus tarjetas sólidas.
Validación focalizada: 16 pruebas Vitest, preview Playwright 6/6 en 1440/768/390 px,
typecheck/lint/build de Admin, typecheck/build de Storybook, build de preview y `git diff --check`.
5173, 5174, 5186 y 6006 siguen activos. La historia de Storybook también se verificó en el
navegador real; se cambió el import de `PageHeaderLayout` a una ruta relativa para eliminar un
fallo de resolución del alias Vite en el iframe. Confirmación tipográfica del runtime: Listen y
Admin importan las mismas fuentes locales y `font-mono` calcula como JetBrains Mono. Varias
etiquetas escritas a mano todavía omiten `MonoLabel`/`font-mono`; queda como deriva de aplicación
tipográfica para un corte específico, sin cambio de fuentes en A1c. Sin commit/push.

### A2 — Operaciones y salud

Reconciliar Tasks, System, Logs, Stack y Health con sus snapshots y streams actuales. Componer
lecturas operativas usando las fuentes existentes; evaluar `QueueLanes`, `GovernorGauges` o
`RiskMeter` solo si los endpoints aportan valores y estados suficientes. Leer operaciones desde
`OpsSnapshotContext` cuando corresponda, sin abrir una segunda conexión ni sondear snapshots.

**Aceptación:** las visualizaciones reflejan payloads reales, antigüedad y estados de error sin
inventar cifras; SSE mantiene identidad de conexión estable; teclado, permisos y refresco se
conservan. Si falta un dato, documentar el contrato backend pendiente y no simularlo en UI.

#### A2a — Superficies operativas anidadas · local para revisión

`OpsSurface` aplica una receta sólida común a las tarjetas de servicio de Stack y a las tarjetas
anidadas de System Health: `bg-raised-surface`, borde quiet y sin sombra. Los estados semánticos
de Health Score siguen conservando su fondo/tono; el tooltip de gráficas usa la superficie de panel,
sin transparencia ni blur. No se cambian snapshots, consultas, SSE, permisos ni acciones.

El checkpoint A2 de preview mantiene System Health, Stack, muestras locales y acciones reales
encapsuladas; Storybook documenta la receta con el componente Admin real. Las pruebas de las cinco
páginas operativas siguen verdes; Tasks, Logs y Health no recibieron cambios visuales en este
subcorte. Queda pendiente el resto de la reconciliación de A2; esta revisión no declara completo
el grupo entero.

**Validación local:** 66 pruebas Vitest focalizadas en Ops surfaces, System Health, Stack, Tasks,
Logs y Health; 2 casos de preview a 1440/390 px; typecheck/lint Admin; typecheck y build Storybook;
build del preview. Los servicios existentes siguen activos. Sin commit/push.

### A3 — Catálogo musical y análisis

Revisar Browse, Artist, Album, Genres, Discover e Insights/Analysis según las rutas que A0 confirme.
Mantener la composición basada en entidades y las acciones existentes. Evaluar `TrackReadout`,
`GenreWheel` y las vistas Nivo a partir de usuarios, datos y decisiones que facilitan; no crear
instrumentos solo porque aparezcan en la auditoría antigua.

**Aceptación:** portadas, metadatos, navegación y acciones siguen sus contratos actuales; datos
ausentes se muestran como tales; las visualizaciones tienen estados vacíos/error, labels accesibles,
layout adaptable y cobertura de pruebas para el comportamiento cambiado.

#### A3a — Browse + Genres · local para revisión

Browse y Genres mantienen la estructura de catálogo, pero hacen explícitos el ámbito de los filtros,
los resultados visibles y la diferencia entre catálogo vacío y búsqueda sin resultados. La carga y
los errores de Genres ya no sustituyen la página completa ni ocultan resultados previos; ambos
estados ofrecen reintento. Las consultas, filtros, capacidades y acciones existentes se conservan.

Storybook `Reviews/Admin/A3 Catalog` y [`review-admin-catalog.html`](http://127.0.0.1:5186/review-admin-catalog.html)
montan las páginas reales con datos de muestra y navegación entre ellas. La caché de dependencias
de Vite de Admin queda separada de Listen para permitir ambos servidores en paralelo. Validación
local: Browse/Genres 7/7; lint y typecheck Admin; build Admin; preview 4/4 en 1440/768/390 px;
build y typecheck Storybook; build del preview; navegación real en Admin, preview y Storybook. Sin
commit/push.

#### A3b — Artist + Album · recuperación de rutas · local para revisión

Las rutas de artista y álbum separan el fallo de carga de una entidad que ya no existe. Los errores
de red muestran `ErrorState` de página con reintento; una respuesta vacía muestra un estado «no
encontrado» con regreso a Browse. Si una recarga falla después de tener datos, la ficha existente
se conserva. No cambian la navegación entre artista y álbum, las acciones de edición ni las
capacidades.

Storybook `Reviews/Admin/A3 Entity Recovery` y
[`review-admin-entity-recovery.html`](http://127.0.0.1:5186/review-admin-entity-recovery.html)
documentan los dos estados del componente compartido. Pruebas de Artist y Album verifican el error,
el reintento y el estado ausente. La revisión de cabeceras confirma que ambas mantienen una
jerarquía propia y coherente con su entidad: Artist prioriza identidad y escala de biblioteca;
Album prioriza título, artista, año y datos del disco. No se introduce una capa de metadatos común
que ocultaría esas diferencias.

La auditoría confirmó un conflicto real de rutas: `/artists/:artistSlug/:albumSlug` y el legacy
`/artists/:artistId/:slug` tenían exactamente la misma forma y React Router elegía Album por su
orden de declaración, así que los enlaces antiguos por ID nunca cargaban la ficha de artista. Una
sola ruta de dos segmentos ahora despacha IDs numéricos a Artist y slugs a Album; Artist consulta
por ID y conserva el redirect existente a su URL canónica. Pruebas cubren la selección y la
consulta legacy. No cambian los contratos del API ni los enlaces canónicos. Sin commit/push.

**Subcorte que siguió:** A3c — Discover + Insights/Analysis; revisar estados, lecturas y decisiones
que facilitan sus datos, sin crear instrumentos solo por uniformidad visual.

#### A3c — Discover + Insights/Analysis · local para revisión

Discover ahora permite que cada feed falle por separado: si no carga la cobertura del catálogo,
sus métricas muestran que el dato no está disponible y las demás fuentes siguen visibles. El panel
de oportunidades conserva un reintento local para esa consulta. Un fallo del workspace completo
sigue distinguiéndose del catálogo vacío y ofrece recuperación. No se presentan oportunidades
vacías ni cifras cero cuando su fuente falló. Insights conserva sus gráficas y el último snapshot
válido durante un error de actualización; Analysis informa del fallo sin sustituir el estado por
éxito ficticio. No cambian endpoints, filtros, permisos ni acciones.

Storybook `Reviews/Admin/A3 Discovery` muestra un fallo parcial con las fuentes de Radar y
tendencias disponibles; `Reviews/Admin/A3 Insights` muestra la retención del snapshot. Los demos
del preview usan fixtures y acciones locales, mientras `Discover` e `Insights` reales se
comprobaron en Admin. Se cubren desktop, tablet y móvil en Discovery, y desktop/móvil en Insights.

**Validación local:** Discover, Insights y Analysis 26/26 pruebas; build Admin; typecheck/build de
Storybook; build de preview; checks Playwright focalizados del preview; `git diff --check`. Los
cuatro servicios locales siguen activos. Sin commit/push.

**Seguimiento A3c (2026-10-22):** `OpportunityCard` adopta `OpsSurface`, con el mismo borde y
superficie sólida que el resto de las tarjetas operativas. La entrada obsoleta de sombra de
Discover se retiró del registro de deuda y la página pasó a su ámbito de control. Storybook y el
preview montan el componente real. La regresión nueva comprueba la receta compartida; Discover
pasa 4/4 pruebas, el checkpoint del preview 4/4, y Admin pasa typecheck, lint y build. Storybook
pasa typecheck y build. Sin commit/push; A3c queda local para revisión.

**Siguiente subcorte:** revisar la adopción visual restante de A3 y su jerarquía de datos con
historias representativas; mantener las diferencias de dominio y evitar cambios por uniformidad.

### A4 — Adquisición, importación y catálogo externo

Rediseñar a fondo el pane de Acquisition/Download: mejorar el flujo, la jerarquía, la lectura de
progreso, la selección de fuentes y la recuperación de errores; no limitar el corte a adaptar
componentes existentes. Revisar también New Releases, Upcoming/Shows, Bandcamp, imports y Global
Catalog. Evaluar `ReleaseRail` o `SidecarViewer` solo donde exista un flujo real que lo necesite.
La UI de archivos y sincronización debe mostrar el progreso devuelto por sus tareas y permitir
reanudar o entender fallos sin filtrar IDs internos como copy para el usuario.

**Aceptación:** no se eluden workers para escribir la biblioteca; progresos, cancelaciones y
errores corresponden a tareas reales; importación, adquisición y acciones externas preservan sus
confirmaciones y requisitos de capacidad.

#### A4a — Espacio de búsqueda de Acquisition · local para revisión

Se separa la identidad de Acquisition del flujo de búsqueda: el encabezado identifica la página y
el estado de conexión/cola, y una superficie ancha agrupa consulta, envío y calidad de Tidal con
una explicación visible de su alcance. Las salidas Tidal/Soulseek son ahora pestañas mutuamente
excluyentes y accesibles por teclado; la pantalla inicial y la consulta demasiado corta para
Soulseek explican el siguiente paso. Se conserva la lógica de consulta, las tarjetas y los payloads
de descarga/lista de deseos.

La escena real de Admin se monta con fixtures locales en Storybook y en el preview. Este subcorte
cubre jerarquía de búsqueda y resultados; Upload, Queue, Wishlist e History se detallan en A4b.
No se llama al backend desde las muestras ni se encola nada.

**Validación local:** Download Vitest, typecheck/lint/build Admin, Storybook typecheck/build, preview
build y Playwright a 1440/768/390 px, incluida la búsqueda y el cambio entre fuentes. Sin
commit/push.

#### A4b — Upload, queue, wishlist e history · local para revisión

Upload admite selección y arrastre de archivos, muestra la selección antes de encolarla y da
confirmación legible al terminar. Queue, Wishlist e History usan paneles y filas sólidas, muestran
los estados y el progreso disponible y mantienen las acciones asociadas a cada descarga. Se
conservan endpoints, payloads y flujos de worker existentes.

La escena y los fixtures de A4a cubren los cuatro paneles; Playwright selecciona un archivo local,
recorre las pestañas y comprueba la descarga activa, progreso, wishlist y resultados completados o
fallidos en 1440, 768 y 390 px. No se envían archivos a la API en preview/Storybook.

**Validación local:** Download Vitest 8/8; typecheck y lint Admin; typecheck Storybook; preview
Playwright 9/9 (incluye la consulta, los cuatro paneles y Artist Browser en 1440/768/390 px);
Prettier y `git diff --check`. Sin commit/push.

#### A4c — Artist Browser y sugerencias de oyentes · local para revisión

El navegador de álbumes de artista de Tidal usa superficie sólida con resumen de catálogo y
releases disponibles/locales. Las cards muestran permanentemente su calidad, estado y acciones de
descarga, mejora, wishlist y consulta de tracks; su uso no depende de hover. Las sugerencias de
oyentes pasan a la misma superficie sólida, con solicitudes, procedencia y acciones táctiles
claras. Las consultas y cambios de estado conservan sus endpoints.

Storybook `Reviews/Admin/A4 Acquisition` y el preview
[`admin-acquisition-demo.html`](http://127.0.0.1:5186/admin-acquisition-demo.html) montan la
página real con resultados y solicitudes ficticias. La ruta preparada para revisar Storybook es
[`SearchWorkspace`](http://127.0.0.1:6006/?path=/story/reviews-admin-a4-acquisition--search-workspace).
Playwright comprueba que las acciones del Artist Browser y las sugerencias siguen visibles y no
desbordan en 1440, 768 y 390 px.

**Validación local:** Download Vitest 8/8; typecheck y lint Admin; typecheck Storybook; preview
Playwright 9/9; Prettier y `git diff --check`. Admin, Listen, preview y Storybook están activos.
La suite completa de Admin conserva 15 fallos repartidos en 20 archivos previos de rutas, políticas
de iconos/colores/superficies, Playlist, Upcoming y Shows; el corte de Acquisition pasa aislado.
Sin commit/push.

#### A4d — New Releases + Upcoming/Shows · local para revisión

New Releases mantiene los estados, filtros, datos y acciones existentes, con filtros, resultados y
vacío sobre superficies sólidas. Upcoming mantiene las vistas lista/tarjetas/calendario, la
selección por ciudad/género y los estados de publicación; sus filtros y celdas de calendario usan
la jerarquía opaca del Dashboard. Las tarjetas de show también quedan sólidas y conservan sus
acciones y detalles expandibles. No cambian APIs, capacidades, consultas ni payloads.

Storybook `Reviews/Admin/A4 Release radar and shows` monta las páginas reales con fixtures y
permisos de lectura. Los demos de revisión están disponibles en
[`admin-new-releases-demo.html`](http://127.0.0.1:5186/admin-new-releases-demo.html) y
[`admin-upcoming-demo.html`](http://127.0.0.1:5186/admin-upcoming-demo.html). Se corrigió además
el buscador de Acquisition: el input respetaba el control compartido de 40/44 px, mientras el
botón lo forzaba a 48 px. Ambos vuelven a compartir la altura del sistema y la lupa queda centrada;
un check geométrico lo verifica en desktop, tablet y móvil.

**Validación local:** New Releases/Upcoming/Shows Vitest 50/50; Download Vitest 8/8; preview
Playwright 17/17 para New Releases + Upcoming y 9/9 para Acquisition a 1440/768/390 px. Admin
typecheck, lint y build; Storybook typecheck y build; build del preview; Prettier y
`git diff --check`. Los cuatro servicios responden en `:5173`, `:5174`, `:5186` y `:6006`. El
servidor Storybook está activo y la historia se incluyó en el build; no se hizo commit/push.

#### A4e — Bandcamp + Global Catalog · local para revisión

Bandcamp y Global Catalog alinean sus superficies internas con el Dashboard: paneles opacos,
bordes quiet y MonoLabel para estado y metadatos. Global Catalog da una jerarquía consistente a
Read model, ejecuciones y fuentes duplicadas, sin modificar sus lecturas, orden, filtros o
capacidades. Los avisos de tareas de Bandcamp mantienen el nombre de la acción y ya no enseñan el
ID interno de la tarea.

Storybook `Reviews/Admin/A4 External catalog` monta ambas páginas reales con fixtures locales en
[`Bandcamp`](http://127.0.0.1:6006/?path=/story/reviews-admin-a4-external-catalog--bandcamp) y
[`Global Catalog`](http://127.0.0.1:6006/?path=/story/reviews-admin-a4-external-catalog--global-catalog).
Los demos interactivos existentes siguen disponibles en
[`admin-bandcamp-demo.html`](http://127.0.0.1:5186/admin-bandcamp-demo.html) y
[`admin-global-catalog-demo.html`](http://127.0.0.1:5186/admin-global-catalog-demo.html).

**Validación local:** Bandcamp y Global Catalog Vitest 30/30; preview Playwright 16/16 junto con
Acquisition a 1440/768/390 px; Admin typecheck y lint; Storybook typecheck/build, preview build,
Prettier y `git diff --check`. Las cuatro instancias locales siguen activas; sin commit/push.

#### A4f — Staged Imports + cuenta del Shell · local para revisión

Staged Imports muestra la cola, actividad y metadatos portables con estados seguros y acciones de
importación/eliminación controladas por sus contratos existentes. Los errores y notificaciones
presentan mensajes para el usuario, no IDs internos; sidecars e inventario de archivos se exponen
con sus datos legibles. El avatar del encabezado del Shell reúne identidad, logout y vista previa
de permisos junto a la búsqueda global en escritorio, y en el encabezado móvil. El sidebar queda
dedicado a navegación.

Storybook `Reviews/Admin/A4 Staged Imports` monta la página real con fixtures locales. El preview
[`admin-imports-demo.html`](http://127.0.0.1:5186/admin-imports-demo.html) permite revisar sus
estados y acciones simuladas; `Reviews/Admin/Shell` y
[`review-admin-shell.html`](http://127.0.0.1:5186/review-admin-shell.html) muestran el menú de
avatar real en desktop y móvil.

**Validación local:** Imports, Sidebar, Shell, SearchBar y HeaderUserMenu pasan 24 pruebas
focalizadas; el preview de Imports pasa 3/3 y el check de navegación pasa 10/10 a 1440/768/390 px.
Admin typecheck/lint/build, Storybook typecheck/build y preview build pasan. De los tests backend
relacionados, 256 pasaron y 13 se omitieron; la única expectativa que no pasó estaba obsoleta por
los campos opcionales añadidos al esquema portable y su caso aislado pasa tras alinear el fixture.
Las cuatro instancias locales siguen activas; sin commit/push.

### A5 — Herramientas curatoriales y administrativas

Revisar Playlists/editor, Users/Roles, Settings, Translations, Federation, Contributions y
Orphans según A0. Agrupar por flujo para evitar una fase que abarque todas las páginas sin criterio.
Conservar reglas de permisos, validaciones, formularios, confirmaciones y concurrencia; solo
compartir una pieza si ambas apps tienen el mismo contrato de interacción.

**Aceptación:** cada grupo conserva payloads y capacidades, incluye sus estados incompletos y
errores, y verifica acciones destructivas, edición y navegación mediante tests focalizados.

#### A5a — Playlists + editor · local, revisión visual aprobada

La lista usa `HairlineList`/`HairlineRow` con una jerarquía estable para artwork, estado de
generación y acciones. El editor presenta las reglas smart como expresiones legibles, expone la
fase de generación y el estado de las actualizaciones en vivo, y conserva sus formularios, permisos,
confirmaciones y acciones. `useSnapshotStream` mantiene el listener SSE y aísla el ciclo de vida del
stream. Las lecturas, streams y acciones del corte de revisión usan fixtures locales; no escriben en
la biblioteca ni dependen del backend.

Storybook `Reviews/Admin/A5 Playlists` y
[`review-admin-playlists.html`](http://127.0.0.1:5186/review-admin-playlists.html) comparten
`AdminPlaylistsReview`, que monta las páginas reales `Playlists` y `PlaylistEditor` con controles
locales para lista/editor y estados smart, estática, carga, no encontrada y fallida. El preview se
comprobó en 1440, 768 y 390 px; el estado de carga, el estado ausente y la actualización SSE también
se recorrieron. Las historias no generan peticiones API ni externas.

**Validación local:** 11 pruebas Vitest de Playlists, PlaylistEditor y `useSnapshotStream`; lint,
typecheck y build de Admin; typecheck y build de Storybook; build del preview; cuatro casos
Playwright del preview y tres de Storybook. Las pruebas de layout y navegación pasan en 1440, 768 y
390 px. El 2026-10-22, con sesión autenticada, `/playlists` cargó 21 playlists y
`/playlists/27` abrió el editor de Loma Prieta con 43 pistas. Solo se inspeccionaron datos; no se
guardaron cambios. Sin commit/push.

**Revisión:** la revisión visual de A5a está aprobada; el listado y el editor también se comprobaron
en sesión autenticada contra la API de producción. A5b y A5c cuentan con aprobación visual.
Federation y Contributions quedan pendientes de revisión. Orphans se mantiene como dato/issues bajo
Genres y Health.

#### A5b — Users + Roles · local, revisión visual aprobada

Users conserva búsqueda, filtros, presencia, paginación, inspección y acciones, pero reorganiza la
lista en una cuadrícula semántica que adapta sus columnas en pantallas estrechas sin duplicar filas.
Los filtros permanecen en una tira desplazable en móvil. Roles presenta las capacidades como una
matriz de permisos agrupada por dominio y rol, con estados de carga, error recuperable y catálogo
vacío. No se cambian endpoints, contratos, permisos ni acciones de cuentas.
El diálogo de detalle de usuario queda limitado a 80 rem, con ancho fluido en móvil.

Storybook `Reviews/Admin/A5 Users + Roles` y
[`review-admin-users-roles.html`](http://127.0.0.1:5186/review-admin-users-roles.html) comparten
`AdminUsersRolesReview`, que monta las páginas reales con una API local en memoria y selectores de
Users/Roles y datos/carga/vacío/error. La fixture no llama al backend ni modifica cuentas o
permisos reales. La matriz de roles y la lista se probaron a 1440, 768 y 390 px; se recorrieron
reintento de error, inspección y vacío; el ancho del diálogo también se afirma en cada viewport.
Storybook y el preview no registraron solicitudes externas
ni errores del navegador.

**Validación local:** 7 pruebas Vitest de Users y Roles; lint, typecheck y build de Admin; typecheck
y build de Storybook; build del preview; cuatro escenarios Playwright del preview y tres de
Storybook. `git diff --check` queda limpio. En la sesión autenticada del 2026-10-22 `/users` cargó
el directorio y `/roles` cargó la matriz de capacidades desde producción; la revisión fue de solo
lectura, sin cambios de cuentas ni permisos. Sin commit/push.

**Revisión:** Users y Roles recibieron aprobación visual. Settings y Translations también quedaron
aprobados visualmente en A5c. La comprobación autenticada del 2026-10-22 también confirmó que
`/users` muestra el directorio y `/roles` carga la matriz de capacidades desde producción; fue una
lectura sin cambios de cuentas o permisos. Federation y Contributions quedan para revisión; Orphans
se mantiene como dato/issues bajo Genres y Health.

#### A5c — Settings + Translations · aprobación visual registrada

Settings agrupa las secciones de configuración en tabs enlazados al query string, con títulos de
sección MonoLabel en accent y una cabecera abierta. `About` adopta `StatNumber` para alinear sus
métricas con la composición compartida. Translations conserva sus flujos de filtros, revisión,
edición y exportación con los selects compartidos y la cabecera alineada al resto de Admin.

Storybook `Reviews/Admin/A5 Settings and Translations` y
[`review-admin-settings-translations.html`](http://127.0.0.1:5186/review-admin-settings-translations.html)
montan las páginas reales con fixtures locales. El preview cubre lectura disponible, carga, error,
reintento, traducciones y navegación de tabs, sin escribir en Settings ni publicar paquetes reales.
El usuario dio el corte por válido y pidió continuar.

**Validación focalizada actual:** 26 pruebas Vitest de Settings y Translations; Playwright del preview
4/4 en 1440/768/390 px y recuperación; typecheck/build de Storybook completados. La revisión visual
de A5c ya está aprobada.

## Verificación y cortes de revisión

- Por cada comportamiento tocado: Vitest + Testing Library en `app/ui`, además de typecheck, lint
  y build Admin para el corte afectado.
- Storybook (`:6006`) documenta las recetas/componentes que cambian; el preview (`:5186`) muestra
  la composición completa; verificar al menos las rutas reales afectadas en Admin (`:5173`).
- Revisar ancho móvil y desktop, carga/error/vacío, datos largos, permisos, accesibilidad de
  teclado/nombres, `prefers-reduced-motion` y contenido que llega tarde.
- Actualizar `admin-adoption-debt.json` junto con la adopción del consumidor, no antes, y mantener
  las guardas de diseño.
- Mantener los servicios que ya están activos. Al final de cada grupo, parar para revisión; no
  hacer commit, push, merge, deploy o release hasta recibir aprobación explícita.
- La aprobación de UI no certifica datos de producción, CI completa, AT exhaustiva ni Tauri/
  Capacitor. Esos gates se registran por separado y no bloquean la revisión visual local.

## Siguiente corte recomendado

A5 está cerrado tras la aprobación del usuario a Federation y Contributions y la auditoría de
Orphans. Continúa A1a: revisar el peso de la cabecera sólida en escritorio y en el drawer móvil.
Después, resolver la revisión visual que quede pendiente dentro de A1 antes de pasar a otros grupos.
Acquisition, Imports, New Releases, Upcoming, Bandcamp y Global Catalog ya tienen checkpoints
propios; no se deben fusionar conexiones cuando sus payloads o filtros difieren.

### Auditoría y A2b — Streams de tareas · 2026-10-21

`OpsSnapshotProvider` se monta alrededor de todo el Shell protegido y mantiene `/api/admin/ops-stream`;
el payload contiene colas y tareas resumidas, no historial completo, eventos de progreso, entradas
de log ni incidencias filtrables. Tasks, Logs y Health conservan endpoints propios porque esas
vistas necesitan sus snapshots detallados. La Health page abre además `tasks-stream?limit=40` para
la historia reciente de reparaciones y `useTaskEvents(activeTaskId)` durante una reparación activa;
son contratos distintos del conteo global de `ops-stream`.

Se encontró una conexión SSE duplicada en el detalle de una tarea activa: `ActiveTaskCard` abría
`useTaskEvents(task.id)` para el mensaje/resultado reciente y `LiveTaskEvents` volvía a abrir el
mismo endpoint al expandirse. Además, una misma reparación puede aparecer en varias filas de
History y montar más de un consumidor del mismo ID. `useTaskEvents` ahora mantiene una conexión
compartida por ID, distribuye eventos a sus consumidores, reintenta a los cinco segundos si falla y
cancela el reintento al terminar la tarea o salir el último consumidor; `LiveTaskEvents` recibe el
estado del padre. El stream de historial de Tasks y los streams filtrables de Logs/Health siguen
separados de `ops-stream`, porque sus payloads y filtros son distintos. La cobertura comprueba
fan-out, cierre, reconexión, cancelación, streams por ID y expansión del detalle. Esta corrección de
comportamiento queda local para revisión junto con A1c; no se hizo commit/push.

**Validación del ajuste de streams:** `use-task-events`, Tasks y operaciones, Health, Album,
ArtistRepairDialog y Health icons (70 pruebas); typecheck Admin; lint Admin; `git diff --check`.

### A2c — Vigencia y recuperación operativa · local para revisión

Tasks, Logs y Stack distinguen ahora la vigencia del último snapshot de la salud de su stream:
vigente/caducado y conectando/en directo/reconectando/en pausa. Si falla un refresco manual,
mantienen visible el último payload válido y muestran un aviso con reintento. Un fallo frío conserva
la pantalla de error con recuperación. Stack ya no convierte un fallo HTTP en un estado ficticio de
“Docker unavailable”. System Health muestra carga y error iniciales, conserva la última muestra si
falla un refresco y evita presentar una tasa de error de 0 % cuando no hay peticiones.

Se mantienen los endpoints, contratos y filtros; no se duplican streams ni se modifica Health, cuyo
stream por tarea y carga de reparaciones mantienen otros alcances. `OpsSnapshotStatus` y
`OpsRefreshNotice` son piezas Admin compartidas por estas cuatro páginas; Storybook y el preview
incluyen estados vigentes, caducados, reconexión y recuperación.

**Validación local:** 55 pruebas Vitest; typecheck, lint y build Admin; typecheck y build Storybook;
build del preview; `admin-operations-checkpoint.spec.ts` 14/14 y
`admin-system-health-checkpoint.spec.ts` 4/4. El preview muestra las rutas reales de Logs y Stack
a 1440/768/390 px, sin API calls ni errores de navegador. Los servicios existentes siguen activos.
Sin commit/push.

#### A2d — Recuperación de Library Health · local para revisión

La pantalla `/health` conserva el último snapshot de incidencias si falla una actualización tras
haber recibido datos; el aviso ofrece reintento y los resultados siguen visibles. Si todavía no hay
ningún snapshot, conserva el estado de error inicial con su recuperación completa. `OpsSnapshotStatus`
separa snapshot vigente/caducado del stream conectando/en directo/reconectando. El stream de Health
usa el intervalo de reconexión compartido de cinco segundos. No cambian endpoints, filtros, permisos,
acciones de resolución/reparación ni el stream independiente de tareas.

Storybook `Reviews/Admin/Health recovery` y el preview standalone
[`review-admin-health-recovery.html`](http://127.0.0.1:5186/review-admin-health-recovery.html)
reutilizan `AdminHealthRecoveryReview`. La página real aislada en `admin-health-demo.html` incluye
un sample “Error al actualizar”: completar un escaneo provoca un fallo de refresco de muestra,
conserva la cola anterior y el botón Retry recupera el snapshot.

**Validación local:** 41 pruebas Vitest de Library Health; Playwright del flujo real de refresco y
reintento 1/1, la escena 4/4 a 1440/768/390 px y 7/7 checks restantes de la página Health. El lint,
typecheck/build de Admin, typecheck/build de Storybook, build del preview y `git diff --check` pasan.
Una aserción histórica del CTA se alineó con el Button primario aprobado: fondo transparente,
borde y texto accent. Los servicios existentes siguen activos. Sin commit/push.

### A5d — Federation · aprobado visualmente

La página `/federation` adopta la cabecera abierta y los tabs compartidos de Admin. Overview presenta
la identidad del nodo, la confianza entre peers y su uso de streaming como secciones abiertas con
datos alineados. Las seis vistas operativas conservan sus endpoints, permisos y acciones; no cambian
contratos ni mutaciones.

Storybook `Reviews/Admin/A5 Federation` y
[`review-admin-federation.html`](http://127.0.0.1:5186/review-admin-federation.html) montan la
página real con fixtures locales. Se pueden revisar datos, carga, vacío, error y acceso de solo
lectura. Las acciones de muestra se quedan en memoria; no alcanzan el API ni otros nodos.

**Validación local:** 8 pruebas Vitest; Playwright del preview 4/4 a 1440/768/390 px y estados;
Playwright de Storybook 3/3 a esos tamaños; typecheck y lint de Admin; typecheck/build de Storybook y
build del preview. Los cuatro servicios locales permanecen activos. Sin commit/push.

### A5e — Contributions · aprobado visualmente

`/contributions` presenta cada aportación como una fila de revisión con portada, álbum enlazado,
artista, origen, número de pistas y duración; la atribución de quien aportó y el estado se leen en
una columna estable. La referencia de origen permanece disponible como dato secundario. Se mantienen
el endpoint, el refresco y los estados de carga, vacío y error; un fallo al refrescar conserva las
filas válidas previas y muestra el aviso de error. No se exponen acciones de escritura nuevas.

Storybook `Reviews/Admin/A5 Contributions` y el checkpoint 1AF montan la página real con fixtures
locales para datos, carga, vacío y error. El preview conserva el iframe aislado, la navegación de
álbum funciona dentro de la muestra y los enlaces/acciones no alcanzan servicios externos. La ruta
real `/contributions` se comprobó en Admin autenticado contra producción; el proxy local mantiene
la cookie de sesión de forma compatible con HTTPS.

**Validación local:** 10 pruebas Vitest de Contributions; lint, typecheck y build de Admin;
typecheck/build de Storybook; build del preview; Playwright del preview 4/4 y Storybook 3/3 a
1440/768/390 px; `git diff --check`. Admin, Listen, preview y Storybook siguen activos. Sin
commit/push.

### A5f — Orphans · auditoría de alcance completada

No existe una ruta ni una página independiente de Orphans en `App.tsx` o Sidebar. Los huérfanos de
taxonomía ya aparecen como `orphan_count` en Genres; los álbumes y pistas huérfanos ya pertenecen al
flujo de incidencias y reparación de Health. El inventario de cobertura A0 coincide con esos
consumidores reales. No se añade una entrada de navegación ni se duplica el flujo en una página
nueva.

**Decisión de alcance confirmada por código:** conservar los casos de taxonomía en Genres y las
incidencias de biblioteca en Health. A5 queda cerrado sin una página o entrada de navegación nueva.
