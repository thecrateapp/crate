# Diseño: Social feed y playlists colaborativas

> **Estado (2026-11-18):** Pendiente y a revisar antes de ejecutarlo: main implementó un modelo más simple (colaboradores gestionados por el owner, invitaciones que responden 410; 77ea09d36, migración 108) que contradice S02/S03. También absorbe lo pendiente del perfil: privacidad por superficie, proyección de actividad y preview por long-press.

**Estado:** propuesta local revisada el 2026-09-09; no implementación. **Prioridad:** P1. Plan: [04-social-collaboration-implementation-plan.md](04-social-collaboration-implementation-plan.md).

## Valor y punto de partida comprobado

Crate ya tiene red social local y playlists colaborativas. El valor nuevo es dar control de privacidad, actividad útil y edición concurrente recuperable. La colaboración fiable tiene valor aunque haya pocos usuarios; un feed y su federación necesitan suficiente actividad para justificar coste y moderación.

| Evidencia actual                                                                                                                                                                                             | Reutilización y diferencia con el objetivo                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/crate/api/social.py` y `api/schemas/social.py`: búsqueda, perfiles/card/page, follow/unfollow, relaciones, afinidad y estadísticas. Tests en `app/tests/test_social_api.py` y `test_social_queries.py`. | Ampliar contratos existentes; no describir los perfiles como páginas vacías ni asumir que stats ya tienen todas las opciones de privacidad propuestas.  |
| `app/crate/db/orm/playlist.py`: `playlists`, `playlist_tracks`, `playlist_members`; ownership y rol `collab`.                                                                                                | Añadir revisión y operaciones; no recrear tablas ni un modelo paralelo `playlist`.                                                                      |
| `app/crate/api/playlists.py`: `/members`, `/invites` y `/invites/{token}/accept`; sólo owner/admin gestiona miembros, rol público actual `collab`.                                                           | Extender estas rutas; no crear otra API `/collaborators` para lo mismo.                                                                                 |
| `app/crate/db/repositories/playlists_invites.py`: token aleatorio, caducidad, `max_uses` y consumo mediante UPDATE condicional; default 168 h y 20 usos.                                                     | Conservar compatibilidad de invites existentes. Aceptar invite y crear membership todavía debe tratarse como una unidad idempotente del nuevo contrato. |
| `app/crate/db/repositories/playlists_tracks.py` y `playlists_mutate.py` emiten eventos de dominio; `PlaylistCollaboratorsModal.tsx` ya existe en `app/listen/src/components/playlists/`.                     | Reutilizar productores y UI; no añadir un segundo outbox. Las mutaciones actuales por posición no equivalen a un protocolo de edición por revisión.     |

Se mantienen feed, reacciones, presencia de edición, roles, approval, ownership, recuperación realtime y federación Crate-to-Crate. Jam y su cola/realtime pertenecen a 06 y funcionan sin 03/04; este workstream no vuelve a implementar una Jam.

## Privacidad y modelo social

Añadir identidad social estable, única por `(home_node_uid, actor_uid)`, enlazada a `users.id` local. Antes de crear mapping, comprobar cualquier identidad estable que se haya añadido al implementar; el username es ruta humana mutable, nunca clave de autorización. Firma de nodo demuestra origen, no que cualquier actor remoto represente a un usuario local.

Preferencias independientes para perfil, follows, estadísticas agregadas, afinidad, playlists, feed y `listening_now`. Follow no concede acceso a biblioteca, archivos, historial ni playlists privadas. Feed y presencia empiezan opt-in; no generar actividad retrospectiva a partir del historial. La migración documenta la visibilidad actual de los campos ya públicos y su traducción explícita a preferencias; no publicar campos nuevos ni cambiar la audiencia de datos existentes de forma silenciosa. Los controles nuevos deben aplicarse también a card/page/stats/afinidad, no sólo al nuevo feed.

Follow a perfil privado requiere solicitud/aceptación; las relaciones existentes se conservan como aceptadas. Bloquear actor domina follow, invitaciones, perfil, feed, búsquedas y notificaciones; silenciar sólo modifica la experiencia del receptor. El administrador gestiona abuso con permiso/auditoría explícitos, no mediante un grant social universal.

Feed permite publicaciones de playlists, colaboración aceptada, reacciones y recap que el usuario comparta. Follow visible se limita a la audiencia consentida; unfollow, rechazos y bloqueos no producen avisos públicos por defecto. No publicar tracks exactos escuchados ni timestamps de reproducción. `listening_now`, si se activa, es presencia efímera con TTL propuesto de 60 s y renovación limitada, sin historial ni push. Un recap compartido conserva las reglas de 08, no una copia irreversible en el feed.

El feed usa proyección de eventos tipados, cursor opaco por fecha/UID/filtros y límites. Evalúa elegibilidad al producir y al leer; cambio de visibilidad, bloqueo, borrado de cuenta o recurso retira contenido y su preview. El stream también revalida permisos: invalidación cierra entrega al recibirse y un heartbeat de autorización cada 5 s como máximo cubre conexiones ociosas/eventos perdidos; si no puede verificar, cierra el stream. Ese intervalo es una cota objetivo de revocación de entrega, no una promesa de borrar datos ya recibidos. Caché privada incorpora principal y revisión de privacidad; si no se puede verificar una revocación, no sirve una proyección antigua como autorizada. Nunca consultar historial crudo para construir una petición de feed.

## Playlists, roles y ownership

| Rol propuesto | Capacidad                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| owner         | Gestionar visibilidad, miembros, invites, freeze, transferencia y borrado. La playlist tiene exactamente un owner. |
| editor        | Editar contenido y metadatos permitidos; no ownership, visibilidad, miembros ni invites.                           |
| contributor   | Añadir entradas y retirar las propias; no reordenar/eliminar entradas ajenas ni cambiar permisos.                  |
| viewer        | Lectura si la ACL lo permite.                                                                                      |

`collab` permanece como rol legacy aceptado por el facade y conserva su conjunto de permisos comprobado; se proyecta a capacidades compatibles, sin elevarlo a owner. La transición a nombres nuevos es explícita y probada con clientes viejos. `is_collaborative` no reemplaza la ACL. Admin conserva únicamente las excepciones verificadas/autorizadas, con auditoría de intervenciones.

Invites nuevos permiten approval y revocación; por defecto expiran en siete días y son de un uso, con enlace reutilizable opcional acotado. Los existentes conservan caducidad/max_uses originales. Token se almacena como hash para nuevos invites, no en logs; el enlace no contiene IDs internos. Consumo, dedupe por invite/usuario y alta de miembro se confirman juntos: doble click no gasta dos usos ni produce dos memberships. Un invite de contributor no puede aceptar un rol mayor desde el body.

Transferir ownership exige aceptación del destinatario, revisión esperada y transacción que impida cero/dos owners. El owner no puede abandonar dejando huérfana la playlist. Borrar cuenta obliga a transferir o borrar según política explícita; no convertir automáticamente la playlist en pública ni reasignarla a otro usuario. Freeze rechaza nuevas ediciones manteniendo lectura y datos confirmados.

## Operaciones concurrentes y compatibilidad

Añadir a las tablas existentes `revision` de playlist y `entry_uid` estable por aparición de track. La identidad de la entrada permite duplicados del mismo track y evita que un delete por índice borre otra canción después de un reorder. Conservar referencias locales/globales/storage existentes y resolver disponibilidad sin otorgar stream/import por ser colaborador.

Nuevas `playlist_operations` registran actor, `operation_uid`, `base_revision`, tipo, digest y resultado; las snapshots compactadas son recuperación de una revisión, no otra fuente de verdad. Operaciones: añadir entradas, retirar por UID, mover entre anchors y actualizar metadatos permitidos; gestión de ACL/owner se valida con las mismas reglas de revisión.

El servidor serializa por playlist en una transacción corta: revalida ACL, comprueba idempotencia, compara revisión, aplica operación, guarda resultado e inserta evento en el outbox existente. No hace red bajo lock. Misma clave/cuerpo devuelve resultado estable si el actor sigue autorizado; misma clave/cuerpo distinto da 409. `base_revision` obsoleta devuelve `revision_conflict` con revisión/cursor; el cliente recupera snapshot y pide reintentar el cambio. No hace merge automático de reorders destructivos.

Compatibilidad requiere dos etapas: desplegar primero lectores/facade capaces de distinguir protocolo legacy y versionado; después habilitarlo por playlist. Los endpoints legacy de lectura siguen disponibles. En playlists versionadas, escrituras legacy ambiguas por posición sin revisión se rechazan con error explícito `client_upgrade_required`, en lugar de prometer consistencia imposible. El owner ve este impacto al habilitar el modo. Las playlists sin opt-in conservan comportamiento actual hasta migración. Esta restricción es un cambio de compatibilidad deliberado, no un detalle oculto.

Retención propuesta: operaciones recuperables 30 días, snapshots por revisión compactada y recibos mínimos de idempotencia durante el horizonte de retry. Requests más antiguos que ese horizonte se rechazan con resync; no se ejecutan de nuevo tras purgar dedupe. Borrado de cuenta elimina contenido personal del feed y minimiza actor en auditoría conforme a la política de retención. No prometer historial append-only eterno de datos personales.

## API y realtime propuestos

| Ruta                                                                                        | Alcance                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/users/{username}/activity` y `GET /api/me/activity`                               | Nuevas lecturas paginadas con privacidad y filtros.                            |
| `GET/PUT /api/me/social-preferences`                                                        | Nuevo contrato versionado; controles aplicados también a endpoints actuales.   |
| `POST/DELETE /api/me/social-blocks/{actor_uid}`                                             | Bloqueo idempotente local; actor remoto debe resolverse con home node.         |
| `/api/playlists/{playlist_id}/members`, `/invites`, `/api/playlists/invites/{token}/accept` | Extender rutas existentes conservando IDs numéricos locales y contrato legacy. |
| `POST /api/playlists/{playlist_id}/operations`                                              | Nuevo comando con revisión y operación idempotente.                            |
| `GET /api/playlists/{playlist_id}/operations?after_revision=`                               | Recuperación acotada; indica snapshot requerido si expiró el log.              |
| `GET /api/playlists/{playlist_id}/activity-stream`                                          | SSE de revisiones/presencia, con auth y resync.                                |
| `PUT/DELETE /api/playlists/{playlist_id}/reactions/{reaction}`                              | Set/remove idempotente de reacción cerrada por actor.                          |

