---
title: "Bringing purchased music into a shared library"
description: "Bandcamp imports gave Crate a way to track who contributed an album, reuse its existing importer, and decide what withdrawal should remove."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 13
related: [when-retries-repeat-a-download, giving-database-writes-a-transaction-boundary]
tags: [How to dismantle Spotify, acquisition, Bandcamp, storage, history]
sources:
  - docs/technical/05-enrichment-acquisition-and-integrations.md
  - app/crate/bandcamp/collection_sync.py
  - app/crate/bandcamp/downloads.py
  - app/crate/worker_handlers/bandcamp.py
  - app/crate/worker_handlers/contributions.py
  - app/crate/db/repositories/library_contributions.py
  - app/tests/test_bandcamp_integration.py
---

_Part 13. Importing Bandcamp purchases and keeping track of their contributors, May 2026._

If someone withdrew an album they had brought into the library, should Crate delete the files? And
what if another person had contributed the same album? In May 2026 the library had no record that
could answer either question. The ZIP import worked: the upload worker unpacked the archive, found
the albums, passed them to the library importer and used the uploader's ID to save the albums and
like their tracks in the uploader's personal library. Nothing linked a person, a purchase and the
album they had contributed.

The Bandcamp integration made us answer those questions. We connected purchases to the existing
import pipeline and added a contribution record beside the catalogue. Importing the files and
recording who supplied them became parts of the same workflow. Withdrawal could then check whether
any active contributions remained before asking a worker to delete the album.

## A purchase reaches the collection, then the import guard

