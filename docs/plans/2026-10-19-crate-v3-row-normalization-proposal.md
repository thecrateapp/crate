# Filas de Crate V3: auditoría y propuesta

2026-10-19 · propuesta para Diego · mismo checkpoint local 1AQ, sin commit/push.
Este documento propone una migración; no la autoriza ni afirma que ya esté implementada.
La petición posterior de reconciliación global incorpora esta propuesta como capítulo de
[su catálogo](2026-10-19-crate-v3-component-reconciliation-audit.md), no como migración paralela.
Supera la intención anterior de alinear solo Incoming: Diego pide ahora analizar todas las
familias similares de Admin y Listen antes de cambiar sus fundamentos.

## Qué está confirmado

El problema es real y tiene dos causas: faltan garantías en los componentes y existen
implementaciones independientes para el mismo tipo de contenido. Corregir cada pantalla con
más clases locales prolongaría esa duplicación.

La inspección AST recorre 1.069 archivos TS/TSX de producción de Admin, Listen y shared.
El [inventario reproducible](crate-v3-analysis/rows-1aq.json) incluye 51 archivos con usos de
las familias nombradas, 43 funciones de fila/fecha y 642 candidatos de contenedores inline.
Los candidatos son una lista de exploración, no 642 errores confirmados; incluye controles,
cabeceras y tarjetas que no deben convertirse automáticamente en filas. Los recuentos son
sitios JSX, no instancias visibles ni páginas certificadas. Se inspeccionaron los fundamentos,
los consumidores de catálogo/eventos y los grupos funcionales indicados abajo.

### El ejemplo activo y el antiguo ejemplo que se ve bien

Ambos montan `HairlineRow` de `primitives/HairlineList.tsx`.

- El componente aporta padding vertical, separador y una raya absoluta de 2 px; no aporta
  padding horizontal ni alineación de texto en el hijo interactivo.
- El ejemplo antiguo de 1B añade en `tools/design-system-preview/style.css` las reglas
  `.rows-preview button, .rows-preview a`: 12 px a cada lado y `text-align:left`.
  `.rows-preview [data-muted]` hace lo mismo para la fila multilínea. El ejemplo de foco
  también compensa el componente mediante `.focus-rows button`.
- El ejemplo nuevo de `row-interaction-sample.tsx` monta la base sin esas reglas. En IAB se
  midió padding izquierdo 0 px, texto de la fila activa en la misma coordenada que la raya,
  y `text-align:center` en el botón de la otra fila.

Por tanto, el ejemplo antiguo funciona gracias a CSS exterior. El estado activo no está
siempre roto, pero el contrato base es incompleto. La corrección debe entrar en el componente
junto con pruebas sin CSS del mockup; después deben retirarse esas compensaciones. Añadir
otra regla solo al ejemplo nuevo ocultaría el mismo defecto.

### Diferencias de filas equivalentes

