# ADR: federated streaming data plane

**Status:** accepted
**Date:** 2026-07-14
**Decision:** use `crate-readplane` (Go) as the preferred remote stream proxy and FastAPI as a pre-authorization fallback.

## Context

Remote playback adds a second network hop and must relay potentially large media without buffering the object in memory or starving FastAPI metadata requests. The production-readiness gate requires:

- remote p95 TTFB at or below 1.5 seconds;
- throughput overhead at or below 15% versus a signed direct fetch;
- event-loop lag below 100 ms at 25 concurrent streams;
- metadata p95 below 500 ms during the same load;
- zero request errors plus working Range and disconnect behavior.

The benchmark uses an 8 MiB reference object, 64 KiB buffers, Ed25519 request verification, and concurrency levels 1, 10, 25, and 50. Each case has one warm-up request followed by three measurement rounds in alternating direct/remote order; the gate compares median throughput and propagates errors from every round. It runs origin, control plane, and proxy on loopback so that it isolates application overhead from WAN latency without making the gate depend on a single short scheduler sample.

## Results

Reference host: Darwin arm64. The exact current result is generated at `.artifacts/benchmarks/federation-stream.json` by the command below.

| Metric at 25 concurrent streams  | FastAPI proxy |    Go readplane |      Budget |
| -------------------------------- | ------------: | --------------: | ----------: |
| Direct throughput                | 1021.61 MiB/s |    992.01 MiB/s |   reference |
| Remote throughput                |  508.33 MiB/s |    877.19 MiB/s |           — |
| Throughput overhead              |        50.24% |      **11.57%** |        ≤15% |
| Remote TTFB p95                  |     60.902 ms |   **35.300 ms** |    ≤1500 ms |
| Control-plane event-loop lag p95 |      2.866 ms |    **2.309 ms** |     <100 ms |
| Metadata p95 under stream load   |     44.811 ms |   **25.772 ms** |     ≤500 ms |
| Errors                           |             0 |           **0** |           0 |
| Range / disconnect               |   pass / pass | **pass / pass** | pass / pass |

The FastAPI proxy failed the structural throughput budget. The same workload through Go passed every gate, including 50 concurrent streams (remote TTFB p95 90.267 ms and 767.83 MiB/s).

## Decision and security boundary

Traefik routes only `GET /api/federation/remote/streams/*` to the Go readplane. FastAPI remains the control plane and the only process with access to the node's Ed25519 private key:

1. Go authenticates the local Crate user.
2. Go sends the opaque local ticket, user id, method, path, audience, and safe Range headers to the protected internal FastAPI endpoint.
3. FastAPI validates the short-lived reusable playback session, verifies user binding and peer trust, applies the existing URL policy with DNS pinning, and returns signed headers valid for at most 15 seconds. Each Range is authorized independently; the fixed session expiry is not extended.
4. Go independently validates the authorization, pinned literal IP, host/SNI binding, header allowlist, method, path, audience, and TTL before opening the upstream stream.
5. Go relays with a fixed 64 KiB buffer and checks Redis revocation between reads. The remote node remains authoritative for grants, ticket validity, quotas, and policy revision.

The readplane never mounts `/data/federation/keys`, receives a private key, follows redirects, uses ambient HTTP proxies, or forwards cookies and local credentials to a peer.

Fallback to FastAPI happens once only when the control plane is unavailable before authorization material is issued. A denial, expired/revoked session, invalid authorization, or upstream failure never falls back after the authorization decision, preventing duplicate streams and replay.

## Reproduction

```bash
make dev-federation-stream-benchmark
```

The command builds the real Go proxy package, launches an ephemeral FastAPI control plane and signed origin, executes the complete matrix, writes the JSON result, and exits non-zero if any gate fails.

This loopback result is a data-plane regression gate, not a substitute for WAN canary monitoring. Production alerting uses the federation stream TTFB and error SLOs documented in `federation-slos.md`.
