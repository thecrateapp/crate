# Dashboard de Admin: simplificación orientada a funcionamiento

2026-10-18. **Propuesta aprobada por Diego para implementación en 1AB (2026-10-18).**
La prioridad confirmada por Diego es: «Si el sistema y sus trabajos están funcionando».
Diego autorizó los tres bloques usando solo datos reales disponibles y parar en 1AB antes de commit. 1AA está aprobado y publicado
como `1327270692937896072b3a3c79ad6cef6c1049b3`; los cambios posteriores siguen locales.

## Diagnóstico

Dashboard intenta responder a cuatro preguntas distintas: cómo está la biblioteca, qué trabajos
hay, si funciona la infraestructura y qué música se incorporó o tendrá conciertos. Las trata
con una jerarquía visual parecida. El resultado exige interpretar muchos datos para responder
a la pregunta principal de Diego.

El problema precede a la retirada de iconos. Cambiar fuentes o estilizar las tarjetas ayuda a
leerlas, pero no decide qué merece estar en esta pantalla. Mi recomendación es convertir el
inicio en una comprobación operativa breve: **qué funciona, qué está avanzando y si hay que
intervenir**.

Observaciones del código actual de `app/ui/src/pages/Dashboard.tsx`:

- Health aparece en el chip del hero, en una tarjeta y en Needs Attention. Colas, imports,
  slots y última exploración también reaparecen entre el resumen, Right Now y Pipeline.
  Hay ocho tarjetas de resumen visibles, cuatro chips de cabecera y dos listas de cinco
  lecturas, antes de contar incidencias, trabajos, discos y conciertos. Advanced Diagnostics
  añade todavía más contenido cuando se abre.
- La prioridad depende en parte del volumen: diez incidencias de biblioteca elevan el tono
  sin que Dashboard conozca aquí la severidad o el efecto de cada una. Estar pendiente no
  significa requerir intervención.
- `workerSaturated` se activa al alcanzar los slots disponibles; no comprueba cuánto lleva
  así ni si los trabajos avanzan. Una máquina trabajando a plena capacidad puede funcionar
  perfectamente.
- Los fallos de `recent_tasks` entran en Needs Attention sin filtrar antigüedad ni comprobar
  recuperación. Por ello un fallo antiguo puede seguir reclamando atención.
- `opsHealthy` solo combina los booleanos PostgreSQL y watcher. No prueba por sí solo que
  Redis, los workers y todos los recorridos de trabajo estén funcionando.
- La página no usa `snapshot.stale`, `built_at` o `stale_after` para matizar ese estado.
  Un fallo de refresh con datos anteriores tampoco muestra el ErrorState de primera carga.
  Un dato antiguo puede parecer una comprobación actual.
- `task.progress` se muestra directamente como texto. El contrato admite un string y las
  fixtures originales contienen JSON serializado; el detalle técnico no siempre se convierte
  en un progreso legible.
- «Recently added» tampoco es una garantía de incorporación: el productor ordena por
  `dir_mtime`, y la proyección pide un `updated_at` que esa consulta no selecciona.
  No basaría un resumen de novedades o un «añadidos hoy» en ese dato.

Son hallazgos de código y contratos, no una auditoría del estado de producción. Las muestras
del preview son ficticias.

## Propuesta recomendada

Tres bloques estables, con incidencias destacadas solo cuando las haya. Sin mosaico de KPIs.

### 1. Estado y confianza en el dato

Una cabecera breve con una frase de estado, su alcance y la hora de la última comprobación.
Ejemplos de redacción, no resultados reales: «Funcionando · 2 trabajos en curso» o
«Sin datos recientes · última actualización hace 4 min». El estado se apoya en palabras y un
marcador pequeño; el color acompaña el significado.

Hay que distinguir dos dimensiones: **salud del sistema** y **actividad de los trabajos**.
Un sistema sano puede estar en reposo o procesando; una cola pendiente no debe convertirlo
automáticamente en un problema. La falta de datos es un estado explícito, nunca éxito ni caída
deducidos de ceros.

Debajo, una línea compacta de las señales realmente medidas —por ejemplo, servicios observados
y workers con confirmación reciente—, con acceso a System/Stack según permisos. No mostrar un
«todos operativos» si no existe evidencia de todos. Actualizar sería una acción secundaria.

### 2. Trabajos: ¿se está moviendo lo que importa?

Una sola lista breve para actividad en curso. Cada fila tiene nombre comprensible, fase,
avance medido y última actualización. Mostrar cantidades o porcentaje cuando sean válidos;
una fase sin total tiene un estado textual. No inventar ETA, rendimiento ni porcentaje.

