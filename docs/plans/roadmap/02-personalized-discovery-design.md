# Diseño: discovery recurrente y Release Radar

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18). Desbloquea el rail de Release Radar del diseño de producto V3.

**Estado:** propuesta revisada el 2026-09-09; no implementada por esta revisión.

**Prioridad recomendada:** P0 para corregir consistencia/permisos de discovery existente; P1 para completar ediciones y productos nuevos.

**Coste relativo:** medio para estabilizar los mixes actuales; medio/alto para completar los cuatro productos, evaluación y operación.

## Punto de partida comprobado

Revisión del checkout principal en `992704b9`. Las ramas `codex/listen-discovery-ui`, `codex/stats-upcoming-intelligence` y `feature/radio-playlist-intelligence` son ancestros de ese HEAD: estas capacidades ya están integradas.

| Capacidad existente                                | Código que se conserva                                                                                                  | Carencia abordada                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Daily Discovery, My New Arrivals y mixes `genre-*` | `app/crate/db/home_builder_mix_generation.py`, `home_personalized_collections.py`                                       | El detalle reconstruye candidatos; card y detalle no comparten una edición persistida.   |
| Dedupe, caps y rotación diaria                     | `app/crate/db/home_taste_guardrails.py`, `home_builder_track_selection.py`, `app/crate/track_versions.py`               | Aplicar restricciones coherentes a merge local/global, backfill, detalle y reproducción. |
| Semanas de lanzamientos desde el viernes           | `app/crate/db/home_release_weeks.py`, `home_builder_release_recommendations.py`                                         | Diferenciar Radar de follows, novedades por afinidad e incorporaciones tardías.          |
| Feedback y exposiciones                            | `app/crate/db/repositories/recommendations.py`, `/api/me/recommendations/feedback`, `/api/me/recommendations/exposures` | Incorporar las señales a los productos con semántica de ocultar/bloquear/deshacer.       |
| Home con snapshot y refresco diferido              | `app/crate/db/home_discovery_surface.py`, `app/readplane/internal/routes/home_slices.go`                                | Publicar referencias a ediciones coherentes, conservando auth y fallback.                |
| Cards y página de mix                              | `app/listen/src/components/home/HomeCustomMixes.tsx`, `app/listen/src/pages/HomePlaylist.tsx`                           | Versionar navegación y añadir estado/razones sin crear otra página equivalente.          |

Replay mensual permanece en Stats. Los smart playlists y `playlist_generation_log` también existen, pero su actualización y log no garantizan una edición inmutable por usuario. Se reutilizan identidades y acciones de playlists, sin otro motor general de generación.

El rail Custom mixes está oculto intencionadamente en Home, con cobertura en `Home.test.tsx`. La publicación de ediciones no decide automáticamente restaurarlo en todos los tamaños.

## Valor y alcance

El mayor valor inicial es la consistencia: abrir una card debe mostrar su selección, los bloqueos deben respetarse y las novedades deben ser recientes. Añadir nombres de productos sobre las mismas listas sin mejorar esas propiedades aporta poco.

Se mantienen todos los productos, entregados por incrementos:

| Producto                    | Identidad y cadencia                           | Diferencia de producto                                                                                                                                 |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daily Mix / Daily Discovery | Conservar `daily-discovery`; diaria UTC        | Descubrimiento cercano, con backfill limitado de pistas poco escuchadas. Cambiar el nombre visible no cambia el ID ni convierte la lista en favoritos. |
| Weekly Discovery            | Nuevo `weekly-discovery`; semanal              | Más exploración y menor repetición entre semanas; similitud musical cuando exista y fallback de metadata.                                              |
| Release Radar               | Nuevo `release-radar`; semana desde el viernes | Novedades publicadas de artistas seguidos. No sustituye `my-new-arrivals`, que admite afinidad más amplia.                                             |
| Scene Mix                   | IDs `genre-*` existentes; diaria               | Términos de género directos primero y relacionados como ampliación explicada.                                                                          |

Incluye catálogo local y global autorizado, feedback, diversidad, ediciones y operación. Excluye catálogo editorial licenciado, entrenamiento remoto, exportación de historiales y rediseñar Radio/Replay. No necesita una nueva dependencia de pgvector: utiliza la infraestructura de similitud disponible.

## Selección y ranking

