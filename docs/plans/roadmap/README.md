# Roadmap de Crate

> **Estado (2026-11-18):** punto de entrada único del trabajo pendiente. Consolidado a partir de los planes locales y de los planes de `main`, verificados contra el código ese día.

## Cómo usar esta carpeta (agentes y personas)

1. **Qué se está haciendo y cuánto falta:** `npx @fission-ai/openspec@1.14.3 list`. Cada línea en ejecución es un change de OpenSpec en [`openspec/changes/`](../../../openspec/changes/). Su `tasks.md` es el estado real: casilla marcada = hecho con evidencia, sin marcar = pendiente o en curso.
2. **Qué es lo siguiente:** la sección [Siguiente](#siguiente). Se coge la primera tarea sin dueño de la fase activa.
3. **Qué viene después:** las fases F1–F4 enlazan a sus planes. Una línea sin change todavía no ha empezado y su progreso es 0 sobre las tareas del plan.

### Reglas

- **Al completar una tarea**, márcala en el `tasks.md` del change en el mismo PR, con la evidencia (PR, commit o ruta). No se marca nada sin evidencia en `main`.
- **Al empezar una línea** que solo tiene plan, crea su change con `/opsx:propose` y enlaza el plan en el proposal. Después cambia la línea en este README a tipo change con el enlace.
- **Antes de aplicar tareas nuevas** de un change con comportamiento, escribe sus delta specs (tarea 0.1). `openspec validate` las exige; los changes sin cambio de comportamiento declaran `skip_specs: true`.
- **Al terminar un change**, archívalo con `/opsx:archive`. Sus specs pasan a `openspec/specs/` y la línea desaparece de `openspec list`.
- Si una decisión cambia el orden o el alcance, se actualiza este README en el mismo PR.
- La seguridad se sigue fuera del repositorio hasta que esté corregida y desplegada.

### Leyenda

| Marca     | Significado                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------- |
| change    | Línea en ejecución; su progreso lo da `openspec list`                                                 |
| plan      | Línea planificada sin empezar; enlaza al plan y cuenta sus tareas                                     |
| `F0`–`F4` | Fase del roadmap; en los changes grandes cada tarea pendiente lleva su fase entre comillas invertidas |

## Ahora

| Línea                     | Tipo                                                                                         | Estado                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Federación híbrida        | change [`federation-hybrid`](../../../openspec/changes/federation-hybrid/tasks.md)           | FED0–FED1 en main; FED2+ en curso con un agente                    |
| Smart Mix: gates en curso | change [`smart-mix-continuation`](../../../openspec/changes/smart-mix-continuation/tasks.md) | Tareas `F1` en curso: SM06, SM07, A06–A08, V02, V03, V06, V09, V10 |

## Siguiente

Fase activa: **F0 — Saneamiento y cierres**. En orden:

1. Seguridad: arreglos pendientes (detalle fuera del repositorio).
2. [`lyrics-provider-off-request`](../../../openspec/changes/lyrics-provider-off-request/tasks.md): sacar LRCLIB del request.
3. [`crate-v3-completion`](../../../openspec/changes/crate-v3-completion/tasks.md), tareas `F0`: 2.2, 2.3, 2.4, 2.8 y 2.9.
4. [`connect-v1-retirement`](../../../openspec/changes/connect-v1-retirement/tasks.md): retirar Connect v1.
5. [`opensubsonic-v1-completion`](../../../openspec/changes/opensubsonic-v1-completion/tasks.md): retirar el motor legacy y `users.subsonic_token`.
6. Cierres operativos: [`admin-backups-production-cutover`](../../../openspec/changes/admin-backups-production-cutover/tasks.md), [`observability-completion`](../../../openspec/changes/observability-completion/tasks.md) (F4-ACT y OPS-ACT), [`installer-clean-vm-gate`](../../../openspec/changes/installer-clean-vm-gate/tasks.md) y [`cast-custom-receiver`](../../../openspec/changes/cast-custom-receiver/tasks.md) (11.1–11.3).
7. [`suggested-tracks-relevance`](../../../openspec/changes/suggested-tracks-relevance/tasks.md).

## Fases

| Fase | Objetivo                                                                                 | Criterio de salida                                                                              |
| ---- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F0   | Saneamiento y cierres: seguridad, reglas de rendimiento rotas y entregas casi terminadas | Todos los changes de F0 archivados y tareas `F0` marcadas                                       |
| F1   | Fiabilidad y descubrimiento                                                              | Offline resiliente, discovery con ediciones estables, inbox local y gates de Smart Mix cerrados |
| F2   | Contenido y visibilidad                                                                  | Push, karaoke, instrumentos V3 y primeras correcciones de colaboración                          |
| F3   | Multidispositivo y grupo                                                                 | Connect y coche, colaboración y feed, Jam, Smart Mix en iOS y distribución iOS                  |
| F4   | Cierre de año                                                                            | Recap anual, créditos, aceptación conjunta de Smart Mix y cierre de calidad V3                  |

### F0 — Saneamiento y cierres

| Línea                            | Tipo                                                                                                             | Alcance                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Seguridad                        | fuera del repo                                                                                                   | Arreglos pendientes; detalle privado hasta su despliegue                  |
| Letras: LRCLIB fuera del request | change [`lyrics-provider-off-request`](../../../openspec/changes/lyrics-provider-off-request/tasks.md)           | F0 del [plan de letras](../2026-11-18-lyrics-karaoke-and-credits-plan.md) |
| V3: arreglos `[MAIN]`            | change [`crate-v3-completion`](../../../openspec/changes/crate-v3-completion/tasks.md)                           | Tareas `F0`                                                               |
| Retirar Connect v1               | change [`connect-v1-retirement`](../../../openspec/changes/connect-v1-retirement/tasks.md)                       | Fases 4–5                                                                 |
| OpenSubsonic legacy              | change [`opensubsonic-v1-completion`](../../../openspec/changes/opensubsonic-v1-completion/tasks.md)             | Cut S 9–10                                                                |
| Backups en producción            | change [`admin-backups-production-cutover`](../../../openspec/changes/admin-backups-production-cutover/tasks.md) | BK6.2                                                                     |
| Observabilidad: activación       | change [`observability-completion`](../../../openspec/changes/observability-completion/tasks.md)                 | F4-ACT y OPS-ACT                                                          |
| Instalador en VM limpia          | change [`installer-clean-vm-gate`](../../../openspec/changes/installer-clean-vm-gate/tasks.md)                   | Fase 1-VM                                                                 |
| Cast receiver propio             | change [`cast-custom-receiver`](../../../openspec/changes/cast-custom-receiver/tasks.md)                         | 11.1–11.3                                                                 |
| Suggested tracks                 | change [`suggested-tracks-relevance`](../../../openspec/changes/suggested-tracks-relevance/tasks.md)             | Fases 0–5                                                                 |

### F1 — Fiabilidad y descubrimiento

| Línea                      | Tipo                                                                                                          | Alcance                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Offline y playback móvil   | plan [01](01-offline-mobile-playback-implementation-plan.md) · [diseño](01-offline-mobile-playback-design.md) | 0/9 (O01–O09)                    |
| Discovery y Release Radar  | plan [02](02-personalized-discovery-implementation-plan.md) · [diseño](02-personalized-discovery-design.md)   | 0/9 (PD01–PD09)                  |
| Inbox de notificaciones    | plan [03](03-notifications-push-implementation-plan.md) · [diseño](03-notifications-push-design.md)           | 0/5 (N01–N05)                    |
| Observabilidad: QoE nativo | change [`observability-completion`](../../../openspec/changes/observability-completion/tasks.md)              | PR2B                             |
| Smart Mix: gates y cierres | change [`smart-mix-continuation`](../../../openspec/changes/smart-mix-continuation/tasks.md)                  | Tareas `F1`                      |
| V3: contratos backend      | change [`crate-v3-completion`](../../../openspec/changes/crate-v3-completion/tasks.md)                        | Tareas `F1` (fase 2 del plan V3) |

### F2 — Contenido y visibilidad

| Línea                               | Tipo                                                                                                    | Alcance                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Push                                | plan [03](03-notifications-push-implementation-plan.md)                                                 | 0/4 (N06–N09)                                            |
| Letras y karaoke                    | plan [letras](../2026-11-18-lyrics-karaoke-and-credits-plan.md)                                         | 0/5 (PR2–PR5 y spike K5)                                 |
| Colaboración: primeras correcciones | plan [04](04-social-collaboration-implementation-plan.md) · [diseño](04-social-collaboration-design.md) | 0/3 (S01–S03). A revisar contra el modelo actual de main |
| Instrumentos V3                     | change [`crate-v3-completion`](../../../openspec/changes/crate-v3-completion/tasks.md)                  | Tareas `F2` (fases 3–5 del plan V3)                      |
| Películas de la web                 | plan [películas](../2026-10-26-crate-films.md)                                                          | 0/1 (segunda ronda de montaje y publicación)             |

### F3 — Multidispositivo y grupo

| Línea                       | Tipo                                                                                                | Alcance               |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Connect, Cast y coche       | plan [05](05-connect-automotive-implementation-plan.md) · [diseño](05-connect-automotive-design.md) | 0/9 (C01–C09)         |
| Colaboración y feed         | plan [04](04-social-collaboration-implementation-plan.md)                                           | 0/6 (S04–S09)         |
| Jam y Auto DJ               | plan [06](06-smart-mix-jam-implementation-plan.md) · [diseño](06-smart-mix-jam-design.md)           | 0/9 (J01–J09)         |
| Smart Mix en iOS            | change [`smart-mix-continuation`](../../../openspec/changes/smart-mix-continuation/tasks.md)        | Tareas `F3` (I01–I06) |
| Distribución iOS (AltStore) | plan [AltStore](../2026-10-21-crate-ios-altstore-distribution.md)                                   | 0/9 (§6.1–6.9)        |

### F4 — Cierre de año

| Línea                            | Tipo                                                                                          | Alcance                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Recap anual                      | plan [08](08-listening-recap-implementation-plan.md) · [diseño](08-listening-recap-design.md) | 0/10 (RC01–RC10); la base de Stats ya existe   |
| Créditos y ediciones             | plan [letras](../2026-11-18-lyrics-karaoke-and-credits-plan.md)                               | 0/1 (F6)                                       |
| Aceptación conjunta de Smart Mix | change [`smart-mix-continuation`](../../../openspec/changes/smart-mix-continuation/tasks.md)  | Tareas `F4` (X01–X04)                          |
| V3: cobertura y cierre           | change [`crate-v3-completion`](../../../openspec/changes/crate-v3-completion/tasks.md)        | Tareas `F4` (fases 0, 1b, 6 y 7 pendientes)    |
| Plugin SDK                       | plan [10](10-plugin-sdk-implementation-plan.md) · [diseño](10-plugin-sdk-design.md)           | 0/10 (SDK01–SDK10); solo si pasa el gate SDK01 |

### Transversal

| Línea                 | Tipo                                                                                       | Alcance                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Hallazgos de calidad  | change [`code-quality-findings`](../../../openspec/changes/code-quality-findings/tasks.md) | 17 hallazgos                                                                                          |
| Blog de ingeniería    | plan [índice editorial](../../technical/engineering-blog-roadmap.md)                       | 73 propuestas sin redactar                                                                            |
| Crate Decks (cliente) | repo externo `thecrateapp/crate-decks`                                                     | Se sigue en ese repositorio; el servidor está en main ([diseño](../2026-11-02-crate-decks-design.md)) |

### Backlog

- Observabilidad: probes externos y programa v2 ([plan de completitud](../2026-11-01-observability-metrics-completion-plan.md), [plan de implementación](../2026-10-31-observability-implementation-plan.md)).
- Smart Mix: P06, V07 y V08 (tareas `backlog` de [`smart-mix-continuation`](../../../openspec/changes/smart-mix-continuation/tasks.md)).

## Descartado el 2026-11-18

No retomar sin una decisión nueva: feeds editoriales (rama `origin/fix/suggested-albums-release-date`), marketing, remediación «Apple Design» de Listen, Crate Frequencies, fondo por instancia, backend OrpheusDL y acceso dual en desarrollo.

## Contexto

- [Índice del roadmap 2027](00-index.md): valoración, dependencias y principios comunes de las áreas 01–10.
- Planes históricos e implementados: [`docs/plans/`](..).
