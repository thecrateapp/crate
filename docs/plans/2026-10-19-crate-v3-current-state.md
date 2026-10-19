# Crate V3 — estado vigente

Actualizado: 2026-10-19. Esta tabla es el punto de entrada para continuar el trabajo. Los
registros cronológicos de los otros planes conservan el estado que tenían en su fecha;
sus stops locales anteriores quedan superados por las aprobaciones y publicaciones posteriores.

| Concepto                | Estado vigente                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace               | `/home/diego/.codex/worktrees/crate-v3-1q/crate`; rama `feat/crate_v3`                                                                                                          |
| Publicado               | Hasta 1AO, `ba63836d2a23bb774832c1703eab4e4116e1468f`; conserva el ancestro `53177736`                                                                                          |
| Checkpoint local        | **1AP aprobado**, publicación autorizada por Diego. Incluye System Playlists, las enmiendas de filas y operadores, y la reconciliación autorizada de la auditoría              |
| Auditoría               | A1 contraste, A2/A3 tipografía, A4 chips, A7 copy, A6 guardas y A8 estados documentales corregidos localmente. A5 conserva su deuda explícita por fase, según el orden aprobado |
| Preview                 | `http://127.0.0.1:5186/`, `crate-v3-preview.service`; página real de playlists y enlaces de revisión en `/#playlists-admin`                                                     |
| Próximo grupo de iconos | PlaylistEditor / 1AQ después de publicar 1AP; detenerse para revisión antes de su commit                                                                                       |
| Identidad y referencia  | Una identidad; `app/web@258bbaee`; fuentes y excepciones nativas vigentes                                                                                                       |
| Evidencia canónica      | 33 PNG y manifest de 1M; comparación Linux posterior y QA nativa pendientes                                                                                                     |
| Cierre pendiente        | Global 1b.8, migraciones de página/A20/6.8, validación completa de fase, datos vivos, AT y plataformas nativas                                                                  |
| Restricción             | 1AP aprobado para commit/push; 1AQ debe parar antes de publicación; sin PR, merge, rebase, deploy ni release                                                                                               |

## A5 — adopción pendiente con dueño y criterio de cierre

No se considera que la migración de iconos haya completado el restyle de cada página. La
reconciliación autorizada asigna esta deuda a sus fases, sin rediseñar ahora todos los paneles.

| Residuo                                                                           | Dueño                                                | Fase                                    | Criterio de cierre                                                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OpsPageHero`, `OpsStatTile`, `OpsPanel`: transparencias de panel, sombras y blur | Mantenedor de Admin UI y design system               | 3.1; adopción por 3.3, 3.5b, 3.6 y 3.9b | Receta compartida de superficie sólida; retirar los tokens heredados registrados y verificar cada consumidor                        |
| Paneles de Bandcamp, Upcoming y ShowCard                                          | Mantenedor de páginas de catálogo de Admin           | 6.5                                     | Mismos tokens sólidos, sin skins locales; conservar acciones, contenido y glifos UX                                                 |
| Paneles de Users y Roles                                                          | Mantenedor de acceso de Admin                        | 6.6                                     | Adoptar la superficie compartida preservando lista, modal ancho, avatares y capacidades reales                                      |
| Playlists, editor y Translations                                                  | Mantenedor de curación/i18n de Admin                 | 6.8 / A20–A21                           | Eliminar paneles heredados y completar estados/tabs por página; conservar reglas, payloads y edición                                |
| Otras utilidades de color y estructuras anteriores en el inventario de Admin      | Dueño de cada página, con revisión del design system | 3.x o 6.x de la página correspondiente  | Clasificar por rol antes de migrar. No confundir tokens semánticos válidos con desviaciones; cerrar mediante pruebas del consumidor |
| Adaptadores que reexportan Select/Popover/skeleton                                | Mantenedor de fundamentos compartidos y Admin        | 3.1 y migraciones de consumidores       | Retirar nombres de compatibilidad cuando no tengan consumidores, sin crear una implementación duplicada                             |

El [registro ejecutable de adopción](../../scripts/design-system/admin-adoption-debt.json)
enumera los archivos y las ocurrencias exactas de las superficies confirmadas, con dueño,
motivo y fase. La guarda rechaza tokens nuevos o más ocurrencias de los existentes. Los
presupuestos anteriores de Listen/shared no se han aumentado. Los 528 candidatos léxicos del
inventario original no son 528 errores ni una autorización para conservar cualquier clase nueva.

## Límites que permanecen abiertos

Los menores anteriores de sticky header de Users y asociación de label visible del Select
compartido siguen registrados para sus consumidores. La presentación de error de lectura de
Playlists y garantías de concurrencia no se han rediseñado. Las muestras y pruebas focalizadas
no certifican backend vivo, imágenes autenticadas, AT, zoom, otros motores o runtime nativo.

La [auditoría con disposiciones](2026-10-19-crate-v3-plan-audit.md) y el
[handover final](2026-10-15-crate-v3-handover.md) contienen evidencia y límites. Se conservan
los checkpoints y registros históricos completos.
