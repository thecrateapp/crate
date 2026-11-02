#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_PATH="${SERVER_PATH:?SERVER_PATH is required}"
DEPLOY_ID="${DEPLOY_ID:?DEPLOY_ID is required}"
DEPLOY_CANDIDATE_DIR="${DEPLOY_CANDIDATE_DIR:-}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:?DEPLOY_IMAGE_TAG is required}"
DEPLOY_RELEASE_SHA="${DEPLOY_RELEASE_SHA:-}"
DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-thecrateapp}"
DEPLOY_IMAGE_REGISTRY="${DEPLOY_IMAGE_REGISTRY:-ghcr.io}"
DEPLOY_PUBLIC_CHECKS="${DEPLOY_PUBLIC_CHECKS:-1}"
DEPLOY_IMAGE_WAIT_SECONDS="${DEPLOY_IMAGE_WAIT_SECONDS:-900}"
DEPLOY_IMAGE_WAIT_INTERVAL="${DEPLOY_IMAGE_WAIT_INTERVAL:-20}"
DEPLOY_HEALTH_WAIT_SECONDS="${DEPLOY_HEALTH_WAIT_SECONDS:-420}"
DEPLOY_PUBLIC_WAIT_SECONDS="${DEPLOY_PUBLIC_WAIT_SECONDS:-120}"
DEPLOY_API_RETRY_MAX_SECONDS="${DEPLOY_API_RETRY_MAX_SECONDS:-15}"
DEPLOY_CONFIRM="${DEPLOY_CONFIRM:-}"
CRATE_DEPLOY_PRUNE_UNUSED_IMAGES="${CRATE_DEPLOY_PRUNE_UNUSED_IMAGES:-1}"
BACKUP_ROOT="${SERVER_PATH}/.deploy-backups"
BACKUP_DIR="${BACKUP_ROOT}/${DEPLOY_ID}"
ROLLBACK_TAG="rollback-${DEPLOY_ID}"
IMAGE_PREFIX="${DEPLOY_IMAGE_REGISTRY}/${DEPLOY_IMAGE_OWNER}"
HOST_LOCK_DIR="${SERVER_PATH}/.deploy"
HOST_LOCK_OWNER="$DEPLOY_ID"
HOST_LOCK_CONFIRM="$DEPLOY_CONFIRM"
HOST_LOCK_WAIT_SECONDS="${HOST_LOCK_WAIT_SECONDS:-600}"

cd "$SERVER_PATH"

