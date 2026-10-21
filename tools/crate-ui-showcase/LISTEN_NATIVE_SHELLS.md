# Listen1BE · Native shells

Base web aprobada, commit y push: `85a05ac8` en `feat/crate_v3`.
El 21 de octubre Diego aprueba el cierre tipográfico y autoriza commit/push de todo el lote
pendiente, incluido este corte nativo. No se ha desplegado.

- Preview: <http://127.0.0.1:5186/review-1be-native-chrome.html>.
- Storybook: `reviews-1be-native-chrome--complete` y `--capacitor`.
- Documentación: `listen-native-chrome--docs` y `listen-capacitor-shell--docs`.
- Móvil aislado: <http://127.0.0.1:5186/review-1be-native-chrome.html?view=mobile>.

## Alcance

La barra Linux usa la vista de producción: canvas opaco, MonoLabel, TooltipHint sin
`title` nativo y los controles compactos ya existentes (36px de barra, 28px de target,
13px de punto). La posición GNOME se conserva, junto a drag, doble click,
maximizar/restaurar y limpieza de listeners. Los controles de ventana son una
excepción explícita a las acciones convencionales de 44px. macOS y Windows conservan
sus decoraciones del sistema. I18nProvider también cubre la barra Linux.

El diagnóstico Tauri DEV compone Card, Button y MonoLabel con scroll acotado,
orden reciente primero, vaciado, Escape y retorno de foco. No monta ni se suscribe
fuera de Tauri DEV; cerrado solo ocupa el ancho de su trigger. El override Linux
retiene `backgroundThrottling: disabled` y `dragDropEnabled: false` al reemplazar
el array de ventanas. No se modifican permisos, keyring, identificadores ni audio.

Capacitor reutiliza MobileShellView, TopBarView, MobileNavigationView y
PlayerBarFrame en una escena con rutas locales. Solo se simulan los valores del
entorno: insets 44/34px y reserva de teclado de 300px, restaurados al salir.
No se simula un teclado WebView real ni se inicia playback. Las pruebas de bootstrap
comprueban por separado Atrás (overlay → history → exit), listeners únicos,
notificaciones del teclado iOS, scroll del campo enfocado y cambios de viewport.
No se necesitó cambiar ese comportamiento de producción.

La enmienda de Paths retira el BackLink del header normal: PageHeader empieza
directamente por su identidad, sin fila o margen reservado. La escena de Radio/Paths
importa la misma vista y refleja el cambio automáticamente.

## Evidencia local · 2026-10-21

- Desktop: 56 Vitest; 15 tests de versión y 4 del verificador glibc.
- Rust: 54 tests con `cargo test --locked`, tras construir el frontend del ejemplo
  `http_resource_probe` requerido por su macro. Warnings de Wry vendorizado existentes.
- Tauri: build Linux debug, sin bundle, mediante `scripts/tauri-cli.mjs`; ejecutable
  compilado en `src-tauri/target/debug/crate-desktop`. No se ha ejecutado la app.
- Frontend Desktop y bundle Capacitor: build correcto; `cap sync` Android/iOS correcto.
- Listen: 111 tests de contratos de bootstrap, sesión/OAuth/runtime, tokens e i18n
  en la primera ejecución; 38 de diagnóstico DEV, bootstrap, header y páginas Paths
  en la ejecución final (13 de bootstrap comunes a ambas ejecuciones).
- Browser: 6 pruebas de esta escena, ambos hosts y 375/430px: gap8px, controles,
  Escape/foco/vaciado, insets, unión player/nav, reserva del teclado, navegación local,
  desmontaje/restauración del entorno y ausencia de overflow horizontal.
- Paths: 4 pruebas adicionales, ambos hosts y 375/1200px, comprueban que la
  identidad empieza la cabecera sin enlace de retorno ni una fila vacía.
- El addon a11y deja 0 violaciones en la escena desktop tras hacer enfocable el
  detalle con scroll. Mantiene 2 grupos inconclusos para revisión manual:
  semántica del PageHeader compartido dentro de main y contraste de contenido
  parcialmente oculto por su región de scroll. No equivalen a certificación AT.
- Typechecks Listen/Desktop/Storybook y build Storybook correctos.
- Las tres instancias permanecen activas: Listen5174 contra API habitual de producción,
  Storybook6006 y preview5186.

## Antes de desplegar

**Web:** la combinación Bricolage Grotesque + IBM Plex Sans + JetBrains Mono está
aprobada. Quedan integración con `main`, CI/cierre de fase y preflight. Hay una colisión
comprobada: esta rama define `revision="109"` para instance listening rollups y `main`
la usa para Smart Mix profiles. Hay que reconciliar el historial y la revisión de Stats
al integrar, antes de aplicar migraciones; no desplegar esta rama directamente como main.
API, readplane, workers y frontend deben pertenecer al mismo release. Validar backfill,
rollups y snapshots; el frontend local aún apunta al backend de producción anterior.
Después, smoke de sesión, artwork, playback, Stats, Paths, búsqueda y offline.
Detalle y límites: [readiness del release](../../docs/testing/2026-10-21-listen-v3-release-readiness.md).

**Nativas:** el build local no certifica distribución. Este host Linux no dispone de
JDK/adb/Xcode ni dispositivos conectados. Quedan builds/artefactos de CI en los tres OS,
instalación/upgrade y QA real de OAuth, audio en segundo plano, sleep/resume, controles
del sistema, teclado/safe areas y offline en iOS/Android. Las matrices anteriores de
`docs/testing/tauri-hardening-validation-2026-09-30.md` no certifican este nuevo SHA.
macOS mantiene firma ad-hoc conforme a la política actual. La elección de canal de iOS
y su firma/distribución también tiene su validación propia.
