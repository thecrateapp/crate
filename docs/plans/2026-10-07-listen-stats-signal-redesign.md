# Listen Stats: rediseño "Signal" (desktop one-page) + Wrapped móvil

> **Estado (2026-11-18):** Implementado (PR #275: zona horaria, días sucios, periodos de año natural, página Signal y Wrapped, luego Crate Digging). Hueco menor: el percentil por artista ('top 1%').

**Estado:** plan aprobado el 2026-10-07 (decisiones D1–D5 resueltas).

**Objetivo:** convertir Stats en un Wrapped en tiempo real. En desktop, una página única (variante A "Editorial" con piezas de B "Bento") encabezada por la cinta de señal con selectores que filtran toda la página. En móvil, una experiencia de capítulos tipo stories con export a Instagram.

**Maquetas de referencia:** `/tmp/stats-mockups/onepage.html` (A/B/C, desktop) e `index.html` (propuesta 02, móvil). Las maquetas usan números sintéticos.

**Relación con `docs/plans/roadmap/08-listening-recap-design.md`:** este plan implementa la parte de "Stats coherentes y eficientes" y un recap privado renderizado en cliente. Respeta su semántica: `listening-v1`, `[inicio, fin)`, UTC por defecto, descubrimiento como "primera escucha registrada", no inferir zona por IP y rebuild completo como oráculo. Los enlaces públicos revocables, `user_replay_generations` y `replay_share_tokens` quedan fuera: el export a Instagram se renderiza en el dispositivo y no publica nada en el servidor.

---

## Reglas de implementación

- TDD por comportamiento: test que falla → implementación mínima → suite focalizada en verde.
- Toda agregación ocurre en worker o projector. Ningún handler HTTP de Stats suma sobre `user_play_events` ni sobre `library_tracks`, y el dashboard se sirve siempre desde `ui_snapshots`.
- SQL nuevo en módulos concretos de `crate/db/queries`, `crate/db/repositories` o `crate/db/jobs`, nunca a través de `crate.db.__init__`.
- Contrato del dashboard solo aditivo: no se borran ni renombran campos existentes mientras la app publicada los lea.
- Go readplane en paridad: cualquier cambio en la clave del snapshot se replica en `stats_dashboard.go` con su test.
- Cada PR deja la página funcional. Las secciones nuevas se ocultan si el payload aún no trae sus campos.
- Commits convencionales, sin atribución.

## Decisiones (resueltas el 2026-10-07)

| # | Decisión | Resolución |
|---|---|---|
| D1 | El selector "Año": ¿año natural (`period=year&year=2026`) o 365 días móviles (`window=365d`)? | **Año natural.** `365d` se mantiene en backend por compatibilidad. |
| D2 | Zona horaria: ¿se toma la del dispositivo automáticamente o la elige el usuario en Ajustes? | **Detección automática** desde el navegador o dispositivo (`Intl`): si el usuario no tiene zona guardada, el cliente la guarda en silencio al arrancar. Si la guardada no coincide con la del dispositivo, no se cambia sola (evita reconstruir al viajar); Ajustes la muestra con "Usar la del dispositivo". Hasta la primera detección, UTC. |
| D3 | Gráficas: ¿la cinta y el heatmap en SVG propio o en Nivo? `AGENTS.md` dice "Charts use Nivo". | **SVG propio** con excepción documentada: 365 barras animadas, cursor y tooltip a 60 fps sin el coste de Nivo. Se deja escrito en `app/listen/AGENTS.md`. |
| D4 | El dato "top 1% de sus oyentes en Crate" del artista del periodo necesita un ranking de oyentes de toda la instancia. | Se mueve a la fase 5 (snapshot de instancia). Hasta entonces no se muestra. |
| D5 | Hueco que separa dos sesiones de escucha. | 30 minutos entre el `ended_at` de una escucha y el `started_at` de la siguiente. |

---

## Fase 0: línea base y red de seguridad

**Objetivo:** medir antes de tocar nada y tener tests de regresión.

1. Fixtures de volumen para tests de backend: 0 eventos, pocos, 10k y 100k eventos para un usuario (generador en `app/tests/fixtures/`). Medir:
   - la duración de `refresh_user_listening_stats`;
   - la duración del build de `stats:dashboard` para 30d, 365d y all_time;
   - el número de queries.

   Los resultados se dejan anotados en este plan.
2. Test de contrato del payload: un JSON de ejemplo en `app/tests/fixtures/stats_dashboard_v1.json`, validado contra el builder de Python y leído por el smoke de Go (`app/readplane/cmd/readplane-contract-smoke/`).
3. Spec visual de Stats en `tests/listen-visual/listen-pages.spec.ts` con fixture determinista, para desktop y móvil. Hoy no existe.

**Línea base medida (2026-10-07, 100k eventos en 4 años, 72 pistas, M-series local + Postgres en testcontainers):**

| Paso | ms | queries | payload |
|---|---|---|---|
| `recompute_user_listening_aggregates` | 476 | 42 | — |
| dashboard 30d | 697 | 21 | 55 KB |
| dashboard 365d | 637 | 18 | 95 KB |
| dashboard all_time | 785 | 16 | 224 KB |

**Archivos:** `app/tests/test_user_stats_dashboard_surface.py`, `app/tests/test_stats_api_contracts.py`, `tests/listen-visual/*`, `tests/listen-visual/fixtures.ts`.

---

## Fase 1: zona horaria y proyecciones incrementales (backend)

### 1.1 Zona horaria del usuario

- **Migración 104:**
  - `schema_sections/auth_v104.py` y `migrations/versions/104_user_timezone.py` añaden `users.timezone TEXT NULL`. `NULL` significa UTC.
  - Hay que actualizar `test_crate_schema_definition.py` (head a "104") y añadir el test de la migración.
- **Validación:** nombre IANA, validado con `zoneinfo.available_timezones()` en `api/schemas/auth.py`. Se expone en `UpdateProfileRequest` y en `AuthMeResponse`, siguiendo el patrón de `instagram_handle`.
- **Detección (D2):** al arrancar la sesión autenticada (web, Capacitor y Tauri), si `auth.me.timezone` es `null`, el cliente envía `Intl.DateTimeFormat().resolvedOptions().timeZone` con una sola llamada idempotente.
- **Listen:** un campo en Ajustes > Cuenta que muestra la zona y, si no coincide con la del dispositivo, un botón "Usar la del dispositivo". Va en los 7 catálogos de i18n.
- **Al cambiar la zona:** se encola un `rebuild_user_listening_projections(user_id)`, porque los días cambian de frontera, y se invalidan los snapshots `stats:dashboard` del usuario.

### 1.2 Días sucios (sustituye al "recalcula todo")

- **Tabla nueva** `user_listening_dirty_days(user_id, day DATE, marked_at)`, con PK `(user_id, day)`.
- **Marcado:** `record_play_event` (`user_library_playback_writes.py:136`) la marca dentro de la misma transacción, calculando el día con la zona del usuario. Los borrados y correcciones de eventos también marcan.
- **Refresh:** `refresh_user_listening_stats` (`worker_handlers/analysis.py:126`) recoge los días con `DELETE … RETURNING`. Para cada uno:
  - recalcula ese día desde `user_play_events` con un rango indexado `(user_id, ended_at)`;
  - reemplaza el bucket de forma atómica en todas las proyecciones por día.
- **Se mantiene sin cambios:** el debounce de 300 s y el dedup de la tarea.
- **Rebuild completo como oráculo:** se conserva `rebuild_user_listening_projections` y un test compara ambos caminos sobre las fixtures de la fase 0. La salida incremental debe ser igual a la del rebuild.

### 1.3 Proyecciones nuevas (todas por día, en la zona del usuario)

| Tabla | Clave | Columnas | Alimenta |
|---|---|---|---|
| `user_daily_listening` (existe) | `(user_id, day)` | Las actuales; el día pasa a calcularse en la zona del usuario. | La cinta, las rachas y los días activos. |
| `user_hourly_listening` | `(user_id, day, hour)` | `play_count`, `minutes_listened` | El heatmap hora×día y el porcentaje nocturno. |
| `user_track_daily` | `(user_id, day, track_key)` | `play_count`, `minutes_listened`, más `track_id`, `global_track_uid`, `artist`, `album` desnormalizados | Obsesión (máximo por día), picos de la cinta, evolución de géneros, curva de mood y décadas. |
| `user_entity_firsts` | `(user_id, entity_type, entity_key)` | `first_played_at`, `first_track_key` | Descubrimientos, "N artistas nuevos" y "desde el 3 de enero". Se actualiza con `LEAST`. |
| `user_listening_sessions` | `(user_id, started_at)` | `ended_at`, `track_count`, `minutes_listened` | La sesión más larga. Se recalculan las sesiones que solapan días sucios (±1 día). |

**Volumen esperado:** del orden de 24 filas por hora y día activo, y del orden de pistas distintas por día en `user_track_daily`. Para 5 años de uso intenso son unas 100k filas por usuario, siempre leídas por rango `(user_id, day)`.

**Índices:** PK compuestas que empiezan por `(user_id, day)`. Además, `user_entity_firsts(user_id, entity_type, first_played_at DESC)`.

**Archivos:**
- nuevos: `schema_sections/activity_v104.py`, `db/jobs/user_listening_projections.py`;
- modificados: `user_library_aggregate_runner.py`, `user_library_daily_aggregates.py`, `user_library_playback_writes.py`;
- tests: `test_user_listening_projections.py` (incremental frente a rebuild, zonas, DST, años bisiestos, el día que cruza medianoche), `test_user_stats_aggregates.py`.

### 1.4 El story deja de escanear `user_play_events`

Se reescriben las funciones de `user_library_stats_story.py` que escanean eventos crudos para que lean de las proyecciones:

| Función | Nueva fuente |
|---|---|
| `_rhythm_payload` | `user_hourly_listening` |
| `_discovery_rows` | `user_entity_firsts` |
| `_comeback_rows` | `user_track_daily` + `user_entity_firsts` |
| `_monthly_snapshots` | `user_daily_listening` + `user_track_daily` |
| `_artist_delta_rows` | Stats por ventana existentes |

El payload actual no cambia.

**Criterio de salida de la fase 1:**
- incremental idéntico al rebuild en todas las fixtures;
- con 100k eventos, el refresh tras una escucha nueva lee eventos de 1 o 2 días como mucho, nunca la historia completa;
- tiempos documentados frente a la fase 0.

---

## Fase 2: payload del dashboard v2 (aditivo) y periodos

### 2.1 Periodos

- **Selector:** 30 días (`window=30d`), 90 días (`window=90d`), Año (`period=year&year=YYYY`, según D1) y Siempre (`window=all_time`).
- **Límites:** `[inicio, fin)` calculados en la zona del usuario. El año en curso se marca con `provisional: true` y `computed_until`.
- **Clave del snapshot:** se añade la dimensión `year:YYYY`, en `stats_dashboard_subject_key` de Python y en `stats_dashboard.go:27-74` de Go, con tests en ambos.
- **Precalentado:** las cuatro vistas del selector (30d, 90d, año actual y all_time), no solo 30d. Afecta a `refresh_user_stats_dashboard_snapshots` y a `queue_missing_stats_dashboard_snapshots`. Leer de proyecciones abarata el build lo suficiente para permitirlo; se confirma con las medidas de la fase 0.

### 2.2 Campos nuevos en `build_user_stats_dashboard` (`user_stats_dashboard_surface.py:64`)

```text
timezone, provisional, computed_until, metrics_version: "listening-v1"
tape: {
  granularity: "day" | "week",          # week para all_time
  points: [{ bucket, minutes, plays }],  # rellenado con ceros en todo el rango
  mood: [{ bucket, energy, valence }],   # media semanal ponderada por minutos
  peaks: [{ bucket, kind: "obsession"|"longest_day"|"discovery", track|artist, value }],
  months: [{ month, top_album, top_artist, minutes }],   # para el tooltip del cursor
}
highlights: {
  longest_streak: { days, start, end }, current_streak: { days },
  new_artists: { count, share },
  longest_session: { minutes, started_at, track_count },
  obsession: { track, plays, day } | null,
}
artist_of_period: { artist, plays, minutes, first_play_in_period, top_album }
heatmap: { cells: [[minutes x24] x7], peak: { weekday, hour }, night_share }
music_age: { median_year, decades: [{ decade, share }], oldest_album }
genre_trend: [{ genre, share, delta_vs_previous }]
```

- **`trends.points`:** se mantiene tal cual, pero `all_time` pasa a quedarse capado al rango de la cinta, para no mandar la historia entera.
- **Contrato:** el nuevo payload se copia en la fixture de contrato de la fase 0 y Go lo sirve tal cual (`DecoratedPayload`).

### 2.3 "Minutos hoy" en directo

- Contador en Redis `stats:today:{user_id}:{local_day}` con TTL de 48 h. Se incrementa en `record_play_event` después del commit, con `played_seconds`.
- Endpoint ligero `GET /api/me/stats/today` que solo lee Redis, sin tocar la base de datos.
- El cliente lo refresca cuando llega la invalidación SSE de `history`, que ya existe, y al volver a la pestaña.

**Archivos:**
- backend: `user_stats_dashboard_surface.py`, queries nuevas en `db/queries/user_library_stats_signal.py`, `api/me.py`, `api/schemas/me.py`;
- Go: `readplane/internal/routes/stats_dashboard.go` y su test, más `test_readplane_route_manifest.py` si cambian las rutas;
- tests: `test_user_stats_dashboard_surface.py`, `test_stats_api_contracts.py`, `test_openapi_contract.py`.

---

## Fase 3: página desktop (A + piezas de B)

Componentes en `app/listen/src/components/stats/`. Ninguno es compartido con admin, así que no van a `@crate/ui`.

| Bloque | Componente | Notas |
|---|---|---|
| Cabecera | `StatsPeriodPicker` | `SegmentedControl` con 30 días / 90 días / Año / Siempre. Va en la URL (`?window=` / `?period=year&year=`) y filtra toda la página. Compartir abre el Wrapped (fase 6). |
| Números clave | `StatsHeadlineNumbers` | Minutos, escuchas, días activos, artistas y minutos hoy (en directo). Cuentan hasta su valor una vez por cambio de periodo. |
| Cinta | `StatsSignalTape` | SVG con barras y picos en accent, la línea de mood, la barra de hoy latiendo, un cursor con tooltip (disco del mes y minutos) y un eje que cambia por periodo. Accesible: navegación con teclado (←/→), `aria-live` para el tooltip y un resumen textual. Usa `requestAnimationFrame` y refs, sin `setState` por frame. |
| Artista del periodo | `StatsArtistOfPeriod` | Foto grande con el número 01 en contorno, texto narrativo generado con claves i18n y datos, y cuatro métricas. |
| Piezas de B | `StatsHighlights` + `StatsObsessionCard` | Racha más larga y actual, artistas nuevos y sesión más larga; la obsesión con la portada y "31× en un solo día". |
| Canciones / Artistas | `StatsTopTracks`, `StatsTopArtists` | Dos columnas reutilizando `TrackRow` y `EntityRow`, con menú contextual y reproducción. |
| Muro de discos | Reutiliza `AlbumCard` + `MediaGrid` | 12 discos con número de escuchas. |
| Cómo escuchas | `StatsHeatmap`, `StatsSoundProfile`, `StatsGenreTrend` | Heatmap 7×24 que se va encendiendo; perfil sonoro (se refactoriza el actual); `GenrePill` con su porcentaje y la variación respecto al periodo anterior. |
| Cierre | Racha, edad musical y `StatsDiscoveries` | Las décadas animadas y los descubrimientos con su fecha. |

**Se eliminan:**
- el hero con mosaico y el título gigante duplicado;
- las recap tiles;
- `StatsStorySection`, que repetía datos;
- `ListeningPulseCard`, sustituida por la cinta;
- las recetas CSS `.stats-*` que queden muertas.

`AffinityCard` se queda para `/users/:u/stats`.

**Movimiento:**
- Las secciones aparecen al entrar en pantalla (`IntersectionObserver`) y las barras crecen.
- Se respeta `lib/motion-availability.ts` y `prefers-reduced-motion`: sin animación, se muestra directamente el estado final.

**Estados:**
- Esqueleto específico de la cinta y de cada sección; se acaba la página con ceros mientras carga.
- `empty`, `warming` y `partial` diferenciados.
- La sonda de snapshot pendiente se mantiene, pero solo pide el dashboard cuando `snapshot.pending`.

**i18n:** claves nuevas `stats.signal.*`, `stats.highlights.*` y `stats.heatmap.*` en los 7 catálogos. La narrativa se construye con claves y valores, nunca con texto libre.

**Tests:**
- un test por componente;
- `Stats.test.tsx` con el payload v2 completo y con un payload v1 (que no rompa);
- tests del controlador para cambio de periodo y URL;
- spec visual (fase 0) actualizada;
- policies de badge y tokens en verde.

---

## Fase 4: móvil de la página (sin Wrapped)

En móvil, la misma página única apilada en una columna:
- la cinta en vista compacta, con scrub táctil;
- números clave en un carrusel horizontal;
- el resto de secciones apiladas.

Botón destacado "Ver tu Wrapped". Mismos componentes con variantes responsive; no se hace una página aparte.

---

## Fase 5: "Crate Pulse" (instancia) a snapshot

- `/api/stats/dashboard` (`api/analytics.py:111`) deja de agregar dentro de la petición. Pasa a un snapshot `stats:dashboard:instance` construido por el worker, con debounce desde el projector cuando llegan eventos `user.listening_aggregates.updated`.
- Se construye con las mismas proyecciones, agregadas entre usuarios en el worker.
- Aquí se añade el percentil por artista ("top 1% de sus oyentes", D4) como tabla precomputada `artist_listener_ranks`, refrescada en el mismo job.
- Readplane: ruta Go para el snapshot de instancia, con fallback a FastAPI.

---

## Fase 6: Wrapped móvil + Instagram

- **Ruta:** `/stats/wrapped?period=…` a pantalla completa, con capítulos tipo stories (propuesta 02). En desktop se abre como modal desde "Compartir".
- **Capítulos** (alimentados por el payload v2, sin endpoint nuevo):
  1. minutos;
  2. artista;
  3. top canciones;
  4. edad musical;
  5. géneros;
  6. descubrimientos;
  7. racha y obsesión;
  8. resumen.
- **Interacción:** barra de progreso; tap y swipe para avanzar o retroceder; pausa con pulsación larga; teclado en desktop.
- **Share:**
  - nuevo `ShareSubjectKind` `"wrapped"` en `lib/social-share.ts`, con su rama en `social-share-story-builder.ts`;
  - funciones de dibujo nuevas en `social-share-story-canvas.ts`: la tarjeta resumen (canónica) y una por capítulo;
  - labels nuevas en `social-share-labels.ts` y `share.kind.wrapped` en i18n;
  - acción por capítulo en `ShareSheet`.
  - El crédito usa `instagram_handle` ("A selected year by …"), ya disponible.
- **Fin de año:** con el periodo año natural, en diciembre la UI lo presenta como "Tu 2026". `provisional` se muestra mientras el año no ha cerrado. No se congelan ediciones en el servidor (eso es el roadmap 2027).
- **Tests:** tests de canvas con contexto falso (como los de Crate), el flujo del `ShareSheet` y la navegación de capítulos.

---

## Fase 7: limpieza y documentación

- Borrar el CSS y los componentes huérfanos, y el `?month=` de Home si queda sin uso (Home enlaza ahora al periodo).
- `docs/technical/`: modelo de proyecciones, semántica de periodos y zona, y contrato del dashboard v2.
- `app/listen/AGENTS.md`: excepción de gráficas SVG (D3) y lista de componentes de Stats.
- `app/crate/db/AGENTS.md`: tablas de proyección y la regla de días sucios.
- Marcar en el roadmap 2027/08 lo que queda cubierto.

---

## Orden de PRs y tamaño estimado

| PR | Contenido | Riesgo |
|---|---|---|
| 1 | Fase 0: fixtures, medición, contrato y spec visual | Bajo |
| 2 | Fase 1.1 + 1.2: zona horaria y días sucios con el `user_daily_listening` incremental | Medio (migración y semántica de días) |
| 3 | Fase 1.3 + 1.4: proyecciones nuevas y story sin escanear eventos | Medio |
| 4 | Fase 2: payload v2, periodo año, Go, precalentado y minutos hoy | Medio (contrato Python↔Go) |
| 5 | Fase 3 + 4: página desktop y móvil | Medio (UI grande, aislada en Stats) |
| 6 | Fase 5: Crate Pulse a snapshot y percentiles | Medio |
| 7 | Fase 6: Wrapped e Instagram | Bajo/medio |
| 8 | Fase 7: limpieza y docs | Bajo |

Los PR 2-4 son de backend y no cambian la UI publicada. El PR 5 depende del 4. El 7 depende del 4 y puede ir en paralelo al 5.

## Riesgos y mitigaciones

- **Cambio de zona:** reconstrucción completa del usuario, y el snapshot anterior se descarta (no se sirve stale con días de otra zona).
- **Divergencia entre incremental y rebuild:** test de igualdad sobre fixtures y una tarea de reconciliación manual, `rebuild_user_listening_projections`, para operar en prod.
- **Payload grande en all_time:** la cinta se agrega por semanas y se capan los puntos. Se mide el tamaño del JSON en la fase 0 y se fija un presupuesto (orientativo: menos de 150 KB).
- **Rendimiento de la cinta:** 365 `rect` en SVG está bien. Nada de re-render de React al mover el cursor: ref y `transform` directos.
- **Despliegue:** la migración 104 es aditiva. Tras desplegar, se encola la reconstrucción de proyecciones para todos los usuarios por lotes, desde el worker y no en el arranque de la API.
