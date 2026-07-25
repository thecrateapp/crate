#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_PATH="${SERVER_PATH:?SERVER_PATH is required}"
DEPLOY_ID="${DEPLOY_ID:?DEPLOY_ID is required}"
DEPLOY_CANDIDATE_DIR="${DEPLOY_CANDIDATE_DIR:-}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:?DEPLOY_IMAGE_TAG is required}"
DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-thecrateapp}"
DEPLOY_IMAGE_REGISTRY="${DEPLOY_IMAGE_REGISTRY:-ghcr.io}"
DEPLOY_PUBLIC_CHECKS="${DEPLOY_PUBLIC_CHECKS:-1}"
DEPLOY_IMAGE_WAIT_SECONDS="${DEPLOY_IMAGE_WAIT_SECONDS:-900}"
DEPLOY_IMAGE_WAIT_INTERVAL="${DEPLOY_IMAGE_WAIT_INTERVAL:-20}"
DEPLOY_HEALTH_WAIT_SECONDS="${DEPLOY_HEALTH_WAIT_SECONDS:-420}"
DEPLOY_PUBLIC_WAIT_SECONDS="${DEPLOY_PUBLIC_WAIT_SECONDS:-120}"
DEPLOY_CONFIRM="${DEPLOY_CONFIRM:-}"
CRATE_DEPLOY_PRUNE_UNUSED_IMAGES="${CRATE_DEPLOY_PRUNE_UNUSED_IMAGES:-1}"
BACKUP_ROOT="${SERVER_PATH}/.deploy-backups"
BACKUP_DIR="${BACKUP_ROOT}/${DEPLOY_ID}"
ROLLBACK_TAG="rollback-${DEPLOY_ID}"
IMAGE_PREFIX="${DEPLOY_IMAGE_REGISTRY}/${DEPLOY_IMAGE_OWNER}"

cd "$SERVER_PATH"

COMPOSE=(docker compose -f docker-compose.yaml -f docker-compose.project.yaml)
PROJECT_SERVICES=(crate-api crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs)
HEALTHY_SERVICES=(crate-redis crate-postgres crate-api)
RUNNING_SERVICES=(crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs)
QUIESCE_SERVICES=(crate-api crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker)
PROJECT_IMAGES=(
  "${IMAGE_PREFIX}/crate-api"
  "${IMAGE_PREFIX}/crate-readplane"
  "${IMAGE_PREFIX}/crate-worker"
  "${IMAGE_PREFIX}/crate-analysis-worker"
  "${IMAGE_PREFIX}/crate-playback-worker"
  "${IMAGE_PREFIX}/crate-media-worker"
  "${IMAGE_PREFIX}/crate-ui"
  "${IMAGE_PREFIX}/crate-listen"
  "${IMAGE_PREFIX}/crate-site"
  "${IMAGE_PREFIX}/crate-docs"
)

declare -A SERVICE_IMAGE_REPOS=(
  [crate-api]="${IMAGE_PREFIX}/crate-api"
  [crate-readplane]="${IMAGE_PREFIX}/crate-readplane"
  [crate-worker]="${IMAGE_PREFIX}/crate-worker"
  [crate-projector]="${IMAGE_PREFIX}/crate-worker"
  [crate-maintenance-worker]="${IMAGE_PREFIX}/crate-worker"
  [crate-analysis-worker]="${IMAGE_PREFIX}/crate-analysis-worker"
  [crate-playback-worker]="${IMAGE_PREFIX}/crate-playback-worker"
  [crate-media-worker]="${IMAGE_PREFIX}/crate-media-worker"
  [crate-ui]="${IMAGE_PREFIX}/crate-ui"
  [crate-listen]="${IMAGE_PREFIX}/crate-listen"
  [crate-site]="${IMAGE_PREFIX}/crate-site"
  [crate-docs]="${IMAGE_PREFIX}/crate-docs"
)

log() {
  printf '\n[remote] %s\n' "$*"
}

dc() {
  "${COMPOSE[@]}" "$@"
}

env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

compose_has_service() {
  local service="$1"
  if [[ -z "$(env_value REDIS_PASSWORD)" ]]; then
    REDIS_PASSWORD="__crate_backup_placeholder__" dc config --services | grep -qx "$service"
    return
  fi
  dc config --services | grep -qx "$service"
}

