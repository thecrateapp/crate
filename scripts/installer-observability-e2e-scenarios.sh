#!/usr/bin/env bash
# Runs inside the Docker-in-Docker container of installer-observability-e2e.sh.
set -euo pipefail

CRATE=/e2e/crate
DOCKER=/usr/local/bin/docker
DIR=/srv/crate
PASSWORD=e2e-grafana-password-7Kq2
LOGS=/var/log/crate-e2e
NETWORK=crate-observability_app-metrics
mkdir -p "$LOGS" /e2e-bin

cat >/e2e-bin/docker <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>/var/log/crate-e2e/argv.log
exec /usr/local/bin/docker "$@"
EOF
chmod +x /e2e-bin/docker
export PATH=/e2e-bin:$PATH

step() { printf '\n==> %s\n' "$*"; }
check() {
  local description=$1
  shift
  if "$@"; then
    printf '    ok    %s\n' "$description"
  else
    printf '    FAIL  %s\n' "$description" >&2
    exit 1
  fi
}
retry() {
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep 5
  done
}
crate() {
  local log=$1
  shift
  if ! "$CRATE" "$@" >"$LOGS/$log.log" 2>&1; then
    tail -n 80 "$LOGS/$log.log" >&2
    printf '    FAIL  crate %s\n' "$*" >&2
    exit 1
  fi
}

