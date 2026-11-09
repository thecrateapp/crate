---
title: "Letting another Crate into the catalogue"
description: "Federation made Crate separate a track's identity from its source, its availability and the owner's permission to serve or copy it."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 18
related: [reads-from-snapshots, bringing-purchased-music-into-a-shared-library]
tags: [How to dismantle Spotify, federation, architecture, catalogue, history]
sources:
  - docs/technical/federation-overview.md
  - docs/technical/federation-protocol.md
  - docs/technical/federation-production-acceptance.md
  - app/crate/federation/global_source_resolver.py
  - app/crate/federation/authorization.py
  - app/crate/worker_handlers/federation.py
  - app/tests/test_federation_catalog_sync_resume.py
---

_Part 18. Adding remote sources to the catalogue, July 2026._

A track in Crate's local catalogue had a straightforward destination: an audio file managed by that
instance. Playback could resolve its local ID, look up the path and serve the file. Importing another
person's files, as we did with [Bandcamp purchases](/blog/bringing-purchased-music-into-a-shared-library),
still ended with music stored in our own library.

Federation changed that assumption. Another Crate could advertise an album that we did not have on
disk. Its track IDs belonged to that instance. Its operator could permit browsing without permitting
playback, or allow playback without allowing us to import a copy. Even with permission, that server
could be unavailable when someone pressed Play.

We needed the catalogue to describe that music without pretending we owned its files. The July
implementation introduced a canonical catalogue backed by local and remote sources. It also exposed
some unfinished work: a partial catalogue sync could report completion, and the first import handler
recorded provenance without transferring audio. We had to fix those behaviors
as well as getting remote albums onto a page.

## An album can have a source we do not own

