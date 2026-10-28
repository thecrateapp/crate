# Admin — inventario de iconos de acciones, 1AQ

Fecha: 2026-10-19. Base publicada 1AP `d30b1c02`. Inventario solicitado por Diego durante
1AQ; amplía las excepciones funcionales de DS §1.7. Los cuatro Remove de playlists y las cuatro acciones de la
cabecera del editor se implementan localmente. Los demás sitios son propuestas o controles
existentes para revisar en sus fases, sin una reaplicación masiva.
Solo Admin; Listen, Desktop y reproducción conservan sus controles.

## Criterio

Un icono puede sustituir texto cuando nombra una acción convencional y el objeto queda claro
por la fila, el campo o la tarjeta. No añadimos de nuevo iconos decorativos junto a todas las
acciones con texto. Si el verbo oculta un destino, bloqueo, efecto combinado o alcance global,
se conserva la etiqueta que lo explica o se revisa una excepción concreta de cabecera con
semántica precisa, como la aprobada para PlaylistEditor.

Cada control mantiene nombre accesible y tooltip con acción y objeto, hit area de 44px,
feedback de carga y foco. La confirmación final sigue con texto. Se conservan capacidades,
callbacks, peticiones y propagación de eventos. Los nuevos sitios se registran de forma acotada
en la política de iconos; esta excepción no admite cualquier icono en cualquier botón.

| Acción                       | Icono de Admin | Dónde corresponde                                                                             |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Retirar/eliminar un elemento | `Trash2`       | Pista, regla, portada, fila de playlist/usuario/imagen; la confirmación existente se mantiene |
| Quitar un valor o cerrar     | `X`            | Tag, extensión, filtro individual, modal o panel; quitar un tag no borra la entidad           |
| Añadir un elemento local     | `Plus`         | Regla o valor dentro de un grupo identificado; crear flujos distintos conserva su nombre      |
| Editar un elemento           | `Pencil`       | Acción de una fila/tarjeta con objeto inequívoco                                              |
| Copiar o duplicar            | `Copy`         | Enlace/MBID visible o duplicar una playlist; nombre y feedback distinguen cada acción         |
| Actualizar una lectura       | `RefreshCw`    | Toolbar de snapshot/lista con destino claro; no sustituye a sincronizar o generar             |
| Previsualizar                | `Eye`          | Simulación de la playlist en la cabecera aprobada de PlaylistEditor                           |
| Generar playlist             | `ListRestart`  | Generate / Save + generate de la cabecera, con nombre dinámico                                |
| Guardar cambios              | `Save`         | Cabecera aprobada de PlaylistEditor; otros envíos se revisan por contexto                     |
| Reintentar                   | `RotateCcw`    | Tarea/operación fallida concreta                                                              |
| Restaurar                    | `Undo2`        | Elemento concreto de la papelera                                                              |
| Elegir archivo para subir    | `Upload`       | Portada/imagen en su campo; cámara solo si realmente toma una foto                            |
| Descargar/adquirir           | `Download`     | Track/álbum/release concreto; el nombre debe decir si adquiere o exporta                      |

## Sitios concretos

El [inventario por archivo y línea](crate-v3-analysis/admin-action-icons-1aq.json) contiene
71 sitios revisados, con contexto, icono, presentación, estado y hash del código observado:
45 implementados, 11 propuestos y 15 existentes a conservar/alinear en su fase. Las líneas
pertenecen a esta copia local; los hashes permiten detectar cambios posteriores.

| Grupo                               | Sitios que se aplican ahora o se proponen                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aplicado en 1AQ**                 | `PlaylistEditor`: retirar portada, regla y pista; `Playlists`: retirar regla al crear. `Trash2`, nombre y title; cabecera: Duplicate, Preview, Generate/Save + generate y Save changes con Copy/Eye/ListRestart/Save. Button icon-lg ghost + Tooltip;18cabeceras y acciones de fila Edit/Activate/Deactivate/Delete aplicadas por autorización posterior |
| Siguiente grupo propuesto: curación | `PlaylistEditor`: Upload/Replace cover y Add rule; compositor de `Playlists`: Add rule                                                                                                                                  |
| Usuarios y papelera                 | `Users`: Delete de fila y Copy link de invitación; `Trash`: Restore y Delete de fila. Se mantienen los diálogos y el texto de confirmación                                                                                                           |
| Lecturas aplicadas                  | Refresh de Dashboard, Analysis, Contributions, Discover, GlobalCatalog, I18nReview, Logs, Stack, SystemHealth y Trash                                                                                                                                |
| Adquisición                         | Download de dos sitios de NewReleases y dos de Upcoming; revisar junto con TidalAlbumCard y Download para mantener el mismo significado                                                                                                              |
| Familias aún en su fase             | Pencil de ArtistHeroSection; Trash2 de galería; Copy MBID; carga/cierre de imagen; X de tags/extensiones; Plus de extensión; retry/refresh de Tasks y acciones de Download                                                                           |

