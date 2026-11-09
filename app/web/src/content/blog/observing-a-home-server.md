---
title: "Observing a home server without a monitoring team"
description: "Crate watches itself with a closed metric catalogue that is always on, and an optional Prometheus stack you enable with one command."
date: 2026-11-10
tags: [observability, Prometheus, PostgreSQL, privacy]
sources:
  - app/crate/observability/metric_catalog.py
  - app/crate/observability/prometheus.py
  - app/crate/observability/live_activity.py
  - deploy/observability/compose.observability.yaml
  - docs/technical/observability.md
---

A Crate server is more than a dozen containers on one machine: the API, the read plane, several workers, the
projector, PostgreSQL, two Redis instances and a Rust media worker. We need to see how those services are behaving
when playback stalls or a queue stops moving. On a home server, the person investigating may also be the person
trying to listen to music.

Prometheus, Grafana and exporters give us detailed measurements, but they also add services to configure and run.
We keep the common health checks inside Admin, backed by a small metrics layer that is always on. For someone
who needs longer history and host-level detail, we provide an optional Prometheus stack that the installer can
enable with one command.

![The built-in layer records readings through a closed catalogue into Redis and PostgreSQL for Admin; the optional layer adds Prometheus, exporters, Grafana and Sentry.](/blog/observing-a-home-server/two-layers.svg)

## The built-in layer

We route the built-in metrics through a fixed catalogue of names. The API, the workers, the projector and the
media worker all record against it. We aggregate readings per minute in Redis and write them to PostgreSQL,
where we keep eight days. Admin's System Health page reads that history directly, so a fresh install has charts
without another monitoring service.

We define the metric names and their allowed labels in code. Each label accepts a known set of values, and we
store anything else as `other`:

```python source="app/crate/observability/metric_catalog.py#L155-L170" commit="5c5bd24c0b55072f93277cd2c9a283bcba2420be" /value = "other"/
value = str(raw_value)
if label == "target" and value == "subsonic":
    value = "opensubsonic"
if label == "method":
    value = value.upper()
elif label == "route":
    value = _PARAMETER.sub(":param", value)
elif label == "status_class" and value.isdigit():
    code = int(value)
    value = f"{code // 100}xx" if 100 <= code < 600 else "other"
if value not in fields[label]:
    value = "other"
    normalized += 1
if label in canonical and canonical[label] != value:
    canonical[label] = "other"
    normalized += 1
```

This bounds the number of series: HTTP routes, for example, are matched against a
list of 868 route templates, and a raw request path can never create a new one. It also keeps private data out. A
label cannot carry a library file path or a track title, because those are not on the list. Every value that gets
folded into `other` is counted, so a catalogue that's out of date shows up in the numbers.

We carry the state of each reading into Admin: available, partial, stale, empty or unavailable. A missing value
leaves a gap in the chart. Drawing a zero there would make a missing measurement look like an idle service.

## What it watches

The catalogue has 120 metric families. These cover the request, task and playback behavior we need to inspect:

- Requests: count, errors and latency per route, split by client (Listen on web, Android, iOS and desktop, Admin,
  OpenSubsonic apps and the read plane).
- Workers: queue depth, running and waiting tasks, task duration, and the times the resource governor holds work
  back because the host is busy.
- Streaming: latency, bytes, concurrent streams and transcodes, plus album packaging in the media worker.
- Playback quality: how long playback takes to start, stalls and their length, recoveries, and why a play failed
  (network, decode, auth, unavailable or timeout).
- AI agents: latency, response size and outcome for every MCP tool.

Playback quality comes from the apps. We restrict that payload with a schema that rejects any field it doesn't
know and carries no track, URL, token or network identifier. Listen keeps at most 96 events, sends them in batches
of 12, and the server accepts at most 120 per session.

## The Stack map only samples when someone looks

Admin draws the host live: every container, the requests reaching it and the devices playing. A live view that
runs all the time costs work on every tick. We gate the sampler on a short-lived Redis key: opening the map sets
the key with a 30-second expiry, and the sampler does nothing without it. Sampling stops when nobody is watching:

```python source="app/crate/observability/live_activity.py#L182-L193" commit="5c5bd24c0b55072f93277cd2c9a283bcba2420be" "redis.exists(WATCH_KEY)"
def publish_if_watched(sampler: ActivitySampler, *, events: int | None) -> dict | None:
    """Sample and fan out one frame, but only when an SSE client asked recently."""
    redis = sampler.redis()
    if redis is None or not redis.exists(WATCH_KEY):
        sampler.reset()
        return None
    frame = sampler.sample(events=events)
    frame["sequence"] = int(redis.incr(SEQUENCE_KEY))
    payload = json.dumps(frame, separators=(",", ":"))
    redis.set(FRAME_KEY, payload, ex=FRAME_TTL_SECONDS)
    redis.publish(CHANNEL, payload)
    return frame
```

## The optional stack

We package the optional monitoring services as a separate Compose project. The installer enables it with:

```sh title="Enable the monitoring stack on a home install"
crate observability enable
crate observability status
```

The project runs Prometheus, Grafana, exporters for the host, PostgreSQL and both Redis instances, cAdvisor for
containers and a read-only proxy to the Docker socket. We make every service read-only, drop all Linux
capabilities and set a memory cap. The combined resource limits are about 944 MiB and one CPU. Prometheus keeps
90 days or 10 GB, whichever comes first. Grafana listens on `127.0.0.1` only, and the app's metrics port, 9200, sits on an
internal network with nothing published on the host. With Prometheus running, the Stack map also shows CPU and
memory per container.

Exporting to Prometheus brings its own cardinality problem: labels that are fine in a PostgreSQL table can
multiply into too many series. We drop some labels when exporting and give each family a budget of 4,000 label
combinations. The exporter removes optional labels until the family fits:

```python source="app/crate/observability/prometheus.py#L94-L106" commit="5c5bd24c0b55072f93277cd2c9a283bcba2420be" "LABEL_BUDGET"
def _labels(definition: MetricDefinition) -> tuple[str, ...]:
    if definition.name in PER_PROCESS_GAUGES:
        return ()
    labels = {
        name: len(values)
        for name, values in definition.labels
        if name not in DROPPED_LABELS
    }
    for optional in OPTIONAL_LABELS:
        if math.prod(labels.values()) <= LABEL_BUDGET:
            break
        labels.pop(optional, None)
    return tuple(sorted(labels))
```

We only offer this installer option on Linux with the system Docker daemon. On Docker Desktop or OrbStack, host
metrics would describe Docker's virtual machine rather than the computer running it.

Sentry handles errors when configured; it stays off until you set a DSN. We send only an id for the user, keep
10% of traces and scrub sensitive keys. Request logs replace OpenSubsonic passwords, tokens and API keys with
`[Filtered]`, because those apps put credentials in the URL.

## What it doesn't do yet

We ship 13 alert rules covering API latency, playback start time, queue depth and other conditions. They are
disabled by default and meant to spend one or two weeks in shadow before paging. Federation still has little
instrumentation: 18 of its metrics have targets defined but remain unconfigured in the catalogue. Radio and
Music Paths metrics stay inside Crate; we don't export them to Prometheus.

Our only benchmark so far covers Admin's reads of the stored history. On a controlled local fixture with eight days
of data across 100 series, a cold one-hour view of Admin's metric section went from 2.6 seconds to 0.46 seconds at
p95. The measurement ran in development and excludes HTTP and serialization. We haven't measured the overhead
of recording those metrics. We also still need an external playback check: watching the internal services does not confirm
that a listener can play a song.

## Read the code

The catalogue and its label rules are in `app/crate/observability/metric_catalog.py`, the Prometheus export in
`prometheus.py` and the Stack map sampler in `live_activity.py`. The optional stack is defined in
`deploy/observability/compose.observability.yaml`.
