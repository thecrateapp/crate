# Bandcamp Updates and Setlist Shows Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Repair Bandcamp follow synchronization, add a connection-scoped Bandcamp Discover feed, and enrich upcoming shows with Setlist.fm without replacing Ticketmaster or leaking private Bandcamp data.

**Architecture:** Keep provider I/O in worker tasks and expose only normalized, cached read data to Listen. Bandcamp remains user-scoped and is visible only while the user has an active Bandcamp connection. Ticketmaster remains the primary event source; Setlist.fm becomes a supplemental provider stored in the existing `shows` model and merged with the current event read path.

**Tech Stack:** Python 3.13, FastAPI, Dramatiq, PostgreSQL, Redis cache, React 19, Vitest/Testing Library, pytest.

---

## Decisions from Phase 0

- The documented Bandcamp API is not a fan discovery API. The Discover web request is an undocumented internal contract and must be isolated behind an adapter and feature flag.
- The current Bandcamp follow sync is broken because `following_bands` returns `followeers` and uses `url_hints`; the parser currently ignores both.
- The production account currently has 130 follows, but the local database has zero active `following` rows. A full sync is required after the parser fix.
- The 2,953 authenticated Discover results are release/publication items produced by those follows, not 2,953 followed artists.
- `stream_url` and other temporary/tokenized playback fields must never be persisted.
- A user without an active Bandcamp connection must receive zero Bandcamp feed/radar items. This must be enforced in backend queries and endpoints, not only in the UI.
- Setlist.fm can contain upcoming events, but its API is primarily a setlist API and does not provide the Ticketmaster-level ticket, price, status, or time data. It is a secondary source.
- The final navigation decision between Radar and a new Updates surface remains a checkpoint after the normalized data contracts and source coverage are validated. The backend must expose one canonical dataset to avoid duplicating releases and shows in two routes.

## Non-goals

- Replacing Ticketmaster as the primary upcoming-show provider.
- Treating Setlist.fm as a ticket inventory or price source.
- Calling Bandcamp or Setlist.fm synchronously from a Listen request.
- Persisting Bandcamp preview/playback URLs, cookies, or raw credential material.
- Using the undocumented Bandcamp Discover endpoint without a kill switch, bounded pagination, and response-shape validation.
- Deciding the final Radar/Updates navigation before the source spike has produced representative data.

## Roadmap de producto por fases

Esta es la secuencia de producto que debe gobernar la ejecución. Las tareas técnicas posteriores detallan cómo implementarla, pero no deben hacer que una fuente externa incierta bloquee el MVP.

### Fase 0: validación técnica de fuentes

**Estado:** parcialmente completada durante la investigación inicial.

La validación debe conservar una matriz reproducible para varios tipos de fuente:

- probar RSS de varios artistas Bandcamp reales;
- comprobar si sigue existiendo un endpoint RSS/feed de artista;
- probar artistas con subdominio, artistas sin RSS y sellos;
- comprobar si hay autodiscovery mediante `Link: rel=alternate` o HTML equivalente;
- analizar si el feed devuelve fechas, imágenes, URL canónica y GUID estable;
- medir `200`, `304`, `403`, `404`, `429`, timeouts y respuestas HTML inesperadas;
- probar paginación o límites de respuesta cuando existan;
- conservar muestras sanitizadas de cada formato para tests de regresión;
- revisar términos de uso y límites de Bandcamp antes de convertir RSS o Discover en fuentes permanentes.

Resultado confirmado hasta ahora:

- Los endpoints RSS probados de varios artistas devolvieron `404`; no se puede tratar RSS como fuente estable sin una nueva evidencia.
- Las páginas `/music` sí son accesibles, pero el scraping HTML sería frágil y no debe ser la base del MVP.
- El Discover autenticado funciona para una cuenta conectada, pero es un contrato web interno y no una API pública documentada.
- El endpoint antiguo de follows funciona, pero requiere corregir `followeers` y `url_hints`.
- Setlist.fm expone datos de setlists y puede incluir próximos eventos, pero no es un inventario completo de tickets.

**Criterio de salida:** RSS queda clasificado como `stable`, `optional-experimental` o `unsupported`. Con la evidencia actual debe quedar como `optional-experimental/unsupported`, detrás de feature flag, mientras Discover autenticado se mantiene como adaptador separado y explícitamente frágil.

