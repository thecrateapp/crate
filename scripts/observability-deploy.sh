#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_USER="${SERVER_USER:-crate}"
SERVER_HOST="${SERVER_HOST:-95.216.3.27}"
SERVER_PATH="${SERVER_PATH:-/home/crate/crate}"
REMOTE="${SERVER_USER}@${SERVER_HOST}"
OBS_REMOTE_ROOT="${OBS_REMOTE_ROOT:-/home/crate/crate-observability}"
OBS_REMOTE_ENV_FILE="${OBS_REMOTE_ENV_FILE:-/etc/crate-observability/monitoring.env}"
OBS_DEPLOY_SHA="${OBS_DEPLOY_SHA:-}"
OBS_DEPLOY_ID="${OBS_DEPLOY_ID:-obs-$(date -u +%Y%m%d-%H%M%S)}"
OBS_CONTAINERD="${OBS_CONTAINERD:-0}"
OBS_CONFIRM="${OBS_CONFIRM:-}"
OBS_INITIALIZE_EMPTY="${OBS_INITIALIZE_EMPTY:-0}"
OBS_MAIN_REF="${OBS_MAIN_REF:-origin/main}"
OBS_PYTHON="${OBS_PYTHON:-python3}"
TOOLING=(
  scripts/observability_release.py
  scripts/observability_preflight.py
  scripts/observability-deploy-remote.sh
)
TMP_DIR=""

fail() {
  printf 'Observability deploy failed: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  [[ -z "$TMP_DIR" ]] || rm -rf "$TMP_DIR"
}
trap cleanup EXIT

quoted() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

remote_run() {
  local script="$1" step="$2"
  ssh "$REMOTE" "OBS_ROOT=$(quoted "$OBS_REMOTE_ROOT") OBS_ENV_FILE=$(quoted "$OBS_REMOTE_ENV_FILE") \
OBS_DEPLOY_ID=$(quoted "$OBS_DEPLOY_ID") OBS_DEPLOY_SHA=$(quoted "$OBS_DEPLOY_SHA") \
OBS_CONTAINERD=$(quoted "$OBS_CONTAINERD") OBS_CONFIRM=$(quoted "$OBS_CONFIRM") \
OBS_INITIALIZE_EMPTY=$(quoted "$OBS_INITIALIZE_EMPTY") CRATE_SERVER_PATH=$(quoted "$SERVER_PATH") \
bash $script $(quoted "$step")"
}

active_remote_script() {
  local root
  root="$(quoted "$OBS_REMOTE_ROOT")"
  printf '%s/tooling/"$(cat %s/state/current)"/observability-deploy-remote.sh' "$root" "$root"
}

require_main_release() {
  [[ "$OBS_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "VERSION must be a full lowercase commit SHA"
  git -C "$ROOT_DIR" cat-file -e "${OBS_DEPLOY_SHA}^{commit}" 2>/dev/null ||
    fail "commit $OBS_DEPLOY_SHA is not available locally; fetch it first"
  git -C "$ROOT_DIR" merge-base --is-ancestor "$OBS_DEPLOY_SHA" "$OBS_MAIN_REF" ||
    fail "$OBS_DEPLOY_SHA is not on $OBS_MAIN_REF; deploy only approved main revisions"
}

package_release() {
  TMP_DIR="$(mktemp -d)"
  "$OBS_PYTHON" "$ROOT_DIR/scripts/observability_release.py" bundle --source-root "$ROOT_DIR" \
    --sha "$OBS_DEPLOY_SHA" --output "$TMP_DIR/bundle.tar.gz" >/dev/null
  "$OBS_PYTHON" "$ROOT_DIR/scripts/observability_release.py" verify "$TMP_DIR/bundle.tar.gz" \
    --expected-sha "$OBS_DEPLOY_SHA" >/dev/null
  local file
  for file in "${TOOLING[@]}"; do
    git -C "$ROOT_DIR" show "$OBS_DEPLOY_SHA:$file" > "$TMP_DIR/$(basename "$file")" ||
      fail "$file is missing from $OBS_DEPLOY_SHA"
  done
}

stage_release() {
  local staging="$OBS_REMOTE_ROOT/staging/$OBS_DEPLOY_ID"
  local tools="$OBS_REMOTE_ROOT/tooling/$OBS_DEPLOY_SHA"
  ssh "$REMOTE" "mkdir -p $(quoted "$staging") $(quoted "$tools")"
  scp -q "$TMP_DIR/bundle.tar.gz" "$REMOTE:$staging/bundle.tar.gz"
  scp -q "$TMP_DIR/observability_release.py" "$TMP_DIR/observability_preflight.py" \
    "$TMP_DIR/observability-deploy-remote.sh" "$REMOTE:$tools/"
}

run_deploy() {
  require_main_release
  package_release
  stage_release
  remote_run "$(quoted "$OBS_REMOTE_ROOT/tooling/$OBS_DEPLOY_SHA/observability-deploy-remote.sh")" deploy
}

run_rollback() {
  [[ "$OBS_CONFIRM" == "rollback-observability" ]] || fail "rollback requires CONFIRM=rollback-observability"
  remote_run "$(active_remote_script)" rollback
}

run_status() {
  remote_run "$(active_remote_script)" status
}

case "$ACTION" in
  deploy) run_deploy ;;
  rollback) run_rollback ;;
  status) run_status ;;
  *) fail "unknown action '${ACTION}' (expected deploy, rollback or status)" ;;
esac