Mantener retrieval SQL en módulos DB existentes; extraer política pura donde permita probar y reutilizar comportamiento, evitando duplicar los builders completos en otro paquete.

1. Resolver identidad canónica y permiso/disponibilidad del usuario. Una entrada de catálogo o preview no garantiza una pista reproducible.
2. Aplicar restricciones duras: bloqueos, contenido excluido, variantes equivalentes y límites de producto. Reaplicarlas tras merges y backfills.
3. Puntuar afinidad, follows, likes, finalizaciones, skips y exposición. La repetición reciente es una penalización por producto, no un veto universal que vacíe bibliotecas pequeñas. Daily Discovery conserva su intención de descubrimiento.
4. Introducir novedad/exploración acotadas y señales Bliss/género; la popularidad global no debe dominar automáticamente el gusto individual.
5. Aplicar caps de artista/álbum, dedupe y desempate determinista por usuario, producto, periodo y `algorithm_version`. Con pocos candidatos se entrega una lista corta con diagnóstico, sin relajar bloqueos para rellenarla.

Razones públicas tipadas (`because_followed`, `new_release`, `similar_audio`, `underplayed`, `related_genre`) proceden de evidencia real. Los diagnósticos agregados conservan shortfall/procedencia, sin exponer pesos, historial o datos de otros usuarios.

### Relación con Smart Mix

