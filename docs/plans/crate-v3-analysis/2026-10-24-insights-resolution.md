# Insights: implementación de colección frente a escucha

Implementado el enfoque aprobado en `2026-10-24-insights-reanalysis.md`. El explorador sonoro
queda para una fase posterior. Disponible en el stack local de `feat/crate_v3`, Admin en 5175.

## Resultado

- Cabecera canónica, periodos de 30/90/365 días, fechas, historial disponible y frescura legible.
- Banda abierta de horas registradas, alcance de pistas, álbumes con escucha y concentración
  temporal en los diez artistas principales.
- Comparación de presencia indexada y cuota de reproducciones por género canónico o década;
  atribución fraccionada expresa, Unknown aparte y lectura persistente con álbumes/enlaces.
- Pulso temporal actual y anterior, selección por puntero/touch/flechas y lectura del día.
- Artistas cuya escucha sube/baja, con imagen y magnitudes actuales/anteriores.
- Álbumes sin escucha registrada, redescubrimiento tras 90 días y prioridades Full/Bliss vinculadas
  a pistas realmente escuchadas. No se infiere escucha completa ni archivos reproducibles.
- Snapshot de worker y endpoint cache-only; Discovery conserva su contrato anterior.

## Datos y arquitectura

`GET /api/admin/collection-insights?window=30d` requiere `library.view`. Sirve el snapshot
`admin:collection-insights`, key `v1:{window}`, con frescura de 300 s. Los estados ausente y obsoleto,
así como la actualización explícita, programan una
tarea deduplicada; las solicitudes no agregan catálogo ni reconstruyen el informe.

`refresh_collection_insights` está registrada en maintenance, DB-heavy y Resource Governor.
El projector agrupa cambios de catálogo, escucha, taxonomía, análisis y Bliss. El builder
ejecuta una consulta compuesta dentro de una lectura/transacción, resuelve UID/ID/path sin
fusionar por nombres y produce listas/muestras acotadas. No hay migraciones ni dependencias nuevas.

El informe distingue población indexada elegible y eventos excluidos/remotos/no resueltos.
Los dos periodos usan inventario actual como denominador. Una base anterior insuficiente no
genera variaciones; un backfill conocido incompleto tampoco permite afirmar álbumes sin escucha.
Las horas son registradas: combinan mediciones y estimaciones de scrobble según la fuente.

Datos locales comprobados para 30 días:

| Lectura                                | Valor                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| Catálogo indexado elegible             | 136.462 pistas / 10.814 álbumes                        |
| Escucha vinculada                      | 1.386 eventos / 3.464,6 min / 948 pistas / 349 álbumes |
| Eventos excluidos                      | 42 eventos / 157,3 min                                 |
| Concentración temporal Top 10          | 43,34%                                                 |
| Pistas escuchadas sin Full vigente     | 594 pistas / 2.141,4 min                               |
| Pistas escuchadas sin Bliss almacenado | 0                                                      |

## Decisiones tomadas durante la ejecución

- Se trabajó en paralelo con propiedad de archivos y contrato explícitos. El coste de un
  desacuerdo habría sido integración adicional; el informe tuvo revisión independiente completa.
- La petición de implementación aprobó el diseño enlazado; no se introdujo otra aprobación.
- Se preservó el trabajo en este worktree, sin commit/push nuevos: la petición Git anterior ya
  había terminado. El resultado sigue disponible para revisión antes de publicarlo.
- La disponibilidad Full usa el contrato existente `smart_mix.available===true`; desconocido
  no se presenta como habilitado.
- Se añadió `snapshot.task_id`: la UI sigue una tarea finita con el mecanismo SSE existente
  y obtiene una vez el resultado. No consulta Insights periódicamente. Cambiar periodo cancela
  la espera local, no el trabajo; visitar otra vez un periodo no recupera un estado manual antiguo.
- Se añadió `period.history_complete`, separado de `previous_complete`, para no transformar
  proyecciones incompletas en afirmaciones sobre álbumes sin escucha. Cuesta un campo de contrato.
- La escala porcentual es común a todas las filas y tiene máximo explícito adaptado a los valores
  visibles, con `nice:false`; por ejemplo, 12,5% produce un extremo del 15%. Los porcentajes
  absolutos permanecen iguales. Esto evita la compresión visual de usar siempre 100%.
- Las categorías usan un viewport de scroll de 20rem en móvil y 32rem en escritorio, con SVG y targets juntos
  y escala fuera. La lectura permanece próxima. El hint indica categorías mostradas, no pretende
  representar como completo un resultado limitado a 24 categorías más Unknown.
- El governor local aplazaba tareas por swap >30%, aunque había RAM disponible. No se modificaron
  sus umbrales: los tres informes se ejecutaron secuencialmente a través de sus handlers dentro
  del maintenance worker, reclamando y completando sus tareas. Futuras actualizaciones pueden
  esperar al governor; el informe conserva los datos y ofrece recuperación sin inventar ceros.

## Validación

- 14 pruebas PostgreSQL del builder, incluidas identidad, facetas, reparto, histórico, Full/Bliss,
  límites, valores no finitos y concentraciones.
- 139 pruebas backend integradas: builder, superficie, API/OpenAPI, permisos, routing, projector
  y límites de acceso DB/runtime. Todas verdes.
- Suite completa de Admin: 209 suites y 2.150 pruebas pasan sobre el código final (235,22 s).
- 33 pruebas finales específicas de Insights, además de consumidores Discovery comprobados.
- TypeScript, ESLint y producción Vite verdes. Se conserva la advertencia anterior de chunks
  compartidos >500 kB; el bundle de Insights es pequeño.
- Playwright 3/3 en 1440, 390 y 320 px: 4/2 columnas, selección de filas incluida la 25, scroll acotado,
  lectura persistente, teclado temporal, rutas reales, sin overflow ni tooltips nativos en main.
- Revisión independiente inicial y de las correcciones finalizada sin findings abiertos.
- Inspección visual con datos reales en el navegador local y capturas automatizadas de móvil.

Prueba visual real: `/tmp/crate-insights-actual-oct24.png`.
Pruebas responsive: `/tmp/crate-insights-{1440,390,320}-oct24.png`.

No se accedió a producción, no se modificó Genres y no se añadieron componentes base compartidos.
