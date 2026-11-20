# Crate 2027 — Roadmap revisado

> **Estado (2026-11-18):** Roadmap pendiente; verificado contra main el 2026-11-18, ninguna área está implementada salvo la entrega A de 08 (Stats). El área 07 se consolidó en [docs/plans/2026-11-18-lyrics-karaoke-and-credits-plan.md](../2026-11-18-lyrics-karaoke-and-credits-plan.md).

> **Estado:** propuesta de producto y continuación técnica, revisada 2026-09-09. **Baseline:** worktree principal `codex/listen-design-system`, HEAD `992704b9`, más WIP identificado explícitamente de otras ramas. Revisión documental; no certificación de producción.

## Valoración del programa

La selección cubre necesidades útiles: escuchar sin fallos, encontrar música, recibir novedades y usar Crate con otras personas/dispositivos. La mejora principal de esta revisión es partir de lo ya construido. Muchos planes anteriores describían como nuevos mirror offline, discovery, Connect, lyrics sincronizadas, colas Jam y snapshots de Stats que ya existen en el checkout. El trabajo 2027 es completar semántica, integración, UX, calidad y operación; no volver a crear esas bases.

El conjunto sigue siendo ambicioso. No hay capacidad/equipo asignados ni mediciones de adopción que permitan prometer nueve workstreams completos en doce meses. Prioridades y trimestres son una propuesta de secuenciación, no estimaciones de entrega. Se conserva el alcance de cada iniciativa; los hitos pequeños permiten entregar valor antes, sin marcar como completa una feature con gates o plataformas pendientes.

## Documentos y valoración comparativa

Valor/coste son juicios cualitativos sobre este código, no ROI medido. **M:** varias entregas acotadas; **L:** varias capas y clientes; **XL:** además nuevas fronteras/runtime o validación física/externa. No equivalen a semanas.

| ID  | Workstream / documentos                                                                                                              | Valor esperado                                                       | Coste restante / riesgo                                       | Prioridad y primera entrega útil                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 01  | Offline y playback mobile: [diseño](01-offline-mobile-playback-design.md), [plan](01-offline-mobile-playback-implementation-plan.md) | Muy alto: fiabilidad diaria y confianza                              | L; disco/OS/auth/background en varias plataformas             | P0: integridad y recuperación sobre mirror existente                            |
| 02  | Discovery: [diseño](02-personalized-discovery-design.md), [plan](02-personalized-discovery-implementation-plan.md)                   | Muy alto: uso recurrente del catálogo propio                         | L; calidad, datos escasos y generaciones/coste de refresh     | P0: consistencia de discovery actual; P1: nuevas ediciones y productos          |
| 03  | Inbox y push: [diseño](03-notifications-push-design.md), [plan](03-notifications-push-implementation-plan.md)                        | Alto si avisa de novedades útiles; spam destruye valor               | M inbox / L push nativo; identidad de apps/proveedores        | P0 inbox/digest; P1 push con gate de distribución                               |
| 04  | Social y colaboración: [diseño](04-social-collaboration-design.md), [plan](04-social-collaboration-implementation-plan.md)           | Alto en instancias con grupos; incierto en uso individual            | L; permisos, privacidad, conflictos y fanout                  | P1: colaboración fiable; feed después de privacidad/eventos                     |
| 05  | Connect, Cast y automóvil: [diseño](05-connect-automotive-design.md), [plan](05-connect-automotive-implementation-plan.md)           | Alto: continuidad entre dispositivos y uso en coche                  | XL conjunto; ownership, recepción de media, SDKs/entitlements | P1: Connect existente endurecido y Android Auto; Cast/CarPlay con gates propios |
| 06  | Jam/Auto DJ sobre Smart Mix: [diseño](06-smart-mix-jam-design.md), [plan](06-smart-mix-jam-implementation-plan.md)                   | Alto como diferenciación para grupos                                 | XL; sync, cola autoritativa y hardware                        | P1: sala coordinada fiable; modo acústico estricto certificado aparte           |
| 07  | Lyrics, créditos y editorial: [plan consolidado](../2026-11-18-lyrics-karaoke-and-credits-plan.md)                | Alto y visible; letras ya ofrecen base útil                          | M/L; identidad de grabación y derechos/procedencia            | P1: robustecer lyrics actuales y créditos con procedencia                       |
| 08  | Stats/recap: [diseño](08-listening-recap-design.md), [plan](08-listening-recap-implementation-plan.md)                               | Alto con historial fiable; compartible sin exponer actividad privada | M/L; calidad de eventos, refresh y publicación revocable      | P1: Stats correctos y recap anual determinista                                  |
| 10  | SDK plugins: [diseño](10-plugin-sdk-design.md), [plan](10-plugin-sdk-implementation-plan.md)                                         | Potencial alto para terceros; demanda aún no acreditada              | XL; sandbox, ABI y soporte continuo                           | P2: gate de dos extensiones útiles antes del runtime general                    |

