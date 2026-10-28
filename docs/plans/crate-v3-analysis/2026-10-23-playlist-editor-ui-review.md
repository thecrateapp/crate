# Revisión de PlaylistEditor — 23 octubre 2026

**Actualización, 24 octubre 2026:** los 12 findings de esta revisión están corregidos. El diagnóstico siguiente conserva el estado anterior como evidencia; el cierre y el requisito Full Smart Mix se documentan al final.

La normalización es parcial. La cabecera usa PageHeaderLayout y acciones comunes, pero el cuerpo conserva una composición de tarjetas, captions y controles que no sigue de forma consistente el patrón actual. Se confirman 12 findings: seis P2 de comportamiento y seis P3 de presentación o reutilización. No se han confirmado P0/P1.

Referencia: [guía de Admin](../../../app/ui/ADMIN_UI_REVIEW_CHECKLIST.md), Listen y componentes actuales de `@crate/ui`. Se contrastaron también las [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). La revisión no modifica código.

## P2 — Comportamiento y accesibilidad

### 01 · Las actualizaciones independientes pueden borrar el borrador

[PlaylistEditor.tsx:586](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:586).

El efecto vuelve a copiar todos los campos desde `surface` cada vez que cambia la respuesta. Subir o quitar portada y añadir, quitar o reordenar pistas terminan en `refetch()`. Por tanto, editar nombre, descripción o reglas y después realizar una de esas operaciones puede sobrescribir cambios pendientes con los valores guardados. No depende del SSE: el problema está en la reinicialización tras el refetch.

**Corrección:** separar estado persistido y borrador; inicializar por identidad y mantener los campos modificados hasta guardar o descartar. Cubrir la secuencia «editar descripción → modificar portada/pistas → conservar descripción pendiente».

### 02 · La preview permanece válida en apariencia después de cambiar las reglas

[PlaylistEditor.tsx:740](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:740), [PlaylistEditor.tsx:1618](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1618).

`preview` solo se limpia al pedir otra preview. Cambiar match, rules, limit o sort mantiene los resultados anteriores; Apply preview invoca `handleGenerate`, que usa las reglas actuales. El resumen mostrado y la operación ejecutada pueden referirse a condiciones distintas.

**Reproducido en navegador:** High Vis, límite 30, Preview; cambiar límite a 31 conserva la preview y transforma el CTA en Apply preview to playlist, sin advertencia de obsolescencia.

**Corrección:** vincular la preview a una revisión de reglas, invalidarla o marcarla obsoleta al editar e impedir aplicarla hasta actualizarla. Conservar una semántica explícita de generación, especialmente con sort random.

### 03 · Save rules guarda también los datos editoriales

[PlaylistEditor.tsx:1601](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1601), [PlaylistEditor.tsx:681](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:681).

El botón llama al mismo `handleSave` de la cabecera y envía nombre, descripción, categoría, rank y visibilidad. El alcance real supera el que promete su etiqueta. A su vez Generate guarda reglas y puede provocar el refetch del finding 01.

**Corrección:** establecer un único guardado global claramente identificado o implementar un guardado de reglas realmente acotado. Evitar acciones con distinto nombre para el mismo handler.

### 04 · Los errores se presentan como ausencia o resultado vacío

[PlaylistEditor.tsx:520](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:520), [PlaylistEditor.tsx:665](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:665).

La carga inicial descarta `useApi.error`; un fallo termina en Playlist not found. En la búsqueda, el catch vacía los resultados y después se muestra No candidate tracks found. Un toast transitorio no corrige el estado persistente de la sección.

**Corrección:** LoadingState, ErrorState con reintento y EmptyState para respuestas vacías confirmadas, tanto en el editor como en candidatos. Referencia: `@crate/ui/domain/states` y PlaylistContent de Listen.

### 05 · La reordenación exige arrastre nativo

[PlaylistEditor.tsx:1914](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1914).

Las filas usan draggable/onDrop; GripVertical es un SVG sin control de foco o interacción equivalente. No hay alternativa de teclado y no se proporciona una estrategia táctil equivalente.

