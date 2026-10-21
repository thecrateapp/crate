---
title: Independent deterministic operator
summary: Standalone incident state, bounded job watches, fixed delivery and an external watchdog without model dependence.
section: operations
audience: [operator, developer]
status: canonical
order: 125
verified: 2026-10-21
sources:
  [
    deploy/operator/state.py,
    deploy/operator/supervisor.py,
    deploy/operator/delivery.py,
    deploy/operator/server.py,
    deploy/operator/watchdog.py,
    deploy/operator/config.example.json,
    deploy/operator/watchdog.example.json,
    app/tests/test_operator_state.py,
    app/tests/test_operator_supervisor.py,
    app/tests/test_operator_delivery.py,
    app/tests/test_operator_server.py,
    app/tests/test_operator_watchdog.py,
    app/tests/test_operator_mcp_integration.py,
  ]
---

# Independent deterministic operator

The optional observer runs independently of Crate API, PostgreSQL, Redis and the
model. It persists incidents, events and delivery attempts in its own volume and
can report missing Crate evidence through a fixed Hermes `deliver_only` route.
An external watchdog on another host probes the observer and gateway and sends
fallback alerts directly to its own allowlisted Telegram destination.

This is a locally tested integrated candidate, not deployed acceptance.
[Operator candidate and rollout](hermes-operator-release.md) describes the opt-in
Compose, native transport, root provisioning, health and provenance contracts. The existing read-only Hermes pilot remains the default. Nothing here
changes the legacy bot or assumes a setting stops its poller. Never run a
second Telegram poller with the same bot token.

## Service and configuration

From the repository root, validate an installed configuration without network:

```bash
python -m deploy.operator.server --config /etc/crate-operator/config.json --check
python -m deploy.operator.watchdog --config /etc/crate-watchdog/config.json --check
```

Omit `--check` only after opt-in provisioning and integration review. The modules
use the Python standard library and do not load model providers. The closed
configuration parsers reject unknown fields; examples are
`deploy/operator/config.example.json` and `deploy/operator/watchdog.example.json`.
The example addresses and instance names must be replaced by reviewed targets.

The supervisor needs a dedicated MCP read credential with `ops.status.read`,
`ops.jobs.read` and, when Smart Mix observations are configured,
`library.health.read`. It has no domain-write or plan-approval credential.
The supervisor read/watch API bearer and webhook HMAC secret are distinct from
that credential and from each other. Mount secret files separately from the
model runtime. Use private networking or authenticated TLS termination for
service bearers; the integrated listener is restricted to the private Compose network. No client follows redirects
or uses environment proxy settings. Transport failures retain fixed reason
codes, never token-bearing URLs or raw remote exceptions.

Each process exclusively locks its state directory with `writer.lock`. A
transaction writes a mode-0600 temporary file, fsyncs it, atomically replaces
`state.json`, then fsyncs the directory. Directory/fsync errors latch a fatal store condition across every polling and
HTTP request thread. All subsequent reads/writes fail, HTTP reads return 503
without a heartbeat, and the main loop exits (checking the latch at least every
second while idle). Recovery requires a new writer after process restart; an
external watchdog can detect the unavailable observer. Do not run two writers or
put the observer and external watchdog on the same state directory. Preserve the
entire volume across restart. An unrelated empty state directory has a new
journal history; consumers must detect instance/store replacement operationally.

The interval is an integer from 30 to 60 seconds, 45 in the example. At most
eight distinct fixed observation calls run per cycle, with two-second HTTP
operation timeouts. Five of at most 30 watched task IDs are read each cycle in
rotation. At most 13 sequential MCP calls occur per cycle, comfortably below
the existing 60-calls-per-rolling-minute principal limit even at the 30-second
minimum interval (three boundary-inclusive cycles contain 39 calls). All 30
watches are visited every six cycles: 270 seconds at the 45-second default,
180–360 seconds over the configured range. Use a dedicated principal so other
clients do not consume its budget. The example uses two shared observations,
not one HTTP request per rule. A cycle sends at most one queued alert. Timeout bounds apply to HTTP
operations, not a promise about OS DNS resolution; the watchdog checks completed
cycle heartbeats. A production process supervisor and external watchdog are
required for hangs, disk failure and process loss.

## Evidence and deterministic rules

Rules use an exact tool, fixed arguments, a source-envelope path, and an exact
field path inside that source's `data`. Allowed observations are
`get_instance_inventory`, `get_observability_summary`, `get_pipeline_status`
(with one closed pipeline name), and no-argument `get_smart_mix_status`.
`get_job` is reserved for exact watched task IDs. These are persisted reads;
there is no refresh, repair, arbitrary HTTP, shell, Docker or SQL operation.

Each rule is correlated by `instance/subsystem/rule-id`. Thresholds and recovery
thresholds implement hysteresis; opening and recovery require configurable
consecutive samples (default two). Only distinct non-regressing producer
measurements count. Missing source checks can advance on successive poll
failures, but polling time never becomes a producer timestamp. Freshness uses
the stricter configured/source age limit. Missing, expired, future, invalidated,
malformed and out-of-order evidence cannot prove recovery.

