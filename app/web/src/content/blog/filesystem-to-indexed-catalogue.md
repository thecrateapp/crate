---
title: "When the filesystem stopped being the catalogue"
description: "A SQLite catalogue replaced directory walks on Crate's read path. PostgreSQL then changed how background jobs coordinated their writes."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 2
related: [building-an-artist-page-when-the-providers-disagree, reads-from-snapshots, a-beat-grid-in-a-few-bytes]
tags: [How to dismantle Spotify, databases, architecture, history]
sources:
  - docs/technical/04-library-storage-sync-and-imports.md
  - docs/technical/02-backend-api-and-data.md
---

_Part 2. Building a catalogue and coordinating its writers, 19–20 March 2026._

The first Crate artists endpoint defaulted to 60 results per page. On a cache miss, it visited the collection's
artist folders, album folders and audio files before deciding which 60 to send back. Pagination kept the
response small. It did very little for the work needed to build it.

We moved the library inventory into SQLite so browsing could use stored rows. A filesystem watcher
kept those rows up to date, but synchronization now competed with other background jobs for SQLite's
single writer. We first tried to coordinate those jobs in Python, then moved the database to PostgreSQL.

The [first chapter](/blog/crate-started-as-a-librarian) covered moving tag repairs into the worker.
Browsing was another problem we were working on at the same time. SQLite already stored tasks and
caches, but we had no tables describing the music itself.

## Why a page of artists needed the whole library

Consider a request for the first 60 artists sorted by album count. A folder tree can tell you which
artist directories exist. To order them by how many albums they contain, the application needs more
information. The original browser gathered it during the request.

For every artist, it walked the album directories and audio files:

```python source="librarian/librarian/api/browse.py#L41-L50" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
        for album_dir in d.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            album_count += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    track_count += 1
                    ext = f.suffix.lower()
                    fmt_counts[ext] = fmt_counts.get(ext, 0) + 1
                    total_size += f.stat().st_size
```

The code counted albums and tracks, grouped formats and added file sizes. It also checked whether the
artist had a photo. Once it had assembled the complete list, the endpoint applied its name filter and
sort order. Pagination was the last operation:

```python source="librarian/librarian/api/browse.py#L89-L93" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
    total = len(artists)
    start = (page - 1) * per_page
    end = start + per_page

    return {"items": artists[start:end], "total": total, "page": page, "per_page": per_page}
```

