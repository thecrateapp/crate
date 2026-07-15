# Federation key management

## Ownership and storage

- Node request keys are Ed25519 and live under `/data/federation/keys` as opaque references stored in PostgreSQL.
- The directory is owned by the API/worker runtime UID with mode `0700`; private-key files use `0600` and must not be group/world readable.
- API and signing-capable workers may mount the directory only when required. The Go readplane, frontends, projector, PostgreSQL, Redis, and media worker never mount it.
- Private key bytes, service tokens, assertions, signed URLs, and signatures are excluded from logs, audit metadata, metrics, support bundles, and Admin responses.

`CRATE_READPLANE_SERVICE_TOKEN` is a separate random service identity, not a signing key. Use at least 32 random bytes, expose it only to API/readplane, rotate it as a coordinated container restart, and never persist it in the database.

## Backup

Back up PostgreSQL and the key directory as one identity recovery set. Encrypt the key archive with an operator-controlled mechanism, store it separately from application data, record the node UUID and public key fingerprints, and test decryption. Plain archives and unverified cloud sync are not acceptable.

Example generation of the readplane token:

```bash
openssl rand -hex 32
```

Do not paste the generated value into shell history on shared hosts; prefer the deployment secret store.

## Rotation

Rotation uses pending → active → retiring states and a signed statement from the currently trusted key. Keep the previous key through the maximum offline-peer and credential lifetime. Promotion requires that the local descriptor contains both keys and controlled peers can verify the new key. Removing the old key before acknowledgements can strand offline peers.

Emergency compromise response disables affected peers/grants, revokes active tickets, creates a new key with the surviving trusted identity when possible, and reviews signed requests since the exposure window. If no trusted key survives, use an explicit administrator-mediated re-pair; never auto-trust the replacement.

## Restore drill

At least quarterly and before a federation rollout:

1. restore PostgreSQL and encrypted keys into an isolated network;
2. enforce ownership/modes before starting API;
3. derive public keys and compare node UUID, active key ID, and recorded fingerprints;
4. build the signed descriptor and verify it locally;
5. perform a signed health request against a disposable approved peer;
6. confirm readplane starts without any key mount;
7. destroy the isolated restore and record date/result without secret material.

A missing or mismatched key leaves federation degraded while local singleton service remains available. Bootstrap must never create a replacement identity over persisted federation state.
