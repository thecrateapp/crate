# PR1A checkpoint 2: collection health and truthful consumers

2026-10-31. Worktree `/Users/diego/Code/crate-observability-integrity`, branch
`codex/observability-integrity`. Builds on [checkpoint 1](pr1a-checkpoint-1.md).
This is development work; production and the shadow overlay are unchanged.

## Behaviour

Summaries retain `count/avg/min/max/sum` and add availability, reason, source,
observation time, age, window, observed sample count and eligible count. Empty,
failed, old and partial observations remain distinct. Compatibility zeros never
certify collection health. Error rates use numerator and denominator from the
same classified request population; missing classification is partial coverage.

The first successful minute transaction stores `metrics_v2_cutover_at` in settings.
It rolls back atomically and survives minute retention. Summary `_meta` declares
schema version 2, generation time, historical availability and excluded/unverified
legacy history. Reads never migrate settings or combine legacy rollups with v2.

Process-local diagnostics require no Redis/DB access: closed cumulative counters,
last write/error times and bounded queue state. Overflow, invalid observations,
Redis failures, asynchronous failures and expired observations are counted without
recursion. The buffer validates/sanitizes before enqueueing, preserves the original
observation minute, expires after 300 seconds and survives an individual failure.
Diagnostics explicitly cover one process. Shared dashboard caches exclude them;
each response attaches the current local copy and preserves the sample's original
generation time. This does not prove that every API process or worker reports.

Worker health requires current API latency, request population, classified error
population and queue observations. Known local collection loss prevents a healthy
score. Missing evidence produces `score:null`; known breaches remain inspectable.
Snapshots retain original input times. SQL/MCP preserve these fields and validate
each input's structure, date and population. Unversioned health is unverified.
MCP keeps its existing three-state envelope: producer partial maps to outer stale,
empty to unavailable; the exact producer state remains in data. Metric diagnostics
return the latest bounded chronological samples, separating rows from events.

Maxima are named `api_max` / `API max latency`. Setting
`alert_threshold_api_max_latency_ms` takes precedence over the deprecated read-only
alias `alert_threshold_api_p95_latency_ms`. Both retain milliseconds and the 3,000 ms
default. Invalid, non-finite and negative values are ignored. Real route p95/p99
remain sampled percentiles, with retained sample count separate from observations.

## Admin review

The real System Health page displays unknown health for unavailable, empty,
partial, stale and legacy data. A local 15-second clock expires the display without
polling. Refresh failure retains charts but removes the claim of current health.
Queue depth uses its own fresh five-minute summary. Local collector state,
cumulative losses, buffer depth, source and historical cutover are visible.

[Open the standalone review](http://127.0.0.1:5186/review-observability-integrity.html).
Six selectable states use local fixtures without API requests. The same scene is
Storybook `Reviews/Observability/Collection integrity`; it uses the existing page
and shared primitives. Canonical screenshots and shared baselines are unchanged.

## Validation and limits

Tests cover availability, denominators, durable/atomic cutover, bounded buffer
losses, original timestamps, health thresholds/alias, cache isolation, response
schemas, SQL/MCP provenance, diagnostics, operator consumption and Admin freshness.
Redis/PostgreSQL test instances are disposable. Desktop/mobile preview checks
cover six states, overflow and absence of backend requests. Final counts and
review outcomes: **133 scoped backend cases**, **24 Admin cases** and **2 browser
cases** pass. Backend groups: core/replay/dimensions 95, MCP/projection 21,
storage/operator 4, existing Admin API 5 and metric diagnostics/truncation 8.
Specification and independent code-quality reviews are approved. Quality review
also caught oldest-first selection in a dense diagnostic window; the regression
now returns the latest 20 chronological minutes with current freshness.

Admin typecheck/lint, the new scene's scoped TypeScript check and the shared
showcase registry check pass. Global Storybook typecheck still finds two issues
in committed sources: removed HomeGreeting imported by HomeLibraryReview, and a
Listen stats-format alias resolving through the Admin path mapping. The new
review passes its scoped check; unrelated older stories are unchanged.

No full development suite, image publication, deployment or new notification
activation occurs here. The next cut connects incremental eight-day retention,
measures indexed window/Admin read cost and performs closing validation once
PR1A is stable. Continuous playback QoE remains in PR1B.