Atrás/adelante, menú/cierre, expandir/contraer, búsqueda, selección, loader, arrastre y cambio
de vista ya son excepciones de UX. Se conservan. Los iconos de contenido, marca y reproducción
no se mezclan con esta lista de acciones.

## Acciones que conservan texto en los demás contextos

- Envío principal: Save changes/rules, Create & open, Create invite, Save roles/status.
- Generación, IA y efectos combinados: Save + generate, Refine tracklist with AI, Apply safe
  fixes y Add locked. Un icono genérico no comunica esos efectos.
- Trabajos: Sync library/collection/shows/MusicBrainz, Refresh Radar e Import to library.
  No equivalen a volver a leer un snapshot.
- Alcance global o confirmación final: Delete permanently/all, Cancel all, Download all missing,
  merge, repair y aplicación de límites.
- Destinos distintos: Save de traducción frente a Save to workspace JSON; exportaciones con
  formato o contenido distinto.

## Alcance de la inspección

El inventario AST de Admin examina 143 archivos de producción y localiza 185 candidatos
léxicos a acciones en 53 archivos. Incluye ramas condicionales, contenedores, tabs y código sin
montar: no son 185 botones visibles ni una aprobación global. Se revisó el código de los sitios
concretos anteriores; no se ha certificado cada flujo restante en navegador. El antiguo mapa de
Users no debe recuperarse porque aparezca en un inventario estático.

La grabación canónica de 1M y el inventario histórico de 1V no se regeneran. La evidencia de
inspección actual queda en `.artifacts/review/1aq-current-icons.json` y
`.artifacts/review/1aq-action-candidates.json`. Aplicar los grupos propuestos requiere su propio
alcance, pruebas focalizadas y revisión; este inventario no cierra global 1b.8 ni las fases de página.

## Enmienda aprobada: cabecera del editor

Diego aprobó Duplicate, Preview, Generate/Save + generate y Save changes como icon-only ghost
arriba a la derecha. Usan Copy, Eye, ListRestart y Save, 44 px, Tooltip compartido y nombres
accesibles; conservan gates, callbacks y carga. Esta excepción concreta actualiza las reglas de
texto anteriores para esos cuatro controles. Resultado histórico previo a la migración de cabeceras: 45 sitios, 8 aplicados, 22
propuestos y 15 existentes/en su fase. Véase el [estándar de cabeceras y revisión de 18 páginas](2026-10-19-crate-v3-admin-header-actions.md).

## Autorización posterior: todas las cabeceras revisadas y filas de playlists

Diego pidió migrar las18cabeceras antes del siguiente grupo, y después las acciones de fila de
playlists. Estado actual: **71sitios;45aplicados,11propuestos,15en su fase**. Las38acciones de
cabecera y las3de fila usan la composición PageHeaderAction de Admin sobre Button/Tooltip
compartidos. Las4acciones Remove previas completan los45sitios aplicados. Roles conserva solo
lectura; los otros presets/acciones propuestas no se migran por esta enmienda.

El [registro de cabeceras](2026-10-19-crate-v3-admin-header-actions.md) enumera los glifos propios
de cada operación y supera las propuestas anteriores de mantener sus botones textuales.
Confirmaciones finales y contextos fuera de esas cabeceras conservan texto. La fila de playlists
usa Edit, Activate/Deactivate y Delete como tooltip, nombre accesible con objeto, objetivos44px
y una sola capa de padding16px. Las propuestas restantes incluyen Add rule, Upload/Replace
cover, Delete/Copy de Users, Restore/Delete de Trash y Download de releases; siguen sin aplicar.


## Enmienda Incoming y catálogo Solar — mismo1AQlocal

Diego aprobó Open album/Download/Dismiss de la fila Incoming como icon-only:73sitios revisados,
48aplicados,10propuestos y15en su fase. La matriz/hash actual conserva ese alcance; AIButton
registra su contrato Bot/spinner por separado. Solar es el iconset oficial de nuevo trabajo en
ambas apps; no se ha migrado en masa todo Lucide heredado. Las migraciones quedan ahora pausadas
para el catálogo de reconciliación global solicitado por Diego, antes de otro grupo de iconos.
