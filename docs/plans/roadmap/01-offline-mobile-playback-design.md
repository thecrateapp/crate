# Diseño: Offline y playback mobile resiliente

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18). El mirror offline y la verificación de integridad previos siguen siendo la base.

**Estado:** propuesta revisada · **Prioridad:** P0 · **Corte:** 2026-09-09.

## Objetivo y valoración

Convertir el mirror existente en descarga privada fiable de tracks, álbumes y
playlists estáticas para Android, iOS y PWA, conservando cola, posición,
metadata y artwork al volver de suspensión. No incluye DRM, exportación a
Downloads, playlists dinámicas ni descargas automáticas sin opt-in.

Valor alto: resuelve una condición diaria del playback móvil y habilita la
biblioteca offline del automóvil. Coste medio para endurecer el mirror; alto
para descargas nativas durables en ambas plataformas. Los riesgos principales
son suspensión del proceso, corrupción/evicción y mezclar versiones del audio.
Los hitos se acreditan por plataforma, sin equiparar build y experiencia real.

## Baseline verificado

Principal: `codex/listen-design-system`, `992704b9`. Esta revisión documental
no certifica gates físicos ni vuelve a ejecutar las suites de producto.

| Ya existe en principal                                                                                             | Pendiente                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `app/crate/api/offline.py` y `api/schemas/offline.py`: manifests calculados, auth, identidad y playlists estáticas | Caché HTTP, contrato de representación e integridad verificable               |
| `app/listen/src/lib/offline*.ts`: façade, store, scheduler y adapters                                              | Journal resistente a crash, referencias compartidas, migración y cuota total  |
| Dos descargas simultáneas, pausa al ocultar y reanudación al volver                                                | Background durable Android/iOS y reconciliación del proceso nativo            |
| SW con caché por perfil y respuestas Range                                                                         | Safari/Chromium reales, evicción y memoria de seek en archivos grandes        |
| Verificador de tamaños por lotes Android/iOS                                                                       | Archivo vacío inválido cuando se esperan bytes; tamaño no equivale a checksum |