Encima bastan los totales de ejecución y espera, cada uno con su significado. El detalle por
cola, slots y pools pertenece a Tasks. El enlace «Ver trabajos» lleva a esa vista; una fila
puede abrir el trabajo concreto cuando exista un destino soportado.

El reposo también debe ser informativo: «Sin tareas en esta cola» y la última finalización
conocida, en una línea. Eso ayuda a entender la actividad reciente, pero no demuestra que los
workers estén vivos. Los procesos de análisis/Bliss que no se representen como tareas deben
contarse por su fuente propia o quedar fuera del alcance declarado; no anunciar «sin trabajo»
solo porque `running_tasks` esté vacío.

### 3. Intervención: solo problemas vigentes y con siguiente paso

Lista de filas finas, sin un gran panel de advertencia por cada dato. Cada elemento explica
**qué ocurre, qué impide y dónde resolverlo**. Priorizar por impacto, vigencia y necesidad de
acción, no por cantidad de incidencias.

Ejemplos: un servicio sin respuesta confirmado, un trabajo fallido que sigue bloqueando una
operación o una confirmación pendiente que impide continuar. Una espera normal, procesamiento
al máximo o un fallo histórico recuperado no pertenecen aquí.

La lista se sitúa arriba cuando hay un bloqueo relevante; si todo funciona, una frase breve
puede sustituirla. Propondría mostrar hasta tres causas, agrupar las relacionadas e indicar
siempre el total y el acceso a las restantes. Los estados que no se puedan clasificar con
evidencia deben decirlo.

## Qué sale del inicio

| Contenido actual                                                          | Propuesta y motivo                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Right Now y las cuatro tarjetas de Pipeline                               | Integrar únicamente estado y progreso útiles en los dos primeros bloques; retirar las repeticiones.                                                                                                              |
| Álbumes recientes y conciertos                                            | Sus vistas de biblioteca/Upcoming. No responden a la prioridad elegida para Dashboard.                                                                                                                           |
| Tamaño de biblioteca, géneros, décadas, formatos y estadísticas profundas | Browse/Insights/Analysis según dominio. No conservarlos escondidos dentro de otro desplegable del inicio.                                                                                                        |
| Usuarios y reproducciones recientes                                       | Insights o su vista operativa cuando se investigue ese flujo; no un KPI principal del inicio.                                                                                                                    |
| Secuencias Redis, eventos, acks y número de superficies SSE               | System y sus diagnósticos, con acceso por permisos. Una cifra de secuencia sin criterio de salud no ayuda a comprobar funcionamiento.                                                                            |
| Wipe y rebuild                                                            | Reubicar en un destino de mantenimiento explícito, conservando permisos y confirmación escrita. Hoy las llamadas de la UI están solo en Dashboard: el destino necesita implementarse antes de retirar el acceso. |
| Sync library                                                              | Acción contextual de exploración/mantenimiento, no parte de la afirmación de salud. Conservar el acceso durante cualquier transición.                                                                            |

Mover significa conservar la capacidad y darle un destino apropiado. No implica que todas esas
vistas expongan ya exactamente el mismo dato o control.

## Evidencia disponible y límites para implementarlo

| Podemos aprovechar ahora                                                    | Necesita comprobarse o ampliar su contrato                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Metadata de frescura del snapshot, error de carga y actualización manual.   | Frescura del snapshot no equivale a heartbeat de cada worker ni a salud del transporte SSE.                                    |
| Booleanos de PostgreSQL/watcher y conectividad Redis reportada en eventing. | No constituyen una prueba completa de disponibilidad del sistema o de reproducción. Definir alcance y autoridad de cada señal. |
| `queue_breakdown`, tareas, fases/progreso y fechas cuando existan.          | Slots ocupados no son workers vivos. `updated_at` no prueba avance útil; un heartbeat puede renovarlo.                         |
| Últimas tareas terminadas y fallidas.                                       | Fallo pendiente frente a recuperado; ventana de vigencia y relación causa/efecto, sin inventar resolución.                     |
| `health_counts` y actividad de análisis.                                    | Severidad/impacto y bloqueos de biblioteca requieren su contrato de salud; una suma no los sustituye.                          |

No añadiría tasas, tendencias, uptime, «atascado» o «workers online» sin sus datos. Para detectar
un atasco hacen falta último avance real, reglas por tipo/fase y razones de espera: una tarea
larga puede funcionar sin emitir progreso durante un tiempo. No basta un umbral universal.

