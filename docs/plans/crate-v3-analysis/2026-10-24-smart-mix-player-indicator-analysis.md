# Smart Mix en el fullscreen Android: análisis y propuesta

**Seguimiento:** el usuario simplificó y autorizó después el indicador para mostrar sólo la ejecución real, sin previsión, con azul para Crossfade y amarillo para Beatmatch y el mismo color en un aro existente del disco. Véase el [informe de implementación](2026-10-24-player-mix-resolution.md). El análisis siguiente conserva la propuesta original y sus hallazgos del contrato.

Propuesta de interfaz y contrato; no implementada. El usuario quiere identificar la próxima transición y comprobar si se ejecutó la técnica prevista, con una señal mínima acorde con Listen.

## Propuesta visual

Un readout dentro del bloque de progreso actual, justo encima del seek, con su misma anchura. Reutiliza MonoLabel y StatusDot, sin panel, borde, chip ni icono decorativo. Permite dos líneas con altura estable en pantallas estrechas y participa del scroll de PlayerStage.

| Momento                | Texto ilustrativo                           | Tratamiento                                                                                                            |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Esperando plan         | Preparando transición                       | Gris; no inventa un modo.                                                                                              |
| Plan instalado         | Previsto · Beatmatch + Bass handoff · 4 s   | Gris.                                                                                                                  |
| Ejecución confirmada   | En curso · Beatmatch + Bass handoff · 4 s   | Accent, sin pulso en bucle.                                                                                            |
| Degradación confirmada | En curso · Crossfade · Alternativa aplicada | Estado de advertencia y explicación del motivo en Info.                                                                |
| Final                  | Última · Crossfade · Completada             | Se conserva brevemente para comprobar el resultado; Info mantiene el último resultado aunque llegue el siguiente plan. |

Sólo se muestra con Smart Mix habilitado. Sin siguiente pista, expresa ese estado en lugar de mantener un plan de otro par. Con un plugin antiguo, puede mostrar previsión y ejecución sin confirmar, nunca presentar una previsión como hecho.

Los nombres legibles son Gapless, Crossfade y Beatmatch. Bass handoff es un complemento del Beatmatch, no un modo excluyente; cuando se aplica se muestra junto a él.

Una alternativa sería marcar el aro del disco por técnica. Tiene mayor presencia gráfica, pero comunica peor la diferencia entre previsión y ejecución y comparte espacio con la visualización de reproducción. La recomendación es el readout por su legibilidad y menor impacto en el disco. No se propone otra barra de progreso: el reproductor ya representa la mezcla en artwork/identidad.

Info puede recoger modo previsto/efectivo, duración real, Bass handoff efectivo y motivo de fallback. Tempo, fase y confianza pertenecen a ese detalle, no al primer nivel. Los motivos deben traducirse por su significado real; `low_confidence` también se usa cuando Beatmatch no está autorizado.

## Qué existe y qué falta

- `app/listen/src/lib/playback-engine.ts:37`: EngineTransitionPlan incluye modo, Bass handoff, duración, cues, tempo, handoff, confianza y fallbackReason. Los planes instalados de AndroidNativeEngine son privados y no llegan al contexto visual.
- `app/listen/src/components/player/FullscreenPlayerTabs.tsx:72`: el bloque de progreso ofrece la ubicación propuesta, después de la identidad y antes de transportes.
- `CrateNativePlaybackService.java:2275`: transitionStarted/Progress/Ended transmiten un `crossfade` genérico, IDs, duración, progreso y volúmenes; no incluyen técnica prevista/efectiva o motivo.
- `NativeMixController.java:242`: la técnica efectiva se decide en ejecución según preroll, muestras y error de fase. Un plan Beatmatch puede terminar como Crossfade sin Bass handoff.
- `NativeMixController.java:395`: isBeatmatching deduce por velocidad distinta de 1. No basta para diagnóstico: puede haber engagement efectivo y Bass handoff con ratio 1. Debe retenerse el resultado explícito de beginTransition.
- `CrateNativePlaybackService.java:2099`: algunos fallbacks se registran sólo en logs. También se ajustan cues/duración y puede generarse un plan local missing_plan.
- Android puede ampliar cola y resolver planes en segundo plano. El snapshot actual no incluye plan/ejecución; el caché JS no es autoridad suficiente al volver a la WebView.

## Contrato mínimo para una señal veraz

El servicio nativo publica en snapshot y eventos el par saliente/entrante y revisión; plan vigente; estado de preparación/mezcla/final/cancelación/fallback; modo y Bass handoff realmente aplicados; duración efectiva; identificador de ejecución y motivo de fallback. Se conservan nativeSequence/nativeTimeMs para descartar estados antiguos.

El engagement y Bass handoff efectivos se guardan explícitamente en el controller. Se emite también el fallback que hoy sólo aparece en logs. El indicador consume eventos y se rehidrata del snapshot al volver de segundo plano, sin polling nuevo. Los campos serán opcionales para plugins anteriores.

La futura comprobación debe cubrir plan Beatmatch→Crossfade real, Bass handoff a ratio 1, fallback sin mezcla, cambio de cola/revisión, recuperación desde segundo plano, plugin antiguo y geometría móvil con textos localizados largos. Los anuncios accesibles se producen al cambiar de estado, no con cada actualización de progreso.
