# Listen V3 — estado previo al despliegue

Fecha: 21 de octubre de 2026. Rama: `feat/crate_v3`, base del lote `85a05ac8`.
Diego aprueba Bricolage Grotesque para títulos, IBM Plex Sans para cuerpo y JetBrains Mono
para labels y datos técnicos, y autoriza commit/push de todos los cambios pendientes.
Este documento no acredita merge, CI remoto ni despliegue.

## Lote aprobado

- Identidad tipográfica compartida en Listen y Admin, incluyendo fuentes locales y licencias,
  exportaciones para compartir, Storybook y previews. Los candidatos alternativos permanecen
  aislados en el comparador y no se importan desde las apps.
- Shell Linux con vista de producción, controles existentes, etiquetas traducidas y tooltips.
  Diagnóstico Tauri solo DEV, desmontaje correcto, scroll, Escape y retorno de foco.
- Contratos Capacitor de Atrás, teclado y viewport. Paths elimina el enlace redundante del header.

## Evidencia local del cierre

- Builds de Listen, Admin y frontend Desktop; presupuesto inicial de Listen por debajo de 300 KiB gzip.
- 49 tests shared de tokens, fuentes, políticas de preview y catálogo.
- 59 tests Listen de diagnóstico, bootstrap Capacitor, Paths, exportación y política de tokens;
  56 tests Desktop. Catálogos: cero errores y advertencias.
- Tipografía comprobada con fuentes realmente cargadas en ambos hosts y 360/390/1440 px,
  Mono invariable, campos a 8 px, controles y error de carga. Admin real con fixtures a 390/1440 px.
- Storybook y catálogo actualizados. El corte nativo cuenta además con las pruebas y el build
  Linux documentados en [Native shells](../../tools/crate-ui-showcase/LISTEN_NATIVE_SHELLS.md).

La ejecución de pruebas de este lote es focalizada. No sustituye la suite completa de fase,
CI del futuro merge, QA de accesibilidad manual ni pruebas en dispositivos físicos.

## Pendientes antes del despliegue web

1. **Integrar con main y resolver la colisión de migraciones.** Tras el fetch de este cierre,
   `origin/main` tiene 326 commits ausentes de la base local y la base de la rama 146 ausentes
   de main. No se ha intentado el merge ni se ha certificado ausencia de otros conflictos.
   Esta rama añade `109_instance_listening_rollups.py` (`revision="109"`, padre `108`);
   main ya contiene `109_smart_mix_profiles.py`, con el mismo identificador y padre, y llega
   hasta la revisión `131` en esa observación. La migración de Stats y sus referencias deben
   reconciliarse con el head vigente. No aplicar ambas como si fueran una sola migración.
2. **Validar el SHA integrado.** Pasar CI/cierre completo de frontend, contratos backend/readplane
   afectados y revisión de diferencias visuales. No actualizar baselines automáticamente para
   ocultar drift. En pruebas más amplias del preview Admin se observaron un `System` embebido
   ausente y un panel Maintenance que permanecía tras Escape; falta determinar su causa y si
   afecta a la app real o al fixture. Las comprobaciones tipográficas focalizadas sí pasan.
3. **Construir el release de main y ejecutar preflight.** El workflow Build & Push Docker Images
   publica imágenes/manifest para main. Usar `make deploy-preflight VERSION=<full-main-sha>`
   sobre el release integrado. No se ha ejecutado preflight de un SHA futuro.
4. **Actualizar el backend y comprobar los datos junto a Listen.** API, readplane y workers deben
   corresponder al mismo release que el frontend. Validar migraciones, backfill/rollups de Stats,
   snapshots y metadatos completos de pistas/EQ. La instancia local sigue conectada a la API de
   producción anterior, por lo que no acredita los nuevos contratos del servidor.
5. **Smoke tras el rollout controlado.** Login/sesión, covers, reproducción/seek/volumen/EQ,
   cola y persistencia, búsqueda, Stats/Paths, playlists/crates, upload y offline con covers.
   Usar el procedimiento image-first con health checks y rollback del repositorio.

El alcance visual aprobado está cerrado; los pasos anteriores son de integración y validación
del release. Los instrumentos de producto futuros del plan H3 y la adopción completa de Admin
no se declaran terminados por este cierre de Listen.

## Pendientes propios de las apps nativas

Son un gate de distribución nativa independiente del despliegue web: builds/artefactos CI
del SHA integrado para los tres OS, instalación y upgrade, QA física de OAuth, audio en segundo
plano, sleep/resume, controles del sistema, safe areas/teclado y offline en iOS/Android.
Este host Linux no tiene JDK/adb/Xcode ni dispositivos conectados. macOS mantiene firma ad-hoc;
iOS necesita su canal y firma de distribución validados. Los resultados de otros SHA no
certifican este release.
