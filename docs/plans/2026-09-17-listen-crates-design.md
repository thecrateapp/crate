# Listen Crates: diseño propuesto

**Estado:** Propuesta para revisión
**Fecha:** 2026-09-17
**Ámbito:** Listen web/mobile y API Crate

## 1. Objetivo

Añadir a Listen una entidad Crate para agrupar álbumes en un orden curado, inspirada en los *What’s in my bag* de Amoeba Records y en las listas anuales de discos. Una crate podrá compartirse públicamente, organizarse de forma privada o editarse colaborativamente. También funcionará como fuente de reproducción para la cola existente de Listen.

No es una playlist de tracks: su contenido persistido son álbumes del catálogo global. La reproducción expande esos álbumes a pistas al iniciar la cola.

## 2. Decisiones de producto

| Área | Decisión |
|---|---|
| Entidad y navegación | Nombre visible Crate/Crates; nueva pestaña Crates en Collection y página propia. |
| Contenido | Solo álbumes del catálogo global. Orden manual; no se admiten duplicados del mismo álbum en una crate. |
| Visibilidad | Pública o privada; las nuevas crates nacen privadas. |
| Colaboración | Eje separado de visibilidad. El propietario invita y administra colaboradores; estos pueden editar metadatos y añadir, quitar o reordenar álbumes. |
| Collection | Muestra crates propias y crates en las que el usuario colabora. |
| Perfil | Las crates públicas aparecen en el perfil de su propietario. |
| Compartir | Página de crate con enlace canónico y ShareSheet existente (copiar, WhatsApp, Telegram e Instagram Story en clientes nativos). |
| Reproducción | Play respeta el orden de álbumes y de pistas de cada álbum; Shuffle baraja la lista completa de pistas. |
| Fuera de alcance | Tracks sueltos, descubrimiento global, seguimiento de crates, roles de colaboración distintos y artwork subido por el usuario. |

## 3. Modelo de datos

La propuesta usa tablas propias, sin reutilizar playlists: crates, crate_albums, crate_members y crate_invites. La entidad crate conserva propietario, nombre, descripción, visibilidad, estado colaborativo y timestamps. Cada crate_albums conserva el UUID canónico global_album_uid, la posición y quién añadió el álbum. El UUID referencia global_catalog_albums, en lugar de copiar metadatos o depender de un ID local que puede no existir para álbumes remotos.

La clave de membresía impide introducir el mismo álbum dos veces en una crate. Un índice por crate y posición permite leer la lista ordenada. El álbum se presenta resolviendo su nombre, artista y artwork desde el catálogo actual. Los miembros tienen un único permiso de edición; el propietario no se representa como colaborador y mantiene siempre el control administrativo.

Las invitaciones siguen el patrón actual de playlists: token revocable, creador, expiración y límite de usos. Aceptar una invitación requiere sesión de Listen. Si se desactiva la colaboración, se revocan las invitaciones pendientes y los miembros dejan de tener acceso. Las escrituras de orden y membresía serán transaccionales.

La visibilidad no se codifica como un tercer valor «collab»: pública/privada determina quién puede leer; is_collaborative y sus miembros determinan quién puede editar. Una crate pública sigue siendo editable solo por propietario y colaboradores. Una crate privada es legible únicamente por esos mismos usuarios.

## 4. API y autorización

Un router FastAPI dedicado expondrá creación, listado de crates accesibles al usuario, detalle, edición, eliminación, cambios de álbumes/orden, miembros, invitaciones y aceptación. Las comprobaciones de acceso se hacen en backend en cada lectura y mutación, no solo en la UI. Las lecturas de crates privadas por usuarios ajenos responderán como recurso inexistente para no revelar su presencia.

El endpoint de detalle devolverá álbumes en orden y la información necesaria para las tarjetas. La reproducción tendrá una lectura específica que expande los álbumes a sus pistas en una sola petición, manteniendo orden de álbum, disco y pista, y empleando las mismas referencias canónicas y resolución de disponibilidad de Listen. Así evitamos una petición secuencial o paralela por cada álbum.

