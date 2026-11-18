# Plugin SDK de Crate — Plan 2027

> **Estado (2026-11-18):** Pendiente (SDK01–SDK10), condicionado al gate de demanda SDK01.

> **Para agentes:** seguir `viterbit-ai-tools:executing-plans`, [diseño 10](10-plugin-sdk-design.md) e [índice](00-index.md). Estado: propuesta revisada 2026-09-09; no existe runtime público en baseline principal `992704b9`. Todos los archivos propuestos se marcan Crear.

**Objetivo:** entregar extensiones aisladas para los casos anunciados, con permisos y recuperación verificables. **Arquitectura:** workers/coordinador confiable → proceso WASM limitado → resultados tipados → aplicación en dominios existentes. **Stack objetivo:** Rust/Wasmtime, FastAPI/PostgreSQL/Dramatiq, React Admin/Listen; no requiere VDJ ni un SDK de UI.

## Dependencias y secuencia

`SDK01 → SDK02 → SDK03/SDK04 → SDK05 → SDK06 → SDK07 → SDK08/SDK09 → SDK10`. Los adapters de cada dominio dependen solo de sus contratos estables. Metadata/scrobble/export existentes permiten empezar; no bloquear todo el SDK a que termine discovery/Jam/lyrics 2027. Todas las tareas parten de RED específico, GREEN de implementación mínima y pruebas negativas reales, no únicamente mocks del runtime.

### SDK01 — Gate de demanda y comparación acotada

**Leer:** `app/crate/scanners/base.py`, `scanners/__init__.py`, `fixers/__init__.py`, `enrichment.py`, `lyrics.py`, `scrobble.py`, `worker_handlers/`, `db/jobs/scrobble_dispatch.py`, `db/domain_events.py`. **Modificar:** este diseño/plan con evidencia; sin cambiar esos dominios aún.

1. Seleccionar dos extensiones útiles y productores distintos; documentar qué necesitan y coste de adapter interno frente al SDK. Mantener los cinco tipos del alcance, indicando qué extensión prueba cada uno.
2. Spike con paquete mínimo Wasmtime: compilar/instanciar/trap/loop/hostcall bloqueante, medir cold/warm CPU/RSS y empaquetado Linux amd64/arm64. Extism solo entra en comparación si aporta una mejora concreta, no como segunda plataforma soportada.
3. Probar aislamiento de proceso/entorno/FDs/mounts y límites del deployment real. Elegir launch aislado o servicio runner explícito; registrar transporte/grants del broker si hay servicio. No montar Docker socket como atajo.
4. Decisión documentada: seguir con runtime elegido y coste de soporte, o conservar pendiente el SDK por falta de retorno. No construir registry/UI antes de este gate.

**DoD:** demanda y factibilidad demostradas; arquitectura de despliegue concreta; presupuesto de memoria/CPU/timeout firmado en el diseño como decisión, no una afirmación de rendimiento ya alcanzado.

### SDK02 — Especificación, manifest y tipos

**Crear:** `tools/plugin-sdk/spec/plugin.schema.json`, `invocation.schema.json`, `result.schema.json`, `tools/plugin-sdk/examples/metadata/plugin.toml`, tests/golden fixtures. **Crear:** `app/crate/api/schemas/plugins.py` al congelar el transporte administrativo.

1. RED: ABI desconocido, capability no concedida, tipos/sizes inválidos, operaciones/destinos fuera de scope, downgrade no admitido y manifest sin hashes completos.
2. GREEN: ABI v1, tipos de error, idempotency/context/grant revision y validación shared host/guest. Separar SemVer paquete/ABI/API HTTP. Fijar compatibilidad y golden fixtures con desconocidos y nulls.
3. Especificar configuración y migraciones declarativas; ningún script de migración arbitrario tiene acceso al host. Scope nuevo nunca se concede por upgrade automático.

**DoD:** contrato pequeño implementable por dos plugins; fixtures ejecutables y sin secretos/path de biblioteca.

### SDK03 — Runner real y límites de invocación

**Crear:** `tools/plugin-runtime/Cargo.toml`, `src/main.rs`, `src/runtime.rs`, `src/limits.rs`, `tests/runtime.rs`, fixtures WASM adversariales y benignos. Paths finales se ajustan al layout decidido en SDK01 sin duplicar runtime.

1. RED con módulos reales: loop, trap, memoria/tablas enormes, recursion, payload/log excesivo, cancelación y hostcall bloqueante. Medir también tiempo de compilar módulo no confiable.
2. GREEN: process supervisor, fuel/epoch, límites memoria/output y deadline total; no imports WASI amplios/env/preopens/secretos heredados. Kill/cancel acotado y limpieza de proceso/tempfiles.
3. Test dos cuentas/plugins/versiones; ningún estado o buffer del anterior visible. Pool permanece fuera hasta probar reset. No aceptar artefacto nativo precompilado suministrado por paquete.
4. `cargo test --manifest-path tools/plugin-runtime/Cargo.toml`; CI debe ejecutar las fixtures, no saltarlas cuando falte compilador guest.

