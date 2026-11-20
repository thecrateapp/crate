# Diseño: Stats, Replay y recap anual

> **Estado (2026-11-18):** Parcial: la entrega A (Stats) está hecha (migración 105_listening_projections, [docs/technical/listening-stats-projections.md](../../technical/listening-stats-projections.md)). Pendiente B y C: recap anual persistido, enlaces revocables, vista pública y backfill.

**Estado:** propuesta revisada el 2026-09-09. Implementado parcialmente en la rama `feat/stats-signal` (2026-10): proyecciones incrementales por día local con dirty days y rebuild de referencia, zona horaria del usuario, año natural (`year:YYYY`), contrato v2 aditivo con `metrics_version: "listening-v1"`, contador en vivo de hoy, recap anual privado como historia Wrapped y tarjeta de Instagram generada en cliente. Ver `docs/technical/listening-stats-projections.md`. Pendiente: enlace público revocable de recap, comparación interanual y periodo «hoy» como ventana del dashboard.

**Prioridad recomendada:** P1 para coherencia de Stats y recap privado; compartir controladamente es un incremento posterior del mismo alcance.

**Valor/coste:** valor alto y coste bajo/medio para endurecer lo existente; valor medio/alto y coste medio para el recap privado; coste adicional medio en compartir por privacidad, revocación y assets.

## Base comprobada y necesidad real

Checkout principal `992704b9`. `codex/stats-upcoming-intelligence` ya es ancestro del HEAD: no se presenta como WIP pendiente de integrar.

| Ya existe                                                 | Rutas/código                                                                                                                                          | Trabajo restante                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Eventos de escucha e idempotencia del cliente             | `app/crate/db/repositories/user_library_playback_writes.py`, migración `014_user_play_event_idempotency.py`                                           | Verificar duplicación concurrente, calidad temporal/identidad y borrado; no inventar `play_session_id`.                  |
| Agregados diarios y por entidad/ventana                   | `user_daily_listening`, `user_track_stats`, `user_artist_stats`, `user_album_stats`, `user_genre_stats`; `user_library_aggregate_runner.py` y helpers | El refresh reconstruye historia y ventanas del usuario. Hacerlo acotado/coherente, manteniendo un rebuild de referencia. |
| Dashboard persistido, cold/stale y job de refresh         | `app/crate/db/user_stats_dashboard_surface.py`, `ui_snapshots` scope `stats:dashboard`                                                                | Revisiones de fuente, granularidad de refresh y paridad de estados; no crear `user_stats_snapshots` duplicado.           |
| Lectura Go y API privada                                  | `app/readplane/internal/routes/stats_dashboard.go`, `/api/me/stats/dashboard`                                                                         | Conservar auth/clave de snapshot y extender contrato de forma aditiva.                                                   |
| Replay por ventana y mes, historias y hábitos             | `/api/me/stats/replay`, `app/crate/db/queries/user_library_stats_tops.py`, `user_library_stats_month.py`, `user_library_stats_story.py`               | Añadir edición anual fijada a periodo/reglas, no rehacer Replay mensual.                                                 |
| Stats con una petición a dashboard y secciones narrativas | `app/listen/src/pages/use-stats-page-controller.ts`, `Stats.tsx`, `StatsStorySections.tsx`, `StatsNarrativeSections.tsx`                              | Mejorar estados y añadir recap anual; ya consume snapshot.                                                               |

Actualmente el registro programa `refresh_user_listening_stats` con debounce de 300 segundos; el worker usa `recompute_user_listening_aggregates`, que borra/reconstruye agregados diarios y ventanas. El ahorro pendiente está en ese proceso y en consultas de historias/mes, no en inventar de nuevo una arquitectura de snapshots.

`/api/stats/dashboard` es analítica global y `/api/users/{username}/stats/dashboard` es una superficie social existente con su propia autorización. Ninguna debe confundirse con Stats del propietario o considerarse permiso implícito para publicar su recap.

## Producto y entregas

1. **Stats coherentes y eficientes:** conservar ventanas `7d`, `30d`, `90d`, `365d`, `all_time` y `month=YYYY-MM`. Añadir el periodo «hoy» y año calendario como opciones explícitas sin renombrar `window` a `range`. Mostrar plays, completions/skips, minutos, entidades, hábitos, rachas y dispositivos cuando haya datos fiables.
2. **Recap anual privado:** rankings de artistas/tracks/álbumes, géneros, descubrimientos, ritmos de escucha y comparación interanual. Narrativa determinista y trazable, con edición propia y año actual marcado provisional. Se reutilizan métricas/historias y Replay existente.
3. **Compartir:** seleccionar cards, crear enlace opaco revocable y abrir una presentación pública limitada. Sigue siendo parte del objetivo completo, con gate de privacidad independiente.