La definición OpenAPI de la primera tarea completa solicitudes de follow, freeze, transferencia y revocación sin reutilizar URLs con significado incompatible. Numeric ID no viaja como identidad federada; el envelope usa UID y nodo propietario.

REST confirma mutaciones y recupera snapshot. SSE es el transporte inicial de cambios; WebSocket puede usar el mismo protocolo si presencia exige duplex, con pruebas equivalentes antes de activarlo, sin mantener dos motores de consistencia. Reconexión no implica que Redis conserve todos los eventos: revisión desconocida/vencida obliga a snapshot. Readplane conserva fallback autorizado; acelerar feed con Go es una optimización posterior respaldada por mediciones, no condición del core.

## Federación y notificaciones

La playlist tiene un nodo home autoritativo; nodos remotos envían operaciones a ese owner, sin multi-master ni confianza en el orden de relojes. `app/crate/federation/signing.py`, `authorization.py`, `grants.py`, `contracts.py` y `events.py` aportan infraestructura, pero sus grants actuales de catálogo no autorizan social. Añadir capability versionada, prueba de relación actor/home, destino/grant específico y consentimiento. No es ActivityPub ni requiere SDK 10.

Al revocar peer o actor se rechazan nuevas operaciones y replays, se cierran streams y se invalidan proyecciones locales. El receptor aplica nonce/antigüedad, dedupe permanente durante la ventana aceptada, cuotas y bloqueo. Entrega repetida no duplica membresías/feed. Un home offline deja la edición remota pendiente/fallida de forma visible; no confirma localmente una operación no aceptada. No se promete retirar capturas/datos en nodos no cooperativos.

