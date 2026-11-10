#!/usr/bin/env bash
# Off-site copies of the PostgreSQL dumps written by crate-postgres-backup.
#
# Each configured restic repository (Cloudflare R2 over S3, Google Drive through rclone)
# gets the latest weekly dump once per ISO week and the latest monthly dump once
# per month. After a monthly copy the repository is checked and a restore drill
# replays the dump's schema into a throwaway cluster inside this container. The
# production database is never contacted: the service is not on its network.
#
# Secrets arrive only as environment variables and are never printed.
set -Eeuo pipefail
umask 077

BACKUP_DIR="${CRATE_OFFSITE_BACKUP_DIR:-/backups}"
STATE_DIR="${CRATE_OFFSITE_STATE_DIR:-/state}"
DB_NAME="${CRATE_OFFSITE_DB:-crate}"
SNAPSHOT_HOST="${CRATE_OFFSITE_HOST:-crate}"
SNAPSHOT_FILE="${CRATE_OFFSITE_FILENAME:-${DB_NAME}.sql.gz}"
POLL_SECONDS="${CRATE_OFFSITE_POLL_SECONDS:-3600}"
KEEP_WEEKLY="${CRATE_OFFSITE_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${CRATE_OFFSITE_KEEP_MONTHLY:-6}"
DRILL_OWNER="${CRATE_OFFSITE_DRILL_OWNER:-${DB_NAME}}"
KINDS=(weekly monthly)

log() {
  printf '%s crate-offsite: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "error: $*" >&2
  exit 1
}

# name=url pairs, one per line. CRATE_OFFSITE_REPOSITORIES overrides discovery
# (used by tests with local repositories).
repositories() {
  if [[ -n "${CRATE_OFFSITE_REPOSITORIES:-}" ]]; then
    tr ' ' '\n' <<<"$CRATE_OFFSITE_REPOSITORIES" | sed '/^$/d'
    return
  fi
  if [[ -n "${CRATE_OFFSITE_R2_BUCKET:-}" ]]; then
    local endpoint="${CRATE_OFFSITE_R2_ENDPOINT:-https://${CRATE_OFFSITE_R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
    printf 'r2=s3:%s/%s%s\n' "${endpoint%/}" "$CRATE_OFFSITE_R2_BUCKET" \
      "${CRATE_OFFSITE_R2_PATH:+/${CRATE_OFFSITE_R2_PATH}}"
  fi
  if [[ -n "${RCLONE_CONFIG_GDRIVE_TYPE:-}" || -n "${RCLONE_CONFIG:-}" ]]; then
    printf 'gdrive=rclone:gdrive:%s\n' "${CRATE_OFFSITE_GDRIVE_PATH:-crate-backups}"
  fi
}

require_configuration() {
  [[ -n "${RESTIC_PASSWORD:-}" ]] || die "RESTIC_PASSWORD is not set"
  [[ -n "$(repositories)" ]] || die "no off-site repository is configured"
}

repo_url() {
  local name="$1" entry
  while IFS= read -r entry; do
    if [[ "${entry%%=*}" == "$name" ]]; then
      printf '%s\n' "${entry#*=}"
      return
    fi
  done < <(repositories)
  die "unknown repository: $name"
}

repo_names() {
  repositories | cut -d= -f1
}

rr() {
  local name="$1" url
  shift
  url="$(repo_url "$name")"
  if [[ "$url" == s3:* ]]; then
    # Cloudflare R2: an S3 API token scoped to the bucket; R2's region is "auto".
    AWS_ACCESS_KEY_ID="${CRATE_OFFSITE_R2_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" \
      AWS_SECRET_ACCESS_KEY="${CRATE_OFFSITE_R2_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
      AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}" \
      restic --repo "$url" "$@"
  else
    restic --repo "$url" "$@"
  fi
}

# The dump each set's crate-latest symlink points at.
latest_dump() {
  local kind="$1" link target
  link="$BACKUP_DIR/$kind/${DB_NAME}-latest.sql.gz"
  [[ -e "$link" ]] || return 1
  target="$(readlink -f "$link")"
  [[ -f "$target" ]] || return 1
  printf '%s\n' "$target"
}

# Run "$@" in a subshell with errexit in force and store its status in
# ATTEMPT_RC. Calling a function from `if` or `||` would silently disable
# errexit inside it, so failures are collected this way instead.
attempt() {
  set +e
  (
    set -e
    "$@"
  )
  ATTEMPT_RC=$?
  set -e
}

