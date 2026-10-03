# Listen Crates — review follow-ups

Fecha: 2026-10-02 · Rama: `codex/crate-coverflow-mockups`

Plan derivado de la review de la feature Crates (backend, frontend, visual y compartir).

## Decisiones de producto

1. Un Crate `public` se ve completo sin login. Con sesión de Crate hay reproducción; sin sesión no hay reproducción (CTA a iniciar sesión con `return_to`).
2. "Like" se unifica con el modelo de playlists: **follow** (`follower_count`, `is_followed`, `POST/DELETE /follow`, "Seguir/Siguiendo").
3. La descarga ZIP de un Crate público está permitida a cualquier usuario autenticado.
4. Si el Crate es privado, "Compartir Crate" aparece deshabilitado.
5. Entran: story de Instagram en web (Web Share API con fichero / descarga) y post cuadrado 1080×1080.
6. Click en una card de Crate abre el detalle. Editar queda en el menú y en la página.
7. Terminología: "Crate" en todos los idiomas.

## Decisiones técnicas

- **OG image compuesta on-demand + Redis**, no pre-render en worker. Se compone con Pillow en el API (sin escribir a disco), se cachea en Redis por hash de contenido (ids de álbum + orden + nombre + `updated_at`) con TTL de 7 días y `Cache-Control` público. Solo se ejecuta en cache miss y lo piden casi solo los crawlers. El pre-render en worker exigiría storage compartido, eventos e invalidación nueva para el mismo resultado.
- **Portadas públicas acotadas**: nuevo `/share/image/crate/{crate_id}/album/{global_album_uid}`, que solo sirve si el álbum pertenece a un Crate `public`. `/api/catalog/albums/*/cover` sigue autenticado.
- **Descarga ZIP**: se mantiene en el API, igual que `api_download_album`. Se arregla: `ZIP_STORED` (el audio ya está comprimido), lookup de tracks en batch, `realpath`, sin colisiones de nombres y el nombre del Crate leído antes. Moverla al worker cambiaría la UX (polling) y queda fuera.
- La migración `101` no se aplicó en ningún entorno, así que se reescribe como `crate_followers` en lugar de añadir otra.

## Contrato API

| Método      | Ruta                                                     | Auth     | Notas                                                                                 |
| ----------- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| GET         | `/api/crates/{id}`                                       | opcional | Anónimo: solo si es `public`. Añade `follower_count`, `is_followed` y `owner_avatar`. |
| POST/DELETE | `/api/crates/{id}/follow`                                | sí       | Solo Crates `public` ajenos. Seguirse a uno mismo devuelve 409.                       |
| GET         | `/api/me/crates/followed`                                | sí       | Crates públicos que sigo (`CrateSummaryResponse`).                                    |
| GET         | `/share/crate/{id}`                                      | no       | Landing HTML i18n (`Accept-Language`), 404 en HTML.                                   |
| GET         | `/share/image/crate/{id}`                                | no       | JPEG 1200×630, abanico de portadas.                                                   |
| GET         | `/share/image/crate/{id}/album/{global_album_uid}?size=` | no       | Portada de un álbum de un Crate público.                                              |

## Fases

### Fase 1: backend

- [x] Migración 101 → `crate_followers` (`followed_at`). Repo `follow_crate`/`unfollow_crate` con `INSERT … SELECT … WHERE visibility='public' AND owner_id <> :user`.
- [x] Queries: `follower_count` / `is_followed`; `get_followed_crates_for_user`.
- [x] `share.py`: portada pública por álbum, OG compuesta, landing rediseñada (lista de álbumes, dueño, i18n es/en/ca/eu/fr/de/it, marca, 404 HTML, favicon) y placeholders PNG en lugar de SVG.
- [x] Download: los fixes listados en las decisiones técnicas.
- [x] Offline manifest y semilla de radio: `UUID` tipado (404, no 500), sin duplicados por el JOIN con `OR`, semilla muestreada por álbum respetando `sort_direction`.
- [x] Tests: follow, anónimo, portada pública (público y privado), OG image, landing 404.

### Fase 2: frontend público y compartir

- [x] `PublicCrate`: sin sesión, shell pública mínima sin providers autenticados (sin redirect a login). Con sesión, la página normal.
- [x] `Crate.tsx` en modo anónimo: sin play, shuffle, follow, offline ni descarga; CTA "Inicia sesión para escuchar". Editor con `React.lazy`.
- [x] Portadas en modo anónimo → endpoint público acotado.
- [x] Share deshabilitado si el Crate es privado (card, página, menús).
- [x] Story: rehacer la composición ordenada, multi-portada siempre, zonas seguras, URL visible, i18n.
- [x] Post cuadrado 1080×1080.
- [x] Web: `navigator.share({files})` si está disponible; si no, descarga.
- [x] ShareSheet: texto localizado, copiar enlace muestra la URL, errores i18n, preview a buena resolución.