| Familia actual                     | Implementaciones / consumidores                                                                                               | Diferencias confirmadas                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eventos y releases de Admin        | Upcoming `EventCard` + EventRow; NewReleases `ReleaseTimelineRow`; ShowCard (5 montajes en páginas/secciones)                 | Upcoming: imagen88px, fecha a la derecha, badges debajo, acciones compactas. NewReleases: imagen64px, fecha antes de la portada y en caja56px, metadatos en otra columna, p16px y acciones de texto. Show: imagen88px, alto cerrado88px, tipografía13/11/10 y fecha propia; conserva expansión. |
| Fechas de eventos                  | EventDate (2 sitios Admin), `formatDateParts`/fecha de ShowCard Admin, `CollapsedShowDate` Listen, fecha de ReleaseRow Listen | Admin release10/24/10 Mono; Admin show8/20/8 Mono; Listen show11/24/11 con día Bricolage bold; Listen release fecha corta horizontal con icono y caja, oculta en móvil. Mismo concepto con formato, fuente, dimensión y visibilidad distintos.                                                  |
| Entidades de biblioteca            | EntityRow compartido (8 sitios Listen); AlbumRow/ArtistRow Admin; PlaylistRow Listen y filas inline Admin                     | Portadas40/44/48/64/96–104px según sitio; familias justificadas y overrides mezclados. Tipografía, badges junto al título o debajo, padding y acciones no parten de un contrato único. EntityRow ya tiene datos/callbacks, enlace nativo y menú; debe aprovecharse.                             |
| Filas de playlists                 | Playlists Admin; PlaylistCard variant=row Listen                                                                              | Admin usa composición inline con portada96–104px, descripción y muchos badges; Listen usa EntityRow/portada48px, reproducción y menú. No son intercambiables funcionalmente, pero sí pueden compartir estructura/espaciado y una variante editorial explícita.                                  |
| Filas de pistas                    | TrackRow Listen (15 sitios directos), QueueTrackRow (5), TrackList (3); TrackTable Admin; filas de editor/setlist/similares   | Hay especialización necesaria: play con ring/progreso, arrastre, cola, selección y columnas de tabla. Comparten reglas visuales; no se deben sustituir por una fila genérica que elimine esos contratos.                                                                                        |
| Listas simples                     | HairlineRow/Row, filas inline de setlist/actividad/resultados                                                                 | Inset, alineación, acciones laterales y señal activa dependen demasiado del consumidor. HairlineRow tiene un sitio directo de producción Listen; otros montajes son del mockup.                                                                                                                 |
| Tablas y operaciones               | TableRow (8 sitios Admin), Users/roles/trash/logs/tasks/health con tablas o filas propias                                     | Comparación de columnas, sticky headers, estados operativos y acciones de reparación tienen necesidades distintas. Usar una receta de tabla común donde haya columnas comparables; no forzar cada caso a una tarjeta multimedia.                                                                |
| Home/featured, mapas y cuadrículas | HomeUpcomingFeature, cards de álbum/playlist, calendario, mapas y paneles expandidos                                          | Son otros formatos. Comparten fechas, imagen, badges y acciones cuando procede; no la geometría de una fila.                                                                                                                                                                                    |

También se confirma divergencia entre señales de estado: HairlineRow tiene raya + lavado;
TrackRow raya + tinta de título + lavado; EntityRow aplica color de título al activo y fondo al
seleccionado. La prohibición de iluminar el fondo al hacer hover ya existe, pero no define por
sí sola los otros estados. El artista de la nueva release de Incoming tampoco acota por sí
mismo una cadena larga sin espacios: es un caso de regresión para la futura composición.

## Opciones de arquitectura

1. **Un componente universal con muchos variants y flags.** Centraliza, pero mezcla fechas,
   menú, expansión, navegación, playback y tablas. Las combinaciones crecerían y sería fácil
   introducir enlaces dentro de botones o alterar contratos de Listen.
2. **Varios componentes por función con una base común. Recomendada.** Igual que InfoBadge,
   FilterChip y GenrePill: nombres que expresan el papel y una receta por responsabilidad.
   Se reutiliza EntityRow y los controles existentes; no se crea otra base paralela.
3. **Solo tokens y clases.** Ayuda con números, pero permite seguir cambiando el orden de
   imagen/fecha/badges/acciones en cada página. Es insuficiente para el problema observado.

## Colección propuesta en @crate/ui

| Pieza                                          | Responsabilidad y límite                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HairlineRow / HairlineList existentes          | Lista simple sin imagen: inset, índice opcional, texto, trailing; alineación y estado activo garantizados sin CSS exterior.                                                                                                                                                               |
| RowLayout interno                              | Receta estructural común para imagen/identidad/metadatos/fecha/acciones. Slots acotados y estados; sin router, API, permisos o decisiones de negocio. No un nuevo componente público lleno de flags. EntityRow y EventRow lo consumen.                                                    |
| EntityRow existente, ampliado de forma aditiva | Álbum, artista, playlist, persona o path. Slots diferenciados para título, subtítulo y badges/metadatos; mantiene los menús y la navegación existentes. Cada app conserva su adaptador y sus datos.                                                                                       |
| EventRow de dominio compartido                 | Composición de RowLayout para show/release. Imagen, identidad, badges debajo, CalendarDate y acciones. El evento expandido, asistencia, tickets, adquisición y menús permanecen en los adaptadores de cada app. Sustituye al EventRow local; no deja dos recetas.                         |
| CalendarDate                                   | Una representación de calendario MES / DÍA / SEMANA, sin caja independiente. Entradas fecha civil y locale explícitos; nombre accesible completo y procedencia opcional. No calcula countdown ni descarga datos.                                                                          |
| Acciones de fila                               | Reutilizar Button/Tooltip y los controles compartidos existentes; consolidar la presentación ghost44px sin borde ni fondo permanente aprobada en 1AQ. Preservar el trigger estable al cargar y la ayuda de controles disabled. No exportar PageHeader de Admin como fundamento de Listen. |
| Pistas y tablas existentes                     | TrackRow/TrackList/TrackTable y TableRow conservan su especialización. Adoptan tokens y reglas de estado comunes, sin perder ring, estela, drag, virtualización, selección ni columnas.                                                                                                   |

