---
title: Federation upgrade and rollback
summary: Expand-compatible rollout and recovery rules for federated state and protocol changes.
section: federation
audience: [developer, operator]
status: canonical
order: 300
verified: 2026-07-21
sources: [scripts/deploy.sh, scripts/deploy-remote.sh, app/crate/db/migrations]
---

# Federation upgrade and rollback

Federation changes are compatibility changes across database state, descriptors,
grants, catalog rows, readplane behavior and peer expectations. Deploy them
expand-compatible: add data/fields/read paths first, prove compatibility, then
enforce or remove an older path in a later release.

## Before rollout

1. Record image tag, migration revision, descriptor/key state and peer/grant
   inventory.
2. Back up PostgreSQL, `.env` and the federation identity recovery set.
3. Run singleton and two-node acceptance for the changed capability.
4. Verify capability/version negotiation treats unknown optional fields as
   compatible and unknown major versions as denial.
5. Decide containment: disable a peer/grant, force local catalog fallback or
   suspend import/prepare work without breaking local playback.

## Rollout and rollback

Use the image-first project deploy path where applicable. It validates image
manifests and compose before remote startup, but automatic rollback is disabled
after the updated stack starts because migrations may have advanced. Do not
blindly restore an older image over newer federation schema/state.

If verification fails after migrations, contain the affected peer/capability,
collect bounded evidence and select either a forward fix or a tested
database/configuration restore. Reconcile catalog checkpoints and active
reservations after recovery; do not delete global tables to make a dashboard
look empty/healthy.

## Canary evidence

A canary needs both functional and operational proof: descriptor/grant behavior,
catalog serving modes, remote relay Range/revocation, import cleanup, readplane
health, projector lag, queue pressure and rollback drill. Keep the rollout
record with the release; it is the only defensible source for the next upgrade.