La propuesta debe aprovechar snapshots y samplers existentes. Cualquier señal adicional se
proyectaría fuera de la petición y con una cadencia definida. Sin agregaciones sobre la
biblioteca durante HTTP, sondeos acelerados ni streams nuevos por componente. El Dashboard
debe seguir sin mantener activas las superficies rápidas de queues/governor.

## Relación con el plan V3

Product design §4.1 y Task 3.3 ya prevén una mejora, pero conservan cuatro tiles, biblioteca y
diagnósticos. La prioridad recién confirmada justifica revisar esa composición, no limitarse a
dibujar sus tarjetas de otra forma. **La composición de tres bloques ha sido aprobada para 1AB**;
la implementación documenta la sustitución de composición y no marca 3.3 ni 1b.8 completas.

Mantendría las fuentes estipuladas: Bricolage para títulos y cifras destacadas, JetBrains Mono
para etiquetas y lecturas técnicas, Poppins para texto y controles. Usaría reglas y espacio,
pocas cifras protagonistas, acento para actividad y ámbar para una intervención justificada.
Se conservan los glifos funcionales de UX, accesibilidad, objetivos táctiles y 8px reales en
pares verticales mediante `.crate-form-field`.

## Cómo evaluar la propuesta antes de desarrollarla

Comparar tres escenarios con datos ficticios claramente identificados: sistema sano en reposo,
trabajo normal avanzando y problema que requiere intervención. Añadir a la revisión el caso
de datos desactualizados, para impedir una falsa sensación de salud. En cada uno, el primer
pantallazo debería permitir responder «¿funciona?, ¿avanza?, ¿tengo que hacer algo?» sin sumar
tarjetas mentalmente ni abrir Advanced Diagnostics.

Primero acordar esa selección de información y las reglas de estado; después una propuesta
visual de esos escenarios. La implementación se dividiría en una simplificación con las señales
actuales y, si se aprueba, las proyecciones que falten para mejorar la certeza. No presentar un
rediseño tipográfico como la solución al exceso de información.

## Fuentes locales revisadas

- `app/ui/src/pages/Dashboard.tsx`: bloques, prioridades, acciones y condiciones actuales.
- `app/ui/src/contexts/OpsSnapshotContext.tsx`: payload, error, refresh y stream compartidos.
- `app/ui/src/pages/Tasks.tsx`: progreso y detalle de tareas ya existentes.
- `app/ui/src/pages/Health.tsx`: severidad y catálogo que el resumen actual no consume.
- `app/crate/db/ops_snapshot_stats.py` y `queries/analytics_overview_stats.py`: origen y
  proyección de álbumes recientes.
- `docs/plans/2026-10-14-crate-v3-product-design.md` §4.1 y
  `2026-10-14-crate-v3-implementation-plan.md` Task 3.3: objetivo todavía pendiente.

No se consultó producción ni se sustituyó la referencia fijada `app/web@258bbaee`.

## Alcance autorizado y aplicado en 1AB

Diego aprobó implementar los tres bloques con las señales ya disponibles. La versión usa solo
el provider compartido de operaciones: PostgreSQL, watcher y Event Redis; fecha/caducidad del
informe; colas completas, progreso de tareas, actividad explícita de análisis/Bliss y últimos
registros de finalización/fallo. Los servicios sin dato quedan sin evaluar. Los fallos históricos
no se presentan como bloqueos vigentes y los informes antiguos no generan avisos actuales.

La composición anterior sale del inicio; diagnóstico y análisis se abren en sus rutas existentes
según permisos. Las tres operaciones de biblioteca quedan accesibles en un diálogo secundario
de mantenimiento, con sus confirmaciones originales y las capacidades de sus endpoints. No se
crea una nueva ruta ni se amplían permisos. No se añaden señales de worker, tasas ni estimaciones.

La falta de liveness/progreso útil de cada worker sigue siendo una limitación explícita, no una
promesa implementada. El plan de ejecución y el handover registran pruebas y QA pendiente.

La revisión de productores distingue el Redis duradero de eventos del Redis de caché:
se usa `eventing.domain_events.redis_connected`, sin recurrir al booleano exterior cuando falta.
Análisis conserva su propia frescura: `unavailable` oculta los recuentos; `stale` los presenta
como último informe antiguo. Cuando esos marcadores faltan, como puede ocurrir en REST,
los recuentos siguen siendo el último dato reportado, con frescura desconocida. La fecha
del informe general no demuestra la vigencia de cada sección ni la vida de sus procesos.
