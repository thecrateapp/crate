# Crate V3 — auditoría de desviaciones al cerrar 1AP

Fecha: 2026-10-19. Auditoría inicial conservada; correcciones A1–A4/A6–A8 autorizadas e implementadas localmente en 1AP.
Estado vigente: [tabla única de continuación](2026-10-19-crate-v3-current-state.md).
Base publicada: `ba63836d2a23bb774832c1703eab4e4116e1468f` (1AO).
1AP permanece local, sin commit, pendiente de revisión de Diego.

## Resultado

Sí hay desviaciones verificables. Se concentran en el uso de tipografías, la geometría de
etiquetas y estilos heredados que las migraciones de iconos han conservado. Hay además un
problema concreto de contraste, una carencia en los controles automáticos de Admin y referencias
documentales obsoletas. No hay evidencia en el alcance revisado de una segunda identidad,
cambios del pin visual, integración de Smart Mix o alteraciones generales de los contratos de datos.

La retirada de iconos no equivale a haber completado la migración visual de cada página. Algunas
desviaciones son residuos de adopción pendientes; otras incumplen reglas ya aplicables a los
controles compartidos. Los cambios de producto aprobados expresamente no se consideran drift.

## Alcance y método

Se contrastaron implementation plan, decision register, design system, product design y los
handover finales; los registros finales prevalecen sobre los stops históricos. También se
revisaron los contratos y las excepciones aprobadas desde 1N hasta el 1AP local.

- Inventario estático de los 26 archivos completos cubiertos por la política de iconos de Admin,
  las bases compartidas, adaptadores, recetas de filas y límites entre Admin, Listen y Desktop.
- 18 entradas de preview, más User Detail y el editor de Translations, a 1440 y 390 px:
  **40 observaciones** en Chromium, con un worker y datos ficticios con forma de respuesta real.
- Familias y pesos computados, geometría de chips, contraste del contador seleccionado, campos,
  nombres de controles nativos y desbordamiento horizontal. Se excluyó el contenido de disclosures
  cerrados de las mediciones visibles.
- Revisión de contratos de estado, navegación, permisos, datos, API/worker, presupuesto inicial,
  uso de componentes, tokens, interacciones, documentación y alcance de QA.
- Se aprovecharon las pruebas focalizadas del checkpoint y la evidencia anterior. No se ejecutaron
  suites completas, CI completa ni grabación/comparación de baselines.

El inventario devuelve **24 candidatos** a overrides de badges, 26 controles nativos y 528
coincidencias de utilidades heredadas. Son listas para clasificar, no recuentos de bugs. Un
select nativo, un adaptador de compatibilidad o una utilidad antigua no prueban por sí solos
que haya una desviación. Las pruebas de navegador son muestras acotadas, no certificación de
todas las combinaciones de estado, datos o dispositivos.

## Desviaciones confirmadas

### A1. El contador del filtro seleccionado pierde contraste

Prioridad: corregir en la primera pasada de consistencia.

[Playlists.tsx:445](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Playlists.tsx:445)
aplica `text-white/40` al número dentro de un `CratePill` activo. El componente usa el fondo
`accent-action-hi`, pero ese override evita heredar su primer plano oscuro.

En ambos anchos, el fondo computado es RGB 103/232/249 y el texto compuesto RGB 164/241/251:
**1,14:1** de contraste. El número contiene información y no cumple la regla de contraste del
DS §1.1.3. El span es heredado, no una modificación del contador en 1AP.

Corrección propuesta: heredar el primer plano seleccionado y usar el token secundario adecuado
solo en el estado no seleccionado. Añadir una regresión de contraste de contenido descendiente,
además de la prueba del token base. Esta auditoría lo registra sin modificarlo.

### A2. JetBrains Mono se renderiza con pesos 500, 600 y 700

Prioridad: corrección de tipografía por familias de consumidores.

El DS §1.2.1 prescribe Mono 400. Las fuentes sí cargan; el problema es su aplicación:

- Sidebar, Roles y Users heredan 500 del `Badge` compartido, cuya base contiene `font-medium`:
  [badge.tsx:8](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/shared/ui/shadcn/badge.tsx:8),
  [Sidebar.tsx:350](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/layout/Sidebar.tsx:350),
  [Roles.tsx:105](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Roles.tsx:105),
  [Users.tsx:1031](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1031).
- Translations usa Mono 600 en `HealthMetric` y `Meta`, y 700 en la cabecera del editor:
  [I18nReview.tsx:1268](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:1268),
  [I18nReview.tsx:1299](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:1299),
  [I18nReview.tsx:981](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:981).

