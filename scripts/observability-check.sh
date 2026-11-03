#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$ROOT_DIR/deploy/observability"
IMAGE="${OBS_PROMETHEUS_IMAGE:-$(python3 -c 'import sys, yaml; print(yaml.safe_load(open(sys.argv[1]))["services"]["crate-prometheus"]["image"])' "$CONFIG_DIR/compose.observability.yaml")}"

promtool() {
  docker run --rm --network none --read-only --tmpfs /tmp:size=64m --cap-drop ALL \
    --memory 128m --cpus 0.5 --entrypoint /bin/promtool \
    --mount "type=bind,src=$CONFIG_DIR,dst=/etc/prometheus,readonly" \
    --workdir /etc/prometheus \
    "$IMAGE" "$@"
}

promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/recording-rules.yml
promtool test rules /etc/prometheus/recording-rules.test.yml
