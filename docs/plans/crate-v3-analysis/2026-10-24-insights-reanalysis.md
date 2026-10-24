# Insights: análisis y propuesta de utilidad

Fecha: 2026-10-24. Estado: propuesta para discutir, sin cambios de producto.

## Recomendación

Convertir Insights en una consola de **uso y curación de la colección**: qué parte del catálogo
indexado recibe escucha, cómo cambia el interés y qué conjuntos merecen exploración o trabajo.
Su unidad es la instancia y su colección, frente al relato personal de Stats en Listen.

El lenguaje visual procede de Artist Stats, System Health y el genre wheel: superficies abiertas,
trazos finos, contexto atenuado, puntos huecos y una selección accent con lectura persistente.
La forma del gráfico debe responder a los datos; no hace falta convertir las series en ruedas.

## Lo que falla hoy

| Hallazgo                                                               | Consecuencia                                                                | Evidencia                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Standouts surfaced` suma dos listas limitadas a 20                    | El 40 suele representar un límite de respuesta, no un hallazgo              | `Insights.tsx`, `analytics_catalog_popularity_queries.py` |
| `Artist Momentum` solo usa popularidad externa almacenada              | Se presenta como evolución algo que no tiene periodo ni cambio              | `Insights.tsx`, `analytics_catalog_popularity_queries.py` |
| Cobertura media de ocho campos independientes                          | El 100% redondeado no equivale a análisis completo, válido o vigente        | `Insights.tsx`, `analytics_audio_feature_queries.py`      |
| Los dos scatters recuperan hasta 500 filas sin muestreo representativo | La nube no permite concluir cómo suena toda la biblioteca                   | `analytics_audio_scatter_queries.py`                      |
| Cuatro tiles, tres tarjetas narrativas y diez gráficas                 | Se repiten género, década y cobertura sin conducir a una decisión           | `Insights.tsx`                                            |
| Países/décadas solo cuentan metadatos conocidos                        | No muestran cuánto catálogo queda fuera por falta de información            | Consultas de Insights                                     |
| No hay selección persistente ni navegación desde los datos             | El tooltip termina siendo el destino de la interacción                      | `Insights.tsx`                                            |
| El endpoint ejecuta diez lecturas por petición y agrega tracks         | Falta el snapshot requerido por la arquitectura; no hay frescura ni periodo | `api/analytics.py:387`                                    |

La inspección local confirma la deriva visual: tarjetas anidadas, barras con mucho relleno,
etiquetas de eje que se pisan en columnas estrechas y explicaciones largas en tooltips. Las pills
del header repiten los nombres de las secciones sin funcionar como filtros.

## Alternativas consideradas

1. **Atlas de colección.** Géneros, épocas, procedencias y sonido. Reaprovecha más datos actuales,
   pero seguirá describiendo inventario sin mostrar qué hacemos con él.
2. **Colección frente a uso real — recomendada.** Cruza catálogo e historial para decidir qué
   explorar y dónde priorizar la curación. Requiere completar proyecciones/snapshots.
3. **Laboratorio de reproducción/Smart Mix.** Centrado en preparación y mezclas. Se solapa con
   Analysis/System y necesita telemetría persistida para evaluar transiciones ejecutadas.

## Estructura propuesta

### Cabecera y alcance

- Header común, subtítulo concreto y controles de periodo: 30 días por defecto, 90 días y año.
- Fechas exactas, ámbito de instancia y frescura de datos visibles.
- Comparación con el periodo anterior de igual duración; sin variaciones cuando la base falta.
- Para las métricas de uso del catálogo, población: escucha de toda la instancia resuelta contra
  el catálogo local indexado actual. Eventos remotos/no resueltos se declaran aparte.
- Historial disponible desde una fecha explícita. Sin registro no significa nunca escuchado.

### Banda de cuatro lecturas

| Lectura              | Definición                                                                              | Decisión que facilita                       |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| Horas registradas    | Suma de `played_seconds` de la población/periodo, con cambio absoluto y relativo válido | Ver si el uso crece o cae                   |
| Alcance del catálogo | Tracks locales únicos con eventos / tracks del catálogo local indexado actual           | Saber cuánto fondo se está recorriendo      |
| Álbumes con escucha  | Álbumes locales únicos con eventos, con denominador de álbumes indexados                | Medir amplitud más allá de pistas repetidas |
| Concentración Top 10 | Cuota de tiempo registrado de los diez artistas principales ordenados por ese tiempo    | Ver concentración frente a exploración      |

`StatNumber`, etiquetas grises debajo, unidades y denominadores explícitos; sin tarjetas
individuales. Cuatro columnas en escritorio y dos en móvil. Reproducciones y oyentes activos
quedan como contexto secundario, no como nuevos bloques grandes.

El denominador de catálogo es el inventario actual del snapshot, también para comparar alcance
entre periodos. No se pretende reconstruir inventario histórico sin datos para hacerlo.

### 1. Colección frente a escucha: visual principal

Una fila por familia de género, con dos puntos unidos por un trazo fino en escala 0–100:

- punto gris: cuota del catálogo indexado;
- punto accent: cuota de reproducciones registradas del periodo;
- lectura expresa de ambos porcentajes y sus respectivos denominadores.

Permite distinguir presencia en la colección e interés registrado. No se interpreta la distancia
como déficit o recomendación automática de compra. Géneros canónicos con reparto explícito para
evitar doble cómputo; facetas fuera de este reparto. La misma visual puede alternar a décadas.
El backend debe producir ambas series con una resolución de taxonomía coherente.

Hover/foco/tap selecciona una fila. Al lado aparece una lectura persistente: género/época,
tracks y álbumes indexados, tracks con escucha, reproducciones, tiempo registrado, variación y
ejemplos de álbum con cover, título y metadatos debajo. Enlaces a entidades reales y a Genres
preseleccionado. Cualquier acción que necesite un conjunto filtrado nuevo requiere contrato propio.

### 2. Pulso y cambios de interés

Una serie temporal de tiempo registrado: trazo fino accent actual y trazo tenue discontinuo del
periodo anterior alineado por día relativo. La lectura del punto muestra fecha y valores, no una
tarjeta flotante con varios párrafos.

Debajo, dos listas alineadas de artistas con mayor subida y caída de escucha registrada: imagen,
nombre, tiempo actual, anterior y cambio absoluto. Cuando antes no había actividad, mostrar esa
condición, nunca porcentajes infinitos. Con pocos eventos, indicar muestra insuficiente.
No usar popularidad externa como sustituto del interés local.

### 3. Conjuntos concretos para explorar o mejorar

Dos listas breves, con covers y motivos claros:

- **Para explorar:** álbumes sin reproducciones registradas desde el inicio conocido del historial;
  aparte, álbumes que tenían escucha y llevan 90 días sin eventos registrados.
- **Mejoras con impacto:** pistas/álbumes con más escucha que carecen de Full vigente o de Bliss
  almacenado, mostrando tamaño del conjunto y tiempo registrado asociado. Su utilidad depende
  de las capacidades activas; falta de perfil no demuestra un fallo de reproducción.

Insights establece prioridades y enlaza a Artist/Album/Analysis/Genres/Discovery. Las operaciones
de reparación y enriquecimiento siguen en sus páginas propietarias, con sus permisos y colas.
No debe convertirse en otro tablero de tareas.

### Explorador sonoro secundario

Después de resolver el uso del catálogo, incorporar un único explorador tempo × energía que
permita comparar población analizada disponible y escuchada; acústico × instrumental como otro
modo del mismo espacio. Con cobertura medida y selección de álbumes concretos.

Necesita agregados de población o muestreo estable identificado. Los 500 puntos actuales no
sirven como distribución global. No lo pondría en el primer corte para desplazar otra vez el
contenido de utilidad con gráficas descriptivas.

## Datos disponibles y trabajo necesario

| Capacidad                                                                 | Estado                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tiempo registrado, reproducciones, serie, comparativa y rankings globales | Base existente en `/api/stats/dashboard` y su builder de instancia                                         |
| Frescura, `computed_until`, provisional y stale-first                     | Contrato existente reutilizable; snapshots locales de nueva key necesitan precalentarse                    |
| Géneros escuchados                                                        | Existe cuota de plays fraccionados entre etiquetas; no es cuota de minutos ni garantiza taxonomía canónica |
| Alcance local y álbumes sin escucha                                       | Nuevo cruce precomputado de catálogo con proyecciones de escucha y resolución de identidad                 |
| Concentración por tiempo y prioridad Full/Bliss                           | Extensiones del builder; no sumar tops ordenados por otra magnitud                                         |
| Altas que terminan escuchándose en 7/30 días                              | Posponer: falta fecha fiable de incorporación del álbum                                                    |
| Transiciones Smart Mix ejecutadas                                         | No hay telemetría persistida adecuada para este informe                                                    |

Lectura local de diagnóstico, previa a reconciliar identidad/población: historial del 6 de abril al
23 de octubre de 2026, 8.084 reproducciones registradas. Últimos 30 días por días registrados:
1.428 eventos y 3.621,9 minutos. Hay señal suficiente para desarrollar y revisar el panel.
No usar estos totales como alcance local hasta resolver la intersección con inventario.

Requisitos de exactitud:

- Usar UID/ID/path para identidad, nunca el título como clave. Excluir cuarentena del inventario.
- Catálogo indexado no demuestra que el archivo de audio esté físicamente accesible.
- Los eventos no garantizan escucha completa. Duración registrada mezcla medidas Listen y
  estimaciones de scrobble Subsonic; no presentar precisión ni satisfacción que no existen.
- Los rollups de instancia mezclan días locales de usuarios: definir/normalizar el calendario
  antes de describir la serie como días de una zona horaria exacta.
- Ausencia de muestra, fallo y cero son estados distintos; conservar último snapshot válido.
- `discoveries`/`comebacks` globales no están implementados aunque existan nombres de campos.
- `updated_at`/`dir_mtime` no son fechas de alta de álbum. El backfill de `first_seen_at` de artista
  tampoco permite medir retrospectivamente adquisición con rigor.
- Toda agregación nueva se calcula fuera de HTTP mediante snapshot/projector/tarea deduplicada.
- Discovery consume campos del Insights actual: conservar compatibilidad o migrarlo expresamente.

## Reutilización visual

Usar `useInstrumentChartTheme`, `InstrumentChartPoint`, `InstrumentChartReadout` y
`InstrumentChartLegend` de Admin, compuestos con `InstrumentPanel`, `MonoLabel`, `StatNumber`,
`Meter`, `GenrePill`, controles y tooltips existentes de `@crate/ui`. Consultar también las lecturas
y estados de frescura de Listen Stats. Sin nuevas dependencias ni componentes base duplicados.

Nivo conserva la geometría estadística. Accent significa serie/selección, gris contexto; warning
solo para una condición accionable. Targets de teclado/touch, lectura persistente y puntos
coincidentes accesibles; no depender del hover. En móvil se apilan gráfica y lectura.

## Alcance recomendado para la siguiente implementación

Primero, contrato/snapshot de población y periodo; después banda, comparación colección/escucha,
pulso y listas de conjuntos. Retirar los KPI artificiales, los rankings de popularidad externos
como titulares y las diez gráficas actuales. El explorador sonoro y las cohortes de nuevas altas
quedan como ampliaciones con requisitos de datos expresos.

Este documento propone el alcance. No se han modificado la página, los endpoints ni la base.

## Referencias de código

- `app/ui/src/pages/Insights.tsx` y `Insights.test.tsx`.
- `app/crate/api/analytics.py`, `/api/insights` y `/api/stats/dashboard`.
- `app/crate/db/queries/analytics_catalog_popularity_queries.py`.
- `app/crate/db/queries/analytics_audio_feature_queries.py` y `analytics_audio_scatter_queries.py`.
- `app/crate/db/instance_stats_dashboard_surface.py`.
- `app/crate/db/queries/user_library_stats_global.py` y `user_library_stats_genres.py`.
- `app/crate/db/jobs/instance_listening_rollups.py` y `user_listening_projections.py`.
- `app/crate/subsonic/services/playback.py`.
- `app/crate/db/schema_sections/library_catalog.py`,
  `app/crate/db/repositories/library_artist_upserts.py` y
  `app/crate/db/migrations/versions/088_featured_artists.py`.
- `app/ui/src/components/charts/InstrumentChart.tsx` y `components/artist/ArtistStatsSummary.tsx`.
- `app/listen/src/components/stats/StatsHeadlineNumbers.tsx`, `StatsGenreTrendView.tsx` y `StatsFreshness.tsx`.