Se observaron esos pesos en navegador. Hay que resolver el rol de etiqueta monoespaciada con
una receta consistente y comprobar sus consumidores; cambiar indiscriminadamente todo Badge
podría alterar badges de texto que sí usan otro peso legítimamente. La corrección de metadatos
de Upcoming/ShowCard pedida al aprobar 1AO sí está publicada y verificada.

### A3. Bricolage aparece por debajo del mínimo de títulos

Prioridad: corrección de roles tipográficos.

El mínimo del DS §1.2.1 es 20 px para títulos, 16 para numerales; la excepción de 15–16 px
pertenece a títulos del reproductor/mini-player. No cubre estos consumidores de Admin:

- Nombres de Users a 16 px:
  [Users.tsx:1022](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1022).
- Títulos de tarjetas de Bandcamp a 14–16 px:
  [Bandcamp.tsx:427](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:427),
  [Bandcamp.tsx:504](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Bandcamp.tsx:504).
- Coming Up y Recently Released a 14 px, y nombres compactos con la misma familia:
  [Upcoming.tsx:507](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Upcoming.tsx:507),
  [Upcoming.tsx:699](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Upcoming.tsx:699).
- Locale health, Editor y Quality issues de Translations a 14 px:
  [I18nReview.tsx:627](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:627),
  [I18nReview.tsx:1068](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:1068).

Estos casos fueron observados. El título secundario del catálogo de Health a 18 px también es
candidato confirmado por fuente, pero no se afirma haberlo medido en su disclosure cerrado:
[Health.tsx:1033](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Health.tsx:1033).

Propuesta: Poppins para los roles compactos y Bricolage para títulos con tamaño permitido.
No aumentar todos los textos a 20 px, porque cambiaría densidad y jerarquía sin necesidad.
Los títulos compactos nuevos de 1AP ya se corrigieron antes de su revisión independiente.

### A4. El componente compartido no impide geometrías locales de chips

Prioridad: consolidar tags estáticos y eliminar overrides innecesarios.

Hay uso real de `CrateChip`; el drift procede de clases locales de tamaño y de la altura de
línea heredada. Por ejemplo:

- Analysis combina tags estáticos de 16 px con otros de 21 px; en móvil algunos llegan a 36 px
  al envolver. Véanse los overrides en
  [Analysis.tsx:571](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Analysis.tsx:571)
  y [Analysis.tsx:743](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Analysis.tsx:743).
- User Detail combina tags de 16, 21, 22 y 22,5 px; el dispositivo `listen-web` se midió a
  22,5 px con texto de 11 px. Hay overrides locales en
  [Users.tsx:1726](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1726)
  y [Users.tsx:1816](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/Users.tsx:1816).

Incluso repetir `text-[10px]` puede sustituir la altura de línea de la receta y cambiar su
geometría. Debe fijarse el rol compartido y quitar las clases redundantes de sus consumidores.
No se exige que un tag estático de 16 px tenga la altura de un selector interactivo de 32/44 px.
Los targets de New Releases y el ajuste óptico del contador de Sidebar aprobado por Diego
requieren conservar su intención. Los chips de filas de Playlists se han unificado en 1AP.

### A5. Persisten superficies y estilos anteriores en páginas parcialmente migradas

Clasificación: deuda de adopción, con riesgo de perpetuar overrides.

[ops-surfaces.tsx:36](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/ops-surfaces.tsx:36),
[ops-surfaces.tsx:78](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/ops-surfaces.tsx:78)
y [ops-surfaces.tsx:116](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/components/admin/ops-surfaces.tsx:116)
conservan transparencias de panel, sombras arbitrarias y backdrop blur. Las páginas aún contienen
utilidades de color y estructuras anteriores. El objetivo final de superficies sólidas y recetas
únicas todavía no está alcanzado.

La mayor parte es código conservado durante grupos cuyo contrato era retirar iconos sin
rediseñar toda la página. Debe reconciliarse con las fases de migración de páginas, A20 y 6.8;
no corresponde presentar cada coincidencia como una regresión nueva de 1b.8. Los adaptadores
locales que solo reexportan `AdminSelect`, `AppPopover` o skeleton no son implementaciones
duplicadas por sí mismos. Conviene retirar esos nombres cuando su fase lo permita, sin confundir
compatibilidad con un segundo componente visual.

### A6. Los controles automáticos generales de drift no cubren Admin

Prioridad: cerrar la carencia de prevención junto a la primera corrección.

[drift-inventory.mjs:4](/home/diego/.codex/worktrees/crate-v3-1q/crate/scripts/design-system/drift-inventory.mjs:4)
solo incluye `app/listen/src` y `app/shared/ui`. Admin tiene políticas de iconos y estados, pero
no una cobertura equivalente de pesos, roles tipográficos, geometrías y overrides de superficies.
El inventario actual pasa sus presupuestos sin detectar A1–A4.

