# Review de Admin — 24 de octubre de 2026

Revisión del estado actual de `feat/crate_v3` en `/home/diego/.codex/worktrees/crate-v3-1q/crate`, incluidos los cambios sin commit. El informe anterior del 23 de octubre y la revisión de PlaylistEditor son cortes cerrados: aquí se registran problemas que siguen presentes, sin volver a dar por abiertos sus findings corregidos.

> **Seguimiento: 29/29 corregidos.** Las correcciones y su validación final (202 suites / 2.032 pruebas en verde, lint, TypeScript y build) se registran en el [informe de cierre](2026-10-24-admin-findings-resolution.md). El diagnóstico y la tabla de cobertura siguientes conservan el estado observado antes de las correcciones.

**Resultado: 29 findings — 3 P1, 20 P2 y 6 P3.** No se han aplicado correcciones durante esta revisión.

La migración visible ha avanzado: las cabeceras principales, los controles compartidos y la mayor parte de los instrumentos ya siguen el patrón. Los riesgos más importantes están ahora en la identidad de las peticiones, la conservación de borradores y la representación de estados desconocidos o pendientes. La deriva visual restante se concentra en flujos secundarios.

## Criterio y evidencia

- **P1:** una interacción puede terminar operando sobre una entidad distinta de la solicitada.
- **P2:** comportamiento, datos, accesibilidad o recuperación que puede impedir completar el flujo con confianza.
- **P3:** consistencia visual o capacidad secundaria de inspección.
- **Diagnóstico:** reproducción con el componente real y API simulada; no equivale a ejecutar una operación contra la base local.
- **Navegador:** observación en Admin local `http://127.0.0.1:5175`, a 1280 px de ancho. No se atribuye verificación móvil a una inspección de clases CSS.
- **Código:** recorrido de la ruta activa, sus componentes y contratos. Las hipótesis sin consumidor activo o las excepciones deliberadas se excluyen.

Referencias: [guía de revisión de Admin](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/ADMIN_UI_REVIEW_CHECKLIST.md), instrucciones de cada aplicación, Listen como referencia visual y los componentes existentes en `@crate/ui`. Se contrastaron también las [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), subordinadas a las decisiones del proyecto.

## P1

### A01. Users puede cambiar de cuenta visible y dirigir la siguiente escritura a la cuenta anterior

**Ubicación:** [Users.tsx:1348](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1348), también las respuestas de status y de sesiones.

Guardar roles de A, cerrar su diálogo, abrir B y recibir después la respuesta de A reemplaza `detail` por A. El diálogo permanece montado y las respuestas de mutaciones no comprueban la identidad actual. Las siguientes acciones usan `detail.id`, incluido el diálogo de contraseña.

**Diagnóstico confirmado:** la URL conservó `inspect=2`, la ficha pasó a mostrar al usuario 1 y el siguiente Save roles envió otro PATCH a `/api/auth/users/1/role`. La protección de la lectura inicial con AbortController no protege estas respuestas tardías.

**Corrección mínima:** ligar todas las respuestas y relecturas a la cuenta abierta y a una generación de petición; alternativamente, remontar por ID y rechazar respuestas obsoletas. Mantener desactivadas las acciones incompatibles mientras se guarda. Referencia de identidad/cancelación: [use-track-info.ts](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/hooks/use-track-info.ts).

### A02. Artist conserva datos auxiliares de A al navegar a B y puede encolar álbumes de A bajo B

**Ubicación:** [Artist.tsx:770](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Artist.tsx:770), acción en [Artist.tsx:982](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Artist.tsx:982).

`showsLoaded`, `missingLoaded`, `tidalMissingLoaded` y `allTrackTitles` no se reinician al cambiar el artista de la ruta. La navegación SPA reutiliza Artist. Complete discography construye la URL con B, pero puede obtener los álbumes/URLs del estado conservado de A.

