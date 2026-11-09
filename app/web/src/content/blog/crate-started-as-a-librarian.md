---
title: "Crate started as a librarian"
description: "The first tag editor tried to write through a read-only mount. Moving those writes into a worker changed what an Apply button could promise."
date: 2026-11-10
draft: false
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 1
related: [reads-from-snapshots, reading-errors-without-trusting-them]
tags: [How to dismantle Spotify, architecture, library, history]
sources:
  - docs/technical/04-library-storage-sync-and-imports.md
  - docs/technical/03-worker-tasks-and-background-services.md
---

_Part 1. Repairing a shared music library, 19–20 March 2026._

The first version of Crate could find an album, search MusicBrainz for a better set of tags and show an
Apply button. That button could not save the changes in our Docker setup. We had wired it directly to
the tag writer in the API, whose music directory was mounted read-only.

We moved the write into a worker and returned a task ID from the endpoint. That let us record the repair,
run it separately and keep the result after the request ended. It also changed what the Apply button
could promise: accepting a task and saving every file were two different outcomes. The worker could
finish with only some files updated, and the interface needed to report that partial result.

We started with a librarian for a collection shared with other applications. We called it
`musicdock-librarian`: a FastAPI API, a React interface and a Python worker for inspecting and repairing
the files. Playback belonged to Navidrome.

## The problem: an Apply button in the wrong process