No depende de completar Discovery, Social nuevo, Notifications, Lyrics, Jam o Smart Mix. Los eventos/identidades/auth/snapshots actuales bastan. Esas features pueden aportar contexto futuro sin bloquear los primeros incrementos.

## Semántica de eventos, métricas y periodos

`user_play_events` es fuente de verdad, sujeta a correcciones/borrado autorizados; no se declara un log inmutable que impida privacidad. La identidad de retry existente es `(user_id, client_event_id)`. Dos escuchas distintas de una canción deben contarse dos veces. Eventos legacy sin ese ID no se deduplican por heurística de título, pista o proximidad temporal.

Congelar en tests la semántica actual bajo `metrics_version: "listening-v1"`: `play_count` cuenta eventos aceptados; minutos proceden de `played_seconds`; completions/skips son métricas separadas. No aplicar silenciosamente un umbral nuevo a todos los históricos. Si una card necesita «escuchas cualificadas», definir su regla y etiqueta en `metrics_version`, conservando las métricas actuales. Validar duraciones/timestamps finitos y rangos coherentes; no inventar tiempo escuchado al faltar datos. Probar emisores web/native y reintentos concurrentes contra la constraint DB, no solo una comprobación previa al insert.

Resolver entidad local/global por identidad canónica antes de agregar. Pistas no disponibles siguen formando parte de los totales históricos; reproducción se resuelve aparte. Los desconocidos tienen cobertura explícita y no se convierten todos en un artista real llamado «unknown». Distintos anuales se calculan sobre unión de entidades, nunca sumando distintos diarios. Rachas se basan en días con escucha válida; comparación interanual exige cobertura comparable y no inventa porcentajes sin año anterior.

Las ventanas legacy y meses actuales conservan semántica UTC. Añadir `period=today|year` con `year` cuando corresponda y `timezone` IANA, mutuamente exclusivo con `month`/`window` explícitos; ausencia de parámetros mantiene `window=30d`. Validación idéntica en Python, Go y cliente. Los límites son `[inicio, fin)` calculados en la zona elegida y convertidos a UTC, con pruebas DST/bisiesto. El selector nuevo declara su zona; no cambia retroactivamente el significado de los enlaces actuales.

El recap congela año, zona, límites UTC y corte de datos. Default UTC hasta que el usuario seleccione otra zona; no inferirla por IP. Atribución de cada evento a día/año por `ended_at`, coherente con el agregado actual; segundos no se duplican al cruzar medianoche. Una edición del año actual informa `provisional` y `computed_until`. «Descubrimiento» significa primera escucha registrada dentro de la cobertura disponible, no primera escucha de la vida del usuario.

## Evolución de agregados y snapshots

Conservar tablas actuales y `ui_snapshots`. Introducir `user_listening_projection_state` con revisiones de datos/privacidad por usuario y `user_listening_dirty_days` como conjunto duradero de días afectados; marcarlo dentro de la transacción que inserta/corrige/borra eventos. La cola Dramatiq despierta el trabajo; la marca DB evita depender de la entrega exactamente una vez o del debounce Redis.

Recomputar días afectados desde la fuente y reemplazar el bucket atómicamente, en vez de sumar dos veces mensajes reenviados. Ventanas por entidad se actualizan en un único batch coherente y contemplan eventos que salen de ventana aunque no llegue un play nuevo. Conservar rebuild completo como oracle de reconciliación y reparación. Los índices/rollups diarios por entidad adicionales se justifican con RC01: no crear de entrada una segunda familia completa de rollups. Si se necesitan, cubrir ventanas parciales con eventos de borde para mantener la precisión temporal actual.

La revisión se incrementa transaccionalmente bajo coordinación de la fila de estado del usuario; `MAX(id)` no es un cursor seguro de commit. Capturar revisión/corte al construir, publicar mediante CAS y reconocer solo las marcas procesadas de esa revisión. Un evento tardío o concurrente deja trabajo pendiente. Una corrección de identidad que cambie rankings también invalida las superficies afectadas.

Actualizar dashboard desde agregados consistentes y reutilizar su refresh/job/projector. Añadir metadata de fuente (`computed_until`, revisión, cobertura, `metrics_version`) sin eliminar campos actuales. `fresh`, `stale`, `warming`, `partial` y `empty` deben distinguir dato viejo, ausencia de proyección, cobertura insuficiente y cero escuchas reales. Un snapshot válido puede seguir visible durante refresh; tras borrado/revocación no se sirve stale incompatible con la revisión de privacidad.

## Edición anual y persistencia mínima

Nuevo `user_replay_generations`: propietario, año/zona, periodo/corte, `generation_id`, `schema_version: 1`, `algorithm_version: "recap-v1"`, `metrics_version`, revisiones de fuente/privacidad, conteo/cobertura y payload de cards acotado. Selección/rankings/narrativa no cambian en una edición publicada. Las traducciones pertenecen al cliente: guardar tipos, valores y claves, no textos arbitrarios de un LLM.

