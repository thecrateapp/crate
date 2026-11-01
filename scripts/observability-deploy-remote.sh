#!/usr/bin/env bash
set -Eeuo pipefail

OBS_ROOT="${OBS_ROOT:-/home/crate/crate-observability}"
OBS_ENV_FILE="${OBS_ENV_FILE:-/etc/crate-observability/monitoring.env}"
OBS_DEPLOY_ID="${OBS_DEPLOY_ID:-}"
OBS_DEPLOY_SHA="${OBS_DEPLOY_SHA:-}"
OBS_CONTAINERD="${OBS_CONTAINERD:-0}"
OBS_CONFIRM="${OBS_CONFIRM:-}"
OBS_INITIALIZE_EMPTY="${OBS_INITIALIZE_EMPTY:-0}"
OBS_VERIFY_SECONDS="${OBS_VERIFY_SECONDS:-180}"
OBS_VERIFY_INTERVAL="${OBS_VERIFY_INTERVAL:-5}"
OBS_PYTHON="${OBS_PYTHON:-$OBS_ROOT/tooling/venv/bin/python}"
CRATE_SERVER_PATH="${CRATE_SERVER_PATH:-/home/crate/crate}"
CRATE_APP_PROJECT="${CRATE_APP_PROJECT:-crate}"
HOST_LOCK_DIR="${CRATE_SERVER_PATH}/.deploy"
HOST_LOCK_OWNER="obs-${OBS_DEPLOY_ID}"
HOST_LOCK_CONFIRM="$OBS_CONFIRM"
HOST_LOCK_WAIT_SECONDS="${HOST_LOCK_WAIT_SECONDS:-600}"

PROJECT=crate-observability
SERVICES=(
  crate-observability-docker-proxy
  crate-prometheus
  crate-grafana
  crate-node-exporter
  crate-postgres-exporter
  crate-redis-exporter
  crate-redis-durable-exporter
  crate-cadvisor
)
LIVE="$OBS_ROOT/live"
STATE="$OBS_ROOT/state"
RELEASES="$OBS_ROOT/releases"
TOOLS="$OBS_ROOT/tooling/$OBS_DEPLOY_SHA"
ADOPTION="$OBS_ROOT/adoption"

RESTART=()
STATEFUL=()
IMAGES=()
PREVIOUS_IMAGES=()
BACKED_UP=()
LEGACY=()
APPLIED=0
ADOPTING=0
OBS_DATA_DIR=""

log() {
  printf '==> %s\n' "$*"
}