**Corrección:** seguir el patrón accesible de Listen: [PlaylistComposerTrackListView.tsx:71](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/playlists/PlaylistComposerTrackListView.tsx:71), con handle Button y sensores de teclado/táctiles, o acciones de mover arriba/abajo.

### 06 · Los valores numéricos se convierten antes de acabar de escribir

[PlaylistEditor.tsx:292](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:292), [PlaylistEditor.tsx:1529](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1529).

La condición simple usa Input de texto y convierte cada pulsación con Number. Una entrada intermedia como `0.` se reduce a `0`, el vacío se convierte en cero y el texto inválido puede producir NaN. Limit también vuelve a 50 al vaciarlo. Esto dificulta escribir valores decimales de energy/danceability y corregir límites.

**Corrección:** mantener el borrador textual, ofrecer inputMode y validar/convertir al confirmar. Mostrar errores junto al campo mediante FormField.

## P3 — Deriva visual y componentes

### 07 · Las secciones principales conservan títulos distintos del patrón

[PlaylistEditor.tsx:1162](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1162).

Editorial, Cover, Smart rules y Tracks son CardTitle blancos/display. Status y Generation history ya son MonoLabel accent. CardTitle produce un div por defecto, por lo que las secciones principales tampoco aparecen como headings en el árbol accesible.

**Corrección:** encabezados semánticos comunes, preferentemente InstrumentPanel con MonoLabel accent; campos y metadatos siguen en gris. La identidad del hero es un título de entidad y no debe convertirse en MonoLabel.

### 08 · Se acumulan superficies y recetas locales dentro de las secciones

[PlaylistEditor.tsx:1569](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1569), [PlaylistEditor.tsx:1726](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1726).

La composición combina Card, panel de preview tintado, panel de búsqueda tintado, propuestas con borde accent y otra caja por regla, candidato, métrica e historial. La jerarquía depende de cajas y opacidades locales. Además, la muestra de tracks rehace filas y las filas HairlineRow sobrescriben padding/separación propios en la línea 1925.

**Corrección:** mantener secciones y superficies justificadas; componer InstrumentPanel, lecturas compartidas y HairlineList/Row sin reconstruir su geometría. Card es un componente compartido válido: el problema es la composición y el número de niveles, no su importación.

### 09 · Status repite cuatro datos de la cabecera

[PlaylistEditor.tsx:2000](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:2000).

Tracks, Duration, Followers y Last generated ya aparecen en los pills del hero. Se vuelven a mostrar en cuatro cajas dentro de una Card y consumen una columna de 320 px sin añadir información. La cover también reaparece en otra sección y su explicación se repite.

**Corrección:** mantener cada cifra una vez; usar ese espacio para historial o estado operativo útil. Agrupar portada y descripción en Editorial Data y situar la edición de imagen sobre la portada si se adopta el patrón ya usado en artista.

### 10 · Formularios y búsqueda reconstruyen parte de la fundación

[PlaylistEditor.tsx:332](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:332), [PlaylistEditor.tsx:1729](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1729).

Field imita FormField con un span, sin htmlFor ni asociación de hint/error. Los controles sí reciben nombre por aria-label o placeholder: no se reportan como controles sin nombre. Falta la asociación al caption visible y contexto de regla para Field/Operator repetidos. Search tracks reconstruye icono, padding y debounce en vez de reutilizar SearchInput.

**Corrección:** FormField con IDs/labels y grupos de reglas identificados; SearchInput conservando la búsqueda diferida y el scope actuales.

### 11 · El botón de IA conserva una receta visual propia

[AIButton.tsx:32](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ui/AIButton.tsx:32), [AIButton.tsx:44](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/ui/AIButton.tsx:44).

El control genera un halo con gradiente/blur y un loop en reposo; el botón usa bg-black/85, borde accent y hover propios. Es otra receta frente a los botones y superficies solid comunes. Afecta a Generate description with AI y a otros consumidores del mismo componente.

