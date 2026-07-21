---
title: Federation key management
summary: Protect node signing identity and recover it without replacing node trust accidentally.
section: federation
audience: [operator]
status: canonical
order: 220
verified: 2026-07-21
sources:
  [
    app/crate/federation/identity.py,
    app/crate/federation/bootstrap.py,
    docker-compose.yaml,
  ]
---

# Federation key management

Node signing identity and `CRATE_READPLANE_SERVICE_TOKEN` are different secrets.
The former establishes a persistent node identity; the latter authenticates the
API/readplane service boundary. Neither belongs in browser code, logs, metrics,
support bundles or peer responses.

## Storage and backup

Keep private Ed25519 material in the configured federation key store with the
least filesystem access possible. The readplane, frontends, PostgreSQL, Redis,
projector and media worker must not need private signing keys. Restrict the key
directory to the runtime identity and protect the deployment `.env` separately.

Back up PostgreSQL and encrypted key material as a single recovery set. Record
the node ID, active public-key fingerprints and restore procedure outside the
archive. A database backup without matching keys cannot prove the existing node
identity; generating a new key over persisted federation state creates a new
identity and must not be treated as transparent recovery.

## Rotation and compromise

Before automated key rotation is accepted for a network-facing deployment,
verify the release's overlap, peer-notification and acknowledgement behavior in
the harness. Do not assume replacement is safe merely because a descriptor can
advertise several keys. Preserve a retiring key for the documented request,
ticket and offline-peer window; otherwise disable/re-pair affected peers.

For suspected compromise, stop the affected federation capability, revoke or
disable grants and tickets, preserve bounded audit evidence, and follow a
controlled recovery/re-pairing process. Local singleton catalog operation should
remain available while federation signing is contained.

## Restore drill

At least before a federation rollout, restore into an isolated network, verify
node ID/key fingerprints, generate and validate the descriptor locally, perform
a signed test against a disposable peer, and confirm readplane starts without a
signing-key mount. Record the outcome without copying secret material into the
runbook.
