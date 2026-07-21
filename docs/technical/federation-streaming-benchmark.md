---
title: Federated streaming and playback
summary: Opaque relay behavior, Range safety and performance evaluation for remote playback.
section: federation
audience: [developer, operator]
status: canonical
order: 260
verified: 2026-07-21
sources:
  [
    app/readplane/internal/routes,
    app/crate/federation/stream_proxy.py,
    Makefile,
  ]
---

# Federated streaming and playback

Remote media delivery is a local relay contract. The client requests a local
opaque URL; it never receives a remote origin, owner ticket, node assertion or
authorization header. The consumer readplane validates the local relay state
and forwards a minimal request to the owner. The owner remains responsible for
authoritative grant, policy revision, quota and byte accounting.

## Header and Range boundary

Only narrowly selected stream headers cross the relay boundary: Range and
related validators on request; content type, length/range, ETag, last-modified
and cache control on response. Cookies, browser authorization, hop-by-hop
headers, local filesystem paths and arbitrary upstream headers must not cross.

Test original and transcoded stream variants, initial playback, seek/Range,
reconnect, owner denial/revocation and timeout/fallback separately. A 200 for
one successful stream does not prove safe Range retry or quota behavior.

## Playback preparation

Preparation lets a consumer ask an owner to prepare an eligible variant. It is
advisory: no stream ticket, browser URL, byte reservation or media transfer is
created. Active playback wins over speculative work and operators must be able
to reduce preparation limits to zero for containment without disabling normal
stream authorization.

## Evaluation

Measure first-byte latency, steady delivery, seek success, reconnect success,
owner denial/revocation propagation, byte/quota accounting and fallback result
under a representative catalog/network shape. Include a `ResponseHeaderTimeout`
or equivalent bounded upstream wait in the tested delivery policy. Publish the
fixture, concurrency and failure injection with the result; benchmark claims
without that context are not an SLO.

Run the local acceptance path with `make federation-dev-playback-prepare-e2e`
and the broader harness from [Federation production acceptance](federation-production-acceptance.md).