### Fase 3: frontend UI y consistencia

- [x] Coverflow: altura explícita en móvil, sin `key={flowIndex}`, `aria-label` i18n, `aria-live` con el álbum activo, título fuera de la portada.
- [x] La card abre el detalle; quitar código muerto (`onToggleLike` de la card).
- [x] Editor: key estable (`id` + `updated_at`), sin reset al añadir álbumes; marcar "Añadido".
- [x] Follow en el frontend: renombrar like → follow, ocultarlo en Crates propios, sección "Crates que sigues" en Biblioteca.
- [x] `useCrateFollow` sin relanzar el error; numeración coherente con `desc`; `try/catch` por ítem en el sync offline; descarga independiente de `offlineSupported`; sin `<main>` anidado.
- [x] i18n: "Crate" en todos los catálogos; traducir lo que queda en inglés.

### Fuera de alcance (siguiente iteración)

- Unificar los tres formularios de creación y alinear la cabecera con la de la página de álbum.
- Gestión de miembros e invitaciones (lista, caducidad, revocar) en la UI.
- Mover la descarga ZIP al worker.

## Verificación

- `pytest tests/test_crates_api.py tests/test_crate_schema_definition.py tests/test_shaped_radio_engine.py` (y la suite de share).
- `npm run --workspace=app/listen test` (crates, share), `typecheck`, `lint`.
- Navegador: crate público sin sesión (desktop y móvil), preview OG con curl anónimo, story y post generados.

## Añadido: URLs públicas con slug

- Formato: landing `/share/crate/{slug}-{code}` y app `/crate/{slug}-{code}`; `code` = `crates.short_code` (8 base62, único, migración 102).
- Se resuelve solo por el código (`resolve_crate_ref`); el slug es decorativo. Se siguen aceptando UUIDs.
- La landing redirige con 301 a la URL canónica (UUID o slug desactualizado). La SPA reemplaza la URL por la canónica.
- Campos API: `short_code`, `public_ref`. Las mutaciones siguen usando `id` (UUID).

## Fase 4: lo que quedó fuera de alcance

### Descarga ZIP en el worker

- El API ya no construye el ZIP. `POST /api/crates/{id}/download` (con la misma autorización que playback) calcula la clave de caché a partir de datos de la DB: tracks (`id`, `path`, `size`, `updated_at` de `library_tracks`), artista y álbum, y nombre del Crate.
  - Si el artefacto ya está en `download_cache`, responde `{status:"ready", download_url, filename}`.
  - Si no, crea con dedup la tarea `crate_download` y responde `202 {status:"pending", task_id, filename}`.
- El handler del worker (cola `default`: el worker de `heavy` no monta `/cache`) compone el ZIP (STORED) en `download_cache` (`/cache`, compartido con el API), lo registra con `register_cached_download` y publica el progreso por eventos de la tarea. Su resultado incluye `download_url`.
- `GET /api/crates/{id}/download/{cache_key}` sirve el artefacto cacheado (solo lectura, misma autorización).
- Frontend: la acción "Descargar" lanza el POST, muestra el progreso en un toast persistente vía `/api/events/task/{task_id}` y, al terminar, dispara la descarga. Si ya estaba en caché, la descarga es inmediata.

### Miembros e invitaciones

- Backend: `GET /api/crates/{id}/invites` (solo el dueño) devuelve las invitaciones activas con token, `join_url`, `created_at`, `expires_at`, `max_uses` y `use_count`.
- Frontend: nuevo `CrateMembersModal`, siguiendo el patrón de `PlaylistCollaboratorsModal`.
  - Lista de miembros: dueño primero y colaboradores con avatar. El dueño puede quitar colaboradores.
  - Invitaciones activas con caducidad y usos, copiar enlace y revocar.
  - Crear invitación con caducidad (24h / 7d / 30d / sin caducidad) y un máximo de usos opcional.
  - Si la colaboración está desactivada, el dueño puede activarla desde el propio modal.
  - Un colaborador ve la lista en solo lectura y puede salir del Crate, si el backend lo permite.
- El botón "Colaboradores" de la página abre este modal. La sección de invitaciones sale del editor.

### Formulario de creación único y cabecera

- Un solo `CrateForm`, usado al crear desde la lista, al crear desde un álbum y en la sección de datos del editor. Los campos van siempre en el mismo orden: nombre, descripción, visibilidad, orden (y sentido), bucle y colaboración (solo el dueño).
- Crear desde un álbum usa el mismo formulario, con el álbum preseleccionado.
- Cabecera de la página de Crate alineada con la de álbum: mismo layout de hero (fondo difuminado con la portada, tipografía y espaciado), acciones con etiqueta bajo el icono, botones de reproducir y aleatorio del mismo tamaño, menú "Más" sin duplicar lo que ya está en línea, y en móvil hero a sangre como en álbum. El coverflow se mantiene como identidad del Crate.