There was a usable manual route: download a purchase from Bandcamp and upload the archive to Crate.
Bandcamp describes that workflow in its download guide: get a purchase from the collection or
receipt, unpack the ZIP and play the files in another app. Its fan app also offers streaming. Crate
needed to connect those purchases to the library it already knew how to manage.
[Bandcamp's download workflow](https://get.bandcamp.help/en/articles/15263356-can-i-download-files-directly-to-my-device-and-listen-to-my-collection-with-another-app).

We already had storage rules, catalogue synchronization and playback for imported music. A separate
Bandcamp playback implementation would have left us with another set of tracks to handle in queues
and album pages. Downloading purchases into the shared library let those tracks use the same path as
music imported from disk.

The useful new work was before and after that importer. Before it, Crate needed to connect a user's
account, discover downloadable purchases and avoid importing albums already present. After it, we
needed to retain the source and the contributing user, even though the album itself belonged to the
shared catalogue.

The [existing upload worker](https://github.com/thecrateapp/crate/blob/e6445fc83be77b6ee273f1d4ee4c58a80ea21e58/app/crate/worker_handlers/acquisition.py#L1724-L1876)
had no Bandcamp-specific responsibility. We kept that division when adding the integration: Bandcamp
would supply an archive and its provenance; the upload pipeline would handle the music inside it.

### A collection entry is not an import

We kept the external collection separate from the local catalogue. The same Bandcamp album could
appear in several users' accounts, and being on a wishlist said nothing about whether a user could
download it. Even an owned item needed an available download before we could import its audio.

The integration used four kinds of record:

| Record | What it represented |
| --- | --- |
| `bandcamp_items` | The external artist, album or track, with its Bandcamp URL and metadata. |
| `user_bandcamp_items` | One user's relationship to an item: collection, wishlist or following, plus ownership and download availability. |
| `bandcamp_imports` | An attempt to bring a purchase into Crate, with a requested format, task ID and import status. |
| `library_contributions` | A user's contribution to a local album, with its source and withdrawal state. |

These records answered different questions. A collection sync could succeed without importing any
music. An import could be queued without having produced a playable album. A purchase could remain
in someone's Bandcamp collection after that person withdrew its contribution from Crate.

The account connection stored a reference to encrypted session material. Workers loaded the session
when they needed to contact Bandcamp; the normal task parameters carried user, connection and item
IDs. The initial implementation accepted session material from native connectors and also offered a
manual cookie connection. Its server-side credential bridge was disabled by default.
[Connection endpoints](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/api/bandcamp.py#L99-L202),
[encrypted secret storage](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/credentials.py#L54-L86),
[bridge flag](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/credential_broker.py#L33-L35).

For the built-in web adapter, download availability came from the collection response's redownload
links. The adapter kept a lookup key in the normalized item and removed the download URLs from its
stored raw payload. It could look up a fresh URL when an import actually ran.
[Collection normalization](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/web.py#L308-L343),
[URL lookup](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/web.py#L174-L201).

The sync worker fetched the external collection before opening a database transaction. Inside that
transaction, it upserted items and their user relationships, then marked relationships missing from
the fetched result as removed. Import candidates had to meet an explicit condition:

```python source="app/crate/worker_handlers/bandcamp.py#L330-L336" commit="4c2831780a027ac90e54bbe97d9ade0e0dfe9da2" "synced.downloadable"
                if (
                    auto_import_purchases
                    and synced.relation_type == "collection"
                    and synced.owned
                    and synced.downloadable
                ):
                    import_candidates.append(local_item_id)
```

The worker queued those imports after leaving the transaction. Auto-import was enabled by default
for the sync task; callers could disable it through its parameters. A wishlist item never reached
this branch just because it matched an album name.
[Sync and dispatch](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/bandcamp.py#L265-L375).

Marking an external relationship as removed did not delete a local album. That distinction kept a
collection refresh from becoming an implicit filesystem cleanup. It also mattered because collection
fetching was bounded: the web adapter had a page limit, and it treated the items it returned as the
sync result. The local library did not disappear merely because a purchase was absent from that result.

### Check the shared library before downloading again

Two people can own the same album. Downloading it once for each account would be an expensive way to
discover that the shared library already had it.

Before queuing an automatic import, Crate looked for an existing local album and for an active or
completed Bandcamp import across users. The import guard matched either the same Bandcamp-item row
or the same artist and album title, compared without case. A worker repeated the check when it began,
excluding its own import row. If another import or an existing album satisfied the check, it marked
the attempt as skipped and returned without downloading.
[Shared import guard](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/db/repositories/bandcamp.py#L762-L818),
[worker check](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/bandcamp.py#L455-L483).

This was a deliberately simple duplicate rule. An artist name and album title cannot distinguish
every edition or mastering. The checks also ran as separate reads; they were not a database lock
covering the entire download and import. They avoided work when another import was already visible,
without establishing an exactly-once import guarantee under concurrent starts.

There was a product consequence too: skipping a duplicate did not create a contribution for the
second buyer. Crate knew that both users owned the Bandcamp item, but it attributed the local import
to the person who supplied it. Owning a purchase and contributing an album remained distinct facts.

A sync test persisted an owned, downloadable item and checked that it queued an import. Another
seeded an import belonging to a second user and checked that sync queued no duplicate. These tests
covered orchestration and database state without contacting a live Bandcamp account.
[Sync tests](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/tests/test_bandcamp_integration.py#L474-L761).

## The archive joins the ordinary upload pipeline

Each import got a staging directory under `bandcamp-imports/<import_id>`. The downloader wrote its
archive into the `raw` subdirectory. FLAC was the default requested format; the API also accepted
ALAC, MP3 V0, MP3 320 and AAC. The web adapter requested that format's download URL and raised an error
if it was unavailable.

The downloader could use the built-in web adapter or an operator-configured command. Both returned
archive paths to the worker. That kept the external download mechanism outside the code responsible
for placing albums in the library.
[Download adapters](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/downloads.py#L29-L82),
[format resolution](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/bandcamp/web.py#L393-L421).

Once the archive arrived, the handoff was small:

```python source="app/crate/worker_handlers/bandcamp.py#L513-L525" commit="4c2831780a027ac90e54bbe97d9ade0e0dfe9da2" "source_ref"
        from crate.worker_handlers.acquisition import _handle_library_upload

        update_bandcamp_import_status(import_id, status="importing")
        upload_result = _handle_library_upload(
            task_id,
            {
                "staging_dir": str(staging_dir),
                "uploader_user_id": user_id,
                "source": "bandcamp",
                "source_ref": f"bandcamp:{owned_item['id']}",
            },
            config,
        )
```

This called the upload handler inside the running worker. It did not start a second download or send
the archive through an HTTP upload endpoint. The handler unpacked ZIPs, grouped supported audio into
albums and passed album directories to `ImportQueue`. It then synchronized installed albums into the
catalogue and ran the upload follow-up work.
[Upload pipeline](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/acquisition.py#L2105-L2310).

The source fields survived that handoff. After importing, the worker looked up the resulting album
and tracks and recorded their identifiers together with the submitting user:

```python source="app/crate/worker_handlers/acquisition.py#L364-L379" commit="4c2831780a027ac90e54bbe97d9ade0e0dfe9da2" "record_album_contribution"
        contribution = record_album_contribution(
            user_id=int(user_id),
            source=source,
            source_ref=f"{source_ref}:{album_row['id']}",
            album_id=int(album_row["id"]),
            album_entity_uid=album_row.get("entity_uid"),
            artist_name=artist,
            album_name=album,
            track_entity_uids=track_entity_uids,
            metadata={
                "task_source_ref": source_ref,
                "source_path": item.get("source_path"),
                "dest": item.get("dest"),
                "status": item.get("status"),
            },
        )
```

For a Bandcamp import, the resulting source reference had the form
`bandcamp:<local_bandcamp_item_id>:<local_album_id>`. The first number referred to Crate's cached
Bandcamp-item row. The reference contained neither session credentials nor a temporary download URL.

The contribution table enforced uniqueness on `(user_id, source, source_ref)`. Recording the same
contribution again updated that row, including its album and track identifiers, rather than creating
another attribution entry. The upsert also set its status back to active. Regular uploads used the
same table with an upload source and their task reference.
[Contribution schema](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/db/migrations/versions/031_library_contributions.py#L18-L44),
[contribution upsert](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/db/repositories/library_contributions.py#L20-L95).

![A Bandcamp purchase passes through sync, staging and the shared importer. Two active contributions can point to one album; withdrawing one keeps the album while the other remains active.](/blog/bringing-purchased-music-into-a-shared-library/contribution-lifecycle.svg)

The import worker test replaced both the downloader and the upload handler, then checked the
completed import status. It verified the handoff and state transitions without transferring a real
Bandcamp purchase.
[import worker test](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/tests/test_bandcamp_integration.py#L897-L984).

Installing files, synchronizing the catalogue and recording contributions happened in sequence.
A database transaction could not make those filesystem and catalogue changes atomic.

## Withdrawing a contribution from a shared album

Withdrawal started with a user-scoped lookup. The API checked that the requested contribution
belonged to the authenticated user and was active, then queued `library_withdraw_contribution`.
The worker repeated the lookup with that user ID before changing anything.

It first marked the contribution withdrawn. For a Bandcamp source, it also marked that user's
matching import records withdrawn. Only then did it decide whether to delete the album:

```python source="app/crate/worker_handlers/contributions.py#L35-L58" commit="4c2831780a027ac90e54bbe97d9ade0e0dfe9da2" "remaining > 0"
    album_id = contribution.get("album_id")
    if not album_id:
        return {"deleted": False, "reason": "missing_album_id"}

    remaining = count_active_album_contributors(
        int(album_id),
        exclude_user_id=exclude_user_id,
    )
    if remaining > 0:
        return {"deleted": False, "reason": "shared_album"}

    artist = str(contribution.get("artist_name") or "").strip()
    album = str(contribution.get("album_name") or "").strip()
    if not artist or not album:
        return {"deleted": False, "reason": "missing_album_identity"}

    from crate.worker_handlers.management import _handle_delete_album

    result = _handle_delete_album(
        task_id,
        {"artist": artist, "album": album, "mode": "full"},
        config,
    )
    return {"deleted": True, "result": result}
```

The count included active contributions from every source. If one person withdrew a Bandcamp
contribution while an upload contribution still pointed to the album, the helper returned
`shared_album`. It never reached the delete handler. The same applied if that user had another
active contribution of their own.

With no active contributions left, the helper delegated to the existing album deletion worker in
`full` mode. That removed the directory, removed the catalogue entry and refreshed the artist's
stored totals. The API still did not write to the music filesystem.
[Withdrawal sequence](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/contributions.py#L77-L138),
[album deletion](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/management.py#L632-L679).

Deleting a user needed a related path. The API captured their active contributions before deleting
the account, then handed that list to a cleanup task. The worker checked each album once and counted
contributions excluding the deleted user. This let it make the decision even after the user's rows
had been removed by the database's cascade.
[Account cleanup](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/api/auth.py#L2395-L2407),
[cleanup worker](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/worker_handlers/contributions.py#L141-L203).

We also exposed an export action for an active contribution. It resolved the linked album and used
Crate's album download endpoint, so the contributor could take a portable copy before withdrawing.
Disconnecting Bandcamp was a separate action: it revoked the connection record, without invoking
contribution withdrawal or album deletion.
[Export and withdrawal endpoints](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/api/bandcamp.py#L340-L383),
[disconnect](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/crate/api/bandcamp.py#L220-L229).

The withdrawal test checked that both the contribution and the corresponding import became
withdrawn. It substituted the deletion helper, so it did not test real file removal or the
shared-album branch. The guard above explains the sequential behavior; that test alone would not
justify claiming safe deletion under every concurrent import or withdrawal.
[Withdrawal test](https://github.com/thecrateapp/crate/blob/4c2831780a027ac90e54bbe97d9ade0e0dfe9da2/app/tests/test_bandcamp_integration.py#L1083-L1165).

Withdrawal also committed its status change before attempting filesystem deletion. If deletion
failed, rerunning the withdrawal would see an already withdrawn contribution and stop. The
remaining album needed separate cleanup; marking a contribution withdrawn did not prove that its
files had gone.

Withdrawal did not create a permanent “never import this purchase again” rule either. A later
auto-importing sync could consider the purchase again once the album was gone, because withdrawn
imports were outside the active/completed duplicate guard. A durable exclusion preference would need
its own state, separate from the history of a particular contribution.