**Diagnóstico confirmado:** después de cargar un lanzamiento Tidal de Alpha y navegar a Beta, se mostraba `Beta: Alpha release`; el callback enviaba el endpoint de Beta con la URL del álbum de Alpha. El backend acepta por separado el artista de la ruta y esas URLs. La visita real a Lovecraft no tenía candidatos ausentes: esa visita no se presenta como reproducción del fallo.

**Corrección mínima:** reiniciar el estado auxiliar por identidad, cancelar las lecturas anteriores y vincular cada resultado y acción al artista que lo produjo. Referencia: [use-artist-bio-enrichment.ts](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/artist/use-artist-bio-enrichment.ts).

### A03. I18n permite publicar o rechazar A mientras se está abriendo B

**Ubicación:** [I18nReview.tsx:329](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:329), acciones en [I18nReview.tsx:975](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:975).

La selección conserva `selectedBundle` anterior mientras carga el nuevo. Publish y Reject no comprueban ese estado de carga ni la identidad solicitada. **Diagnóstico confirmado:** con B pendiente, ambos botones seguían habilitados y Publish enviaba `/bundles/diagnostic-A/publish`.

**Corrección mínima:** identidad solicitada explícita, respuestas descartables y acciones bloqueadas hasta cargar esa identidad; error y Retry ligados a B. Usar los estados LoadingState/ErrorState existentes.

## P2

### A04. Guardar una traducción elimina otros cambios pendientes

**Ubicación:** [I18nReview.tsx:399](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:399).

Guardar A sustituye todo `messageDrafts` por el bundle persistido. Se pierden las ediciones de B y lo que se haya escrito durante la petición. Varias filas pueden guardar simultáneamente y sobrescribirse por orden de respuesta. **Evidencia:** código.

**Corrección mínima:** baseline persistido y valores dirty por clave; confirmar solo el valor enviado de A, conservando los cambios posteriores. La solución ya existe conceptualmente en [use-playlist-editor-draft.ts:164](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/playlists/use-playlist-editor-draft.ts:164).

### A05. Un refresco del nodo de género reemplaza sus borradores

**Ubicación:** [GenreTaxonomyTree.tsx:221](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/genres/GenreTaxonomyTree.tsx:221), refresco de cover en [GenreTaxonomyTree.tsx:241](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/genres/GenreTaxonomyTree.tsx:241).

El efecto depende del objeto `node` y reemplaza descripción, top-level, relaciones y propuesta cada vez que llega una nueva instancia, aunque sea el mismo slug. Por ejemplo, editar una descripción y completar la actualización del cover provoca `onRefetch`, reconstruye el nodo y puede borrar la edición pendiente. **Evidencia:** código del editor y su consumidor activo.

**Corrección mínima:** reiniciar al cambiar de identidad; para refrescos de la misma identidad, fusionar baseline y dirty fields. Reutilizar el enfoque de borradores ya aplicado a PlaylistEditor, sin cambiar la wheel.

### A06. Algunas respuestas de búsquedas y filtros no están ligadas a la consulta actual

**Ubicación:** [Browse.tsx:291](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Browse.tsx:291), [Stack.tsx:479](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Stack.tsx:479), [Download.tsx:414](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:414).

En Browse, una respuesta lenta del filtro anterior puede reemplazar filas, total y paginación del nuevo. En Stack, los logs del servicio A pueden aparecer después de seleccionar B. Soulseek conserva resultados/stream al reducir la consulta por debajo del mínimo y tiene búsquedas superpuestas sin guardia de identidad. **Evidencia:** código.

**Corrección mínima:** AbortController y generación/clave de petición; limpiar o marcar explícitamente resultados de otra consulta. Referencia: las lecturas cancelables de Listen y el patrón de carga de ShowSourcePanel.

### A07. «Snapshot current» puede permanecer indefinidamente tras perder actualizaciones

**Ubicación:** [ops-surfaces.tsx:176](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/ops-surfaces.tsx:176).

OpsSnapshotStatus solo lee `stale` recibido; no hace caducar el snapshot según `stale_after` o su edad. Un snapshot inicialmente válido sigue diciendo Current aunque se interrumpa el stream o quede pausado durante mucho tiempo. Una propiedad `stale` ausente también cuenta como vigente. Afecta al patrón compartido de Tasks, Stack, Logs y Health. **Evidencia:** código; Dashboard ya dispone de una evaluación temporal de frescura.