### Fase 1: Feed MVP sin nueva dependencia externa

Construir primero el feed con información que Crate ya tiene:

- `new_releases`;
- datos de `/api/me/upcoming`, reutilizando sus queries/repositorios y no haciendo llamadas HTTP internas;
- shows existentes;
- Bandcamp Radar ya sincronizado;
- artistas seguidos y sus metadatos locales.

El MVP debe:

- entregar valor sin RSS, Discover ni Setlist.fm;
- reutilizar datos cacheados y el read path existente;
- incluir paginación o cursor desde el principio;
- devolver `source`, `published_at/event_date`, `canonical_url`, tipo y estado de cada item;
- deduplicar releases y shows que ya aparecen en Radar/upcoming;
- respetar la conexión Bandcamp activa para cualquier item privado;
- permitir validar densidad, orden, filtros y navegación antes de añadir fuentes externas.

La decisión visual entre ampliar Radar o crear Updates sigue siendo un checkpoint. El MVP debe exponer un contrato backend único que ambas proyecciones puedan consumir sin duplicar agregación.

### Fase 2: fuentes externas controladas

#### Fase 2A: Bandcamp RSS experimental

Si la Fase 0 encuentra feeds válidos para algún subconjunto de artistas, añadir un worker específico que:

- descubra RSS a partir de URLs Bandcamp conocidas;
- guarde `ETag` y `Last-Modified` por URL;
- use `If-None-Match` e `If-Modified-Since`;
- aplique backoff exponencial y jitter;
- limite la concurrencia y el número de URLs por ejecución;
- nunca consulte feeds durante las peticiones de la UI;
- conserve el payload original sanitizado para depuración;
- normalice GUID, URL canónica, título, fecha, imagen y artista;
- marque el parser/source como degradado si cambia el formato.

No se consultarían los aproximadamente 900 artistas continuamente. El orden inicial sería:

1. artistas seguidos por el usuario;
2. artistas representados en la wishlist Bandcamp del usuario;
3. artistas con URL Bandcamp explícita en la biblioteca;
4. intervalo de 6–12 horas, ampliable para feeds sin actividad.

RSS debe ser una fuente opcional: si no existe para un artista o devuelve `404`, no es un error del feed ni se sustituye por scraping agresivo.

#### Fase 2B: Bandcamp Discover autenticado

En paralelo, para usuarios con conexión Bandcamp activa, se puede habilitar el adaptador Discover ya definido en este plan:

- reutiliza la sesión cifrada del usuario;
- consulta solo `followed_bands=true`;
- pagina mediante cursor y con máximo configurable;
- persiste solo campos estables;
- no persiste `stream_url` ni tokens de reproducción;
- mantiene los items aislados por usuario/conexión;
- marca el endpoint como degradado si cambia su contrato;
- permite desactivación global inmediata mediante feature flag.

Discover no reemplaza la validación legal de RSS ni debe convertirse en una dependencia global del feed: un usuario sin conexión Bandcamp no genera ninguna llamada ni recibe ningún item.

### Fase 3: noticias editoriales reales

Para noticias, anuncios y contexto editorial que no cubren Bandcamp o MusicBrainz, añadir una segunda familia de fuentes permitidas:

- webs oficiales de artistas;
- webs de sellos;
- newsletters públicas;
- blogs oficiales de artistas o sellos;
- páginas de eventos y promotoras cuando publiquen anuncios editoriales.

Esta fase necesita un registro de fuentes, no un crawler global:

- URL de origen y tipo de fuente;
- artista/sello asociado y método de asociación;
- política de frecuencia y `ETag`/`Last-Modified`;
- estado de la fuente, último éxito y último error;
- reglas de robots, términos y allowlist;
- parser versionado por formato.

El modelo de noticia debería conservar como mínimo:

- `source_url` y URL canónica;
- GUID o hash de contenido;
- título, fecha publicada y fecha descubierta;
- fuente, autor y artista/sello asociado;
- extracto o texto extraído permitido;
- payload original sanitizado para diagnóstico;
- estado de deduplicación y publicación.