Our stack used Navidrome for its playable catalogue and streaming, AudioMuse for sonic analysis,
and tools such as Lidarr and Tidarr around acquisition and library management. We added the librarian
to inspect the files they shared. Its [scanner registry](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/scanner.py#L14-L21)
checked nested directories, naming problems, duplicates, mergeable albums and incomplete albums.

An audio file could decode correctly and still belong to the wrong edition, have a misleading title
or sit in a folder that disagreed with its tags. Fixing an album meant changing the files that other
services would later read.

We had already separated readers from writers in the deployment. The API received a
[read-only music mount](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/docker-compose.yaml#L250-L253);
the worker received a [writable one](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/docker-compose.yaml#L274-L277).
The Apply handler disagreed with that division:

```python source="librarian/librarian/api/matcher.py#L29-L38" commit="211f715c1404f083b7812acad584d4b552d3e2bc" "apply_match"
@router.post("/api/match/apply")
def api_match_apply(data: MatchApplyRequest):
    lib = library_path()
    album_dir = safe_path(lib, f"{data.artist_folder}/{data.album_folder}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Album not found"}, status_code=404)

    exts = extensions()
    result = apply_match(album_dir, exts, data.release)
    return result
```

`apply_match()` opened each audio file with Mutagen and eventually called `audio.save()`. The path
could exist and pass validation while still being impossible to write. The function caught errors for
each file and returned them, so the HTTP handler could finish normally even when no tags were saved.

The API could validate the album and accept the operator's choice of metadata without write access.
Saving that choice to files belonged to the worker. We needed to split those operations and give the
browser a way to follow the write after the request finished.

## Investigating the boundary: beets, Navidrome and Crate

beets and Navidrome put this boundary in different places. beets manages the import workflow, including
changes to the files. Navidrome expects another tool to edit them.

### beets separates a proposal from applying it

The beets importer finds files, groups them into albums, looks up metadata and coordinates the changes.
Its workflow is separate from both the matching engine and the command-line interface. Matching a
release and applying its metadata can fail independently, even in a local command-line application. [beets importer architecture](https://beets.readthedocs.io/en/stable/dev/importer.html).

The autotagger previews changes, asks for input on less convincing matches and lets the operator skip
an album or keep its existing tags. With the `-W` import option, it stores metadata in the beets database
without writing it into the audio files. [beets autotagger guide](https://beets.readthedocs.io/en/stable/guides/tagger.html).

We already had candidate selection and confirmation on the album page. After the operator approved
the proposal, though, the request still called the tag writer itself.

### Navidrome leaves tag editing to another tool

Navidrome groups music using embedded tags and keeps file metadata read-only. Its documented workflow
has an external editor save the tags, followed by a scan so the server can incorporate them into its
catalogue. A directory name alone does not determine how an album appears there.
[Navidrome tagging guidelines](https://www.navidrome.org/docs/usage/library/tagging/).

In our stack, Crate could repair the collection while Navidrome handled playback. Corrected tags would
only appear in Navidrome after both applications had done their work: our librarian saved the files,
then Navidrome scanned them. Each application ran its own operation against the shared directory.

### Crate already had somewhere to run the write

Giving the API a writable mount and leaving the call in the request would
remove the immediate permission mismatch, but the operation would still have no persisted job of its
own. Keeping tag editing outside the application, as Navidrome does, would leave the repairs to a separate
tool. We already offered repairs in the album page and had a task mechanism for background work.

We reused that mechanism. The API validated the album path and recorded the selected release.
A worker ran the tagger through its writable mount, and the browser followed the task to read the result.

We [moved match application, tag edits and duplicate resolution into worker tasks](https://github.com/thecrateapp/crate/commit/971d50b779dd8bf1197939ee47642327de5f5df1)
together. Each could change files in the shared library.

## Implementing a repair from selection to result

### Build a proposal the operator can inspect

Take a file at `/music/Artist/Album/01 - Track.flac`. Our browser found albums by
walking directories. It cached the artist listing for five minutes in SQLite, then filtered, sorted
and paginated the assembled list in memory. SQLite initially held tasks, scan results, settings and
caches; we did not yet have a relational catalogue of artists, albums and tracks.
[Browser implementation](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/api/browse.py#L18-L93),
[initial schema](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/db.py#L46-L89).

Matching started from the files inside the chosen directory. Our matcher read their tags and durations,
selected the most common artist and album names, and searched MusicBrainz. If both names were missing,
it fell back to directory names. It then scored candidate releases and attached a preview:

```python source="librarian/librarian/matcher.py#L46-L54" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
        score = _score_match(local_info, release_detail)
        scored.append({
            **release_detail,
            "match_score": score,
            "tag_preview": _build_tag_preview(local_info, release_detail),
        })

    scored.sort(key=lambda x: x["match_score"], reverse=True)
    return scored[:5]
```

We scored releases using track count, the mean absolute duration difference between paired tracks,
track-title similarity and album-title similarity. This gave us an ordering for the candidates, but a
high score did not tell us the probability that a match was correct. The interface showed the [candidates and an Apply confirmation](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/ui/src/pages/Album.tsx#L192-L229).

Filename order needed checking before accepting a candidate. Local files came from a sorted directory
listing, and both comparison and application paired tracks by position. The first local file
was paired with the first release track, the second with the second, and so on. A plausible album score
could coexist with a wrong track assignment if filename order did not match release order.
[File ordering](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/audio.py#L36-L42),
[positional application](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/matcher.py#L57-L94).

### Persist the chosen operation

We kept the path validation in the endpoint and replaced the direct call with a task insertion:

```python source="app/musicdock/api/matcher.py#L37-L42" commit="971d50b779dd8bf1197939ee47642327de5f5df1" "create_task"
    task_id = create_task("match_apply", {
        "artist_folder": data.artist_folder,
        "album_folder": data.album_folder,
        "release": data.release,
    })
    return {"task_id": task_id}
```

We put the artist folder, album folder and selected release data in the payload. The worker did not need
to repeat the search or choose the highest-scoring release again. It received the proposal the operator
had approved. The path remained a dependency: the album could disappear or move between validation and
execution.

The task row recorded its type, parameters, status, progress, result and error. Our SQLite worker polled
for pending tasks and dispatched handlers through a thread pool configured with three workers. We were
also moving the database to PostgreSQL during this work; that migration was complete by the time we
moved Apply into the worker. We kept the database-backed task mechanism across the change, without a broker.

### Execute through the writable mount

The worker handler reconstructed the album path, checked that the directory still existed and
called the tagger:

```python source="app/musicdock/worker.py#L1013-L1027" commit="971d50b779dd8bf1197939ee47642327de5f5df1" "apply_match"
def _handle_match_apply(task_id: str, params: dict, config: dict) -> dict:
    from musicdock.matcher import apply_match

    lib = Path(config["library_path"])
    artist_folder = params.get("artist_folder", "")
    album_folder = params.get("album_folder", "")
    release = params.get("release", {})

    album_dir = lib / artist_folder / album_folder
    if not album_dir.is_dir():
        return {"error": "Album not found"}

    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))
    result = apply_match(album_dir, exts, release)
    return result
```

We could now run the same tagger in a process with permission to save the files. If the album had disappeared,
the handler returned an error object. The task wrapper treated that normal return as completion, even
though its result described a failure.

![On 19 March the Apply request called the tagger inside the API despite its read-only music mount. On 20 March it returned a task ID; the worker read the task from the database and wrote the files through its writable mount.](/blog/crate-started-as-a-librarian/write-boundary.svg)

The tagger wrote titles, track and disc numbers, album information and dates, plus MusicBrainz recording,
release and release-group identifiers when available. It saved one file at a time. Its result counted
successful writes and collected exceptions:

```python source="app/musicdock/matcher.py#L89-L94" commit="971d50b779dd8bf1197939ee47642327de5f5df1"
            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": track_path.name, "error": str(e)})

    return {"updated": updated, "total": len(tracks), "errors": errors}
```

Moving the function did not make an album update atomic. If six files were saved and the seventh failed,
those six changes remained. A database transaction around the task row could not roll them back.

### Follow the task in the browser

We changed the album page to read `task_id`, poll the task every two seconds, and refresh
when its status became `completed`. It reported a failed task separately and stopped polling after a
minute. The browser's timer limited how long that page waited; it did not cancel the worker's operation.
[The updated Apply flow](https://github.com/thecrateapp/crate/blob/971d50b779dd8bf1197939ee47642327de5f5df1/app/ui/src/pages/Album.tsx#L134-L162).

Our [task wrapper](https://github.com/thecrateapp/crate/blob/971d50b779dd8bf1197939ee47642327de5f5df1/app/musicdock/worker.py#L67-L81)
marked a normal handler return as `completed`. The page then showed a success notification containing the
number of updated tracks, without checking the returned per-file errors. A completed task could therefore
contain a partial repair, or even zero updated tracks. The page needed to inspect the result as well
as the task status.

### Restart an interrupted job

At worker startup, we moved tasks left in `running` back to `pending`:

```python source="librarian/librarian/worker.py#L77-L81" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
    # Clean up orphaned tasks from previous worker crash/restart
    orphaned = list_tasks(status="running")
    for t in orphaned:
        log.warning("Resetting orphaned task %s (type=%s) to pending", t["id"], t["type"])
        update_task(t["id"], status="pending", progress="")
```

The row kept the task parameters and status, but no per-file checkpoint. After a crash, the handler
would run again from its entry point against whatever was now on disk.

For tag application, that meant visiting the files again and assigning metadata from the stored release.
Any files successfully saved before the crash were already changed. Recovery depended on the handler
being able to run against that state; resetting a status field alone could not provide that guarantee.
We also had no exactly-once guarantee across multiple workers with this polling and restart mechanism.

## Before and after

| Behaviour         | Write inside the request       | Write inside a worker                         |
| ----------------- | ------------------------------ | ---------------------------------------------- |
| Write owner       | HTTP handler calls the tagger  | Worker calls the tagger                        |
| File access       | API has a read-only mount      | Worker has a writable mount                    |
| Initial response  | Tagger's result                | ID of a persisted task                         |
| Browser follow-up | Wait for request, then refresh | Poll task, then refresh                        |
| Restart recovery  | No task for this Apply call    | Pending/running task can be replayed           |
| Per-file failures | Collected in the result        | Still collected; task completion can hide them |

An operator could now submit a correction that ran where the files were writable and left a stored
result. The page no longer needed to hold the request open while the tagger worked. We still needed to
make partial repairs visible in the UI and account for files already saved when a task ran again.

The collection still had several identities. The directory browser knew a path, the matcher knew a
MusicBrainz release, and playback needed Navidrome's album and song IDs. We connected the
directory browser to Navidrome by searching names:

```python source="librarian/librarian/navidrome.py#L131-L140" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
def find_album(artist_name: str, album_name: str) -> dict | None:
    result = search(f"{artist_name} {album_name}", artist_count=0, album_count=20, song_count=0)
    for album in result.get("album", []):
        if album.get("artist", "").lower() == artist_name.lower() and album.get("name", "").lower() == album_name.lower():
            return album
    # Fuzzy: try partial match
    for album in result.get("album", []):
        if album_name.lower() in album.get("name", "").lower() and artist_name.lower() in album.get("artist", "").lower():
            return album
    return None
```

After an exact case-insensitive comparison, it tried a substring match. The adapter did not use the
MusicBrainz identifiers the tagger had just written. A partial name could select the wrong edition,
and a newly tagged file still needed to be scanned before Navidrome's index reflected the change.
We configured Navidrome with an [hourly scan schedule](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/docker-compose.yaml#L90-L111).
Our adapter still depended on names to connect the two systems, even though each had more precise identifiers.

![Metadata repair follows local files through MusicBrainz candidates to saved tags. Playback follows a separate route through artist and album name search to Navidrome song IDs.](/blog/crate-started-as-a-librarian/album-identities.svg)

Alongside the repair work, we were replacing directory traversal with a catalogue. We added
[indexed library tables and a filesystem watcher](https://github.com/thecrateapp/crate/commit/a3d670457ecd67c27afb42c8b1155d068de7a663),
then [moved the database to PostgreSQL](https://github.com/thecrateapp/crate/commit/93764ac35ce2e39b5cd05393647da8409342d207).
The next chapter follows that index: what it made cheaper to read, and what happened when scans and
workers started updating it concurrently.

_The storage and worker documents below describe how these components work in Crate today._