**Corrección mínima:** resolver frescura con el contrato temporal del snapshot y actualizarla cuando vence. Mantener separado el estado del transporte del de los datos; ambos deben ser coherentes.

### A08. Datos desconocidos se presentan como ceros o estados negativos confirmados

**Ubicación:** [Analysis.tsx:56](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Analysis.tsx:56), [Download.tsx:368](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:368), [GlobalCatalog.tsx:130](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/GlobalCatalog.tsx:130).

Analysis normaliza el payload y elimina los flags de unavailable/stale del fallback de backend; termina mostrando 0 pistas y 0% como datos. Acquisition ignora estados de feeds auxiliares y puede declarar Tidal desconectado o cero descargas antes de saberlo. Global Catalog convierte `undefined` en 0 y errores de runs/duplicates en listas vacías; además, Refresh solo actualiza status, dejando esas otras dos superficies intactas.

**Evidencia:** código y observación del estado inicial de Global Catalog en navegador: métricas 0, read model Unknown y «No reconciliation runs yet» en la misma carga.

**Corrección mínima:** representar unknown/loading/error/stale antes de formatear números; conservar el último dato correcto y ofrecer Retry por feed. Refresh debe abarcar la superficie que anuncia refrescar. Referencia: PlaybackDelivery y Resource Governor ya distinguen estos estados.

### A09. Settings permite guardar valores predeterminados antes de leer la configuración

**Ubicación:** [Settings.tsx:881](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:881), carga de Soulseek en [Settings.tsx:798](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:798).

Downloads muestra controles editables con ventana desactivada, 02:00–07:00 y límites ilimitados mientras las lecturas siguen pendientes o fallan. Una edición puede guardar esos defaults sin haber mostrado la política real; una respuesta tardía también puede sustituir lo escrito. Soulseek conserva FLAC/320 y mensajes de desconexión tras fallar su lectura. **Evidencia:** código.

**Corrección mínima:** bloquear cada grupo hasta disponer de un valor confirmado, mostrar error/Retry y reutilizar los datos de Settings ya cargados. Referencia: ScrobbleSettingsView de Listen.

### A10. Los autosaves fallidos de Settings parecen aplicados

**Ubicación:** [Settings.tsx:1287](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:1287), helpers en [Settings.tsx:141](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:141).

Extensiones, calidad, procesamiento y política cambian localmente antes del PUT; si falla, el helper captura el error y la selección permanece como si el servidor la hubiera aceptado. Los guardados consecutivos tampoco se coordinan. **Evidencia:** código.

**Corrección mínima:** baseline confirmado, estado pending/error por grupo, serialización o rechazo de respuestas antiguas y rollback/refetch al fallar. Referencia: [ScrobbleSection.tsx:85](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/ScrobbleSection.tsx:85) y el propio savePathsSetting.

### A11. Persisten errores que se convierten en empty states, contenido en blanco o selectores vacíos

**Ubicación:** [Playlists.tsx:254](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Playlists.tsx:254), [Upcoming.tsx:299](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Upcoming.tsx:299), [Album.tsx:275](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Album.tsx:275).

Casos activos adicionales: Audit en Settings; detalle de Users; usage/activity auxiliares de AI Models; lecturas de shows/missing de Artist; Move/Merge de Album; Find similar; opciones de reglas de [Playlists.tsx:919](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Playlists.tsx:919); expansión de tracks de Acquisition. Un fallo inicial puede decir «No playlists», «No upcoming shows», «No similar tracks», dejar solo la cabecera de un diálogo o un Genre selector sin opciones. Algunas cargas fallidas se marcan como loaded o se cachean como `[]`, impidiendo reintentar. **Evidencia:** código.