No se debe hacer scraping de páginas arbitrarias desde la petición del usuario ni asumir que una página de eventos equivale a una entrada de ticketing. Los avisos de conciertos se integran con `shows`; las noticias editoriales se mantienen como items de contenido.

### Fase 4: enriquecimiento opcional con IA

La IA se incorpora después de tener una fuente y una URL original válidas. No se usa como fuente de descubrimiento recurrente.

Casos permitidos:

- resumir una noticia;
- agrupar varias fuentes sobre el mismo lanzamiento o anuncio;
- detectar si un artículo pertenece realmente al artista/sello asociado;
- extraer una fecha de gira o lanzamiento para revisión;
- clasificar el tipo de noticia.

Cada resultado generado debe conservar:

- URL original;
- fuente y fecha de publicación;
- texto extraído o hash/referencia del texto usado;
- modelo y proveedor;
- versión del prompt;
- fecha de generación;
- resumen o extracción generada;
- indicador explícito de contenido generado por IA;
- estado de revisión y posibilidad de descartar/regenerar.

La IA debe ejecutarse bajo demanda o como tarea asíncrona limitada, con deduplicación por hash de contenido y sin reemplazar el texto original.

## Orden de ejecución actualizado

1. Fase 0: cerrar y documentar la matriz de validación de fuentes.
2. Reparar el parser de follows y aplicar el aislamiento por conexión Bandcamp.
3. Fase 1: construir y validar el MVP con datos locales existentes.
4. Ejecutar el spike de cobertura de Setlist.fm y añadirlo como proveedor suplementario si supera el umbral acordado.
5. Habilitar Bandcamp Discover autenticado detrás de feature flag.
6. Implementar RSS solo para las fuentes que hayan superado la Fase 0.
7. Añadir el registro de fuentes editoriales y sus workers.
8. Añadir IA únicamente sobre items ya ingeridos y con revisión/provenance.
9. Elegir definitivamente Radar o Updates y activar la proyección final.

## Tareas técnicas añadidas para las fases omitidas

### Roadmap Task F0.1: Cerrar la matriz de validación RSS y términos

**Files:**
- Create: `docs/research/2026-08-22-bandcamp-feed-validation.md`
- Test fixtures: `app/tests/fixtures/bandcamp/`

**Steps:**

1. Registrar por artista/sello la URL probada, código HTTP, content type, tamaño, campos detectados y fecha de la prueba.
2. Añadir muestras sanitizadas de `200`, `404`, `403` y HTML inesperado si aparecen.
3. Documentar si existe autodiscovery y qué identificador estable ofrece cada fuente.
4. Registrar las conclusiones legales/operativas y el estado final `stable`, `optional-experimental` o `unsupported`.
5. No convertir una respuesta puntual en soporte estable sin repetir la prueba con varias fuentes.

### Roadmap Task F1.1: Definir el contrato del MVP antes de añadir proveedores

**Files:**
- Modify: `app/crate/api/schemas/utility.py` y/o el esquema de feed correspondiente
- Create or modify: `app/crate/db/queries/updates.py`
- Test: `app/tests/test_updates_queries.py`

**Steps:**

1. Definir el discriminador de item (`release`, `show`, `bandcamp`, `artist`, `news`) y sus campos comunes.
2. Definir `source`, `canonical_url`, `published_at`, `event_date`, `artist`, `image_url` y `dedupe_key` como campos separados.
3. Componer el MVP desde `new_releases`, shows existentes, Radar y follows locales.
4. Testear deduplicación, orden estable, límite y paginación sin llamadas HTTP externas.
5. Testear que los items Bandcamp se excluyen si no existe una conexión activa.

### Roadmap Task F2.1: Crear la infraestructura común de fuentes externas

**Files:**
- Create: `app/crate/feeds/`
- Create migration: `app/crate/db/migrations/versions/<revision>_external_feed_sources.py`
- Create: `app/crate/db/repositories/external_feeds.py`
- Test: `app/tests/test_external_feeds.py`

**Steps:**