An audio platform can federate around users and their activities. Funkwhale's 2.0.13 documentation,
for example, describes ActivityPub actors and library follows. Restricted libraries require signed
requests from an actor with an approved follow; accepting that follow enables access to the
library's content. That gives a concrete way to connect discovery, approval and remote audio.
[Funkwhale's federation model](https://docs.funkwhale.audio/developer/federation/index.html#audio-fetching-on-restricted-libraries).

Crate built its own protocol around instances, their catalogues and explicit capabilities. Its
federation protocol does not interoperate with ActivityPub.

We could also have copied another server's files into the local library and let the existing scanner
handle everything. That would make the catalogue simpler, but every remote album would immediately
consume local storage. It would also turn permission to discover music into permission to copy it.

Instead, the node-first design kept the local write model and added a common read model. `library_*`
continued to describe music managed on the local filesystem. `global_catalog_*` described the artists,
albums and tracks Listen could present, with separate source rows explaining where each one came from.
Every local entity participated as a local source. An approved peer could add remote sources through
catalogue synchronization.

The same model applied when no peers existed. A fresh instance still acquired a persistent node ID
and signing key; its canonical catalogue contained only local sources. Having a node identity did
not require creating a self-peer or approving another server.
[Identity bootstrap](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/federation/bootstrap.py#L23-L71),
[node-first design and local write boundary](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/docs/plans/2026-07-12-node-first-federated-catalog-implementation-plan.md#L3-L69).

### Keep the remote identity attached

The external reference needed both the node and the entity identifier supplied by that node. A
remote track ID by itself was not enough: it could collide with an ID from a different instance,
and it could not safely be passed to a local file endpoint.

When converting a synchronized item into a canonical source, we left its local identifiers empty:

```python source="app/crate/federation/global_sources.py#L552-L566" commit="a31cc88139486661816e21a9beec961a6ff5e787" "local_id"
    return {
        "entity_type": entity_type,
        "source_kind": "federated",
        "node_uid": row["node_uid"],
        "remote_entity_uid": row["remote_entity_uid"],
        "local_id": None,
        "local_entity_uid": None,
        "source_revision": row["remote_revision"],
        "source_deleted_at": _revision(row["deleted_at"]),
        "source_stale": row["deleted_at"] is not None,
        "source_payload": payload,
        "match_key": _remote_match_key(entity_type, payload),
        "match_confidence": 0.0,
        "match_method": "remote_catalog",
    }
```

Reconciliation could attach that source to a canonical entity alongside a local source for the same
music. It did not overwrite the local track's identity with the peer's identifier.

Matching used the metadata available. For tracks, matching MusicBrainz recording IDs were strong
evidence, while conflicting IDs rejected the match. Without them, the code considered ISRC and
artist, then album position, title and duration. A title-and-duration match on its own received a
weaker score. Those rules were fallbacks for incomplete metadata, not proof that all recordings with
similar names were interchangeable.
[Track matching rules](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/federation/global_matching.py#L126-L164).

The source resolver then selected for a particular use: metadata, artwork or playback. It filtered
stale and deleted sources. Remote candidates also had to belong to an approved, enabled peer, and a
peer explicitly marked unhealthy was excluded. Among candidates that advertised the requested
capability in their facet payload, local sources ranked before remote ones. Preferences and latency
helped order the remaining choices.
[Source selection](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/federation/global_source_resolver.py#L42-L174).

That selection was still based on cached information. The resolver allowed a peer whose health was
unknown, and an advertised playback facet was not a fresh authorization from the owner. Resolving a
source told the next step where to ask. The serving node still had to agree to the request.

## Browsing does not grant playback or a copy

The protocol gave each node a signed descriptor containing its identity, keys and capabilities.
The hardened pairing endpoint validated an offer and stored the peer as pending. Approval was a
separate decision. Knowing an endpoint and verifying its signature established who was asking;
neither operation granted access to the library.
[Pending pairing](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/api/federation.py#L1732-L1784).

The first authorization helper used named presets such as Discovery, Catalog and Listen. Those
presets already separated catalogue operations from streaming and imports. In the July hardening
work, we added an owner-side evaluator for persisted grants, their subject selectors, validity and
typed constraints. Presets could populate a grant, while the stored grant determined the decision.
[Initial preset evaluation](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/federation/grants.py#L117-L132).

After checking peer approval and finding active grants for the requesting subject, the evaluator
required the requested capability to be present:

```python source="app/crate/federation/authorization.py#L138-L150" commit="c8a62817118e3f1dccdc335ab47a4cfccc74e68d" "capability_denied"
    revision = max(int(grant.get("policy_revision") or 0) for grant in matching)
    permitted = [
        grant
        for grant in matching
        if capability in _json_value(grant.get("capabilities_json"), [])
    ]
    if not permitted:
        return _deny(
            "capability_denied",
            revision=revision,
            peer_uid=peer_uid,
            subject_hash=subject_hash,
        )
```

The distinctions were visible in the protocol names. `catalog.sync` permitted catalogue exchange.
Streaming used capabilities including `stream.proxy` and `stream.original`. An import required its
own request and transfer capabilities. The owner could constrain entities or delivery modes and
apply byte and concurrency limits without giving a peer unrestricted access.
[Capability contracts](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/federation/contracts.py#L24-L69),
[typed constraints and grant evaluation](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/federation/authorization.py#L14-L173).

This also changed how revocation worked. A remote stream request reevaluated the owner's current
grant and validated the ticket against its policy revision. A consumer's cached album row could not
override a disabled peer or a withdrawn permission. Already delivered bytes could not be taken back;
the enforcement point was the owner's authorization of subsequent requests.
[Owner stream authorization](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/api/federation.py#L2014-L2031),
[ticket policy check](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/api/federation.py#L2106-L2114).

## Losing the peer halfway through its catalogue

The first catalogue worker fetched manifest pages and upserted their items. If a request failed
before receiving anything, it returned an error. If it failed after receiving some items, it broke
out of the loop, saved a cursor and emitted a completion event. Reaching the configured page limit
could reach that same completion path.
[Original manifest loop](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/worker_handlers/federation.py#L81-L152).

That behavior was unsuitable for a catalogue that needed to notice deletions. Suppose we fetched
half of a peer's albums and then lost the connection. The albums absent from our response were not
necessarily absent from the peer. Treating that response as a complete inventory would let a network
failure masquerade as a catalogue change.

We added persisted checkpoints and a separate completion condition. Each page could update durable
source rows, and an interrupted run could resume. Missing or changing manifest revisions were
failures. If the worker stopped before reaching the final page, it returned before the code that
tombstoned missing items:

```python source="app/crate/worker_handlers/federation.py#L394-L405" commit="c8a62817118e3f1dccdc335ab47a4cfccc74e68d" "if not manifest_completed"
    if not manifest_completed:
        error = "peer manifest sync stopped before the final page"
        repo.update_peer(node_uid, last_error=error)
        record_catalog_sync_error(node_uid, error)
        emit_catalog_sync_failed(node_uid, error)
        return {
            "status": "failed",
            "error": error,
            "synced": total_count,
            "revision": revision,
            "pages": pages_fetched,
        }
```

Only a completed manifest could mark source rows missing from that sync session as deleted. This
did not make the full manifest one giant atomic transaction: pages were persisted incrementally.
It made the destructive inference, “the owner no longer advertises this item,” depend on completing
the scan.
[Checkpoint and completion handling](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/worker_handlers/federation.py#L376-L428).

The hardening work also added delta synchronization. Applying a delta page, marking its sources for
reconciliation and advancing the cursor shared a database transaction. If the cursor expired, the
worker requested a full sync instead of clearing the catalogue and starting from an empty table.
That reused the [transaction boundary](/blog/giving-database-writes-a-transaction-boundary) for a
specific requirement: never acknowledge remote changes that had not been stored.
[Delta application](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/db/jobs/global_catalog_reconciliation.py#L46-L180),
[expired cursor handling](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/worker_handlers/federation.py#L81-L139).

## Press Play, or ask for an import

A remote track could appear in a playlist without becoming a local file. For playback, the consumer
asked the owner for a short-lived stream ticket using a signed request and a user assertion. It then
created a separate local relay ticket. The response given to Listen contained the local relay path;
the owner's ticket stayed between the servers.
[Remote playback handoff](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/api/federation_remote.py#L601-L679).

The relay let the browser continue making requests to its own Crate while the server handled the
peer connection. A seek still needed Range handling, and the owner still enforced its grant and
quota. Catalogue availability could not promise that a later media request would succeed: the
connection, the permission or the source itself might have changed.

![A consumer projects its local library and an approved peer's catalogue into one canonical catalogue. Remote playback returns through a local relay; only an explicitly approved import writes peer audio into the consumer's local library.](/blog/letting-another-crate-into-the-catalogue/source-authority.svg)

Import was the operation that changed local storage ownership. The first handler was only a partial
implementation: it checked for an approved request, recorded provenance with `album_id=0` and
returned `completed`. It never downloaded an album. The later July worker replaced that path with
an actual transfer and publication flow.
[Initial import handler](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/crate/worker_handlers/federation.py#L155-L177).

The worker fetched a signed manifest and verified it using a known key for the peer. It retained the
manifest digest on the import request so a retry could not silently switch to a different transfer:

```python source="app/crate/worker_handlers/federation.py#L547-L555" commit="c8a62817118e3f1dccdc335ab47a4cfccc74e68d" "previous_digest != manifest_digest"
        manifest = verify_signed_import_manifest(
            envelope,
            public_key=public_key,
            max_bytes=max_bytes,
        )
        previous_digest = str(req.get("manifest_digest") or "")
        manifest_digest = str(envelope["manifest_digest"])
        if previous_digest and previous_digest != manifest_digest:
            raise ValueError("Import manifest changed during retry")
```

Before downloading, it reserved storage for the manifest's declared size. Each track went into a
request-specific staging directory through a `.part` file. The downloader checked the received size
and SHA-256 digest before replacing the staged target. A valid staged file could be reused when its
size and hash matched; a partial download was removed on failure.
[Verified file transfer](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/worker_handlers/federation.py#L669-L708).

Only after those checks did the worker call `ImportQueue`, synchronize the installed music and
record the peer and remote album as provenance. Its cleanup released the reservation and removed
the request's staging directory. The API did not gain permission to write to `/music`, and browsing
or favoriting a remote album did not trigger this workflow.
[Import and publication](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/crate/worker_handlers/federation.py#L486-L666).

The tests reflected those boundaries. Catalogue tests covered local selection, healthy remote
selection and rejection of stale remote sources. Authorization tests rejected a pending peer, a
disabled peer, revoked grants and a streaming request with only catalogue permission. Import tests
used temporary files to check atomic staged-file replacement, hash failures and cancellation during
a transfer.
[Playback selection tests](https://github.com/thecrateapp/crate/blob/a31cc88139486661816e21a9beec961a6ff5e787/app/tests/test_global_catalog_playback.py#L121-L170),
[authorization cases](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/tests/test_federation_authorization.py#L38-L71),
[import transfer tests](https://github.com/thecrateapp/crate/blob/c8a62817118e3f1dccdc335ab47a4cfccc74e68d/app/tests/test_federation_import_worker.py#L106-L173).

## Acceptance before enabling a peer

Passing source-selection, authorization and staged-transfer tests is not enough to enable an
arbitrary internet peer. The federation
acceptance policy requires evidence for each release and capability: one-node behavior, trust and
key recovery, catalogue reconciliation, interrupted playback, bounded imports and operator recovery.
The controlled one-node and two-node harnesses provide the environment for that work. Public peering
remains disabled or manually contained until the relevant production gates are satisfied.
[Production acceptance requirements](https://github.com/thecrateapp/crate/blob/52a77e47353ecef6c77be7479fa89d4525a55f67/docs/technical/federation-production-acceptance.md).