**Corrección mínima:** separar loading/error/empty/data, no confirmar loaded ante error, mantener datos anteriores como stale y ofrecer Retry junto a cada lectura. En creación smart, impedir enviar una regla cuyo catálogo requerido no está disponible. Referencias: ErrorState/LoadingState compartidos, Bandcamp ReadState y ShowSourcePanel.

### A12. Varias confirmaciones descartan la promesa y pierden el bloqueo de envío

**Ubicación:** [Dashboard.tsx:447](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Dashboard.tsx:447), [Tasks.tsx:1794](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Tasks.tsx:1794), [Users.tsx:1231](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1231).

También Stack, Trash, Health, Playlists y Browse tienen callbacks `onConfirm={() => { void ... }}`. ConfirmDialog espera la promesa para mantener pending y cerrar al terminar; estos callbacks devuelven inmediatamente. Se cierra la confirmación y se pierde su protección contra repetición mientras la operación sigue pendiente; errores capturados por el caller tampoco llegan al contexto de reintento. **Evidencia:** callers y [contrato de ConfirmDialog:104](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/shared/ui/composites/ConfirmDialog.tsx:104).

**Corrección mínima:** devolver/esperar la promesa, mantener el diálogo y propagar el fallo a onError o estado controlado. No hace falta crear otro componente. Referencias correctas: confirmación de Imports y Paths de Listen.

### A13. Las acciones de biblioteca no respetan de forma consistente las capabilities

**Ubicación:** [Browse.tsx:647](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Browse.tsx:647), [Album.tsx:1181](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Album.tsx:1181), [Artist.tsx:1410](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Artist.tsx:1410), [Health.tsx:679](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Health.tsx:679).

Rutas legibles con library.view muestran algunas mutaciones sin comprobar su permiso específico. Analyze y Run scan usan isAdmin, ocultando acciones a roles personalizados que sí tienen library.analysis.manage o library.repair.run. TrackTable recibe Sync lyrics sin su gate correspondiente. Discovery mantiene casos equivalentes. **Evidencia:** código de rutas, acciones y guards backend. El backend sigue autorizando: no es un bypass de seguridad.

**Corrección mínima:** gates por la misma capability del endpoint y estados coherentes en header, menú y acciones en lote. Referencia: CapabilityRoute y los controles ya migrados de Imports/Users.

### A14. Acciones en lote y Wishlist anuncian éxito aunque haya fallos

**Ubicación:** [Browse.tsx:147](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Browse.tsx:147), [Download.tsx:587](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Download.tsx:587).

Batch Enrich/Analyze captura errores por elemento y luego anuncia éxito para toda la selección y la borra. Promote wishlist captura el PUT fallido y continúa hasta success; Download all y algunos borrados de fila también pierden el resultado parcial. **Evidencia:** código.

**Corrección mínima:** contar enviados/fallidos, conservar selección fallida y mostrar un resultado parcial con Retry. Referencia local: batchDelete ya conserva el desglose mejor que estos handlers.

### A15. Algunas tareas se dan por terminadas al encolarlas o no muestran el fallo terminal

**Ubicación:** [Bandcamp.tsx:165](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:165), [Upcoming.tsx:404](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Upcoming.tsx:404), [NewReleases.tsx:572](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/NewReleases.tsx:572), [Dashboard.tsx:473](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Dashboard.tsx:473).

Bandcamp ignora task_id, refresca inmediatamente y libera busy; Upcoming hace una sola lectura a los diez segundos. Si el worker tarda, la vista queda sin actualizar ni resultado terminal. Release Radar espera la tarea, pero failed solo libera busy sin feedback de error. Dashboard dice «Library database wiped» ante la respuesta que solo encola el trabajo. **Evidencia:** código y contratos de los endpoints; el test actual de NewReleases incluso permite cero error toasts para failed.

**Corrección mínima:** usar task_id y el seguimiento existente hasta completed/failed/cancelled; distinguir queued de completed y refrescar al terminar. Referencias: Imports, Trash y useRemoteImport de Listen.

### A16. Library Health solo puede seguir una tarea aunque permite lanzar varias

**Ubicación:** [Health.tsx:520](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Health.tsx:520), [Health.tsx:618](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Health.tsx:618).