El WIP Smart Mix tiene su diseño y plan unificados en las [fuentes canónicas del índice](00-index.md#fuentes-de-smart-mix). Su ranking de compatibilidad entre pistas y sus transiciones no sustituyen el ranking de afinidad/descubrimiento. Discovery fija una selección; playback puede aplicar transiciones compatibles sin cambiarla silenciosamente.

Se pueden reutilizar señales musicales mediante contratos compatibles cuando el WIP esté integrado. La primera entrega funciona con análisis disponibles y metadata: no espera Android crossfade ni VirtualDJ A+B+C. No se copian pesos o reglas del planner Smart Mix al frontend ni a este ranking.

## Generaciones y publicación

Contrato aditivo propuesto: `schema_version: 1`, `algorithm_version: "discovery-v1"`, `generation_id`, `product_id`, `period_start`, `period_end`, `generated_at`, `fresh_until`, `stale_after`, `input_revision`, `coverage` y razones por entrada. Versión de esquema y de selección tienen significados distintos.

Crear `discovery_generations` con propietario, producto, periodo, versión, revisión capturada y payload acotado de selección/orden/razones. Máximo inicial: 100 entradas por edición. No almacenar URLs firmadas, paths privados ni grids DSP. No hace falta tabla por pista mientras no exista una consulta que justifique normalizar esos elementos.

`discovery_generation_state`, por `(user_id, product_id)`, mantiene revisión solicitada, estado del job y `published_generation_id`. Es el punto de coordinación; el payload publicado es inmutable. Unicidad de trabajo por usuario/producto/periodo/versión/revisión: un retry no crea otra edición.

La revisión del usuario cubre preferencias, exclusiones y solicitudes; el job registra una lectura coherente de candidatos y procedencia de catálogo. `MAX(event_id)` no demuestra que todos los eventos anteriores hayan confirmado. Cambios concurrentes marcan una revisión pendiente y se comprueban con compare-and-swap al publicar: un job antiguo no desplaza una edición nueva ni revive contenido tras borrar la cuenta.

Insertar edición y promover puntero en una transacción; invalidar después de commit. Home incorpora ese `generation_id` y el detalle acepta la misma referencia. Disponibilidad y permisos se revalidan en lectura/reproducción: pueden ocultarse o deshabilitarse entradas conservando selección histórica. Inmutabilidad no autoriza un peer revocado ni contenido bloqueado. Una nueva edición no reordena la cola iniciada; las exclusiones explícitas se aplican antes del siguiente enqueue/prepare.

Política operativa inicial: precalentar usuarios activos en 30 días y generar bajo demanda para los demás. Daily/Scene: frescura de un día y stale máximo de tres días. Weekly/Radar: frescura semanal y stale máximo de catorce días, identificado como edición anterior. Conservar últimas cuatro ediciones y un máximo de 30 días por producto. Una referencia eliminada devuelve `expired`, nunca otra lista bajo el mismo ID. Guardar una playlist usa la funcionalidad existente y no retiene indefinidamente una generación.

## Release Radar y tiempo

Reutilizar `home_release_weeks.py` y `app/crate/db/releases.py`. La fecha de publicación determina la semana; `detected_at`/incorporación indica cuándo pudo descubrirse el lanzamiento. Un watermark de ingesta sirve para invalidar, no como filtro `release_date > watermark`.

Priorizar semana actual y admitir novedades detectadas tarde dentro de un lookback inicial de cuatro semanas, mostrando su semana real. No rellenar con discos antiguos recién importados ni anunciar fechas desconocidas como lanzamientos recientes. Los futuros releases siguen en Upcoming; sus previews no entran como tracks reproducibles. Un catálogo escaso produce Radar corto o vacío; My New Arrivals conserva su semántica más amplia.

## API, UI y feedback

Extender rutas actuales, sin otra familia `/api/me/discovery/*` para la misma función:

- `GET /api/me/home/mixes`: resumen y edición publicada.
- `GET /api/me/home/mixes/{mix_id}?generation_id=...`: edición del usuario; sin parámetro, última publicada. Mantener campos legacy del detalle.
- `POST /api/me/recommendations/feedback` y `/exposures`: contexto validado de producto/edición en `metadata`, con tamaño limitado; propietario derivado de auth.
- Rebuild/retry dirigido por usuario/producto en tareas operativas existentes, con estado/diagnósticos. Un nuevo panel Admin de ranking no es prerrequisito.

Reutilizar `dismiss`, `hide_for_now`, `not_interested` y acciones positivas con sus expiraciones. Añadir bloqueo persistente de artista y deshacer con semántica explícita: `not_interested`, que caduca, no equivale a bloqueo permanente. Las nuevas acciones `block_artist` y `unblock_artist` usan identidad canónica y scope común `discovery`; deshacer revoca el bloqueo en la misma transacción, sin dejar acciones contradictorias activas. Radio conserva su contrato. Feedback de una edición antigua afecta próximas selecciones y elegibilidad visible actual.

FastAPI es referencia funcional. Go mantiene paridad donde ya sirve las superficies y hace fallback para rutas nuevas hasta habilitarlas expresamente. Caches privadas incluyen usuario, producto, generación y revisión de permisos/exclusiones. Redis vacío no pierde ediciones PostgreSQL. Card, detalle y Play comparten referencia; rerenders no duplican exposiciones ni recalculan el mix.

## Operación, privacidad y evaluación

Reutilizar Dramatiq, `create_task_dedup`, scheduler, snapshots y projector. Claims/publicación DB protegen ante duplicados, concurrencia y reinicios: Redis no es la única garantía. Lotes limitan usuarios/candidatos/tiempo/reintentos, ceden ante presión de playback y conservan la última edición válida al fallar.

Historial y preferencias permanecen privados del nodo. La federación aporta identidad/catálogo/permiso, sin recibir perfiles individuales. Borrado de cuenta o historial aplicable invalida jobs derivados y borra payloads personalizados; una revisión antigua no puede publicarse después. Diagnósticos de Admin no contienen eventos crudos.

Esta revisión no aporta benchmarks nuevos ni engagement demostrado. Medir bibliotecas pequeñas, medianas y 48k pistas; hardware, concurrencia y usuarios activos reales, sin prometer generación para 10k usuarios. Registrar cold/warm, p50/p95, consultas, candidatos examinados, tiempo/RSS por job, cola, freshness y efecto sobre playback.

Gates duros: cero bloqueos/peers no autorizados en fixtures, cero duplicados canónicos conocidos, misma edición en card/detalle/play, CAS correcto y ausencia de N+1. Ocho artistas por veinte tracks es un objetivo condicionado a ocho artistas elegibles, no una obligación para una biblioteca de tres artistas. PD01 fija presupuestos absolutos medidos; comparación warm inicial con tolerancia máxima del 10% de p95 bajo muestras comparables.

Medir disponibilidad en generación y resolución de playback por separado. Offline mide cobertura/diversidad/estabilidad, no reducción de skips. Engagement requiere plays atribuibles a edición, skips tempranos, saves/retorno semanal, denominadores y muestra declarados. No usar cohortes porcentuales ficticias en un nodo con pocos usuarios.
