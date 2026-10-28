# Indicador de transición real en fullscreen Android

Implementación completada, con revisión independiente y comprobaciones finales verdes, en `feat/crate_v3`, worktree `/home/diego/.codex/worktrees/crate-v3-1q/crate`. El alcance definitivo del usuario descarta la previsión y muestra sólo la técnica aplicada por el motor.

## Comportamiento

- Readout encima del seek, con MonoLabel y StatusDot compartidos, sin tarjeta, borde ni icono decorativo.
- Crossfade real en azul (`--state-info`), Beatmatch real en amarillo (`--state-warning`). El intercambio de graves se nombra sólo si se aplica realmente.
- Se reutiliza una de las líneas existentes de 1px del disco. Indicador y aro consumen el mismo mapa de colores; no hay otro anillo ni pulso en bucle.
- Pausa o buffering vuelven neutro el indicador y apagan el aro. Fin, cancelación, seek, cambio de cola o salida remota no conservan una mezcla activa.
- Gapless es neutro y corresponde a la política nativa efectiva, incluidas las secuencias de álbum. No se deduce una futura mezcla de los planes, BPM o reloj visual.
- Plugins antiguos sin telemetría dejan el indicador ausente; Cast/Connect remoto invalidan la autoridad local. No se muestran datos nativos anteriores al volver a local.

El indicador requiere una build Android que incluya los nuevos campos/eventos del plugin nativo. Actualizar sólo la web no añade esa telemetría a una APK antigua.

## Fuente y recuperación

NativeMixController retiene el engagement decidido en ejecución, incluido ratio 1, y el Bass handoff efectivamente aplicado. El servicio publica `mixStateChanged` discretos y `mixState` en el snapshot; la deduplicación semántica evita eventos/secuencias por tick. El bridge reutiliza las suscripciones y reconciliación existentes, sin polling nuevo ni actualizaciones de progreso en el provider.

La revisión independiente encontró y cerró tres carreras: cancelar antes de cambiar revisión/decks al reemplazar cola; rechazar revisiones ajenas antes de consumir el watermark; y no borrar un Gapless nuevo mediante un evento legacy de fin/cancelación. Las generaciones de carga/snapshot también rechazan resultados supersedidos.

## Like y Más opciones

Se confirmaron overrides exclusivos del fullscreen con fondo y borde redondos. Ambos reutilizan ahora `buttonVariants(ghost, icon-lg)`, sin copiar estilos. Se conservan 44px táctiles, tooltips compartidos, corazón activo/animación y menú real con foco y teclado.

## Verificación

| Área                           | Resultado                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core Android                   | 76 pruebas JUnit focales verdes; fuentes reales de controller/plan/estado/interfaces y JSObject de Capacitor compiladas.                                           |
| Bridge, autoridad y contexto   | 9 suites / 65 tests verdes, con revisión independiente sin findings pendientes.                                                                                    |
| Player focal                   | 4 suites / 70 tests verdes, con 4 omisiones previas. Incluye indicador, aro, integración fullscreen, acciones y menú.                                              |
| Colores y readout en navegador | 3/3 casos verdes a 393×873, 320×568 y 740×360 con componentes reales y estado nativo simulado; azul/amarillo, línea de 1px, pausa, limpieza, Gapless y traducción. |
| Fullscreen móvil               | 3/3 casos verdes a 393×873, 320×568 y 740×360; safe areas, disco completo, scroll, Like/More transparentes sin borde y targets≥44px.                               |
| Listen completo                | 495 suites / 3.791 tests verdes, con 4 omisiones previas. Log `/tmp/listen-mix-full-tests.log`.                                                                    |
| Desktop                        | Typecheck y 10 suites / 56 tests verdes.                                                                                                                           |
| Calidad                        | Typecheck, lint, build, i18n y Storybook typecheck verdes. Catálogo: 81 documentados / 95 entradas, sin huellas ajenas actualizadas.                               |
| Bundle                         | 224.711 bytes gzip iniciales, presupuesto 307.200. Se conserva el aviso previo no bloqueante de chunk superior a 500kB.                                            |

Pruebas rojo→verde de engagement a ratio 1, reemplazo de cola, nuevas presentaciones y retirada de fondos de acciones. API/media simulados; sin audio ni producción reales.

No hay SDK Android/Gradle local: se compiló y probó el core real con soportes mínimos de plataforma fuera del repositorio. La guardia de orden del servicio identifica su `TEST_GAP`; se validó sintaxis, pero no se compiló la APK completa ni se ejecutaron callbacks/DSP en un dispositivo físico.

[Crossfade](/tmp/listen-mix-crossfade-oct24.png) · [Beatmatch](/tmp/listen-mix-beatmatch-oct24.png) · [Fullscreen sin fondos de Like/More](/tmp/listen-fullscreen-393x873-oct24.png).
