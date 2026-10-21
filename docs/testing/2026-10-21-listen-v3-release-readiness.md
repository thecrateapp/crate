# Listen V3 — estado previo al despliegue

Fecha: 21 de octubre de 2026. Rama: `feat/crate_v3`, integración previa `390ab456`.
Diego aprueba Bricolage Grotesque para títulos, Roboto para cuerpo y JetBrains Mono
para labels y datos técnicos, y autoriza commit/push de todos los cambios pendientes.
Roboto sustituye la elección anterior de IBM Plex Sans. El despliegue está expresamente pendiente
de autorización; la validación del cierre se registra a continuación.

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

## Integración con main validada localmente

- Main integrado desde `d3e6ef6b`; revisión Alembic única `132`, cadena publicada preservada.
- Builds de Listen, Admin y frontend Desktop; Listen 222571 bytes gzip de JavaScript inicial
  (límite 307200). Typechecks y lint de Listen/Admin, Storybook y catálogos de traducción.
- Backend: 150 tests de migraciones/bootstrap, búsquedas/metadata y OpenAPI; 13 contratos
  de imágenes frontend. PostgreSQL de tests aislado; no se modifica producción.
- Pruebas focalizadas de Select/ConfirmDialog, ajustes y persistencia Playing from, contratos
  operativos de tareas, navegación/AI/show workflows y edición de playlists. Se adaptan los
  tests de formularios nuevos al combobox/listbox/option accesible del Select compartido.
- 17 comprobaciones de navegador en ambos previews: fuentes reales, controles nativos,
  geometría móvil y header de Paths. El catálogo queda consistente.
- No equivale a CI remoto, QA de toda la plataforma ni aprobación de despliegue.

## Pendientes antes del despliegue web

1. **Integración local con main resuelta.** Se integra `origin/main` en `d3e6ef6b`
   (326 commits de main), conservando la identidad y componentes V3 y los nuevos contratos
   de Smart Mix, shows y agentes. La revisión publicada `109` de Smart Mix y la cadena
   `110`–`131` quedan intactas. Stats pasa a `132_instance_listening_rollups.py`, con padre
   `131`, helper/bootstrap y tests actualizados; Alembic debe tener un único head `132`.
   Esta integración en la rama de trabajo no publica cambios en main ni en producción.
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