state_file() {
  printf '%s/%s.%s\n' "$STATE_DIR" "$1" "$2"
}

cmd_init() {
  require_configuration
  local name
  # init first: probing a missing S3 bucket makes restic retry for minutes, while
  # init creates the bucket, and on an existing repository it fails at once.
  for name in $(repo_names); do
    if rr "$name" init >/dev/null 2>&1; then
      log "$name: repository initialised"
    elif rr "$name" cat config >/dev/null; then
      log "$name: repository already initialised"
    else
      die "$name: repository can be neither created nor opened"
    fi
  done
}

backup_one() {
  local name="$1" kind="$2" dump stamp summary
  dump="$(latest_dump "$kind")" || die "no $kind dump under $BACKUP_DIR/$kind"
  gzip -t "$dump" || die "$kind dump $(basename "$dump") is not a valid gzip file"
  stamp="$(date -u -d "@$(stat -c %Y "$dump")" '+%Y-%m-%d %H:%M:%S')"
  # shellcheck disable=SC2094 # the dump is only read; basename does not open it
  summary="$(
    rr "$name" backup --json --quiet \
      --stdin --stdin-filename "$SNAPSHOT_FILE" \
      --host "$SNAPSHOT_HOST" --time "$stamp" \
      --tag "$kind" --tag "dump:$(basename "$dump")" \
      <"$dump" | jq -c 'select(.message_type == "summary")'
  )"
  [[ -n "$summary" ]] || die "$name: restic reported no summary for $kind"
  log "$name: $kind $(basename "$dump") snapshot $(jq -r '.snapshot_id[0:8]' <<<"$summary")" \
    "($(jq -r '.total_bytes_processed' <<<"$summary") bytes read," \
    "$(jq -r '.data_added' <<<"$summary") bytes added)"
}

forget_one() {
  local name="$1"
  rr "$name" forget --quiet --host "$SNAPSHOT_HOST" --group-by host,paths \
    --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --prune >/dev/null
  log "$name: retention applied (weekly $KEEP_WEEKLY, monthly $KEEP_MONTHLY)"
}

check_one() {
  local name="$1"
  local args=()
  read -ra args <<<"${CRATE_OFFSITE_CHECK_ARGS:-}"
  rr "$name" check "${args[@]}" >/dev/null
  log "$name: restic check passed"
}

# Restore the newest snapshot, verify the gzip stream and replay its schema
# (COPY data blocks stripped) into a throwaway cluster in a temporary directory.
drill_one() {
  local name="$1" work dump expected tables snapshot
  work="$(mktemp -d "$STATE_DIR/drill.XXXXXX")"
  # Runs in its own subshell (attempt), so EXIT cleans up on success and failure.
  # shellcheck disable=SC2064 # expand now: the trap must remove this run's dir
  trap "pg_ctl -D '$work/pg' -m immediate stop >/dev/null 2>&1 || true; rm -rf '$work'" EXIT
  snapshot="$(rr "$name" snapshots --json --latest 1 --host "$SNAPSHOT_HOST" \
    | jq -r 'max_by(.time) | .short_id')"
  [[ -n "$snapshot" && "$snapshot" != null ]] || die "$name: no snapshot to drill"
  dump="$work/$SNAPSHOT_FILE"
  rr "$name" dump "$snapshot" "/$SNAPSHOT_FILE" >"$dump"
  gzip -t "$dump" || die "$name: restored dump of $snapshot is not a valid gzip file"

  initdb -D "$work/pg" -U "$DRILL_OWNER" --auth=trust -E UTF8 >/dev/null
  pg_ctl -D "$work/pg" -w -s -l "$work/pg.log" \
    -o "-c listen_addresses='' -k '$work' -c fsync=off" start
  createdb -h "$work" -U "$DRILL_OWNER" crate_drill
  expected="$(gzip -dc "$dump" | grep -cE '^CREATE (UNLOGGED )?TABLE '|| true)"
  gzip -dc "$dump" \
    | awk 'copy == 0 && /^COPY .* FROM stdin;$/ { copy = 1; next }
           copy == 1 { if ($0 == "\\.") copy = 0; next }
           { print }' \
    | psql -X -q -h "$work" -U "$DRILL_OWNER" -d crate_drill \
      -v ON_ERROR_STOP=1 >/dev/null 2>"$work/psql.err" \
    || die "$name: schema replay of $snapshot failed: $(head -c 500 "$work/psql.err")"
  tables="$(psql -X -At -h "$work" -U "$DRILL_OWNER" -d crate_drill -c \
    "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"
  [[ "$expected" -gt 0 && "$tables" == "$expected" ]] \
    || die "$name: drill of $snapshot restored $tables of $expected tables"
  log "$name: restore drill of $snapshot passed ($(stat -c %s "$dump") bytes, $tables tables)"
}