COMPOSE=(docker compose -f docker-compose.yaml -f docker-compose.project.yaml)
# The bootstrap overlay preserves the agent profile on older releases. Once the
# base release declares the service, applying the copied full-service overlay
# duplicates list fields such as security_opt and makes Compose reject the stack.
select_operator_overlay() {
  [[ -f .deploy/crate-operator.compose.yaml ]] || return 0

  local base_services
  base_services="$(docker compose --profile agent \
    -f docker-compose.yaml -f docker-compose.project.yaml config --services)"
  if ! grep -Fxq "crate-agent" <<< "$base_services"; then
    COMPOSE+=(-f .deploy/crate-operator.compose.yaml)
  fi
}
select_operator_overlay
# A running Crate Operator keeps its overlay through every stage: without it
# crate-api and the workers lose the operator identity. Service retirement is
# explicit: application deployment must not remove other project members.
OPERATOR_OVERLAY=""
select_running_operator_overlay() {
  [[ -n "$(docker ps -q -f name='^crate-operator$')" ]] || return 0
  if [[ " ${COMPOSE[*]} " == *" .deploy/crate-operator.compose.yaml "* ]]; then
    OPERATOR_OVERLAY=.deploy/crate-operator.compose.yaml
    return 0
  fi
  local candidate
  for candidate in .deploy/crate-operator.compose.yaml deploy/operator/compose.operator.yaml; do
    if [[ -f "$candidate" ]]; then
      OPERATOR_OVERLAY="$candidate"
      COMPOSE+=(-f "$candidate")
      return 0
    fi
  done
  echo "crate-operator is running but deploy/operator/compose.operator.yaml is missing" >&2
  exit 1
}
select_running_operator_overlay
PROJECT_SERVICES=(crate-api crate-readplane crate-worker crate-fast-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-cast-receiver crate-site crate-docs)
HEALTHY_SERVICES=(crate-redis crate-postgres crate-api crate-cast-receiver)
RUNNING_SERVICES=(crate-readplane crate-worker crate-fast-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-cast-receiver crate-site crate-docs)
QUIESCE_SERVICES=(crate-api crate-readplane crate-worker crate-fast-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker)
RELEASE_ENV_KEYS=(
  CRATE_RELEASE_SHA
  CRATE_API_IMAGE
  CRATE_READPLANE_IMAGE
  CRATE_WORKER_IMAGE
  CRATE_ANALYSIS_WORKER_IMAGE
  CRATE_PLAYBACK_WORKER_IMAGE
  CRATE_MEDIA_WORKER_IMAGE
  CRATE_UI_IMAGE
  CRATE_LISTEN_IMAGE
  CRATE_CAST_RECEIVER_IMAGE
  CRATE_SITE_IMAGE
  CRATE_DOCS_IMAGE
)
SENTRY_RELEASE_ENV_KEYS=(
  CRATE_API_SENTRY_RELEASE
  CRATE_READPLANE_SENTRY_RELEASE
  CRATE_WORKER_SENTRY_RELEASE
  CRATE_ANALYSIS_WORKER_SENTRY_RELEASE
  CRATE_PLAYBACK_WORKER_SENTRY_RELEASE
  CRATE_MEDIA_WORKER_SENTRY_RELEASE
)
# Agent images are optional: older manifests do not carry them. A deployment
# only recreates a Crate Agent that is already running.
OPTIONAL_RELEASE_ENV_KEYS=(
  CRATE_AGENT_IMAGE
)

declare -A SERVICE_IMAGE_REPOS=(
  [crate-api]="${IMAGE_PREFIX}/crate-api"
  [crate-readplane]="${IMAGE_PREFIX}/crate-readplane"
  [crate-worker]="${IMAGE_PREFIX}/crate-worker"
  [crate-fast-worker]="${IMAGE_PREFIX}/crate-worker"
  [crate-projector]="${IMAGE_PREFIX}/crate-worker"
  [crate-maintenance-worker]="${IMAGE_PREFIX}/crate-worker"
  [crate-analysis-worker]="${IMAGE_PREFIX}/crate-analysis-worker"
  [crate-playback-worker]="${IMAGE_PREFIX}/crate-playback-worker"
  [crate-media-worker]="${IMAGE_PREFIX}/crate-media-worker"
  [crate-ui]="${IMAGE_PREFIX}/crate-ui"
  [crate-listen]="${IMAGE_PREFIX}/crate-listen"
  [crate-cast-receiver]="${IMAGE_PREFIX}/crate-cast-receiver"
  [crate-site]="${IMAGE_PREFIX}/crate-site"
  [crate-docs]="${IMAGE_PREFIX}/crate-docs"
)
declare -A RELEASE_ENV_REPOS=(
  [CRATE_API_IMAGE]="${IMAGE_PREFIX}/crate-api"
  [CRATE_READPLANE_IMAGE]="${IMAGE_PREFIX}/crate-readplane"
  [CRATE_WORKER_IMAGE]="${IMAGE_PREFIX}/crate-worker"
  [CRATE_ANALYSIS_WORKER_IMAGE]="${IMAGE_PREFIX}/crate-analysis-worker"
  [CRATE_PLAYBACK_WORKER_IMAGE]="${IMAGE_PREFIX}/crate-playback-worker"
  [CRATE_MEDIA_WORKER_IMAGE]="${IMAGE_PREFIX}/crate-media-worker"
  [CRATE_UI_IMAGE]="${IMAGE_PREFIX}/crate-ui"
  [CRATE_LISTEN_IMAGE]="${IMAGE_PREFIX}/crate-listen"
  [CRATE_CAST_RECEIVER_IMAGE]="${IMAGE_PREFIX}/crate-cast-receiver"
  [CRATE_SITE_IMAGE]="${IMAGE_PREFIX}/crate-site"
  [CRATE_DOCS_IMAGE]="${IMAGE_PREFIX}/crate-docs"
)
declare -A RELEASE_ENV_SERVICES=(
  [CRATE_API_IMAGE]="crate-api"
  [CRATE_READPLANE_IMAGE]="crate-readplane"
  [CRATE_WORKER_IMAGE]="crate-worker crate-fast-worker crate-projector crate-maintenance-worker"
  [CRATE_ANALYSIS_WORKER_IMAGE]="crate-analysis-worker"
  [CRATE_PLAYBACK_WORKER_IMAGE]="crate-playback-worker"
  [CRATE_MEDIA_WORKER_IMAGE]="crate-media-worker"
  [CRATE_UI_IMAGE]="crate-ui"
  [CRATE_LISTEN_IMAGE]="crate-listen"
  [CRATE_CAST_RECEIVER_IMAGE]="crate-cast-receiver"
  [CRATE_SITE_IMAGE]="crate-site"
  [CRATE_DOCS_IMAGE]="crate-docs"
)

