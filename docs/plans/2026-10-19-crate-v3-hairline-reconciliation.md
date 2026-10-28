# Crate V3 — primera reconciliación: HairlineRow

Diego autoriza continuar después de revisar el catálogo local. Alcance: cerrar el defecto de
inset/alineación de HairlineRow, conservar el resto del contrato y parar de nuevo en 1AQ sin
commit/push. Previews 5186 y6006 activos. No se autorizan otras migraciones por esta tarea.

1. Contrastar fuente, mocks y consumidores; reproducir sin CSS del mockup. El layout compartido
   carece de padding horizontal y text-align; el navegador centra el texto del botón. El mockup
   lo oculta con padding12px/text-left. Solo un consumidor productivo directo: setlist de Listen;
   Admin aún tiene su implementación propia y su adopción queda pendiente.
2. Escribir regresiones de geometría en Storybook: fila normal/activa sin índice, botón, enlace,
   multiline y título largo;390/1200px, puntero fino/coarse, teclado y hover sin iluminación.
3. Añadir12px de inset y alineación izquierda en el layout del componente. Retirar exactamente
   esas ayudas de .rows-preview/.focus-rows. Preservar10px verticales, min32/44, gap14px, índices,
   trailing, regla, activo2px/lavado, refs, semántica y callbacks. No compact
   variant ni migración global de tipos/filas en este bloque.
4. Actualizar ficha/escenarios/registro del componente en inglés y comprobar guardas. Probar
   shared y consumidores Listen afectados, tipos/lint/builds/budgets y muestras previas concretas
   con workers1. No suites/CI completas, baselines canónicas ni cambio de pin258bbaee.
5. Revisión independiente del delta; corregir Important/Critical con regresión. Registrar
   límites y entregar1AQ local sin commit. Las otras familias R1–R4 siguen pendientes.


## Resultado local y revisión

Padding/alineación y envoltura de títulos sin espacios corregidos en la base; sin cambios de API,
refs, semántica, callbacks, señal activa ni comportamiento de reproducción.
Las dos reglas de ayuda externas se retiraron. La ficha inglesa muestra el contrato real y los
casos mínimo, interactivo y de texto largo; su registro/huellas están actualizados. Admin permanece
sin adopción productiva de HairlineRow; el resto de filas/fechas no se ha migrado.

- 33/33 casos shared/política y 15/15 Listen en los dos archivos del consumidor afectado.
- 18/18 Storybook tras la enmienda tipográfica, siempre workers1. Los casos nuevos cubren
  geometría y tipografía en 390/1200 px, fine/coarse y desbordamiento sin espacios. En el preview
  histórico pasaron los 3 casos afectados durante la reconciliación; los 2 de composición y
  selección se repitieron después del ajuste tipográfico y siguen verdes.
- Tipos shared/Listen/showcase y tipos/build de Admin verdes. TS2353 en la fixture histórica de
  Git se corrigió con Record<string,string>; typecheck RED→GREEN y sus 2 casos siguen verdes.
- Builds shared, Listen, Admin y Storybook verdes; lint focalizado verde. Tras el ajuste
  tipográfico, Admin **526383/532480 B gzip** (9 assets), margen 6097 B; Listen
  **199948/307200 B** (23 assets), margen 107252 B.
- Revisión independiente: sin Critical/Important de runtime. Menor aplazado: la regresión hover
  del nuevo spec compara el li; añadir comprobación del fondo de su hijo nativo ampliaría la
  cobertura. No se ha observado una iluminación incorrecta en los escenarios actuales.

Decisiones: mantener el checkpoint local1AQ sin commit; conservar los mínimos existentes; envolver títulos largos al desactivar truncate, sin introducir otra variante.
La revisión no certifica otros cambios1AQ, adopción Admin, AT, plataformas nativas ni QA global.
El menor previo de controles de props/modo tabs de SegmentedControl sigue explícito en su ficha.
Previews5186/6006activos, pin258bbaee y baselines1M preservados. Sin full suites, CI ni publicación.
Siguiente bloque propuesto tras revisión: FormField y roles tipográficos, siguiendo R1.


### Enmienda de tipografía y referencia (Diego)

La comparación DOM confirmó Storybook a 16/24 px y mockup a 12/18 px. Se considera drift de
herencia; el componente pasa a definir Poppins 400 a 12/18 px, con regresión ante un contexto
Mono de 24 px y peso bold. Se retiran los font-size locales del preview.

El mockup también contenía una reducción a 11 px bajo 900 px. Diego confirmó expresamente
**12/18 también en móvil, por legibilidad**. Se retira esa reducción y se comprueban la
tipografía y el objetivo táctil mínimo de 44 px. Esa respuesta fija el ajuste confirmado del
mockup. La referencia visual es el mockup aprobado y sus ajustes confirmados; las dudas,
desviaciones y conflictos de tamaños móviles se resuelven con Diego.

Esta enmienda es posterior a la revisión independiente de geometría: se ha verificado con
regresión de estilos calculados, comparación DOM entre ambos previews y comprobación visual
del autor. No se atribuye al revisor anterior la revisión de este delta posterior.

Evidencia final: `.artifacts/review/1aq-hairline-final-typography.log`,
`1aq-hairline-final-budgets.log` y `1aq-hairline-final-lint.log` en el mismo directorio.
Captura actual: `.artifacts/review/checkpoint-1aq-hairline-reconciled.png`.