03 consume eventos confirmados y agrupados; cien ediciones no generan cien push. La playlist/feed funciona con 03 apagado, y Jam 06 funciona con 04 apagado. Federación se entrega después del caso local, pero sigue en alcance.

## Hitos 2027 y criterios de cierre

| Hito                                                    | Valor                                                 | Coste y riesgo                                               |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| S1: permisos/privacidad y colaboración local versionada | Evitar pérdida de edición y controlar quién ve/edita. | Medio-alto: compatibilidad legacy, ownership y concurrencia. |
| S2: feed, reacciones, presencia y UX                    | Descubrimiento entre personas que quieren compartir.  | Medio: privacidad transversal, moderación y ruido.           |
| S3: federación y notificaciones integradas              | Colaboración entre nodos con un único owner.          | Alto: identidad, trust, recuperación y adopción.             |

Objetivo a validar con carga descrita: confirmación local p95 <500 ms. Conflict rate se observa por operación/número de editores, no se promete <1% independientemente de la carga. Exigir cero operaciones confirmadas perdidas y cero accesos indebidos en matriz de dos/cinco/diez editores, invites concurrentes, cambio de ACL, owner leave/delete, doble reacción, Redis caído, replay vencido, duplicado remoto y zero peers.

Kill switches suspenden nuevas funciones o mutaciones versionadas conservando lectura autorizada, memberships y operaciones confirmadas; no convierten silenciosamente playlists en owner-only. Rollback sólo a la versión de compatibilidad desplegada antes del opt-in; un binario que ignora revisión/ACL nueva no es downgrade seguro.
