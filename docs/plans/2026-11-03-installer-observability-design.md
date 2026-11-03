# Instalador de Crate: observabilidad opt-in

2026-11-03 · diseño aprobado por Diego. Base analizada: `main@422c11d82`.
Plan del instalador: [2026-10-26-crate-installer.md](2026-10-26-crate-installer.md).
Observabilidad: [diseño](2026-10-31-observability-design.md) y
[plan ampliado](2026-11-01-observability-metrics-completion-plan.md).

## Objetivo

El instalador ofrece la monitorización (Prometheus, Grafana y los exporters del proyecto
`crate-observability`) en todas las instalaciones home y la configura de principio a fin cuando
el usuario la acepta. Es opt-in: viene desmarcada y nunca cambia nada sin un sí explícito, pero se
muestra siempre, también cuando el sistema no la admite y hay que explicar el motivo.

## Decisiones de Diego (2026-11-03)

1. **Solo Linux en v1.** node-exporter y cAdvisor dentro de Docker Desktop miden la VM, no el
   Mac. En macOS la opción aparece como no disponible y dice por qué. Un modo parcial (Prometheus,
   Grafana, exporters de base de datos y métricas de la app) queda para más adelante.
2. **Datos en `${DATA_DIR}/observability`.** No hace falta sudo y viven junto al resto de datos.
   El wizard avisa de que pueden sumar hasta 10 GB a las copias de seguridad de `DATA_DIR`.
3. **Activarla en una instalación existente reinicia la app.** El overlay `app-metrics` recrea
   los servicios Python, el read plane y el media worker, y el de Traefik corta conexiones unos
   segundos. La confirmación lo dice; con `--yes` queda documentado.
4. **Copia de seguridad solo de Grafana en upgrades.** Grafana es pequeño y sus migraciones son
   irreversibles. Copiar Prometheus (hasta 10 GB) en home es caro, y perder ese historial es
   aceptable.
5. **`disable --purge` más adelante.** `disable` conserva datos, secretos, `monitoring.env`, redes
   y rol.

También quedan aprobadas el resto de recomendaciones del análisis:

- la lógica privilegiada corre en un contenedor `crate-api` desechable como root;
- la contraseña de `crate_observer` se guarda como verificador SCRAM;
- la opción viene desmarcada pero siempre visible;
- la contraseña de Grafana solo llega por entorno;
- los overlays de la app se filtran si falta su red;
- un guard de `OBS_RELEASE` protege frente a downgrades;
- `doctor --json` solo gana campos nuevos.

## Estado de partida

| Aspecto | Estado |
| --- | --- |
| Entrypoint `metrics` (`:8082`) de Traefik | Lo escribe el instalador en cada `Apply` desde v3.1.0 (`internal/install/traefik.go`) |
| Variables `OBS_*` | Ninguna en el instalador ni en `docker-compose.home.yaml` |
| `CRATE_GRAFANA_URL`, `CRATE_OBSERVABILITY_PROJECT` | Declaradas como `tuning` y pasadas a la API; el instalador nunca les da valor |
| Ficheros de `deploy/observability` | No se embeben ni se despliegan |
| Make y scripts de monitoring | No existen en una instalación home: no hay checkout |

## Huecos

1. No se despliegan el bundle de monitoring (15 ficheros de `BUNDLE_FILES`) ni los cuatro overlays
   de la app.
2. No se genera `monitoring.env` ni se crean los directorios con UID 65534 (Prometheus) y 472
   (Grafana).
3. No se generan los secretos: contraseña de Grafana, del exporter de PostgreSQL y los dos JSON de
   Redis.
4. No se crea la cuenta `crate_observer` ni se comprueba `pg_stat_statements`.
5. No se detectan el driver de almacenamiento ni el socket de containerd.
6. No hay forma de arrancar `crate-observability` sin Make: los guards (driver coherente, un solo
   escritor de Prometheus y Grafana, socket bajo `/run`, proxy antes que el resto) solo viven en el
   Makefile.
7. No se añaden las `OBS_*_NETWORK` al `.env` ni los overlays a `COMPOSE_FILE`.
8. No hay desactivación, estado, comprobación en doctor ni ruta de upgrade.
9. El test de manifiesto no ve los compose de monitoring.

## UX

### Wizard

Un paso propio, **Monitoring (optional)**, después de Integrations:

- Explica qué instala (8 contenedores pequeños, limitados a 944 MiB y 1 CPU), cuánto disco usa
  (hasta 10 GB, mantener 20 GB libres) y cómo se accede: Grafana solo escucha en la propia máquina,
  en `http://localhost:<port>`, y nunca se publica. No envía alertas.
- Confirmación `Set up monitoring?`, **No por defecto**. Si ya está activa, Yes por defecto y solo
  se apaga con un No explícito.
- Si contesta Yes, pide la carpeta de datos (por defecto `${DATA_DIR}/observability`, con aviso por
  debajo de 20 GiB libres y bloqueo por debajo de unos 12 GiB), el puerto de Grafana (3001) y la
  contraseña de Grafana. Si se deja vacía, se genera y se muestra una vez al final.
- Deriva sin preguntar `OBS_APP_NETWORK=crate`, `CRATE_POSTGRES_DB`, el driver de Docker, el socket
  de containerd, `OBS_DOCKER_ROOT` y `CRATE_GRAFANA_URL`.
- Si el sistema no la admite (macOS, Docker rootless, driver no soportado), la fila se muestra con
  el motivo.