**DoD:** fallos del módulo contenidos y recursos acotados en el deployment real, incluyendo host calls.

### SDK04 — Broker de capacidades y egress

**Crear:** `app/crate/plugins/broker.py`, `grants.py`, `contracts.py`, `app/tests/test_plugin_broker.py`, `test_plugin_grants.py`, `test_plugin_egress.py`; interface host-call del runtime. **Reutilizar:** servicios de auth/settings/proveedores existentes, sin exponer su almacenamiento al guest.

1. RED: handle de otro usuario/plugin, grant revocado durante ejecución, URL/redirect/IP no permitida, DNS cambiante, secreto en respuesta/log y cuotas excedidas; texto editorial sin permiso para entregarse al guest o enviarse al proveedor.
2. GREEN: broker inyecta credenciales solo al proveedor autorizado; guest recibe resultado saneado. Operación estructurada con método/destino/DTO limitado; negar acceso arbitrario a DB/Redis/FS/socket.
3. Validar grants al iniciar y al aplicar resultado, con revisión/fencing; bloqueo externo no dura más que deadline. Export solo emite bloques validados a worker, jobs solo tipos/cuotas del scheduler.
4. Ejecutar los tres tests con servidor HTTP local adversarial de test y runtime real; matrices por capability, sin acceder a proveedores productivos.

**DoD:** imports permitidos no se convierten en un proxy genérico ni entregan secretos al guest.

### SDK05 — Registry, paquetes y migración mínima

**Crear:** `app/crate/plugins/registry.py`, `package_verifier.py`, `app/crate/db/orm/plugins.py`, `db/repositories/plugins.py`, `app/tests/test_plugin_registry.py`, `test_plugin_packages.py`, `test_plugin_migration.py`; nueva migración con siguiente revisión real, nunca `2027_10_plugins.py` como número reservado.

1. RED: zip-slip/symlink/bomba, hash/firma parcial, clave revocada, publisher cambiado, version collision, rollback con config incompatible y desinstalación con resultados ya aplicados.
2. GREEN: verificación antes de instalar/activar, trusted roots versionadas, staging atómico por hash, active version pointer y previous version. Retener únicamente tablas que falten: installs/versions/config/grants; runs usan tasks y eventos usan outbox existente.
3. Config/secret refs por cuenta, grants explícitos; rollback no restaura permisos revocados. Borrar paquete no elimina créditos/imports/scrobbles de negocio.
4. Tests de migración sobre PG efímero y crash durante verify/stage/activate; filesystem de paquetes/exports separado de `/music` y escrito por worker.

**DoD:** versión activa íntegra y recuperable, sin plugins parcialmente activados ni migraciones destructivas.

### SDK06 — Orquestación en workers y CRUD administrativo

**Crear:** `app/crate/worker_handlers/plugins.py`, `app/crate/api/plugins.py`, `app/tests/test_plugin_tasks.py`, `test_plugin_api.py`. **Modificar:** `app/crate/actors.py`, `api/__init__.py`, registro de handlers y task schemas reales según patrón existente.

1. RED: idempotent install/enable/disable/config; concurrent upgrade, disabled plugin con job pendiente, worker crash, resultados duplicados y usuario sin permisos.
2. GREEN: API permite CRUD transaccional de config/grants; install/ejecución/filesystem van a actor. Registrar grants/versión/context capturados y verificar al publicar; no runtime en request FastAPI ni jobs en `orchestrator.py`.
3. Retry por fallo tipado y quota; efecto externo ambiguo requiere política del proveedor. Evitar generación recursiva infinita y conservar task/event lineage para diagnóstico.
4. Suite API/worker con PG/Redis aislados y runner real; caída del runner no bloquea workers de playback.

**DoD:** lifecycle completo con idempotencia y ownership; no segundo sistema de tareas genérico.

### SDK07 — UI Admin y consentimiento personal

**Crear:** `app/ui/src/pages/Plugins.tsx`, su render test, cliente tipado; sección de grants en Listen y test. **Modificar:** routes/Settings/catálogos existentes de cada app, usando `@crate/ui`.

1. RED/render: plugin no confiable, permiso nuevo en upgrade, usuario normal consentir/revocar su cuenta, error de firma/runner, rollback indisponible y disable pendiente.
2. GREEN: procedencia/ABI/versiones/datos solicitados/límites/health, manejo de secretos mediante referencias, error saneado. Admin instalar no equivale a consentimiento de terceros.
3. Tests de componentes, typecheck e i18n de ambas apps. Health es lectura pequeña autenticada, no requiere crear ruta Go o snapshot global por defecto.