Scan, reparación y cleanup comparten activeTaskId. Se pueden iniciar flujos cuyos botones usan flags distintos; el segundo reemplaza la tarea observada. Su terminación puede limpiar los dos estados o anunciar Scan complete aunque el scan original siga corriendo. **Evidencia:** código.

**Corrección mínima:** seguir tareas por operación/ID o impedir explícitamente la concurrencia incompatible. Los mensajes deben proceder de la operación que realmente terminó, no del flag global.

### A17. La creación smart no valida el mismo contrato que el editor

**Ubicación:** [Playlists.tsx:987](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Playlists.tsx:987), contrato en [playlist_rule_contract.py:37](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/crate/playlist_rule_contract.py:37).

Create & open permite BPM `abc`, año `24`, límite 501 o trece reglas completas con valor. Las reglas vacías se omiten del payload, por lo que añadir una decimotercera vacía no reproduce el rechazo. Number puede producir NaN/null; cero o vacío se sustituye silenciosamente por 50. La API rechaza el payload y la UI solo devuelve un toast genérico. La nueva exigencia Full Smart Mix y la serialización válida de año no son el problema. **Evidencia:** código frontend y contrato backend.

**Corrección mínima:** reutilizar la validación textual del editor, errores FormField, rangos enteros, año de cuatro cifras y máximo de doce reglas. Mantener un único contrato de interacción en creación y edición.

### A18. Muchos controles de Settings carecen de un nombre accesible asociado

**Ubicación:** [Settings.tsx:260](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:260); ejemplos de controles en [Settings.tsx:957](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:957) y [Settings.tsx:1554](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Settings.tsx:1554).

FieldRow dibuja MonoLabel como span separado del Input. Bitrate, límites, horarios, procesamiento y Telegram tienen campos sin asociación label/id ni aria-label; varios number/time son indistinguibles para lector de pantalla. **Evidencia:** código del wrapper y callers.

**Corrección mínima:** FormField con asociación y hints, y nombres individuales para inicio/fin de los horarios. Referencias: FormField compartido y AccountSectionForms/SettingsPrimitives de Listen.

### A19. Find similar conserva un diálogo paralelo sin comportamiento modal completo

**Ubicación:** [SimilarTracksPanel.tsx:55](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/track/SimilarTracksPanel.tsx:55), consumidor activo en TrackTable.

`<dialog open aria-modal>` no usa showModal ni el sistema de foco/inert/restore compartido. Mantiene ancho fijo de 500 px, overlay negro propio, cierre pequeño y medidor/labels locales de 9 px. Declarar aria-modal no implementa el bloqueo de fondo. Su error de lectura también se convierte en «No similar tracks». **Evidencia:** código.

**Corrección mínima:** AppModal con OverlayCloseButton, estados compartidos y un cuerpo responsive compuesto con las recetas actuales. Referencia: el Audio profile del mismo TrackTable y ArtistSetlistView de Listen.

### A20. La navegación del grafo de artistas depende del clic derecho

**Ubicación:** [ArtistNetworkGraph.tsx:435](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/artist/ArtistNetworkGraph.tsx:435).

El clic normal expande; el clic derecho navega al artista o Acquisition. El tooltip dice «Click to navigate». No hay acción equivalente accesible por teclado o una interacción táctil explícita. **Evidencia:** código; no se confunde el canvas con un componente DOM ordinario.

**Corrección mínima:** selección de nodo con acciones visibles Open/Expand y una lista alternativa navegable; corregir la instrucción. Componer las acciones con ActionButton/Tooltip compartidos y mantener la visualización.

### A21. La selección en lote de Browse mantiene una barra rígida del sistema anterior

**Ubicación:** [Browse.tsx:648](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Browse.tsx:648).

La barra fija contiene contador, tres acciones, Select all y Cancel en una fila sin wrap ni scroll. Su estructura no cabe en un viewport estrecho. Además conserva blur, botones de texto con iconos y una receta local, frente al ActionGroup actual. **Evidencia:** código; el overflow estrecho requiere verificación visual al corregirlo, no se ha medido en dispositivo.

