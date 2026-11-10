#!/usr/bin/env bash
# End-to-end test of crate-offsite against local restic repositories.
# Runs inside the image (see .github/workflows/test-backup-offsite.yml):
#   docker build -t crate-backup-offsite:test deploy/backup-offsite
#   docker run --rm --entrypoint bash -v "$PWD/deploy/backup-offsite/test.sh:/test.sh:ro" \
#     crate-backup-offsite:test /test.sh
set -Eeuo pipefail

ROOT="$(mktemp -d)"
trap 'pg_ctl -D "$ROOT/src" -m immediate stop >/dev/null 2>&1 || true' EXIT
export TZ=UTC
export RESTIC_PASSWORD="test-password-$RANDOM-$RANDOM"
export CRATE_OFFSITE_BACKUP_DIR="$ROOT/backups"
export CRATE_OFFSITE_STATE_DIR="$ROOT/state"
export RESTIC_CACHE_DIR="$ROOT/cache"
export CRATE_OFFSITE_REPOSITORIES="a=$ROOT/repos/a b=$ROOT/repos/b"
LOG="$ROOT/output.log"
mkdir -p "$CRATE_OFFSITE_STATE_DIR" "$CRATE_OFFSITE_BACKUP_DIR"/{last,daily,weekly,monthly}

fail() {
  echo "FAIL: $*" >&2
  echo "--- crate-offsite output ---" >&2
  cat "$LOG" >&2 || true
  exit 1
}

pass() {
  echo "ok - $*"
}

offsite() {
  crate-offsite "$@" >>"$LOG" 2>&1
}

count_snapshots() {
  restic -r "$1" snapshots --json | jq length
}

# A source cluster shaped like production: pgvector, an unlogged table, data.
initdb -D "$ROOT/src" -U crate --auth=trust >/dev/null
pg_ctl -D "$ROOT/src" -w -s -l "$ROOT/src.log" -o "-c listen_addresses='' -k $ROOT" start
psql -X -q -h "$ROOT" -U crate -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION vector;
CREATE EXTENSION pg_trgm;
CREATE TABLE artists (id bigserial PRIMARY KEY, name text NOT NULL, embedding vector(3));
CREATE UNLOGGED TABLE cache_entries (key text PRIMARY KEY, value jsonb);
CREATE INDEX artists_name_trgm ON artists USING gin (name gin_trgm_ops);
INSERT INTO artists (name, embedding)
  SELECT 'artist ' || g, ARRAY[g, g + 1, g + 2]::vector FROM generate_series(1, 500) g;
INSERT INTO cache_entries VALUES ('a', '{"x": 1}');
SQL

# Write a dump the way crate-postgres-backup does: last/ plus hard links.
write_dump() {
  local daily="$1" week="$2" month="$3" when="$4" file
  file="$CRATE_OFFSITE_BACKUP_DIR/last/crate-${daily}-000000.sql.gz"
  pg_dump -h "$ROOT" -U crate -d postgres -Z6 -f "$file"
  touch -d "$when" "$file"
  ln -f "$file" "$CRATE_OFFSITE_BACKUP_DIR/daily/crate-${daily}.sql.gz"
  ln -f "$file" "$CRATE_OFFSITE_BACKUP_DIR/weekly/crate-${week}.sql.gz"
  ln -f "$file" "$CRATE_OFFSITE_BACKUP_DIR/monthly/crate-${month}.sql.gz"
  ln -sf "crate-${daily}.sql.gz" "$CRATE_OFFSITE_BACKUP_DIR/daily/crate-latest.sql.gz"
  ln -sf "crate-${week}.sql.gz" "$CRATE_OFFSITE_BACKUP_DIR/weekly/crate-latest.sql.gz"
  ln -sf "crate-${month}.sql.gz" "$CRATE_OFFSITE_BACKUP_DIR/monthly/crate-latest.sql.gz"
}

write_dump 20261102 202645 202611 "2026-11-02 00:02"