El ID 09 (membership/donations) continúa fuera de esta tanda; no hay enlace ni plan ficticio para rellenar la numeración. El plugin VirtualDJ pertenece a Smart Mix, no al SDK general 10.

## Qué cambió al revisar

1. **Planes de continuación:** se distinguen capacidades presentes, pendientes y WIP en otras ramas. Existencia de archivos/tests no acredita comportamiento en producción.
2. **Smart Mix sin duplicación:** 06 ya no crea otra migración de perfiles, analyzer, planner, decks Android o VDJ. Continúa rooms/Auto DJ/sync e integración de sus contratos.
3. **Dependencias por contrato:** recap no espera Social/Push/Lyrics; discovery no espera transiciones Smart Mix; inbox puede consumir eventos actuales; Jam no requiere terminar Connect/colaboración; VDJ no espera SDK 10.
4. **Semántica verificable:** retries/idempotencia sustituyen promesas de exactly-once de efectos físicos/externos; disco y playback ready no son hechos garantizados por PostgreSQL; estado stale y cobertura incompleta son visibles.
5. **Gates externos explícitos:** background/PWA, FCM/APNs, CarPlay/Cast, licencias de lyrics y sandbox no se dan por resueltos solo con código o una firma.
6. **Correcciones arquitectónicas:** writes CRUD pequeños pueden vivir en API transaccional; filesystem/DSP/fanout en workers; migraciones vía Alembic de despliegue. No se impone Go/snapshot/backfill a todas las rutas.

## Fuentes de Smart Mix

Para terminar Smart Mix + crossfade Android nativo + VirtualDJ, las únicas guías vigentes son:

- [Diseño unificado](../../technical/smart-mix-design.md).
- [Plan de continuación](../../technical/smart-mix-implementation-plan.md).

Su rama es `codex/feat-smart-mix-phase-1`, HEAD observado `140f9e34` con cambios sin commit. Los paths de destino tras integrar son `docs/technical/smart-mix-design.md` y `docs/technical/smart-mix-implementation-plan.md`; hoy no se copian al principal para crear dos fuentes divergentes. Actualizar **estos dos enlaces** al integrar/mover el worktree. Ninguna tarea de 2027 asume que el WIP esté ya en main o desplegado.

El roadmap 06 es la propuesta futura de Jam sobre esa base, no un plan alternativo para Smart Mix. El SDK 10 no aloja VirtualDJ. Las guías anteriores de julio/agosto y el viejo diagnóstico de Jam son fuentes históricas; no se usan sus rutas/checkboxes para dar trabajo por hecho ni sus flags para activar producto.

## Dependencias reales y trabajo paralelo

| Consumidor      | Depende realmente de                                                        | Integración opcional / no bloqueante                                 |
| --------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 01 Offline      | Identidad/media/auth/permisos y engines existentes                          | Discovery, SmartMix o Connect no necesarios para play offline básico |
| 02 Discovery    | Playevents/preferencias/catálogo y Home/mixes existentes                    | SmartMix transiciones, Push y Social                                 |
| 03 Inbox        | Auth/recipient ownership + outbox/eventos ya disponibles                    | Eventos nuevos 02/04/07 se incorporan cuando existan                 |
| 04 Collab/feed  | Playlists/membresía, revisión/privacidad, eventos                           | Inbox distribuye avisos; Jam mantiene su propio agregado             |
| 05 Connect/auto | Contrato de sesión/comandos y readiness/player local; parte relevante de 01 | No esperar todo offline ni VDJ; cada receiver tiene su propio gate   |
| 06 Jam          | Rooms/cola/auth/sync; SmartMix core solo para su integración musical        | 04/05/Push no prerequisitos; VDJ se desarrolla aparte                |
| 07 Editorial    | Identidad/provider/cache/worker actuales y política de procedencia          | SDK 10 no necesario; créditos no exigen feed                         |
| 08 Recap        | Playevents, zona horaria/calidad y Stats/rollups actuales                   | 02/03/04/07 enriquecen/presentan, no bloquean generación             |
| 10 SDK          | Dos casos útiles + interfaces estables de dominios que extiende             | No depende de acabar todos 02/06/07 ni recibe control playback       |

Propuesta de WIP: dos líneas principales de producto a la vez y una de mantenimiento/gates, ajustadas a capacidad real. Un checkpoint de contrato/backend verificado desbloquea el cliente; el test integrado cierra después ambos. No crear ciclos “backend no termina hasta probar el cliente, cliente no empieza hasta backend completo”.

## Secuencia orientativa 2027

