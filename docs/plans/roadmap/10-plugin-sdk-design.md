# Plugin SDK de Crate — Diseño 2027

> **Estado (2026-11-18):** Pendiente, a largo plazo y condicionado al gate de demanda SDK01.

**Estado:** propuesta revisada 2026-09-09, sin runtime público implementado en el baseline principal `992704b9`. **Prioridad:** P2, condicionada a validar demanda y coste operativo. [Plan](10-plugin-sdk-implementation-plan.md) · [programa 2027](00-index.md).

## Valor, alcance y decisión

El SDK puede reducir el coste de mantener integraciones de metadata, letras, scrobbling y exportación. Su coste inicial y superficie de mantenimiento son altos: un sandbox, ABI, distribución de paquetes y soporte a terceros no se amortizan por añadir un único proveedor. Mantenerlo en 2027 como objetivo con gate de inversión: dos extensiones útiles de productores diferentes y un caso que no resuelva un adapter interno pequeño. Si ese gate no pasa, queda explícitamente pendiente, no se declara SDK completo por publicar una interfaz Python.

El repositorio ya contiene scanners/fixers y adapters internos (`app/crate/scanners/base.py`, `scanners/__init__.py`, `fixers/`, `enrichment.py`, `lyrics.py`, `scrobble.py`). Son código confiable distribuido con Crate, con permisos del worker; **no son un sandbox para paquetes de terceros**. No existe en este baseline `tools/plugin-runtime` ni registry/API pública de instalación; las rutas y archivos nuevos de este diseño son propuestas.

Este SDK y el plugin VirtualDJ son productos distintos. VDJ consume APIs de Crate mediante su SDK nativo y no debe esperar a WASM ni convertirse en un plugin alojado por Crate. Smart Mix no expone su control de playback a este runtime.

### Casos incluidos

- Providers de metadata/letras con resultados tipados y procedencia.
- Scrobblers, bajo consentimiento de cada cuenta, reutilizando idempotencia existente.
- Jobs programados acotados mediante scheduler/actors existentes.
- Hooks que derivan features declaradas de DTOs de análisis autorizados.
- Exportadores de biblioteca/estadísticas: devuelven bloques validados que un worker escribe en un artefacto temporal autorizado.

No UI arbitraria, SQL, acceso directo Redis/DB/`/music`, sockets del guest, credenciales raw, sustitución de playback ni carga de módulos Python/JS nativos no confiables. `analysis.read` significa features, no acceso implícito a PCM/full files; DSP de audio bruto exigiría otro contrato y presupuesto explícitos. No se promete un runtime universal de analizadores con el ABI v1.

## Alternativas valoradas

| Alternativa                                      | Ventaja                                 | Coste/límite                               | Decisión                                                        |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Adapters internos                                | Menor coste, reutiliza workers/tests    | Solo código revisado y release conjunta    | Mantener para integraciones propias                             |
| Subprocesos arbitrarios/contenedores por paquete | Flexibilidad de lenguajes               | Superficie de aislamiento/operación grande | No API de plugins arbitrarios en v1                             |
| WASM con ABI y host calls mínimos                | Límites explícitos y artefacto portable | Toolchain, sandbox y mediación propios     | Dirección seleccionada; spike valida coste antes de generalizar |

