# Offline y playback mobile resiliente — Implementation Plan

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18). app/listen/public/sw.js sigue cargando el fichero entero con `arrayBuffer()`.

> **For agents:** REQUIRED SUB-SKILL: Use `viterbit-ai-tools:executing-plans` to implement this plan task-by-task.

**Goal:** Cerrar integridad, recuperación y descargas durables del mirror,
conservando Android, iOS y PWA en el alcance.

**Architecture:** FastAPI calcula manifests; intención, journal, cuota y
readiness locales por instalación/perfil. Adapters nativos y SW comparten
contrato de assets con el resolver existente. No se crea persistencia servidor
de estados del disco ni un segundo player.

**Tech Stack:** FastAPI/Pydantic, workers para derivados, React/Vitest,
Capacitor, Media3, Swift/URLSession y Service Worker.

---

## Baseline y ejecución

Leer [diseño](01-offline-mobile-playback-design.md) y
[política existente](../../technical/listen-offline-runtime-policy.md).
Corte principal: `992704b9`. Auditar integración de `codex/playback-resilience`
antes de modificar recovery/prefetch: su WIP no acredita entrega. SmartMix se
consulta desde el [índice](00-index.md#fuentes-de-smart-mix); finalizar VirtualDJ no es prerrequisito.

Orden: `O01 → O02 → O03`; O04/O05/O06 pueden avanzar en paralelo tras O03;
O07 integra las plataformas; O08/O09 cierran UX y gates. Un hito parcial se
etiqueta por plataforma, sin marcar completa la iniciativa.

Cada tarea: escribir RED, ejecutar y comprobar el fallo esperado, implementar
GREEN mínimo, repetir y refactorizar con suite verde. Caracterización existente
debe pasar; separar los nuevos casos que fallan. **Crear** identifica archivos
propuestos. Los nombres cortos comparten el directorio del primer archivo de
su lista. No hacer deploy ni pruebas contra producción durante esta revisión.

### O01 — Caracterizar mirror y contratos de plataforma

**Modificar:** `app/listen/src/lib/offline.test.ts`,
`offline-scheduler.test.ts`, `offline-storage.test.ts`,
`offline-native.test.ts`, `offline-web.test.ts`;
`app/listen/android/app/src/test/java/app/cratemusic/crate/OfflineAssetVerifierTest.java`.
**Crear:** `app/tests/test_offline_contract.py`.

1. Cubrir manifests actuales, dos workers, pausa al ocultar y reanudación.
2. RED para archivo vacío con tamaño esperado, callback de perfil viejo,
   crash de commit y tamaño original aplicado a una variante.
3. Fijar contrato de progreso/cancelación JS/native, fixtures y dispositivos.

**Comandos:** Vitest offline, pytest del contrato y Gradle del bloque final.
**DoD:** baseline separado de capacidades nuevas y defectos reproducibles.

### O02 — Manifests y representación descargada

**Depende:** O01. **Modificar:** `app/crate/api/offline.py`,
`app/crate/api/schemas/offline.py`, `app/listen/src/lib/offline-model.ts`.
**Tests:** `app/tests/test_offline_contract.py`, `app/listen/src/lib/offline.test.ts`.

1. RED: ETag estable; auth/visibilidad antes de 304; playlist dinámica rechazada;
   original/variante con tamaños propios; manifest grande no truncado.
2. GREEN: evolución aditiva de rutas actuales, validadores de representación,
   límites explícitos y compatibilidad por storage ID.
3. Definir digest opcional verificable. Si necesita derivado nuevo, **crear**
   `app/crate/worker_handlers/offline_integrity.py` y
   `app/tests/test_offline_integrity.py`, **modificar** `app/crate/actors.py`.
   Calcular por versión estable con idempotencia; nunca hash de audio en GET.
4. No crear `offline_items`. Migración de digest solo si auditar derivados
   demuestra que hace falta; probar upgrade y compatibilidad de lectura.

**Comandos:** pytest del contrato/integridad y Vitest offline.
**DoD:** validar bytes de la representación elegida sin credenciales durables.

### O03 — Journal, integridad, referencias y presupuesto

**Depende:** O02. **Modificar:** `app/listen/src/lib/offline-store.ts`,
`offline-storage.ts`, `offline-assets.ts`, `offline-scheduler.ts`,
`offline-native.ts`, `offline-native-assets.ts` y tests homónimos existentes.
**Crear:** `app/listen/src/lib/offline-assets.test.ts` si requiere test directo.

1. RED: crash antes/después de bytes e índice; cero bytes; digest inválido;
   cancel/logout al finalizar; duplicado concurrente; track en dos manifests.
2. GREEN: temporal, journal, publicación recuperable, generación de perfil y
   referencias por manifest. No reclamar transacción Filesystem/Cache Storage.
3. Reservar completos/temporales/dos descargas; probar tamaño desconocido,
   disco lleno y limpieza. Pins y audio activo nunca son víctimas de LRU.
4. Migrar índice local con fixture previo y rollback conservando archivos.
   Ningún backfill servidor intenta actualizar discos de clientes.

**Comando:** `npm run --workspace=app/listen test -- --run offline`.
**DoD:** ningún crash publica ready sin asset válido ni mezcla cuentas/versiones.

### O04 — Descarga durable Android

**Depende:** O03. **Crear:**
`app/listen/android/app/src/main/java/app/cratemusic/crate/CrateOfflineDownloadService.java`,
`CrateOfflineDownloadPlugin.java` y tests homónimos en
`app/listen/android/app/src/test/java/app/cratemusic/crate/`.
**Modificar:** `app/listen/android/app/src/main/AndroidManifest.xml`,
`app/listen/src/lib/offline-native.ts`, `offline-scheduler.ts` y tests.

1. RED: recrear UI, reanexar operaciones, cancelar/cambiar perfil y duplicar
   callback; retry/rangos solo sobre la misma representación.
2. GREEN: integrar DownloadService/DownloadManager con persistencia nativa,
   requisitos y notificación; un coordinador mantiene límite global de dos.
3. Credenciales efímeras; renovación con sesión válida fuera de UI/audio.
   Expiración pausa si no puede renovar, sin persistir ticket como identidad.
4. Probar en Android físico Doze, WebView cerrada, espacio insuficiente y
   reconciliación al volver. Diferenciar pausa del SO y fallo de transferencia.

**Comandos:** Gradle unit/assemble y Vitest offline.
**DoD:** evidencia física de continuidad/reconciliación; JUnit no cierra solo O04.

### O05 — Descarga durable iOS

**Depende:** O03. **Crear:**
`app/listen/ios/App/App/CrateOfflineDownloadPlugin.swift`,
`OfflineDownloadCoordinator.swift`, `app/listen/scripts/test-ios-offline.sh`
y fixtures/tests Swift invocados por este script.
**Modificar:** `app/listen/ios/App/App/AppDelegate.swift`,
`CrateOfflineIntegrityPlugin.swift`, `app/listen/ios/App/App.xcodeproj/project.pbxproj`,
`.github/workflows/build-ios.yml`, `app/listen/src/lib/offline-native.ts` y tests.

1. RED: reanexión de tareas, callback tras logout, finalización antes de JS,
   archivo vacío y representación cambiada.
2. GREEN: URLSession de background + journal común; lifecycle rehidrata sin
   segunda cola ni red/IO pesado bloqueante en main thread.
3. Adaptar bridge al mismo contrato Android/iOS y agregar tests al CI existente.
4. iPhone firmado: suspensión, regreso, cancelación y disco lleno; documentar
   la planificación del SO, sin prometer progreso ilimitado con app cerrada.

**Comandos:** script nuevo, Vitest offline y build iOS del bloque final.
**DoD:** adapter y dispositivo verificados. Simulador no acredita background;
un impedimento de firma/distribución mantiene este hito pendiente.

### O06 — PWA, evicción y seek acotado

**Depende:** O03. **Modificar:** `app/listen/public/sw.js`,
`app/listen/src/lib/offline-web.ts`, `offline-web.test.ts`,
`offline-storage.ts`, `offline-storage.test.ts`.
**Crear:** `app/listen/scripts/test-offline-browser.mjs` y fixtures locales.

1. RED unitario: perfil cambiado, índice huérfano, bytes incompletos, rangos
   abiertos/sufijo/416 y actualización del SW con descarga activa.
2. RED en navegador real: cold start offline y seek repetido en track largo;
   medir pico de memoria del `arrayBuffer()` que carga el archivo entero.
3. GREEN: publicación recuperable y acceso por rangos con memoria acotada.
   Decidir chunks/OPFS solo si lo exige el spike, con migración comprobada.
4. Reconciliar evicción, mostrar pérdida de disponibilidad y reanudar al abrir.
   Automatizar Chromium y registrar Safari/WebKit instalado por separado.

**Comandos:** Vitest offline; después de crear harness,
`node app/listen/scripts/test-offline-browser.mjs`, con servidor/fixtures
definidos por él. **DoD:** SW real y memoria registrados; MSW no lo sustituye.

### O07 — Resolver local y recuperación del player

**Depende:** adapter de la plataforma correspondiente en O04/O05/O06; la integración completa requiere los tres. Android puede integrar su resolver sin esperar al background iOS. **Modificar:**
`app/listen/src/contexts/player-utils.ts`, `player-utils.test.ts`,
`use-offline-runtime.ts`, `use-offline-synchronization.ts`,
`use-native-playback-runtime.ts`, `app/listen/src/lib/android-native-engine.ts`
y sus tests existentes. **Crear** tests de hooks offline si faltan.

1. RED: N→N+1 local en modo avión, suspensión restaura cola/posición, fuente
   preparada evita ticket nuevo y corrupción afecta solo al asset.
2. GREEN: resolver integrado con engine y generación de cola actuales;
   presupuesto compartido de preparación. Auditar primero playback-resilience.
3. Cubrir identidad global/local, variante y logout/revocación conocida;
   401/403 no se transforma en bypass de autorización.
4. Validar compatibilidad con contratos SmartMix del índice, sin reimplementarlo.

**Comandos:** Vitest `offline player-utils android-native-engine
use-native-playback-runtime`, Gradle y dispositivos de O09.
**DoD:** transición local sin requests de catálogo/ticket/audio a Crate,
manteniendo transporte, MediaSession y cola.

### O08 — UX en superficies existentes

**Depende:** O07. **Modificar:**
`app/listen/src/components/album/AlbumOfflineAction.tsx`,
`app/listen/src/components/settings/OfflineSection.tsx`,
`app/listen/src/components/actions/track-actions.ts`,
`album-actions.ts`, `playlist-actions.ts` y tests de render.

1. RED: pausada por SO/red, cuota llena, nueva versión, archivo perdido,
   reparación y quitar playlist con track compartido.
2. GREEN: estados/accesibilidad/localización y explicación del alcance PWA
   frente a background nativo, sin pantalla Downloads obligatoria.
3. Ajustes muestran uso real/reservado, límite y limpieza explícita de caché.

**Comandos:** Vitest `offline AlbumOfflineAction OfflineSection track-actions`;
typecheck. **DoD:** metadata sola nunca muestra disponible offline.

### O09 — Gates, rollout y rollback

**Depende:** O01–O08. **Modificar:**
`docs/technical/listen-offline-runtime-policy.md`,
`.github/workflows/build-ios.yml` y `.github/workflows/build-android.yml`.
Actualizar métricas donde se observa el evento; no inferir bytes locales en API.

1. Matriz del diseño: Android físico, iPhone firmado, Chromium y Safari PWA;
   incluir track >1 h, modo avión, disco lleno, actualización y crash de commit.
2. Registrar p95 startup/manifest, memoria, errores por causa y energía bajo
   escenarios reproducibles; calibrar objetivos antes de activar SLO.
3. Probar migración/rollback del índice, kill switch y cancelación de
   transferencias conservando playback de assets válidos.
4. Activación interna por plataforma; ampliar tras criterios de error medidos.
   Mantener FastAPI. Si se enruta posteriormente a Go, exigir auth/ETag/paridad.

**DoD global:** evidencia independiente de las tres plataformas, sin cruces de
perfil en la matriz, rangos/integridad correctos y sin pérdida por cuota/rollback.
Hardware o permisos pendientes impiden declarar el hito correspondiente listo.

## Comandos de cierre

Desde la raíz con dependencias instaladas. Son comandos para la implementación,
no suites ejecutadas por la presente revisión documental.

```bash
PYTHONPATH=app pytest -q app/tests/test_offline_contract.py
npm run --workspace=app/listen test -- --run offline player-utils android-native-engine use-native-playback-runtime
npm run --workspace=app/listen typecheck
(cd app/listen/android && ./gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon)
```

Ejecutar también harness O05/O06 una vez creados y tests de workers si se añaden.
Para iOS, seguir dependencias bloqueadas y sincronización del
[runbook existente](../../technical/ios-release-and-cast.md), después:

```bash
(cd app/listen/ios/App && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build)
```

Si se modifica Go: `(cd app/readplane && go test ./...)`. Los gates físicos
incluyen versiones, fixtures y resultados; un build no los sustituye.
