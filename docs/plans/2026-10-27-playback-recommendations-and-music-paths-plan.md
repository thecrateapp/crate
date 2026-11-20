# Infinite Playback, rotación de recomendaciones y Music Paths — Plan en tres PRs

> **Estado (2026-11-18):** Implementado (PR #299 y siguientes: recommendation_policy, rotación de radio, validación de Music Paths). El estado escrito más abajo (PR2/PR3 pendientes) es histórico.

**Goal:** Mantener Infinite Playback operativo en todos los targets, evitar la repetición entre sesiones durante siete días cuando haya alternativas coherentes y mejorar la continuidad y variedad de Music Paths.

**Architecture:** Reutilizar el motor shaped para la continuación con estado, separando intención musical, historial de escucha y transporte/reproducción. Lecturas batched de identidad, recencia y género compartidas, con adaptadores distintos para radio anclada y recorridos finitos A→B. Corregir contratos y ciclo de vida antes de tocar pesos musicales.

**Tech Stack:** Python/FastAPI/PostgreSQL/Redis, React/TypeScript/Vitest, Android Java/Media3 y Cast. Sin nuevas librerías de recomendación ni dependencia obligatoria de IA.

---

**Estado (2026-10-28):** Diego autoriza ejecutar hasta el primer PR desde `main`, en worktree y rama nuevos. PR 1 implementado y publicado en borrador: https://github.com/thecrateapp/crate/pull/299, commit `b3ee3f84ec8e75e52b3b55bb981b0c401e55f553`; QA física pendiente. PR 2 y PR 3 siguen pendientes de autorización. No se autoriza merge ni despliegue.

**Workspace de ejecución PR 1:** worktree local `crate-infinite-playback`, rama `fix/infinite-playback`, creada desde `origin/main` en `82ea84746`. El análisis original se conserva como evidencia histórica de `feat/crate_v3`. Revalidar HEAD antes de ejecutar cada PR.

**Documentación previa:** `docs/plans/2026-10-27-recommendations-infinite-playback-analysis.md` y los JSON de evidencia (Concubine, Citizen, Jane Doe) del mismo directorio. `docs/plans/*` está ignorado; versionarlos requiere añadirlos explícitamente y revisar datos privados. No publicar historiales de producción.

## 0. Arreglo para la 3.0.0

**Android sin crossfade no rellenaba Infinite en segundo plano.** `AndroidNativeEngine.configureContinuation` vaciaba la configuración nativa siempre que el crossfade estaba apagado, aunque la cola tuviera un descriptor de continuación. El servicio nativo ya separaba relleno (`maybeRefillQueue`, sin condición de mezcla) y planes (`maybeRequestContinuation`, solo con mezcla), así que el arreglo es solo JS:

- la continuación se configura si hay mezcla **o** si la cola tiene descriptor;
- `setCrossfadeMs` reconfigura la continuación cuando la mezcla pasa de encendida a apagada o viceversa;
- tests: cola Infinite con crossfade 0 recibe `refill: true`; encender crossfade reconfigura; una cola sin descriptor ni mezcla sigue sin continuación.

Implementado en `feat/crate_v3` (`app/listen/src/lib/android-native-engine.ts`), pendiente de commit. Requiere smoke en el Xiaomi (crossfade 0, Infinite, pantalla apagada) antes del tag.

## 1. Evidencia

| Caso | Evidencia | Implicación | PR |
| --- | --- | --- | --- |
| Concubine / Converge, radio por track | Diez primeros aprobados por Diego; 80 tracks entre arranque y dos rellenos en el entorno esperado | Referencia positiva: no retocar pesos globales por intuición | 2 |
| Citizen, radio por artista | Tres sesiones con el mismo historial: 20/20 temas idénticos en el mismo orden | El ranking seeded no usa el historial; solo `recent_tracks` de la sesión | 2 |
| Third Degree / Movements | 18,77 s, ratio 0,0829, `was_skipped=false` | Distinguir reproducción breve, escucha significativa y completado | 2 |
| Infinite tras Jane Doe | GET legacy genera 30; siete del álbum ya en cola | Duplicación y falta de progreso | 1 |
| EOF / error / vacío | EOF natural no invoca continuación; firmas de refill bloquean reintentos; respuesta tardía no reanuda | Ciclo de vida, no ranking | 1 |
| Android / Cast | Refill nativo ligado a crossfade (resuelto en §0); retry sin scheduler; el append de inteligencia no sincroniza Cast | Cobertura por target | 1 |
| Music Paths acústico | No pasa `recent_tracks`; usa labels como artistas; no reserva destino | Continuidad y extremos | 3 |
| Music Paths por escenas | La afinidad all-time impone siempre el mismo favorito; el refinamiento no revalida todas las restricciones | Familiaridad frente a fatiga; validar cada sustitución | 3 |
| Paths → playlists | Reproducir el Path 123 envía `context_playlist_id=123` | Métricas atribuidas a una playlist ajena | 1 |

Fuera de alcance: biblioteca, tags, embeddings, DSP, temas visuales y preferencias de mezcla. Jam Auto DJ y Home discovery solo cambian si consumen un helper compartido modificado (regresiones, no nueva política).

## 2. Decisiones

**Confirmada:** ventana de **7 días** para relegar escuchas significativas, recuperando esos temas si faltan alternativas coherentes.

**Confirmada para PR 1 (2026-10-28):** Infinite funciona también con shuffle en álbumes/playlists; repeat-one/all mantiene prioridad.

**Decisiones del plan:**

| Decisión | Propuesta | PR |
| --- | --- | --- |
| Infinite con shuffle en álbumes/playlists | Aprobado por Diego (2026-10-28); repeat-one/all conserva prioridad | 1 |
| Escucha significativa | `was_completed`, o `min(30 s, 50 % de la duración)`; duración desconocida: 30 s. Una sola constante compartida | 2 |
| Flag de rotación | `CRATE_RADIO_ROTATION_ENABLED`, activo por defecto, para desactivarla sin desplegar | 2 |
| Advertencias de Path parcial | Metadata aditiva en la respuesta, sin cambiar códigos HTTP existentes | 3 |

## 3. Presupuestos de rendimiento

Medidos con el catálogo de producción (≈48K tracks) en el entorno de pruebas antes de cerrar cada PR:

- `POST /api/radio/next` y la continuación: p95 ≤ 250 ms, ≤ 4 queries por lote.
- Lectura de historial para candidatos: una query batched por `ANY(:ids)` sobre `user_play_events(user_id, ended_at)` acotada a 7 días; ≤ 20 ms p95.
- `GET /api/radio/stations`: sin regresión respecto a hoy (~40 ms la consulta de géneros).
- Generación de Path de 20 pasos: p95 ≤ 2 s sin IA; 100 pasos ≤ 6 s. GET/replay de un Path guardado sin recalcular.
- Ninguna agregación sobre `library_tracks` por request, sin N+1, sin scope de DB abierto durante llamadas a IA.

## 4. Reglas comunes a los tres PRs

- Por tarea: regresión mínima en RED, cambio mínimo, GREEN con los tests afectados, revisión del diff. Un RED causado por un fixture roto no demuestra el defecto.
- Tests acotados durante el desarrollo; `make dev-test` una vez al cerrar cada PR.
- Contratos aditivos: campos nuevos opcionales, endpoints legacy mantenidos mientras migran los clientes, ningún cambio de código HTTP sin revisarlo.
- Nada de tokens de refresh/bearer en el receiver de Cast; los tickets de continuación conservan su TTL.
- Commits convencionales en checkpoints revisados; no publicar ni desplegar sin indicación de Diego.

---

## PR 1 — Infinite Playback fiable en todos los targets (3.0.x)

**Objetivo:** una cola Infinite se rellena, recupera errores transitorios y respeta la intención del usuario en web/Tauri, Android y Cast. Sin cambios de ranking.

**Arreglos rápidos primero** (commits pequeños dentro del PR):

1. **Atribución de Paths.** Reproducir un Path no envía `context_playlist_id`, no navega a una playlist ajena ni genera descriptor Infinite. Cambio mínimo en la fuente de reproducción de `PathDetail`; la fuente `type: "path"` completa queda para el PR 3.
   - Test: reproducir el Path 123 no produce `context_playlist_id=123` en el tracker.
2. **Infinite con shuffle**, si Diego lo aprueba (§2): actualizar `use-playback-continuation.ts` y los tests que hoy lo excluyen.

### Tarea 1.1 — Contrato de continuación idempotente por índice de lote

**Files:** `app/crate/api/radio.py`, `api/schemas/radio.py`, `radio_engine.py`; tests `test_radio_contracts.py`, `test_playback_continuation_api.py`, nuevo `test_radio_continuation_contract.py`.

1. RED: pedir dos veces el lote `n` de una sesión consume un único lote; dos peticiones simultáneas no pisan el estado de la sesión; una sesión de otro usuario es inaccesible.
2. La sesión shaped guarda en Redis los lotes ya generados por índice (`session_id`, `revision`, `batch_index`), con TTL acotado. Pedir un índice ya generado devuelve el mismo lote; pedir el siguiente genera y avanza de forma atómica bajo un lock por sesión (nunca global). Sin registro de `request_id`: la clave del lote ya es idempotente.
3. Respuesta con estado explícito `ok | retryable_empty | exhausted | auth_required`, manteniendo los campos actuales. Un fallo HTTP sigue siendo error recuperable, no lista vacía.
4. Infinite reutiliza la sesión shaped conservando la intención de álbum/playlist; el contexto de enlace del lote nuevo es el último tema del buffer. El GET legacy se mantiene hasta migrar los clientes.
5. GREEN: timeout tras generar el lote (el reintento recibe el mismo), reinicio con el lote ya guardado, sesión caducada (respuesta `exhausted`, sin recrear una lista descartada), mismo índice en otra sesión.

**Run:** `../.venv/bin/python -m pytest tests/test_radio_continuation_contract.py tests/test_playback_continuation_api.py -q`; casos afectados de `test_openapi_contract.py` y `test_api_security.py` por node ID.

### Tarea 1.2 — Refill JS: EOF, reintentos y cancelación

**Files:** `app/listen/src/contexts/use-playback-continuation.ts`, `use-playback-radio-refill.ts`, `use-playback-intelligence.ts`, `use-player-engine-callbacks.ts`, `use-player-navigation-actions.ts`; `lib/radio.ts`, `lib/playback-continuation.ts`; nuevo `contexts/use-playback-refill-runtime.test.ts`.

1. RED: EOF con petición en curso, respuesta tardía válida y pausa explícita producen resultados distintos; un lote con cero incorporaciones por dedup programa un reintento sin interacción.
2. Un hook común para petición, reintento y cancelación; cada fuente aporta su descriptor e intención. Reintentos con backoff acotado y jitter, timer independiente de los ticks de progreso, sensibles a online/visibility y con cleanup real.
3. Las acciones devuelven cuántos temas se incorporaron de verdad. EOF con intención de seguir espera y recupera; Pause, Stop, cambio de fuente y desconexión cancelan. Una respuesta tardía nunca reanuda tras una pausa ni toca otra cola.
4. Dedupe contra buffer activo y reservas, no contra toda la cola histórica: una grabación que vuelve tras una relajación permitida no se descarta en el cliente.
5. GREEN: vacío, timeout, error, abort, pausa, stop, cambio de cola, doble respuesta, shuffle, repeat y vuelta de background. Caída de red → EOF con intención activa recupera; la misma secuencia tras Pause no reanuda.

**Run:** `npm run --workspace=app/listen test -- src/contexts/use-playback-refill-runtime.test.ts src/contexts/use-playback-intelligence.test.ts src/lib/radio.test.ts --maxWorkers=1`.

### Tarea 1.3 — Android y Cast

**Android** (`lib/android-native-engine.ts`, `contexts/use-native-playback-event-bridge.ts`, `CrateNativePlaybackService.java`, `NativeContinuationClient.java`, `NativeContinuationPolicy.java`):

1. RED: un fallo de refill en el último tema se reintenta al vencer el timer sin cambiar de canción; una respuesta de la cola A no desactiva la configuración de la cola B.
2. Programar y cancelar los reintentos nativos (hoy `retryAtMs` solo se evalúa en el siguiente evento). Validar revisión y generación de configuración antes de aplicar un resultado. Cambiar Infinite, repeat o shuffle reconfigura sin recargar la cola ni reiniciar el tema.
3. Invalidar la configuración ante 401/403 y logout aunque el TTL no haya vencido; una reemisión autenticada, sin bucle. Consumir el contrato de la Tarea 1.1.

**Cast** (`use-player-intelligence-actions.ts`, `use-cast-playback-runtime.ts`, `lib/cast-sender*.ts`):

4. RED: el append automático llega al receiver y conserva tema y posición; el éxito solo se refleja tras la confirmación del receiver.
5. Reutilizar el mecanismo de sincronización existente. La reconciliación de un ACK perdido queda **fuera** de este PR salvo que aparezca en QA real: se documenta como límite conocido.

**Runs:** `npm run --workspace=app/listen test -- src/lib/android-native-engine.test.ts src/contexts/use-player-intelligence-actions.test.ts src/lib/cast-sender.test.ts --maxWorkers=1`; desde `app/listen/android`, `./gradlew :app:testDebugUnitTest --tests 'app.cratemusic.crate.NativeContinuation*'`.

### Cierre del PR 1

- QA en el Xiaomi: álbum completo → varios lotes con crossfade 0 y con mezcla, pantalla apagada, caída breve de red, EOF con petición lenta, Pause durante una petición.
- QA Cast: append automático visible en el receiver.
- QA web/Tauri: mismos casos sin target nativo.
- Commit: `fix(playback): keep generated queues refilling across targets`.

**Aceptación:**
- [ ] Infinite mantiene buffer y recupera errores y vacíos temporales sin interacción, incluido EOF con petición pendiente.
- [ ] Pause, Stop y cambio de fuente cancelan; ninguna petición obsoleta modifica la cola ni reanuda.
- [ ] Reintentos idempotentes, con backoff, sin consumir dos lotes.
- [ ] Android en background continúa con y sin crossfade; Cast recibe el append real; la caducidad tiene estado explícito.
- [ ] Las métricas de un Path no se atribuyen a una playlist.

---

## PR 2 — Rotación de siete días dentro del contexto musical

**Objetivo:** Citizen deja de repetir el mismo comienzo cuando hay alternativas equivalentes no escuchadas en 7 días; Concubine mantiene su coherencia. Detrás de `CRATE_RADIO_ROTATION_ENABLED`.

### Tarea 2.0 — Baselines reproducibles

**Files:** `app/tests/fixtures/recommendations/concubine.json`, `citizen.json`; nuevo `app/tests/test_recommendation_evaluation.py`.

1. Fixtures sanitizados: identidades, señales mínimas y reloj fijo. Sin historiales completos, usuarios reales, tickets ni credenciales.
2. Test determinista con fixture, seed y reloj fijos; sin escrituras. Mide overlap entre sesiones y coherencia por separado.
3. Revisar con Diego los resultados de referencia antes de tocar scoring. Las listas de hoy son evidencia, no un contrato de devolver siempre esas canciones.

### Tarea 2.1 — Historial de escucha significativa

**Files:** nuevos `app/crate/db/queries/recommendation_history.py`, `app/crate/recommendation_policy.py` y sus tests. Reutilizar `track_versions.py` y las proyecciones de escucha como contratos, sin cambiar la ingesta.

1. RED: la misma grabación por ID local, entity o global comparte la última escucha significativa; la reproducción de 18,77 s no cuenta como significativa.
2. `history_for_candidates(user_id, candidate_refs, since, session=...) -> {canonical_key: {last_significant_play_at, frequency, completed}}`. El predicado significativo se aplica a los eventos antes de agrupar; no se usa `last_played_at` all-time ni un tail de N eventos. Batch por `ANY(:ids)`, ventana de 7 días, reloj inyectable, sin N+1.
3. GREEN: bordes de 7 días en UTC, dos usuarios, señales ausentes, evento duplicado, retraso de proyección, familia de versiones, skip/completado/interrupción, duración desconocida, escucha significativa de hace 6 días seguida de muchos eventos breves.
4. EXPLAIN con volumen representativo. Índice nuevo solo si el plan lo justifica, en el siguiente head de migración real.

### Tarea 2.2 — Recuperación de candidatos que progresa

**Files:** `app/crate/radio_engine.py`, `db/queries/paths_bliss_candidate_queries.py`, `db/queries/radio_seed_queries.py`; nuevo `test_radio_candidate_progress.py`.

1. RED: los primeros 140 candidatos están usados pero hay temas válidos más allá; la radio los encuentra sin declarar agotamiento falso.
2. Exclusiones de identidad, familia y recencia en el retrieval con ampliación acotada. Contar candidatos elegibles, no filas SQL. Distinguir pool estéril de catálogo coherente agotado.
3. Nunca repetir dentro del buffer activo; el historial se rige por la política de cooldown con relajación.

### Tarea 2.3 — Rotación en el ranking seeded

**Files:** `radio_engine.py`, `recommendation_policy.py`, `recommendation_history.py`; nuevo `test_radio_session_rotation.py`.

1. RED: con los 20 candidatos de una sesión escuchados significativamente, una sesión nueva los relega si hay alternativas equivalentes.
2. Preferir el tier fresco de calidad comparable y rotar dentro de esa banda con el RNG existente. Generar o precargar no cuenta como escucha. Sin subir el drift ni penalizar artistas enteros.
3. GREEN: mismo día/otro día, borde de 7 días, todo enfriado (recupera en vez de vaciar), catálogo pequeño, otro usuario, variantes, flag desactivado (comportamiento actual exacto).
4. Evaluar Citizen y Concubine con los baselines de la Tarea 2.0 y revisarlos con Diego.

**Run:** `../.venv/bin/python -m pytest tests/test_radio_session_rotation.py tests/test_recommendation_history.py tests/test_recommendation_policy.py tests/test_radio_candidate_progress.py -q`.

### Cierre del PR 2

- Medir los presupuestos de §3 para radio e historial.
- Commit: `fix(radio): rotate recent listens without losing seed context`.

**Aceptación:**
- [ ] Citizen no repite el comienzo si hay alternativas equivalentes no escuchadas significativamente en 7 días; un catálogo pequeño se relaja sin vaciar la cola.
- [ ] Concubine mantiene un entorno coherente; la variedad no sale de aumentar el drift.
- [ ] Con el flag desactivado, el ranking es idéntico al actual.
- [ ] Historial en una query batched, dentro de presupuesto.

---

## PR 3 — Music Paths: continuidad, novedad y validación

**Objetivo:** un Path respeta A→B, anchors y waypoints, usa el contexto real del tema previo, varía en crear/regenerar y conserva intactas las rutas guardadas. Depende de la Tarea 2.1 (historial).

### Tarea 3.1 — Señales de género con procedencia

**Files:** nuevo `app/crate/db/queries/recommendation_context.py`; `db/paths_similarity.py`, `db/queries/paths_endpoint_queries.py`; nuevo `test_recommendation_context.py`.

1. RED: un endpoint track o álbum devuelve artistas reales y géneros ponderados; un label de presentación nunca se usa como artista.
2. Batch de tags de pista, `album_genres.weight` y `artist_genres.weight`, normalizados por la taxonomía, con procedencia. Las etiquetas compuestas se parten como en las radios de género (`radio_stations._genre_slugs`).
3. GREEN: alias, artista multigénero, género de pista contradicho, dato ausente.

### Tarea 3.2 — Reparar el fallback acústico

**Files:** `music_paths.py`, `db/paths_path_builder.py`, `paths_candidates.py`, `paths_vectors.py`, `queries/paths_bliss_candidate_queries.py`; nuevo `test_music_paths_fallback.py`.

1. RED: pasar el último tema real al scorer cambia la selección cuando difieren BPM, key, energía o época.
2. Reservar origen y destino antes del tramo central; corregir el `exclude` de la query del anchor y deduplicar por familia de canción. Waypoints como guías ordenadas de segmentos, no visitas obligatorias.
3. Ampliar el top 15 de forma acotada si no hay elegibles, preservando dirección A→B.
4. GREEN: destino que también es vecino intermedio, catálogo escaso, waypoints irresolubles, ruta corta/larga.

### Tarea 3.3 — Novedad en crear/regenerar

**Files:** `db/paths_scene.py`, `queries/paths_scene_queries.py`, `music_paths.py`; nuevo `test_music_paths_rotation.py`.

1. RED: un favorito con afinidad ≥ 0,85 escuchado recientemente no bloquea siempre alternativas equivalentes; sin fatiga sigue siendo señal válida.
2. Recencia de la Tarea 2.1 en la lectura batched del pool. Al regenerar, relegar suavemente los IDs del Path anterior sin tratarlos como escuchados. Anchors track explícitos exentos.
3. GREEN: semillas distintas, reproducibilidad con misma semilla, siete días, catálogo escaso. Revisar la política de `test_seeded_selection_keeps_strong_user_affinity_track` sin debilitar sus otras invariantes.

### Tarea 3.4 — Validación determinista y refinamiento IA

**Files:** nuevo `app/crate/music_path_validation.py`; `db/paths_llm_refinement.py`, `music_paths_refinement.py`; nuevo `test_music_path_validation.py`.

1. RED: una sustitución que repite familia, rompe la escena o empeora una transición conserva el tema original.
2. Una validación compartida entre generación y refinamiento: extremos, orden de waypoints, disponibilidad, familias, repetición, escena del slot, vecinos y destino.
3. Si la IA falla o no mejora, se conserva el resultado determinista. Sin llamadas nuevas obligatorias a modelos.
4. Un Path que no puede mantener sus extremos no se publica como completo: metadata aditiva de advertencia (decisión en §2).

### Tarea 3.5 — Fuente `path` en Listen

**Files:** `contexts/player-types.ts`, `use-play-event-tracker.ts`, `components/player/player-source.ts` y consumidores reales; `pages/Paths.tsx`, `PathDetail.tsx`; serialización de persistencia/Cast si aceptan el discriminante.

1. Inventariar los consumidores de `PlaySource` antes de extenderlo. `type: "path"` con ID, label y navegación propios; peers antiguos reciben una fuente genérica de cola sin `playlist_id`.
2. Mostrar advertencias de ruta parcial con estados existentes, sin primitivas nuevas. La indisponibilidad de un tema guardado se muestra sin regenerar el Path.
3. GREEN: reproducción desde un step conserva el orden, GET/replay estables, fin en destino, permisos de propietario.

**Run:** `../.venv/bin/python -m pytest tests/test_music_paths_fallback.py tests/test_music_paths_rotation.py tests/test_music_path_validation.py tests/test_recommendation_context.py -q`; `npm run --workspace=app/listen test -- src/pages/Paths.test.tsx src/contexts/use-play-event-tracker.test.ts --maxWorkers=1`.

### Cierre del PR 3

- Medir los presupuestos de Paths de §3 (20 y 100 pasos).
- Evaluar artista→artista, género→género y track/álbum con waypoints, en catálogo amplio y escaso. Un overlap alto en una ruta guardada no es fallo de novedad.
- Commit: `fix(paths): preserve journey coherence and rotate fresh selections`.

**Aceptación:**
- [ ] Paths usa el contexto previo real, reserva anchors y respeta waypoints y destino.
- [ ] Crear/regenerar admite novedad; GET/replay no cambia la ruta ni la vuelve infinita.
- [ ] Ningún refinamiento IA rompe las restricciones deterministas.
- [ ] Ruta parcial marcada como tal, sin cambiar contratos HTTP existentes.

---

## 5. Orden y paradas de revisión

| Paso | Contenido | Parada |
| --- | --- | --- |
| 3.0.0 | §0 (Android sin crossfade) | Smoke en el Xiaomi antes del tag |
| PR 1 | Atribución de Paths, shuffle (si se aprueba), Tareas 1.1–1.3 | Decisión de shuffle; QA por target antes de publicar |
| PR 2 | Tareas 2.0–2.3 | Baselines revisados antes de tocar scoring; listas Citizen/Concubine revisadas antes de publicar |
| PR 3 | Tareas 3.1–3.5 | Decisión sobre advertencias de ruta parcial; evaluación de Paths antes de publicar |

PR 2 y PR 3 comparten la Tarea 2.1: PR 3 empieza cuando PR 2 está mergeado. PR 1 es independiente y puede ir en paralelo. Ningún PR se publica ni despliega sin indicación de Diego; el rollback de cada uno es el despliegue anterior, con contratos aditivos durante la migración.


## Registro de ejecución PR 1 — 2026-10-28

- Contrato indexado y replay de lotes, ownership y guard de leases para todos los writers.
- Refill JS común con deadline/retries/EOF/cancelación y buffer activo.
- Android con timer y cursor/generación; Cast con ACK y guard antes de ejecutar operaciones encoladas.
- Paths como cola finita sin ID de playlist; HomePlaylist incluye seed de continuación.
- Diego confirma Infinite con shuffle en álbumes/playlists; repeat-one/all conserva prioridad.
- Validación local acotada; validación completa de cierre en Linux CI una vez estable.
- Pendientes para release: QA física Xiaomi/Cast, smoke web/Tauri y latencia con catálogo representativo. ACK perdido Cast sigue fuera del corte, igual que rotación y scoring de PR2/PR3.


### Cierre del corte PR 1

- Commit/push: `b3ee3f84ec8e75e52b3b55bb981b0c401e55f553`. PR #299, draft, base main, sin merge ni deploy.
- Validación local: 88 pytest, 21 contratos Redis real, 242 Listen/Vitest, 25 protocolo Cast, 18 receiver, 32 JUnit Android y 19 tests Tauri; typechecks, Ruff, ESLint y Pyright acotados verdes.
- Revisión independiente: cursor Android monotónico + publicación de ACK al nativo; corrección autoritativa separada; EOF Cast explícito mediaFinished y stateSeq; reservas Android para ediciones manuales mientras ACK; preparación de cola y refs de estado autoritativas. Sin nuevos bloqueadores confirmados.
- CI completa Linux lanzada una vez al estabilizar: backend dispatch https://github.com/thecrateapp/crate/actions/runs/40706037523 y frontend automático https://github.com/thecrateapp/crate/actions/runs/40705966854. En curso al cerrar el turno.
- Pendiente revisión Diego, QA física/smoke y latencia de catálogo representativo. PR 2/3 no implementados.
