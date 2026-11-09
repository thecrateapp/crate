---
title: "When retries repeat a finished download"
description: "A watcher raced the importer, and a failed task could repeat a finished download. We changed the handoff and stopped retrying the whole acquisition."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 4
related: [crate-started-as-a-librarian, filesystem-to-indexed-catalogue, observing-a-home-server]
tags: [How to dismantle Spotify, workers, acquisition, storage, history]
sources:
  - docs/technical/03-worker-tasks-and-background-services.md
  - docs/technical/04-library-storage-sync-and-imports.md
  - app/crate/worker_handlers/acquisition.py
  - app/crate/library_watcher.py
---

_Part 4. Getting downloaded music into the library, March–April 2026._

An artist download had already put the music on disk. Crate was still moving those files into the
library and indexing them when another worker started reorganising the same artist's folders. Paths
that one job had just found could disappear before it opened them.

The acquisition task also allowed automatic retries. An uncaught failure after the transfer could
send the entire job back through the downloader, even though fetching the music had succeeded. We
had made one task responsible for several operations, each with a different idea of what it meant
to finish.

The [playback work](/blog/taking-playback-over-from-navidrome) was happening alongside these new ways
to bring music into Crate. The Tidal importer downloaded into a
staging directory outside the watched library, moved the files under the library root, synced the
artist into the catalogue and requested `process_new_content` for enrichment and organisation. It
also asked Navidrome to scan the files, before that integration was removed.
[Acquisition design](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/docs/plans/2026-03-23-tidal-integration-design.md#L122-L142).

## The retry went back to the downloader

Admin could show `downloading`, `moving` and `syncing` as the task progressed. Those labels did not
record a place from which the handler could resume. Starting it again called `download()` with the
original URL, even if its previous attempt had already fetched the music.
[Download entry point](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/worker_handlers/acquisition.py#L100-L134).

The wrapper decided what the queue would see. Unless the task had been cancelled, a normal return
marked it complete. An exception marked it failed and then escaped to Dramatiq:

```python source="app/crate/actors.py#L220-L236" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "raise"
    try:
        config = load_config()
        result = handler(task_id, task.get("params", {}), config)

        if _is_cancelled(task_id):
            log.info("Task %s was cancelled during execution", task_id)
        else:
            update_task(task_id, status="completed", result=result or {})
            log.info("Task %s (%s) completed", task_id, task_type)

    except Exception as e:
        log.exception("Task %s (%s) failed", task_id, task_type)
        try:
            update_task(task_id, status="failed", error=str(e)[:500])
        except Exception:
            log.error("Could not mark task %s as failed", task_id)
        raise  # let dramatiq handle retry logic
```

An error dictionary was still a normal return to this wrapper. A logged exception inside the
handler was also different from one that reached the final `raise`. The acquisition path had both:

| Where the attempt stopped | What the handler did | What could happen next |
| --- | --- | --- |
| The move raised an uncaught exception | Let it reach the task wrapper | With the old retry policy, the whole handler could run again, including the transfer |
| Immediate `sync_artist()` failed | Caught and logged the error | Continued towards the follow-up and completion |
| Requesting follow-up processing failed | Logged and swallowed the error | Could still mark acquisition completed |
| The move reported no artists | Returned an error dictionary before the later cleanup block | The download record could be failed while the task wrapper marked its row completed |

The importer already caught its immediate sync errors before this fix. A missing file in that call
did not, by itself, trigger another download. The move and other unprotected operations could still
raise past the handler. Retrying at that boundary repeated more work than the failed step required.
[Importer before the fix](https://github.com/thecrateapp/crate/blob/91ead06ae38ed7874ba5cb7abc6dac2aee65be3f/app/crate/worker_handlers/acquisition.py#L132-L195).

Dramatiq assumes actors are idempotent. Its retry middleware schedules another attempt after an
exception, with backoff; it does not infer which phases inside the function already succeeded.
The current guide also provides `retry_when` for choosing which exceptions to retry.
[Dramatiq 2.2 error handling and retries](https://dramatiq.io/guide.html#error-handling).

Backoff would only delay the next transfer. A `FileNotFoundError` alone could not distinguish an
incomplete download from a path moved by another worker. Celery's task documentation makes a related
distinction: acknowledging a message before or after execution affects redelivery, while idempotency
depends on the task's effects. Switching queues would leave the import's phases to us.
[Celery 5.7 task semantics](https://docs.celeryq.dev/en/stable/userguide/tasks.html).

For this actor we changed the automatic retry count from two to zero. The configuration stores
queue, priority, time limit in seconds and retry count in that order:

```python source="app/crate/actors.py#L38-L41" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "tidal_download"
TASK_POOL_CONFIG: dict[str, tuple[str, int, int, int]] = {
    # User-initiated (priority 0) — these should run ASAP
    "tidal_download":       ("default", 0, 1800, 0),
    "soulseek_download":    ("default", 0, 1800, 2),
```

A late uncaught import error would no longer restart the transfer through exception retry. The cost
was that an earlier uncaught failure lost its automatic retries too. Other task types kept their own
settings. Durable phase results, with a handler able to resume from them, would have allowed a more
selective recovery than disabling retries for the entire acquisition.

Zero retries did not prevent a user submitting the operation again. Dramatiq also documents
redelivery of in-flight messages after a worker dies. Disabling exception retries left those two
ways of repeating the operation in place.
[Dramatiq message persistence](https://dramatiq.io/advanced.html#message-persistence).

## Keep the watcher out of the move

The other worker reached the artist through our own filesystem writes. The watcher grouped events
with a debounce timer, synced the affected album and artist, and could enqueue `process_new_content`
when new audio appeared. That was useful for music added outside Crate. Importing our own download
produced those same events as soon as the first files entered the library.
[Watcher handoff](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/library_watcher.py#L104-L141).

Staging kept the transfer outside the watched tree. The move still created destination folders and
moved files individually, exposing part of an artist while the importer was working through the rest.
Both its explicit follow-up and the watcher could then request processing for that artist.

Processing could reorganise `Artist/Album/` into `Artist/Year/Album/` and update catalogue paths.
A file found by the importer could move again before the importer opened it.
[Folder reorganisation](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/worker_handlers/enrichment.py#L452-L472).

The watcher already checked a processing marker before scheduling an artist. It looked in a set
inside its own process and then in the shared cache:

```python source="app/crate/library_watcher.py#L91-L102" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "processing:"
        # Skip if this artist is currently being processed by worker
        # Check both in-process set and DB cache (for cross-process coordination)
        if artist_name.lower() in self._processing:
            log.debug("Watcher: ignoring change during processing for %s", artist_name)
            return
        try:
            from crate.db import get_cache
            if get_cache(f"processing:{artist_name.lower()}"):
                log.debug("Watcher: ignoring change during processing for %s (DB flag)", artist_name)
                return
        except Exception:
            pass
```

The importer needed to set the marker before the first file moved. An artist URL could arrive
without an artist name in the request, but the downloader's staging directory already contained
artist folders. We marked those names, then also marked the names returned by the move in case it
had canonicalised them differently:

```python source="app/crate/worker_handlers/acquisition.py#L147-L165" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "set_cache"
    processing_root = Path(result["path"])
    staged_artists: list[str] = []
    if processing_root.is_dir():
        staged_artists = [
            p.name for p in processing_root.iterdir() if p.is_dir()
        ]
    for staged in staged_artists:
        set_cache(f"processing:{staged.lower()}", True, ttl=3600)

    try:
        modified_artists = move_to_library(result["path"], str(lib))
        # move_to_library may have canonicalized names slightly differently;
        # make sure every emitted artist has a processing mark too.
        for current_artist in modified_artists:
            set_cache(f"processing:{current_artist.lower()}", True, ttl=3600)
    except Exception:
        for staged in staged_artists:
            delete_cache(f"processing:{staged.lower()}")
        raise
```

If the move raised, the exception branch cleared the staged markers and let the exception reach the
wrapper. Marking only the names returned by the move would have left the entire move exposed to
the watcher.

![Before the change, acquisition writes could trigger competing watcher work. Afterwards the importer marks each artist before moving files and explicitly requests follow-up processing.](/blog/when-retries-repeat-a-download/ingestion-handoff.svg)

[Open the handoff diagram at full size](/blog/when-retries-repeat-a-download/ingestion-handoff.svg).

The marker was a boolean cache value without an owner token. Setting it did not wait for another
importer to finish. Cache lookup errors were ignored, so a failed check let the watcher proceed. The requested one-hour TTL applied through Redis;
the database cache fallback did not preserve that expiry.
[Cache implementation](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/db/cache.py).

A marker also did not cancel a debounce timer that had already been scheduled. The watcher checked
when the event arrived, and its timer callback did not check again. The change suppressed new work
when that check observed the marker. It did not serialise every operation on an artist.

The task-deduplication tests covered creation of another pending or running task with matching
parameters. They deliberately allowed a new task after the previous one completed or failed. They
did not exercise the downloader and watcher competing over real files, and the acquisition fix
added no regression test for that interleaving.
[Task-deduplication tests](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/tests/test_task_dedup.py#L24-L84),
[acquisition fix](https://github.com/thecrateapp/crate/commit/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4).

A regression case would pause the import after files became visible, deliver a watcher event and
then fail a later step. It would need to inspect which worker acted on the artist and whether the
downloader ran again. A final task status alone would not establish either result.

### Collect the paths before moving them

The move had a second race even without the watcher. It iterated over album directories and their
contents while moving entries out of those directories. We changed the loops to collect paths
before moving them and to handle failures around each file:

```python source="app/crate/tidal.py#L322-L345" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "album_files" "shutil.move"
        # Snapshot the album list before we start mutating the directory.
        album_dirs = [d for d in sorted(item.iterdir())]
        for album_dir in album_dirs:
            if album_dir.is_dir():
                final = dest_dir / album_dir.name
                final.mkdir(parents=True, exist_ok=True)
                album_files = [f for f in sorted(album_dir.iterdir())]
                for f in album_files:
                    if not f.exists():
                        continue  # already moved or vanished
                    dest_file = final / f.name
                    try:
                        if dest_file.exists():
                            if dest_file.is_dir():
                                shutil.rmtree(str(dest_file), ignore_errors=True)
                            else:
                                dest_file.unlink()
                        shutil.move(str(f), str(dest_file))
                    except FileNotFoundError:
                        log.warning(
                            "move_to_library: missing file during move %s -> %s",
                            f,
                            dest_file,
                        )
```

Python leaves it unspecified whether an entry added or removed after creating a `Path.iterdir()`
iterator will appear in that iteration. Collecting the paths first avoids mutating a directory
while discovering what to move. Those names still do not keep the files alive: another process can
remove a path after the existence check and before `shutil.move()`.
[Python 3.13 directory iteration](https://docs.python.org/3.13/library/pathlib.html#pathlib.Path.iterdir).

Catching a failure per file let the importer attempt the remaining files. Its return value listed
artists it had touched; it was not a manifest proving that every track arrived. Cleanup still
called `shutil.rmtree()` on staging after caught move failures. A file left there could therefore
be deleted. The batch could make progress while losing the very file that needed recovery.
[Staging cleanup](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/tidal.py#L353-L380).

A partial-move test needs to assert that an unmoved file survives cleanup. Keeping staging files
until a verified import would require a further change to this implementation.

## Complete the handoff without repeating the transfer

With the artist marked, acquisition attempted catalogue sync and explicitly requested follow-up
processing. The normal path cleared markers in a `finally` block:

```python source="app/crate/worker_handlers/acquisition.py#L221-L233" commit="1f9bd46b46256da7091ffe2a541d7a39ba37f2f4" "force=True" "finally"
        from crate.content import queue_process_new_content_if_needed
        for current_artist in modified_artists:
            try:
                queue_process_new_content_if_needed(
                    current_artist, library_path=config.get("library_path"), force=True
                )
            except Exception:
                log.debug("Failed to queue process_new_content for Tidal artist %s", current_artist, exc_info=True)
    finally:
        # Let the watcher react to any remaining file changes from the
        # queued process_new_content as normal.
        for name in set(staged_artists) | set(modified_artists):
            delete_cache(f"processing:{name.lower()}")
```

`force=True` bypassed the content-hash check at enqueue time. Task creation could still be
deduplicated, and the processing handler had its own hash check. The call was a request to do the
remaining work, with failures to enqueue logged and swallowed by the importer.
[Enqueue decision](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/content.py#L82-L105),
[processing check](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/worker_handlers/enrichment.py#L775-L798).

A completed acquisition could still have failed sync or unqueued enrichment behind it. The early
return when the move reported no artists happened before this `finally`, so it could also leave
staged markers behind. That branch marked the download record failed, returned an error dictionary
and allowed the wrapper to mark its separate task row completed.
[Completion and early return](https://github.com/thecrateapp/crate/blob/1f9bd46b46256da7091ffe2a541d7a39ba37f2f4/app/crate/worker_handlers/acquisition.py#L147-L249).

A downloaded artist could now enter the library with its watcher events suppressed and an explicit
request for follow-up processing. If sync or that enqueue failed, the acquisition record could still
end as completed. Disabling the whole-job retry kept an uncaught late error from automatically
starting another transfer, but it left recovery of the incomplete import to a separate attempt.
The task row alone did not identify which files or follow-up work still needed attention.

_The code excerpts show the April 2026 implementation. The references below describe the worker and
storage systems in Crate today._
