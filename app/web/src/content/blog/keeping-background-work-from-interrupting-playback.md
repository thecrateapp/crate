---
title: "Keeping background work from interrupting playback"
description: "Moving work into a queue did not stop it competing with playback. We split workers, removed hidden audio work from sync and taught maintenance when to wait."
date: 2026-11-10
visuals: [workers]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 12
related: [teaching-crate-to-listen, reads-from-snapshots, observing-a-home-server]
tags: [How to dismantle Spotify, workers, PostgreSQL, operations, history]
sources:
  - docs/technical/03-worker-tasks-and-background-services.md
  - app/crate/resource_governor.py
  - app/crate/actors.py
  - app/crate/analysis_daemon.py
  - app/crate/library_sync.py
  - app/tests/test_resource_governor.py
  - docker-compose.yaml
---

_Part 12. Making room for listening on a busy server, March–May 2026._

A library sync sounded like bookkeeping: find files, read tags, update rows. Ours could also launch
`fpcalc` to read the audio and calculate fingerprints. Run that alongside repair, analysis and imports,
and the background queue became another way to keep the disk busy while someone tried to listen.

By May, we had a production incident with that shape. The four-core host had high load, full swap and
high I/O wait after database migrations. API responses slowed while fingerprint subprocesses and
library work continued. Putting jobs outside HTTP requests had kept the request handlers shorter;
it had not given those jobs a different machine.
[The worker split and governor design](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/docs/plans/2026-05-04-worker-resource-governor.md#L3-L38)

When someone pressed Play, the server could already be decoding audio for analysis, walking a library
or repairing an album. Giving the next playback job a higher priority would not stop those operations.
We could keep the next maintenance task from starting, leave the next batch of analysis unclaimed and
remove fingerprint calculations from routine sync.

Playback also needed worker capacity that a repair could not occupy. Work already running still
needed to finish or reach a cooperative checkpoint; pressing Play would not immediately reclaim
its CPU, memory or disk bandwidth.

The figure below follows one listening session on a host that runs maintenance, analysis and
playback workers. Preparing the stream gets the playback slot straight away. Once a track ends and
its play event is recorded, the next repair goes back to the queue under the same task ID, and the
analysis loop stops claiming rows. Both resume after the recent play has aged out.

<div data-blog-visual="workers"></div>

## Leave the repair pending

The actor asked the resource governor for permission before marking the task running. On refusal it
recorded the reason, scheduled the same task ID after a delay and returned without calling the repair
handler:

```python source="app/crate/actors.py#L450-L457" commit="09da2273585ff35ad63451544d6672d7848c1454" "delay=max(1, resource_decision.defer_seconds) * 1000"
        update_task(task_id, progress=f"Deferred by resource governor: {resource_decision.reason}")
        actor = _actors.get(task_type)
        if actor:
            actor.send_with_options(
                args=(task_id,),
                delay=max(1, resource_decision.defer_seconds) * 1000,
            )
        return
```

The worker thread was free to handle another message after that return. The repair still had the
same task ID and a visible reason for waiting. Dramatiq's delayed message supplied the later wake-up;
it did not create a new repair or report the existing one as complete.
[Dramatiq delayed messages](https://dramatiq.io/guide.html#scheduling-messages).

For its resource checks, the governor combined load average divided by CPU count, I/O wait and swap
usage with counts of recent listening activity. Its result carried `allowed`, a readable reason, a
delay and the sampled values. The operator could inspect the cause of the pending task.

The first defaults deferred listener-sensitive work if either activity count was positive. Load,
I/O wait and swap had configurable thresholds. Full-library operations could also require a
maintenance window; the initial production configuration enabled it from 02:00–07:00 in the
container's local time.
[Initial resource checks](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/resource_governor.py#L151-L212).

A load ratio of `0.85` did not mean 85 percent CPU utilization, and the sampled I/O-wait percentage
did not measure playback latency. When load, I/O-wait or swap samples were missing, their threshold
checks were skipped.

The activity counts also needed interpretation. `active_users` counted distinct users with a play
event whose `ended_at` fell in the last five minutes; `active_streams` counted events in the last
three minutes. They were recent activity signals, not a live count of open audio connections. If
those queries failed, their wrappers returned zero.
[Activity queries](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/db/queries/management.py#L176-L203),
[activity windows and error fallback](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/resource_governor.py#L450-L465).

The analysis loop checked pressure before claiming a batch and again after the claim. If the second
check declined, it released those claims and waited. That closed one small window in which conditions
could change while it selected work.
[Analysis admission and claim release](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/analysis_daemon.py#L103-L119).

A decoder already running kept running. Long handlers needed their own checkpoints. Unlike the actor's
early return, the first `wait_while_pressured` helper slept inside the handler and occupied its worker
thread while it waited. Its optional maximum wait could return permission to continue after the
budget elapsed, even under pressure. Admission, cooperative waiting and forced interruption are
different behaviours; this implementation supplied the first two, with limits on the second.
[The first cooperative waiting helper](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/resource_governor.py#L248-L279).

## Stop doing fingerprint work inside sync

The pending repair was only one source of competition. A sync already admitted for ordinary library
work could launch fingerprint subprocesses as it found new or changed files. Calling the parent task
`library_sync` hid the cost of reading those recordings.

We removed that calculation from sync. A file could enter the catalogue with its tags, duration and
file information while its audio fingerprint remained absent. A dedicated backfill would fill that
field later, when its own admission check allowed it.
[Sync after fingerprint extraction was removed](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/library_sync.py#L490-L532).

The sync path could make a newly imported album available without first calculating its fingerprints.
A consumer that needed a fingerprint still had to handle a missing value; the file's presence in the
catalogue did not mean that every analysis job had finished.

The backfill could be bounded and governed separately. On POSIX, a wrapper added idle I/O priority
with `ionice` and lower CPU scheduling priority with `nice`, using each tool when it was available.
Without either tool, or on unsupported platforms, it ran the original command. Those settings
reduced competition after admission, while the governor decided whether to admit the work in the
first place.
[Subprocess priority wrapper](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/resource_governor.py#L231-L245).

## Playback gets its own worker capacity

Leaving maintenance pending helped only when the worker reached that admission check. Playback also
needed capacity that was not already occupied by an admitted repair. When a stream needed a prepared
variant, `prepare_stream_variant` ran on the `playback` queue at priority zero. This was a worker for
that preparation work, not a requirement to send every direct-file stream through a task.
[Playback task routing](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/actors.py#L111-L112),
[passthrough without a preparation task](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/app/crate/streaming/service.py#L141-L167).

Dramatiq supports actor priorities, but those priorities apply when a worker chooses among messages
it has consumed. They do not interrupt a running job or change the order of messages still waiting
in the broker. A high-priority playback job cannot use a thread already occupied by a long repair.
[Dramatiq message priorities](https://dramatiq.io/guide.html#prioritizing-messages).

Docker can bound a container's CPU and memory. Its default is to leave those resources unconstrained,
so merely moving a process into another container supplies no budget. Limits gave us a way to keep
one worker from consuming all the resources available to it, but the workers would still share the
host and its disks. [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

The May deployment separated four responsibilities so maintenance could have a backlog without
filling the playback worker's threads:

| Runtime | Work it consumed | What the separation bought us |
| --- | --- | --- |
| Main worker | Fast and default jobs, scheduler, watcher and coordination | A place for imports and routine operations without also owning the analysis loops |
| Maintenance worker | Repair, full sync and other deferrable jobs | A bounded pool whose backlog could wait independently |
| Analysis worker | Heavy jobs and analysis/Bliss daemons | One home for CPU-intensive audio work and loaded models |
| Playback worker | Stream preparation and transcoding | Worker capacity that maintenance could not occupy |

The main worker started with `--no-daemons`. Maintenance and playback disabled the service loop,
daemons, projector and the then-existing Telegram loop. Analysis kept its daemons but disabled the
other service loops. Adding containers without those flags would have risked duplicating schedulers
or watchers along with the intended worker capacity.
[The worker split in Compose](https://github.com/thecrateapp/crate/blob/09da2273585ff35ad63451544d6672d7848c1454/docker-compose.yaml#L289-L455).

We also reduced each pool's database connections. Giving every new container the old limits would
have multiplied the possible connection count, including connections those pools could retain while
idle. Analysis and playback each used a SQLAlchemy pool size of one with one overflow
connection. The main worker had a larger allowance. These were configured bounds, not measurements
of how many connections a particular workload would use.

![Four worker lanes separate general work, maintenance, audio analysis and playback. Maintenance and analysis check load and listening activity before proceeding; a deferred task keeps its ID and returns later. All lanes still share the host.](/blog/keeping-background-work-from-interrupting-playback/worker-admission.svg)

[Open the worker and admission diagram at full size](/blog/keeping-background-work-from-interrupting-playback/worker-admission.svg).

Those were separate consumers on the same host. The split did not reserve disk bandwidth for a
stream, and a memory limit could still result in a process being killed. Limiting the workers also
meant accounting for the models and database connections they kept between jobs.

### Reuse the model between tracks

Audio analysis had already exposed that cost in March. The
[analysis chapter](/blog/teaching-crate-to-listen) introduced signal features, model predictions and
Bliss vectors. With task-based analysis, each worker process using PANNs could load its own model.
Raising concurrency increased both active calculations and the model copies resident in memory.

At the end of March we gave analysis and Bliss their own long-lived loops inside the worker runtime.
The analysis loop processed one track at a time and reused the loaded Python model. The Bliss loop
called the Rust executable for its next track. Imports stopped running those operations inline;
a reanalysis task could mark tracks pending and let the loops collect them.
[Initial daemon integration](https://github.com/thecrateapp/crate/commit/13bc989f4949d2048d9df928ad597ef4a70462ef).

There was no need to create a visible task for every track. Each track had separate `analysis_state`
and `bliss_state` fields. The loop claimed a pending row and changed its state in one SQL statement:

```python source="app/crate/analysis_daemon.py#L34-L48" commit="13bc989f4949d2048d9df928ad597ef4a70462ef" "FOR UPDATE SKIP LOCKED"
    with get_db_ctx() as cur:
        cur.execute(f"""
            UPDATE library_tracks
            SET {state_column} = 'analyzing'
            WHERE id = (
                SELECT id FROM library_tracks
                WHERE {state_column} = 'pending' AND path IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, path, title, artist, album
        """)
        row = cur.fetchone()
        return dict(row) if row else None
```

`FOR UPDATE SKIP LOCKED` let another claimant pass over a row already being claimed. PostgreSQL
specifically describes this as useful for multiple consumers of a queue-like table, while warning
that it is not a consistent general-purpose view of the data. Here, finding some unclaimed work
was exactly the operation we needed.
[PostgreSQL row-locking behaviour](https://www.postgresql.org/docs/15/sql-select.html#SQL-FOR-UPDATE-SHARE).

After the claim transaction committed, analysis happened outside it. The row stayed `analyzing`
until the loop saved a result or marked failure. We did not hold a database row lock while decoding
a song. There was still an application-level claim to recover if the process died.

The initial recovery reset every `analyzing` row to `pending` at startup. Despite the helper's name,
it did not check a timestamp or identify a claim owner. That was a limited recovery scheme: starting
another copy while a daemon was still working could make active work eligible again. The SQL claim
prevented two simultaneous claim statements selecting one pending row; it did not make startup
recovery safe for arbitrary numbers of daemons.
[Startup recovery](https://github.com/thecrateapp/crate/blob/13bc989f4949d2048d9df928ad597ef4a70462ef/app/crate/analysis_daemon.py#L67-L75).

By May the loops claimed small batches. The admission checks described earlier ran around those
claims: before choosing work and again before starting it. Reusing the model reduced repeated loading;
pausing admission limited new calculations. The loaded process still occupied memory while it waited.

The [snapshot read path](/blog/reads-from-snapshots) tackled another part of the same problem by
removing repeated aggregation from ordinary requests. Keeping the UI responsive needed both sides:
less work on each read, and fewer background jobs competing with those reads at the wrong time.

## The gate also has to let work through

An idle worker was not always a sign that the policy had made the right choice. A small action someone
had just requested could be deferred with a full-library batch. Repairing one album and repairing
the entire collection might use the same task type, but they had different scopes.

We added an explicit set of task types that could bypass resource pressure when narrowly scoped.
A manually requested health check had its own allowance. Fingerprint work needed both a concrete
scope and a batch limit no larger than the configured threshold:

```python source="app/crate/resource_governor.py#L342-L350" commit="078658130de159f963c8e8a6022c12babeda9036" "limit <= threshold"
    if task_type in MANUAL_RESOURCE_BYPASS_TASK_TYPES and _has_manual_trigger(params):
        return True
    if task_type not in SCOPED_RESOURCE_BYPASS_TASK_TYPES:
        return False
    if task_type == "backfill_track_audio_fingerprints":
        limit = _coerce_int(params.get("limit"), DEFAULT_FINGERPRINT_WINDOW_LIMIT + 1)
        threshold = _int_setting("CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT", DEFAULT_FINGERPRINT_WINDOW_LIMIT)
        return _has_specific_scope(params) and limit <= threshold
    return _has_specific_scope(params)
```

A manual flag was not a universal exemption. The ordinary allowance depended on the task type,
and the maintenance-window check ran before this pressure bypass. There were explicit override
parameters as well; those were escape hatches, not evidence that all work was always governed.
The distinction let an album-specific action proceed without letting every scheduled scan declare
itself interactive.

Swap exposed another problem with the original decision. A high percentage of a small swap area
could remain occupied while plenty of RAM was available. Deferring on the percentage alone could
keep maintenance paused after the pressure that caused the swap use had passed.

We retained the percentage threshold, then required a meaningful amount of swapped memory or low
available RAM. The new defaults were 512 MiB and 15 percent available memory. If the extra samples
were unavailable, the helper conservatively preserved the original swap decision:

```python source="app/crate/resource_governor.py#L270-L275" commit="1cc547459ea592c8fe13ee7d706a20415829af45" "swap_used_mb"
    if snapshot.swap_used_mb is None or snapshot.memory_available_percent is None:
        return True
    return (
        snapshot.swap_used_mb >= min_swap_used_mb
        or snapshot.memory_available_percent < min_memory_available
    )
```

The accompanying tests supplied snapshots for stale, low-volume swap with plentiful RAM and for
swap with tight memory. Other tests covered a scoped import under high load, an unscoped health
check that still deferred, and fingerprint batches on either side of the scope limit. They exercised
which jobs the policy admitted, without measuring playback latency or audible dropouts.
[Governor regression tests](https://github.com/thecrateapp/crate/blob/1cc547459ea592c8fe13ee7d706a20415829af45/app/tests/test_resource_governor.py#L62-L205).

With a small amount of old swap and enough available RAM, the next attempt no longer had to wait
because of swap alone. Recent listening activity, high load or a closed maintenance window could
still keep a repair pending with the same ID and a reason in its progress field. Once the remaining
checks passed, it could start without waiting for those old swapped-out pages to return to RAM.
