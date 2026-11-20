# Jam y Auto DJ sobre Smart Mix — Plan 2027

> **Estado (2026-11-18):** Pendiente (J01–J09). Jam sigue desactivado en Listen.

> **Para agentes:** usar `viterbit-ai-tools:executing-plans` y el [diseño 06](06-smart-mix-jam-design.md). Este plan solo continúa Jam; análisis, planner, crossfade Android y VirtualDJ se ejecutan desde las fuentes canónicas del [índice](00-index.md#fuentes-de-smart-mix).

**Objetivo:** completar las salas existentes y conectar su cola/Auto DJ al core musical común con reproducción y permisos verificables. **Estado:** propuesta revisada 2026-09-09; no implementación ni aceptación realizada. **Base:** principal `992704b9` y WIP Smart Mix separado. **Stack:** FastAPI/PostgreSQL/Redis/Dramatiq, WS, React/engines existentes; Android Media3 solo en el adapter correspondiente.

## Secuencia y criterio de cierre

`J01 → J02/J03 → J04 → J05 → J06/J07 → J08 → J09`. J06 requiere el contrato del core corregido; el resto de hardening de Jam puede empezar antes. No se espera a completar VDJ C, Social o Push. Cada tarea empieza por regresiones RED enumeradas, implementa el mínimo y ejecuta GREEN; commits acotados al implementarse, sin tocar trabajo ajeno.

Los tests existentes son base, no evidencia de que hayan pasado en esta revisión. No crear de nuevo migraciones 085/086 ni `track_mix_profiles`; cualquier columna/constraint nueva usa el siguiente head real después de integrar las ramas. El gate backend verificado desbloquea cliente; aceptación host/audio se cierra después en J08 para evitar dependencias circulares.

### J01 — Inventario, protocolo y flags efectivos

**Modificar:** `app/crate/api/jam.py`, `app/crate/api/schemas/jam.py`, `app/crate/config.py`, `app/listen/src/app-shell/feature-flags.ts`, `route-table.tsx`; fixtures de `app/tests/test_jam_sync.py`, `app/listen/src/hooks/use-jam-websocket.test.tsx`. **Crear:** `app/tests/test_jam_capabilities.py` y fixtures de protocolo bajo `app/tests/fixtures/jam/`.

1. Registrar HEAD/diff principal y adopción real de los contratos Smart Mix; no dar su WIP como integrado. Enumerar REST/WS actuales desde router y consumers. Eliminar del contrato objetivo los endpoints Smart Mix inventados del roadmap antiguo.
2. RED: flags servidor en false bloquean nuevos joins/mutaciones WS/REST aunque el cliente se salte UI; leave/diagnóstico siguen disponibles. Cliente antiguo/protocolo desconocido y flag AutoDJ independiente.
3. GREEN: definir envelope nuevo, compatibilidad legacy temporal, capabilities y kill switches backend+UI. Mantener los nombres de rutas existentes y no cambiar su auth global por usar el gate.
4. Ejecutar `PYTHONPATH=app python -m pytest -q app/tests/test_jam_sync.py app/tests/test_jam_capabilities.py` y Vitest WS/route relevante. Registrar diferencias, no activar el flag de producción.

**DoD:** fixtures describen estado real/objetivo y flags aplicables; J02/J03 pueden implementar el nuevo envelope sin duplicar modelos musicales.

### J02 — Cola autoritativa, comando idempotente y publicación durable

**Modificar:** `app/crate/db/jam_queue.py`, `jam_rooms.py`, `jam_events.py`, `app/crate/api/jam.py`, schemas y `app/crate/db/domain_events.py` solo si la integración necesita adapter. **Crear:** nueva migración de revision/command dedup con head asignado al ejecutar; `app/tests/test_jam_commands.py`. **Ampliar:** `test_jam_queue.py`, `test_jam_sync.py`.

1. RED con dos conexiones PG: doble next sobre el mismo current item, ACK perdido+retry, reorder obsoleto, voto repetido, approve doble, cliente viejo y nuevo simultáneos. El unique vote actual no hace idempotente un toggle reintentado.
2. GREEN: `commandId`+actor/sala y expected revision/current item; validar/aplicar/persistir ACK/evento en una transacción breve. Voto nuevo expresa estado deseado. Dedup con retención acotada y respuesta original; colisión ID/payload distinto da conflicto.
3. Integrar outbox/evento durable existente para notificar después del commit. Pub/Sub es transporte, no única copia del cambio; replay gap produce snapshot. Límites de cola/payload y validación de identidad antes de persistir track payload.
4. Ejecutar suite con PG/Redis efímeros exclusivos; pruebas de crash tras commit y antes de publish. Comprobar una sola revisión/advance y replay consistente.

**DoD:** el retry no altera dos veces sala/cola y ningún consumidor aplica un estado anterior al ya confirmado.

### J03 — Seguridad WS, presencia y coordinador multiworker

**Modificar:** `app/crate/api/jam.py`, `app/crate/db/jam_members.py`, `jam_invites.py`, `jam_rooms.py`; tests sync. **Crear:** `app/tests/test_jam_security.py`, `test_jam_multiworker.py`; extraer coordinador/presencia a `app/crate/jam_sync.py` si simplifica el router actual.

1. RED: revocar sesión/expulsar miembro/cambiar rol con WS abierto, también sin que el cliente envíe ningún comando posterior; invitación expirada/reutilizada, origen no permitido, mensaje grande, cliente lento y dos workers con Redis intermitente.
2. GREEN: revalidar permisos actuales en comandos, invalidar suscripciones/buffers al revocar y usar heartbeat de autorización con ventana residual máxima de 5 segundos. Si falla la comprobación, suspender entrega privada. Limpiar auth/close/leave con TTL y limitar buffers/frecuencia/tamaño; no conservar el rol del connect indefinidamente ni emitir tokens/tickets/paths al resto de miembros.
3. Un clock/epoch por sala con lease/fencing y persistencia/recovery definidos; pérdida del lease invalida broadcasts anteriores. Redis caído no habilita dos relojes locales independientes. Definir auth WS web/native reutilizando sesiones y credenciales temporales sin JWT largo en URLs/logs.
4. Ejecutar pruebas con dos procesos reales y PG/Redis aislados. Medir fanout/slow-consumer y demostrar que desconectar uno no bloquea los demás.

**DoD:** derechos revocados efectivos, cleanup acotado y ninguna split-brain silenciosa. Contrato backend listo desbloquea cliente sin esperar la matriz acústica.

### J04 — Hidratación y sincronización sin reiniciar el engine

**Modificar:** `app/listen/src/hooks/use-jam-websocket.ts`, `jam-websocket-control-handler.ts`, `jam-websocket-message-handler.ts`, `use-jam-playback-effects.ts`, `use-jam-session-lifecycle.ts`, `use-jam-session-player-refs.ts`, `app/listen/src/contexts/use-player-jam-queue-sync.ts`, `use-jam-queue-session.ts`, reducers/modelos de `src/pages/jam-*`.

**Ampliar:** `src/hooks/use-jam-websocket.test.tsx`, `use-jam-session-player-refs.test.ts`, `src/contexts/use-jam-queue-session.test.ts`, `src/pages/jam-reducer.test.ts`, `jam-reducer.queue.test.ts`.

1. RED con engine fake de readiness asíncrona: clock antes de snapshot, snapshot antes de media ready, response del track anterior, votos/reorder durante reproducción, reconnect con hueco y exit doble.
2. GREEN: gate por epoch/revision/load generation; aplicar clock solo al media preparado. Queue diffs conservan pista/posición; un voto o presencia no invoca setQueue/reload/pause. ACK/conflicto corrige optimismo local sin pisar evento más nuevo.
3. Spectrum/analyser se adjuntan al engine real después de ready y conservan lifecycle. Salir restaura snapshot local una vez y libera WS/timers/subscriptions; autoplay denegado muestra acción explícita.
4. Ejecutar Vitest de los archivos citados, render de salas y typecheck. Probar primer arranque/siguiente/anterior lógico permitido sin loop del primer segundo ni spinner permanente.

**DoD:** media y UI representan la misma pista/posición; no se simula playing antes de ready ni se utiliza rehidratación como mecanismo de sync.

### J05 — Refill concurrente y votos del Auto DJ existente

**Modificar:** `app/crate/jam_auto_dj.py`, `app/crate/queue_engine.py`, `app/crate/db/jam_auto_dj.py`, `jam_queue.py`, `app/crate/worker_handlers/jam.py`. **Ampliar:** `app/tests/test_jam_auto_dj.py`, `test_jam_worker.py`, `test_queue_engine.py`, `test_jam_queue.py`.

1. RED: dos refill jobs simultáneos, settings/genre/votes modificados durante selección, sala cerrada, fuente desaparecida, candidatos agotados, variantes duplicadas, stop/restart y seed fijo.
2. GREEN: capturar generación/intent, obtener candidatos y calcular fuera del lock; CAS publica un lote si sigue vigente. Reutilizar primes y service loop existentes, límites/pause/resource governor; no crear otro scheduler o handler de análisis.
3. Votos cambian generación futura con diversidad/filtros duros, sin modificar edge en vuelo. Cola actual se conserva al agotar candidatos; status explica falta de cobertura o media.
4. Ejecutar tests de función pura y concurrencia PG; verificar un lote por generación y ningún full scan/N+1 en cada heartbeat.

**DoD:** Auto DJ continúa de forma predecible y los efectos de votos no reinician reproducción.

### J06 — Integrar Smart Mix como dependencia existente

**Depende además de:** core SM03/SM06 del plan canónico adoptado y fixtures de procedencia/versiones. **Modificar:** `app/crate/jam_auto_dj.py`, `queue_engine.py`, schemas Jam, servicios Smart Mix existentes después de integración; adapter/contexts de Jam y sus tests. **Crear:** `app/tests/test_jam_smart_mix_contract.py`, fixture de capacidades heterogéneas y test del adapter TS.

1. RED: perfiles legacy/desconocidos, cambio de source/profile/cue/cola, modo no soportado en un miembro, plan tardío o API caída; late join/reconnect y cambio de capabilities durante overlap. Dos miembros con cues privados distintos mantienen timeline común sin exponer esos overrides. Playback de sala no espera análisis ni planificación en el borde.
2. Consumir ranking/compatibilidad musical compartidos y separar preferencias/diversidad del grupo; retirar fórmulas duplicadas de transición BPM/key del adapter. Pedir al core cues automáticos/globales para la sala, sin aplicar ni publicar overrides privados del host o participantes. No crear un segundo planner dentro de Jam ni depender de P06 para este modo.
3. Vincular plan al edge/epoch/revision y congelar antes de armar el descriptor de transición (pistas, instante de entrada, duración y posiciones/cues efectivos). Negociar capacidades antes de ese punto; un join/reconnect adopta descriptor y fallback compatibles sin renegociar el edge en vuelo ni bloquear la sala por su readiness. Cambio deliberado de timeline exige nuevo epoch/resync. No transmitir secretos del host.
4. Probar core→Jam→Android/web con fixtures versionados y confirmar que la cola avanza una vez en la sala aunque haya varios `track_finished` locales.

**DoD:** Jam reaprovecha Smart Mix sin apropiarse de su roadmap; falta de análisis degrada y VDJ no bloquea este hito.

### J07 — UX y matriz funcional por plataforma

**Modificar:** `app/listen/src/components/jam/`, `src/hooks/jam-room-view-model.ts`, controller/lobby/rutas, catálogos de idioma y tests de componentes. Reutilizar `@crate/ui` y no migrar el design system en este workstream.

1. RED/render: roles host/collab/listener, permisos cambiados, cola readonly, conflicto, invitación revocada, reconnect, media no disponible y modo no certificado.
2. UI de queue/votes/filter/AutoDJ, control del host, feedback de ACK y recuperación. Keyboard alternativa al DnD, focus, labels, overflow móvil y artwork con identidad correcta.
3. Escenarios web desktop/Android/iOS/web móvil con motores reales: autoplay, background, route/focus/auth y salida. Matriz separa funcionalidad disponible de sincronía estricta certificada.
4. Vitest, typecheck e i18n; smoke manual sin activar globalmente el flag.

**DoD:** sala utilizable y comprensible con errores reales, sin depender de una navegación oculta o controles sin efecto.

### J08 — Medir sincronía distribuida y fiabilidad

**Crear:** `tools/jam-lab/benchmark.py`, `tools/jam-lab/tests/test_benchmark.py` y manifests/capturas de prueba. **Modificar:** telemetría Jam/CI y este par de documentos; reutilizar el laboratorio Smart Mix para análisis de capturas, sin mezclar sus gates.

1. Verifier RED ante captura vacía, retraso/drift inyectado, doble advance, muestras sin build/ruta/red o percentiles fuera de límites.
2. Ejecutar gates del diseño:100 ciclos entrada/reconnect, ≥ 200 transiciones por configuración de audio y 2 h con 10 salas × 10 miembros. Registrar p50/p95/max/error counts, memoria y cola de mensajes; fixtures musicales autorizadas.
3. Medir audio de múltiples dispositivos por captura multicanal alineada; controlar latencia de ruta sin restarla para esconder drift. Sala remota ≤ 250 ms y modo misma estancia ≤ 20 ms son certificaciones separadas.
4. Si no pasa sincronía estricta, conservar el trabajo/gate pendiente y limitar anuncio del modo; mejorar clock/buffering/ejecución y repetir. No afirmar que pasar fase Android basta, ni hacer de VirtualDJ un workaround de Jam.
5. Probar dos workers,Redis caído, reconnect/auth/focus/routes y fallback media. Identificar plataforma/ruta soportada explícitamente.

**DoD:** evidencia reproducible de cada modo anunciado, sin inferir calidad acústica de logs WS. El cierre total conserva pendientes reales; modificar alcance exige actualizar diseño/índice explícitamente.

### J09 — Rollout y handoff documental

**Depende de:** J01–J08 según modo anunciado. Separar beta de sala coordinada y certificación estricta.

1. Flags servidor/UI apagados; canary privado y luego opt-in. Vigilar sync/fallback/errors/cola/memoria con labels acotados, sin historial privado.
2. Ensayar disable AutoDJ independiente de Jam; disable Jam cierra control compartido y conserva recuperación de playback local. Sin rollback destructivo de sala/cola/invitaciones.
3. Actualizar fuentes canónicas al iniciar entrega, incluido el viejo diagnóstico de estado Jam; el roadmap no se publica como runbook por sí solo. Registrar capturas/builds/checks y estado real de sincronía estricta.

**DoD:** rollout reversible, controles coherentes y ninguna tarea de análisis/VDJ duplicada bajo el nombre Jam.

## Verificación al implementar

Servicios PG/Redis de test aislados; no heredar credenciales de desarrollo/producción. Desde raíz:

```sh
PYTHONPATH=app python -m pytest -q app/tests/test_jam_sync.py app/tests/test_jam_queue.py app/tests/test_jam_auto_dj.py app/tests/test_jam_worker.py app/tests/test_queue_engine.py
npm run --workspace=app/listen test -- src/hooks/use-jam-websocket.test.tsx src/pages/jam-reducer.test.ts src/pages/jam-reducer.queue.test.ts src/contexts/use-jam-queue-session.test.ts
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen i18n:check
```

Añadir los tests nuevos de cada tarea al CI; no asumir que glob shell o filtros por la palabra Jam los ejecutan. Gradle/dispositivos solo para el adapter Android tocado; Go desde `app/readplane` únicamente si se implementa una ruta Go. WS/autoridad permanecen en FastAPI salvo decisión medida. Estado inicial J01–J09: **pendiente**, con base existente descrita en el diseño y sin tests funcionales ejecutados en esta revisión documental.