1. Crear tablas para fuentes e items externos con URL canónica, GUID/hash, estado, timestamps, `ETag`, `Last-Modified`, último error y versión del parser.
2. Separar los items editoriales de los eventos de `shows`; no introducir noticias como filas ficticias en `shows`.
3. Añadir índices para fuente, artista, fecha publicada, estado y hash/GUID.
4. Mantener payloads originales sanitizados y limitar tamaño para evitar almacenar HTML indefinido.
5. Testear upsert idempotente, `304 Not Modified`, cambio de GUID, contenido duplicado y expiración de fuente.

### Roadmap Task F2.2: Implementar el worker RSS experimental

**Files:**
- Create: `app/crate/feeds/rss.py`
- Create or modify: `app/crate/worker_handlers/feeds.py`
- Modify: `app/crate/actors.py` y el registro de tareas
- Test: `app/tests/test_rss_feeds.py`
- Test: `app/tests/test_feed_worker.py`

**Steps:**

1. Usar el parser XML existente de Python o una dependencia ya aprobada; no añadir un crawler HTML para resolver el caso RSS.
2. Implementar autodiscovery y URLs conocidas con validación de host.
3. Enviar `If-None-Match`/`If-Modified-Since` y persistir sus valores de respuesta.
4. Aplicar timeout, backoff exponencial, jitter, límite de concurrencia y límite por ejecución.
5. Programar la primera selección únicamente para follows, wishlist y URLs Bandcamp explícitas, no para los 900 artistas.
6. Normalizar título, GUID, URL canónica, fecha, imagen, autor y artista asociado.
7. Conservar payload original sanitizado y versión del parser para depuración.
8. Testear `200`, `304`, `403`, `404`, `429`, timeout, XML inválido, GUID ausente y feed sin actividad.
9. Mantener el worker detrás de `CRATE_EXTERNAL_RSS_ENABLED=false` hasta superar la validación de Fase 0.

**Estado del corte actual (2026-08-23):**

- La infraestructura de parser, persistencia y refresh está implementada y
  cubierta por tests.
- La selección de candidatos ya combina follows locales/canónicos, wishlist y
  following Bandcamp activos, y URLs Bandcamp explícitas de la biblioteca.
- La selección deduplica por artista y prioriza la relación más fuerte antes de
  hacer autodiscovery público del RSS.
- La autodetección se ejecuta únicamente en worker, registra solo feeds
  encontrados y trata ausencia/404 como fuente sin feed; no hace fallback a
  scraping agresivo.
- El scheduler y el actor existen, pero la feature permanece inerte con
  `CRATE_EXTERNAL_RSS_ENABLED=false`.

### Roadmap Task F3.1: Registrar y sincronizar fuentes editoriales

**Files:**
- Create: `app/crate/feeds/editorial.py`
- Modify: `app/crate/worker_handlers/feeds.py`
- Modify: `app/crate/db/repositories/external_feeds.py`
- Test: `app/tests/test_editorial_feeds.py`

**Steps:**

1. Crear un registro explícito de fuentes por artista/sello, con tipo `artist_site`, `label`, `newsletter`, `blog` o `event_page`.
2. Exigir allowlist y asociación conocida antes de ingerir una URL.
3. Respetar robots, términos, frecuencia configurada y señales de `ETag`/`Last-Modified`.
4. Implementar parsers específicos y versionados; no añadir un scraper universal basado en heurísticas.
5. Normalizar noticia, anuncio, fecha, autor, URL canónica y asociación artística.
6. Separar las noticias de los eventos: una página editorial de gira puede generar una propuesta revisable, pero no debe crear automáticamente un concierto sin datos suficientes.
7. Testear fuentes válidas, HTML cambiado, asociación ambigua, contenido duplicado y error de fuente aislado.

### Roadmap Task F4.1: Añadir enriquecimiento opcional con IA sobre items ingeridos

**Files:**
- Create: `app/crate/llm/prompts/feed_summary.py`
- Create or modify: `app/crate/feeds/ai_enrichment.py`
- Modify: `app/crate/worker_handlers/feeds.py`
- Test: `app/tests/test_feed_ai_enrichment.py`

**Steps:**