| Ventana           | Foco recomendado                                                              | Condición de salida / trabajo paralelo                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Antes / inicio Q1 | Inventario de ramas, adopción real Smart Mix y contratos de eventos/identidad | Resolver divergencias y heads Alembic; no presupuestar dos veces trabajo WIP                                                                |
| Q1                | 01 fiabilidad y 02 generaciones/calidad; comenzar inbox 03                    | Instrumentar calidad/retención de playevents para 08 desde el inicio del año; spike de push/CarPlay/derechos para descubrir bloqueos pronto |
| Q2                | Completar 02/03 según plataformas, 07 editorial y primeras correcciones 04    | Usar resultados reales de beta; no bloquear lyrics existentes al SDK                                                                        |
| Q3                | 05 receivers/automóvil, 04 colaboración/feed y 06 sala coordinada             | Matriz física/roles/sync; SmartMix adaptive/VDJ siguen su propio plan                                                                       |
| Q4                | 08 recap anual, cierre de gates pendientes 05/06 y eventual SDK 10            | SDK solo si demanda/factibilidad/capacidad confirmadas; preparar recap antes de diciembre, sin inventar historial faltante                  |

Estas ventanas permiten adelantar trabajo independiente; no requieren esperar al trimestre indicado para corregir un bug o probar un entitlement. Antes de asumir un compromiso anual, convertir tareas pendientes en estimación por responsable/plataforma y reservar capacidad de integración/operación. Ningún gate fallido se oculta quitando una plataforma o poniendo su flag en false.

## Principios y verificación comunes

- **Fuente real:** revisar código, imports/callers y configuración del checkout que se va a modificar; otro worktree puede contener trabajo ya integrado o aún independiente. HEAD/dependencias se vuelven a comprobar al empezar.
- **Persistencia:** Alembic es autoritativo; siguiente revisión libre tras reconciliar ramas. Principal contiene revisiones posteriores a las 090/091 del WIP Smart Mix: números de roadmap no reservan IDs. No reescribir migraciones aplicadas ni backfills completos para cambios que no lo necesitan.
- **Lecturas:** FastAPI correcto primero; snapshots y Go cuando exista ruta caliente o paridad necesaria. Lecturas privadas incluyen identidad/visibility/revisión en caché. Readiness y permisos no se infieren de un snapshot antiguo.
- **Escrituras:** CRUD y outbox en transacción corta; grandes fanouts, filesystem, análisis, descargas y entrega push mediante workers existentes. No trabajo nuevo en `orchestrator.py`.
- **Reintentos:** IDs estables y conflictos/ACK claros. Backend exactly-once en efecto persistido mediante dedup cuando corresponda; ninguna garantía universal sobre hardware/proveedores externos.
- **Datos:** identidad/revisión/procedencia, scopes y consentimiento; privacy/tombstones/revocación invalidan proyecciones. No federar secretos, historial crudo o permisos implícitos.
- **Medición:** cada objetivo dice entorno/dataset/concurrencia/warmup/N y qué percentil mide. Un 0 fallos en 10 casos no prueba tasa<0.5%; un test mock no certifica una plataforma física.
- **Pruebas:** RED→GREEN→refactor por cambio funcional; suites reales de DB/Redis/cliente/runner/hardware según la tarea. Servicios efímeros exclusivos, sin `.env` productivo ni volúmenes de usuarios. Registrar skips como pendientes.
- **Rollout:** flags por capacidad/plataforma, observabilidad acotada, recuperación sin pérdida de datos y rollback de binarios compatibles. Kill switch UI no sustituye al servidor.

## Autoridad documental y cierre

Estos 19 documentos son **propuestas locales de roadmap**, actualmente ignoradas por Git; no se han staged ni añadido al manifiesto canónico. Revisarlas no autoriza implementación/deploy ni afirma que las tareas estén terminadas. Al iniciar cada feature se valida su diseño y se promueve una fuente canónica única con su plan, actualizando este índice; no se ejecutan simultáneamente dos planes rivales. Smart Mix ya tiene esas fuentes en su worktree y se conserva su autoridad.

Una iniciativa se considera terminada cuando su alcance anunciado tiene contratos/migraciones consistentes, tests y evidencia integrada, plataformas/gates declarados, rollback/operación, privacidad y documentación canónica actualizada. No todos los workstreams necesitan un backfill, un dashboard nuevo, un protocolo federado o ruta Go. Los incrementos parciales se etiquetan como tales.

### Registro de esta revisión

- Baselines de los 19 archivos preservados antes de editar; revisión distribuida por dominios con integración final de dependencias.
- Corregidos duplicados de implementación, rutas/migraciones propuestas como existentes y varios SLOs sin semántica de medición.
- Validación de enlaces Markdown y estructura de pares; formato Markdown y cambio restringido a esta carpeta. No se han ejecutado los tests funcionales ni gates físicos descritos en los planes durante esta revisión.
- Estado de todos los hitos nuevos: propuestos/pendientes. Las mediciones y fechas de entrega se incorporarán al comenzar cada workstream.