Wasmtime es la opción inicial para un runner Rust. Extism solo se introduce si el spike demuestra que reduce código propio manteniendo las mismas fronteras; no soportar dos runtimes. El guest solo accede a imports vinculados por el host; WASI no debe recibir preopens/env/stdin/herencia de recursos indiscriminada. Esa frontera y el código del host siguen necesitando revisión y actualizaciones de seguridad. [Modelo de seguridad de Wasmtime](https://docs.wasmtime.dev/security.html).

## Ejecución y aislamiento

```text
API admin/usuario → validación y transacción de configuración/grant
Evento/tarea existente → coordinador confiable Dramatiq
  → DTO mínimo + invocation ID + grants efectivos
  → runner WASM en proceso separado
  → resultado validado → worker propietario del dominio → commit/outbox
```

Nunca compilar o ejecutar guest dentro del proceso API. El runner recibe datos y handles acotados; no DSN, credenciales Redis, mounts de música ni el entorno del worker. Proceso por invocación al principio; un pool posterior exige reset/aislamiento demostrado entre cuentas/versiones. Deployment debe demostrar aislamiento real en Linux amd64/arm64 de Crate y límites de proceso; WASM no convierte automáticamente un subprocess en una política de SO segura. Si hace falta un servicio aislado, el spike define su transporte autenticado y despliegue antes de dar por resuelto ese gate; no exponer Docker socket al worker.

Un supervisor impone wall-clock y termina la invocación bloqueada; fuel/epoch y límites de memoria protegen la ejecución guest, pero no sustituyen deadlines de host calls/red. Medir compilación, instanciación, cola, ejecución CPU y proveedores por separado. Defaults para spike: 64 MiB memoria guest, entrada/salida 1 MiB, logs 64 KiB, 2 invocaciones concurrentes por plugin/cuenta, deadline CPU local 2 s y proveedor 10 s. Ajustes requieren evidencia y límites finitos; nunca retry ilimitado. [Interrupción de ejecución](https://docs.wasmtime.dev/examples-interrupting-wasm.html), [límites de memoria](https://docs.wasmtime.dev/api/wasmtime/struct.StoreLimitsBuilder.html).

## Manifest, ABI y broker

`plugin.toml` declara identidad, SemVer paquete, versión ABI, entrypoint, hashes de todos los contenidos, capabilities solicitadas, schemas de input/output/config, límites y licencia/SBOM. ABI y versión de Crate son independientes. No aceptar ejecutables nativos/precompilados como si fueran WASM verificado.

ABI v1 conceptual: `invoke(operation, input, context) → result|typed_error`, cancelación por invocation ID y logs estructurados. Contexto identifica plugin/version/hash, actor/grant revision, operación, input revision y deadline. El host valida tamaños, tipos, identidad de destino y permisos **antes y después** del guest. Un resultado exitoso no autoriza por sí mismo una mutación de negocio.

| Capability                      | Límite efectivo                                                                |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `metadata.read` / `lyrics.read` | DTOs de entidades/operaciones concretas autorizadas, sin enumeración libre     |
| `analysis.read`                 | Features declaradas de revisión conocida; sin PCM ni rutas implícitas          |
| `scrobble.emit`                 | Evento propio consentido hacia un proveedor configurado                        |
| `export.write`                  | Emitir bloques a un artefacto gestionado por worker; no path elegido por guest |
| `jobs.schedule`                 | Tipo permitido/cuota/intervalo del scheduler existente, sin recursión infinita |
| `network.provider:<id>`         | Operación HTTP declarada al broker, no URL libre ni socket                     |

Los secrets permanecen en el broker confiable: el guest solicita una operación con handle, no un método que devuelve el token. Para egress validar destino/puerto/método, DNS/IP, redirects y cada hop, tamaño/timeout y respuesta redactada. El acceso a redes internas o proveedores locales solo se concede explícitamente por nodo/operación; no hereda localhost, metadata de cloud o IP privada de una URL arbitraria. Las cuotas incluyen llamadas indirectas del broker.

Los permisos técnicos no amplían los derechos editoriales del [workstream 07](../2026-11-18-lyrics-karaoke-and-credits-plan.md). Licencia/procedencia declarada por el guest es una afirmación a validar por el host. Comprobar uso permitido, expiración y retirada antes de entregar texto al guest, de egress/export/federación y de aplicar el resultado. `lyrics.read`, `export.write` o `network.provider` no permiten exportar letras autorizadas solo para visualización. El fallback builtin respeta la misma política y nunca recupera una versión retirada.

Grants de nodo los concede Admin; grants de historial/cuenta requieren consentimiento del usuario afectado. Admin instalar no implica acceso universal a historial. Revocar grant/disable invalida nuevas invocaciones y descarta resultados pendientes no publicados de esa revisión; no se pueden retirar peticiones externas ya aceptadas. Config guarda referencias a secretos y schema version, no secretos en logs o exports.

## Paquetes, persistencia y publicación

Firma/hash acreditan procedencia/integridad, no inocuidad. Trust roots del operador, rotación/revocación y permiso explícito de instalación local; firma sobre manifest canónico y hashes, protección frente a zip-slip/symlinks/bombas. Tamaños de archivo/descompresión/compilación acotados. Instalar prepara una versión inactiva; activar hace switch atómico del puntero tras verificar config/ABI/grants. El rollback conserva grants revisados y config compatible; no ejecuta código de migración arbitrario ni repone permisos revocados.

Reutilizar tasks para runs/retries y el outbox de dominio para resultados. Persistir solo entidades faltantes: instalaciones/versiones/config y grants con ownership/constraints; no crear seis tablas genéricas de runs/events duplicando infraestructura sin necesidad. Artefactos viven en almacenamiento de paquetes/exports gestionado por workers, separado de `/music`; API solo valida/enfila esos writes de filesystem. CRUD transaccional de configuración sí puede ejecutarse en API.

Cada resultado lleva plugin/version/hash, invocation ID, entity/input revision y licencia/procedencia. El worker propietario aplica validación de dominio y dedup antes de commit. At-least-once no significa scrobble externo exactamente una vez: usar idempotencia del destino si existe, o spool/dedup local y política de respuesta ambigua sin reintento ciego.

## Superficie de administración propuesta

`/api/admin/plugins` lista; `POST /install` inicia tarea; `POST /{id}/enable`, `/disable`, `/rollback` y `PUT /{id}/config` hacen operaciones autorizadas e idempotentes; health expone errores saneados. Los paths son contrato objetivo pendiente de SDK02. UI muestra procedencia, permisos/datos, ABI, estado/versiones, límites y health; grants personales se gestionan en Listen sin forzar al usuario normal a Admin.

Install/config/grants no necesitan readplane antes de demostrar un problema de lectura; datos son pequeños y sensibles. Publicar estado operativo en superficies Admin existentes, sin imponer snapshots/Go/backfill global a un registry vacío.

## Federación y calidad de servicio

Un nodo nunca instala ni ejecuta plugins recibidos de un peer. Resultados que ya son metadata publicable pasan por la proyección y política de federación del dominio, con procedencia acotada; no un canal nuevo de eventos arbitrarios ni un protocolo que obligue al receptor a comprender ABI del guest. Datos personales/scrobbles/secret handles no se federan. Los hooks SDK dependen del dominio que tocan, no de completar todos los workstreams 02/06/07.

Gates: cero violaciones observadas en la matriz negativa/fuzz definida; trap/timeout/OOM no caen en API/otros plugins; p95 overhead caliente local<200 ms con 1 MiB máximo y 1000 invocaciones sobre hardware declarado; cold start/compile y latencia externa se reportan aparte. Error arbitrario del plugin puede ser 100% sin error de playback/API; el objetivo antiguo “plugin error ≤ 1%” no mide aislamiento. Disable/config actualizado impide nuevos jobs y aplica a pendientes; rollback administrativo ≤ 30 s, sin prometer revertir efectos ya enviados a proveedores.

El cierre requiere todos los hooks anunciados, plugins de referencia reales, firma/revocación, aislamiento Linux de ambas arquitecturas, CI y recuperación operativa. El gate de demanda define si invertir en 2027; si no pasa, el índice registra SDK pendiente sin confundirlo con “terminado”.
