# Connect, Cast y automóvil — Implementation Plan

> **Estado (2026-11-18):** Pendiente; ni Android Auto ni CarPlay ni handoff por fases (verificado 2026-11-18).

> **For agents:** REQUIRED SUB-SKILL: Use `viterbit-ai-tools:executing-plans` to implement this plan task-by-task.

**Goal:** Completar Connect fiable, Cast Android/iOS, Android Auto y CarPlay
sobre el owner de playback de cada plataforma.

**Architecture:** Evolucionar sesiones/outbox/ACK existentes; revisiones y
deduplicación durable, transporte recuperable y handoff con preparación
pausada. Media3 sirve Android; iOS necesita su adapter y owner verificado,
sin segundo player concurrente ni nueva base de sesiones paralela.

**Tech Stack:** FastAPI, PostgreSQL/Redis, SSE/WS/REST, React/Vitest,
Android Media3/JUnit, Swift/CarPlay, Cast SDK y CI Android/iOS.

---

## Baseline y dependencias

Leer [diseño](05-connect-automotive-design.md) y
[runbook iOS/Cast](../../technical/ios-release-and-cast.md).
Corte principal `992704b9`; migraciones 035/037/040/043, outbox y transfer por
ACK ya existen. `codex/playback-resilience` y SmartMix son WIP hasta integrar
sus cambios; contratos SmartMix desde el [índice](00-index.md#fuentes-de-smart-mix).
Android Auto no depende de finalizar VirtualDJ.

Orden de coordinación: C01 → C02 → C03 → C04. C05 integra Cast con esos
contratos; C06/C07 pueden desarrollar browse/adapters tras C01/C02, cerrando
integración con C04. El nodo Downloads depende del contrato local O03/O07 de
01, no impide desarrollar browse online. C08 reúne evidencia y C09 despliega.

CarPlay conserva tarea completa y gate de entitlement/firma. No hacer que su
tramitación bloquee Connect/Android Auto, ni omitirlo para declarar todo listo.

Cada tarea sigue RED → GREEN → REFACTOR, con ejecución del caso fallido antes
del cambio y suite verde después. Separar caracterización ya verde y defectos
nuevos RED. **Crear** identifica archivos propuestos; nombres cortos comparten
directorio con el primer archivo de cada lista. Tests contra fixtures locales,
sin producción, SDKs privados en outputs ni credenciales en artefactos.

### C01 — Caracterización y gates externos tempranos

**Modificar:** `app/tests/test_connect_commands.py`,
`test_connect_ws_v2.py`, `test_cast_tickets.py`;
`app/listen/src/lib/crate-connect.test.ts`, `cast-sender.test.ts`;
`app/listen/android/app/src/test/java/app/cratemusic/crate/NativePlaybackContractTest.java`.

1. Caracterizar dispositivos/presencia, preferencias, comandos, ACK, transfer
   actual, reconexión y ticket Cast. Registrar comportamiento legacy negociable.
2. Añadir RED de transfer simultáneo, ACK tardío tras timeout, reaplicación de
   next y target que inicia audio antes de confirmar preparación.
3. Identificar dispositivos Android Auto, iPhone/Cast/CarPlay y responsables;
   tramitar acceso CarPlay/entitlement y validar recursos de firma al inicio.
4. Auditar owner iOS actual en background y transporte de órdenes fuera de JS.
   Registrar si cumple o exige AVPlayer nativo en C07; simulador no lo decide.
5. Revisar cambios de playback-resilience/SmartMix que toquen el mismo servicio
   Android para integrar por contrato, sin contar sus mocks como gates físicos.

**Comandos:** pytest Connect/Cast, Vitest Connect/Cast y Gradle del cierre.
**DoD:** baseline verificado, RED reproducible y matriz de recursos/gates
externos. Solicitud CarPlay pendiente no se presenta como aprobación.

### C02 — Contrato aditivo y autoridad de sesión

**Depende:** C01. **Modificar:** `app/crate/api/schemas/connect.py`,
`connect_ws.py`, `playback_state.py`;
`app/crate/api/connect.py`, `app/listen/src/lib/crate-connect.ts`,
`crate-connect-state.ts`, `playback-target-types.ts` y sus tests.

1. RED: revisión esperada obsoleta, nueva sesión del mismo dispositivo,
   comando de generación anterior, capability desconocida y cliente antiguo.
2. GREEN: usar campos existentes de sesión/revisión; añadir de forma
   versionada ID de transferencia, fase, expiración y época donde falten.
   Diferenciar ACK recibido/preparado/aplicado sin reinterpretar ACK legacy.
3. Ligadura de command ID a usuario y huella de payload; conflicto explícito
   si se reutiliza con otra intención. Negociar capabilities de cada target.
4. Reutilizar device registry/presencia. Solo si falta persistencia demostrada,
   añadir migración incremental en `app/crate/db/migrations/versions/` con ID
   resuelto contra head y test en `app/tests/test_connect_handoff_migration.py`.
   Probar upgrade, lectura legacy e índices; no duplicar fundación/outbox.
5. Mantener REST/SSE/WS coherentes. No crear schema paralelo `connect_v2.py`
   ni nueva ruta de registro sin justificar contrato ausente.

**Comandos:** pytest Connect/Cast y Vitest `crate-connect playback-targets`.
**DoD:** clientes anteriores continúan operando y nuevos clientes detectan qué
handoff es seguro; fixture único de revisión/ACK para backend y clientes.

### C03 — Outbox y handoff coordinado

**Depende:** C02. **Modificar:** `app/crate/db/repositories/connect.py`,
`connect_state.py`, `app/tests/test_connect_commands.py`.
**Crear:** `app/tests/test_connect_handoff.py`.

1. RED con DB: dos transfers, command ID con payload distinto, owner cambiado,
   next duplicado, ACK de target/source tardío, TTL vencido y crash entre fases.
2. GREEN sobre transfer existente: target prepara pausado; source confirma
   pausa; transacción cambia owner/revisión; orden explícita activa target.
   Outbox y estado de fase se guardan juntos; publicación después de commit.
3. Antes de activar, timeout aborta/conserva source según fase. Activación
   incierta exige reconciliar estado; nunca reanudar source a ciegas.
4. Source inaccesible produce pendiente/error y recuperación visible; cualquier
   toma de control forzada es acción explícita, no falsa garantía de audio único.
5. Idempotencia del ACK incluye sesión/época/fase. Snapshot y recuperación
   convergen sin repetir efectos no idempotentes tras un crash.

**Comando:** `PYTHONPATH=app pytest -q app/tests/test_connect_commands.py app/tests/test_connect_handoff.py`.
**DoD:** un owner lógico por transacción, outbox consistente y efectos inciertos
modelados. Ningún test unitario se presenta como prueba de exactly-once físico.

### C04 — Listen: transporte, controles y owner nativo

**Depende:** C03. **Modificar:**
`app/listen/src/hooks/use-crate-connect-ws.ts`,
`crate-connect-ws-model.ts`, `crate-connect-ws-message-handler.ts`;
`app/listen/src/contexts/use-crate-connect-commands.ts`,
`use-player-connect-transport.ts`, `use-player-connect-state.ts`,
`use-player-connect-v2-sync.ts`;
`app/listen/src/components/player/PlaybackTargetMenu.tsx`,
`ContinuePlaybackPrompt.tsx` y tests existentes.

1. RED: reconnect sin replay completo, mensajes fuera de orden, ACK perdido,
   logout, siguiente repetido y transfer que cambia de cola durante prepare.
2. GREEN: deduplicación/generación, snapshot ante huecos/backpressure,
   preparación pausada y estados visibles de transferencia/recuperación.
   Actualización optimista solo de intención; owner confirmado por servidor.
3. En `app/listen/src/lib/playback-target-connect.ts` y
   `playback-target-native.ts`, mapear capacidades sin tratar Cast como otro
   dispositivo Crate genérico.
4. Modificar `app/listen/src/lib/android-native-engine.ts` y
   `app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java`
   solo en su frontera de comandos/checkpoint. Mantener un engine y una
   MediaSession activa, reconciliar antes de aceptar órdenes tras restart.
5. JUnit en `NativePlaybackContractTest.java` y
   `PlaybackCheckpointStoreTest.java`; Vitest en tests de engine/hooks/UI.

**Comandos:** Vitest del bloque final y Gradle. **DoD:** web/native conservan
cola/posición y no muestran owner confirmado mientras solo existe intención.

### C05 — Cast de extremo a extremo, Android e iOS

**Depende:** C02/C04. **Modificar:** `app/crate/api/cast.py`,
`app/crate/db/repositories/cast_tickets.py`, `app/tests/test_cast_tickets.py`;
`app/listen/src/lib/cast-sender.ts`, `cast-sender-media.ts`,
`playback-target-cast.ts` y tests;
`app/listen/android/app/src/main/java/app/cratemusic/crate/CrateCastPlugin.java`;
`app/listen/ios/App/App/CrateCastPlugin.swift`.

1. RED: usuario/recurso/sesión incorrectos, expiración/revocación, dos rangos y
   seek tras pausa, codec no soportado y ticket antiguo tras cambio de cuenta.
2. GREEN sobre rutas existentes: ticket autorizado y renovable según contrato,
   representación compatible y validación de solicitudes nuevas. No retirar
   bytes ya cargados ni hacer ticket de uso único si necesita Range sucesivos.
3. Receiver recibe URL de entrega necesaria, nunca PAT/bearer/peer/path;
   redacción de credenciales en logs, errores y reportes.
4. Verificar alcance API/TLS/CORS desde receiver, cambio local→Cast→local,
   reconexión y metadata/artwork. Cubrir móvil iOS además de Android.
5. Seguir Podfile.lock/xcworkspace y runbook iOS existente; no añadir otra
   integración SDK paralela. Resolver cualquier configuración receiver faltante.

**Comandos:** pytest Cast, Vitest Cast/targets, builds Android/iOS.
**DoD:** receiver físico con ambos senders y evidencia de rangos/revocación.
Compilar `canImport` o mockear Cast no cierra el hito.

### C06 — Android Auto y biblioteca Media3

**Depende:** C01/C02; integración final C04. Downloads requiere O03/O07 de 01.
**Modificar:**
`app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java`,
`app/listen/android/app/src/main/AndroidManifest.xml`.
**Crear:** `app/listen/android/app/src/main/java/app/cratemusic/crate/CrateMediaLibrary.java`,
`app/listen/android/app/src/test/java/app/cratemusic/crate/CrateMediaLibraryTest.java`
y prueba instrumentada equivalente en `app/listen/android/app/src/androidTest/java/app/cratemusic/crate/`.

1. RED: root/children/search con identidad estable, páginas, nodo autorizado,
   sesión expirada, offline, artwork ausente y cancelación al desconectar host.
2. GREEN: convertir servicio a MediaLibraryService/MediaLibrarySession sobre
   ExoPlayer actual; callbacks asíncronos y manifest de biblioteca compatible.
   No añadir Car App Library por defecto para biblioteca de audio estándar.
3. Árbol Home/Library/Playlists/Favorites/Downloads con límites y caché.
   Resolver item al reproducir y revalidar permisos, sin HTTP en main/audio.
4. Reutilizar transporte/checkpoint, audio focus y Bluetooth. Probar proceso
   recreado, host desconectado y ausencia de un segundo servicio legacy activo.
5. Si SmartMix está integrado, seguir su contrato de owner/controls/fallback;
   Auto no espera la publicación de VDJ ni redefine su DSP.

**Comandos:** Gradle unit/assemble; instrumentación/DHU configurados en C08.
**DoD:** browse y transport probados en host Auto y teléfono físico; Downloads
puede cerrarse después de online, pero no desaparecer del alcance aceptado.

### C07 — CarPlay completo y owner iOS

**Depende:** C01/C02; integración final C04, offline O03/O07 para Downloads.
**Crear:** `app/listen/ios/App/App/CarPlaySceneDelegate.swift`,
`CarPlayLibraryAdapter.swift`, `app/listen/scripts/test-ios-carplay.sh`
y tests Swift/fixtures invocados por este script.
**Modificar:** `app/listen/ios/App/App/AppDelegate.swift`, `Info.plist`,
`App.entitlements`, `CrateMediaSessionPlugin.swift`,
`app/listen/ios/App/App.xcodeproj/project.pbxproj`,
`.github/workflows/build-ios.yml`.

1. RED: browse sin JS foreground, scene disconnect/reconnect, sesión inválida,
   audio focus/interrupción, artwork y comando que intenta activar dos owners.
2. GREEN: templates y lifecycle CarPlay, contrato compartido de biblioteca y
   comandos, límites y estado de login/offline adecuados al host.
3. Cerrar spike de C01: si engine actual no pasa background/host, **crear**
   `app/listen/ios/App/App/CrateNativePlaybackPlugin.swift`,
   `IOSPlaybackCoordinator.swift` y bridge TS con tests; AVPlayer conserva
   cola/posición y exclusión con engine WebView. No usar Media3 en iOS.
4. Registrar/solicitar entitlement y provisioning según Apple; build sin firma
   y simulador permiten desarrollar, pero no prueban aceptación/distribución.
5. iPhone firmado + CarPlay: pantalla bloqueada, interrupción, 30 minutos
   suspendido, seek/next, desconexión y biblioteca offline cuando O07 esté listo.

**Comandos:** script nuevo, CI/build iOS, tests bridge TS y prueba física.
**DoD:** paridad del alcance y entitlement/distribución comprobados. Si la
aprobación o hardware faltan, CarPlay queda pendiente con responsable; nunca
se elimina del plan ni se sustituye por “solo si hay build disponible”.

### C08 — Harness, observabilidad y matriz real

**Depende:** C03–C07 para cierre; preparar harness antes en paralelo.
**Crear:** `app/listen/scripts/test-connect-handoff.mjs` y fixtures locales.
**Modificar:** `app/crate/api/connect_ws.py`,
`app/crate/db/repositories/connect_ws_hub.py`, `app/tests/test_connect_ws_v2.py`
solo donde RED evidencie huecos de replay/backpressure;
`docs/technical/ios-release-and-cast.md`, `.github/workflows/build-ios.yml`
y `.github/workflows/build-android.yml`.

1. RED: transporte lento, pérdida de replay, dos dispositivos y cuenta
   distinta, restore, ACK perdido y source desaparecido durante handoff.
2. GREEN: recuperación por snapshot/outbox, buffers acotados y aislamiento;
   harness registra fases y resultados sin tokens ni metadata privada.
3. Medir preparación/coordinación/startup, gaps/solapes observados, reconexión,
   stale commands, memoria y energía. Calibrar p95 local <2 s y remoto preparado
   <5 s en fixtures antes de convertirlos en SLO.
4. Matriz: navegador y Android/iOS; Cast receiver físico con ambos senders;
   Auto DHU + teléfono/host y CarPlay simulador + iPhone firmado/host.
   Incluir Bluetooth, lock-screen, 30 minutos suspendido, red caída y cambio de cuenta.
5. CI ejecuta tests y builds por plataforma. Registrar build/OS/host/fixture/
   resultados de gates manuales; no confundir DHU/simulador con prueba física.

**Comandos:** suites del cierre; después de crear harness,
`node app/listen/scripts/test-connect-handoff.mjs`.
**DoD:** informes reproducibles, límites medidos y ausencia de gates inferidos.

### C09 — Rollout y rollback por superficie

**Depende:** C08 para la superficie que se libera.
**Crear:** `docs/technical/connect-release-gates.md`; **modificar:**
`docs/technical/ios-release-and-cast.md` y configuración de flags existente,
con tests de negociación/fallback del cliente.

1. Backend aditivo antes de clientes; migración solo si C02 la justificó,
   comprobando convivencia con versión anterior.
2. Flags independientes para handoff, Cast, Auto y CarPlay. Activar internos,
   luego ampliar cada plataforma según su evidencia, sin ligar fechas a VDJ.
3. Kill switch bloquea nuevas transferencias/superficies y permite terminar o
   reconciliar pendientes, conservando playback local/cola.
4. Probar rollback con target preparado, activación incierta y cliente viejo;
   no resetear posición o parar audio solo por desactivar remote UI.
5. Readplane sigue opcional. Si se mueven lecturas, añadir auth, snapshot y
   paridad y ejecutar Go desde su módulo; no exigir una ruta Go ficticia.

**DoD global:** Connect/Cast/Android Auto/CarPlay cerrados individualmente,
permisos y hardware acreditados, ningún efecto físico incierto presentado como
exactly-once. Un rollout parcial se anuncia por sus capacidades reales.

## Comandos de cierre

Desde la raíz, con dependencias y DB/Redis de tests locales preparados.
Comandos para implementar el plan; esta revisión no ejecuta suites de producto.

```bash
PYTHONPATH=app pytest -q app/tests/test_connect_commands.py app/tests/test_connect_ws_v2.py app/tests/test_cast_tickets.py
npm run --workspace=app/listen test -- --run crate-connect use-player-connect PlaybackTargetMenu ContinuePlaybackPrompt cast-sender playback-targets android-native-engine
npm run --workspace=app/listen typecheck
(cd app/listen/android && ./gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon)
```

Añadir `test_connect_handoff.py`, migración si existe y harness de C07/C08 al
crearlos. Android instrumentado con dispositivo/emulador preparado:
`(cd app/listen/android && ./gradlew :app:connectedDebugAndroidTest --no-daemon)`.
DHU y hosts físicos requieren ejecución registrada aparte.

Para iOS: dependencias bloqueadas y sincronización según runbook, script nuevo
de CarPlay y:

```bash
(cd app/listen/ios/App && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build)
```

Si se modifica Go: `(cd app/readplane && go test ./...)`. Entitlements, firma,
receiver y comportamiento de background se verifican además del build.