**Corrección mínima:** composición responsive con ActionGroup y acciones icon-only/Tooltip; conservar contador y resultado parcial, sin mover la excepción de covers cuadrados de Browse.

### A22. Insights usa etiquetas truncadas como identidad de categorías

**Ubicación:** [Insights.tsx:267](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Insights.tsx:267), [Insights.tsx:670](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Insights.tsx:670).

Album Standouts usa el nombre del álbum truncado como indexBy. Dos álbumes homónimos o con los mismos primeros caracteres colisionan en la escala/identidad del gráfico. Hay transformaciones equivalentes para otros nombres y en estadísticas del artista. No es solo una elipsis visual. **Evidencia:** datos transformados y configuración Nivo.

**Corrección mínima:** IDs estables o claves completas inequívocas; truncar únicamente el texto mostrado por los ejes y mantener nombre/artista completo en el tooltip.

### A23. System Health no aplica reduced motion a sus gráficos

**Ubicación:** [SystemHealth.tsx:465](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/SystemHealth.tsx:465).

Las trece instancias de MetricChart usan ResponsiveLine con animación por defecto y sin conectar la preferencia de movimiento reducido. Con métricas en vivo, la excepción se repite en toda la página. **Evidencia:** código.

**Corrección mínima:** usar el hook/patrón de motion existente y pasar animate acorde. Referencia: Insights ya contempla esta preferencia; no es necesario desactivar la actualización de los datos.

## P3

### A24. Los metadatos de Logs se cortan sin forma de inspeccionarlos

**Ubicación:** [Logs.tsx:181](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Logs.tsx:181).

JSON se dibuja en una única línea con overflow hidden/ellipsis. La búsqueda puede encontrar una parte que el operador no puede leer ni expandir. **Corrección mínima:** disclosure o StructuredValue en un panel accesible, conservando la fila compacta. Referencia: detalle técnico de Tasks. **Evidencia:** código.

### A25. El popup del calendario de Show Management mantiene la presentación antigua

**Ubicación:** [ShowCard.tsx:428](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/shows/ShowCard.tsx:428), consumidor en [Upcoming.tsx:1340](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Upcoming.tsx:1340).

El evento expandido usa gradiente negro, opacidades blancas, géneros locales de 9 px y receta de acciones propia. El mismo show cambia de fundamento entre lista y calendario. **Corrección mínima:** preview compacto con MonoLabel, GenrePillRow, tokens y ActionGroup, tomando como referencia UpcomingShowExpandedView de Listen. **Evidencia:** código del consumidor activo; se excluye el title de la rama colapsada sin uso.

### A26. Los interiores de Agents aún duplican labels, superficies, campos y tooltips

**Ubicación:** [ImpactSummary.tsx:16](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/agents/plan/ImpactSummary.tsx:16), [ChangeList.tsx:33](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/agents/plan/ChangeList.tsx:33), [PermissionPicker.tsx:324](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/agents/connections/PermissionPicker.tsx:324).

Impact y Before/After usan labels manuales, white/black con opacidades y una flecha decorativa. Connect agent mantiene wrappers de campo propios. PermissionPicker y [ConnectionSheet.tsx:172](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/agents/connections/ConnectionSheet.tsx:172) tienen `span title` nativos para permisos. **Corrección mínima:** MonoLabel, FormField, tokens semánticos y Tooltip existente; mantener los componentes de dominio en Admin. **Evidencia:** código y visita a Connections para contrastar su contexto real.

### A27. Los paneles secundarios de Federation no usan la jerarquía de sección actual

**Ubicación:** [PairingPanel.tsx:49](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/federation/PairingPanel.tsx:49), [SecurityPanel.tsx:61](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/federation/SecurityPanel.tsx:61), [DirectoriesPanel.tsx:99](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/federation/DirectoriesPanel.tsx:99).