Un módulo solo entra en shared cuando se adopta en **ambas apps en el mismo bloque**. EventRow
y CalendarDate cumplen esto al migrar los eventos reales de Listen y Admin. RowLayout puede
ser detalle interno de esos componentes. No publicar wrappers vacíos ni aumentar el catálogo
con nombres equivalentes. La primera tarea revisará las APIs exactas y todos sus consumidores.

## Contrato visual propuesto

Estos valores son mi recomendación para revisión, no una nueva decisión ya aprobada.

- **Lista simple:** 12px de inset horizontal, 10px vertical (compacta6px), raya activa2px sin
  invadir texto/índice. Hijo link/button alineado a la izquierda. Objetivo44px en táctil.
- **Entidad normal:** portada48px, compacta40px; separación12px, padding vertical10px/6px.
  El tamaño del avatar es una variante semántica, no un override local. Los avatares grandes de
  Users aprobados previamente se conservan como variante de perfil; no se reducen por defecto.
- **Evento:** imagen88px como el show actual, identidad a continuación, fecha a la derecha
  y acciones al extremo. Mínimo88px, altura natural si el contenido necesita más. Sin gradientes,
  blur/sombra propios por página ni una caja adicional alrededor de la fecha.
- **Fecha única:** columna48px; JetBrains Mono normal **10 / 24 / 10px**, líneas12/28/12,
  mes/día accent-action-hi y semana secundaria. Se sustituirían también los8/20/8del show y el
  día Bricolage de Listen. La captura del show fija el formato de tres líneas; este tamaño
  común es la propuesta de legibilidad. La fecha nunca desaparece por un breakpoint.
- **Texto de entidad/evento:** título Poppins14px/20 peso500; subtítulo12px/16 secundario;
  metadatos y badges InfoBadge24/12. Bricolage queda para los headings de página/sección;
  Mono para fechas/cifras/metadatos. No heredar tamaños de la tarjeta padre.
- **Badges informativos debajo de la identidad:** calidad, estado y contexto en una sola
  banda que envuelve. Fechas/countdown no se convierten en pills por comodidad. Ningún badge
  de calidad al lado del título en esta familia.
- **Acciones:** icon-only Solar, área44×44, sin borde permanente, tooltip solo verbo; nombre
  accesible con objeto cuando haga falta. Los enlaces siguen siendo enlaces y los botones
  siguen siendo botones. Tres acciones no deben robar anchura al título en móvil.
- **Responsive por contenedor:** imagen e identidad mantienen su orden; las acciones pasan
  a una segunda banda derecha si no caben. Títulos/artistas largos no pisan fecha ni acciones;
  truncación con texto completo accesible o salto acotado, sin overflow horizontal. Nada se
  reduce arbitrariamente a tipografía minúscula para lograr encajar.
- **Estados comunes:** hover sin iluminación de fondo; active/current con raya2px, título
  accent y lavado8%; selected con lavado de selección sin fingir reproducción; expanded solo
  despliegue y aria-expanded. Foco visible inset independiente de selección/activo.

Mostraría la misma release con el mismo conjunto de datos en Upcoming y New Releases: mismo
orden y medidas; solo cambian las acciones/estados que cada página puede ofrecer. El show
comparte esa cabecera, mantiene venue/ciudad/support y **su desplegable completo**. No pierde
información para parecerse a una release.

## Contratos funcionales que no pueden cambiar

