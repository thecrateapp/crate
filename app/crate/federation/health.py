"""Health polling — checks approved peers periodically and updates health state."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from crate.db.repositories import federation as repo
from crate.federation.client import fetch_descriptor
from crate.federation.events import (
    emit_global_catalog_source_changed,
    emit_peer_health_changed,
)
from crate.federation.global_content_cache import invalidate_source_cache

log = logging.getLogger(__name__)

HEALTH_BACKOFF_BASE_SECONDS = 30
HEALTH_BACKOFF_MAX_SECONDS = 30 * 60


def federation_health_snapshot() -> dict:
    local_node = repo.get_local_node()
    if local_node is None:
        return {
            "ok": True,
            "state": "unconfigured_singleton",
            "peer_count": 0,
            "healthy_peer_count": 0,
            "unhealthy_peer_count": 0,
        }
    capabilities = local_node.get("capabilities_json") or {}
    if isinstance(capabilities, str):
        try:
            capabilities = json.loads(capabilities)
        except json.JSONDecodeError:
            capabilities = {}
    if isinstance(capabilities, dict) and capabilities.get("catalog.search") is False:
        return {
            "ok": True,
            "state": "disabled",
            "peer_count": 0,
            "healthy_peer_count": 0,
            "unhealthy_peer_count": 0,
        }

    peers = [peer for peer in repo.list_peers() if peer.get("disabled_at") is None]
    if not peers:
        return {
            "ok": True,
            "state": "healthy_singleton",
            "peer_count": 0,
            "healthy_peer_count": 0,
            "unhealthy_peer_count": 0,
        }
    healthy = sum(
        1
        for peer in peers
        if isinstance(peer.get("health_json"), dict)
        and peer["health_json"].get("healthy") is True
    )
    unhealthy = len(peers) - healthy
    state = "healthy" if unhealthy == 0 else "degraded" if healthy else "unavailable"
    return {
        "ok": state != "unavailable",
        "state": state,
        "peer_count": len(peers),
        "healthy_peer_count": healthy,
        "unhealthy_peer_count": unhealthy,
    }


def _failure_health(peer: dict, *, latency_ms: int) -> dict:
    previous = peer.get("health_json")
    previous_failures = (
        int(previous.get("consecutive_failures") or 0)
        if isinstance(previous, dict)
        else 0
    )
    failures = previous_failures + 1
    backoff_seconds = min(
        HEALTH_BACKOFF_BASE_SECONDS * (2 ** min(failures - 1, 10)),
        HEALTH_BACKOFF_MAX_SECONDS,
    )
    return {
        "healthy": False,
        "latency_ms": latency_ms,
        "consecutive_failures": failures,
        "backoff_until": (
            datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds)
        ).isoformat(),
    }


def _previous_healthy(peer: dict) -> bool | None:
    health_json = peer.get("health_json")
    if not isinstance(health_json, dict):
        return None
    value = health_json.get("healthy")
    return value if isinstance(value, bool) else None


def _emit_health_transition(peer: dict, *, healthy: bool, latency_ms: int) -> None:
    node_uid = str(peer["node_uid"])
    if _previous_healthy(peer) is healthy:
        return

    emit_peer_health_changed(node_uid, healthy, latency_ms)
    if healthy:
        emit_global_catalog_source_changed(node_uid=node_uid, reason="peer_healthy")
        return

    invalidate_source_cache(node_uid)
    emit_global_catalog_source_changed(node_uid=node_uid, reason="peer_unhealthy")


def poll_peer(
    peer: dict,
    timeout: int = 5,
) -> dict:
    start = time.monotonic()
    try:
        descriptor = fetch_descriptor(
            peer["api_base_url"],
            timeout=httpx.Timeout(timeout, connect=timeout),
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        if descriptor:
            repo.update_peer(
                peer["node_uid"],
                health_json={
                    "healthy": True,
                    "latency_ms": latency_ms,
                    "consecutive_failures": 0,
                    "backoff_until": None,
                },
                last_health_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                last_success_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                last_error=None,
            )
            _emit_health_transition(peer, healthy=True, latency_ms=latency_ms)
            return {"healthy": True, "latency_ms": latency_ms, "error": None}
        else:
            latency_ms = int((time.monotonic() - start) * 1000)
            repo.update_peer(
                peer["node_uid"],
                health_json=_failure_health(peer, latency_ms=latency_ms),
                last_health_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                last_error="descriptor_unreachable",
            )
            _emit_health_transition(peer, healthy=False, latency_ms=latency_ms)
            return {
                "healthy": False,
                "latency_ms": latency_ms,
                "error": "descriptor_unreachable",
            }

    except Exception as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        repo.update_peer(
            peer["node_uid"],
            health_json=_failure_health(peer, latency_ms=latency_ms),
            last_health_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            last_error=str(e)[:200],
        )
        _emit_health_transition(peer, healthy=False, latency_ms=latency_ms)
        return {"healthy": False, "latency_ms": latency_ms, "error": str(e)[:200]}


def run_health_poll() -> list[dict]:
    peers = repo.list_peers(trust_state="approved")
    results = []
    for peer in peers:
        if peer.get("disabled_at"):
            continue
        result = poll_peer(peer)
        results.append({"node_uid": peer["node_uid"], **result})
    return results
