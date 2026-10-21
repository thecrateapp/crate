# Mapa de conocimiento de Crate

Empieza por `get_release_context`: incluye el SHA de la release, las revisiones de cada imagen, disponibilidad del contexto y los documentos canónicos de entrada. Una release puede reutilizar imágenes construidas desde commits anteriores; distingue ambas versiones.

El índice incluye la documentación canónica de `docs/manifest.json`, los AGENTS de cada área, Compose/Makefile y fuentes de backend, readplane, worker Rust, CLI, Listen, Admin, componentes compartidos, desktop, Cast, clientes nativos Android/iOS, plugin VirtualDJ, sitio público, renderer de docs y scripts de despliegue. Los archivos provienen de Git en el SHA declarado. No contiene archivos privados de la instancia, música, bases de datos, `.env`, credenciales ni la memoria del asistente personal.

Rutas de entrada:

- Arquitectura: `docs/technical/01-system-overview.md`, `02-backend-api-and-data.md`, `03-worker-tasks-and-background-services.md`.
- Biblioteca: almacenamiento/importación/sync, enriquecimiento/adquisición y análisis en los capítulos `04`, `05` y `06`.
- Usuarios y reproducción: capítulos `07`, `08`, `09`; documentación OpenSubsonic.
- Smart Mix: `docs/technical/smart-mix-operations.md` para funcionamiento, versiones y diagnóstico; diseño/plan de continuación para trabajo futuro y gates pendientes. El MCP actual no expone cobertura/campaña dedicada.
- Agentes: `docs/technical/11-crate-mcp.md`, `crate-mcp.md`, `crate-mcp-distribution.md` y contrato JSON.
- Operación: `docs/technical/operations.md`, `ops-runbook.md`, `deployment-profiles.md`.
- Federación: overview, protocolo, threat model y runbooks en `docs/technical/federation-*`.
- Backend: `app/crate/`; autorización y contratos en `mcp/`, `agent_*.py`; SQL y transacciones en `db/`; efectos en `worker_handlers/`.
- Read plane: `app/readplane/`; snapshots, projector y outbox en backend.
- Clientes: `app/listen/src/`, `app/ui/src/`, `app/shared/`, desktop, Cast, clientes nativos Android/iOS, plugin VirtualDJ, sitio público, renderer de docs y scripts de despliegue.

Busca por conceptos o rutas con `search_crate_context`. Lee los fragmentos necesarios con `read_crate_context`, siguiendo `next_line`. Consulta después estado y evidencias actuales en el MCP de Crate: las fuentes explican el comportamiento, pero no prueban que un servicio esté sano o que una tarea haya terminado.

Para preguntas concretas, usa los propietarios canónicos y después la evidencia de la instancia:

- Crates: `docs/technical/08-frontends-admin-and-listen.md`, sección Listen Crates:
  acceso, colaboración, enlace público, descarga ZIP y seguimiento SSE/polling.
- Shows y planes compartidos: `docs/technical/11-crate-mcp.md`, sección Exact structured
  show review and publication: selección estructurada, revisión exacta, atomicidad y replay.
- Estadísticas precalculadas: `docs/technical/02-backend-api-and-data.md`, sección
  Precalculated listening statistics and snapshot fallback: placeholders, antigüedad,
  projector/outbox y fallback; un GET de dashboard puede encolar un refresco.
- Workers: `docs/technical/03-worker-tasks-and-background-services.md`, sección
  Deferral, cancellation acknowledgement and replay: colas, aplazamiento, acuse de
  cancelación y efectos inciertos.

La búsqueda actual es léxica: combina conceptos con nombres exactos de sección, símbolo o
ruta; no presupongas traducción semántica de una pregunta en español. Si no hay coincidencia,
busca la ruta canónica y lee sus páginas. El corpus reproducible
`app/tests/fixtures/hermes_context_acceptance.json`, ejecutado por
`app/tests/test_hermes_context.py`, valida recuperación y procedencia en Git aislado.
No certifica respuestas del modelo ni estado real; la conversación con el modelo sigue
siendo una comprobación final del rollout. Si falta una observación autorizada, declárala
no disponible; no sustituyas evidencia actual por una fuente histórica o una llamada que
encole trabajo.