# Missing password or repositories fail loudly.
if RESTIC_PASSWORD='' crate-offsite tick >>"$LOG" 2>&1; then
  fail "tick ran without RESTIC_PASSWORD"
fi
pass "refuses to run without RESTIC_PASSWORD"

offsite init
offsite init
[[ "$(count_snapshots "$ROOT/repos/a")" == 0 ]] || fail "init created snapshots"
pass "init is idempotent"

offsite tick || fail "first tick failed"
for repo in a b; do
  [[ "$(count_snapshots "$ROOT/repos/$repo")" == 2 ]] || fail "$repo: expected weekly and monthly"
  restic -r "$ROOT/repos/$repo" snapshots --json --tag weekly | jq -e 'length == 1' >/dev/null \
    || fail "$repo: weekly tag missing"
  restic -r "$ROOT/repos/$repo" snapshots --json --tag monthly | jq -e 'length == 1' >/dev/null \
    || fail "$repo: monthly tag missing"
  [[ -s "$CRATE_OFFSITE_STATE_DIR/$repo.drill" ]] || fail "$repo: monthly drill did not run"
done
grep -q "restore drill of .* passed (.* 2 tables)" "$LOG" || fail "drill did not count both tables"
[[ "$(cat "$CRATE_OFFSITE_STATE_DIR/status")" == ok ]] || fail "status is not ok"
pass "first tick copies weekly and monthly to both repositories and drills"

restored="$ROOT/restored.sql.gz"
restic -r "$ROOT/repos/b" dump latest /crate.sql.gz >"$restored"
cmp -s "$restored" "$CRATE_OFFSITE_BACKUP_DIR/weekly/crate-202645.sql.gz" || fail "restored dump differs"
pass "restored dump is byte-identical"

offsite tick
[[ "$(count_snapshots "$ROOT/repos/a")" == 2 ]] || fail "second tick copied again"
pass "a second tick in the same week does nothing"

drill_before="$(cat "$CRATE_OFFSITE_STATE_DIR/a.drill")"
write_dump 20261109 202646 202611 "2026-11-09 00:02"
offsite tick
[[ "$(count_snapshots "$ROOT/repos/a")" == 3 ]] || fail "new week was not copied"
[[ "$(cat "$CRATE_OFFSITE_STATE_DIR/a.drill")" == "$drill_before" ]] || fail "weekly copy re-ran the drill"
pass "a new weekly dump is copied once without a drill"

# Retention: ten Monday dumps from January to March in a fresh repository.
export CRATE_OFFSITE_REPOSITORIES="c=$ROOT/repos/c"
offsite init
for day in 2026-01-05 2026-01-12 2026-01-19 2026-01-26 2026-02-02 \
  2026-02-09 2026-02-16 2026-02-23 2026-03-02 2026-03-09; do
  touch -d "$day 00:02" "$CRATE_OFFSITE_BACKUP_DIR/weekly/crate-202646.sql.gz"
  offsite backup weekly
done
kept="$(restic -r "$ROOT/repos/c" snapshots --json | jq -r '[.[].time[0:10]] | sort | join(" ")')"
# Weekly: Mar 9, Mar 2, Feb 23, Feb 16. Monthly: Mar 9, Feb 23, Jan 26, and
# because only 3 of the 6 monthly buckets are filled restic also keeps the
# oldest snapshot (Jan 5).
[[ "$kept" == "2026-01-05 2026-01-26 2026-02-16 2026-02-23 2026-03-02 2026-03-09" ]] \
  || fail "retention kept: $kept"
pass "forget keeps 4 weekly and the newest of each month"

# A corrupt snapshot fails the drill.
export CRATE_OFFSITE_REPOSITORIES="d=$ROOT/repos/d"
offsite init
echo "not gzip" | restic -r "$ROOT/repos/d" backup --quiet --host crate \
  --stdin --stdin-filename crate.sql.gz >/dev/null
if crate-offsite drill >>"$LOG" 2>&1; then
  fail "drill accepted a corrupt dump"
fi
echo "CREATE TABLE broken (" | gzip | restic -r "$ROOT/repos/d" backup --quiet --host crate \
  --stdin --stdin-filename crate.sql.gz >/dev/null