- La pantalla final enseña la URL, el usuario `admin`, la contraseña si se generó y el túnel para
  acceso remoto: `ssh -N -L 3001:127.0.0.1:3001 <user>@<server>`.

### Modo no interactivo

- `crate install --yes --observability=on|off|keep`, con `CRATE_OBSERVABILITY` como valor por
  defecto (`keep`; en una instalación nueva equivale a off).
- `CRATE_OBSERVABILITY_DIR` y `CRATE_GRAFANA_PORT` por entorno o flag.
- `CRATE_GRAFANA_PASSWORD` solo por entorno, nunca como flag.

### Instalación existente

`crate observability enable|disable|status [--dir] [--yes]`, como subcomando propio:
`crate configure` exige terminal y solo trabaja con ids del manifiesto, y la monitorización tiene
otro proyecto compose y su propio ciclo de vida.

## Diseño técnico

### Ficheros

- `${InstallDir}/deploy/observability/**`: el bundle y los cuatro overlays, escritos en cada
  `Apply`. Sin overlay activo son inertes.
- `${InstallDir}/monitoring.env` (0644, sin secretos): las variables de `monitoring.env` del
  manifiesto, más `OBS_CONTAINERD` y `OBS_RELEASE`.
- `${DATA_DIR}/observability/`:
  - `prometheus/` (0750, `65534:65534`);
  - `grafana/` (0750, `472:472`);
  - `secrets/` (0700, root), con sus cuatro ficheros en 0400 y los propietarios del README de
    monitoring.

### Privilegios

`scripts/observability_setup.py --in-container` corre como `agent_setup.py`: `compose run --rm
--no-deps -T --user 0:0 --entrypoint python crate-api ...`, con los mounts en la misma ruta.
Subcomandos:

- `prepare`: directorios, propietarios y modos; contraseña del exporter solo si falta; JSON de Redis
  desde `REDIS_PASSWORD`; contraseña de Grafana desde el entorno. Es idempotente y nunca rota un
  secreto.
- `role`: crea o actualiza `crate_observer` (`pg_monitor`, `CONNECT`, `CONNECTION LIMIT 4`,
  `statement_timeout` 5 s y `lock_timeout` 1 s). La contraseña se guarda como verificador
  SCRAM-SHA-256 calculado en el script, porque en PostgreSQL 15 `pg_stat_statements` guarda el
  texto literal de `CREATE ROLE`/`ALTER ROLE` y cualquier miembro de `pg_monitor` puede leerlo.
  Comprueba o crea `pg_stat_statements`.
- `status`: JSON solo con booleanos. Reutiliza `validate_start_environment` de
  `scripts/observability_preflight.py`.

### Docker

`internal/observability` interpreta `docker info`:

- `overlay2` → `OBS_CONTAINERD=0`;
- `overlayfs` → `OBS_CONTAINERD=1`, con el socket de containerd resuelto bajo `/run`;
- rootless, otro driver o macOS → no disponible.

Exige Compose v2 porque la compose standalone usa `extends`, `secrets.file` y `create_host_path`.

### Arranque

Los guards de `observability-up` pasan a `scripts/observability-up.sh` (POSIX sh). El Makefile y
el instalador lo llaman, así no divergen.

### Orden al activar

1. En una instalación nueva, la app arranca primero sin overlays y se espera a la API.
2. `prepare`, `role` y `observability-up.sh`.
3. Las `OBS_*_NETWORK` y `CRATE_GRAFANA_URL` se escriben en `.env` y los overlays se añaden a
   `COMPOSE_FILE`; el del supervisor solo si está el overlay de Operator.
4. `up -d` de la app, que recrea solo lo que cambió.
5. Comprobación de `GET http://127.0.0.1:<port>/api/health`.

`stack.Stack` filtra en cada llamada los overlays cuya red no exista, con un aviso, para que una red
perdida no impida arrancar la app.

### Desactivación

`disable`:

1. quita los overlays de `COMPOSE_FILE`;
2. ejecuta `up -d` de la app;
3. hace `stop` de los 8 servicios de monitoring.

Conserva datos, secretos, `monitoring.env`, redes y rol.

### Upgrades

Con la monitorización activa, `crate install`:

1. calcula el hash de los ficheros montados antes de reescribirlos;
2. ejecuta `observability-up.sh`;
3. reinicia los servicios cuyo fichero montado cambió, según el mapa `MOUNTED_FILES`.

`OBS_RELEASE` sigue la regla de `UpgradeImageTag`: un instalador más antiguo nunca reescribe los
ficheros de monitoring. Antes de cambiar la imagen de Grafana se copia su directorio de datos.

## Plan de PRs

| PR | Contenido | Comportamiento |
| --- | --- | --- |
| 1 | Assets embebidos de `deploy/observability`, `sync-assets` con subdirectorios, sección `monitoring:` en el manifiesto y sus tests | Sin cambios |
| 2 | `internal/observability`: `docker info`, disponibilidad, `monitoring.env`, overlays en `COMPOSE_FILE`, filtrado por red, `OBS_RELEASE`, Compose v2 | Sin cambios |
| 3 | `scripts/observability_setup.py` (`prepare`, `role`, `status`) | Sin cambios |
| 4 | `scripts/observability-up.sh` extraído del Makefile | Sin cambios |
| 5 | `crate observability enable|disable|status` | Nuevo subcomando |
| 6 | Paso del wizard, flags y variables `CRATE_OBSERVABILITY*`, ruta de upgrade | Nueva pregunta opt-in |
| 7 | Doctor (sección `monitoring` en `--json`) y documentación | Campos nuevos |