1. Aceptar únicamente un item externo ya ingerido con URL y texto/extracto disponibles.
2. Añadir tareas on-demand o asíncronas deduplicadas por hash de contenido.
3. Usar la abstracción LLM existente y registrar proveedor, modelo, prompt version y timestamp.
4. Permitir resumen, agrupación, clasificación de pertenencia y extracción de fechas como operaciones separadas.
5. Conservar siempre el texto/origen original y marcar el resultado como generado por IA.
6. Añadir estados `pending`, `ready`, `failed`, `rejected` y `stale`.
7. Testear proveedor no configurado, respuesta malformada, reintento, contenido repetido y aceptación/rechazo editorial.
8. No ejecutar IA como parte de una petición de feed ni como crawler recurrente de fuentes.

## Canonical provider contracts

### Bandcamp follow item

Normalize the `followeers` payload into the existing `bandcamp_items` shape:

- `bandcamp_item_type`: `artist`
- `band_id`: Bandcamp band ID
- `artist_name`: response `name`
- `item_url` and `artist_url`: HTTPS URL derived from `url_hints.subdomain` when available
- `bandcamp_item_id`: nullable when the following endpoint does not expose an item ID
- sanitized `raw_json`: public metadata only

If a custom domain is present, use it only after explicit host validation. Prefer the Bandcamp subdomain when both are available. A record without a safely constructible URL must not make the whole sync fail; it should be reported as skipped with a metric.

### Bandcamp Discover item

Persist only stable fields:

- item ID/type, band ID, artist, title
- release/publication date
- item URL and cover identity/URL
- package/price metadata when present
- source account/user and cursor metadata outside the item payload

Discard `stream_url`, encoding tokens, signed URLs, and any response field that is clearly temporary or playback-related. Use a dedicated source value such as `discover_followed` when writing the existing user-scoped Radar/read model.

### Upcoming show

Keep the existing `shows` contract and add provider normalization only:

- provider-specific `external_id` (`ticketmaster:<id>` or `setlistfm:<id>`)
- artist, event date, venue, city, country, URL, source
- optional time, coordinates, image, price, ticket URL, lineup

Setlist.fm records must not fabricate missing ticket, price, time, or sale-status fields.

---

## Phase 1: Repair Bandcamp following synchronization

### Task 1.1: Add failing parser tests

**Files:**
- Modify: `app/tests/test_bandcamp_integration.py`
- Reference: `app/crate/bandcamp/web.py:287-380`

**Steps:**

1. Add a fixture where the response uses `followeers`, `last_token`, and `more_available`.
2. Assert that `parse_fancollection_page(..., relation_type="following")` returns one normalized artist entry instead of an empty list.
3. Include `url_hints.subdomain` and assert the normalized URL is `https://<subdomain>.bandcamp.com`.
4. Add a second fixture with two pages and assert the `last_token` is used and all entries are retained without duplication.
5. Run:

   ```bash
   pytest -q app/tests/test_bandcamp_integration.py -k "fan_identity or bandcamp_web or collection_sync"
   ```

   Expected result: the new tests fail because `followeers` and `url_hints` are not supported.

### Task 1.2: Implement the minimum parser fix

**Files:**
- Modify: `app/crate/bandcamp/web.py:442-453`
- Modify: `app/crate/bandcamp/web.py:308-380`

**Steps:**

1. Add `followeers` to the accepted page-item keys.
2. Add a small helper that derives a safe Bandcamp artist URL from `url_hints`.
3. Map `name` to `artist_name`, force `artist` as the item type, and preserve `band_id` and `date_followed` in sanitized raw metadata.
4. Keep malformed individual records skippable and observable; do not turn a bad follow into a failed collection sync.
5. Run the focused tests again and expect them to pass.

### Task 1.3: Validate the production repair without mutating data

**Files:**
- No source changes.
- Optional diagnostic script: do not commit credentials or response dumps.

**Steps:**

1. Run the parser against a sanitized production-shaped payload locally.
2. Confirm the production connection still validates without printing session material.
3. Confirm the production endpoint reports approximately 130 follows across two pages.
4. Do not run the full production sync until the code is deployed and reviewed.
5. Record the expected post-deploy invariant: active `following` rows must be greater than zero and match the provider result within the configured sync window.

---

## Phase 2: Enforce Bandcamp connection scoping

### Task 2.1: Add failing repository/API tests for disconnected users