log() {
  printf '\n[remote] %s\n' "$*"
}

dc() {
  "${COMPOSE[@]}" "$@"
}

env_file_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

env_value() {
  local key="$1"
  env_file_value .env "$key"
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

set_env_file_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  tmp="$(mktemp)"
  if [[ -f "$file" && "$(grep -c -E "^${key}=" "$file" || true)" -gt 0 ]]; then
    sed -E "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp"
  else
    if [[ -f "$file" ]]; then
      cp "$file" "$tmp"
    fi
    printf '\n%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

set_env_value() {
  local key="$1"
  local value="$2"
  set_env_file_value .env "$key" "$value"
}

is_release_env_key() {
  local candidate="$1"
  local key
  for key in "${RELEASE_ENV_KEYS[@]}" "${OPTIONAL_RELEASE_ENV_KEYS[@]}" "${SENTRY_RELEASE_ENV_KEYS[@]}"; do
    [[ "$candidate" == "$key" ]] && return 0
  done
  return 1
}

validate_release_env_file() {
  local file="$1"
  local key
  local value
  declare -A seen=()

  test -f "$file"
  while IFS='=' read -r key value; do
    [[ -z "$key" ]] && continue
    if ! is_release_env_key "$key"; then
      log "Unexpected release environment key: ${key}"
      return 1
    fi
    if [[ -n "${seen[$key]:-}" ]]; then
      log "Duplicate release environment key: ${key}"
      return 1
    fi
    if [[ "$key" == "CRATE_RELEASE_SHA" ]]; then
      [[ "$value" =~ ^[0-9a-f]{40}$ ]] || return 1
    elif [[ "$key" == CRATE_*_SENTRY_RELEASE ]]; then
      [[ "$value" =~ ^crate-[0-9a-f]{40}$ ]] || return 1
    elif [[ ! "$value" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]]; then
      log "Release image reference is not immutable: ${key}"
      return 1
    fi
    seen["$key"]=1
  done < "$file"
  for key in "${RELEASE_ENV_KEYS[@]}"; do
    if [[ -z "${seen[$key]:-}" ]]; then
      log "Missing release environment key: ${key}"
      return 1
    fi
  done
}

apply_release_env() {
  local file="$1"
  local key
  local value

  validate_release_env_file "$file"
  for key in "${SENTRY_RELEASE_ENV_KEYS[@]}"; do
    if ! grep -q "^${key}=" "$file"; then
      set_env_value "$key" ""
    fi
  done
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] && set_env_value "$key" "$value"
  done < "$file"
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

assert_cast_receiver_config() {
  local app_id
  local enabled
  local host

  enabled="$(env_value CRATE_CAST_CUSTOM_RECEIVER_ENABLED)"
  enabled="${enabled,,}"
  if [[ -z "$enabled" || "$enabled" == "false" || "$enabled" == "0" ]]; then
    return 0
  fi
  if [[ "$enabled" != "true" && "$enabled" != "1" ]]; then
    log "CRATE_CAST_CUSTOM_RECEIVER_ENABLED must be true or false"
    return 1
  fi

  app_id="$(env_value CRATE_CAST_RECEIVER_APP_ID)"
  host="$(env_value CRATE_CAST_RECEIVER_HOST)"
  if [[ "$app_id" == "CC1AD845" || ! "$app_id" =~ ^[A-Za-z0-9]{8}$ ]]; then
    log "Enabled custom Cast requires a registered 8-character CRATE_CAST_RECEIVER_APP_ID"
    return 1
  fi
  if [[ ! "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    log "CRATE_CAST_RECEIVER_HOST must be a hostname without scheme or path"
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
  local release_env
  local release_sha

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
  test -f "$DEPLOY_CANDIDATE_DIR/release-manifest.json"
  release_env="$DEPLOY_CANDIDATE_DIR/release.env"
  validate_release_env_file "$release_env"
  release_sha="$(env_file_value "$release_env" CRATE_RELEASE_SHA)"
  if [[ -n "$DEPLOY_RELEASE_SHA" && "$release_sha" != "$DEPLOY_RELEASE_SHA" ]]; then
    log "Candidate release SHA does not match the requested release"
    return 1
  fi

  assert_required_env REDIS_PASSWORD 16
  assert_required_env JWT_SECRET 32
  assert_required_env CRATE_POSTGRES_USER
  assert_required_env CRATE_POSTGRES_PASSWORD 16
  assert_required_env CRATE_POSTGRES_DB
  assert_required_env CRATE_READPLANE_SERVICE_TOKEN 32
  assert_required_env CRATE_FEDERATION_SUBJECT_SECRET 32
  assert_required_env CRATE_FEDERATION_CURSOR_SECRET 32
  assert_required_env CRATE_PUBLIC_API_BASE_URL
  assert_required_env CRATE_INSTANCE_NAME
  assert_cast_receiver_config

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
  CRATE_RELEASE_SHA="$release_sha" \
  CRATE_API_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_API_SENTRY_RELEASE)" \
  CRATE_READPLANE_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_READPLANE_SENTRY_RELEASE)" \
  CRATE_WORKER_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_WORKER_SENTRY_RELEASE)" \
  CRATE_ANALYSIS_WORKER_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_ANALYSIS_WORKER_SENTRY_RELEASE)" \
  CRATE_PLAYBACK_WORKER_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_PLAYBACK_WORKER_SENTRY_RELEASE)" \
  CRATE_MEDIA_WORKER_SENTRY_RELEASE="$(env_file_value "$release_env" CRATE_MEDIA_WORKER_SENTRY_RELEASE)" \
  CRATE_API_IMAGE="$(env_file_value "$release_env" CRATE_API_IMAGE)" \
  CRATE_READPLANE_IMAGE="$(env_file_value "$release_env" CRATE_READPLANE_IMAGE)" \
  CRATE_WORKER_IMAGE="$(env_file_value "$release_env" CRATE_WORKER_IMAGE)" \
  CRATE_ANALYSIS_WORKER_IMAGE="$(env_file_value "$release_env" CRATE_ANALYSIS_WORKER_IMAGE)" \
  CRATE_PLAYBACK_WORKER_IMAGE="$(env_file_value "$release_env" CRATE_PLAYBACK_WORKER_IMAGE)" \
  CRATE_MEDIA_WORKER_IMAGE="$(env_file_value "$release_env" CRATE_MEDIA_WORKER_IMAGE)" \
  CRATE_UI_IMAGE="$(env_file_value "$release_env" CRATE_UI_IMAGE)" \
  CRATE_LISTEN_IMAGE="$(env_file_value "$release_env" CRATE_LISTEN_IMAGE)" \
  CRATE_SITE_IMAGE="$(env_file_value "$release_env" CRATE_SITE_IMAGE)" \
  CRATE_DOCS_IMAGE="$(env_file_value "$release_env" CRATE_DOCS_IMAGE)" \
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
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
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

wait_for_container_http_url() {
  local container="$1"
  local url="$2"
  local deadline=$((SECONDS + DEPLOY_HEALTH_WAIT_SECONDS))
  local retry_delay=1

  until docker exec "$container" python -c \
    'import sys, urllib.request; response = urllib.request.urlopen(sys.argv[1], timeout=5); raise SystemExit(0 if response.status < 400 else 1)' \
    "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      log "Container URL did not become ready: ${container} ${url}"
      docker logs --tail=120 "$container" 2>/dev/null || true
      return 1
    fi
    sleep "$retry_delay"
    retry_delay=$((retry_delay * 2))
    if (( retry_delay > DEPLOY_API_RETRY_MAX_SECONDS )); then
      retry_delay="$DEPLOY_API_RETRY_MAX_SECONDS"
    fi
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
  if [[ -f .deploy/release-manifest.json ]]; then
    mkdir -p "$BACKUP_DIR/.deploy"
    cp -a .deploy/release-manifest.json \
      "$BACKUP_DIR/.deploy/release-manifest.json"
  fi
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
  log "Restarting ${redis_service}; the pinned deploy needs it while writers stay quiesced"
  dc start "$redis_service"

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
  if [[ -f "$BACKUP_DIR/.deploy/release-manifest.json" ]]; then
    checksum_files+=(.deploy/release-manifest.json)
  fi
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

record_changed_release_services() {
  local candidate_env=".deploy/release.env.candidate"
  local old_env=".env"
  local force_all=0
  local key
  local new_ref
  local old_ref
  local service
  local services=()

  if [[ -f "$BACKUP_DIR/.env" ]]; then
    old_env="$BACKUP_DIR/.env"
  fi
  if ! cmp -s "$BACKUP_DIR/docker-compose.yaml" docker-compose.yaml \
    || ! cmp -s "$BACKUP_DIR/docker-compose.project.yaml" docker-compose.project.yaml; then
    force_all=1
  fi

  : > "$BACKUP_DIR/changed_image_refs"
  : > "$BACKUP_DIR/changed_services"
  for key in "${RELEASE_ENV_KEYS[@]}"; do
    [[ "$key" == "CRATE_RELEASE_SHA" ]] && continue
    new_ref="$(env_file_value "$candidate_env" "$key")"
    old_ref="$(env_file_value "$old_env" "$key")"
    if [[ -z "$old_ref" ]]; then
      old_ref="${RELEASE_ENV_REPOS[$key]}:$(env_file_value "$old_env" CRATE_IMAGE_TAG)"
    fi
    if [[ "$force_all" != "1" && "$new_ref" == "$old_ref" ]]; then
      continue
    fi
    printf '%s\n' "$new_ref" >> "$BACKUP_DIR/changed_image_refs"
    read -r -a services <<< "${RELEASE_ENV_SERVICES[$key]}"
    for service in "${services[@]}"; do
      printf '%s\n' "$service" >> "$BACKUP_DIR/changed_services"
    done
  done
  for key in "${SENTRY_RELEASE_ENV_KEYS[@]}"; do
    new_ref="$(env_file_value "$candidate_env" "$key")"
    old_ref="$(env_file_value "$old_env" "$key")"
    [[ "$new_ref" != "$old_ref" ]] || continue
    read -r -a services <<< "${RELEASE_ENV_SERVICES[${key%_SENTRY_RELEASE}_IMAGE]}"
    for service in "${services[@]}"; do
      printf '%s\n' "$service" >> "$BACKUP_DIR/changed_services"
    done
  done
  sort -u -o "$BACKUP_DIR/changed_image_refs" "$BACKUP_DIR/changed_image_refs"
  sort -u -o "$BACKUP_DIR/changed_services" "$BACKUP_DIR/changed_services"
}

cmd_config() {
  local candidate_env=".deploy/release.env.candidate"

  log "Validating immutable release configuration"
  validate_release_env_file "$candidate_env"
  record_changed_release_services
  set_env_value CRATE_IMAGE_TAG "$DEPLOY_IMAGE_TAG"
  set_env_value CRATE_IMAGE_OWNER "$DEPLOY_IMAGE_OWNER"
  set_env_value CRATE_IMAGE_REGISTRY "$DEPLOY_IMAGE_REGISTRY"
  apply_release_env "$candidate_env"
  cp -a .deploy/release-manifest.json.candidate .deploy/release-manifest.json
  record_agent_deployment deploying
  dc config -q
  assert_compose_redis_auth
  assert_music_mount_ready
}

cmd_pull() {
  local start
  local failures
  local image
  local changed_image_refs="$BACKUP_DIR/changed_image_refs"

  if [[ ! -s "$changed_image_refs" ]]; then
    log "No application image changed; skipping image pulls"
    return 0
  fi

  log "Pulling only immutable images changed by this release"
  start="$SECONDS"

  while true; do
    failures=0
    while IFS= read -r image; do
      [[ -z "$image" ]] && continue
      if ! docker pull -q "$image" >/dev/null; then
        failures=$((failures + 1))
      fi
    done < "$changed_image_refs"

    if [[ "$failures" -eq 0 ]]; then
      break
    fi

    if (( SECONDS - start >= DEPLOY_IMAGE_WAIT_SECONDS )); then
      log "Timed out waiting for ${failures} image(s) with tag ${DEPLOY_IMAGE_TAG}"
      return 1
    fi

    log "Waiting for ${failures} changed image(s) to become available"
    sleep "$DEPLOY_IMAGE_WAIT_INTERVAL"
  done
}

cmd_up() {
  local changed_services="$BACKUP_DIR/changed_services"
  local services=()

  if [[ -f "$changed_services" ]]; then
    mapfile -t services < "$changed_services"
  fi
  if (( ${#services[@]} == 0 )); then
    log "No application service changed; leaving the running stack untouched"
    return 0
  fi
  log "Restarting only ${#services[@]} changed application service(s)"
  dc up -d --no-build --no-deps "${services[@]}"
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
  wait_for_container_http_url crate-api "http://127.0.0.1:8585/api/status"

  if compose_has_service crate-readplane; then
    log "Checking readplane readiness from inside the backend container"
    wait_for_container_http_url crate-api "http://crate-readplane:8686/readyz"
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
  # The opt-in operator stays closed until its exact approved context activates.
  [[ -n "$(env_value CRATE_OPERATOR_ROOT)" ]] || record_agent_deployment verified
}

cmd_agent_context() {
  activate_agent_context
  refresh_running_agent
}

# A running Crate Agent or Crate Operator follows the release image, whose baked
# context matches the deployed release. Compose recreates only containers whose
# image or configuration changed; the supervisor, relay and provenance publisher
# follow only if running.
refresh_running_agent() {
  local services=() service
  [[ -n "$(env_value CRATE_AGENT_IMAGE)" ]] || return 0
  if [[ -n "$(docker ps -q -f name='^crate-agent$')" ]]; then
    log "Recreating the running Crate Agent on the release image"
    dc --profile agent up -d --no-build --no-deps crate-agent \
      || log "Crate Agent recreation failed; the deployed release is unaffected"
  fi
  [[ -n "$OPERATOR_OVERLAY" ]] || return 0
  for service in crate-operator crate-operator-supervisor crate-infra-relay \
    crate-provenance crate-provenance-docker; do
    if [[ -n "$(dc --profile crate-operator ps -q --status running "$service" 2>/dev/null)" ]]; then
      services+=("$service")
    fi
  done
  (( ${#services[@]} > 0 )) || return 0
  log "Recreating the running Crate Operator services on the release image: ${services[*]}"
  dc --profile crate-operator up -d --no-build --no-deps "${services[@]}" \
    || log "Crate Operator recreation failed; the deployed release is unaffected"
}

activate_agent_context() {
  local data_dir context_root revision operator_root
  data_dir="$(env_value DATA_DIR)"
  operator_root="$(env_value CRATE_OPERATOR_ROOT)"
  context_root="${data_dir}/crate-agent/context"
  [[ -z "$operator_root" ]] || context_root="${operator_root}/context"
  if [[ -n "$operator_root" && ! -d "$context_root" ]]; then
    echo "Managed operator context destination is missing" >&2
    return 1
  fi
  [[ -d "$context_root" ]] || return 0
  revision="$(env_value CRATE_RELEASE_SHA)"
  if [[ -n "$operator_root" ]]; then
    # Never substitute a cached same-SHA bundle for the exact reviewed archive.
    python3 -I deploy/hermes/activate_context.py --root "$context_root" --revision "$revision" \
      --archive .deploy/agent-context.candidate.tar.gz
  elif compgen -G "${context_root}/releases/${revision}*/context-manifest.json" >/dev/null; then
    python3 -I deploy/hermes/activate_context.py --root "$context_root" --revision "$revision"
  else
    python3 -I deploy/hermes/activate_context.py --root "$context_root" --revision "$revision" \
      --archive .deploy/agent-context.candidate.tar.gz
  fi
}

record_agent_deployment() {
  local data_dir context_root
  data_dir="$(env_value DATA_DIR)"
  context_root="${data_dir}/crate-agent/context"
  [[ -z "$(env_value CRATE_OPERATOR_ROOT)" ]] || context_root="$(env_value CRATE_OPERATOR_ROOT)/context"
  [[ -d "$context_root" && -f deploy/hermes/activate_context.py ]] || return 0
  if [[ ! -f .deploy/release-manifest.json ]]; then
    python3 -I - "${context_root}/deployment.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
value = json.dumps({"release_sha": None, "state": "unverified"}) + "\n"
path.write_text(value)
public = path.parent / "public"
public.mkdir(exist_ok=True)
(public / "deployment.json").write_text(value)
PY
    return 0
  fi
  python3 -I deploy/hermes/activate_context.py --root "$context_root" \
    --revision "$(env_value CRATE_RELEASE_SHA)" \
    --record-deployment .deploy/release-manifest.json --state "$1"
}

cmd_rollback() {
  local changed_services="$BACKUP_DIR/changed_services"
  local rollback_services=()
  local service

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "No rollback snapshot found for ${DEPLOY_ID}"
    return 1
  fi

  if [[ -f "$changed_services" ]]; then
    mapfile -t rollback_services < "$changed_services"
  else
    for service in "${PROJECT_SERVICES[@]}"; do
      if compose_has_service "$service"; then
        rollback_services+=("$service")
      fi
    done
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
  if [[ -f "$BACKUP_DIR/.deploy/release-manifest.json" ]]; then
    mkdir -p .deploy
    cp -a "$BACKUP_DIR/.deploy/release-manifest.json" \
      .deploy/release-manifest.json
  else
    rm -f .deploy/release-manifest.json
  fi
  record_agent_deployment rollback
  dc config -q

  if (( ${#rollback_services[@]} == 0 )); then
    log "No application service changed; rollback only restored release configuration"
    DEPLOY_PUBLIC_CHECKS=0 cmd_verify
    return 0
  fi
  log "Restoring ${#rollback_services[@]} service(s) changed by the failed release"
  dc pull --ignore-buildable "${rollback_services[@]}" >/dev/null 2>&1 || \
    log "Registry pull failed during rollback; using preserved local images"
  "${COMPOSE[@]}" up -d --no-build --no-deps "${rollback_services[@]}"
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
  if [[ -f "$BACKUP_DIR/.deploy/release-manifest.json" ]]; then
    mkdir -p .deploy
    cp -a "$BACKUP_DIR/.deploy/release-manifest.json" \
      .deploy/release-manifest.json
  else
    rm -f .deploy/release-manifest.json
  fi

  record_agent_deployment rollback

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

  target_tag="$(env_value CRATE_RELEASE_SHA)"
  target_tag="${target_tag:-$(env_value CRATE_IMAGE_TAG)}"
  log "Restarting recovered release ${target_tag}"
  dc pull --ignore-buildable "${PROJECT_SERVICES[@]}" >/dev/null 2>&1 || \
    log "Registry pull failed during state rollback; using preserved local images"
  dc up -d --no-build
  DEPLOY_PUBLIC_CHECKS=0 cmd_verify
  log "State rollback ${DEPLOY_ID} completed at schema ${expected_schema}"
}

cmd_cleanup() {
  log "Keeping the current and 4 latest deploy snapshots"
  if [[ -d "$BACKUP_ROOT" ]]; then
    python3 - "$BACKUP_ROOT" "$BACKUP_DIR" <<'PY'
import shutil
import sys
from pathlib import Path

root, current = map(Path, sys.argv[1:])
if current.is_symlink() or not current.is_dir():
    print("Skipping snapshot cleanup: current deployment backup is missing")
    raise SystemExit(0)

snapshots = [path for path in root.iterdir() if not path.is_symlink() and path.is_dir()]
keep = {current}
for path in sorted(snapshots, key=lambda path: path.stat().st_mtime_ns, reverse=True):
    if path in keep:
        continue
    if len(keep) < 5:
        keep.add(path)
    else:
        shutil.rmtree(path)
PY
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
  dc logs --tail=120 crate-api crate-readplane crate-worker crate-fast-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs || true
}

host_lock_acquire() {
  mkdir -p "$HOST_LOCK_DIR"
  exec 9>>"$HOST_LOCK_DIR/host-mutation.lock"
  if ! flock -w "$HOST_LOCK_WAIT_SECONDS" 9; then
    echo "Another host mutation kept the lock for ${HOST_LOCK_WAIT_SECONDS}s; nothing changed" >&2
    exit 1
  fi
}

host_lease_field() {
  local lease="$HOST_LOCK_DIR/host-mutation.lease"
  [[ -f "$lease" ]] || return 0
  sed -n "s/^$1=//p" "$lease"
}

host_lease_refuse_other() {
  local owner
  owner="$(host_lease_field owner)"
  if [[ -n "$owner" && "$owner" != "$HOST_LOCK_OWNER" ]]; then
    echo "Host mutation lease is held by ${owner} since $(host_lease_field since); nothing changed" >&2
    exit 1
  fi
}

host_guard() {
  host_lock_acquire
  host_lease_refuse_other
  "$@"
}

cmd_host_lock() {
  host_lock_acquire
  host_lease_refuse_other
  local lease="$HOST_LOCK_DIR/host-mutation.lease"
  printf 'owner=%s\nsince=%s\n' "$HOST_LOCK_OWNER" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$lease.tmp"
  mv -f "$lease.tmp" "$lease"
}

cmd_host_unlock() {
  host_lock_acquire
  local owner
  owner="$(host_lease_field owner)"
  [[ -n "$owner" ]] || return 0
  if [[ "$owner" != "$HOST_LOCK_OWNER" && "$HOST_LOCK_CONFIRM" != "break-host-lock" ]]; then
    echo "Host mutation lease is held by ${owner}; release it only with confirmation break-host-lock" >&2
    exit 1
  fi
  rm -f "$HOST_LOCK_DIR/host-mutation.lease"
}

case "${1:-}" in
  host-lock) cmd_host_lock ;;
  host-unlock) cmd_host_unlock ;;
  release-preflight) cmd_release_preflight ;;
  preflight) cmd_preflight ;;
  backup) host_guard cmd_backup ;;
  recovery-snapshot) host_guard cmd_recovery_snapshot ;;
  config) host_guard cmd_config ;;
  pull) host_guard cmd_pull ;;
  up) host_guard cmd_up ;;
  verify) cmd_verify ;;
  agent-context) host_guard cmd_agent_context ;;
  rollback) host_guard cmd_rollback ;;
  state-rollback) host_guard cmd_state_rollback ;;
  cleanup) host_guard cmd_cleanup ;;
  ps) cmd_ps ;;
  diagnose) cmd_diagnose ;;
  *)
    printf 'Usage: %s {host-lock|host-unlock|release-preflight|preflight|backup|recovery-snapshot|config|pull|up|verify|agent-context|rollback|state-rollback|cleanup|ps|diagnose}\n' "$0" >&2
    exit 2
    ;;
esac