La [política existente](../../technical/listen-offline-runtime-policy.md)
describe el comportamiento actual. `codex/playback-resilience` (`8b913bd9` al
revisar) contiene WIP de entrega, recovery, prefetch y QoE: auditar integración
sin contarlo como entregado. SmartMix se consulta desde el [índice](00-index.md#fuentes-de-smart-mix);
este documento no redefine sus engines ni depende de terminar VirtualDJ.

## Autoridad y contrato

El servidor es autoridad del catálogo y de su manifest. **Intención, bytes
presentes y readiness pertenecen a cada instalación y perfil local.** No se
crean tablas `offline_items` ni jobs servidor que intenten reconciliar el disco
del dispositivo. Sincronizar intención entre dispositivos sería otro requisito.

Identidad lógica: `entity_uid`, con compatibilidad `storage_id`. El perfil
separa origen Crate y usuario. La clave del asset añade versión del contenido y
representación: formato, política de entrega y revisión de variante. El tamaño
del original no valida una transcodificación `balanced`. URLs firmadas y bearer
son efímeros; nunca identidad durable del asset.

Se mantienen los GET existentes:

- `/api/offline/tracks/{track_id}/manifest`;
- `/api/offline/tracks/by-path/{path:path}/manifest`;
- `/api/offline/tracks/by-entity/{entity_uid}/manifest`;
- `/api/offline/tracks/by-storage/{storage_id}/manifest` como compatibilidad;
- `/api/offline/albums/{album_id}/manifest`;
- `/api/offline/playlists/{playlist_id}/manifest`.

Evolución aditiva con versión/capabilities explícitas. ETag/`If-None-Match`
aplica a GET, comprobando auth y visibilidad antes de 304. Playlists dinámicas
siguen rechazadas. Un manifest excesivo produce error o paginación versionada;
nunca una playlist truncada presentada como completa.

## Descarga y consistencia

```text
Acción local -> manifest autorizado -> journal por perfil -> cola acotada
  -> representación -> temporal -> verificación -> publicación -> ready
  -> resolver local del player
```

Operaciones con ID y generación de perfil. Logout, cancelación y cambio de
servidor invalidan la generación: un callback tardío no publica en otra cuenta.
Migrar estados actuales conservando assets; distinguir disponible, versión
pendiente y pérdida/corrupción sin inferir presencia desde metadata remota.

El commit se recupera tras crash entre bytes e índice mediante journal local;
no exigir una transacción entre Filesystem y Cache Storage. Validar longitud
real, rechazando cero bytes cuando hay tamaño esperado. Si se anuncia digest,
verificar la representación exacta. Calcular nuevos digests en workers sobre
versiones estables, nunca leyendo audio entero durante un GET. La validación
legacy de tamaño no se anuncia como verificación criptográfica.

Reanudar Range/If-Range solo con representación y validadores compatibles; un
200 completo, cambio de ETag o 416 reinicia ese temporal sin concatenar versiones.
Backoff, deadlines y cancelación acotados.

## Garantías por plataforma

| Plataforma | Entrega prevista                                                                   | Gate                                                                 |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Android    | Privado, cola durable fuera de la WebView, reproducción con owner Media3 existente | Download service; dispositivo físico, Doze, UI cerrada y disco lleno |
| iOS        | Privado, reconciliación de transferencias de background, playback restaurable      | Adapter URLSession, lifecycle y iPhone firmado                       |
| PWA        | Cola persistente, playback de assets conservados, reanudar al abrir                | SW real en Chromium/Safari, cold start y evicción                    |

Android ofrece [DownloadService/DownloadManager](https://developer.android.com/media/media3/exoplayer/downloading-media)
y Apple [descargas de background con URLSession](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background).
Integrarlos con una cola lógica y límite compartido, evitando duplicar el
scheduler. El SO decide cuándo ejecutar: ninguna plataforma garantiza progreso
inmediato suspendida. PWA no promete descargar cerrada ni conservación
permanente; WebKit aplica [cuotas y evicción](https://webkit.org/blog/14403/updates-to-storage-policy/).

La cuota cuenta completos, temporales y reservas de las dos descargas. Referencias
por manifest protegen tracks compartidos al quitar una playlist. Playback activo
y elementos fijados quedan protegidos; ante falta de espacio, parar con una
acción visible. LRU solo de caché no fijada. El `arrayBuffer()` actual del SW
carga el archivo entero para Range: medir y resolver ese límite antes de cerrar
seek de archivos largos.

## Playback, permisos y UX

Resolver: asset local válido del perfil, fuente remota preparada, negociación
de entrega. N→N+1 con assets listos no pide catálogo, ticket ni audio a Crate;
metadata/artwork procede de la copia local. Prefetch comparte presupuesto con
playback; no duplicar el pipeline de SmartMix o playback-resilience.

Un 401/403 no habilita descargar de nuevo ni saltarse una revocación conocida.
Explicitar qué sesión local habilita el perfil offline y bloquearlo tras logout.
No prometer revocación instantánea de bytes ya desconectados ni introducir DRM.
Sandbox y protección del SO son la base, sin presentarlos como cifrado de
aplicación mediante keystore.

Usar acciones y ajustes existentes: progreso, pausa por restricciones, espacio,
versión pendiente, error/reparación y quitar descarga. No exigir nueva pantalla
Downloads. `ready` requiere verificación local reciente; reconciliar
desapariciones/evicción al arrancar.

## Gates, métricas y despliegue

Medir manifest, descarga por causa, bytes reales/reservados, corrupción, hit
local, startup/stalls y memoria, sin URLs/tokens/títulos/IDs de catálogo.
Hipótesis inicial: p95 de manifest <500 ms para fixture de 500 tracks y p95 de
startup local <1 s en dispositivos acordados; calibrar antes de declararlas SLO.

Matriz obligatoria: crash en cada paso del commit; callback tras logout;
descarga duplicada; variante cambiada; disco lleno; archivo vacío; track >1 h y
seek repetido; cola local en modo avión; suspensión Android/iOS; evicción y
actualización de SW. Registrar dispositivo, versión, fixture y mediciones.
MSW no sustituye un SW real; simulador no acredita background en iPhone.

Backend compatible antes de clientes; flags de descarga durable por plataforma
y activación interna tras gates. Kill switch detiene nuevas descargas y
pendientes conservando playback local válido. Probar rollback de índice sin
borrar assets. Manifests continúan en FastAPI; moverlos a readplane solo con
carga que lo justifique y contrato equivalente.