**Files:**
- Modify: `app/tests/test_bandcamp_integration.py`
- Modify or create: the relevant Bandcamp API test module under `app/tests/`
- Reference: `app/crate/db/repositories/bandcamp.py:413-429, 1501-1608`
- Reference: `app/crate/api/bandcamp.py:397-417`

**Steps:**

1. Seed a user with Bandcamp items and Radar rows.
2. Revoke the connection and assert that Radar, collection, wishlist, and following read endpoints return no private items.
3. Assert that a Radar refresh cannot enqueue work for a user without an active connection.
4. Assert that a connected user continues to see the same rows.
5. Run the new tests and confirm they fail against the current implementation.

### Task 2.2: Add the active-connection repository invariant

**Files:**
- Modify: `app/crate/db/repositories/bandcamp.py`
- Modify: `app/crate/api/bandcamp.py`
- Modify: `app/crate/worker_handlers/bandcamp.py`

**Steps:**

1. Add a concrete repository helper that checks `status = 'connected'` and `revoked_at IS NULL` for the user.
2. Apply the invariant to all user-private Bandcamp reads, especially `list_bandcamp_radar_items`.
3. Guard the Radar refresh API and worker path with the same invariant.
4. Preserve rows for a possible future reconnect, but hide them immediately after revocation. Do not delete historical contribution/provenance records as part of this change.
5. Return an empty private feed, not an authorization error, when the user is authenticated but Bandcamp is not connected; the UI can then show the connect prompt.
6. Add cache invalidation for the Bandcamp/user feed scope on connect, sync, error, and disconnect.

### Task 2.3: Verify the existing Listen surface

**Files:**
- Modify: `app/listen/src/pages/Bandcamp.tsx`
- Test: `app/listen/src/pages/Bandcamp.test.tsx`

**Steps:**

1. Ensure the page does not render stale Radar/collection/wishlist rows while `connected !== true`.
2. Keep `/api/bandcamp/me/status` available so the page can render the connection CTA.
3. Add a render test for disconnected state with pre-existing API rows; expected result is no private cards.
4. Run the focused Listen test.

---

## Phase 3: Add the Bandcamp Discover adapter

### Task 3.1: Add failing Discover contract tests

**Files:**
- Create: `app/tests/test_bandcamp_discover.py`
- Reference: `app/crate/bandcamp/web.py`

**Steps:**

1. Mock a successful authenticated Discover response with `cursor`, stable item fields, and a temporary `stream_url`.
2. Assert cursor pagination stops on an empty/repeated cursor and does not duplicate items.
3. Assert temporary playback fields are absent from the normalized item and raw payload.
4. Add tests for HTTP 401/403, malformed JSON, missing cursor, and rate-limit responses.
5. Add a test asserting the adapter never runs without a valid session material.

### Task 3.2: Implement the bounded Discover client

**Files:**
- Create: `app/crate/bandcamp/discover.py`
- Modify: `app/crate/bandcamp/web.py` only if shared session helpers are needed
- Modify: `.env.example`

**Steps:**

1. Reuse the existing encrypted Bandcamp session loading and `requests.Session`; do not duplicate credential handling.
2. Implement `followed_bands=true` with configurable page size, maximum pages, timeout, and feature flag.
3. Normalize only the canonical fields defined above.
4. Validate response shape before accepting a page and surface a provider-contract error when Bandcamp changes it.
5. Add rate limiting and cache metadata so repeated feed loads do not call Bandcamp.
6. Run the Discover tests and expect them to pass.

### Task 3.3: Persist and refresh Discover items

**Files:**
- Modify: `app/crate/db/repositories/bandcamp.py`
- Modify: `app/crate/worker_handlers/bandcamp.py`
- Modify: `app/crate/actors.py` only if a separate task is required
- Test: `app/tests/test_bandcamp_integration.py`

**Steps:**

1. Reuse `bandcamp_items` plus the existing user-scoped Radar/read model where possible; do not create a second feed table without evidence that Radar cannot represent the lifecycle.
2. Add a `discover_followed` source and preserve release date/order in `reason_json` or an explicit existing field.
3. Refresh Discover only for users with an active Bandcamp connection.
4. Keep existing wishlist/following Radar candidates and Discover releases distinguishable by source.
5. Mark stale/removed Discover candidates without deleting user dismissal/save state.
6. Add task events and counters for pages fetched, items accepted, items skipped, provider errors, and session errors.
7. Test idempotency: running the refresh twice must not create duplicate user/source rows.