Reutilizar `ui_snapshots` para el puntero/lectura privada anual; las ediciones son la autoridad histórica. Un job deduplicado genera una edición nueva si cambian reglas, zona o datos relevantes; CAS evita que un trabajo antiguo desplace al nuevo. Ties por identidad estable. Guardar metadata mínima de presentación permite explicar un ranking aunque un track desaparezca, sin congelar URLs firmadas o paths locales.

Año actual es provisional. Año cerrado produce edición completa respecto a su corte, no una afirmación de que nunca llegarán eventos offline. Llegadas tardías producen nueva edición identificable; los enlaces compartidos siguen fijados a la edición elegida. Borrado de datos invalida las ediciones que los contienen y revoca sus enlaces: la inmutabilidad no preserva datos cuya eliminación se solicitó.

Retención inicial: edición vigente por año y ediciones que tengan un share activo; versiones superseded sin share se eliminan tras 30 días. Borrado de cuenta/historial aplicable prevalece sobre cualquier retención. Backfill recorre historia realmente conservada, prioriza los últimos 24 meses y genera bajo demanda para años/usuarios restantes; no promete reconstruir datos ya eliminados.

## API y compartir

Conservar `/api/me/stats/dashboard?window=...` o `?month=...` y `/api/me/stats/replay`. Añadir periodos explícitos del contrato anterior y rutas nuevas:

- `GET /api/me/replay/{year}`: última edición privada, con selección explícita de zona/edición; cold request programa generación sin recalcular historia en el request.
- `POST /api/me/replay/{year}/share`: requiere edición propia lista y selección de cards; devuelve un token opaco una sola vez.
- `DELETE /api/me/replay/{year}/share/{share_id}`: revoca ese enlace; admitir también revocación de todos los shares del propietario.
- `GET /api/replay/shares/{token}`: proyección pública limitada, independiente de username o del perfil social.

`replay_share_tokens` almacena hash del token, propietario, edición, cards autorizadas, expiración y revocación. Entropía criptográfica suficiente, comparación segura y rate limit; no guardar ni registrar tokens en claro. No incluir historial, IDs internos, paths, device IDs, URLs de streaming ni accesos al catálogo privado. Nombre/avatar solo si el propietario los incluye.

La lectura verifica grant y revisión de privacidad vigentes antes de servir payload o assets. Default `Cache-Control: no-store` para evitar que un proxy siga publicando un recap revocado; una futura cache compartida exige validación del grant en cada entrega. Si se sirven imágenes derivadas, mismo permiso/expiración y generación en worker. No hacer públicos artworks privados por reutilizar una URL autenticada. Un link no concede playback ni acceso al perfil completo.

Revocar bloquea respuestas nuevas inmediatamente; una descarga o captura ya recibida no puede retirarse y la UI lo explica al compartir. Vistas de compartir requieren pruebas reales de web y deep links Android, además de render responsive. Go puede hacer fallback a FastAPI para recap/shares; implementar nuevos handlers solo después de demostrar la misma autorización/revocación. La paridad del dashboard existente sí es obligatoria.

## Privacidad, operación y criterios de salida

Controles de historial, derivados y compartir tienen semántica explícita. Reutilizar ajustes y flujo de cuenta existentes; añadir únicamente las operaciones de borrado/exportación de estos datos que falten, dentro de esta feature, sin esperar otro roadmap. Borrado transaccional revoca shares y cancela/invalida jobs; eliminar agregados, snapshots, generaciones y assets derivados. No conservar estadísticas individualizadas bajo la etiqueta de «anonimizadas» al borrar una cuenta.

Un job captura revisión de privacidad y comprueba propietario/revisión al publicar. La lectura comprueba esa misma vigencia antes de stale/fallback. Cuentas borradas, Redis reiniciado o un worker que termina tarde no pueden resucitar el contenido.

No hay mediciones nuevas en esta revisión. El antiguo objetivo de 60 s por millón de eventos no está demostrado. RC01 mide volúmenes reales y fixtures de 0, pocos, 100k eventos, reservando 1 M como prueba de estrés. Registrar hardware, p50/p95, queries, RSS, cache hit, duración del refresh, antigüedad de proyección y coste de backfill. Fijar presupuestos absolutos allí; no más del 10% de regresión p95 warm frente a baseline comparable, y ningún recálculo de historia en el hot path.

Cierre: igualdad con fuente/rebuild en fixtures, dedupe concurrente, límites temporales correctos, años con cobertura incompleta honestos, ausencia de fugas entre usuarios, revocación/borrado resistentes a caches/jobs y UI accesible. El recap privado puede salir antes de compartir, pero no cierra el alcance completo. Las cifras de rendimiento y de adopción se reportan con muestra, sin sustituir pruebas pendientes por estimaciones.