- API, endpoints, payloads, snapshots/SSE, capacidades, pending/error y callbacks de cada app.
- Rutas reales/virtuales de álbum en Listen, historial y enlaces externos; stopPropagation.
- Teclado nativo, nombres accesibles, aria-expanded/pressed/current/selected donde corresponda;
  ningún botón que contenga enlaces u otras acciones. active visual no inventa semántica.
- Fechas civiles YYYY-MM-DD sin convertirlas en un instante UTC que cambie de día; validación
  de calendario. Admin en-US; Listen i18n.language. Fecha ausente/imposible con fallback
  explícito, nunca fecha inventada ni NaN. Detected sigue indicando que es detección, no estreno.
- Imágenes reales y fallback/carga/error; no inferir calidad ni estado nuevos a partir de la
  apariencia. Contadores ausentes no equivalen a cero.
- Expansión y foco de shows, asistencia de Listen, menu/sheet/long press, reproducción,
  ring/estela, reorder y virtualización permanecen en sus dueños.
- Una identidad, fuentes y excepciones acordadas, pin app/web@258bbaee sin moverlo.

## Orden propuesto y evidencia de cierre

1. **Fundamentos y muestra sin compensaciones.** Corregir HairlineRow y retirar el CSS
   duplicado de rows-preview/focus-rows. Crear el contrato de CalendarDate/RowLayout y una
   matriz visible activo/seleccionado/foco, sin índice/con índice, link/button/texto y multiline.
2. **Una familia completa de eventos.** Migrar Incoming + New Releases + show cerrado de
   Admin y ReleaseRow + show cerrado de Listen al EventRow/CalendarDate reales. Mantener el
   desplegable. Primer stop visual: filas equivalentes lado a lado, con las mismas medidas.
3. **Entidades.** Aprovechar EntityRow para AlbumRow/ArtistRow y filas de playlists/personas/
   paths; separar variantes justificadas editorial/perfil. Inventariar y retirar cada override
   sustituido. Stop por grupo; las diferencias de negocio permanecen en los adaptadores.
4. **Pistas/listas/tablas y restos inline.** Alinear estados/tokens con los fundamentos;
   conservar controles especializados. Revisar los candidatos del inventario por dueño de
   página, incluyendo actividad, descargas, setlist, operaciones, skeletons y estados vacíos.
   No convertir los642candidatos en una migración automática.

Cada bloque lleva pruebas de sus consumidores en ambas apps y ejemplos reales persistentes.
Cubrir375/390,768y1440px, puntero fino/táctil, zoom/texto largo, locale ancho, fechas ausentes/
imposibles, imagen ausente,0/1/muchos badges,0/1/3acciones, capacidades y loading/error.
Vitest --maxWorkers=1 y Playwright --workers=1, solo archivos afectados. Vigilar bundle Admin
532480Bgzip y Listen; sin elevar presupuesto. Validación completa una vez al cierre de fase.
No regenerar las33capturas/manifest1M ni disparar CI completa en la iteración.

## Estado, límites y decisiones pendientes

La decisión pedida a Diego es aprobar esta familia de componentes, el contrato visual y el
orden; después se escribe el plan de implementación con cambios y consumidores concretos.
No se ha empezado esta migración ni se ha corregido visualmente HairlineRow durante el análisis.
El Bot ampliado y los cambios previos de1AQ siguen locales; preview5186activo, sin commit.

Esta auditoría usa código actual, medidas DOM de IAB y los registros normativos vigentes. El
objeto git258bbaee no está disponible en este checkout ni en el checkout principal inspeccionado;
no se cambió el pin ni se usó otra referencia como sustituto. No se afirma una comparación nueva
píxel a píxel con app/web. El inventario no es certificación de todas las pantallas, backend
vivo, AT o runtimes nativos. Esos límites continúan abiertos en la QA de fase.


## Primera adopción autorizada: HairlineRow

Diego autorizó iniciar R1 por HairlineRow tras revisar Storybook. Inset 12 px y alineación izquierda
pasan al componente; las ayudas del mockup se retiran. Se conserva vertical 10 px, sin añadir la
variante compacta propuesta. El texto multiline sin espacios queda contenido. El resto de fechas,
RowLayout, eventos y entidades continúa como propuesta pendiente. Véase el
[contrato y validación](2026-10-19-crate-v3-hairline-reconciliation.md).
