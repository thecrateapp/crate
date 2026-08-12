# Jam Rooms: estado actual

Fecha: 2026-08-12
Estado de producto: oculto y desactivado en Listen; no apto para producción.

## Decisión temporal

Jam Rooms queda detrás de `JAM_ROOMS_ENABLED = false` en
`app/listen/src/app-shell/feature-flags.ts`.

- Se elimina el acceso desde el menú de usuario, People y Settings.
- Las rutas `/jam`, `/jam/rooms/*` y `/jam/invite/*` redirigen a Home.
- El código de Jam se conserva para continuar el trabajo localmente; no se
  elimina backend ni contratos existentes.

Para reactivar el acceso hay que cambiar explícitamente el flag en una
iteración posterior, después de completar los criterios de salida de este
documento.

## Estado funcional

La superficie actual incluye salas con modos DJ, automático y Auto DJ, cola
autoritativa de sala proyectada en la cola local readonly, presencia y
websocket, reproducción coordinada, cambios de cola, votos, filtros de género,
snapshot/restauración de la cola local, controles de sala, actividad, búsqueda,
reordenación y acciones de owner.

Esto no debe interpretarse como una funcionalidad lista para producción: la
integración de playback distribuido y la presencia todavía requieren pruebas y
endurecimiento.

## Problemas pendientes conocidos

1. El arranque de una sala puede entrar en una carrera entre `state_sync`, la
   hidratación de la cola y `sync_clock`; el reproductor puede mostrar playing
   sin audio, quedarse en spinner o perder el analyser/spectrum.
2. Las interacciones de sala y algunos cambios de cola/playback todavía pueden
   rehidratar el engine en lugar de aplicar un cambio idempotente, provocando
   seek al inicio, loop del primer segundo o drift entre miembros.
3. El attach del `AudioContext`/analyser no es determinista en el primer track y
   en transiciones anterior/siguiente.
4. La presencia, salida de sala y limpieza de conexiones necesita una matriz de
   pruebas multiusuario y reconexión completa.
5. El estado visual de la cola readonly, el panel de actividad, DnD, artwork,
   autenticación y overflow responsive requieren revisión.
6. Auto DJ necesita cerrar generación/refill, exclusión de duplicados,
   diversidad de artistas, votos y continuidad de reproducción.
7. El UI de Jam todavía no tiene la misma madurez ni lenguaje visual que el
   resto de Listen.

## Corrección incluida en esta iteración

El cambio reciente del engine para promover desktop de HTML5 a WebAudio durante
la reproducción mejora el playback normal y el attach del spectrum fuera de
Jam. La regresión observada estaba en la frontera Jam: durante `state_sync`, la
sala podía llamar `pause()` sobre una reproducción que ya pertenecía a la
fuente `Jam:*`. Ese caso queda protegido sin cambiar el comportamiento normal.

## Criterios para reactivar

- Tests deterministas de entrada, salida, reconexión, `state_sync`, `sync_clock`,
  play/pause/next, refill y votación.
- Dos o más sesiones reproduciendo la misma sala sin eco perceptible ni
  reinicios al interactuar.
- Analyser, spectrum y visualizer conectados en el primer arranque y en todas
  las transiciones.
- Cola autoritativa consistente en la sala, `PlayerContext` y cada miembro.
- Presencia limpia al salir, cerrar pestaña y perder el websocket.
- Smoke test desktop/mobile y responsive; después retirar el kill switch
  explícitamente en una iteración separada.