fail() {
  printf 'Observability deploy failed: %s\n' "$*" >&2
  exit 1
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

compose_args() {
  local directory="$1"
  printf '%s\n' docker compose --project-name "$PROJECT" --project-directory "$directory" \
    --env-file "$OBS_ENV_FILE" -f "$directory/deploy/observability/compose.standalone.yaml"
  if [[ "$OBS_CONTAINERD" == "1" ]]; then
    printf '%s\n' -f "$directory/deploy/observability/compose.containerd.yaml"
  fi
  printf '%s\n' --profile observability
}

compose_command() {
  COMPOSE_COMMAND=()
  local part
  while IFS= read -r part; do
    COMPOSE_COMMAND+=("$part")
  done < <(compose_args "$1")
}

dc_in() {
  local directory="$1"
  shift
  compose_command "$directory"
  "${COMPOSE_COMMAND[@]}" "$@"
}

release_tool() {
  "$OBS_PYTHON" "$TOOLS/observability_release.py" "$@"
}

state_value() {
  [[ -f "$STATE/$1" ]] || return 0
  cat "$STATE/$1"
}

write_state() {
  mkdir -p "$STATE"
  printf '%s\n' "$2" > "$STATE/$1.tmp"
  mv -f "$STATE/$1.tmp" "$STATE/$1"
}

env_value() {
  dc_in "$1" config --environment | sed -n "s/^$2=//p" | tail -n 1
}

image_for() {
  local service="$1"
  shift
  local entry
  for entry in "$@"; do
    if [[ "${entry%% *}" == "$service" ]]; then
      printf '%s\n' "${entry#* }"
      return 0
    fi
  done
  return 1
}

assert_inputs() {
  [[ "$OBS_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "OBS_DEPLOY_SHA must be a full lowercase commit SHA"
  [[ "$OBS_DEPLOY_ID" =~ ^[A-Za-z0-9._-]+$ ]] || fail "OBS_DEPLOY_ID must use only letters, digits, dot, underscore or dash"
  [[ -f "$OBS_ENV_FILE" ]] || fail "monitoring environment file $OBS_ENV_FILE is missing"
  [[ "$OBS_ENV_FILE" != "$CRATE_SERVER_PATH/.env" ]] || fail "use the monitoring environment file, not the application .env"
  "$OBS_PYTHON" -c 'import yaml' 2>/dev/null || fail "prepare $OBS_PYTHON with PyYAML before deploying"
  [[ -f "$TOOLS/observability_release.py" && -f "$TOOLS/observability_preflight.py" ]] ||
    fail "release tooling for $OBS_DEPLOY_SHA is not staged"
}

assert_driver() {
  local driver
  driver="$(docker info --format '{{.Driver}}')"
  case "$driver:$OBS_CONTAINERD" in
    overlay2:0 | overlayfs:1) ;;
    *) fail "monitoring requires overlay2 (OBS_CONTAINERD=0) or overlayfs (OBS_CONTAINERD=1), found $driver" ;;
  esac
}

assert_runtime() {
  assert_driver
  local service projects
  for service in crate-prometheus crate-grafana; do
    projects="$(docker ps --filter "label=com.docker.compose.service=$service" \
      --format '{{with .Label "com.docker.compose.project"}}{{.}}{{else}}unmanaged{{end}}')" ||
      fail "cannot check existing monitoring writers"
    if [[ -n "$(printf '%s\n' "$projects" | sed "/^$PROJECT\$/d; /^\$/d")" ]]; then
      fail "monitoring writers from another project are running; migrate the old monitoring project first"
    fi
  done
}

assert_containerd_socket() {
  [[ "$OBS_CONTAINERD" == "1" ]] || return 0
  local socket resolved
  socket="$(env_value "$1" OBS_CONTAINERD_SOCKET)"
  resolved="$(readlink -f "${socket:-/run/containerd/containerd.sock}")" ||
    fail "unable to validate the containerd socket"
  case "$resolved" in
    /run/*) ;;
    *) fail "containerd socket must resolve under masked /run" ;;
  esac
}

stage_release() {
  local release="$RELEASES/$OBS_DEPLOY_SHA"
  if [[ -d "$release" ]]; then
    release_tool verify-release "$release" --expected-sha "$OBS_DEPLOY_SHA" >/dev/null
  else
    release_tool extract "$OBS_ROOT/staging/$OBS_DEPLOY_ID/bundle.tar.gz" \
      --expected-sha "$OBS_DEPLOY_SHA" --destination "$release" >/dev/null
  fi
}

load_plan() {
  local current="$1" candidate="$2"
  local arguments=(plan --candidate "$candidate")
  [[ -z "$current" ]] || arguments+=(--current "$current")
  local output
  output="$(release_tool "${arguments[@]}")"
  RESTART=()
  STATEFUL=()
  IMAGES=()
  PREVIOUS_IMAGES=()
  local kind rest
  while read -r kind rest; do
    case "$kind" in
      restart) RESTART+=("$rest") ;;
      stateful) STATEFUL+=("$rest") ;;
      image) IMAGES+=("$rest") ;;
      previous-image) PREVIOUS_IMAGES+=("$rest") ;;
    esac
  done <<< "$output"
  [[ "${#IMAGES[@]}" -eq "${#SERVICES[@]}" ]] || fail "release plan did not list every monitoring image"
}

preflight() {
  local directory="$1"
  local initialize=()
  [[ "$OBS_INITIALIZE_EMPTY" != "1" ]] || initialize=(--initialize-empty)
  compose_command "$directory"
  "$OBS_PYTHON" "$TOOLS/observability_preflight.py" --env-file "$OBS_ENV_FILE" \
    --project-dir "$directory" ${initialize[@]+"${initialize[@]}"} -- "${COMPOSE_COMMAND[@]}"
  dc_in "$directory" config --quiet
}

pull_missing_images() {
  local entry image
  for entry in "${IMAGES[@]}"; do
    image="${entry#* }"
    docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image" >/dev/null
  done
}

data_directory() {
  case "$1" in
    crate-prometheus) printf '%s/prometheus\n' "$OBS_DATA_DIR" ;;
    crate-grafana) printf '%s/grafana\n' "$OBS_DATA_DIR" ;;
    *) return 1 ;;
  esac
}

in_service_image() {
  local image="$1" source="$2" target="$3" script="$4"
  docker run --rm --network none --user 0:0 --entrypoint sh \
    -v "$source:/src:ro" -v "$target:/dst" "$image" -c "$script"
}

assert_backup_space() {
  local service="$1" image="$2"
  local data backup needed free
  data="$(data_directory "$service")"
  backup="$OBS_ROOT/backups/$OBS_DEPLOY_ID/$service"
  mkdir -p "$backup"
  needed="$(in_service_image "$image" "$data" "$backup" 'du -sk /src | cut -f1')"
  free="$(df -Pk "$backup" | awk 'NR == 2 { print $4 }')"
  if ((free < needed + needed / 10 + 1048576)); then
    fail "not enough space to back up $service: need ${needed} KiB plus margin, ${free} KiB free"
  fi
  log "Backing up $service state (${needed} KiB)"
}

copy_state() {
  local service="$1" image="$2"
  in_service_image "$image" "$(data_directory "$service")" "$OBS_ROOT/backups/$OBS_DEPLOY_ID/$service" \
    'cp -a /src/. /dst/ && [ "$(find /src | wc -l)" = "$(find /dst | wc -l)" ]' ||
    fail "backup of $service did not complete"
  BACKED_UP+=("$service")
}

backup_state() {
  local service="$1" image
  image="$(image_for "$service" ${PREVIOUS_IMAGES[@]+"${PREVIOUS_IMAGES[@]}"})" ||
    fail "no running image recorded for $service"
  assert_backup_space "$service" "$image"
  log "Stopping $service; monitoring gap starts"
  dc_in "$LIVE" stop "$service"
  copy_state "$service" "$image"
}

restore_copy() {
  local service="$1" image="$2"
  local backup="$OBS_ROOT/backups/$OBS_DEPLOY_ID/$service"
  log "Restoring $service state from $backup"
  docker run --rm --network none --user 0:0 --entrypoint sh \
    -v "$backup:/src:ro" -v "$(data_directory "$service"):/dst" "$image" \
    -c 'rm -rf /dst/* /dst/.[!.]* /dst/..?* && cp -a /src/. /dst/'
}

restore_state() {
  local service="$1"
  dc_in "$LIVE" stop "$service"
  restore_copy "$service" "$(image_for "$service" ${PREVIOUS_IMAGES[@]+"${PREVIOUS_IMAGES[@]}"})"
}

start_services() {
  local directory="$1"
  if [[ "$OBS_CONTAINERD" == "1" ]]; then
    dc_in "$directory" up -d --no-deps --wait --wait-timeout 45 crate-observability-docker-proxy
  fi
  dc_in "$directory" up -d --no-deps "${SERVICES[@]}"
  local service
  for service in ${RESTART[@]+"${RESTART[@]}"}; do
    dc_in "$directory" restart "$service"
  done
}

services_running() {
  local directory="$1" service id state
  for service in "${SERVICES[@]}"; do
    id="$(dc_in "$directory" ps -q "$service")"
    [[ -n "$id" ]] || return 1
    state="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")"
    case "$state" in
      "running " | "running healthy") ;;
      *) return 1 ;;
    esac
  done
}

scrapes_healthy() {
  local directory="$1"
  dc_in "$directory" exec -T crate-prometheus wget -qO- http://127.0.0.1:9090/-/ready >/dev/null || return 1
  dc_in "$directory" exec -T crate-prometheus \
    wget -qO- 'http://127.0.0.1:9090/api/v1/targets?state=active' |
    "$OBS_PYTHON" -c '
import json, sys
targets = json.load(sys.stdin)["data"]["activeTargets"]
sys.exit(0 if targets and all(target["health"] == "up" for target in targets) else 1)
'
}

grafana_ready() {
  local directory="$1" address
  address="$(dc_in "$directory" port crate-grafana 3000 | head -n 1)"
  [[ -n "$address" ]] || return 1
  curl -fsS --max-time 5 "http://$address/api/health" >/dev/null
}

verify_stack() {
  local directory="$1"
  local deadline=$((SECONDS + OBS_VERIFY_SECONDS))
  while ((SECONDS < deadline)); do
    if services_running "$directory" && scrapes_healthy "$directory" && grafana_ready "$directory"; then
      log "Monitoring verified: services running, every active scrape up, Grafana ready"
      return 0
    fi
    sleep "$OBS_VERIFY_INTERVAL"
  done
  return 1
}

activate() {
  release_tool install --release "$1" --live "$LIVE" >/dev/null
  start_services "$LIVE"
}

roll_back() {
  local previous="$1"
  set +e
  if [[ -z "$previous" ]]; then
    dc_in "$LIVE" stop "${SERVICES[@]}"
    printf 'First observability deployment failed; monitoring stopped and nothing else changed.\n' >&2
    exit 1
  fi
  printf 'Observability release %s failed; rolling back to %s.\n' "$OBS_DEPLOY_SHA" "$previous" >&2
  local service failed=0
  for service in ${BACKED_UP[@]+"${BACKED_UP[@]}"}; do
    restore_state "$service" || failed=1
  done
  load_plan "$RELEASES/$OBS_DEPLOY_SHA" "$RELEASES/$previous" || failed=1
  activate "$RELEASES/$previous" || failed=1
  if [[ "$failed" == "0" ]] && verify_stack "$LIVE"; then
    printf 'Rolled back to %s; keeping the failure exit code.\n' "$previous" >&2
  else
    printf 'Rollback to %s did not verify; check make observability-deploy-status.\n' "$previous" >&2
  fi
  exit 1
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$APPLIED" == "1" && "$status" -ne 0 ]]; then
    roll_back "$(state_value current)"
  fi
  exit "$status"
}

record() {
  local target="$1" current="$2" note="$3" backup=""
  [[ "${#BACKED_UP[@]}" -eq 0 ]] || backup="$OBS_ROOT/backups/$OBS_DEPLOY_ID"
  write_state previous "$current"
  write_state current "$target"
  write_state current.backup "$backup"
  printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OBS_DEPLOY_ID" "$note" "$target" >> "$STATE/history"
}

transition() {
  local target="$1" current="$2"
  local release="$RELEASES/$target"
  OBS_DATA_DIR="$(env_value "$release" OBS_DATA_DIR)"
  [[ -n "$OBS_DATA_DIR" ]] || fail "OBS_DATA_DIR is not set in $OBS_ENV_FILE"
  if [[ -n "$current" ]]; then
    release_tool verify-release "$LIVE" --expected-sha "$current" >/dev/null ||
      fail "live configuration drifted from $current; nothing changed"
    load_plan "$RELEASES/$current" "$release"
  else
    [[ ! -e "$LIVE" ]] || fail "live configuration exists without deployment state; nothing changed"
    load_plan "" "$release"
  fi
  preflight "$release"
  assert_containerd_socket "$release"
  pull_missing_images
  trap on_exit EXIT
  APPLIED=1
  local service
  for service in ${STATEFUL[@]+"${STATEFUL[@]}"}; do
    backup_state "$service"
  done
  activate "$release"
  verify_stack "$LIVE" || fail "monitoring did not verify within ${OBS_VERIFY_SECONDS}s"
  APPLIED=0
  trap - EXIT
  record "$target" "$current" deploy
}

cmd_deploy() {
  assert_inputs
  local current
  current="$(state_value current)"
  if [[ -z "$current" && "$OBS_CONFIRM" != "first-deploy" ]]; then
    fail "no observability deployment is recorded; the first one requires OBS_CONFIRM=first-deploy"
  fi
  assert_runtime
  stage_release
  if [[ "$current" == "$OBS_DEPLOY_SHA" ]]; then
    release_tool verify-release "$LIVE" --expected-sha "$current" >/dev/null ||
      fail "live configuration drifted from $current; nothing changed"
    verify_stack "$LIVE" || fail "release $current is already active but does not verify"
    log "Release $current is already active"
    return 0
  fi
  transition "$OBS_DEPLOY_SHA" "$current"
  rm -rf "$OBS_ROOT/staging/$OBS_DEPLOY_ID"
  log "Observability release $OBS_DEPLOY_SHA is active"
}

cmd_rollback() {
  local current previous
  current="$(state_value current)"
  previous="$(state_value previous)"
  [[ -n "$current" && -n "$previous" ]] || fail "no previous observability release to roll back to"
  [[ "$OBS_CONFIRM" == "rollback-observability" ]] || fail "rollback requires OBS_CONFIRM=rollback-observability"
  OBS_DEPLOY_SHA="$current"
  TOOLS="$OBS_ROOT/tooling/$current"
  assert_inputs
  assert_runtime
  release_tool verify-release "$RELEASES/$previous" --expected-sha "$previous" >/dev/null
  release_tool verify-release "$LIVE" --expected-sha "$current" >/dev/null ||
    fail "live configuration drifted from $current; nothing changed"
  load_plan "$RELEASES/$current" "$RELEASES/$previous"
  if [[ "${#STATEFUL[@]}" -gt 0 ]]; then
    fail "rolling back ${STATEFUL[*]} would run older images on migrated state; restore $(state_value current.backup) explicitly instead"
  fi
  preflight "$RELEASES/$previous"
  assert_containerd_socket "$RELEASES/$previous"
  pull_missing_images
  activate "$RELEASES/$previous"
  verify_stack "$LIVE" || fail "rolled-back release $previous did not verify"
  record "$previous" "$current" rollback
  log "Rolled back observability to $previous"
}

cmd_status() {
  local current
  current="$(state_value current)"
  printf 'current=%s\nprevious=%s\n' "$current" "$(state_value previous)"
  [[ -n "$current" ]] || return 0
  if "$OBS_PYTHON" "$OBS_ROOT/tooling/$current/observability_release.py" verify-release "$LIVE" \
    --expected-sha "$current" >/dev/null 2>&1; then
    echo "live=matches"
  else
    echo "live=drifted"
  fi
  dc_in "$LIVE" ps "${SERVICES[@]}"
}

legacy_containers() {
  LEGACY=()
  local service id project image
  for service in "${SERVICES[@]}"; do
    while read -r id project image; do
      [[ -n "$id" && "$project" != "$PROJECT" ]] || continue
      LEGACY+=("$service $id $image")
    done < <(docker ps --filter "label=com.docker.compose.service=$service" \
      --format '{{.ID}} {{with .Label "com.docker.compose.project"}}{{.}}{{else}}unmanaged{{end}} {{.Image}}')
  done
}

legacy_entry() {
  local entry
  for entry in ${LEGACY[@]+"${LEGACY[@]}"}; do
    if [[ "${entry%% *}" == "$1" ]]; then
      printf '%s\n' "${entry#* }"
      return 0
    fi
  done
  return 1
}

mount_source() {
  docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}" "$1"
}

assert_legacy_mount() {
  local id="$1" destination="$2" expected="$3" actual
  actual="$(mount_source "$id" "$destination")"
  [[ "$actual" == "$expected" ]] ||
    fail "legacy $destination is mounted from ${actual:-nothing}, not $expected; adopting would start a different history"
}

application_identities() {
  local id
  docker ps --filter "label=com.docker.compose.project=$CRATE_APP_PROJECT" --format '{{.ID}}' |
    while read -r id; do
      docker inspect --format \
        '{{index .Config.Labels "com.docker.compose.service"}} {{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$id"
    done | grep -Ev "^($(IFS='|'; echo "${SERVICES[*]}")) " | sort || true
}

cmd_inventory() {
  local report
  mkdir -p "$ADOPTION"
  report="$ADOPTION/inventory-$(date -u +%Y%m%dT%H%M%SZ).txt"
  legacy_containers
  {
    echo "# legacy monitoring: service container project state image mounts"
    local entry id
    for entry in ${LEGACY[@]+"${LEGACY[@]}"}; do
      id="$(cut -d' ' -f2 <<< "$entry")"
      docker inspect --format \
        "${entry%% *} {{.Id}} {{index .Config.Labels \"com.docker.compose.project\"}} {{.State.Status}} {{.Config.Image}} {{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}" "$id"
    done
    echo "# application ($CRATE_APP_PROJECT): service container started_at restarts"
    application_identities
    echo "# docker networks: $(docker network ls -q | wc -l | tr -d ' ') (adoption adds 4; default address pools allow about 31)"
  } | tee "$report"
  log "Inventory saved to $report"
}

on_adopt_exit() {
  local status=$?
  trap - EXIT
  if [[ "$ADOPTING" == "1" && "$status" -ne 0 ]]; then
    set +e
    printf 'Adoption failed; returning to the legacy monitoring.\n' >&2
    [[ ! -e "$LIVE" ]] || dc_in "$LIVE" stop "${SERVICES[@]}"
    local service entry ids=()
    for service in ${BACKED_UP[@]+"${BACKED_UP[@]}"}; do
      entry="$(legacy_entry "$service")"
      restore_copy "$service" "${entry#* }"
    done
    for entry in "${LEGACY[@]}"; do
      ids+=("$(cut -d' ' -f2 <<< "$entry")")
    done
    docker start "${ids[@]}" >/dev/null
    [[ ! -e "$LIVE" ]] || mv "$LIVE" "$OBS_ROOT/failed-live-$OBS_DEPLOY_ID"
    printf 'Legacy monitoring restarted on its pre-adoption data; keeping the failure exit code.\n' >&2
  fi
  exit "$status"
}

cmd_adopt() {
  assert_inputs
  [[ -z "$(state_value current)" ]] || fail "monitoring already runs as $PROJECT; nothing to adopt"
  [[ "$OBS_CONFIRM" == "adopt-legacy-monitoring" ]] || fail "adoption requires OBS_CONFIRM=adopt-legacy-monitoring"
  [[ ! -e "$LIVE" ]] || fail "live configuration exists without deployment state; nothing changed"
  assert_driver
  stage_release
  local release="$RELEASES/$OBS_DEPLOY_SHA"
  OBS_DATA_DIR="$(env_value "$release" OBS_DATA_DIR)"
  [[ -n "$OBS_DATA_DIR" ]] || fail "OBS_DATA_DIR is not set in $OBS_ENV_FILE"
  legacy_containers
  local prometheus grafana
  prometheus="$(legacy_entry crate-prometheus)" ||
    fail "no legacy Prometheus is running; a new installation uses OBS_CONFIRM=first-deploy"
  grafana="$(legacy_entry crate-grafana)" ||
    fail "no legacy Grafana is running; a new installation uses OBS_CONFIRM=first-deploy"
  assert_legacy_mount "${prometheus%% *}" /prometheus "$OBS_DATA_DIR/prometheus"
  assert_legacy_mount "${grafana%% *}" /var/lib/grafana "$OBS_DATA_DIR/grafana"
  load_plan "" "$release"
  preflight "$release"
  assert_containerd_socket "$release"
  pull_missing_images
  assert_backup_space crate-prometheus "${prometheus#* }"
  assert_backup_space crate-grafana "${grafana#* }"
  release_tool install --release "$release" --live "$LIVE" >/dev/null
  if ! dc_in "$LIVE" create "${SERVICES[@]}"; then
    dc_in "$LIVE" rm -f "${SERVICES[@]}" || true
    mv "$LIVE" "$OBS_ROOT/failed-live-$OBS_DEPLOY_ID"
    fail "could not create the $PROJECT networks and containers; legacy monitoring was not stopped"
  fi
  mkdir -p "$ADOPTION"
  application_identities > "$ADOPTION/application-before-$OBS_DEPLOY_ID"

  trap on_adopt_exit EXIT
  ADOPTING=1
  local entry ids=()
  for entry in "${LEGACY[@]}"; do
    ids+=("$(cut -d' ' -f2 <<< "$entry")")
  done
  log "Stopping ${#ids[@]} legacy monitoring containers; monitoring gap starts"
  docker stop "${ids[@]}" >/dev/null
  copy_state crate-prometheus "${prometheus#* }"
  copy_state crate-grafana "${grafana#* }"
  activate "$release"
  verify_stack "$LIVE" || fail "adopted monitoring did not verify within ${OBS_VERIFY_SECONDS}s"
  ADOPTING=0
  trap - EXIT
  mkdir -p "$STATE"
  printf '%s\n' "${LEGACY[@]}" > "$STATE/legacy.tmp"
  mv -f "$STATE/legacy.tmp" "$STATE/legacy"
  record "$OBS_DEPLOY_SHA" "" adopt
  application_identities > "$ADOPTION/application-after-$OBS_DEPLOY_ID"
  if cmp -s "$ADOPTION/application-before-$OBS_DEPLOY_ID" "$ADOPTION/application-after-$OBS_DEPLOY_ID"; then
    log "Application containers unchanged (same IDs, start times and restart counts)"
  else
    printf 'Application containers changed during adoption; compare %s\n' "$ADOPTION" >&2
  fi
  log "Monitoring adopted as $PROJECT at $OBS_DEPLOY_SHA; legacy containers are stopped, not removed"
}

cmd_revert_adoption() {
  [[ "$OBS_CONFIRM" == "revert-adoption" ]] || fail "reverting requires OBS_CONFIRM=revert-adoption"
  [[ -s "$STATE/legacy" ]] || fail "no adopted legacy monitoring is recorded"
  local entry ids=()
  while read -r entry; do
    ids+=("$(cut -d' ' -f2 <<< "$entry")")
  done < "$STATE/legacy"
  dc_in "$LIVE" stop "${SERVICES[@]}"
  docker start "${ids[@]}" >/dev/null
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$LIVE" "$OBS_ROOT/reverted-live-$stamp"
  mv "$STATE" "$OBS_ROOT/reverted-state-$stamp"
  log "Legacy monitoring restarted; $PROJECT stopped and its state kept in reverted-state-$stamp"
}

cmd_retire_legacy() {
  [[ "$OBS_CONFIRM" == "retire-legacy-monitoring" ]] || fail "retiring requires OBS_CONFIRM=retire-legacy-monitoring"
  [[ -n "$(state_value current)" && -s "$STATE/legacy" ]] || fail "no adopted legacy monitoring is recorded"
  local service id image project status
  while read -r service id image; do
    read -r project status < <(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}} {{.State.Status}}' "$id")
    [[ "$project" != "$PROJECT" && "$status" != "running" ]] ||
      fail "$service ($id) is running or belongs to $PROJECT; nothing removed"
  done < "$STATE/legacy"
  while read -r service id image; do
    docker rm "$id" >/dev/null
    log "Removed legacy $service container $id; its data and volumes are kept"
  done < "$STATE/legacy"
  mv -f "$STATE/legacy" "$STATE/legacy.retired"
}

main() {
  case "${1:-}" in
    deploy) host_guard cmd_deploy ;;
    rollback) host_guard cmd_rollback ;;
    status) cmd_status ;;
    inventory) cmd_inventory ;;
    adopt) host_guard cmd_adopt ;;
    revert-adoption) host_guard cmd_revert_adoption ;;
    retire-legacy) host_guard cmd_retire_legacy ;;
    host-unlock) cmd_host_unlock ;;
    *)
      printf 'Usage: %s {deploy|rollback|status|inventory|adopt|revert-adoption|retire-legacy|host-unlock}\n' "$0" >&2
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