api_up() { curl -fsS --max-time 5 http://127.0.0.1:8585/api/status >/dev/null; }
grafana_up() { curl -fsS --max-time 5 http://127.0.0.1:3001/api/health >/dev/null; }
grafana() { curl -fsS --max-time 10 -u "admin:$PASSWORD" "$@"; }
monitoring() { $DOCKER ps -a --filter label=com.docker.compose.project=crate-observability --format '{{.State}}'; }
count() { monitoring | grep -c "^$1\$" || true; }
none_exists() { [[ -z $(monitoring) ]]; }
all_running() { [[ $(count running) == 8 ]]; }
all_exited() { [[ $(count exited) == 8 && $(count running) == 0 ]]; }
prometheus() { $DOCKER ps -q --filter label=com.docker.compose.project=crate-observability --filter label=com.docker.compose.service=crate-prometheus; }
promql() { $DOCKER exec "$(prometheus)" wget -qO- "http://127.0.0.1:9090/api/v1/$1"; }
targets_up() {
  local targets
  targets=$(promql 'targets?state=active') || return 1
  [[ $(jq '[.data.activeTargets[] | select(.health != "up")] | length' <<<"$targets") == 0 &&
    $(jq '[.data.activeTargets[] | select(.labels.job == "crate-app")] | length' <<<"$targets") -ge 5 ]]
}
exporter_reaches_postgres() { [[ $(promql 'query?query=pg_up' | jq -r '.data.result[0].value[1]') == 1 ]]; }
sample_at() { [[ $(promql "query?query=up&time=$1" | jq '.data.result | length') -gt 0 ]]; }
observer_role() {
  [[ $($DOCKER exec crate-postgres psql -U crate -d crate -tAc \
    "select rolcanlogin, rolsuper, rolconnlimit, pg_has_role(oid, 'pg_monitor', 'MEMBER') from pg_roles where rolname = 'crate_observer'") == "t|f|4|t" ]]
}
compose_files() { grep '^COMPOSE_FILE=' "$1/.env" | cut -d= -f2- | tr -d '"' || true; }
connected() { grep -q compose.app-metrics.yaml <<<"$(compose_files "$DIR")"; }
disconnected() { ! grep -q observability <<<"$(compose_files "$DIR")"; }
no_secret_leaked() {
  local secret
  for secret in "$PASSWORD" "$(grep '^REDIS_PASSWORD=' "$DIR/.env" | cut -d= -f2- | tr -d '"')"; do
    if grep -rqF -- "$secret" "$LOGS"; then return 1; fi
  done
}
nothing_removed() { ! grep -Eq '(^| )(down|rm|volume rm|network rm)( |$)' "$LOGS/argv.log"; }
doctor() { "$CRATE" doctor --json --dir "$DIR" 2>/dev/null | jq -c .monitoring || true; }
doctor_healthy() { [[ $(doctor | jq -r '[.configured, .connected, .running, .grafana_healthy] | map(tostring) | join(",")') == "true,true,8,true" ]]; }
doctor_warns_network() { [[ $(doctor | jq -r '"\(.connected) \(.missing_overlays | join(","))"') == "false deploy/observability/compose.app-metrics.yaml" ]]; }
status_ok() { grep -q '8 of 8 running' "$LOGS/status.log" && grep -q connected "$LOGS/status.log"; }
marker_folder() { grafana http://127.0.0.1:3001/api/folders | jq -e 'map(.title) | index("e2e-marker")' >/dev/null; }
started_at() { $DOCKER inspect -f '{{.State.StartedAt}}' "$1"; }

step "7. A default unattended install leaves monitoring off"
crate default install --yes --dir /srv/crate-default
check "Crate answers" retry 300 api_up
check "no monitoring container exists" none_exists
check "no monitoring overlay in COMPOSE_FILE" bash -c '! grep -q observability /srv/crate-default/.env'
(cd /srv/crate-default && $DOCKER compose down -v >/dev/null 2>&1)
rm -rf /srv/crate-default

step "1. A new unattended install with --observability=on"
CRATE_GRAFANA_PASSWORD=$PASSWORD crate on install --yes --observability=on --dir "$DIR"
check "Crate answers" retry 300 api_up
check "the 8 monitoring services run" all_running
check "Grafana answers on loopback" grafana_up
check "Grafana accepts the password from the environment" grafana http://127.0.0.1:3001/api/user -o /dev/null
check "every Prometheus target is up, Crate's included" retry 240 targets_up
check "the exporter reaches PostgreSQL" retry 120 exporter_reaches_postgres
check "crate_observer logs in with pg_monitor, no superuser, 4 connections" observer_role
check "Crate is connected" connected
check "no secret in installer output or docker argv" no_secret_leaked

step "2. status and doctor"
crate status observability status --dir "$DIR"
check "status shows 8 of 8 running and Crate connected" status_ok
check "doctor --json reports monitoring healthy" doctor_healthy

step "Markers: a Grafana folder and a Prometheus sample"
grafana -H 'Content-Type: application/json' -d '{"title":"e2e-marker"}' http://127.0.0.1:3001/api/folders >/dev/null
marker=$(date +%s)
check "Prometheus has samples at the marker time" retry 90 sample_at "$marker"
sleep 30

step "3. disable"
: >"$LOGS/argv.log"
crate disable observability disable --yes --dir "$DIR"
check "the overlays left COMPOSE_FILE" disconnected
check "Crate still answers" retry 120 api_up
check "monitoring stopped, its containers kept" all_exited
check "no down, rm or volume removal" nothing_removed
check "monitoring data and settings kept" test -d "$DIR/data/observability/prometheus" -a -f "$DIR/monitoring.env"

step "4. enable again keeps history and Grafana state"
crate enable observability enable --yes --dir "$DIR"
check "the 8 monitoring services run again" retry 120 all_running
check "Crate is connected again" connected
check "Grafana kept the marker folder" retry 120 marker_folder
check "Prometheus kept the sample from before" retry 120 sample_at "$marker"

step "5. A reinstall keeps monitoring and restarts what reads a changed file"
before=$(prometheus)
before_start=$(started_at "$before")
echo "# e2e change" >>"$DIR/deploy/observability/prometheus.yml"
crate reinstall install --yes --dir "$DIR"
check "monitoring is still connected" connected
check "Prometheus kept its container" test "$(prometheus)" = "$before"
check "Prometheus restarted" test "$(started_at "$before")" != "$before_start"
check "the restart is reported" grep -q "Restarting crate-prometheus" "$LOGS/reinstall.log"
check "Crate answers" retry 120 api_up

step "6. A lost monitoring network never stops Crate"
for container in $($DOCKER network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$NETWORK"); do
  $DOCKER network disconnect -f "$NETWORK" "$container"
done
$DOCKER network rm "$NETWORK" >/dev/null
check "doctor warns about the missing network" doctor_warns_network
crate lost install --yes --dir "$DIR"
check "Crate started without the overlay" grep -q "Starting without deploy/observability/compose.app-metrics.yaml" "$LOGS/lost.log"
check "Crate answers" retry 120 api_up
check "monitoring brought the network back" $DOCKER network inspect "$NETWORK" -f '{{.Name}}'
check "doctor reports monitoring healthy again" retry 120 doctor_healthy
check "no secret in any log or docker argv" no_secret_leaked

step "All scenarios passed"
$DOCKER system df