**Corrección:** componer la acción de IA con Button/ActionButton y tokens comunes; conservar disponibilidad por actionId, estado ocupado y el Bot Solar aprobado. No se considera el robot decoración ni se atribuye un fallo de reduced-motion: existe una protección global.

### 12 · Las acciones de fila no usan la misma geometría que el header y Listen

[PlaylistEditor.tsx:1935](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1935), [PlaylistEditor.tsx:1322](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/PlaylistEditor.tsx:1322).

Remove track, Remove cover y Remove rule usan ActionIconButton, cuya receta es circular, 40 px con puntero fino y con desplazamiento al hover. Header y Listen Composer usan ActionButton ghost de 44 px. Son dos patrones de acción en el mismo editor.

**Corrección:** converger esos consumidores al ActionButton actual, manteniendo nombres contextuales y tooltip breve. Sus title props ya se transforman en TooltipHint: no hay tooltip nativo que retirar en esos casos.

## Comprobación y propuesta

- **Pass:** composición compartida del header, pills informativos, filtros binarios compartidos, AdminSelect como alias de Select compartido y tooltips de las acciones.
- **Needs change:** los 12 puntos anteriores. La copia de Smart rules («Keep the builder dense, but readable») también describe una instrucción de diseño en vez de ayudar al usuario; sustituirla al normalizar esa sección.
- **Not applicable:** menús o modales propios del editor; no existen en el alcance actual.

Se inspeccionó High Vis en el Admin local de la rama, incluida su preview. Se modificó únicamente Limit en un borrador temporal para comprobar la obsolescencia y se recargó para descartarlo. No se guardó, generó, refinó ni cambió ninguna portada o lista de pistas. Los fallos de red, borrador y teclado se confirman por el flujo de código; no se presentan como reproducciones realizadas en navegador. No se ejecutaron suites por tratarse de un análisis sin cambios de código. La rama mantiene cambios previos de la migración, ajenos a esta revisión.

Propuesta de implementación: corregir primero borrador/preview/alcance de guardado; después normalizar el cuerpo en Editorial Data (cover, descripción y visibilidad), Smart Rules, Preview y Tracks, con historial sin métricas repetidas. Conservar la cabecera y los flujos de generación/SSE, usando la fundación existente en vez de añadir nuevas variantes.

[Evidencia visual del panel de preview actual](/tmp/crate-playlist-editor-preview-audit.png).

## Cierre de implementación — 24 octubre 2026

| Finding                  | Estado | Corrección y evidencia                                                                                                                                                                |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Borrador            | Pass   | `usePlaylistEditorDraft` mantiene cambios por campo frente a snapshots/SSE y reconoce solo los valores enviados al guardar. Incluye cambios escritos mientras se espera la respuesta. |
| 02 · Preview             | Pass   | Cada resultado conserva la configuración enviada. Cambiar reglas, límite, orden o requisito Full lo marca Out of date y deshabilita su CTA de generación hasta recalcular.            |
| 03 · Alcance de guardado | Pass   | Un único Save changes guarda el borrador completo. Save rules + generate persiste únicamente reglas y auto-refresh; mantiene los cambios editoriales pendientes.                      |
| 04 · Estados             | Pass   | Estados compartidos de carga, error con Retry y ausencia confirmada. La búsqueda conserva el error de red hasta reintentar; un refetch fallido mantiene el borrador.                  |
| 05 · Reordenación        | Pass   | `PlaylistEditorTrackList` ofrece Move up/down accesibles, conserva drag y usa IDs de entradas. Bloquea acciones simultáneas y comunica errores sin anunciar éxito.                    |
| 06 · Números             | Pass   | Borrador textual, inputMode, validación al confirmar y errores asociados mediante FormField. Años se serializan como strings de cuatro dígitos.                                       |
| 07 · Secciones           | Pass   | InstrumentPanel con headings semánticos y MonoLabel accent. Form fields y metadatos mantienen su rol gris.                                                                            |
| 08 · Superficies         | Pass   | Composición plana en secciones y filas Hairline; se retiran las cajas locales por regla, muestra, candidato y métrica.                                                                |
| 09 · Repetición          | Pass   | Sin columna Status ni métricas duplicadas. La portada editable comparte Editorial data con la descripción; el historial queda al final.                                               |
| 10 · Fundación           | Pass   | FormField y SearchInput compartidos, asociaciones de labels, ayuda y errores; grupos por regla.                                                                                       |
| 11 · IA                  | Pass   | AIButton usa Button compartido, busy nativo y Bot Solar aprobado; se retiran halo, blur, fondo negro y loop en reposo.                                                                |
| 12 · Acciones            | Pass   | ActionButton de 44 px y Tooltip compartido en portada, reglas y pistas; glyphs Solar registrados por sitio concreto.                                                                  |

