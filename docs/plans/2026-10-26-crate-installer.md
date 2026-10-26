# Instalador de Crate: wizard CLI y copiloto MCP

2026-10-26 · plan aprobado por Diego.

## Objetivo

Instalar y configurar Crate debe ser fácil aunque el proceso no lo sea. Un binario `crate` guía al
usuario por pasos, le explica qué activar, le dice dónde conseguir cada token o API key, valida lo
que introduce y deja la instancia arrancada y comprobada. El mismo binario expone un servidor MCP
para que un agente (Claude, Codex…) instale Crate conversando con el usuario.

## Decisiones de Diego (2026-10-26)

- El instalador es un binario Go con la librería charm (huh, lipgloss, bubbletea).
- Las imágenes multi-arch (amd64 + arm64) entran en este plan.
- El wizard web de Setup se retira: las keys pasan a ser del CLI.
- El copiloto de IA va directamente por MCP (`crate mcp`), sin un modo intermedio solo-JSON.

## Estado de partida

- `install.sh` instala Docker, ofrece los modos de acceso y genera `.env`, pero escribe las API
  keys vacías, no genera `CRATE_CREDENTIAL_KEY` ni los secretos de federación y no valida nada
  tras el arranque.
- Las imágenes se publican solo para `linux/amd64`.
- El wizard web solo aparece sin usuarios, y el seed siempre crea el admin. Además guarda en la DB
  keys que los servicios solo leen del entorno.
- Crate no tiene endpoints que prueben las keys de enrichment.
- `.env.example`, README y docs tienen variables que ya no existen.

## Arquitectura

- **Manifiesto** `deploy/install/integrations.yaml`: única fuente de verdad de la configuración de
  instalación. Describe el núcleo (rutas, acceso, secretos generados) y cada integración: qué es,
  por qué activarla, variables, dónde conseguir la key, consejos, validación, servicios/perfiles
  de compose y dependencias. Lo leen el wizard, `doctor`, el servidor MCP y la documentación.
  Un test de deriva comprueba que el manifiesto y `docker-compose.home.yaml` no se separan.
- **Binario `crate`** en `app/installer` (módulo Go). Embebe el manifiesto, el compose home y su
  configuración, de modo que cada versión instala exactamente lo que se publicó con ella.
  Comandos: `install`, `configure [integración]`, `doctor`, `upgrade`, `mcp`.
- **Bootstrap** `install.sh`: detecta SO y arquitectura, descarga el binario de GitHub Releases,
  verifica el checksum y ejecuta `crate install`.
- **Secretos**: `.env` con permisos 600; nunca se imprimen; la validación va directa al
  proveedor. En modo MCP el agente no ve los secretos: los teclea el usuario en un prompt oculto.

## Fases

| Fase | Contenido | Hecho cuando |
| --- | --- | --- |
| 1 | Manifiesto y test de deriva. Binario con comprobaciones previas, básicos, acceso, resumen, aplicación, arranque y espera de salud. Secretos que faltan. Bootstrap nuevo y workflow de release del binario | `crate install` deja una instancia home funcionando en Linux y macOS |
| 2 | Integraciones con validación en vivo, `configure`, `doctor`. Perfiles `soulseek` y `cast` en el compose home | Cada integración del manifiesto se puede activar, validar y cambiar después |
| 3 | `crate mcp` con herramientas plan/set/validate/apply/doctor, secretos por prompt local, guía para conectarlo a Claude Code y Codex | Un agente instala Crate de principio a fin pidiendo solo lo necesario |
| 4 | Imágenes multi-arch, retirada del wizard web de Setup, `.env.example`/README/docs generados o verificados contra el manifiesto | Instalable en arm64 y sin documentación desviada |

## Verificación

- Go: tests table-driven por paquete; el wizard se prueba con modelos huh en modo accesible y con
  un `Runner` falso de Docker.
- Test de deriva del manifiesto en CI.
- Validación manual de cada fase en una VM limpia antes de publicarla.

## Estado (2026-10-26)

- **Fase 1 hecha.** Manifiesto con test de deriva contra el compose home; binario `crate` en
  `app/installer` con comprobaciones (sistema, arquitectura, memoria, disco, Docker y puertos),
  básicos con resumen de la librería, acceso en los cuatro modos con validación del token de
  Cloudflare, cuenta admin, revisión, escritura, nombres locales con comandos visibles antes de
  ejecutarlos, `pull`/`up` y espera de salud. Genera los secretos que faltaban
  (`CRATE_CREDENTIAL_KEY`, secretos de federación) y los pasa por el compose home junto con
  `CRATE_INSTANCE_NAME` y `CRATE_PUBLIC_API_BASE_URL`. Reconfigurar conserva secretos y líneas
  manuales. `install.sh` es ya el bootstrap con checksum; el workflow `Installer` prueba en cada
  cambio y publica los binarios en los tags.
- Pendiente de la fase 1: la prueba de arranque completo en una VM limpia (Linux y macOS).
- **Fase 2 hecha.** Paso de integraciones con selección agrupada (recomendadas preseleccionadas),
  guía y URL por integración y validación en vivo contra cada proveedor (Last.fm firmado con el
  secreto, Fanart.tv, Spotify, Discogs, Setlist.fm, Ticketmaster, slskd, Gemini, OpenAI,
  Anthropic, Ollama y Telegram). Distingue clave rechazada de proveedor inalcanzable y ofrece
  reintentar, guardar igualmente o dejarlo para luego. Flujos propios para Soulseek (slskd de
  Crate con el perfil `soulseek` o servidor propio), IA (proveedores y modelo por defecto),
  agentes MCP (lectura o acciones; OAuth con HTTPS público), Telegram (detecta el chat ID) y
  Tidal (se conecta tras arrancar). `crate configure [integración]` y `crate doctor [--json]`.
  Telegram pasa ya al compose home. Reconfigurar no pisa valores que el wizard no pregunta.
- **Cambio sobre el plan:** sin perfil `cast`. Un receptor de Cast propio solo sirve registrado
  en Google y con las apps compiladas con su app ID; en una instalación doméstica las apps usan el
  receptor por defecto.
- **Fase 3 hecha.** `crate mcp` (SDK oficial de MCP para Go) con 12 herramientas: estado y
  siguientes pasos, catálogo, básicos, acceso, integraciones, secretos, comprobación, aplicar,
  arrancar en segundo plano con progreso, credenciales y diagnóstico. Los secretos nunca pasan
  por el agente: una página privada en 127.0.0.1 con id de un solo uso guía al usuario, recibe
  las claves y las valida; la contraseña del admin se muestra en otra página privada. Probado de
  extremo a extremo con un cliente MCP en memoria (sin fugas de secretos en ninguna respuesta),
  por stdio real, y la página con Chrome y validaciones reales de Last.fm y Telegram.
  `CRATE_INSTALLER_ONLY=1` en el bootstrap y guía "Install with an AI agent" en la documentación.
- **Fase 4 (en curso).** Retirado el wizard web de Setup (página, redirección, rutas `/api/setup` y
  esquemas; el benchmark de escritorio sonda `/api/status`). `.env.example` sin variables muertas
  (`TIDARR_PASSWORD`, `NATIVE_OAUTH_LEGACY_REDIRECT_ENABLED`) y README con las variables por
  perfil, sin `PROTONVPN_*` ni requisitos falsos; tests en `internal/manifest` impiden que
  `.env.example` o el README documenten variables que nada lee.