### Task 3.4: Run a production read-only/controlled validation

**Steps:**

1. Deploy only the adapter behind the feature flag.
2. Run it for the connected production account with a bounded page count.
3. Compare provider pages, normalized rows, deduplication, and source dates.
4. Confirm that no `stream_url` or cookie appears in PostgreSQL, Redis task payloads, task events, logs, or metrics.
5. Enable the feature only after the validation report is clean.

**Checkpoint A:** decide whether the user-facing surface should be an expanded Radar or a new Updates route. Both options must consume the same backend items and must not independently fetch providers.

---

## Phase 4: Add Setlist.fm as a supplemental upcoming-show provider

### Task 4.1: Define and test the Setlist.fm upcoming-event normalizer

**Files:**
- Modify: `app/crate/setlistfm.py`
- Modify: `app/tests/test_setlistfm.py`

**Steps:**

1. Add an explicit `is_configured()` helper that checks the existing API key setting.
2. Add a provider method separate from probable-setlist prediction, using the artist MBID and bounded pagination.
3. Parse `eventDate` strictly and retain only future events for the upcoming-show path.
4. Normalize artist, venue, city, country, tour, event URL, and provider ID.
5. Leave time, ticket URL, price, image, and sale status empty when Setlist.fm does not provide them.
6. Cache the normalized result and respect the existing provider slot/rate limit.
7. Add tests for future events, past events, missing dates, malformed records, missing API key, HTTP 429, and provider outage.

### Task 4.2: Integrate Setlist.fm into the show sync worker

**Files:**
- Modify: `app/crate/worker_handlers/integrations.py:29-130`
- Modify: `app/crate/db/repositories/shows_ticketmaster_upserts.py`
- Modify: `app/tests/test_integrations_handler.py`

**Steps:**

1. Keep Ticketmaster as the primary provider and retain its ticket/price/time data.
2. For artists with a reliable MusicBrainz MBID, fetch the bounded Setlist.fm upcoming candidates.
3. Upsert Setlist.fm records using stable IDs such as `setlistfm:<id>` and `source='setlistfm'`.
4. Do not remove existing Ticketmaster events when Setlist.fm returns no data.
5. Add provider-specific counters and partial-failure reporting to the sync task.
6. Keep provider calls worker-owned; never perform them from `/api/me/upcoming`.
7. Add tests for a Setlist-only show, a Ticketmaster-only show, a matching show from both providers, and a Setlist provider failure that does not abort the sync.

### Task 4.3: Improve show deduplication and provenance

**Files:**
- Modify: `app/crate/db/queries/shows_shared.py`
- Modify: `app/tests/test_shows_shared.py`
- Review: `app/crate/db/queries/shows_upcoming_queries.py`

**Steps:**

1. Continue deduplicating by normalized artist/date/time/venue/city/country.
2. Include `setlistfm` in source scoring below `ticketmaster` but above an anonymous event.
3. When both providers match, expose `source='both'` in the read row and preserve the richest fields from Ticketmaster.
4. Preserve the Setlist.fm URL as provenance when it is the only available event link.
5. Assert that attendance/reminder flows receive one canonical show row after deduplication.

### Task 4.4: Measure coverage before enabling broadly

**Steps:**

1. Run a provider spike over a representative sample of library artists with MBIDs.
2. Measure future-event hit rate, duplicate rate against Ticketmaster, missing venue/date rate, API calls, and runtime.
3. Choose a bounded refresh cadence based on the measured rate and the API quota.
4. If Setlist.fm does not provide sufficient future coverage, keep it enabled only as an artist-page/event-detail supplement rather than presenting it as a complete feed.

**Checkpoint B:** approve Setlist.fm for the main upcoming feed only if coverage and data quality are acceptable. Otherwise retain it for historical setlists and probable-setlist intelligence.

---

## Phase 5: Unify the read contract and decide Radar versus Updates

### Task 5.1: Define one backend aggregation contract

