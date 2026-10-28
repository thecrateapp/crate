# Stack: revisión y normalización visual

Revisión solicitada tras publicar Insights en `feat/crate_v3` (`219d56ac`). Referencias:
`app/ui/ADMIN_UI_REVIEW_CHECKLIST.md`, acciones compartidas usadas en Tasks y primitivas
`ActionGroup`, `ActionButton`, `StatNumber`, `MonoLabel`, `InfoBadge` e `InstrumentPanel`.

## Hallazgos y correcciones

| Severidad | Desviación                                                                             | Resolución                                                                                     |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P2        | Logs, Start/Stop, Restart y Open service usaban botones outline con texto              | Acciones ghost icononly de 44 px, Solar, tooltip compartido y nombre accesible con el servicio |
| P2        | Tres cajas de metadatos dentro de cada card y otra superficie para logs                | Bloques abiertos, separación fina y una lectura de logs acotada                                |
| P2        | Imagen, puertos y estado técnico usaban Roboto medio y podían ensanchar la tarjeta     | Valores mono de peso normal, `min-w-0`, ajuste de palabras y labels semánticos `dt/dd`         |
| P2        | El timestamp del log se mostraba en una columna y otra vez en su línea original        | Texto original en `pre`, preservando saltos de línea y mensajes repetidos sin añadir otra hora |
| P3        | Puntos de estado manuales mezclaban colores accent/warning con los tonos de los badges | `InfoBadge` conserva la palabra y el tono semántico, sin punto redundante                      |
| P3        | Cuatro tiles repetían las cifras de las pills de cabecera                              | Banda abierta con `StatNumber`, tres lecturas globales y contador filtrado junto a Services    |
| P3        | Filtros y servicios tenían secciones y descripciones que explicaban el propio layout   | Un solo panel Services con búsqueda, filtro de estado y resultados                             |

La revisión independiente del diff no deja hallazgos accionables abiertos. No se implementa el
futuro StackMap ni se cambia el contrato de API, SSE, permisos o gestión de contenedores.

## Comportamiento conservado

- Mismos destinos y callbacks de Logs, Start/Stop, Restart y Open service.
- Confirmación de reinicio con texto, cancelación y restauración del foco.
- Botón nativo estable durante la carga; controles deshabilitados consultables por tooltip.
- Filtros y actualizaciones SSE; descarte de respuestas de logs que llegan tarde.
- Estados de carga, error, reintento, logs vacíos y Docker no disponible diferenciados.
- Sin tooltips nativos ni cambios a componentes base compartidos.

## Validación

- 15 pruebas de Stack pasan; las nuevas expectativas fallaron antes de la implementación.
- 34 pruebas de política de iconos pasan; los sitios revisados usan el catálogo Solar.
- TypeScript y ESLint de los archivos modificados pasan.
- Compilación de producción correcta; se conserva la advertencia previa del chunk compartido >500 kB.
- Navegador: 4/4 pruebas pasan a 1440, 768, 390 y 320 px, incluidos metadatos largos, foco,
  tooltips asociados, targets de 44 px, callbacks simulados y ausencia de overflow y errores de consola.
- Suite completa de Admin: 209 suites y 2.155 pruebas pasan (258,79 s). La primera ejecución
  se interrumpió con SIGTERM antes de emitir resultado; la repetición aislada terminó con código 0.
- Inspección manual del Admin local con datos reales y apertura de logs, sin reiniciar ni parar servicios.

La prueba de navegador usa respuestas locales para los callbacks de control. Los nombres de
servicio, tags de imagen y puertos largos se comprueban también en anchuras pequeñas.

Prueba visual con datos locales: `/tmp/crate-stack-normalized-oct24.png`.
