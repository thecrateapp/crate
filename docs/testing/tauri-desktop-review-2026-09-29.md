# Revisión profunda de Tauri — 2026-09-29

Commit: c2d9a6616595e20be80ed1662d7500a3083024c9. Rama remota: feat/tauri-desktop-app. [PR 259](https://github.com/thecrateapp/crate/pull/259).

## Dictamen y alcance

La aplicación todavía tiene fallos que impiden considerar cerrado el soporte de macOS, Windows y Linux. Se identifican **20 findings: 4 P1 y 16 P2**, además de oportunidades de rendimiento/refactorización y requisitos de validación de release.

Se revisaron el shell Rust, integración React/Listen, reproducción y recuperación de audio, filesystem/descargas offline, autenticación y multiserver, deep links/enlaces, media controls, ventanas, CI y empaquetado. Algunos fallos residen en código compartido con web/Capacitor: se incluyen porque son alcanzables desde Tauri.

La evidencia combina ejecución local de tests y probes, trazado del código completo y contratos de las dependencias instaladas. **No se ejecutaron las aplicaciones en Windows/Linux ni una campaña manual completa del empaquetado macOS.** Un resultado de contrato no se presenta como una reproducción nativa en esos sistemas.

## P1 — corregir antes de dar offline y sesiones por terminados

### F01. El arranque sin conexión no permite entrar a la biblioteca descargada

**Sistemas:** macOS, Windows y Linux. También afecta al flujo de autenticación compartido.

**Código:** [use-auth-session.ts:24](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/contexts/use-auth-session.ts:24), [RouteGuards.tsx:20](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/app-shell/RouteGuards.tsx:20), [offline.ts:184](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline.ts:184).

**Disparador:** descargar música, cerrar completamente la app, desconectar la red y volver a abrir. AuthProvider comienza con user=null y solo lo establece tras GET /api/auth/me. Mientras falla muestra spinner; después de agotar los reintentos, ProtectedRoute envía a login. El perfil offline persistido no sirve para establecer una identidad local: primeOfflineRuntimeProfile solo hidrata metadata. OfflineProvider además depende del usuario autenticado.

**Consecuencia:** las descargas existen pero no son accesibles tras un reinicio sin red. El funcionamiento offline durante una sesión previamente iniciada no cubre este caso.

**Evidencia ejecutada:** hook real con React/jsdom, usuario persistido, perfil descargado y navigator.onLine=false: tras seis peticiones fallidas, user sigue null y sessionUnavailable pasa a false; el guard redirige a login. Un test actual de AuthContext espera esa redirección y no contempla el acceso local offline.

**Corrección:** bootstrap offline con identidad local asociada a servidor/usuario y acceso limitado a contenido descargado; conservar la distinción entre desconexión y un 401/403 real. Añadir prueba de arranque en frío y de logout previo que prohíba recuperar identidad local.

### F02. La CSP bloquea la lectura offline que usa WebAudio

**Sistemas:** los tres.

**Código:** [tauri.conf.json:31](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/tauri.conf.json:31), [gapless5.js:839](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/gapless5/gapless5.js:839).

media-src permite asset: y http://asset.localhost; connect-src no. El motor WebAudio carga la pista con fetch, por lo que los archivos descargados son bloqueados. El bridge HTTP deja estas URLs al navegador. La modificación automática de CSP de Tauri no añade esas fuentes a connect-src.

**Evidencia ejecutada:** Chromium con la CSP exacta produjo securitypolicyviolation de connect-src para ambas formas de URL. Si HTML5 todavía no reproduce, el manejador de fallo puede descargar la pista y abortar el arranque; si ya reproduce, se pierde la promoción a WebAudio, con efectos sobre EQ, visualizador y gapless.

**Corrección:** permitir las fuentes locales necesarias en connect-src y probar reproducción bajo la CSP del bundle, no solo con Vite.

### F03. Windows no puede inicializar offline en una instalación limpia

**Sistemas:** Windows.

**Código:** [offline-storage.ts:85](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline-storage.ts:85), recognizer duplicado en [offline-native-assets.ts:43](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline-native-assets.ts:43).

El código reconoce mensajes ENOENT Unix y el código de Capacitor. El plugin Tauri serializa el mensaje nativo de Windows: “The system cannot find the file specified. (os error 2)” o la variante de ruta con error 3. La ausencia normal del JSON inicial se propaga como error fatal; también falla la comprobación previa a su primera escritura.

**Evidencia ejecutada:** código real de offline-storage con errores controlados: ENOENT Unix hidrata un índice vacío; ambas variantes Windows rechazan.

**Corrección:** normalizar la ausencia en el adapter con un contrato estable, evitando depender de textos traducidos del sistema. Probar instalación limpia, ruta ausente y fichero ausente.

### F04. El cliente HTTP nativo conserva cookies aunque se solicite credentials: omit

**Sistemas:** los tres; específico del transporte Tauri.

**Código:** [tauri-init.ts:65](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src/lib/tauri-init.ts:65), [Cargo.toml:21](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/Cargo.toml:21), [AuthContext.tsx:42](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/contexts/AuthContext.tsx:42).

El plugin-http 2.5.9 instalado no transmite credentials al comando nativo y activa por defecto un cookie jar persistente. El backend emite cookies también en login por contraseña/refresh de Tauri y admite cookie si falta bearer. Logout ignora fallos de red y borra los tokens del frontend, pero no el jar.

**Disparador e impacto:** iniciar sesión con contraseña, cerrar sesión sin conexión y reabrir online puede recuperar la sesión antigua mediante /api/auth/me, aunque los tokens se hayan eliminado. Eliminar/reagregar un servidor también puede recuperar credenciales residuales.

**Evidencia:** el módulo JS real recibió credentials: omit y generó IPC sin ese campo; el uso incondicional del jar y los contratos backend están comprobados en código. **La resurrección completa de sesión no se ejecutó contra el servidor.**

**Corrección:** transporte bearer sin cookies o implementación que respete credentials, con migración/borrado del jar existente. Regresión logout offline → restart → online.

## P2 — comportamiento, integridad y rendimiento

### F05. Eliminar el servidor activo revoca y borra la sesión del siguiente

**Sistemas:** los tres; compartido con Capacitor.

**Código:** [ServersSection.tsx:60](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/components/settings/ServersSection.tsx:60).

removeServer(A) selecciona B inmediatamente. El logout posterior usa el servidor activo B para la petición y para borrar tokens. En una lista con dos servidores autenticados, quitar A desconecta B y no cierra remotamente A.

**Evidencia ejecutada:** módulos reales de ServersSection, server-store y AuthProvider con entorno controlado: logout dirigido a B y token de B eliminado.

**Corrección:** capturar y cerrar la sesión eliminada antes de cambiar la selección; separar logout remoto de reset local.

### F06. Cambiar a un servidor sin token conserva el usuario anterior

**Sistemas:** los tres; compartido con Capacitor.

**Código:** [ServersSection.tsx:46](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/components/settings/ServersSection.tsx:46), [Login.tsx:55](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/pages/Login.tsx:55).

Cambiar A → B sin token solo navega a /login. AuthProvider conserva user=A y Login redirige inmediatamente al home. La identidad y caches de A quedan en memoria mientras las peticiones ya apuntan a B. Añadir un servidor desde Settings tiene el mismo problema.

**Evidencia ejecutada:** currentServer=B, AuthProvider.user=A y navegación a /login tras el cambio.

**Corrección:** transición coordinada de servidor, con cancelación de peticiones y reset de auth/runtime antes de reautenticar. Cubrir cambio durante reproducción.

### F07. Una recuperación de audio pendiente deshace una pausa o stop posterior

**Sistemas:** los tres; también motor web compartido.

**Código:** [gapless-player-controls.ts:69](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/gapless-player-controls.ts:69).

play/fadeInAndPlay esperan a recuperar el AudioContext y después ejecutan play sin comprobar si llegó un pause/stop. next y gotoTrack(forcePlay) usan el mismo patrón. Los callers solo cambian indicadores de buffering; no invalidan la operación.

**Evidencia ejecutada sobre el módulo real:** play pendiente → pause → resolver recovery produce pause, active=true, play. Lo mismo con stop.

**Corrección:** generación de intención de transporte; comprobarla después de cada await e invalidarla en pause, stop, reemplazo de cola y logout. Evitar una cancelación que solo cambie el estado visual.

### F08. Desmontar el visualizador activo deja su bucle de render vivo

**Sistemas:** los tres; compartido con ExtendedPlayer web.

**Código:** [useMusicVisualizer.ts:122](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/components/player/visualizer/useMusicVisualizer.ts:122).

El cleanup cancela las tareas de inicialización, pero no el RAF que pertenece a MusicVisualizer ni sus recursos GPU. No hay cleanup compensatorio en ExtendedPlayer o sus hooks. Desmontar el árbol mientras el visualizador está activo —por ejemplo durante logout— deja un RAF autorreferenciado sobre un canvas desconectado.

Cerrar normalmente el panel sí llama a stop al cambiar active=false; esa rama pierde la referencia sin llamar a destroy. No se ha medido cuánto tarda el GC en liberar esos recursos.

**Evidencia ejecutada:** probe del código del hook y sus efectos: start llamado; tras unmount, cero stop/destroy. El test existente solo comprueba timers de inicialización.

**Corrección:** ownership único del visualizador y destroy al desmontar; decidir explícitamente si al ocultarlo se conserva o destruye.

### F09. Los enlaces externos pueden sustituir la ventana de Crate

**Sistemas:** los tres.

**Código:** [external-links.ts:15](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/external-links.ts:15).

El helper busca `window.__TAURI__`, pero withGlobalTauri no está habilitado. Cae a window.open con noopener y, si no recibe un handle, navega la ventana principal al destino. El plugin-opener instalado intercepta clicks de anchors, no window.open. No existe la integración que el helper presupone.

**Impacto:** rutas de Bandcamp, biografías, contribuciones y compartir pueden sacar al usuario del shell de Crate.

**Corrección:** bridge de opener explícito y común para todos los enlaces externos, sin usar ausencia de handle como señal para reemplazar la app. Probar que abrir un enlace conserva ubicación y reproducción.

### F10. Vincular Google/Apple desde Settings devuelve 426

**Sistemas:** los tres.

**Código:** [AccountSection.tsx:115](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/components/settings/AccountSection.tsx:115), [auth.py:385](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/crate/api/auth.py:385).

El formulario manda return_to del WebView sin PKCE. El backend exige challenge/state para listen-tauri; incluso añadiéndolos rechaza mode=link. El login OAuth resuelto no cubre este flujo.

**Evidencia ejecutada:** validadores backend reales para los tres orígenes Tauri devuelven 426 “Native app upgrade required”.

**Corrección:** contrato nativo de vinculación ligado a la sesión/usuario y al servidor iniciador; pruebas frontend y backend.

### F11. Last.fm navega fuera del shell y usa un callback incompatible

**Sistemas:** los tres.

**Código:** [ScrobbleSection.tsx:59](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/components/settings/ScrobbleSection.tsx:59).

El flujo navega la ventana principal a Last.fm y prepara un callback tauri://localhost/settings o http://tauri.localhost/settings. No usa el scheme registrado cratemusic ni la ruta del HashRouter; el bridge tampoco maneja este callback.

**Evidencia:** trazado de contrato; no se inició sesión real con Last.fm.

**Corrección:** navegador del sistema y callback nativo validado/asociado al servidor. Probar éxito, cancelación y callback tardío.

### F12. Las invitaciones compartidas contienen el origen local de Tauri

**Sistemas:** los tres; compartido con Capacitor.

**Código:** [playlist-actions.ts:325](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/pages/playlist-actions.ts:325), [use-jam-session-controller.tsx:455](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/hooks/use-jam-session-controller.tsx:455).

Las URLs de invitación se construyen con window.location.origin + join_url. El backend devuelve una ruta relativa, por lo que el destinatario recibe tauri://localhost/... o http://tauri.localhost/... en lugar del host público.

**Corrección:** reutilizar publicShareUrl y cubrir playlist/Jam con orígenes empaquetados. Incluir el controlador duplicado de playlist.

### F13. Una descarga fallida deja archivos fuera del índice y del borrado

**Sistemas:** los tres; compartido con Capacitor.

**Código:** [offline-native-assets.ts:320](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline-native-assets.ts:320).

La descarga escribe directamente al destino y no hay cleanup si rechaza después de escribir bytes. El índice se publica después. Borrar offline enumera únicamente el índice, así que esos archivos permanecen en disco sin contabilizarse.

**Evidencia ejecutada:** corte con parcial escrito, seguido de clearNativeOfflineAssets: el archivo permanece y el espacio calculado es cero.

**Corrección:** descarga temporal, cleanup ante cualquier fallo y reconciliación de huérfanos. Incluir cierre inesperado y error al publicar el índice.

### F14. Cancelar no detiene la transferencia y puede bloquear borrar offline

**Sistemas:** los tres.

**Código:** [tauri-filesystem.ts:114](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src/lib/tauri-filesystem.ts:114), [offline-native-assets.ts:320](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline-native-assets.ts:320).

El AbortSignal se comprueba cuando ya terminó la descarga; el plugin no recibe cancelación ni tiene timeout configurado. Borrar el perfil aborta y espera la misma cola. Un servidor que mantiene abierto el body puede bloquearla indefinidamente.

**Evidencia ejecutada:** abortar una transferencia pendiente no resuelve la promesa; devuelve AbortError únicamente al completar manualmente el transporte.

**Corrección:** cancelación nativa real, deadline y cierre/limpieza del archivo coordinados. Promise.race por sí sola no detiene la escritura.

### F15. Sincronizar puede marcar actualizado un archivo offline obsoleto

**Sistemas:** los tres; compartido con Capacitor.

**Código:** [offline-native-assets.ts:78](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen/src/lib/offline-native-assets.ts:78).

La integridad se comprueba contra el tamaño del índice anterior, priorizado sobre el manifest nuevo, y no se compara updatedAt. Reemplazar/retaguear un archivo conservando identidad puede dejar la copia anterior mientras el item publica la nueva contentVersion.

**Evidencia ejecutada:** archivo cacheado de 100 bytes con fecha antigua; manifest de 200 bytes y fecha nueva; el módulo devuelve la pista como cache válida.

**Corrección:** distinguir integridad del fichero local de vigencia del contenido; invalidar por versión/fingerprint acordado con el manifest.

### F16. Reabrir desde el acceso directo no muestra una ventana oculta

**Sistemas:** Windows y Linux.

**Código:** [lib.rs:967](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/lib.rs:967).

Cerrar siempre oculta la ventana. La segunda instancia solo procesa comandos o URLs reconocidos; un lanzamiento normal no muestra ni enfoca nada. En Linux sin tray visible la app puede resultar inaccesible desde el launcher.

**Evidencia:** trazado completo CloseRequested → single-instance → handle_activation_args. No probado en un escritorio Windows/Linux.

**Corrección:** activación normal debe mostrar, desminimizar y enfocar. Mantener comandos multimedia en segundo plano. Regresión cierre → acceso directo.

### F17. Consultar el tema Linux puede bloquear el hilo de interfaz

**Sistemas:** Linux.

**Código:** [lib.rs:513](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/lib.rs:513), [linux_desktop_theme.rs:44](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/linux_desktop_theme.rs:44).

El comando Tauri es síncrono y llama a block_on para D-Bus y hasta ocho procesos gsettings con output(). No configura deadline y se repite al recuperar foco/visibilidad sin coalescer. Un portal que no responde bloquea la interfaz; el caso saludable también añade trabajo al cambiar de ventana.

[Tauri documenta que los comandos síncronos se ejecutan en el hilo principal](https://v2.tauri.app/develop/calling-rust/#async-commands).

**Corrección:** async/spawn_blocking, deadline, caché y una consulta en vuelo. Probar servicio colgado y ráfaga focus/visibility. No se midió latencia en Linux real.

### F18. Windows SMTC recibe carátulas locales con una API que no las soporta

**Sistemas:** Windows.

**Código:** [windows_media_controls.rs:135](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/windows_media_controls.rs:135).

El bridge materializa portadas data/blob en file://. El código SMTC siempre usa CreateFromUri, que soporta http, https, ms-appx y ms-appdata. La sesión nativa no puede consumir las URLs locales que genera Crate. [Contrato Microsoft](https://learn.microsoft.com/en-us/uwp/api/windows.storage.streams.randomaccessstreamreference.createfromuri?view=winrt-28000).

**Corrección:** para archivos de caché validados, StorageFile y CreateFromFile. Prueba Windows con portada local y eliminación/renovación de caché.

### F19. La caché de carátulas MPRIS crece sin límite

**Sistemas:** Linux.

**Código:** [linux_media_controls.rs:334](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/linux_media_controls.rs:334), [lib.rs:232](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/src/lib.rs:232).

Crea un fichero por hash de URL completa/contenido en crate/mpris-artwork sin poda. La caché JS de 24 entradas no borra esos ficheros y el branch Linux devuelve evicted_urls vacío. Renovar URLs firmadas puede duplicar la misma portada. macOS/Windows sí usan una caché limitada.

**Corrección:** implementación común con límites de entradas/bytes y publicación atómica. Test con muchos álbumes y renovación de tickets.

### F20. Los tags de release no cambian la versión interna de los paquetes

**Sistemas:** los tres.

**Código:** [Makefile:1053](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/Makefile:1053), [build-desktop.yml:277](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/.github/workflows/build-desktop.yml:277), [tauri.conf.json:4](/Users/diego/.codex/worktrees/tauri-desktop-analysis/musicdock/app/listen-desktop/src-tauri/tauri.conf.json:4).

La versión de config y Cargo es 0.1.0. TAURI_RELEASE_VERSION y GITHUB_REF_NAME se usan para nombrar los artefactos, sin pasar una versión distinta a Tauri. Distintos tags pueden generar archivos con nombres distintos pero idéntica versión nativa.

**Evidencia:** todos los caminos de empaquetado revisados; el Info.plist del bundle local contiene CFBundleVersion y CFBundleShortVersionString 0.1.0. No se afirma un rechazo universal de upgrades MSI/NSIS sin probar instaladores.

**Corrección:** una versión canónica aplicada antes de compilar; verificar metadata real de .app/.deb/.rpm/.msi en CI, además del nombre del archivo.

## Rendimiento y refactorizaciones recomendadas

Estas recomendaciones se distinguen de los fallos anteriores; no se han medido mejoras de latencia/RSS en los tres sistemas.

1. **Transporte HTTP.** La versión instalada de plugin-http construye un reqwest::Client por petición. El wrapper lo usa para casi todos los HTTPS. Medir un cliente compartido o fetch del WebView donde CORS ya lo permite; preservar streaming, AbortSignal, redirects y semántica de credenciales. En fetch_send se observan además recursos FetchRequest/AbortSender sin cierre en éxito: verificar mediante un soak test y corregir/actualizar la dependencia antes de cuantificar RSS.

2. **Filesystem offline por lotes.** stat calcula una URI con appLocalDataDir + join aun cuando el caller solo necesita tamaño. La hidratación resuelve muchas URIs mediante Promise.all y repite IPC. Cachear la raíz y ofrecer operaciones por lotes. El límite de ocho verificaciones es por lote de 500; varios lotes se ejecutan en paralelo, por lo que no limita globalmente.

3. **Persistencia offline incremental.** Cada pista serializa y rota el índice JSON entero. El coste acumulado crece cuadráticamente con el número de pistas añadidas. Primero agrupar escrituras manteniendo publicación atómica; considerar almacenamiento incremental solo si el tamaño real lo justifica.

4. **Media session por diferencias.** Separar metadata/artwork de posición/estado. En la revisión, el hook enviaba el snapshot completo cada segundo; el puente de Tauri ya filtra metadatos repetidos y usa comandos de posición/estado, así que Windows no vuelve a cargar la carátula y Linux no emite metadata por cada tick. Seguimiento y pruebas: [`R06`](tauri-hardening-validation-2026-09-30.md#r06-media-session-por-diferencias).

5. **Visualizador y batería.** Resolver F08 primero. powerPreference=high-performance está fijado para todos los perfiles; la calidad Linux y default es idéntica. Hacer la preferencia explícita por perfil y medir frame time/consumo. setSize tampoco conserva el límite/DPR aplicado por el constructor: centralizar el cálculo de resolución. El límite de dos pistas decodificadas en WebAudio evita decodificar toda la cola, pero conviene un presupuesto por bytes/duración para pistas largas.

6. **Fronteras de plataforma.** Reducir la dispersión entre isNative, isTauriRuntime, usesNativeFilesystem e isOfflineNativeRuntime mediante capacidades pequeñas y explícitas (auth, archivos, opener, media session). Evitar un cambio global de isNative: activaría accidentalmente plugins Capacitor stub.

7. **Una transición de sesión/servidor.** Centralizar el orden: capturar scope, cancelar peticiones/transfers, detener playback, resetear identidad/cache, seleccionar destino y autenticar. Evita duplicar la lógica entre Settings, ServerSetup, logout y callbacks.

8. **Permisos y errores.** Sustituir upload:default por el mínimo necesario. El plugin-upload instalado no aplica el scope de plugin-fs a sus rutas; un comando propio limitado a offline-media también permite cancelación y errores tipados. La permanencia de tokens Tauri en localStorage es deuda explícita del proyecto, candidata a almacén seguro del sistema. No se ha demostrado explotación ni fuga externa.

9. **Errores observables.** Reemplazar catches silenciosos de capacidades críticas por errores tipados y telemetría sin credenciales. Los fallos opcionales de carátulas no deben detener reproducción; auth/persistencia no deben aparentar éxito.

## Compatibilidad y condiciones de release

- **Versiones mínimas sin alinear.** El bundle local declara LSMinimumSystemVersion=10.13; el Vite instalado compila por defecto para Safari 16.4, y Tailwind 4 también requiere Safari 16.4. Definir sistemas/WebViews realmente soportados y reflejarlos en el bundle y documentación. También falta un mínimo explícito de WebView2. [Tauri: minimumSystemVersion](https://v2.tauri.app/reference/config/#minimumsystemversion-1), [Tailwind: soporte de navegador](https://tailwindcss.com/docs/compatibility#browser-support).
- **Distribución macOS.** CI publica el target de testers con firma ad hoc. Definir y validar el flujo de firma/notarización de release y la instalación desde descarga real; una compilación correcta no verifica Gatekeeper.
- **macOS media controls, pendiente de prueba.** El código nativo actualiza metadata PlaybackRate pero no MPNowPlayingInfoCenter.playbackState. [Apple pide mantener este estado](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter/playbackstate). La MediaSession del WebView podría compensarlo, por lo que no se cuenta como fallo de controles reproducido.
- **Geometría Linux.** Unmaximize fuerza 1280×820 y centra, perdiendo geometría anterior; no se consulta el área útil del monitor. El mínimo final lo reduce Rust a 1024×700: no confundirlo con el mínimo inicial del JSON.
- **Códecs y escritorios Linux.** Verificar originales soportados por cada WebView, paquetes GStreamer en .deb/.rpm/AppImage, Wayland/X11, GNOME/KDE y ausencia de tray. No se ha afirmado que todos los códecs o escritorios fallen.
- **CI del HEAD revisado.** Frontend Tests y React Doctor verdes. El [build desktop de c2d9a661](https://github.com/thecrateapp/crate/actions/runs/36584621610) está skipped porque el PR es draft. No existe evidencia de compilación Windows/Linux para este HEAD en esa ejecución. No se alteró el estado del PR.

## Verificación realizada

| Comprobación                                                   | Resultado                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Desktop Vitest                                                 | 4 archivos, 25 tests correctos                                    |
| Listen Vitest completo                                         | 307 archivos, 2.287 correctos y 4 omitidos                        |
| Desktop TypeScript + Vite production build                     | Correcto                                                          |
| Cargo test --locked, host macOS                                | 19 correctos                                                      |
| Cargo clippy --locked --all-targets -- -D warnings, host macOS | Correcto                                                          |
| CSP local con Chromium                                         | Confirma bloqueos asset en connect-src                            |
| Offline con filesystem/transporte controlados y módulos reales | Confirma Windows ENOENT, parciales, cancelación y vigencia        |
| Auth/multiserver con módulos reales y entorno controlado       | Confirma transición/eliminación de servidor e IPC sin credentials |
| Validación backend de OAuth link                               | 426 para los tres orígenes Tauri                                  |
| Arranque offline con hook real React/jsdom                     | Sin identidad local tras seis fallos; termina en login            |
| Recuperación audio con módulo real                             | Play posterior a pause/stop reproducido                           |
| Ciclo de efectos del hook de visualizador                      | Unmount activo sin stop/destroy reproducido                       |

Los probes usan módulos reales con dobles en fronteras concretas; no sustituyen una prueba E2E del dispositivo. Se mantuvo intacto el código de producto.

## Matriz mínima de aceptación posterior a los fixes

| Escenario                                                              | macOS ARM e Intel | Windows   | Linux     |
| ---------------------------------------------------------------------- | ----------------- | --------- | --------- |
| Instalación limpia, arranque y upgrade con versión comprobada          | Pendiente         | Pendiente | Pendiente |
| Password/OAuth, cancelación, reinicio y logout offline                 | Pendiente         | Pendiente | Pendiente |
| Cambio/eliminación de servidor y callbacks tardíos                     | Pendiente         | Pendiente | Pendiente |
| Descargar, reiniciar sin red, reproducir y buscar dentro de la pista   | Pendiente         | Pendiente | Pendiente |
| EQ, visualizador, gapless y originales por códec                       | Pendiente         | Pendiente | Pendiente |
| Red cortada, descarga abortada, disco lleno, cierre durante escritura  | Pendiente         | Pendiente | Pendiente |
| Sleep/wake, Bluetooth/device change, pause durante recovery            | Pendiente         | Pendiente | Pendiente |
| Cerrar/reabrir, minimizar, tray/dock y media keys                      | Pendiente         | Pendiente | Pendiente |
| Enlaces, invitaciones, vinculación de cuenta y Last.fm                 | Pendiente         | Pendiente | Pendiente |
| Reproducción prolongada: RSS, recursos IPC, GPU y crecimiento de disco | Pendiente         | Pendiente | Pendiente |

Orden propuesto: F01–F04; después F05–F08 y F13–F16; después integraciones/plataforma; por último empaquetado, rendimiento medido y matriz nativa. Cada bloque debe incorporar regresiones que fallen antes de aplicar el fix.
