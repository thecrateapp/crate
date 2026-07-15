# Federation threat model

## Scope

This model covers node discovery, pairing, signed control-plane requests,
catalog synchronization, remote artwork and streaming, imports, directory
subscriptions and the local user assertions sent to a peer. It assumes peers,
directories, DNS answers and all remote payloads are untrusted until validated.

## Assets

- Stable node identity and Ed25519 private keys.
- Peer trust state, grants, constraints and audit history.
- Local users, subject assertions, likes and play history.
- Local catalog metadata, filesystem and available disk capacity.
- Stream tickets, quota counters and imported media.
- Global read models, taxonomy release and synchronization cursors.

## Trust boundaries

1. Public client to Crate API or read plane.
2. Admin session to federation control plane.
3. Local API to Redis/PostgreSQL and worker queues.
4. Local node to a paired remote node over HTTPS.
5. Worker staging area to `/music`.
6. Directory or descriptor content to the local pairing candidate store.
7. FastAPI control plane to the optional Go streaming data plane.

The API mounts `/music` read-only. Only workers with `/music:rw` may create,
move or remove media.

## Attacker profiles

- An unauthenticated Internet client probing public federation endpoints.
- A malicious or compromised paired peer.
- A malicious directory publisher.
- A user authenticated locally but not authorized for a remote capability.
- An attacker controlling DNS, redirects or resource URLs returned by a peer.
- An operator or deployment error that loses or replaces key material.

## Protocol invariants

- Supported protocol version is negotiated before a peer is persisted.
- A node cannot pair with its own `node_uid`.
- Pairing requires a fresh bilateral challenge, proof of both private keys and
  explicit administrative approval at each node.
- Every signed request binds method, path/query, host, content type, node ID,
  key ID, timestamp, nonce and body digest.
- Signature clock skew is at most 60 seconds and every accepted nonce is stored
  atomically for longer than that window.
- A descriptor advertises supported capabilities; it never grants them.
- The serving node evaluates the active grant and its revision for every
  resource operation.
- Resource URLs returned by a peer are same-origin unless an origin was
  separately approved.
- A catalog tombstone removes a remote source only. It cannot delete local
  media, local catalog rows or private user references.

## Threats and mitigations

| Threat                      | Mitigation                                                      | Stable denial            |
| --------------------------- | --------------------------------------------------------------- | ------------------------ |
| Self-pairing                | Compare descriptor UID with local UID before persistence        | `self_peer`              |
| Signature replay            | Redis `SET NX` nonce store, bounded timestamp                   | `replay`                 |
| Clock-window abuse          | 60-second validation and clock health alert                     | `clock_skew`             |
| Unknown/retired key         | Key ID lookup with status and validity interval                 | `unknown_key`            |
| Descriptor tampering        | Canonical descriptor signature and reviewed fingerprint         | `invalid_descriptor`     |
| Protocol downgrade          | Explicit version/profile negotiation                            | `incompatible_version`   |
| Capability escalation       | Owner-side typed authorization on every request                 | `grant_denied`           |
| SSRF/DNS rebinding          | HTTPS URL policy, public-IP resolution and pinned connection    | `unsafe_url`             |
| Redirect escape             | Redirects disabled; relative same-origin resolution only        | `redirect_disallowed`    |
| Ticket use after revoke     | Ticket binds grant revision; active stream observes revocation  | `stream_revoked`         |
| Cursor tampering            | Versioned authenticated cursor scoped to peer/grant             | `invalid_cursor`         |
| Quota race                  | Atomic Redis scripts for slot/byte reserve and reconciliation   | quota denial code        |
| Disk exhaustion             | Signed manifest, byte/free-space reservation and hard chunk cap | import denial code       |
| Path traversal              | Relative normalized staging paths and worker-only final move    | import denial code       |
| Directory auto-trust        | Directory creates pending candidates only                       | pairing remains pending  |
| Silent identity replacement | Missing private key degrades health; never auto-regenerate      | operator action required |

## Key lifecycle

Private keys are stored under `/data/federation/keys` with owner-only
permissions and are never placed in PostgreSQL, logs, frontend responses or the
Go read plane. Rotation publishes old and new public keys during an overlap,
signs the transition with the old key, activates at a declared time and retires
the old key only after the grace period. Emergency revocation is immediate and
audited.

## Privacy

Outbound user assertions contain a peer-scoped pseudonymous subject and the
minimum purpose/capability set. Likes, follows, playlists and history stay on
the user's home node. External scrobbling of remote playback is disabled by
default and requires an explicit user setting.

## Abuse handling

Invalid signatures, replays, rate-limit denials, quota denials, import
verification failures and abnormal stream termination feed bounded,
deterministic observations. Automated actions are temporary throttles with an
expiry. Permanent peer blocking remains manual.

## Residual risks

- A trusted peer can return poor or misleading metadata within its granted
  scope; provenance and source selection make this visible.
- Remote availability and latency remain outside the local node's control;
  callers receive partial/stale states rather than fabricated completeness.
- A compromised local host can access local keys; host hardening and encrypted
  backups remain operational responsibilities.
- A novel abuse pattern may not affect the initial deterministic score; hard
  rate, quota and grant boundaries remain authoritative.

Any confirmed signature bypass, SSRF, grant bypass, quota race, write from the
API, silent key replacement or user-data loss blocks release.