Pairing, Key material, Risk y Signed directories siguen usando CardTitle con tipografía de cuerpo/display pequeña; campos relacionados conservan composiciones locales. No se marca como fallo la mera importación de Card ni se afirma que los inputs con aria-label estén sin nombre. **Corrección mínima:** composición de sección con MonoLabel y FormField/tokens compartidos. **Evidencia:** código y visita de Overview; no se realizaron pairing ni cambios de política.

### A28. El buscador global de Admin tiene un dropdown de presentación paralelo al de Listen

**Ubicación:** [SearchBar.tsx:437](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/layout/SearchBar.tsx:437).

In library/Recent, captions y tipos usan tamaños locales de 10–13 px, white/opacity y hover blanco, en vez de las recetas semánticas y MonoLabel del dropdown de Listen. **Corrección mínima:** alinear la presentación con TopBarSearchDropdownView, manteniendo separados los controladores de búsqueda. Extraer un fundamento compartido solo si ambos consumidores lo usan, sin copiar CSS entre aplicaciones. **Evidencia:** código de ambos consumidores activos.

### A29. Parte de la paleta de Insights continúa fijada a colores literales

**Ubicación:** [Insights.tsx:64](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Insights.tsx:64), [Insights.tsx:677](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Insights.tsx:677).

Series y texto del tema contienen cyan/white literales; se separan de los tokens del producto al cambiar accent/tema. **Corrección mínima:** resolver tokens para Nivo como ya hace ArtistStats; conservar la semántica de cada serie. **Evidencia:** código. Reduced motion en Insights sí pasa y no forma parte de este finding.

## Cobertura

“Sin finding nuevo” significa que el recorrido de código revisado no aportó una desviación accionable adicional; no certifica todas las combinaciones del servidor, navegador o rol.

| Página / flujo activo                                     | Resultado                   | Findings / alcance                                                                                    |
| --------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Dashboard                                                 | Needs change                | A12, A15; snapshot temporal propio revisado                                                           |
| Browse, grid/lista, selección en lote                     | Needs change                | A06, A12–A14, A21; navegador ancho; covers cuadrados preservados                                      |
| Artist y tabs, repair, discography                        | Needs change                | A02, A11, A13, A20, A22; diagnóstico aislado + visita real                                            |
| Album, TrackTable, Audio profile, Move/Merge/Find similar | Needs change                | A11, A13, A19; cambios recientes de Audio profile no se reabren                                       |
| Discovery                                                 | Needs change                | A13; cabecera y controles principales sin nuevo finding visual                                        |
| Library Health                                            | Needs change                | A07, A12, A13, A16                                                                                    |
| Library Trash                                             | Needs change                | A12; empty state corregido conservado                                                                 |
| Acquisition / Tidal / Soulseek / Wishlist                 | Needs change                | A06, A08, A11, A14                                                                                    |
| Staged Imports                                            | Sin finding nuevo           | Estados, revisión, confirmación y seguimiento terminal revisados                                      |
| Contributions                                             | Sin finding nuevo           | Cabecera, filas y recuperación revisadas                                                              |
| Show Management, Add/Merge y calendario                   | Needs change                | A11, A15, A25; import/review y merge con guardias actuales                                            |
| Bandcamp                                                  | Needs change                | A15; estados de lectura ya corregidos conservados                                                     |
| Release Radar                                             | Needs change                | A15                                                                                                   |
| Insights                                                  | Needs change                | A22, A29                                                                                              |
| Genres árbol/grid, detalle y curation                     | Needs change                | A05; inspección sin modificar el diseño ni la taxonomía                                               |
| Playlists lista + creación                                | Needs change                | A11, A12, A17                                                                                         |
| PlaylistEditor                                            | Sin nuevo finding principal | Validación, draft merge, tracks, Full Smart Mix y capacidad revisados; ver límite de navegación abajo |
| Analysis                                                  | Needs change                | A08                                                                                                   |
| System Health + Smart Mix                                 | Needs change                | A23; métricas y componentes recientes revisados                                                       |
| Playback Delivery                                         | Sin finding nuevo           | Distinción de pending/error/stale y acciones revisada                                                 |
| Tasks, lanes, governor, desk                              | Needs change                | A07, A12; lanes y governor sin nuevo finding de estilo/estados                                        |
| Stack                                                     | Needs change                | A06, A07, A12                                                                                         |
| Logs                                                      | Needs change                | A07, A24                                                                                              |
| Users y diálogos                                          | Needs change                | A01, A11, A12; prueba de escritura cruzada completamente simulada                                     |
| Roles                                                     | Sin finding nuevo           | Catálogo/matriz intencionalmente de lectura                                                           |
| AI Models y paneles                                       | Needs change                | A11; conflictos, revisions, permisos y acknowledgement revisados                                      |
| Settings, siete secciones                                 | Needs change                | A09–A11, A18                                                                                          |
| I18n, cuatro tabs                                         | Needs change                | A03, A04; prueba aislada de bundle incorrecto                                                         |
| Agents, approvals, plan y connections                     | Needs change                | A26; visita de Connections sin crear ni ampliar acceso                                                |
| Federation, paneles                                       | Needs change                | A27; visita de Overview sin mutaciones                                                                |
| Global Catalog, tres tabs                                 | Needs change                | A08; observación del estado inicial en navegador                                                      |
| Login / Setup                                             | Sin finding nuevo de UI     | Código de formularios y estados; no se ejecutó setup ni se cambió autenticación                       |
| Shell, avatar, búsqueda, navegación                       | Needs change                | A28; componentes actuales revisados                                                                   |
| Redirects profile/timeline/legacy genre/agents            | Sin superficie adicional    | Se revisaron como navegación; no se auditó una página legacy sin consumidor                           |

