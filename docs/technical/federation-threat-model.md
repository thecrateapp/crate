---
title: Federation threat model
summary: Security invariants and release checks for node identity, transport, grants and media relay.
section: federation
audience: [developer, operator]
status: canonical
order: 270
verified: 2026-07-21
sources: [app/crate/federation, app/crate/api/federation.py, app/readplane]
---

# Federation threat model

Federation crosses trust, user-data and media-delivery boundaries. Every new
capability must preserve these invariants:

| Threat                             | Required invariant                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Forged or replayed node request    | signed descriptor/request, key lifecycle, bounded freshness and nonce/replay validation                    |
| SSRF or origin swap                | centralized HTTPS/DNS/address/redirect/Host/SNI policy for every peer-controlled URL                       |
| Accidental trust                   | discovery creates candidates only; explicit operator approval and typed grants authorize access            |
| Subject correlation                | use scoped pseudonymous assertions; do not forward local user IDs or emails                                |
| Grant downgrade bypass             | owner evaluates current grant/policy revision and active relay/import work reconciles revocation           |
| Ticket/URL leak                    | client receives opaque local URL only; tickets, assertions and upstream URL remain server-side             |
| File escape or resource exhaustion | signed bounded manifest, path/file/hash validation, atomic quota/disk reservations and worker-only staging |
| Audit/metric secret leak           | bounded reason codes; no keys, tokens, full peer URL, assertion or PII in telemetry                        |

## Review method

For a federation change, trace untrusted input from descriptor/directory/peer
request through URL validation, signature verification, grant evaluation,
storage, relay/import execution and telemetry. Tests must cover a denied path
as well as the happy path. A private-network test exception is confined to the
federation harness and must never be default production behavior.

## Known acceptance boundary

Do not phrase an intended invariant as a delivered guarantee. Internet-facing
peering requires current evidence for public pairing proof, key lifecycle,
transport policy, authoritative quota/revocation, import cleanup and two-node
E2E coverage. Until then, use the controlled harness and preserve the
singleton-safe fallback.

See [Federation production acceptance](federation-production-acceptance.md) for
the complete release gate and [Operations](federation-operations-runbook.md)
for containment.
