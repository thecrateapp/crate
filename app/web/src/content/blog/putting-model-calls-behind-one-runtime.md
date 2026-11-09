---
title: "Putting model calls behind one runtime"
description: "Crate gave model calls pinned action profiles, conservative usage reservations and separate worker queues for interactive and batch inference."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 28
related: [opening-crate-to-agents, lyrics-as-labels, reading-errors-without-trusting-them]
tags: [How to dismantle Spotify, AI, workers, PostgreSQL, history]
sources:
  - app/crate/ai/runtime.py
  - app/crate/ai/configuration.py
  - app/crate/ai/consumers.py
  - app/crate/ai/transport.py
  - app/crate/ai/queues.py
  - app/crate/ai/requeue.py
  - app/crate/ai/guard.py
  - app/crate/db/repositories/ai_usage.py
  - app/tests/test_ai_runtime.py
  - app/tests/test_ai_consumer_authority.py
  - app/tests/test_ai_architecture.py
  - docs/technical/ai-agents.md
---

_Part 28. Per-action configuration in October, followed by dedicated inference queues in November 2026._

Crate's first language-model wrapper resolved a model from a shared database setting, environment
configuration or a default. That was enough for a small number of calls. As we added poster
extraction, biographies, genre proposals and playlist descriptions, “which model is configured?”
stopped being a sufficient answer.
[The earlier provider wrapper](https://github.com/thecrateapp/crate/blob/a5bb9ce8029cb161208d3119e4d53b874e01022f/app/crate/llm/provider.py#L1-L92).

A poster needs image support. A Music Path refinement has a short time budget. A taxonomy batch can
run for much longer and should not occupy the threads handling one-off proposals. Changing a shared
setting also raises a queueing problem: a job accepted under one configuration may run after someone
has replaced it.

We introduced a common runtime around those calls. It identifies the action, resolves an exact model
profile, admits the work against shared limits and records what the provider reported. The domain
code still owns its prompt, result validation and any later application of the proposal.
[The pinned runtime](https://github.com/thecrateapp/crate/commit/af03f5fb3028bc5298e0b984e9952ca32fa4fe6a).

## Choose a model for the action, not for the whole server

The existing wrapper used LiteLLM and Instructor, with a direct Ollama path. A library such as
[LiteLLM](https://docs.litellm.ai/docs/) is useful for translating a common call shape across providers;
its wider tooling also supports routing, fallbacks and usage tracking. Crate needed additional rules
about its own users, actions, queues and accepted jobs.

Provider options also retain meaning that a generic model name cannot express. Google's documentation,
for example, distinguishes a thinking level from the token-budget control used by Gemini 2.5 models.
An omitted option, explicitly disabled reasoning and a selected level are different requests.
[Google's thinking controls](https://firebase.google.com/docs/ai-logic/thinking).

Crate's native configuration preserves those distinctions. The initial adapters covered Gemini,
DeepSeek and Ollama; a later OpenAI-compatible adapter added explicitly declared text-model
capabilities. A model appearing in a catalogue is not enough to enable every action. The server
checks input modality, structured output, context and output limits, and the advertised reasoning
controls. Unknown capabilities stay pending.
[Provider capability rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L116-L148).

This kept compatibility separate from readiness. A model can have an acceptable schema while its
server is unreachable or its account has no credit. A successful synthetic probe can establish that
one request worked; it cannot certify the quality of a biography or the date read from a poster.

### Separate the connection, profile and action

We gave configuration three distinct identities:

| Object | What it fixes |
| --- | --- |
| Provider connection | Endpoint, credential reference, provider and shared usage limits |
| Immutable profile version | One model, native options, input/output bounds and timeout |
| Action binding | The exact profile version selected for one named feature |

A feature such as `shows.extract.vision` can therefore use a different profile from
`playlists.description.generate`. Creating a profile does not bind it to a feature or send anything
to a provider. Catalogue refreshes and compatibility probes are explicit queued operations too;
opening the configuration page makes neither happen.
[Configuration objects and workflow](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L59-L114).

Migration had to preserve existing behaviour. Before explicit activation, the global selection
continues to route calls and the ledger tracks usage without imposing the new connection quotas.
Activation checks the reviewed revision and fingerprint, then snapshots inherited actions into
immutable profiles and bindings. Environment keys remain environment references. An operator can
change a feature afterwards, but a disabled action no longer silently falls back to the global model.
[Activation boundary](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L174-L188),
[disabled-action behaviour](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L265-L276).

## A queued poster extraction keeps its accepted configuration

An HTTP request validates the action and stores a small server-owned acceptance reference: action ID,
configuration fingerprint, and profile identity where present. It does not copy credentials, prompts
or private source data into generic task parameters.

The worker reconstructs that accepted configuration and checks the current actor's domain permission:

```python source="app/crate/ai/consumers.py#L42-L58" commit="560b7256f940acbdaf0a3a809d07a6cbbd0e1b87" "expected_fingerprint"
def resume_action(
    action_id: str, accepted: dict | None, *, actor_id=None, job_id=None
) -> dict:
    """Reconstruct exactly the accepted identity or fail closed for old/stale jobs."""
    if (
        not accepted
        or accepted.get("action_id") != action_id
        or not accepted.get("fingerprint")
    ):
        raise AIConfigurationError(
            "AI_CONTEXT_STALE", "Queued action requires renewed acceptance"
        )
    require_action_authority(action_id, actor_id)
    context = configuration.resolve_action(
        action_id, expected_fingerprint=accepted["fingerprint"]
    )
    return {"context": context, "actor_id": actor_id, "job_id": job_id}
```

If a binding, credential or relevant configuration changed while the task waited, the accepted
fingerprint is stale. The worker refuses the old context rather than substituting whatever model is
current. Once admitted, the call keeps its exact model, endpoint, options and loaded key in memory.
An in-flight call does not switch provider halfway through execution.

We added authority checks at the execution boundaries as well. A user who could request a proposal
may have lost that permission while it was queued, or while the provider was answering. The runtime
checks before transmission and again before returning the validated result; consumers that apply a
proposal recheck authority before the effect.
[Authority correction](https://github.com/thecrateapp/crate/commit/560b7256f940acbdaf0a3a809d07a6cbbd0e1b87),
[in-flight revocation tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_ai_consumer_authority.py#L143-L203).

Pinning is not a claim that model output is reproducible. The same accepted request can still produce
a different answer on another invocation. It gives us an exact execution identity and prevents a
configuration change from being mistaken for the same work.

## Wait for capacity before paying for a call

A shared runtime made calls consistent. It did not by itself isolate their latency. In November we
moved provider work onto two Dramatiq lanes consumed by `crate-worker`, each with its own pool:
`ai` for individual proposals and extractions, and `ai_bulk` for long batches.
[Dedicated lanes](https://github.com/thecrateapp/crate/commit/6fc8eb67a3a14deeda0936f5e0475849cd78983c).

The default pools use two interactive threads and one bulk thread. Connection concurrency limits
remain a separate constraint: adding worker threads does not create more provider capacity. Keeping
the pools separate stops a long taxonomy job from occupying an interactive thread, while provider
admission decides how many actual calls may run.
[Pool configuration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/ai/queues.py#L14-L34).

![An HTTP request records acceptance and queues work. Interactive and bulk pools share provider admission. Waiting before reservation can be retried; after reservation the runtime pins one call and settles known or conservative usage.](/blog/putting-model-calls-behind-one-runtime/admission-and-execution.svg)

Routes now return a task identity, or return a deterministic Music Path or transition plan while
optional refinement runs in the background. They do not hold the HTTP request open for inference.
An architecture test follows the call graph from API modules and task handlers. A runtime guard also
rejects provider calls outside an AI-lane task, covering dynamic dispatch the static check might miss.
The November guard has no allowed action exceptions.
[Architecture checks](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_ai_architecture.py#L54-L117),
[runtime guard](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/ai/guard.py#L19-L35).

### Waiting for capacity is different from repeating a paid call

A full connection should not immediately turn a valid proposal into a failure. Before any invocation
has been reserved, an interactive task can return to pending with a jittered delay of five to thirty
seconds, up to ten times. No provider request has been sent at that point.

The first implementation needed a further restriction. Requeueing restarts the whole handler, so it
is safe only before that task's first reserved call. A handler that already paid for one call must
not replay its earlier work when a later reservation is refused:

```python source="app/crate/ai/requeue.py#L182-L200" commit="a95df10762adc577f984df7cf1506ebb6b71bc3b" "reserved"
    window = _window.get()
    if window is None or window.queue != AI_BULK_QUEUE:
        try:
            reserved = reserve()
        except AIConfigurationError as error:
            if (
                error.code != AI_CONCURRENCY_CODE
                or window is None
                or window.queue != AI_QUEUE
                or window.requeues >= AI_CONCURRENCY_REQUEUE_LIMIT
                # A requeue re-runs the whole handler: only before any paid call.
                or window.state.get("reserved")
            ):
                raise
            _measure("ai.capacity.requeue", window.queue)
            raise AIConcurrencyDeferred(window.requeues + 1) from None
        if window is not None:
            window.state["reserved"] = int(window.state.get("reserved") or 0) + 1
        return reserved
```

Bulk work follows a different path. It retains the current item and waits inside the task budget,
keeping results already paid for. It yields when interactive work is pending and leaves one slot
free on a connection with more than one slot. When waiting is exhausted, the batch stops waiting for
later items and finishes with its existing results. Automatic transport retries and provider fallback
remain disabled.
[Capacity handling](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L578-L615),
[first-paid-call correction](https://github.com/thecrateapp/crate/commit/a95df10762adc577f984df7cf1506ebb6b71bc3b).

Timeouts also have to agree. A provider timeout longer than the remaining task lifetime would let
the worker disappear while its child kept running. The actor supplies a deadline thirty seconds
before the task limit, leaving time for validation and persistence. Admission and transmission both
check the remaining budget; the transport enforces it on the child process. A call with less than a
second left is refused.
[Task deadline](https://github.com/thecrateapp/crate/commit/ffd8d84b1464df37f74fd7004d82b3a0167ef3d6).

## Reserve the maximum before making the call

A daily token limit cannot be enforced reliably by adding usage only after responses arrive. Several
concurrent calls could all see room in the budget, then exceed it together. Some providers also omit
usage on errors or return incomplete counters.

Crate reserves the full configured input and output allowance before transmission. The database
serializes admission on the connection, checks concurrent calls and UTC daily totals, and creates a
durable invocation record. The initial admission checks were explicit:

```python source="app/crate/db/repositories/ai_usage.py#L161-L166" commit="af03f5fb3028bc5298e0b984e9952ca32fa4fe6a" "reserved"
        if not tracking and conn["active_invocations"] >= conn["max_concurrent"]:
            _error("AI_CONCURRENCY_LIMIT", "Connection concurrency limit reached")
        if not tracking and totals["calls"] >= conn["daily_calls"]:
            _error("AI_DAILY_CALL_LIMIT", "Daily call limit reached")
        if not tracking and totals["tokens"] + reserved > conn["daily_tokens"]:
            _error("AI_DAILY_TOKEN_LIMIT", "Daily token limit reached")
```

The `tracking` branch preserves the pre-activation behaviour described above. Once the configuration
is active, every feature using a connection shares its limits. Synthetic compatibility tests use
the same connection budget, so they cannot provide a second unmetered route to the provider.
[Reservation transaction](https://github.com/thecrateapp/crate/blob/af03f5fb3028bc5298e0b984e9952ca32fa4fe6a/app/crate/db/repositories/ai_usage.py#L132-L211).

An invocation also owns a stable idempotency key derived from its job and action, or from an item in
a batch. A duplicate claim cannot pay for the same call again. The domain may return its stored
result, but the runtime does not make another request just because a worker message was redelivered.
[Admission and replay test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_ai_runtime.py#L297-L388).

Image inputs need a bound too. Compressed byte size does not tell us how many image tokens a model
will use. Vision admission requires a supported conservative image bound or enough reservation for
the full model context. Unknown image bounds fail before transmission. Profiles can lower an
action's maxima, but cannot raise them.
[Input limits](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L307-L326).

## Settle the reservation; inspect the answer separately

After a response, known usage settles the reservation. If usage is missing or invalid, the maximum
charge remains. Releasing the concurrent slot and settling usage are idempotent operations. Later
cleanup can reclaim an abandoned slot without refunding tokens that may already have been spent.
That is deliberately conservative: an unknown provider outcome cannot safely be counted as free.
[Usage settlement](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/repositories/ai_usage.py#L215-L359),
[abandoned reservations](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/repositories/ai_usage.py#L361-L405).

The activity view keeps unknown measurements visible. Missing token counters remain null. There is
no pricing manifest in this implementation, so monetary cost remains unknown even when token usage
is known. A local model does not acquire a fabricated zero cost. Raw reasoning is discarded, and
public activity contains bounded execution metadata rather than the source or full answer.
[Metering contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L329-L340).

The integration tests exercise PostgreSQL, accepted jobs, immutable profiles, permission changes,
reservations and worker handlers with representative provider responses. They test the plumbing
without treating a model's variability as a database regression.
[Workflow validation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L673-L688).

A separate isolated lab made one actual synthetic compatibility call. It completed in 3.523 seconds,
reported 58 total tokens and settled its 6,144-token reservation to 58. Thought, cache and cost
measurements remained unknown. The lab had zero action bindings: that result validated the explicit
profile-probe path, not every feature or a production activation.
[The compatibility call](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L690-L697).

The same lab also ran a poster extraction. Vision returned 2021 where the poster said
2027. OCR followed by text extraction returned proposals with null dates because its recognized text
lacked the year. The invocation record retained the configuration and usage, including for an answer with the wrong
year. The proposals still needed human review, and no automatic retry or show
publication followed that test.
[Real extraction limits](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ai-agents.md#L699-L712).