## Validación, exclusiones y límites

- **Tres diagnósticos de Admin confirmados:** un caso de Artist y dos de Users/I18n. Son pruebas temporales que afirman el comportamiento defectuoso, con APIs simuladas; no son tests de corrección ni se añadieron al repositorio. Evidencia: [Artist](/tmp/admin-library-review-check/artist-readonly-diagnostic.test.tsx), [Users/I18n](/tmp/crate-admin-management-diag-oct24/results.md).
- Navegador local: Browse, Artist/Discography, Global Catalog, Federation y Agents/Connections. La revisión del resto combina código de rutas/componentes, contratos y tests existentes. No se simularon fallos de red en la base real.
- No se ejecutó audio, reparación, descarga, borrado, publicación de traducciones, modificación de usuarios ni creación de credenciales. No se tocó producción. Listen local se inició contra el backend local para contrastar patrones y realizar su informe independiente.
- No se ejecutó la suite completa durante esta revisión de lectura; no se atribuyen sus resultados históricos a este corte.
- No se elevan como findings la mera existencia de Card/Lucide, los instrumentos SVG/canvas, excepciones funcionales aprobadas o `title` que un wrapper consume mediante Tooltip. Browse conserva intencionalmente imágenes cuadradas.
- La verificación estrecha, táctil y con lector de pantalla queda pendiente para cada corrección. Las afirmaciones de layout estrecho de este informe se identifican como inspección de código.
- Seguimiento menor sin elevar: proteger navegación con borradores pendientes en PlaylistEditor/Genre Management; labels locales de candidatos Add Show; enlaces externos Bandcamp aún implementados como botones. No se afirma que una clase h-9 determine la altura real sin contrastar la cascada de crate-form-control.

## Orden recomendado de corrección

1. A01–A03: identidad de usuario, artista y bundle antes de cualquier refinamiento cosmético.
2. A04–A16: conservar trabajo, representar datos desconocidos, esperar operaciones y comunicar resultados reales.
3. A17–A23: contrato de creación, accesibilidad, capacidades de navegación y responsive/motion.
4. A24–A29: rematar flujos secundarios usando los componentes existentes y contrastarlos visualmente con Listen.

Cada corrección debe añadir su regresión, ejecutar la suite focal y verificarse en el flujo real. Las pruebas de los P1 deben resolver respuestas fuera de orden y comprobar tanto la entidad visible como el destino de las acciones disponibles durante y después del cambio de identidad.
