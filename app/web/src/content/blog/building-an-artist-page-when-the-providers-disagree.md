---
title: "Building an artist page when the providers disagree"
description: "Crate combines six enrichment sources. We had to separate missing data from empty values, overlap provider calls and preserve the fields someone had corrected."
date: 2026-11-10
tags: [enrichment, metadata, Python, concurrency, caching]
visuals: [enrichment]
related: [crate-started-as-a-librarian, filesystem-to-indexed-catalogue, taking-artwork-processing-out-of-http-requests]
sources:
  - app/crate/enrichment.py
  - app/crate/db/repositories/library_enrichment_writes.py
  - app/crate/db/cache_store.py
  - app/crate/db/cache_runtime.py
  - app/crate/provider_rate_limits.py
  - app/crate/musicbrainz_ext.py
  - app/crate/api/enrichment.py
  - app/tests/test_enrichment.py
---

A refresh could leave an artist with less information than it had before. If Last.fm failed while another
provider succeeded, our early database writer still updated the whole artist row. A missing biography became
`NULL`. Missing tags became an empty list. We had turned a failed request into an instruction to erase data.

The mistake was in how we saved the result. Each provider call already had exception handling, so the job
could continue after a failure. But continuing only helped if the final write understood what a missing
response meant. We changed the writer to update fields for which we actually had values.
[The partial-update fix](https://github.com/thecrateapp/crate/commit/f00ac518f99624b30b43aa445c1d82b0b4613e01).

That was one of several problems hidden inside “enrich this artist.” The job had to find the right artist,
combine sources that described different things, avoid repeating expensive calls, and leave manual
corrections alone. Adding more providers increased the amount of useful information we could collect. It
also gave us more ways to produce a plausible-looking, incorrect page.

## A page needs more than a name and some albums

Our local catalogue knows which albums and tracks belong to an artist. It cannot derive a biography, band
membership or links to external catalogues from those files. Those details have to come from somewhere else.

Crate's early enrichment paths did different amounts of work. The bulk job fetched Last.fm data and a photo;
the single-artist path used a broader group of providers. We brought them together in `enrich_artist` and
saved selected fields in `library_artists`. The API could then reconstruct enrichment data after its combined
cache entry expired. Discogs profiles and members later gained their own persistent columns as well.
[Unifying the entry points and persistence](https://github.com/thecrateapp/crate/commit/1b6c1a50a733e27ebf71cf4a3e05cffb627a6280).

Using several sources is common in media servers. Jellyfin, for example, accepts metadata from remote
providers and local NFO files, with further providers available as plugins. That gives a server more ways to
fill a record, but the application still needs rules for combining the answers.
[Jellyfin metadata sources](https://jellyfin.org/docs/general/server/metadata/).

The providers do not all make the same kind of claim. MusicBrainz assigns persistent identifiers to entities,
including artists, and uses those identifiers to distinguish artists with the same name. Last.fm's top tags
are ordered by popularity. A catalogue identity and a popular label are useful for different parts of an
artist page. Treating both as interchangeable pieces of “metadata” hides that distinction.
[MusicBrainz identifiers](https://musicbrainz.org/doc/MusicBrainz_Identifier),
[Last.fm top tags](https://www.last.fm/api/show/artist.getTopTags).

The background artist job currently collects these source bundles:

| Source | What Crate uses from the bundle | Source-cache TTL |
| --- | --- | --- |
| Last.fm | Biography, tags, similar artists and listening counts | 7 days |
| Spotify | Artist ID, popularity, followers, genres, top tracks and related artists | 3 days |
| MusicBrainz | Artist ID, location, dates, type, members and external links | 30 days |
| Setlist.fm | A probable setlist | 1 day |
| Fanart.tv | Artwork candidates | 30 days |
| Discogs, when configured | Artist ID, a separate profile, members and a link | 30 days |

Not every item in that table becomes a column on the artist. Setlist and Fanart results stay in the combined
enrichment payload; the artist writer receives a smaller set of fields. The TTLs describe this layer's cache
policy. They are not a promise about when a provider last changed the underlying information.

The figure below refreshes a fictional artist eight days after the last run. MusicBrainz, Fanart.tv
and Discogs are still cached. Last.fm, Spotify and Setlist.fm are fetched together in the pool of
three, and Last.fm fails. Someone has already corrected the artist's country by hand, which locks
that field. The lanes show when each response arrives and when the artist row is written. The record
shows what each source proposed and what the writer kept. Payloads and timings are made up; the
cache lifetimes, pool size and write rules come from the code.

<div data-blog-visual="enrichment"></div>

## Check each source before scheduling its work

An artist is not uniformly stale. A probable setlist may need another look while a MusicBrainz response is
still reusable. We gave each source a cache key under
`enrichment:source:<provider>:<lowercase artist name>` and its own lifetime.

The collector separates cache hits from missing calls before it starts the network work:

```python source="app/crate/enrichment.py#L253-L266" commit="224d3378d52d2047eb522645166efe5b7e1c0b5d" "fetchers[source] = fetcher"
    payloads: dict[str, Any] = {}
    fetchers: dict[str, Callable[[], Any]] = {}
    for source, fetcher in available_fetchers.items():
        cached = None if force else _get_cached_source_payload(source, name)
        if cached is not None:
            payloads[source] = cached
        else:
            fetchers[source] = fetcher

    fetched = _run_enrichment_fetchers(name, fetchers, max_workers=max_workers)
    for source, payload in fetched.items():
        _set_cached_source_payload(source, name, payload)
    payloads.update(fetched)
    return payloads
```

A cached Last.fm response occupies no fetch slot. If Spotify is missing, Spotify can run without forcing
Last.fm to run again. After the missing calls finish, the collector caches their usable payloads and returns
them alongside the hits.

There is also a coarser guard before this collector: by default, an artist enriched within the previous
24 hours is skipped. That avoids starting the whole job repeatedly. The per-source caches become useful
when the job is eligible to run again, because their lifetimes are often longer than that guard.
[Artist refresh guard](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L329-L370).

We retained compatibility with the older combined cache. If a dedicated source entry is missing, the
collector can recover that source from `enrichment:<artist>` and populate the new key. This preserves usable
data during the transition, but it also starts a new lifetime for the promoted entry. The combined cache
can itself be rewritten by readers. A cache hit therefore does not give us a reliable timestamp for the
original remote fetch. We would need to carry that timestamp with the payload to make a stronger freshness
claim.
[Source-cache promotion](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L99-L120).

Forcing enrichment bypasses the recent-artist guard and this source-cache lookup, and clears selected cache
keys. Individual provider adapters also have caches. “Force” at this layer does not guarantee that every
adapter makes a new HTTP request.

## Overlap the waits, keep the merge in one place

The serial routine fetched providers in sequence. It also slept for 300 milliseconds at five points
between or after those calls. A slow provider held up every source behind it, even when the next call went
to a different service. We separated fetching from assembly and ran the independent fetchers in a bounded
thread pool.
[Replacing the serial routine](https://github.com/thecrateapp/crate/commit/cc7a4999ce99c86afc3c551fd9a91263cd2f4429).

The default parallelism is three, configurable from one to six. The process reuses executors by pool size,
so it does not create a new set of threads for every artist. This bounds that pool's work; it is not a
three-request limit across every Crate worker process.

Each completed future supplies a payload keyed by source. The collecting thread puts those results in a
dictionary. Only after the batch has finished does `enrich_artist` assemble the fields to save. A fast
Spotify response cannot overwrite a Last.fm result merely by arriving first, and a slow MusicBrainz response
does not get the last word on every field merely by arriving last.
[Fetcher execution and collection](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L148-L184).

Waiting for the batch also means the artist record does not receive a partial update as each future
finishes. The job still waits for its remaining calls before assembling the result. That is why the figure
shows responses arriving in the pool lanes while the job lane holds the write until assembly.

Moving calls to threads exposed shared code beneath the fetchers. Provider adapters use the process's
in-memory cache, whose eviction and prefix-deletion operations iterate over shared dictionaries. The
parallelisation change added a reentrant lock around that cache's operations. Keeping the artist assembly
in one thread would not, on its own, have protected the caches those threads entered.
[Cache locking](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/db/cache_runtime.py#L41-L91).

We also replaced the routine's fixed pauses with provider slots. Before a fetcher runs, it reserves a slot
for that provider. Redis coordinates reservations across processes; if Redis is unavailable, the helper
uses a process-local schedule. The fallback loses cross-process coordination. And a source bundle can make
several HTTP calls, so a slot around the fetcher is not a complete account of every request inside it.
[Provider scheduling](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/provider_rate_limits.py#L16-L27),
[Reservation and fallback](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/provider_rate_limits.py#L50-L89).

## Decide what each field means

Last.fm supplies the main biography. Discogs keeps a separate profile, capped at 2,000 characters, and
separate member data. MusicBrainz supplies identity and location fields. Keeping those roles explicit
avoids choosing a biography according to whichever request
finished most recently.

Tags need a different rule. We start with Last.fm's tags, append Spotify's genres and remove exact
duplicates while retaining order. Related artists have another rule: Spotify fills the artist's similarity
list only when the assembled result has no Last.fm list.

```python source="app/crate/enrichment.py#L407-L416" commit="224d3378d52d2047eb522645166efe5b7e1c0b5d" "dict.fromkeys" "if not persist_data.get"
        spotify_genres = spotify_artist.get("genres", [])
        if spotify_genres:
            existing_tags = persist_data.get("tags", [])
            persist_data["tags"] = list(dict.fromkeys(existing_tags + spotify_genres))

        related_artists = spotify_payload.get("related_artists", [])
        if not persist_data.get("similar") and related_artists:
            persist_data["similar"] = [
                {"name": artist["name"]} for artist in related_artists[:10]
            ]
```

This merge does not reconcile genre synonyms. Different spellings can survive as different labels. Their
order matters later, when the genre index assigns decreasing weights. The separate similarity table is
also narrower than the artist JSON: this pipeline writes Last.fm's similarity list to that table. The
Spotify fallback above does not populate it.

External links have explicit precedence too. MusicBrainz contributes its relationship URLs, then the
Last.fm and Spotify URLs already collected replace matching keys. Discogs can add its own link afterward.
We preserve a provider's direct artist URL over a conflicting relationship URL for that provider.
[URL assembly](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L418-L456).

We still depend on each adapter to match the right band. The MusicBrainz adapter, for example, searches by
name and accepts the first of up to five results whose name similarity reaches its threshold. An MBID
identifies the selected entity precisely, but it cannot
repair a mistaken selection. Our source-cache key still uses the artist name as well. Ambiguous names
remain a limitation of this enrichment path.
[MusicBrainz matching](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/musicbrainz_ext.py#L14-L27).

## Save a proposal without undoing a correction

The database write is where the opening failure has to be prevented. With no Last.fm payload, assembly has
no biography to submit. The writer maps that missing field to `None` and leaves its existing value alone.

It also checks field locks. A manual edit can lock the biography, tags, identity, location, dates, artist
type or URLs. Enrichment must leave those corrections in place even when a provider supplies a new value.
The write applies both rules together:

```python source="app/crate/db/repositories/library_enrichment_writes.py#L211-L215" commit="224d3378d52d2047eb522645166efe5b7e1c0b5d" "value is not None" "locked_field not in locked_fields"
        for attr, value in field_map.items():
            locked_field = field_lock_map.get(attr)
            if value is not None and locked_field not in locked_fields:
                setattr(artist, attr, value)
        artist.enriched_at = datetime.now(timezone.utc)
```

In the visual, the country proposed by MusicBrainz reaches assembly but the saved country stays at the
manual value. The source did its work; the write policy decided that the existing correction took priority.
The lock mapping is explicit. This writer does not protect every field, and the other writes in the job
do not all pass through it.
[Manual edits and the enrichment lock map](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/db/repositories/library_enrichment_writes.py#L133-L218).

There is a consequential difference between a missing value and an empty one. `None` preserves the old
field. An empty string or empty list is still a value and can replace an unlocked field. For example, a
usable Last.fm payload with no tags can supply an empty list. The fix prevents an absent source from
clearing its scalar fields; it does not make every incomplete response harmless.

Nor does partial preservation extend inside every JSON value. If this run assembles a `urls` dictionary,
the writer replaces the stored dictionary. A missing provider's old link can disappear while links from
successful providers remain. Tags have the same limit: the union combines this run's Last.fm and Spotify
responses, not every tag already stored. If only Spotify succeeds, its genres can replace a list that also
contained Last.fm tags.

## Saving the artist does not finish the job

The source caches, combined enrichment cache and artist row are separate writes. Similarities, the genre
index and an optional Bandcamp URL have their own steps. Photo acquisition comes later: if the artist
directory lacks a recognised local photo, the worker attempts a download, updates the photo flag and can
queue artwork materialisation. An existing local photo is left in place.
[Persistence and follow-up work](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L458-L514),
[Local photo handling](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/enrichment.py#L269-L301).

There is no transaction spanning that entire process. If the artist-row update raises an exception, the
job logs it and continues with later steps. The returned `has_lastfm`, `has_spotify` and other flags say
which source payloads were assembled; they do not certify that every write succeeded. Similarly,
`enriched_at` records an artist update, not complete coverage from all providers.

That matters when deciding whether to retry. A partially successful update can trigger the recent-artist
guard on the next run. A failed source is not guaranteed an immediate second attempt just because another
source succeeded. We retain useful information, but the job's coarse completion timestamp cannot describe
the freshness and failure state of each provider.

The walkthrough follows this background writer. Crate also has enrichment read handlers: one can rebuild
a response from persisted fields, and a cache miss without persisted enrichment can still fetch inline.
The fast Listen artist-page helper uses cached setlist data and queues a refresh when it is absent. Those
paths have different latency contracts; moving the worker's calls into a pool did not automatically make
every read cache-only.
[Enrichment read paths](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/crate/api/enrichment.py#L134-L187).

We test the changes at the points where their behaviour differs. A barrier-based test requires two
fetchers to enter concurrently. Another gives Last.fm a cached response and checks that its fetcher is
never called. The assembly test supplies six bundles and checks the merged tags, external IDs, URLs and
separate similarity write; a local photo fixture verifies that the download is skipped.
[Enrichment tests](https://github.com/thecrateapp/crate/blob/224d3378d52d2047eb522645166efe5b7e1c0b5d/app/tests/test_enrichment.py#L616-L784).

Returning to the failed refresh, the artist can now keep its biography while Spotify contributes new
information. A fresh MusicBrainz response can propose a country without replacing the one somebody
corrected. Reusable source bundles skip their fetchers, and independent misses can overlap instead of
waiting for every preceding provider. The saved record survives the combined cache expiring. For shared
tags and URLs, preservation is still coarser: the writer replaces the entire unlocked field with the result
of the current run.