stop_existing_services() {
  local existing=()
  local service

  for service in "$@"; do
    if compose_has_service "$service"; then
      existing+=("$service")
    fi
  done
  if (( ${#existing[@]} > 0 )); then
    dc stop --timeout 45 "${existing[@]}"
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp

  tmp="$(mktemp)"
  if [[ -f .env && "$(grep -c -E "^${key}=" .env || true)" -gt 0 ]]; then
    sed -E "s|^${key}=.*|${key}=${value}|" .env > "$tmp"
  else
    if [[ -f .env ]]; then
      cp .env "$tmp"
    fi
    printf '\n%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env
}

assert_compose_redis_auth() {
  if dc config | grep -q "REDIS_URL: redis://crate-redis:6379/0"; then
    log "Compose would start services with unauthenticated Redis URLs"
    return 1
  fi
}

assert_music_mount_ready() {
  local media_dir
  local music_dir

  if [[ "${CRATE_DEPLOY_ALLOW_EMPTY_MUSIC:-0}" == "1" ]]; then
    return 0
  fi

  media_dir="$(env_value MEDIA_DIR)"
  media_dir="${media_dir:-./media}"
  music_dir="${media_dir%/}/music"

  if [[ ! -d "$music_dir" ]]; then
    log "Music directory is missing: ${music_dir}"
    return 1
  fi

  if ! find -L "$music_dir" -type f \( -iname "*.flac" -o -iname "*.mp3" -o -iname "*.m4a" -o -iname "*.ogg" -o -iname "*.opus" \) -print -quit | grep -q .; then
    log "Music directory has no playable audio files: ${music_dir}"
    return 1
  fi
}

assert_deploy_id() {
  if [[ ! "$DEPLOY_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]]; then
    log "DEPLOY_ID must use only letters, digits, dot, underscore or dash"
    return 1
  fi
}

assert_required_env() {
  local key="$1"
  local min_length="${2:-1}"
  local value

  value="$(env_value "$key")"
  if (( ${#value} < min_length )); then
    log "${key} is missing or shorter than ${min_length} characters"
    return 1
  fi
}

current_schema_revision() {
  local pg_db
  local pg_password
  local pg_user

  pg_user="$(env_value CRATE_POSTGRES_USER)"
  pg_password="$(env_value CRATE_POSTGRES_PASSWORD)"
  pg_db="$(env_value CRATE_POSTGRES_DB)"
  docker exec \
    -e PGPASSWORD="$pg_password" \
    crate-postgres \
    psql -U "$pg_user" -d "$pg_db" -Atc \
    "SELECT version_num FROM alembic_version ORDER BY version_num DESC LIMIT 1"
}

cmd_release_preflight() {
  local available_kib
  local backup_running
  local public_api_url

  log "Checking production release prerequisites"
  assert_deploy_id
  command -v docker >/dev/null
  command -v sha256sum >/dev/null
  docker compose version >/dev/null
  test -f .env
  if [[ -z "$DEPLOY_CANDIDATE_DIR" ]]; then
    log "DEPLOY_CANDIDATE_DIR is required for release preflight"
    return 1
  fi
  test -f "$DEPLOY_CANDIDATE_DIR/docker-compose.yaml"
  test -f "$DEPLOY_CANDIDATE_DIR/docker-compose.project.yaml"

  assert_required_env REDIS_PASSWORD 16
  assert_required_env CRATE_POSTGRES_USER
  assert_required_env CRATE_POSTGRES_PASSWORD 16
  assert_required_env CRATE_POSTGRES_DB
  assert_required_env CRATE_READPLANE_SERVICE_TOKEN 32
  assert_required_env CRATE_FEDERATION_SUBJECT_SECRET 32
  assert_required_env CRATE_FEDERATION_CURSOR_SECRET 32
  assert_required_env CRATE_PUBLIC_API_BASE_URL
  assert_required_env CRATE_INSTANCE_NAME

  public_api_url="$(env_value CRATE_PUBLIC_API_BASE_URL)"
  if [[ ! "$public_api_url" =~ ^https://[^/]+/?$ ]]; then
    log "CRATE_PUBLIC_API_BASE_URL must be an HTTPS origin without a path"
    return 1
  fi

  for service in crate-postgres crate-redis; do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$service" 2>/dev/null || true)" != "true" ]]; then
      log "${service} is not running"
      return 1
    fi
  done

  backup_running="$(docker inspect -f '{{.State.Running}}' crate-postgres-backup 2>/dev/null || true)"
  if [[ "$backup_running" != "true" ]]; then
    log "crate-postgres-backup is not running"
    return 1
  fi

  log "Validating candidate compose with the production environment"
  CRATE_IMAGE_TAG="$DEPLOY_IMAGE_TAG" \
  CRATE_IMAGE_OWNER="$DEPLOY_IMAGE_OWNER" \
  CRATE_IMAGE_REGISTRY="$DEPLOY_IMAGE_REGISTRY" \
  docker compose \
    --env-file "$SERVER_PATH/.env" \
    -f "$DEPLOY_CANDIDATE_DIR/docker-compose.yaml" \
    -f "$DEPLOY_CANDIDATE_DIR/docker-compose.project.yaml" \
    config -q

  available_kib="$(df -Pk "$SERVER_PATH" | awk 'NR == 2 {print $4}')"
  if [[ -z "$available_kib" || "$available_kib" -lt "${CRATE_DEPLOY_MIN_FREE_KIB:-10485760}" ]]; then
    log "Insufficient free disk space for deployment recovery artifacts"
    return 1
  fi

  log "Current image tag: $(env_value CRATE_IMAGE_TAG)"
  log "Current schema revision: $(current_schema_revision)"
  log "Production release prerequisites are ready"
}

wait_for_container_running() {
  local container="$1"
  local deadline=$((SECONDS + 120))

  until [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" == "true" ]]; do
    if (( SECONDS >= deadline )); then
      log "Container ${container} did not become running"
      docker logs --tail=80 "$container" 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

wait_for_container_healthy() {
  local container="$1"
  local deadline=$((SECONDS + DEPLOY_HEALTH_WAIT_SECONDS))
  local status
  local reported_unhealthy=0

  while true; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "true" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      if [[ "$reported_unhealthy" -eq 0 ]]; then
        log "Container ${container} is temporarily unhealthy; waiting until deploy health deadline"
        reported_unhealthy=1
      fi
    fi
    if (( SECONDS >= deadline )); then
      log "Container ${container} did not become healthy; last status: ${status:-unknown}"
      docker logs --tail=120 "$container" 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

wait_for_public_url() {
  local url="$1"
  local host
  local deadline

  host="${url#https://}"
  host="${host%%/*}"
  deadline=$((SECONDS + DEPLOY_PUBLIC_WAIT_SECONDS))

  until curl -fsSIL --max-time 10 --resolve "${host}:443:127.0.0.1" "$url" >/dev/null; do
    if (( SECONDS >= deadline )); then
      log "Public route did not become ready: ${url}"
      return 1
    fi
    sleep 2
  done
}

wait_for_public_get_url() {
  local url="$1"
  local host
  local deadline

  host="${url#https://}"
  host="${host%%/*}"
  deadline=$((SECONDS + DEPLOY_PUBLIC_WAIT_SECONDS))

  until curl -fsSL --max-time 10 --resolve "${host}:443:127.0.0.1" "$url" >/dev/null; do
    if (( SECONDS >= deadline )); then
      log "Public route did not become ready: ${url}"
      return 1
    fi
    sleep 2
  done
}

cmd_preflight() {
  local cache_dir
  local puid
  local pgid

  log "Checking docker compose and required remote files"
  command -v docker >/dev/null
  docker compose version >/dev/null
  test -f docker-compose.yaml
  test -f docker-compose.project.yaml
  test -f .env
  if [[ -z "$(env_value REDIS_PASSWORD)" ]]; then
    log "REDIS_PASSWORD is missing in .env"
    return 1
  fi

  puid="$(env_value PUID)"
  pgid="$(env_value PGID)"
  mkdir -p media/downloads/soulseek/incomplete media/downloads/tidal/incomplete
  chown -R "${puid:-1000}:${pgid:-1000}" media/downloads 2>/dev/null || true

  mkdir -p data/crate/stream-cache data/crate/playlist-covers
  chown -R "${puid:-1000}:${pgid:-1000}" \
    data/crate/stream-cache \
    data/crate/playlist-covers \
    2>/dev/null || true

  cache_dir="$(env_value CACHE_DIR)"
  cache_dir="${cache_dir:-./data/cache}"
  mkdir -p \
    "${cache_dir}/stream-cache" \
    "${cache_dir}/artwork-variants" \
    "${cache_dir}/external-artist-artwork" \
    "${cache_dir}/download-cache"
  chown -R "${puid:-1000}:${pgid:-1000}" "$cache_dir" 2>/dev/null || true

  mkdir -p "$BACKUP_ROOT"
  dc config -q
  assert_compose_redis_auth
  assert_music_mount_ready
}

cmd_backup() {
  local service
  local repo
  local image_id

  log "Creating rollback snapshot ${DEPLOY_ID}"
  mkdir -p "$BACKUP_DIR"

  if [[ -f "$BACKUP_DIR/recovery_complete" ]]; then
    log "Reusing sealed recovery set ${DEPLOY_ID}"
    return 0
  fi

  for file in docker-compose.yaml docker-compose.project.yaml .env; do
    if [[ -f "$file" ]]; then
      cp -a "$file" "$BACKUP_DIR/$file"
    fi
  done
  if [[ -f deploy/traefik/federation-readplane.yml ]]; then
    mkdir -p "$BACKUP_DIR/deploy/traefik"
    cp -a deploy/traefik/federation-readplane.yml \
      "$BACKUP_DIR/deploy/traefik/federation-readplane.yml"
  fi

  printf '%s\n' "$ROLLBACK_TAG" > "$BACKUP_DIR/rollback_tag"

  if [[ ! -f docker-compose.yaml || ! -f docker-compose.project.yaml || ! -f .env ]]; then
    log "No existing compose stack found to snapshot"
    return 0
  fi

  for service in "${PROJECT_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    repo="${SERVICE_IMAGE_REPOS[$service]}"
    image_id="$(docker inspect -f '{{.Image}}' "$service" 2>/dev/null || true)"
    if [[ -n "$image_id" ]]; then
      docker tag "$image_id" "${repo}:${ROLLBACK_TAG}"
    fi
  done
}

recovery_redis_service() {
  if compose_has_service crate-redis-durable; then
    printf 'crate-redis-durable'
    return
  fi
  printf 'crate-redis'
}

resume_after_failed_recovery_snapshot() {
  local exit_code=$?
  local service

  trap - ERR
  set +e
  rm -f "$BACKUP_DIR/recovery_complete"
  log "Recovery snapshot failed; resuming the previous production release"
  if [[ -f "$BACKUP_DIR/redis_service" ]]; then
    docker start "$(cat "$BACKUP_DIR/redis_service")" >/dev/null 2>&1 || true
  fi
  if [[ -f "$BACKUP_DIR/recovery_running_services" ]]; then
    while IFS= read -r service; do
      [[ -n "$service" ]] && dc start "$service" >/dev/null 2>&1 || true
    done < "$BACKUP_DIR/recovery_running_services"
  fi
  exit "$exit_code"
}

cmd_recovery_snapshot() {
  local checksum_files=()
  local pg_db
  local pg_password
  local pg_user
  local redis_password
  local redis_service
  local running_services=()
  local service

  assert_deploy_id
  trap resume_after_failed_recovery_snapshot ERR
  cmd_backup

  log "Quiescing production writers and read paths"
  : > "$BACKUP_DIR/recovery_running_services"
  for service in "${QUIESCE_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$service" 2>/dev/null || true)" == "true" ]]; then
      running_services+=("$service")
      printf '%s\n' "$service" >> "$BACKUP_DIR/recovery_running_services"
    fi
  done
  if (( ${#running_services[@]} > 0 )); then
    dc stop --timeout 45 "${running_services[@]}"
  fi

  log "Stopping any quiesce service missed by Compose"
  for service in "${QUIESCE_SERVICES[@]}"; do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$service" 2>/dev/null || true)" != "true" ]]; then
      continue
    fi
    if ! grep -Fxq "$service" "$BACKUP_DIR/recovery_running_services"; then
      printf '%s\n' "$service" >> "$BACKUP_DIR/recovery_running_services"
    fi
    docker stop --time 45 "$service" >/dev/null
  done

  pg_user="$(env_value CRATE_POSTGRES_USER)"
  pg_password="$(env_value CRATE_POSTGRES_PASSWORD)"
  pg_db="$(env_value CRATE_POSTGRES_DB)"
  assert_required_env CRATE_POSTGRES_USER
  assert_required_env CRATE_POSTGRES_PASSWORD
  assert_required_env CRATE_POSTGRES_DB

  log "Capturing a consistent PostgreSQL recovery dump"
  docker exec \
    -e PGPASSWORD="$pg_password" \
    crate-postgres \
    pg_dump -U "$pg_user" -d "$pg_db" \
    --format=custom --no-owner --no-acl \
    > "$BACKUP_DIR/postgres.dump.tmp"
  mv "$BACKUP_DIR/postgres.dump.tmp" "$BACKUP_DIR/postgres.dump"
  docker exec -i \
    crate-postgres \
    pg_restore --list \
    < "$BACKUP_DIR/postgres.dump" \
    >/dev/null
  current_schema_revision > "$BACKUP_DIR/schema_revision"

  redis_service="$(recovery_redis_service)"
  redis_password="$(env_value REDIS_PASSWORD)"
  printf '%s\n' "$redis_service" > "$BACKUP_DIR/redis_service"
  log "Flushing and capturing durable Redis state from ${redis_service}"
  docker exec "$redis_service" \
    redis-cli --no-auth-warning -a "$redis_password" SAVE \
    >/dev/null
  dc stop --timeout 30 "$redis_service"
  docker run --rm \
    -e BACKUP_UID="$(id -u)" \
    -e BACKUP_GID="$(id -g)" \
    --volumes-from "$redis_service" \
    -v "$BACKUP_DIR:/backup" \
    redis:7-alpine \
    sh -ec '
      tar -C /data -czf /backup/redis-durable.tar.gz .
      chown "$BACKUP_UID:$BACKUP_GID" /backup/redis-durable.tar.gz
      chmod 600 /backup/redis-durable.tar.gz
    '

  {
    printf 'deploy_id=%s\n' "$DEPLOY_ID"
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'image_tag=%s\n' "$(env_value CRATE_IMAGE_TAG)"
    printf 'schema_revision=%s\n' "$(cat "$BACKUP_DIR/schema_revision")"
    printf 'redis_service=%s\n' "$redis_service"
  } > "$BACKUP_DIR/recovery.env"
  checksum_files=(
    postgres.dump
    redis-durable.tar.gz
    docker-compose.yaml
    docker-compose.project.yaml
    .env
    rollback_tag
    schema_revision
    redis_service
    recovery.env
    recovery_running_services
  )
  if [[ -f "$BACKUP_DIR/deploy/traefik/federation-readplane.yml" ]]; then
    checksum_files+=(deploy/traefik/federation-readplane.yml)
  fi
  (
    cd "$BACKUP_DIR"
    sha256sum "${checksum_files[@]}" > SHA256SUMS
  )
  touch "$BACKUP_DIR/recovery_complete"
  trap - ERR

  log "Recovery set ${DEPLOY_ID} is complete and production remains quiesced"
  log "Run the pinned deploy now, or explicitly restore this recovery set"
}

cmd_config() {
  log "Validating compose configuration for ${IMAGE_PREFIX}/*:${DEPLOY_IMAGE_TAG}"
  set_env_value CRATE_IMAGE_TAG "$DEPLOY_IMAGE_TAG"
  set_env_value CRATE_IMAGE_OWNER "$DEPLOY_IMAGE_OWNER"
  set_env_value CRATE_IMAGE_REGISTRY "$DEPLOY_IMAGE_REGISTRY"
  dc config -q
  assert_compose_redis_auth
  assert_music_mount_ready
}

cmd_pull() {
  local start
  local failures
  local image

  log "Pulling ${IMAGE_PREFIX} images for tag ${DEPLOY_IMAGE_TAG}"
  start="$SECONDS"

  while true; do
    failures=0
    for image in "${PROJECT_IMAGES[@]}"; do
      if ! docker pull -q "${image}:${DEPLOY_IMAGE_TAG}" >/dev/null; then
        failures=$((failures + 1))
      fi
    done

    if [[ "$failures" -eq 0 ]]; then
      break
    fi

    if (( SECONDS - start >= DEPLOY_IMAGE_WAIT_SECONDS )); then
      log "Timed out waiting for ${failures} image(s) with tag ${DEPLOY_IMAGE_TAG}"
      return 1
    fi

    log "Waiting for GitHub images to become available (${failures} missing)"
    sleep "$DEPLOY_IMAGE_WAIT_INTERVAL"
  done

  log "Pulling external images"
  dc pull --ignore-buildable --ignore-pull-failures
}

ensure_project_images_for_tag() {
  local tag="$1"
  local failures=0
  local image

  for image in "${PROJECT_IMAGES[@]}"; do
    if docker image inspect "${image}:${tag}" >/dev/null 2>&1; then
      continue
    fi
    if docker pull -q "${image}:${tag}" >/dev/null 2>&1; then
      continue
    fi
    log "Image unavailable for rollback: ${image}:${tag}"
    failures=$((failures + 1))
  done

  [[ "$failures" -eq 0 ]]
}

cmd_up() {
  log "Starting updated stack without building on the server"
  dc up -d --no-build --remove-orphans
}

cmd_verify() {
  local domain
  domain="$(env_value DOMAIN)"

  log "Waiting for service health checks"
  for service in "${HEALTHY_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    wait_for_container_healthy "$service"
  done

  log "Waiting for web and worker containers"
  for service in "${RUNNING_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    wait_for_container_running "$service"
  done

  log "Checking API from inside the backend container"
  docker exec -i crate-api python - <<'PY'
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8585/api/status", timeout=5) as response:
    if response.status >= 400:
        raise SystemExit(f"unexpected status {response.status}")
PY

  if compose_has_service crate-readplane; then
    log "Checking readplane readiness from inside the backend container"
    docker exec -i crate-api python - <<'PY'
import urllib.request

with urllib.request.urlopen("http://crate-readplane:8686/readyz", timeout=5) as response:
    if response.status >= 400:
        raise SystemExit(f"unexpected status {response.status}")
PY
  fi

  if [[ "$DEPLOY_PUBLIC_CHECKS" != "0" && -n "$domain" ]]; then
    command -v curl >/dev/null
    log "Checking public routes through Traefik"
    wait_for_public_get_url "https://api.${domain}/api/status"
    wait_for_public_url "https://admin.${domain}"
    wait_for_public_url "https://listen.${domain}"
    wait_for_public_url "https://cratemusic.app"
    wait_for_public_url "https://docs.cratemusic.app"
  fi
}

cmd_rollback() {
  local rollback_tag
  local target_tag
  local rollback_services=()
  local service

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "No rollback snapshot found for ${DEPLOY_ID}"
    return 1
  fi

  rollback_tag="$(cat "$BACKUP_DIR/rollback_tag" 2>/dev/null || true)"
  if [[ -z "$rollback_tag" ]]; then
    rollback_tag="$ROLLBACK_TAG"
  fi

  log "Restoring compose/env from rollback snapshot ${DEPLOY_ID}"
  for file in docker-compose.yaml docker-compose.project.yaml .env; do
    if [[ -f "$BACKUP_DIR/$file" ]]; then
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  if [[ -f "$BACKUP_DIR/deploy/traefik/federation-readplane.yml" ]]; then
    mkdir -p deploy/traefik
    cp -a "$BACKUP_DIR/deploy/traefik/federation-readplane.yml" \
      deploy/traefik/federation-readplane.yml
  fi

  target_tag="$(env_value CRATE_IMAGE_TAG)"
  if [[ -z "$target_tag" ]]; then
    target_tag="$rollback_tag"
  fi
  set_env_value CRATE_IMAGE_TAG "$target_tag"
  dc config -q

  log "Checking rollback images for CRATE_IMAGE_TAG=${target_tag}"
  ensure_project_images_for_tag "$target_tag"

  log "Restarting previous images with CRATE_IMAGE_TAG=${target_tag}"
  for service in "${PROJECT_SERVICES[@]}"; do
    if compose_has_service "$service"; then
      rollback_services+=("$service")
    fi
  done
  CRATE_IMAGE_TAG="$target_tag" "${COMPOSE[@]}" up -d --no-build --remove-orphans "${rollback_services[@]}"
  DEPLOY_PUBLIC_CHECKS=0 cmd_verify
}

cmd_state_rollback() {
  local expected_schema
  local pg_db
  local pg_password
  local pg_user
  local redis_service
  local super_password
  local super_user
  local target_tag

  assert_deploy_id
  if [[ "$DEPLOY_CONFIRM" != "restore-production" ]]; then
    log "State rollback requires DEPLOY_CONFIRM=restore-production"
    return 1
  fi
  if [[ ! -f "$BACKUP_DIR/recovery_complete" ]]; then
    log "Recovery set ${DEPLOY_ID} is missing or incomplete"
    return 1
  fi

  log "Validating recovery set checksums"
  (
    cd "$BACKUP_DIR"
    sha256sum -c SHA256SUMS
  )

  log "Stopping the updated application before state restoration"
  stop_existing_services "${PROJECT_SERVICES[@]}"
  if compose_has_service crate-postgres-backup; then
    dc stop --timeout 30 crate-postgres-backup
  fi
  for redis_service in crate-redis-durable crate-redis; do
    if compose_has_service "$redis_service"; then
      dc stop --timeout 30 "$redis_service"
    fi
  done

  log "Restoring release configuration from ${DEPLOY_ID}"
  for file in docker-compose.yaml docker-compose.project.yaml .env; do
    if [[ ! -f "$BACKUP_DIR/$file" ]]; then
      log "Recovery set is missing ${file}"
      return 1
    fi
    cp -a "$BACKUP_DIR/$file" "$file"
  done
  if [[ -f "$BACKUP_DIR/deploy/traefik/federation-readplane.yml" ]]; then
    mkdir -p deploy/traefik
    cp -a "$BACKUP_DIR/deploy/traefik/federation-readplane.yml" \
      deploy/traefik/federation-readplane.yml
  fi

  pg_user="$(env_value CRATE_POSTGRES_USER)"
  pg_password="$(env_value CRATE_POSTGRES_PASSWORD)"
  pg_db="$(env_value CRATE_POSTGRES_DB)"
  super_user="$(env_value POSTGRES_SUPERUSER_USER)"
  super_user="${super_user:-$pg_user}"
  super_password="$(env_value POSTGRES_SUPERUSER_PASSWORD)"
  super_password="${super_password:-$pg_password}"
  assert_required_env CRATE_POSTGRES_USER
  assert_required_env CRATE_POSTGRES_PASSWORD
  assert_required_env CRATE_POSTGRES_DB

  log "Restoring PostgreSQL from the quiesced recovery dump"
  docker start crate-postgres >/dev/null
  wait_for_container_healthy crate-postgres
  docker exec \
    -e PGPASSWORD="$super_password" \
    crate-postgres \
    dropdb --if-exists --force -U "$super_user" "$pg_db"
  docker exec \
    -e PGPASSWORD="$super_password" \
    crate-postgres \
    createdb -U "$super_user" -O "$pg_user" "$pg_db"
  docker exec -i \
    -e PGPASSWORD="$pg_password" \
    crate-postgres \
    pg_restore -U "$pg_user" -d "$pg_db" \
    --no-owner --no-acl --exit-on-error \
    < "$BACKUP_DIR/postgres.dump"

  expected_schema="$(cat "$BACKUP_DIR/schema_revision")"
  if [[ "$(current_schema_revision)" != "$expected_schema" ]]; then
    log "Restored schema revision does not match ${expected_schema}"
    return 1
  fi

  redis_service="$(cat "$BACKUP_DIR/redis_service")"
  log "Restoring ${redis_service} from the matching recovery snapshot"
  docker run --rm \
    --volumes-from "$redis_service" \
    -v "$BACKUP_DIR:/backup:ro" \
    redis:7-alpine \
    sh -ec 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /data -xzf /backup/redis-durable.tar.gz'
  docker start "$redis_service" >/dev/null
  wait_for_container_healthy "$redis_service"

  target_tag="$(env_value CRATE_IMAGE_TAG)"
  if [[ -z "$target_tag" ]]; then
    log "Recovery configuration has no CRATE_IMAGE_TAG"
    return 1
  fi
  ensure_project_images_for_tag "$target_tag"

  log "Restarting recovered release ${target_tag}"
  CRATE_IMAGE_TAG="$target_tag" dc up -d --no-build --remove-orphans
  DEPLOY_PUBLIC_CHECKS=0 cmd_verify
  log "State rollback ${DEPLOY_ID} completed at schema ${expected_schema}"
}

cmd_cleanup() {
  local snapshots=()
  local index

  log "Keeping the latest 5 deploy snapshots"
  if [[ -d "$BACKUP_ROOT" ]]; then
    mapfile -t snapshots < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
    for index in "${!snapshots[@]}"; do
      if (( index >= 5 )); then
        rm -rf "${snapshots[$index]}"
      fi
    done
  fi

  cleanup_legacy_cache_layout
  prune_unused_images
}

cleanup_legacy_cache_layout() {
  local cache_dir
  local data_dir
  local legacy_root
  local name

  cache_dir="$(env_value CACHE_DIR)"
  cache_dir="${cache_dir:-./data/cache}"
  data_dir="$(env_value DATA_DIR)"
  data_dir="${data_dir:-./data}"
  cache_dir="$(realpath -m "$cache_dir")"
  legacy_root="$(realpath -m "${data_dir}/crate")"
  if [[ "$cache_dir" == "$legacy_root" || "$legacy_root" == "/" ]]; then
    return
  fi

  log "Removing legacy regenerable caches from ${legacy_root}"
  for name in stream-cache artwork-variants external-artist-artwork download-cache; do
    rm -rf -- "${legacy_root:?}/${name}"
  done
}

prune_unused_images() {
  local full
  local id
  local removed=0
  declare -A keep=()
  declare -A candidates=()

  if [[ "$CRATE_DEPLOY_PRUNE_UNUSED_IMAGES" != "1" ]]; then
    log "Skipping unused image cleanup"
    return
  fi

  while read -r id; do
    [[ -n "$id" ]] && keep["$id"]=1
  done < <(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' | sort -u)
  while read -r id; do
    [[ -n "$id" ]] && keep["$id"]=1
  done < <(
    docker image ls --format '{{.Tag}} {{.ID}}' \
      | awk -v tag="$ROLLBACK_TAG" '$1 == tag {print $2}' \
      | xargs -r -n1 docker image inspect --format '{{.Id}}' \
      | sort -u
  )

  while read -r id; do
    full="$(docker image inspect "$id" --format '{{.Id}}' 2>/dev/null || true)"
    if [[ -n "$full" && -z "${keep[$full]:-}" ]]; then
      candidates["$full"]=1
    fi
  done < <(docker image ls -q | sort -u)

  for id in "${!candidates[@]}"; do
    if docker image rm -f "$id" >/dev/null 2>&1; then
      removed=$((removed + 1))
    fi
  done
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  log "Removed ${removed} unused image IDs; retained active containers and ${ROLLBACK_TAG}"
  df -h / /var 2>/dev/null || true
}

cmd_ps() {
  dc ps
}

cmd_diagnose() {
  dc ps || true
  dc logs --tail=120 crate-api crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs || true
}

case "${1:-}" in
  release-preflight) cmd_release_preflight ;;
  preflight) cmd_preflight ;;
  backup) cmd_backup ;;
  recovery-snapshot) cmd_recovery_snapshot ;;
  config) cmd_config ;;
  pull) cmd_pull ;;
  up) cmd_up ;;
  verify) cmd_verify ;;
  rollback) cmd_rollback ;;
  state-rollback) cmd_state_rollback ;;
  cleanup) cmd_cleanup ;;
  ps) cmd_ps ;;
  diagnose) cmd_diagnose ;;
  *)
    printf 'Usage: %s {release-preflight|preflight|backup|recovery-snapshot|config|pull|up|verify|rollback|state-rollback|cleanup|ps|diagnose}\n' "$0" >&2
    exit 2
    ;;
esac