Los perfiles añadirán public_crates a la respuesta de perfil completo. La consulta será por propietario y en lote, evitando un request por crate. Las mutaciones invalidarán tanto la colección de crates como los datos de perfil afectados. La primera versión se sirve desde FastAPI; no introduce una ruta de lectura nueva en Go readplane sin una medición que lo justifique.

## 5. Listen, perfiles y compartir

Collection añade la pestaña Crates en la navegación existente por query/section. Su lista tendrá acciones para crear, abrir y administrar crates propias o colaborativas. Un editor buscará álbumes en el catálogo global, añadirá los seleccionados y permitirá ajustar su orden manualmente. Los controles de propietario separan la edición de contenido de visibilidad e invitaciones.

La página /crate/:id muestra nombre, descripción, propietario, álbumes ordenados y controles de reproducción. Para una crate pública se ofrece compartir mediante la infraestructura actual. La URL de preview /share/crate/:id genera metadatos sociales y enlaza a la página Listen, reutilizando ShareSheet, social-share y el renderizador de previews de álbum/artist/track. La imagen de preview será la portada del primer álbum; si no hay portada o la crate está vacía, se usará el fallback de marca.

Las crates públicas del propietario se incorporan al payload y la sección de su perfil público. Una crate colaborativa no se atribuye automáticamente a todos los colaboradores. En esta primera versión, las páginas Listen mantienen la barrera de sesión actual; el preview social sí es público, como los previews existentes. No se añade una experiencia anónima completa ni acceso público a crates privadas.

## 6. Reproducción

Play construye la cola con las pistas reproducibles de cada álbum en el orden de la crate y el orden de disco/pista del catálogo. Shuffle mezcla esa misma lista de pistas antes de cargarla. Ambos usan playAll y shuffleArray —el patrón actual de Album y Playlist— y la cola normal gestiona reproducción web, Capacitor, persistencia y controles. Se añade Crate como tipo de origen de reproducción para conservar título y deep link en el player.

Las pistas sin una fuente reproducible se omiten usando la resolución de disponibilidad existente; si no queda ninguna, Play y Shuffle aparecen desactivados y la página explica que no hay pistas reproducibles. Si quedan algunas, se reproduce el subconjunto disponible sin alterar su orden relativo en modo secuencial. No se crea un motor, un formato de cola ni una política de shuffle nueva.

## 7. Migraciones, caché y calidad

La persistencia se añade mediante migración Alembic reversible y su definición equivalente en el bootstrap de schemas de curation. El número de migración se recalculará contra el head real antes de implementarla; el worktree actual parte de la revisión 089.

Las pruebas cubren migración/bootstrap, unicidad y orden de álbumes, permisos de propietario/colaborador/tercero, visibilidad, invitaciones expiradas o revocadas, perfiles públicos, preview de compartir y reproducción secuencial/aleatoria. Listen incluirá tests de render y acciones para Collection, editor, página pública, perfil y ShareSheet. Todas las cadenas nuevas se añaden a los catálogos de traducción y pasan i18n:check.

La verificación final incluye suites backend focalizadas, Vitest, typecheck, ESLint, build de Listen y contrato OpenAPI. No se requiere cambiar el motor de audio; cualquier necesidad en readplane o streaming se tratará como hallazgo de implementación, no como trabajo preventivo.

## 8. Supuestos que deben revisarse al aprobar el diseño

- «Pública» sigue la convención actual: el preview social es accesible sin sesión, mientras abrir la experiencia Listen usa la barrera de autenticación existente.
- Solo las crates públicas propiedad del usuario aparecen en su perfil; las crates donde solo colabora no se listan allí.
- La crate no tiene imagen propia en este corte; se usa la portada del primer álbum para previews y cards.
- La aceptación de una invitación es necesaria para que un colaborador obtenga acceso; el link de invitación no convierte por sí mismo una crate privada en pública.
