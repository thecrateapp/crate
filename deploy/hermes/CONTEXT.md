# Mapa de conocimiento de Crate

Empieza por `get_release_context`: incluye el SHA de la release, las revisiones de cada imagen, disponibilidad del contexto y los documentos canónicos de entrada. Una release puede reutilizar imágenes construidas desde commits anteriores; distingue ambas versiones.

El índice incluye la documentación canónica de `docs/manifest.json`, los AGENTS de cada área, Compose/Makefile y fuentes de backend, readplane, worker Rust, CLI, Listen, Admin, componentes compartidos, desktop, Cast, sitio público, renderer de docs y scripts de despliegue. Los archivos provienen de Git en el SHA declarado. No contiene archivos privados de la instancia, música, bases de datos, `.env`, credenciales ni la memoria del asistente personal.

Rutas de entrada:

- Arquitectura: `docs/technical/01-system-overview.md`, `02-backend-api-and-data.md`, `03-worker-tasks-and-background-services.md`.
- Biblioteca: almacenamiento/importación/sync, enriquecimiento/adquisición y análisis en los capítulos `04`, `05` y `06`.
- Usuarios y reproducción: capítulos `07`, `08`, `09`; documentación OpenSubsonic.
- Agentes: `docs/technical/11-crate-mcp.md`, `crate-mcp.md`, `crate-mcp-distribution.md` y contrato JSON.
- Operación: `docs/technical/operations.md`, `ops-runbook.md`, `deployment-profiles.md`.
- Federación: overview, protocolo, threat model y runbooks en `docs/technical/federation-*`.
- Backend: `app/crate/`; autorización y contratos en `mcp/`, `agent_*.py`; SQL y transacciones en `db/`; efectos en `worker_handlers/`.
- Read plane: `app/readplane/`; snapshots, projector y outbox en backend.
- Clientes: `app/listen/src/`, `app/ui/src/`, `app/shared/`, desktop, Cast, sitio público, renderer de docs y scripts de despliegue.

Busca por conceptos o rutas con `search_crate_context`. Lee los fragmentos necesarios con `read_crate_context`, siguiendo `next_line`. Consulta después estado y evidencias actuales en el MCP de Crate: las fuentes explican el comportamiento, pero no prueban que un servicio esté sano o que una tarea haya terminado.
