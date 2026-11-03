#!/usr/bin/env bash
# End-to-end test of the installer's optional monitoring, inside a disposable
# Docker-in-Docker container, with the real installer and the published images.
#   make installer-observability-e2e
# CRATE_E2E_VERSION picks the release whose images are installed (default v3.1.3).
# KEEP=1 leaves the container and its Docker data for debugging.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=${CRATE_E2E_VERSION:-v3.1.3}
NAME=${CRATE_E2E_CONTAINER:-crate-installer-e2e}
IMAGE=${CRATE_E2E_DIND_IMAGE:-docker:28-dind}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/crate-installer-e2e.XXXXXX")

case "$(docker info --format '{{.Architecture}}')" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "unsupported Docker architecture" >&2 && exit 1 ;;
esac

disk() {
  local used peak
  used=$(docker exec "$NAME" du -sxk /var/lib/docker 2>/dev/null | cut -f1) || return 0
  peak=$(cat "$WORK/peak" 2>/dev/null || echo 0)
  if [[ -n "$used" ]] && ((used > peak)); then echo "$used" >"$WORK/peak"; fi
}

cleanup() {
  local status=$?
  disk
  echo "==> Peak Docker disk inside the test container: $(($(cat "$WORK/peak" 2>/dev/null || echo 0) / 1024)) MiB"
  if [[ "${KEEP:-0}" == 1 ]]; then
    echo "==> KEEP=1: left $NAME running; remove it with: docker rm -f -v $NAME"
  else
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

echo "==> Building the installer $VERSION for linux/$ARCH"
(cd app/installer && CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" go build -ldflags "-X main.version=$VERSION" -o "$WORK/crate" ./cmd/crate)
cp scripts/installer-observability-e2e-scenarios.sh "$WORK/scenarios.sh"

docker rm -f -v "$NAME" >/dev/null 2>&1 || true
echo "==> Starting $IMAGE"
docker run -d --privileged --name "$NAME" -v "$WORK:/e2e:ro" "$IMAGE" >/dev/null
for _ in $(seq 60); do
  docker exec "$NAME" docker info >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$NAME" docker info --format 'Inner Docker {{.ServerVersion}}, storage driver {{.Driver}}'
docker exec "$NAME" apk add --no-cache -q bash curl jq >/dev/null

started=$SECONDS
(
  while sleep 60; do disk; done
) &
watcher=$!
status=0
docker exec -e CRATE_E2E_VERSION="$VERSION" "$NAME" bash /e2e/scenarios.sh || status=$?
{ kill "$watcher" && wait "$watcher"; } 2>/dev/null || true
disk
echo "==> Finished in $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s"
exit "$status"
