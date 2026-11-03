#!/bin/sh
# Starts only the standalone monitoring services, after the checks that keep it
# from writing over another installation's data. Used by `make observability-up`
# and the crate installer.
#   OBS_PROJECT_DIR=<dir> OBS_ENV_FILE=<monitoring.env> [OBS_CONTAINERD=1] [DOCKER="sudo docker"] scripts/observability-up.sh
set -eu

: "${OBS_PROJECT_DIR:?OBS_PROJECT_DIR is required}"
: "${OBS_ENV_FILE:?OBS_ENV_FILE is required}"
OBS_CONTAINERD=${OBS_CONTAINERD:-0}
OBS_CONTAINERD_SOCKET=${OBS_CONTAINERD_SOCKET:-/run/containerd/containerd.sock}
export OBS_CONTAINERD_SOCKET
DOCKER=${DOCKER:-docker}
SERVICES="crate-prometheus crate-grafana crate-node-exporter crate-postgres-exporter crate-redis-exporter crate-redis-durable-exporter crate-cadvisor crate-observability-docker-proxy"

cd "$OBS_PROJECT_DIR"
set -- --project-name crate-observability --project-directory "$OBS_PROJECT_DIR" \
  --env-file "$OBS_ENV_FILE" -f deploy/observability/compose.standalone.yaml
if [ "$OBS_CONTAINERD" = 1 ]; then
  set -- "$@" -f deploy/observability/compose.containerd.yaml
fi
set -- "$@" --profile observability

driver=$($DOCKER info --format '{{.Driver}}' || true)
case "$driver:$OBS_CONTAINERD" in
  overlay2:0 | overlayfs:1) ;;
  *)
    echo "Monitoring requires overlay2 (OBS_CONTAINERD=0) or overlayfs (OBS_CONTAINERD=1); no services started."
    exit 1
    ;;
esac

for service in crate-prometheus crate-grafana; do
  projects=$($DOCKER ps --filter "label=com.docker.compose.service=$service" \
    --format '{{with .Label "com.docker.compose.project"}}{{.}}{{else}}unmanaged{{end}}') || {
    echo "Cannot check existing monitoring writers; no services started." >&2
    exit 1
  }
  if [ -n "$(printf '%s\n' "$projects" | sed '/^crate-observability$/d; /^$/d')" ]; then
    echo "Monitoring writers from another project are running. Migrate the old monitoring project before standalone startup." >&2
    exit 1
  fi
done

if [ "$OBS_CONTAINERD" = 1 ]; then
  socket_path=$(readlink -f "$OBS_CONTAINERD_SOCKET") || {
    echo "Unable to validate containerd socket; no services started."
    exit 1
  }
  case "$socket_path" in
    /run/*) ;;
    *)
      echo "Containerd socket must resolve under masked /run; no services started."
      exit 1
      ;;
  esac
  $DOCKER compose "$@" up -d --no-deps --wait --wait-timeout 45 crate-observability-docker-proxy
fi

$DOCKER compose "$@" up -d --no-deps $SERVICES