There was already a useful optimization: `_build_artists_list()` saved its result in SQLite and reused
it for five minutes. A cache hit skipped the directory walk. A cache miss still had to rebuild the
whole list, even when the browser only wanted its first page.
[Original cache and browse handler](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/api/browse.py#L18-L93).

A request arriving after the cache expired could pay for the rebuild. Keeping the cache longer would
reduce that work at the cost of a staler list. The endpoint would still filter and sort the assembled
list in Python.

The files themselves were needed for playback and repair. Counting them again was only a way to answer
a catalogue question. Storing that answer would let the application revisit the files when they changed,
then reuse the result across browse requests.

## Separating the catalogue from the files

We needed a catalogue the browser could query without opening audio files. We also needed to keep
it current while imports, tag changes and background jobs continued to modify the library. Building
the catalogue and coordinating its writers turned out to need separate changes.

### Keep a queryable model beside the files

beets is a useful comparison. Its `Item` holds track metadata; `store()`
saves it to the database, while `write()` updates the audio file's tags.
[beets Item API](https://beets.readthedocs.io/en/stable/api/generated/beets.library.Item.html).
Its library queries retrieve stored objects. It also tracks filesystem and database modification times
so an update can skip rereading files when those timestamps indicate that the metadata is synchronized.
[beets library database API](https://beets.readthedocs.io/en/stable/dev/library.html).

With that separation, browsing can use stored metadata, but something has to notice when the files
change. In Crate, we handled that with a startup sync, filesystem watcher callbacks and periodic passes.
Each browse request did less work; keeping the catalogue current became a background job.

### Keep the embedded database, change what it stores

SQLite already held our tasks, settings, scan results and caches. We could add artists, albums and
tracks using the same connection helper and startup code. Getting directory walks out of the browse
request did not require running another database service.

We already opened SQLite connections in WAL mode:

```python source="librarian/librarian/db.py#L25-L30" commit="211f715c1404f083b7812acad584d4b552d3e2bc"
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_get_db_path()), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
```

WAL allows readers to proceed while a writer works, but SQLite still permits only one writer at a time.
The ten-second connection timeout gives an operation time to wait for a lock; it does not create another
writer slot.
[SQLite WAL concurrency](https://www.sqlite.org/wal.html#concurrency),
[SQLite busy timeout](https://www.sqlite.org/c3ref/busy_timeout.html),
[Python's connection timeout](https://docs.python.org/3.13/library/sqlite3.html#sqlite3.connect).

The catalogue fit into SQLite, but adding sync gave us another writer to schedule alongside task
updates and analytics. WAL allowed reads to continue; writes still had to take turns.

### Coordinate the work in the application, or in database transactions

Our first fix for SQLite lock contention was to keep `library_sync` and `compute_analytics` from
running at the same time. If one was already running, the worker put the other back into the pending
queue. That let us keep the existing database and change how we scheduled the work.

The worker still had three execution slots. Only the two task types named in a Python set had to wait
for each other. The filesystem watcher called sync directly, outside that dispatcher, so it could
still write while a queued task was running.

PostgreSQL provides a different basis for coordinating transactions. Row locks can keep competing
writers or claimers from changing the same row while ordinary queries continue reading. For a queue,
`SKIP LOCKED` lets a consumer move past a row another consumer has locked. PostgreSQL documents this as
useful for queue-like tables; the resulting view is unsuitable when a query needs a consistent picture
of every row. [PostgreSQL 15 locking clauses](https://www.postgresql.org/docs/15/sql-select.html#SQL-FOR-UPDATE-SHARE),
[row locks](https://www.postgresql.org/docs/15/explicit-locking.html#LOCKING-ROWS).

We used `SKIP LOCKED` when we moved task claiming to PostgreSQL. The catalogue and SQL pagination
were already working in SQLite; the migration kept those tables and gave the workers a way to claim
tasks inside a database transaction.

## Building the catalogue

### Store the data the artist page needs

We added `library_artists`, `library_albums` and `library_tracks`. The artist row
contained the totals the page had previously calculated from files:

```python source="app/musicdock/db.py#L96-L106" commit="a3d670457ecd67c27afb42c8b1155d068de7a663"
            CREATE TABLE IF NOT EXISTS library_artists (
                name TEXT PRIMARY KEY,
                album_count INTEGER DEFAULT 0,
                track_count INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                formats_json TEXT DEFAULT '[]',
                primary_format TEXT,
                has_photo INTEGER DEFAULT 0,
                dir_mtime REAL,
                updated_at TEXT
            );
```

Albums had an artist relationship, an integer ID and a unique path. Tracks referred to their album and
stored tags, format, duration, size and their own unique path. Indexes covered album lookups by artist
and track lookups by album, artist, genre and year.
[Album and track schema](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/db.py#L108-L158).

These were still identities derived from the existing library layout. An artist's name was its primary
key; album and track paths had uniqueness constraints. Adding integer IDs did not, by itself, make a
file rename preserve the same record.

The artist query could now filter the stored rows and let SQL apply the ordering and page boundary:

```python source="app/musicdock/db.py#L389-L403" commit="a3d670457ecd67c27afb42c8b1155d068de7a663"
    sort_map = {
        "name": "name ASC",
        "albums": "album_count DESC",
        "tracks": "track_count DESC",
        "size": "total_size DESC",
        "updated": "updated_at DESC",
    }
    query += f" ORDER BY {sort_map.get(sort, 'name ASC')}"
    query += " LIMIT ? OFFSET ?"
    params.extend([per_page, (page - 1) * per_page])

    with get_db_ctx() as conn:
        total = conn.execute(count_query, count_params).fetchone()[0]
        rows = conn.execute(query, params).fetchall()
    return [_row_to_lib_artist(r) for r in rows], total
```

The API translated those rows into the same fields the browser already expected, including `albums`,
`tracks` and `total_size_mb`. The interface could keep requesting a page while the server changed where
its answer came from.

This query also counted matching artists. Sorting, substring searches and large offsets could require
more work than reading the returned rows. With a populated catalogue, though, we could serve the page
without rebuilding the artist list from files.

![Before, a cache miss walked the library and built a full artist list before pagination. After, synchronization prepared a SQLite catalogue and the normal browse request selected a page from it. An empty catalogue still used the filesystem fallback.](/blog/filesystem-to-indexed-catalogue/read-path.svg)

The fallback mattered during startup. `_has_library_data()` checked whether the track count was greater
than zero. If the catalogue was empty, the artists endpoint called the filesystem implementation.
That check did not mean a full sync had finished: the first indexed tracks were enough to select the
database path. Artist and album detail routes also retained fallbacks for missing rows.
[Readiness check](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/api/browse.py#L22-L23),
[artists fallback](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/api/browse.py#L202-L241).

### Keep the catalogue close to the files

The worker ran a sync at startup and then started a recursive filesystem watcher. Changes were grouped
by album directory, with a 30-second debounce timer. When a timer fired, it called the sync methods
directly:

```python source="app/musicdock/library_watcher.py#L63-L72" commit="a3d670457ecd67c27afb42c8b1155d068de7a663"
    def _sync_album(self, album_dir: Path, artist_name: str):
        with self._lock:
            self.debounce_timers.pop(str(album_dir), None)
        try:
            if album_dir.is_dir():
                log.info("Watcher: syncing album %s/%s", artist_name, album_dir.name)
                self.sync.sync_album(album_dir, artist_name)
            self.sync.sync_artist(album_dir.parent)
        except Exception:
            log.exception("Watcher: failed to sync %s/%s", artist_name, album_dir.name)
```

A periodic pass also called `full_sync()` after a 30-minute interval. Despite its name, that function
used stored directory modification times to skip artists it considered unchanged. Album sync had a
similar shortcut; file-level processing could reuse an existing row when the file's modification time
was no later than the row's `updated_at` timestamp. Changed files had their tags and audio properties
read again.
[Startup and periodic sync](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/worker.py#L86-L125),
[artist shortcut](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/library_sync.py#L44-L61),
[file reuse](https://github.com/thecrateapp/crate/blob/a3d670457ecd67c27afb42c8b1155d068de7a663/app/musicdock/library_sync.py#L182-L227).

Sync wrote album totals, upserted track rows and removed paths that had disappeared. It then rolled
album information up into artist totals. These writes used separate helper transactions, so another
request could observe the catalogue partway through an update. A browser could therefore read the new
album totals before all of its track rows had been updated.

The synchronization shortcuts also traded thoroughness for less work. An edit inside an album does
not necessarily change an ancestor directory's modification time. A debounce timer can keep being
reset by new events. Together, those details mean that 30 seconds was a scheduling choice, not a
promise that every change would be visible by then.

We also got the insertion order wrong in the first version: sync wrote albums before ensuring their
parent artist row existed. The foreign key rejected that order. We fixed it by inserting the artist
before entering the album loop. On disk, the parent directory had always been there; in the database,
we had to create the parent row ourselves.
[Parent-first insertion fix](https://github.com/thecrateapp/crate/blob/fc32578120347301d98d6e188407b046815867cc/app/musicdock/library_sync.py#L90-L101).

## Making room for concurrent writes

### Keep the heaviest tasks apart

With the catalogue in place, synchronization had become a database writer alongside task updates and
other background work. The worker's first contention fix kept three execution slots and added this
gate:

```python source="app/musicdock/worker.py#L40-L59" commit="16c7bd88a97021b32e30129ee2a84015dba3ce8e" "DB_HEAVY_TASKS"
# Tasks that do heavy DB writes — only one at a time
DB_HEAVY_TASKS = {"library_sync", "compute_analytics"}
_db_heavy_running = False
_db_heavy_lock = __import__("threading").Lock()


def _run_task(task: dict, config: dict):
    global _db_heavy_running
    task_id = task["id"]
    task_type = task["type"]
    params = task.get("params", {})
    is_db_heavy = task_type in DB_HEAVY_TASKS

    if is_db_heavy:
        with _db_heavy_lock:
            if _db_heavy_running:
                # Re-queue: another DB-heavy task is running
                update_task(task_id, status="pending", progress="Waiting for DB-heavy task to finish")
                return
            _db_heavy_running = True
```

A second heavy task was marked pending and returned without calling its handler. The first task
cleared the flag in a `finally` block. Other task types could continue running.

The flag and lock belonged to one Python process. They did not coordinate another worker process, and
they did not cover the direct watcher calls shown above. Even putting a task back into the queue
required a database write. The gate prevented the two named handlers from overlapping within that
process, but other writers could still compete for the database.

Grouping analytics and sync together also held up library sync. We removed `compute_analytics` from
the set, leaving only `library_sync`. We were now tuning which jobs were allowed to overlap, while
some writers still bypassed the gate entirely.
[Gate revision](https://github.com/thecrateapp/crate/commit/3aaa4f5178b6f51016b9f2afc51db0a7ec3da1aa).

### Claim a task while its row is locked

We replaced the SQLite connections with a threaded PostgreSQL connection pool and added a
`postgres:15-alpine` service. Each process could create a pool with two initial connections and a maximum
of ten. A retry loop handled pool creation while the database became available.
[Pool setup](https://github.com/thecrateapp/crate/blob/93764ac35ce2e39b5cd05393647da8409342d207/app/musicdock/db.py#L24-L38).

The database helper made a transaction boundary explicit:

```python source="app/musicdock/db.py#L47-L61" commit="93764ac35ce2e39b5cd05393647da8409342d207" "conn.commit()" "conn.rollback()"
@contextmanager
def get_db_ctx():
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        pool.putconn(conn)
```

The `yield` hands the cursor to the caller. On normal return, the helper commits. An exception rolls
the transaction back, and the connection goes back into the pool. The task claim used that boundary to
keep selection and status change together:

```python source="app/musicdock/db.py#L246-L259" commit="93764ac35ce2e39b5cd05393647da8409342d207"
def claim_next_task() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
        row = cur.fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "UPDATE tasks SET status = 'running', updated_at = %s WHERE id = %s AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None
```

Suppose two consumers attempt to claim work at the same time. Consumer A selects a pending task and
locks its row. While that transaction remains open, consumer B can skip the locked row and select
another pending task. Each consumer updates its selected task to `running` before committing.

![Two consumers claim different pending tasks. Consumer A locks task 1. Consumer B skips that locked row and claims task 2. Each marks its task running and commits, releasing the row lock before its handler executes.](/blog/filesystem-to-indexed-catalogue/task-claim.svg)

The lock lasts only through the claim transaction. Once the function returns, task execution proceeds
with a persisted `running` status, rather than a row lock held for the duration of the job. A worker
can still fail after claiming or after making some of its changes. Recovery and safe replay remain
handler concerns; this query does not provide exactly-once side effects.

We kept the process-local gate for `library_sync` after the migration. PostgreSQL did not remove the
need to schedule expensive work. Conflicting transactions could still wait, and a whole library scan
still consisted of multiple transactions.

## Before and after

| Concern           | Filesystem browsing                                       | With the indexed catalogue and PostgreSQL                           |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Artist page       | Build or load a full list, then filter, sort and slice it | Query stored artist rows with SQL pagination                       |
| Counts and sizes  | Count files during a cold list rebuild                    | Read totals maintained by synchronization                          |
| Freshness         | Reuse the artist list for five minutes                    | Refresh through startup sync, watcher events and periodic passes   |
| Empty catalogue   | No separate library catalogue                             | Fall back to the filesystem until track rows exist                 |
| Concurrent writes | SQLite WAL, a ten-second wait and later a local task gate | PostgreSQL transactions, with some application scheduling retained |
| Task claiming     | Select pending work and change its status                 | Lock an available pending row, mark it running and commit          |
| Operations        | An embedded database file                                 | A database service, persistent storage and connection pools        |

With the [catalogue in place](https://github.com/thecrateapp/crate/commit/a3d670457ecd67c27afb42c8b1155d068de7a663),
opening the artist page no longer required rebuilding the library's inventory from files. It read
counts that sync had already calculated. PostgreSQL then let task consumers claim different rows
without competing for a single SQLite writer.

We still identified artists by name and files by path. The catalogue could lag behind the files, and
a request could arrive partway through sync. Some routes still touched the filesystem or calculated
aggregates during a request.

Those were the costs of keeping a second representation of the library. We had made it queryable,
but a rename could still look like a deletion followed by a new file. Keeping that file's identity,
and recognizing work already done on it, would need more than a unique path in a table.

_The code links show the versions discussed here. The references below cover Crate's current storage
and data layer._
