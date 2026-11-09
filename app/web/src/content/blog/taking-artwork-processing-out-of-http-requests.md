---
title: "Taking artwork processing out of HTTP requests"
description: "An album cover request could read audio, call a provider and resize an image. We moved that work into persistent variants and made a miss cheap to serve."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 16
related: [reads-from-snapshots, keeping-background-work-from-interrupting-playback, giving-every-album-a-stable-address]
tags: [How to dismantle Spotify, artwork, workers, performance, history]
sources:
  - docs/technical/artwork-delivery.md
  - app/crate/artwork_materializer.py
  - app/crate/artwork_variants.py
  - app/crate/artwork_sources.py
  - app/crate/api/artwork_delivery.py
  - app/crate/worker_handlers/artwork.py
  - app/tests/test_artwork_read_path_purity.py
  - app/tests/test_artwork_materializer.py
---

_Part 16. Preparing artwork before the browser needs it, May–July 2026._

Asking Crate for an album cover could make it open the album's audio files. If there was no cover
beside the music, the handler searched the tracks for embedded artwork, extracted the first image
it found, resized it and returned it. Asking for an artist photo could go further: call an external
provider and try to save the result into the artist's directory.

All of that happened because a browser needed an image. A page full of album cards could therefore
start work whose cost depended on missing files, audio tags and remote services. A warm browser
cache hid some of it. The next cold request still had to do the work.
[Album fallback before materialization](https://github.com/thecrateapp/crate/blob/22963e010e2fb934e0e8780b6c7fe6f93387e362/app/crate/api/browse_album.py#L1021-L1029),
[artist provider fallback](https://github.com/thecrateapp/crate/blob/22963e010e2fb934e0e8780b6c7fe6f93387e362/app/crate/api/browse_artist.py#L1338-L1344).

We had already made the images smaller. By May, the response helper could resize artwork and
convert it to WebP. In July we changed who did that processing and when: workers prepared persistent
variants, while the HTTP path served a prepared file, an existing original or a fallback.

## Smaller responses still had an expensive producer

Serving a full-size source for a small album card wastes bytes. We added size and format parameters
so Listen could ask for an appropriate representation. The first implementation did the conversion
while building the response:

```python source="app/crate/api/image_variants.py#L69-L79" commit="1cc547459ea592c8fe13ee7d706a20415829af45" "resize_image_bytes"
    resized_content, resized_media_type = resize_image_bytes(
        content,
        media_type,
        size=size,
        output_format=output_format,
    )
    return Response(
        content=resized_content,
        media_type=resized_media_type,
        headers=dict(headers or {}),
    )
```

`resize_image_bytes()` opened the image with Pillow, applied a thumbnail operation when needed and
encoded the result into a byte buffer. WebP used quality 82 and method 4. This reduced the size of
what we sent without removing image decoding and encoding from the API process.
[The first WebP response helper](https://github.com/thecrateapp/crate/blob/1cc547459ea592c8fe13ee7d706a20415829af45/app/crate/api/image_variants.py#L21-L58).

A cache can avoid repeating that work for a particular representation. It does not decide who
pays for the first miss. Nor does a smaller thumbnail prevent the provider request needed to obtain
a missing original. We needed a delivery path whose behaviour stayed bounded when the cache was
cold or the provider was slow.

There are existing services for moving image processing out of an application. Imgproxy, for
example, accepts a source URL and transformation options, fetches the source and produces the
requested image in a separate HTTP service. That is a useful option when on-demand transformations
are the desired contract.
[Imgproxy's request model](https://docs.imgproxy.net/).

Crate also needed to resolve sources that were not ordinary remote image URLs: embedded covers,
managed artist directories, genre artwork and pre-release records. We already had worker tasks,
progress reporting and a writable data volume. We kept source resolution there and chose a small
set of prepared sizes. A request would no longer decide to decode a FLAC file because its cover
was missing.

## The cold request returns before preparation starts

We introduced a delivery function shared by the artwork endpoints. Its order was simple:

1. Resolve the requested size from the current prepared revision.
2. If no variant exists, serve a local original when one is available.
3. Otherwise return the endpoint's existing missing-artwork response.
4. On a miss, arrange a deduplicated materialization task after sending the response.

The local-original branch shows the compromise:

```python source="app/crate/api/artwork_delivery.py#L86-L103" commit="d660829dea06a0a230564a555df97bbfd0a89fdd" "_queue_after_response"
    if local_original is not None and local_original.is_file():
        _record_request(asset, "original")
        response = FileResponse(
            local_original,
            media_type=_MEDIA_TYPES.get(
                local_original.suffix.lower(), "application/octet-stream"
            ),
            headers={
                "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
                "ETag": _file_etag(local_original),
                "X-Crate-Artwork": "original",
            },
        )
        return (
            _queue_after_response(response, asset, reason="variant-miss")
            if queue_on_miss
            else response
        )
```

A reader could temporarily receive a larger image than requested. If there was no source file,
an album cover could return the SVG placeholder; an artist endpoint could retain its 404. The
handler did not wait for a download or an image encoder to improve that response.

The variant response carried an ETag derived from its source revision and a longer cache lifetime.
The original fallback had a five-minute freshness lifetime. `X-Crate-Artwork` identified whether the
response came from a variant, an original or the missing branch. Those headers made it possible to
inspect which path a page was actually exercising.
[Variant and fallback response headers](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/api/artwork_delivery.py#L64-L111).

![An artwork GET serves a prepared variant, local original or fallback, then requests deduplicated worker work. The worker resolves the source, renders a revision and publishes current.json after its files exist. A later GET can resolve that revision.](/blog/taking-artwork-processing-out-of-http-requests/artwork-publication.svg)

[Open the artwork publication diagram at full size](/blog/taking-artwork-processing-out-of-http-requests/artwork-publication.svg).

The after-response hook only submitted the job. Starlette's `BackgroundTask` runs in the API process
after the response has been sent; it is not a durable worker by itself. The durable task began when
Crate successfully created and dispatched it. If that submission failed, we recorded a queue-failure
metric and kept the already selected response. A subsequent miss or the backfill could try again.
[Starlette background tasks](https://starlette.dev/background/),
[queue submission after the response](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/api/artwork_delivery.py#L36-L61).

Every request for the same asset used `artwork:<kind>:<entity-key>` as its deduplication key. Asking
for several sizes did not need several concurrent jobs because one materialization generated the
asset's whole size set. That limited duplicate active work; it did not make a permanently missing
source appear or provide a durable guarantee for an API process that died before submitting.
[Per-asset task deduplication](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_tasks.py#L11-L16).

A successful HTTP response was not enough to verify this change. The old code also returned images
successfully while doing work we wanted to remove. We wrote tests that replaced worker-only
operations with functions that raised if called from the request path.

For a cover missing beside an audio file, the test prohibited embedded-art extraction and expected
the existing placeholder:

```python source="app/tests/test_artwork_read_path_purity.py#L20-L32" commit="d660829dea06a0a230564a555df97bbfd0a89fdd" "_unexpected_request_path_work"
    monkeypatch.setattr(browse_album, "library_path", lambda: tmp_path)
    monkeypatch.setattr(browse_album, "extensions", lambda: [".flac"])
    monkeypatch.setattr(
        "crate.artwork_sources.extract_embedded_artwork",
        _unexpected_request_path_work,
    )

    response = browse_album.api_cover(
        "Artist", "Album", album_dir=album_dir, album_entity_uid=""
    )

    assert response.status_code == 200
    assert response.media_type == "image/svg+xml"
```

### Give the worker a stable asset, then let it find the source

An `ArtworkAsset` contained a kind and entity key. Albums and library artists used their catalogue
identity. Genre covers used their taxonomy identity; external artists used a hash of a normalized
name. The asset key was validated before it became part of the filesystem path.
[Asset identity and validation](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_variants.py#L47-L81).

The worker resolved that identity into actual source bytes. For an album, it checked local cover
files before reading embedded artwork. Artist sources could use local photos or backgrounds and,
when permitted, provider lookup. This moved the old fallback behaviour out of GET handlers without
requiring the browser to know where an original came from.
[Worker source resolution](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_sources.py#L103-L190).

Provider access depended on why the job existed. A demand-triggered miss could consult a provider,
while backfill and integrity-repair tasks passed `allow_provider=False`. Preparing the collection
therefore did not automatically turn every absent photo into an external request. A missing source
returned a `missing` result, which was different from a successfully materialized asset.
[Materialization task and provider policy](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/worker_handlers/artwork.py#L55-L106).

The [worker governor](/blog/keeping-background-work-from-interrupting-playback) also covered artwork
materialization, backfill, cleanup and repair. Moving processing into workers gave it a queue and
a place to wait when background capacity was constrained. It did not require a cover request to
wait with it.

## What the next request is allowed to discover

A reader must not discover a revision whose images are still being written. We generated each
revision in a temporary directory, then published the manifest only after the revision directory
was in place.

The source bytes supplied a SHA-256 hash. The first sixteen hexadecimal characters named the
revision directory, while the manifest retained the full hash. Identical source content could reuse
an existing complete revision. Different bytes produced a different revision without modifying the
files the old manifest referenced.
[Revision identity](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_materializer.py#L68-L84).

Sizes came from buckets: 128, 256, 384, 512, 768, 1024, 1280 and 2048 pixels, capped by artwork kind.
An album cover stopped at 1024; an artist background could reach 2048. A request for 320 selected
the 384 bucket. These were maximum dimensions with the aspect ratio preserved.

We also avoided upscaling. For a source whose largest dimension was 96 pixels, every larger requested
bucket pointed to the same physical 96-pixel file. The materializer kept a map of already generated
physical sizes so it did not encode identical small images repeatedly:

```python source="app/crate/artwork_materializer.py#L117-L135" commit="d660829dea06a0a230564a555df97bbfd0a89fdd" "physical_by_size"
        source_max = max(source.size)
        for requested_size in _variant_sizes(asset):
            physical_size = min(requested_size, source_max)
            existing = physical_by_size.get(physical_size)
            if existing is None:
                filename = f"{physical_size}.webp"
                output_dimensions = _write_webp_variant(
                    source, temporary / filename, physical_size
                )
                existing = (filename, output_dimensions)
                physical_by_size[physical_size] = existing
            filename, output_dimensions = existing
            variants[str(requested_size)] = f"{source_revision}/{filename}"
            dimensions[str(requested_size)] = list(output_dimensions)

        if final_revision.exists():
            shutil.rmtree(temporary)
        else:
            temporary.replace(final_revision)
```

Pillow's thumbnail operation keeps the aspect ratio within the requested size. We applied EXIF
orientation before resizing and converted unsupported colour modes into RGB or RGBA. The worker
rejected empty payloads, unreadable images and dimensions exceeding its 80-million-pixel limit.
Those checks happened before publication, leaving the previous manifest available when generation
failed. [Pillow thumbnail semantics](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.thumbnail),
[worker validation and orientation](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_materializer.py#L86-L105).

`current.json` mapped requested buckets to revision-relative paths and stored source identity,
dimensions and generation metadata. Publishing it used a temporary file in the same directory:

```python source="app/crate/artwork_variants.py#L122-L132" commit="d660829dea06a0a230564a555df97bbfd0a89fdd" "os.replace"
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, sort_keys=True, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, root / "current.json")
        directory_fd = os.open(root, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
```

The manifest contents were flushed and synced before replacement; the directory was synced after
the pointer changed. A reader could open the old manifest or the new one without reading a partially
written JSON document. The image revision had already been placed before this step.

Readers could now discover a revision only after its files were placed. There were still failure
cases to handle. The original implementation reused a
revision directory if it already existed; it did not replace a damaged existing directory with the
newly rendered temporary one. Its completeness shortcut checked paths and file existence rather
than decoding every WebP. Corruption required separate inspection and repair. Likewise, changing
the rendering recipe while retaining the same source bytes needed a versioning decision beyond
this original source-hash key.
[Initial completeness check](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_materializer.py#L47-L65).

Read-path tests also prohibited remote lookups for artist photos, backgrounds and pre-release
covers. Materializer tests covered repeated source bytes, changed sources, small images and a disk-full
exception after the first generated variant. That failure test checked that the old manifest's
bytes remained unchanged.
[Read-path regression tests](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/tests/test_artwork_read_path_purity.py),
[materializer publication tests](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/tests/test_artwork_materializer.py#L18-L125).

## Preparing the rest of the collection

Moving future misses into workers left the existing collection to prepare. The backfill enumerated
artists, albums and genres in bounded pages, carrying stable ID or slug cursors between tasks.
Each artist produced separate photo and background assets; album and genre rows produced their
own covers. Rows without a usable identity were counted and skipped.

Only after enumerating a page did the coordinator enqueue its continuation. The child jobs reused
the same per-asset deduplication keys as demand-driven requests. A restart could repeat enumeration
without needing a separate duplicate-rendering policy.
[Paged backfill and completion marker](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/worker_handlers/artwork.py#L109-L222).

Its completion marker meant that enumeration had reached the end. It did not mean every child had
rendered successfully. A child could still be pending, have no source or fail to produce a variant.
The backfill's `queued` counter also advanced when it requested an asset; it was not a count of new
files written. We needed request-result and materialization metrics to understand actual coverage.

Retention became part of the design because prepared images now survived a process restart. The
first cleanup kept the current revision and one previous revision, and removed temporary
directories only after they were more than twenty-four hours old. It reread the current manifest
before deleting an old revision. That provided a bounded history for ordinary variants; later
Artist Hero publications needed additional rules for their own manifest history.
[Initial revision retention](https://github.com/thecrateapp/crate/blob/d660829dea06a0a230564a555df97bbfd0a89fdd/app/crate/artwork_maintenance.py#L140-L190).

We now had persistent files to monitor, repair and retain. That was more operational work than
returning a freshly encoded byte buffer. Workers could do it without holding an album page open while an image was prepared.