Propuesta: añadir guardas focalizadas de Admin y aserciones computadas de los roles representativos.
Los candidatos deben tener dueño, motivo y fase; no convertir cada clase heredada en un error
indiscriminado ni subir techos para ocultar los fallos. No se cambió ningún presupuesto o baseline
durante esta auditoría.

### A7. Hay un defecto de copy en Translations

Prioridad: corrección pequeña de contenido.

[HealthMetric](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/ui/src/pages/I18nReview.tsx:1265)
añade `s` a cualquier label cuando el valor difiere de uno. El navegador muestra **“0 publisheds”**.
Usar una frase con sustantivo explícito, como “published bundles”, y comprobar cero/uno/varios.
No hace falta alterar los siete bundles de locales para corregir el texto de este panel de Admin.

### A8. La documentación conserva stops históricos con lenguaje de estado actual

Prioridad: reconciliación documental antes del cierre de fase.

El encabezado y los registros finales sitúan correctamente 1AO publicado y 1AP local. Sin embargo,
el cuerpo del implementation plan todavía llama a 1AD **“Current bounded stop”**:
[implementation plan:1881](/home/diego/.codex/worktrees/crate-v3-1q/crate/docs/plans/2026-10-14-crate-v3-implementation-plan.md:1881).
El DS todavía presenta 1M en revisión local en
[design system:334](/home/diego/.codex/worktrees/crate-v3-1q/crate/docs/plans/2026-10-14-crate-v3-design-system.md:334)
y conserva otras notas históricas equivalentes.

Los registros finales prevalecen, así que no se ha retomado una base equivocada. Aun así, este
lenguaje favorece errores de handover. Propuesta: una tabla única de estado actual y marcar los
registros anteriores como históricos, conservando sus evidencias. No borrar checkpoints.

## Trabajo pendiente que no debe confundirse con una desviación nueva

- PlaylistEditor todavía espera su grupo de retirada de iconos y tipografía. En 1AP solo cambian
  su selector de operadores, artwork delegado y superficie de fila expresamente solicitados.
- El error de lectura de Playlists mantiene el handler existente: lista vacía y toast. Su
  diferenciación persistente respecto al vacío es adopción pendiente de estados de página,
  no una alteración del contrato durante este grupo.
- Permanecen los menores ya registrados: cabecera sticky de Users y asociación del label
  visible del Select compartido. Que los inputs nativos medidos tengan nombre no cierra el
  segundo punto ni certifica todos los combobox con lector de pantalla.
- Tab helpers por página, Smart Mix, A20, fases de páginas, 6.8 y el cierre global de 1b.8 no
  están terminados. No se ha hecho una migración masiva o una integración para aparentar cierre.
- Las 33 capturas canónicas y el manifest siguen en 1M. La comparación Linux de cambios
  posteriores, QA nativa, motores distintos de Chromium, lector de pantalla, zoom y datos vivos
  necesitan el procedimiento de validación de su fase. No están certificados por los specimens.
- El bundle actual es **526379 / 532480 B gzip**, nueve assets, **6101 B de margen**. Cumple el
  límite, pero sigue siendo una restricción para nuevos imports.

## Contratos y decisiones que se mantienen

- Una identidad fija; no se introducen Crate Red, temas seleccionables ni cambios del pin
  `app/web@258bbaee`. No hay rebase, Smart Mix, PR, merge, deploy o release.
- Las tres familias están disponibles en las 40 observaciones. Se conservan las excepciones
  nativas de Listen/Capacitor y la delegación Desktop. El problema de A2/A3 es el rol aplicado.
- **303 pares verticales visibles medidos, todos a 8 px**, mediante `.crate-form-field`, sin
  desbordamiento horizontal en las 40 observaciones. Esto no prueba las combinaciones no abiertas.
- Overlays, confirmaciones, selectores y filas comparten bases reales. Las políticas acotan 26
  archivos de Admin y 102 sitios de glifos UX retenidos. Admin y Listen siguen separados.
- Se conserva la esencia del play de Listen, su halo, ring y estela. La retirada de fondo hover
  de filas no elimina el estado activo, seleccionado, offline, foco o feedback de menús/botones.
- Dashboard de tres bloques, Health como cola de problemas con acentos, retirada de Timeline,
  retirada del mapa de Users, modal ancho/avatares grandes, glifos funcionales, controles
  List/Calendar, filas sin iluminación y selectores de operadores son **decisiones de Diego**.
- Los contratos de datos, acciones, permisos y navegación de 1AP se contrastaron mediante AST,
  pruebas focalizadas y rutas reales con respuestas interceptadas. No se añadieron escrituras
  a biblioteca, cambios de backend o nueva persistencia en este checkpoint.
