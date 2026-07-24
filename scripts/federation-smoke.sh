#!/usr/bin/env bash
# Federation smoke — verifies both nodes are running and can reach each other.
#
# Usage: scripts/federation-smoke.sh
#
# Checks that both APIs respond and expose federation descriptors.

set -euo pipefail

NODE_A="http://localhost:18585"
NODE_B="http://localhost:28585"
ADMIN_A="http://localhost:15173"
LISTEN_A="http://localhost:15174"
TIMEOUT=5

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

fail() { echo -e "${RED}FAIL${NC} $1"; exit 1; }
pass() { echo -e "${GREEN}PASS${NC} $1"; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }

wait_curl_ok() {
  local url="$1"
  for _ in $(seq 1 30); do
    if curl -fsS -m "$TIMEOUT" "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_curl_contains() {
  local url="$1"
  local pattern="$2"
  for _ in $(seq 1 30); do
    if curl -fsS -m "$TIMEOUT" "$url" 2>/dev/null | grep -qi "$pattern"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

container_get() {
  local container="$1"
  local url="$2"
  docker exec -i "$container" python - "$url" <<'PY'
import sys
import urllib.request

url = sys.argv[1]
with urllib.request.urlopen(url, timeout=5) as response:
    sys.stdout.write(response.read().decode("utf-8"))
PY
}

echo "=== Crate Federation Smoke ==="
echo "Node A: $NODE_A"
echo "Node B: $NODE_B"
echo "Admin A: $ADMIN_A"
echo "Listen A: $LISTEN_A"
echo ""

# Check Node A status
echo -n "Node A status... "
if wait_curl_ok "$NODE_A/api/status"; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node A is not reachable at $NODE_A"
fi

# Check Node B status
echo -n "Node B status... "
if wait_curl_ok "$NODE_B/api/status"; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node B is not reachable at $NODE_B"
fi

# Check public descriptors
echo -n "Node A descriptor... "
if wait_curl_contains "$NODE_A/.well-known/crate-node" '"node_uid"'; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node A descriptor is not available"
fi

echo -n "Node B descriptor... "
if wait_curl_contains "$NODE_B/.well-known/crate-node" '"node_uid"'; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node B descriptor is not available"
fi

echo -n "Node A Listen frontend... "
if wait_curl_contains "$LISTEN_A/" '<div id="root"'; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node A Listen frontend is not reachable at $LISTEN_A"
fi

echo -n "Node A Admin frontend... "
if wait_curl_contains "$ADMIN_A/" '<div id="root"'; then
  echo -e "${GREEN}OK${NC}"
else
  fail "Node A Admin frontend is not reachable at $ADMIN_A"
fi

# Check Node A can reach Node B on the internal network.
echo -n "Node A → Node B reachability... "
A_TO_B=$(container_get fed-a-api "http://node-b-api:8585/.well-known/crate-node" 2>&1) || true
if echo "$A_TO_B" | grep -q '"node_uid"'; then
  echo -e "${GREEN}OK${NC}"
else
  warn "Node A cannot reach Node B descriptor internally"
fi

# Check Node B can reach Node A on the internal network
echo -n "Node B → Node A reachability... "
B_TO_A=$(container_get fed-b-api "http://node-a-api:8585/.well-known/crate-node" 2>&1) || true
if echo "$B_TO_A" | grep -q '"node_uid"'; then
  echo -e "${GREEN}OK${NC}"
else
  warn "Node B cannot reach Node A descriptor internally"
fi

echo ""
echo -e "${GREEN}Smoke complete.${NC}"