### Requisito Full Smart Mix

Creación y edición de playlists inteligentes comparten `PlaylistTrackRequirements`, justo debajo de Match / Limit / Sort. Se ofrece solo con soporte confirmado de `/api/capabilities.smart_mix.available`. Su estado no se borra si la consulta de capacidades falla o el servidor deja de anunciar soporte.

`smart_rules.require_full_mix_profile` aplica como AND independiente de Match all/any. Un perfil válido requiere calidad `full`, las versiones canónicas vigentes de schema y analizador, y `source_stale_at IS NULL`. El motor aplica exactamente la misma condición al conteo, la selección, la ruta optimizada de género y las expansiones. No necesita migración; vive en el JSON de reglas. False/ausencia conservan el comportamiento anterior; un true guardado puede desactivarse explícitamente.

El requisito afecta a la selección automática. Las pistas añadidas manualmente o bloqueadas son overrides de curación y se conservan al regenerar; la ayuda del control lo explica. La preview es una simulación de candidatos, no una promesa de la lista final con overrides o sort random.

En el navegador local se comprobó High Vis: 33 coincidencias sin el requisito y 17 con Full vigente, con el mismo resto de reglas. Desactivarlo tras calcular la preview mostró Out of date y deshabilitó Generate current rules. Se revisó también la presencia del control en New smart playlist. Solo se editaron borradores y se ejecutaron previews; se descartaron al terminar. No se guardaron playlists ni se generaron pistas en esta comprobación manual.

[Captura del requisito Full en el editor](/tmp/crate-playlist-full-smart-mix.png).

Corrección adicional en creación: Year y sus rangos ya no se convierten a número, evitando el 422 del contrato existente; BPM y el resto de campos numéricos mantienen su tipo. Cubierto con casos de creación simple y Between, incluido Full activado.

### Validación

- Backend focal: **30 pruebas correctas** (`test_playlist_full_mix_profile`, contrato de reglas, relevancia de género y fronteras DB).
- La suite backend ampliada tuvo 70 pruebas correctas y dos fallos en expectativas de identidad global→local para overrides manual/locked. Esos dos casos llaman directamente al regenerador y no pasan por el motor modificado; se mantienen fuera de este corte y se registran como limitación de esa suite, no como un pase completo.
- Admin completo: **195 archivos / 1.927 pruebas correctas**, con `--maxWorkers=2`. Las dos suites focales finales de creación/edición Smart Mix pasan otras 15 ejecuciones de prueba, incluidas las regresiones añadidas después de arrancar la suite completa.
- Build de Admin (incluye TypeScript), lint global y comprobación del catálogo de componentes: correctos. El build conserva el aviso de tamaño de chunks existente.
- La primera ejecución de Admin sin limitar workers agotó tiempos bajo carga; se corrigieron dos aserciones asíncronas y la pasada completa limitada terminó sin fallos. No se aumentaron timeouts ni se cambiaron los defaults de la suite.
- La búsqueda conserva Matching rules al llegar el primer snapshot inteligente y aclara que usa reglas guardadas; Preview evalúa el borrador. Las acciones de preview respetan también un guardado global pendiente.
- Consola del navegador local sin errores durante la comprobación final. Borradores descartados: no queda ningún cambio guardado por la prueba manual.

No se modificó producción. Se recargaron únicamente API y workers locales de esta rama para probar el nuevo motor. El frontend sigue servido en 5175 por el servicio supervisado del worktree.