| Kind           | Evidence and behavior                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `availability` | Missing/stale source opens after the configured count; sustained absence escalates to critical.                                                                                                                                                                                        |
| `high`         | Exact nonnegative scalar at/above `threshold`; clears at/below `clear_threshold`; optional critical threshold. Useful for persisted queue/backlog counts.                                                                                                                              |
| `low`          | Exact nonnegative scalar at/below threshold; clears at/above recovery threshold. Supports storage capacity when a valid persisted source exists.                                                                                                                                       |
| `drift`        | Exact source string differs from an explicit reviewed `expected` version. Missing provenance remains unknown.                                                                                                                                                                          |
| `progress`     | A cumulative scalar remains unchanged across producer samples while a separate required `active_field` count is positive. Idle count zero clears; a counter reset is unknown, not progress.                                                                                            |
| `stuck`        | A timestamp remains behind the source measurement time, or a bounded task sample contains running/delegated/completing tasks with old heartbeats. A previously stuck sampled task must reappear with recovery/terminal evidence; disappearing from the 24-hour sample cannot clear it. |

Task samples contain at most 20 rows. Empty samples never mean zero backlog.
A stuck task that ages out of the sample remains unresolved until affirmative
evidence is obtained; the rule does not broaden its query. Tracked task identities
remain until the full configured recovery sequence commits. If more than 20
distinct unresolved identities accumulate across valid samples, a durable
`stuck_tracking_overflow` coverage gap prevents automatic recovery. The retained
20 identities do not stand in for omitted tasks; that gap requires independent
operator reconciliation before any reviewed local state maintenance. Restart,
acknowledgement, silence, and recovery of only the visible sample do not clear it. A task's terminal
state only resolves its heartbeat-stuck condition, not downstream verification.
Source availability indicates evidence availability, not functional health.
Status `state` describes the observer heartbeat and eligible delivery queue;
`monitoring_state` describes its active incidents and rule evidence. A working
observer reporting a Crate outage does not itself constitute observer failure.
Per-subsystem unavailable signals and missing functional subsystems remain
visible in `coverage_gaps`; rule-specific validity is in `coverage`.

Current MCP sources do not prove storage integrity, live Redis/provider/streaming
health, actual deployed image identity or release/context provenance. The example
keeps missing release evidence visible. Do not configure expected versions from
image tags or fabricate storage zeroes; controlled provenance/source wiring is
still required. Generic low/drift rule support is not proof that those sources
exist. See [MCP observations](./11-crate-mcp.md) for exact source coverage.

## Incidents, read API and job watches

Incident states are `open`, `acknowledged`, and `resolved`. Severity can escalate;
escalation reopens an acknowledgement. Each incident retains the last 20 evidence
records with original source time and separate polling time. An expired silence
notifies again for an outstanding incident. A silence suppresses notification
only, including already queued messages, and retains all incident/event data.
An acknowledgement records human ownership and expires; it is not a silence.

The service bearer exposes only these bounded surfaces:

| Route                                 | Contract                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/status`                      | Completed-cycle heartbeat, rule coverage, coverage gaps, delivery degradation, active watch count and journal cursor.           |
| `GET /v1/incidents?offset=0&limit=50` | At most 100 incidents with `next_offset`; byte budget may return fewer.                                                         |
| `GET /v1/events?cursor=0&limit=50`    | At most 100 events, `next_cursor`, `oldest_cursor`, `latest_cursor`, and explicit `retention_gap`; a future cursor is rejected. |
| `GET /v1/delivery?offset=0&limit=20`  | At most 50 queue entries, IDs, state and latest eight attempt outcomes; full count/truncation and `next_offset` are explicit.   |
| `POST /v1/watch-job`                  | Closed JSON `job_id`, optional integer `ttl`; at most 30 active subscriptions, TTL at most 72 hours.                            |

Read pages are limited to approximately 50 KB of row data. Watches use task IDs
from sanitized `get_job`/`ops.jobs.read`, not owned-plan IDs. Registration means
only that the watch was accepted. Terminal and cancellation-request observations
queue notices preserving task status, execution, verification, projection and
partial-effect distinctions. Watches remain until expiry so later downstream
verification changes can be noticed. A completed task with pending projection
or unknown execution is never reported as fully verified. Missing jobs remain
unavailable. Notifications summarize sampled child count; the bounded journal
and latest watch evidence retain child statuses.

State limits are 500 retained incidents, 2,000 journal events, 1,000 outbox
entries, 30 active watches, 1,000 short-lived human receipt nonces and a 16 MiB
serialized store ceiling. Events and resolved incidents expire after 14 days;
event count limits can shorten retention. Confirmed-delivered outbox entries
also expire after 14 days. Unresolved incidents and undelivered/dead-letter
items never disappear due to age: capacity stops admission and requires local
operator maintenance. A failed state commit does not partially enqueue alerts.
Sequence numbers increase across durable restarts; retention does not reset them.

## Native human decision integration boundary

There is no model/read-bearer `ack`, `silence`, `requeue` or human boolean.
The separate `/v1/native/decision` route accepts only the trusted native HMAC receipt.
The internal integration method is:

```python
supervisor = Supervisor(
    state, instance, rules,
    human_callback_secret=dedicated_secret_bytes,  # at least 32 bytes
    allowed_operators={"telegram:12345678"},
)
supervisor.apply_signed_human_decision(receipt, signature, now)
```

The native trusted gateway must authenticate a human callback and its allowlist
before signing. Receipt keys are exactly `audience` (instance), `operator`,
`incident` (correlation key), `revision`, `action` (`ack` or `silence`), `reason`
(1–500 characters), `ttl` (1–86,400 seconds), `issued_at` (Unix seconds), and
`nonce` (16–80 ASCII letters/digits/underscore/hyphen). Sign UTF-8
`json.dumps(receipt, sort_keys=True, separators=(",", ":"), allow_nan=False)` with
HMAC-SHA256; `signature` is its lowercase hexadecimal digest. The verifier checks
the local operator allowlist, exact instance/revision, a nonfuture 120-second
issuance window, TTL, and durable replay nonce before changing state.

The dedicated callback verification secret is separate from the read/model and
delivery keys. It confers only incident acknowledgement/silence authority, never
domain or infrastructure approval authority. Constructor trust configuration is
not request data. The native plugin registers only `/crate_ack` and
`/crate_silence` commands, with incident key, revision, TTL and explicit reason.
It checks a private numeric human and signs the exact Telegram update. The server
reloads the current local operator map and rejects replay, stale revision or expiry.
Ordinary chat and model tool calls never authenticate a decision. Activation remains
separate from the locally tested integration.

## Durable fixed-route delivery

Configure Hermes v0.22.2 with a single fixed `deliver_only: true` route, fixed
Telegram destination, a `prompt` that renders `{message}`, and no dynamic
destination, agent skills, cron job or model invocation. Route configuration is
a deployment prerequisite; the observer cannot establish it by merely receiving
HTTP 200. The outbound body contains only `logical_id` and `message`.

Generic webhook V2 signs `timestamp + "." + body` with HMAC-SHA256 in
`X-Webhook-Signature-V2`, alongside `X-Webhook-Timestamp` and `X-Request-ID`.
Every message contains the stable logical alert ID. Each actual send gets a
separate transport attempt ID persisted before dispatch. This is essential:
Hermes caches `X-Request-ID` before sending, including a failed Telegram send.
Reusing that attempt ID can yield `duplicate` without delivery for an hour.

Only HTTP 200 with matching attempt ID, configured route and `status: delivered`
confirms delivery. HTTP 502 `error` is failed; HTTP 202 `accepted`/`coalesced`
and HTTP 200 `duplicate` remain explicitly uncertain. Wrong IDs/routes/statuses,
redirects, malformed/oversized responses, network failures and process crashes
during send are uncertain. Retries use fresh transport IDs with 30-second
exponential backoff capped at one hour, at most eight attempts per generation.
Unknown upstream outcome can produce duplicate messages. This is bounded
at-least-once retry, not exactly-once delivery or guaranteed ultimate delivery.

After restart, persisted `sending` attempts become uncertain and retry after
30 seconds. Dead letters remain inspectable. To requeue one after investigating
its outcome, stop the single writer and use local maintenance:

```bash
python -m deploy.operator.server --config /etc/crate-operator/config.json \
  --requeue LOGICAL_ALERT_ID
```

The logical ID and all attempt evidence remain stable; at most three explicit
requeues are permitted. There is no remote/model requeue method. Capacity or
persistent transport failure requires an operator decision, not silent deletion.

## External watchdog

Provision `deploy/operator/watchdog.example.json` on another host with its own
state volume, Telegram bot secret, exact chat allowlist and the supervisor's
read API bearer. It probes the authenticated supervisor status and gateway
`/health` with redirects disabled. HTTP 200 alone is not enough: the expected
instance, fresh heartbeat, reported status and delivery counters are checked.
A live supervisor with old pending messages, attempted failures/uncertainty or
dead letters is degraded. Intentionally silenced queue entries remain visible
but do not fabricate a delivery failure. Monitored domain incidents alone do
not trigger duplicate watchdog alerts. Two failed probes trigger an alert; persistent failure
reminds hourly, and two good probes report recovery.

Fallback goes directly to the fixed Telegram `sendMessage` endpoint without
Hermes or a model. A successful response must contain `ok: true`, a message ID
and the configured chat ID. It uses the same independent durable queue/retry
state. It cannot guarantee alerts while Telegram or the watchdog host is also
down; its own dead letters remain on disk. Configure host-level process/disk
monitoring and inspect both queues during acceptance. Gateway liveness and
reported queue health do not prove every end-to-end destination or audio path.

All checked-in tests use synthetic credentials, loopback HTTP or in-process MCP
ASGI transport. No production probe, actual Telegram/provider/model request,
legacy poller change or rollout acceptance is implied by their results.