**DoD:** operador y usuario entienden qué se concede y pueden retirarlo sin reiniciar API.

### SDK08 — Hooks y extensiones de referencia

**Crear:** adapters bajo `app/crate/plugins/adapters/`, tests `test_plugin_adapters.py`, paquetes de referencia bajo `tools/plugin-sdk/examples/` con input/output fixtures. **Modificar cuando se integren:** `worker_handlers/enrichment.py`, `lyrics.py`, `db/jobs/scrobble_dispatch.py`, export/task handlers y scheduler concretos existentes.

1. RED/GREEN por caso anunciado: provider metadata/letras, scrobbler consentido, job programado acotado, feature derivada desde analysis DTO y exporter por bloques. Productor del dominio valida resultado/expected revision y aplica en su transacción normal.
2. Procedencia plugin/hash/versión/licencia en resultado; dedup(invocation,target,inputRevision). La licencia/procedencia del guest es una afirmación no confiable: aplicar la política editorial 07 antes de entregar texto al guest, hacer egress/export/federación y persistir el resultado. RED: licencia falsa, export de letra display-only, expiración/revocación durante invocation y fallback que intenta servir versión retirada. No permitir que “emitir evento” eluda permisos de escritura del dominio.
3. Suite event→task→runtime→resultado→commit con reintentos y plugin fallando 100%; comprobar continuidad de API/playback y fallback builtin. Scrobbler usa semántica real del proveedor para respuestas ambiguas.
4. Dos plugins desarrollados con el SDK público deben superar ABI/testing/install sin imports privados del host. Fixtures fake cubren fallos, pero no sustituyen las dos extensiones útiles de SDK01.

**DoD:** cinco tipos de hook entregados dentro de sus límites declarados; no proclamar soporte PCM/DSP completo que no ofrece ABI v1.

### SDK09 — Operación, proyección federada y matriz de seguridad

**Modificar:** métricas/tasks/Admin/operación y export/proyección de metadata del dominio donde corresponda. **Crear:** `app/tests/test_plugin_federation_projection.py`, `test_plugin_observability.py`, harness de fuzz bajo runtime tests y workflow específico CI.

1. Probar que solo resultados ya compartibles pasan al catálogo/federación con procedencia acotada; el receptor no ejecuta módulo ni necesita el ABI guest. Rechazar datos privados/secrets/handles; reutilizar firma/eventos de federación existente, sin canal plugin paralelo.
2. Emitir invocation/trap/timeout/quota/egress/version/revoke metrics incluso en fallo, con labels finitos. Logs saneados, retención acotada; registrar CVE/runtime update y revocación de publisher.
3. Linux amd64/arm64, 1000 invocaciones calientes por escenario, cold compile aparte; p95 overhead<200 ms y memoria/deadlines dentro de SDK01. El éxito es aislamiento aun con 100% errores guest, no una tasa arbitraria de fallos inferior 1%.
4. Fuzz/fixtures adversariales, TLS/redirect/capabilities, cancelación y upgrade bajo carga; los tests demuestran ausencia de violaciones en ese corpus, no una garantía matemática de sandbox infalible.

**DoD:** seguridad/operación reproducibles y compatibilidad federada sin nueva confianza implícita.

### SDK10 — Canary, soporte y cierre

1. Paquetes firmados, checksums/SBOM, runtime version pinned y matriz de ABI; preparar guía de autor y operación al promover esta propuesta a canónica, no otro plan contradictorio.
2. Canary con las dos extensiones útiles, grants mínimos, rollback/disable demostrados ≤ 30 s para trabajos nuevos y pendientes; no prometer deshacer requests externos aceptados.
3. Verificar scope completo y esfuerzo de soporte. Si gate de demanda/factibilidad falla, registrar pendiente/revisión de alcance en índice y diseño; no ocultarlo bajo un SDK solo experimental.

**DoD:** extensiones instalables soportadas y fallos contenidos sin restart API, con ruta de mantenimiento y recuperación.

## Comandos de aceptación al implementar

```sh
cargo test --manifest-path tools/plugin-runtime/Cargo.toml
cargo clippy --manifest-path tools/plugin-runtime/Cargo.toml -- -D warnings
PYTHONPATH=app python -m pytest -q app/tests/test_plugin_api.py app/tests/test_plugin_broker.py app/tests/test_plugin_registry.py app/tests/test_plugin_tasks.py app/tests/test_plugin_adapters.py
npm run --workspace=app/ui test -- src/pages/Plugins.test.tsx
```

Los archivos nuevos y comandos que los referencian son entregables futuros; registrar también la suite completa de security/migración/grants, runner real y controles físicos de deployment. PG/Redis exclusivos de test; no instalar paquetes ni consumir credenciales productivas para validar un documento. Estado SDK01–SDK10: pendiente.
