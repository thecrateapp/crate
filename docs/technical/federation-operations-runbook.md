# Federation operations runbook

This runbook assumes an authenticated owner/admin session and current images for API, workers, projector, and readplane. Never paste service tokens, assertions, private keys, signed URLs, or full peer URLs into tickets or logs.

## Baseline checks

1. Check `/api/admin/federation/health` and `/api/admin/federation/status`.
2. Confirm local identity, active key, catalog state, projector lag, Redis, and readplane `/readyz` are healthy.
3. Segment failures by peer, operation, and bounded reason code; do not use full URL or subject as a metric label.
4. Before mutation, export the relevant audit window and take a PostgreSQL backup if data repair is possible.

Local reproduction uses:

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-global-catalog-e2e
```

Always finish with `make federation-dev-down`; the command preserves volumes.

## Pairing stuck or denied

- Verify both descriptors independently and compare node UUID, active key, expiry, protocol version, and advertised API origin.
- Check pending offers/acceptances in Admin. Reject duplicated or unexpected requests; never approve from a directory notification alone.
- A self-peer, changed node UUID, incompatible protocol, unsafe URL, or failed proof of possession is terminal. Correct the descriptor/operator configuration and start a new pairing.
- After approval, start with discovery/metadata only and inspect the audit record on both nodes before adding capabilities.

## Revoke a peer or grant

- Revoke or downgrade the typed grant in Admin, then disable the peer if all access must stop.
- Confirm policy revision increased, active tickets were marked revoked, Redis revocation signals were emitted, and new requests receive denial.
- Existing Go streams check revocation between chunks; allow the bounded propagation window before declaring the incident contained.
- Preserve materialized catalog rows as unavailable/stale for user references. Do not delete canonical rows during incident response.

## Rotate a key

1. Create the new pending key locally.
2. Publish a descriptor containing active and pending keys.
3. Send the signed rotation statement to every approved peer.
4. Wait until peers acknowledge and health is green.
5. Promote the new key and retain the previous key as retiring through the overlap window.
6. Remove the retiring key only after the maximum request/assertion/ticket lifetime and offline-peer policy permit it.

If a peer was offline, keep the overlap or disable that peer. Never silently replace the local node identity.

## Missing or unreadable private key

- The API must remain degraded and refuse signing; do not bootstrap a replacement identity.
- Stop federation jobs that need signatures while leaving singleton/local reads available.
- Restore the exact encrypted key backup into `/data/federation/keys`, ownership of the Crate runtime UID, directory mode `0700`, file mode `0600`.
- Verify public key derivation matches the persisted key ID and descriptor before restarting API/worker.
- Run a signed health request against an isolated approved test peer, then resume jobs.

## Cursor expired, corrupt, or stuck sync

- Check peer health, last committed cursor, last page checksum, delta retention, and failure streak.
- A cursor-expired response requires a full snapshot. Reset only that peer's sync checkpoint through the supported Admin action; do not truncate global catalog tables.
- A crash after page persistence but before cursor commit is safe: rerun and let idempotent page application replay.
- Compare manifest counts/digest and run full verification before marking the source healthy.

## Catalog warming or reconciliation failure

Canonical reads must not return `catalog_warming`. During the first full
reconciliation, local reads remain available from `library_*`; later refreshes
and failures serve the last complete global catalog.

1. Check `/api/admin/global-catalog/status` and record `serving_mode`, the
   reconciliation state, last completed run, and last error.
2. Request `/api/catalog/search?q=high&limit=5` and inspect
   `X-Crate-Catalog-Mode`. `local-fallback`, `global-refreshing`, and
   `global-degraded` are expected serving states and must still return `200`.
3. If `local-fallback` is slow, run `make dev-catalog-search-capacity-test`.
   The target refuses databases not named `crate_test`; never point it at
   production.
4. Confirm migration `071` completed and inspect query plans for the FTS and
   trigram candidate indexes. Do not create indexes non-concurrently on a live
   library.
5. For `global-degraded`, inspect the failed reconciliation run, correct the
   bounded root cause, and enqueue one incremental or full reconciliation from
   Admin. Do not truncate canonical or legacy user-library tables.
6. Check `global_catalog_search_projection_state`. While its status is
   `warming` or `backfilling`, search deliberately uses the compatibility
   query. When `ready`, `total_documents` must match the canonical artist,
   album, and track count. A failed search projection is repaired by resuming
   the full reconciliation; never truncate the live document table first.

Escalate as an availability incident only when canonical and legacy/local
paths both fail, latency breaches the singleton SLO, or playback/detail routes
regress. A long first backfill by itself is not downtime.

## Peer outage

- Search should return local/healthy-source results with
  `federation.complete=false`; source rows remain stale/unavailable.
- Stop repeated manual syncs. Let bounded backoff and the health circuit recover the peer.
- Local sources and cached user references must remain usable. Escalate only if local singleton SLOs regress.
- After recovery, health-check the descriptor/key first, then resume delta or full sync as directed by cursor state.

## Stream incident

- Inspect active stream/ticket Admin panels, owner-side quota denials, TTFB/error metrics, and readplane health.
- Revoke the subject/grant/ticket for suspected abuse. For systemic readplane failure, route the stream prefix back to FastAPI or set `READPLANE_FEDERATION_PROXY_ENABLED=false` and restart readplane; fallback occurs only before authorization.
- Do not retry a consumed ticket or an upstream failure after headers. Resolve playback again to create a fresh ticket.
- Validate Range with a small request and confirm no client cookie/Authorization appears in peer logs.
- Run `make dev-federation-stream-benchmark` after any transport change.

## Playback preparation incident

- Check `federation.playback.prepare.requested`, result counters,
  `ready_before_play`, `fallback_original`, active `prepare_stream_variant`
  work, and interactive queue wait. These are aggregate-only metrics: never
  query or label them with a user, peer UID, entity UID, cache key, path, URL,
  ticket, or assertion.
- Inspect the bounded reservation keys
  `federation:playback-prepare:peer:{peer_node_uid}` and
  `federation:playback-prepare:global`; they are TTL-backed and must not be
  manually populated or prolonged.
- If preparation saturation, disk headroom, CPU, iowait, or queue wait affects
  interactive playback, set
  `CRATE_FEDERATION_PLAYBACK_PREPARE_MAX_PER_PEER=0` or
  `CRATE_FEDERATION_PLAYBACK_PREPARE_MAX_GLOBAL=0` on the affected owner and
  restart its API. New prepare requests fail harmlessly while normal stream tickets remain available.
- Restore the conservative defaults (four per peer, twenty global) only after
  resource-governor decisions, fallback-original ratio, and interactive queue
  wait have recovered for one alert window. Do not clear cached variants as an
  incident response.

## Quota incident or Redis restart

- The owner remains authoritative. Confirm Lua quota scripts, per-peer and per-subject keys, reservation TTL, and reconciliation metrics.
- After Redis recovery, wait for expired slot leases and run reconciliation. Do not manually inflate limits to clear stale entries.
- Revoke active tickets if Redis integrity is uncertain; clients can resolve fresh playback after recovery.

## Cache Redis or durable Redis incident

Crate uses two explicit roles. `crate-redis` is disposable cache, metrics and
best-effort pub/sub with `volatile-lru`; `crate-redis-durable` stores Dramatiq,
domain-event delivery, revocation/lease coordination and job progress with AOF
and `noeviction`. Durable Redis has an explicit memory ceiling below its
container limit: write failures and PostgreSQL outbox growth are recoverable;
an OOM-killed broker is not.

- If cache Redis is unavailable, PostgreSQL/snapshots remain authoritative.
  Expect lower hit rate and delayed SSE invalidations, but committed events and
  jobs must remain intact. Restore cache Redis without copying the durable AOF.
- If durable Redis is unavailable, mutations still commit their transactional
  outbox rows. Stop queue-producing maintenance if backlog growth threatens
  PostgreSQL, restore the AOF service, then verify outbox lag drains to zero.
- Page when `domain_event_outbox.dead_letter > 0`, the oldest pending event is
  over five minutes, or durable Redis reports an eviction/write error. Do not
  switch durable Redis to an eviction policy to clear pressure.
- Back up the `crate_redis_durable` volume together with PostgreSQL. Cache Redis
  does not require backup.

Upgrade order: deploy both Redis services first while explicitly pointing
`REDIS_CACHE_URL` and `REDIS_DURABLE_URL` at the previous shared Redis. Drain or
pause Dramatiq producers and verify DB 1 has no pending queues before switching
`REDIS_DURABLE_URL` to `crate-redis-durable`; Compose does not copy broker keys
between services. Apply migrations next, deploy API/workers/projector, wait for
outbox and search backfills, and enable readplane routing last. For rollback,
point both role URLs at the previous shared Redis, restart all runtimes, and
verify broker/outbox queues before removing either service. Never merge AOF
files by hand.

Failure drill: stop cache Redis and verify home/search serve stale snapshots;
restart it, then stop durable Redis, commit a harmless mutation, verify an
outbox row remains pending, restart durable Redis and confirm relay delivery.

## Signature, replay, or abuse incident

- Identify the peer and bounded reason code from metrics/audit without copying assertions, signatures, URLs, nonces, subject identifiers, or key material into tickets.
- Temporarily block the offending subject or revoke the narrowest affected grant. Disable the peer only when containment cannot be scoped safely.
- Check node clocks, nonce/replay storage, the advertised active key, descriptor expiry, URL policy denials, and recent key rotations before classifying the traffic as hostile.
- A high invalid-signature rate alone does not prove private-key compromise. Rotate keys only after validating the incident; if compromise is confirmed, revoke the affected peer/key trust, retain audit evidence, and follow the overlap/acknowledgement procedure for every unaffected peer.
- Close the incident only after new signed requests pass, replayed requests fail, temporary risk actions have an expiry, and no capability or quota was broadened during recovery.

## Read plane outage

- The production Traefik stream router uses the health-checked
  `crate-readplane-stream@file` failover service.
- While Go is unavailable, unused tickets are sent to the FastAPI stream proxy;
  once `/readyz` recovers, new requests return to Go.
- Validate both paths with the `readplane-restart` chaos scenario. Never retry a
  ticket after either proxy has consumed it.
- Inspect `/readyz` for PostgreSQL pool saturation, fallback success ratio and
  auth-cache outcomes. Route hot reads back to FastAPI before widening timeout
  or connection limits; an open fallback circuit is protection, not the root
  incident.
- Cache Redis/SSE failure appears as `details.degraded=true` while `/readyz`
  remains healthy for PostgreSQL-backed JSON reads. PostgreSQL or schema
  failures remain hard readiness failures.

## Stuck or failed import

- Inspect request state, approval, reservation bytes, staging path, worker task, manifest digest, and per-file hash result.
- Retry only resumable download/worker stages. A changed manifest, path escape, size overflow, or digest mismatch is terminal and requires a new request.
- Run cleanup for expired/failed staging and verify peer/global reservations return to zero. Never copy staged files into `/music` from API or shell as a workaround.
- For low disk, stop new imports, restore headroom, reconcile reservations, then resume the same request if its manifest is unchanged.

## Directory expired or compromised

- Disable that subscription and refresh no further candidates.
- Existing approved peers do not lose trust automatically; review descriptor/key/API URL diffs individually.
- Reject all unexpected candidates, rotate the directory verification key only through configured trust distribution, and audit every pairing created since the last valid release.
- A directory never authorizes a peer, so compromise alone must not grant catalog or stream access.

## Recovery acceptance

An incident is closed only when the operation is complete, resumable with a durable checkpoint, or terminally failed with visible reason; reservations/slots are reconciled; audit and user-visible state agree; local singleton reads meet baseline; and no permission was broadened to restore service.