- La adición anterior de `last_fingerprinted` en 1AA fue solicitada por Diego y se toma en el
  worker fuera de request. La consulta obtiene el último resultado; no añade agregaciones de
  tracks al camino HTTP. No se volvió a ejecutar backend sin cambios para esta auditoría.
- Las pruebas existentes de Dashboard distinguen datos ausentes, stale, indisponibles y error;
  no se ha inferido salud real a partir de la muestra. La conectividad y frescura de producción
  siguen fuera de esta revisión local.

## Orden propuesto para una iteración de reconciliación

1. Contraste A1, pesos Mono A2 y roles compactos A3, con pruebas computadas en consumidores reales.
2. Receta y consumidores de chips A4; copy A7. Revisar por rol, sin igualar tags y controles.
3. Guardas de Admin A6 y estado documental A8; dar dueño/fase a cada residuo de A5.
4. Reanudar los grupos pendientes y sus migraciones de página; reservar CI/canonical/native
   completa para el cierre previsto. No añadir dependencias sin comprobar el margen de bundle.

Diego autorizó después esta implementación. Las disposiciones siguientes sustituyen el límite inicial de solo análisis. El stop sigue siendo 1AP, sin commit.

## Evidencia local reproducible

Carpeta: `/home/diego/.codex/worktrees/crate-v3-1q/crate/.artifacts/review/`.

- `v3-plan-audit-source.mjs`, su JSON e inventario resumen.
- `v3-plan-audit-browser.spec.ts`, configuración, JSON de 1440/390 y log final: dos ejecuciones
  diagnósticas seriales, 40 observaciones, cero errores de recogida.
- `1ap-repair-*`: pruebas focalizadas tras los cuatro menores de la revisión independiente,
  contratos, tipos, lint, browser, builds y presupuesto. No son suites completas.
- `checkpoint-1ap-operator.jpg`: captura real de IAB del selector compartido, conservada junto
  al ledger `.superpowers/sdd/2026-10-18-crate-v3-playlists-icons/`.

Los diagnósticos son evidencia de análisis, no nuevas baselines. Las primeras mediciones de
contenido oculto de Health y el intento inicial de abrir el editor de Translations se descartaron;
los JSON y el log final usan los estados visibles correctos. No se presentaron como bugs.

## Disposición tras autorización de Diego — 2026-10-19

| Hallazgo | Disposición local en 1AP                                                                                        | Evidencia / límite                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A1       | El contador hereda el primer plano de CratePill                                                                 | Contraste computado de los cuatro filtros, seleccionados y no seleccionados, a 1440/390                                                  |
| A2       | Mono 400 explícito en Badge de Sidebar/Roles/Users y en Translations                                            | Comprobación de pesos en páginas reales y editor; Badge de texto conserva su receta                                                      |
| A3       | Poppins para títulos compactos de Users, Roles, Bandcamp, Upcoming/ShowCard, Translations y catálogo de Health  | Incluye tamaño heredado de CardTitle y checks desplegados; numerales Bricolage de 16 px se conservan                                     |
| A4       | CrateChip posee peso/leading; Analysis y Users pierden overrides locales de tamaño                              | Analysis permite wrap de cabeceras; tags reales de muestra a 16 px, sin recortar contenido. Los labels largos aún pueden envolver        |
| A5       | Dueño, fase y criterio de cierre explícitos                                                                     | Tabla vigente y registro ejecutable por archivo/token; la migración completa de superficies continúa pendiente como se propuso           |
| A6       | Guarda AST de roles corregidos y de superficies inventariadas, ejecutada por Vitest de Admin y CLI de drift     | Alias, clases condicionales/constantes y límites exactos probados. No sustituye CSS computado ni certifica clases arbitrarias en runtime |
| A7       | “published bundle/bundles”                                                                                      | Página real con cero, uno y dos bundles; payloads y contadores intactos                                                                  |
| A8       | Una tabla de estado vigente enlazada desde los seis documentos; stops 1AD/1M obsoletos marcados o reconciliados | Historial y checkpoints conservados                                                                                                      |

Los textos de hallazgo anteriores describen el estado observado antes de corregir. Ya no son
una lista de defectos abiertos de A1–A4/A6–A8. El handover final añade la validación, presupuesto
y revisión de esta pasada; los límites de QA y deuda de adopción se mantienen explícitos.


Cierre local de prevención: la revisión independiente encontró dos huecos menores en variantes
Tailwind y resolución léxica de constantes. Ambos se corrigieron con cuatro casos RED→GREEN;
las 19 pruebas de la guarda y las 17 del inventario pasan. Las excepciones de superficie siguen
ligadas al token exacto, y los parámetros de runtime no se confunden con constantes externas.
Sin cambios adicionales de pantalla tras las 23 comprobaciones de navegador. Bundle final
526377/532480 B gzip, 6103 B de margen. Rulings y límites completos en el handover final.
