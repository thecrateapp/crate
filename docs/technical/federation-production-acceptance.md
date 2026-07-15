# Federation production acceptance

This checklist is the release contract for the node-first federation pivot.
Every Crate installation is a node. A node with no peers is the supported
singleton topology and does not use a separate runtime mode.

## Singleton parity

- Global catalog contains every local artist, album and track once.
- Artist and album navigation uses human, source-neutral slugs.
- Follows, saved albums, likes, history and playlists survive the migration.
- Artist pages preserve bio, top tracks and probable-setlist contracts.
- Genre sound-intelligence health returns a typed response, never an internal
  error caused by missing federation configuration.
- No UI banner or API behavior depends on a federation feature gate.
- FastAPI and Go read-plane responses preserve the same public contract.

Automated coverage:

```bash
PYTHONPATH=app uv run pytest \
  app/tests/test_federation_singleton_parity.py \
  app/tests/test_no_federation_mode_flags.py \
  app/tests/test_node_first_catalog_contract.py -q
```

Live acceptance:

```bash
make federation-dev-up-singleton
python scripts/federation-dev-e2e.py singleton-parity
```

## Security

- Pairing proves possession of both node keys and requires approval on both
  nodes.
- Self-pairing, replay, clock-skew violations and incompatible versions fail
  before trust is persisted.
- Outbound URLs use HTTPS in production and reject private/reserved DNS
  results, redirects and cross-origin resource URLs.
- Every remote capability is authorized by an active grant at the serving
  node.
- Stream slots and bytes are owner-side, atomic and released after failure or
  disconnect.
- Grant downgrade or peer revocation invalidates unused tickets and terminates
  active delivery within the documented bound.
- Imports are approved, size-bounded, hash-verified and written only by a
  worker with `/music:rw`.

## Consistency and recovery

- Initial synchronization is a keyset snapshot followed by durable deltas.
- Delta cursors advance in the same transaction as applied catalog changes.
- Deletes, hides and restores propagate as source tombstones and never remove
  local library data.
- Sync and import operations resume idempotently after API, worker or Redis
  restart.
- A cursor older than retention requests a full sync explicitly.
- Full verification converges to the same read model as incremental sync.

## User-facing capabilities

- Local and remote sources render at the same human URL.
- Remote playback, explicit local import and unavailable-source states are
  visible and recoverable.
- Likes use global track identity and remain present when a peer is offline.
- Remote external scrobbling is opt-in; local play history is always recorded.
- Signed directories create candidates only and never approve peers.
- Open Subsonic keeps legacy IDs and adds global read-only entities.

## Operations

- Admin exposes pairing, peer state, grants, usage, denials, active streams,
  imports, directories, key rotation, audit and risk observations.
- Metrics and alerts have bounded cardinality and link to the operations
  runbook.
- Database and federation-key backup/restore have been exercised locally.
- The 900 artist / 4,400 album / 48,000 track profile stays within the
  documented budgets.
- The selected streaming data plane is backed by a reproducible benchmark.
- Upgrade, compatible rollback and re-upgrade pass against a pre-pivot data
  fixture without user-visible loss.

## Release gate

Production rollout remains a separate, explicitly authorized operation. Before
deploying, the local two-node canary, chaos suite, migration matrix, complete
language test suites and pre-commit checks must all be green. Any data-loss,
SSRF, signature, authorization, quota or singleton-parity failure blocks the
release.