if crate-offsite drill >>"$LOG" 2>&1; then
  fail "drill accepted SQL that does not replay"
fi
compgen -G "$CRATE_OFFSITE_STATE_DIR/drill.*" >/dev/null && fail "drill left its work directory"
pass "drill rejects corrupt and unreplayable dumps and cleans up"

# An unreachable repository is retried and reported unhealthy; the other proceeds.
export CRATE_OFFSITE_REPOSITORIES="e=$ROOT/repos/e broken=/proc/1/forbidden"
offsite init || true
if crate-offsite tick >>"$LOG" 2>&1; then
  fail "tick hid a failing repository"
fi
[[ "$(cat "$CRATE_OFFSITE_STATE_DIR/status")" == failed ]] || fail "status not failed"
[[ ! -e "$CRATE_OFFSITE_STATE_DIR/broken.weekly" ]] || fail "failed copy was recorded"
[[ "$(count_snapshots "$ROOT/repos/e")" == 2 ]] || fail "healthy repository was skipped"
touch "$CRATE_OFFSITE_STATE_DIR/heartbeat"
if crate-offsite health; then
  fail "health ignored the failed status"
fi
pass "a failing repository is retried, reported, and does not block the others"

# Production discovery: R2 through restic's S3 backend (a local MinIO stands in
# for Cloudflare) and Google Drive through rclone (a "local" remote stands in).
if [[ -n "${CRATE_OFFSITE_TEST_S3_ENDPOINT:-}" ]]; then
  unset CRATE_OFFSITE_REPOSITORIES
  export CRATE_OFFSITE_STATE_DIR="$ROOT/state-discovered"
  export CRATE_OFFSITE_R2_ENDPOINT="$CRATE_OFFSITE_TEST_S3_ENDPOINT"
  export CRATE_OFFSITE_R2_ACCOUNT_ID=unused-with-endpoint
  export CRATE_OFFSITE_R2_BUCKET="crate-offsite-test-$RANDOM"
  export CRATE_OFFSITE_R2_ACCESS_KEY_ID="${CRATE_OFFSITE_TEST_S3_ACCESS_KEY:?}"
  export CRATE_OFFSITE_R2_SECRET_ACCESS_KEY="${CRATE_OFFSITE_TEST_S3_SECRET_KEY:?}"
  export RCLONE_CONFIG_GDRIVE_TYPE=local
  export CRATE_OFFSITE_GDRIVE_PATH="$ROOT/drive"
  mkdir -p "$CRATE_OFFSITE_STATE_DIR"
  [[ "$(crate-offsite repositories | paste -sd' ')" == "r2 gdrive" ]] \
    || fail "discovered: $(crate-offsite repositories | paste -sd' ')"
  offsite init
  offsite tick || fail "tick against R2 and Drive failed"
  for repo in r2 gdrive; do
    [[ "$(crate-offsite snapshots | awk -v r="$repo" '$1 == r' | wc -l)" == 2 ]] \
      || fail "$repo: expected weekly and monthly snapshots"
    [[ -s "$CRATE_OFFSITE_STATE_DIR/$repo.drill" ]] || fail "$repo: drill did not run"
  done
  [[ -f "$ROOT/drive/config" ]] || fail "rclone repository is not where Drive would hold it"
  [[ "$(crate-offsite restic r2 snapshots --json | jq length)" == 2 ]] \
    || fail "restic passthrough does not reach R2 with the mapped keys"
  grep -qF "$CRATE_OFFSITE_R2_SECRET_ACCESS_KEY" "$LOG" && fail "the R2 secret reached the logs"
  pass "R2 (S3) and Drive (rclone) repositories are discovered, copied and drilled"
else
  echo "skip - R2 and Drive paths (set CRATE_OFFSITE_TEST_S3_ENDPOINT and keys)"
fi

grep -qF "$RESTIC_PASSWORD" "$LOG" && fail "the restic password reached the logs"
pass "the password never appears in the output"

echo "all crate-offsite tests passed"