cmd_backup() {
  local kind="${1:-}" name
  [[ " ${KINDS[*]} " == *" $kind "* ]] || die "usage: backup weekly|monthly"
  require_configuration
  for name in $(repo_names); do
    backup_and_forget "$name" "$kind"
  done
}

for_each_repo() {
  local fn="$1" name failed=0
  require_configuration
  for name in $(repo_names); do
    attempt "$fn" "$name"
    [[ "$ATTEMPT_RC" == 0 ]] || failed=1
  done
  return "$failed"
}

backup_and_forget() {
  backup_one "$1" "$2"
  forget_one "$1"
}

check_and_drill() {
  check_one "$1"
  drill_one "$1"
}

# One scheduler pass. A repository gets each new weekly or monthly dump once;
# a failure leaves its state untouched so the next pass retries.
cmd_tick() {
  require_configuration
  local name kind dump current previous failed=0 did_monthly
  mkdir -p "$STATE_DIR"
  for name in $(repo_names); do
    did_monthly=0
    for kind in "${KINDS[@]}"; do
      dump="$(latest_dump "$kind")" || { log "no $kind dump yet"; continue; }
      current="$(basename "$dump")"
      previous="$(cat "$(state_file "$name" "$kind")" 2>/dev/null || true)"
      [[ "$current" == "$previous" ]] && continue
      attempt backup_and_forget "$name" "$kind"
      if [[ "$ATTEMPT_RC" == 0 ]]; then
        printf '%s\n' "$current" >"$(state_file "$name" "$kind")"
        [[ "$kind" == monthly ]] && did_monthly=1
      else
        log "$name: $kind copy of $current failed; retrying next pass"
        failed=1
      fi
    done
    if [[ "$did_monthly" == 1 ]]; then
      attempt check_and_drill "$name"
      if [[ "$ATTEMPT_RC" == 0 ]]; then
        date -u +%Y-%m-%dT%H:%M:%SZ >"$(state_file "$name" drill)"
      else
        log "$name: monthly check or drill failed"
        failed=1
      fi
    fi
  done
  if [[ "$failed" == 0 ]]; then
    echo ok >"$STATE_DIR/status"
  else
    echo failed >"$STATE_DIR/status"
  fi
  return "$failed"
}

cmd_schedule() {
  require_configuration
  log "watching $BACKUP_DIR for $(repo_names | paste -sd, -) every ${POLL_SECONDS}s"
  cmd_init
  while true; do
    cmd_tick || true
    touch "$STATE_DIR/heartbeat"
    sleep "$POLL_SECONDS"
  done
}

cmd_health() {
  local heartbeat="$STATE_DIR/heartbeat"
  [[ -f "$heartbeat" ]] || exit 0 # first pass still running
  (($(date +%s) - $(stat -c %Y "$heartbeat") < 3 * POLL_SECONDS)) || exit 1
  [[ "$(cat "$STATE_DIR/status" 2>/dev/null)" == ok ]]
}

cmd_snapshots() {
  require_configuration
  local name
  for name in $(repo_names); do
    rr "$name" snapshots --json --host "$SNAPSHOT_HOST" \
      | jq -r --arg repo "$name" \
        '.[] | [$repo, .short_id, .time[0:19], (.tags | join(",")), (.summary.total_bytes_processed // "")] | @tsv'
  done
}

main() {
  local command="${1:-schedule}"
  shift || true
  case "$command" in
  init) cmd_init ;;
  backup) cmd_backup "$@" ;;
  forget) for_each_repo forget_one ;;
  check) for_each_repo check_one ;;
  drill) for_each_repo drill_one ;;
  tick) cmd_tick ;;
  schedule) cmd_schedule ;;
  health) cmd_health ;;
  snapshots) cmd_snapshots ;;
  repositories) repo_names ;;
  restic)
    # Plain restic against one configured repository, e.g. `restic r2 key list`.
    [[ $# -ge 2 ]] || die "usage: crate-offsite restic <repository> <restic arguments>"
    require_configuration
    rr "$@"
    ;;
  *) die "usage: crate-offsite init|backup weekly|monthly|forget|check|drill|tick|schedule|health|snapshots|repositories|restic <repo> ..." ;;
  esac
}

main "$@"