**Files:**
- Modify: `app/crate/api/me.py` or add a focused feed query module
- Modify: `app/crate/api/schemas/utility.py` and related response schemas
- Modify: `app/crate/db/home_builder_upcoming_feed.py` if Home reuses the same data
- Test: `app/tests/test_api.py` and focused feed query tests

**Steps:**

1. Define source-aware item types for releases, shows, and Bandcamp discoveries.
2. Apply user ownership/connection filtering before merging or sorting.
3. Deduplicate releases already present in the local release pipeline and shows already present in `shows`.
4. Keep provider timestamps separate from ingestion timestamps so sorting is truthful.
5. Return source/provenance metadata for UI badges and debugging.
6. Ensure an unconnected user receives no Bandcamp item and no Bandcamp provider call.

### Task 5.2: Implement the selected Listen surface

**Files:**
- Modify: `app/listen/src/pages/Shows.tsx` or create the selected Updates page
- Reuse existing shared cards/components where possible
- Test: focused Vitest/Testing Library page tests

**Steps:**

1. Render one canonical feed projection; do not duplicate aggregation logic in the client.
2. Keep current Radar release/show behavior stable while the new source is behind a feature flag.
3. Add source labels for Bandcamp, Ticketmaster, and Setlist.fm where useful.
4. Hide Bandcamp controls and cards for unconnected users and show the connection CTA instead.
5. Ensure duplicate releases/shows are not rendered in two adjacent sections.
6. Add loading, empty, stale-provider, and partial-provider-error states.

### Task 5.3: Verify responsive and accessibility behavior

**Files:**
- Modify selected Listen components
- Test: selected page tests and `@crate/ui` component tests where applicable

**Steps:**

1. Verify keyboard navigation, link names, source labels, and date semantics.
2. Verify mobile card layout and desktop density.
3. Verify that a missing Setlist.fm ticket URL does not render a misleading purchase action.
4. Run the UI test and typecheck commands.

---

## Phase 6: Documentation, observability, and rollout

### Task 6.1: Update canonical technical documentation

**Files:**
- Modify: `docs/technical/05-enrichment-acquisition-and-integrations.md`
- Modify: `docs/technical/02-backend-api-and-data.md`
- Modify: `docs/technical/03-worker-tasks-and-background-services.md`
- Modify: `.env.example`

Document:

- the `followeers`/`url_hints` compatibility behavior
- the undocumented Bandcamp Discover risk and feature flag
- the no-active-connection visibility invariant
- the Setlist.fm secondary-provider role and non-commercial API terms
- provider refresh cadence, limits, and failure semantics
- fields that must never be persisted, especially Bandcamp playback URLs

### Task 6.2: Add operational metrics and alerts

Track at minimum:

- Bandcamp follow pages/items accepted/skipped
- Bandcamp Discover pages/items accepted/skipped
- Bandcamp connection-gated reads
- Bandcamp session failures and response-shape failures
- Setlist.fm calls, rate limits, future events found, and failures
- duplicate show merges by provider

### Task 6.3: Run verification

Run the focused suites first:

```bash
pytest -q app/tests/test_bandcamp_integration.py app/tests/test_bandcamp_discover.py
pytest -q app/tests/test_setlistfm.py app/tests/test_integrations_handler.py app/tests/test_shows_shared.py
npm run --workspace=app/listen test -- --run
npm run --workspace=app/listen typecheck
```

Then run the repository verification flow:

```bash
~/.codex/viterbit-ai-tools/.codex/viterbit-codex verify
```

Expected result: all focused tests and the full verification flow pass, with no credential, cookie, or temporary Bandcamp playback data in tracked files or persisted payloads.

### Task 6.4: Roll out progressively

1. Deploy parser and connection-gating fixes first.
2. Run and verify the production Bandcamp sync.
3. Enable Discover for one controlled account.
4. Run the Setlist.fm coverage spike.
5. Enable Setlist.fm show persistence only after the coverage checkpoint.
6. Choose and enable the final Radar/Updates projection last.

## Suggested commit sequence

1. `fix: repair Bandcamp following sync parsing`
2. `fix: hide Bandcamp data without active connection`
3. `feat: add authenticated Bandcamp Discover refresh`
4. `feat: add Setlist.fm upcoming show provider`
5. `feat: unify source-aware updates feed`
6. `docs: document Bandcamp and live-show provider behavior`
