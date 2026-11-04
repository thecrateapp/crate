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
projector, PostgreSQL, two Redis instances and a Rust media worker. When playback stutters on a Friday night, the
person who runs it is usually also the person who wants to listen to music. There is no on-call team.

The standard answer is a monitoring stack: Prometheus, Grafana, a handful of exporters and a set of dashboards. It
works, but it's another system to run and learn, and a dashboard full of PromQL doesn't tell a home user whether
their server is fine. Crate splits observability in two. A small built-in layer is always on and answers the
common questions inside Admin. A full Prometheus stack is there for people who want it, one command away.

![The built-in layer records readings through a closed catalogue into Redis and PostgreSQL for Admin; the optional layer adds Prometheus, exporters, Grafana and Sentry.](/blog/observing-a-home-server/two-layers.svg)

## The built-in layer

Every observation in Crate goes through a fixed catalogue of metric names. The API, the workers, the projector
and the media worker record against it. Readings are added up per minute in Redis and written to PostgreSQL,
which keeps eight days. Admin's System Health page reads that history directly, so a fresh install has charts
without running anything extra.

The catalogue is closed on purpose, and so are its labels. Each label accepts a known set of values, and anything
else is stored as `other`:

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

That rule does two jobs. It keeps the number of series bounded: HTTP routes, for example, are matched against a
list of 868 route templates, and a raw request path can never create a new one. It also keeps private data out. A
label can never carry a file path or a track title, because those were never on the list. Every value that gets
folded into `other` is counted, so a catalogue that's out of date shows up in the numbers.

Admin also refuses to invent numbers. Each figure is marked available, partial, stale, empty or unavailable, and
a missing value leaves a gap in the chart instead of drawing a zero.

## What it watches

The catalogue has 120 metric families. These are the ones that answer "is my server okay?":

- Requests: count, errors and latency per route, split by client (Listen on web, Android, iOS and desktop, Admin,
  OpenSubsonic apps and the read plane).
- Workers: queue depth, running and waiting tasks, task duration, and the times the resource governor holds work
  back because the host is busy.
- Streaming: latency, bytes, concurrent streams and transcodes, plus album packaging in the media worker.
- Playback quality: how long playback takes to start, stalls and their length, recoveries, and why a play failed
  (network, decode, auth, unavailable or timeout).
- AI agents: latency, response size and outcome for every MCP tool.

Playback quality comes from the apps, so it gets the strictest rules. The telemetry schema rejects any field it
doesn't know and carries no track, URL, token or network identifier. Listen keeps at most 96 events, sends them in
batches of 12, and the server accepts at most 120 per session.

## The Stack map only samples when someone looks

Admin draws the host live: every container, the requests reaching it and the devices playing. A live view that
runs all the time costs work on every tick, so this one samples only while someone is watching. Opening the map
sets a key in Redis that expires after 30 seconds, and the sampler does nothing without it:

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

For people who want the full picture, the installer turns on a separate Compose project:

```sh title="Enable the monitoring stack on a home install"
crate observability enable
crate observability status
```

It runs Prometheus, Grafana, exporters for the host, PostgreSQL and both Redis instances, cAdvisor for containers
and a read-only proxy to the Docker socket. Every service is read-only, drops all Linux capabilities and has a
memory cap; together they come to about 944 MiB and one CPU. Prometheus keeps 90 days or 10 GB, whichever comes
first. Grafana listens on `127.0.0.1` only, and the app's metrics port, 9200, sits on an internal network with
nothing published on the host. With Prometheus running, the Stack map also shows CPU and memory per container.

Exporting to Prometheus brings its own cardinality problem: labels that are fine in a PostgreSQL table can
multiply into too many series. Crate drops some labels when exporting and gives each family a budget of 4,000
label combinations, removing optional labels until the family fits:

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

The installer only offers this on Linux with the system Docker daemon. On Docker Desktop or OrbStack, host metrics
would describe the virtual machine Docker runs in, not the computer.

Errors go to Sentry, which stays off until you set a DSN. It reduces the user to an id, keeps 10% of traces and
scrubs sensitive keys. Request logs replace OpenSubsonic passwords, tokens and API keys with `[Filtered]`,
because those apps put credentials in the URL.

## What it doesn't do yet

Alert rules exist, 13 of them, from API latency to playback start time to queue depth. They ship disabled and are
meant to run in shadow for one or two weeks before anyone gets paged. Federation is barely instrumented: 18 of its
metrics are listed in the catalogue as not configured yet, even though its targets are written down. Radio and
Music Paths metrics stay inside Crate and aren't exported to Prometheus.

The one benchmark so far measured how fast Admin reads the stored history. On eight days of 100 series, a cold
one-hour view went from 2.6 seconds to 0.46 seconds at p95. What it costs to record the metrics in the first
place hasn't been measured. And none of this proves that a listener can actually play a song; an external check
for that is still missing.

## Read the code

The catalogue and its label rules are in `app/crate/observability/metric_catalog.py`, the Prometheus export in
`prometheus.py` and the Stack map sampler in `live_activity.py`. The optional stack is defined in
`deploy/observability/compose.observability.yaml`.
