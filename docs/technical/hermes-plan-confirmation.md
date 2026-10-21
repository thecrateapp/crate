---
title: Native Telegram plan confirmation
summary: Exact human button review, deterministic job admission and the opt-in Hermes write profile.
section: operations
audience: [operator, developer]
status: canonical
order: 126
verified: 2026-10-21
sources:
  - app/crate/agent_telegram.py
  - app/crate/api/agent_telegram.py
  - app/crate/db/repositories/agent_telegram.py
  - app/crate/db/repositories/agent_human_sessions.py
  - app/crate/db/repositories/agent_plans.py
  - app/crate/db/repositories/agent_requests.py
  - app/crate/db/migrations/versions/133_agent_telegram.py
  - deploy/hermes/plugins/crate_confirmation/__init__.py
  - deploy/hermes/config.operator.json
  - deploy/hermes/runtime.py
  - app/tests/test_agent_telegram.py
  - app/tests/test_hermes_confirmation.py
---

# Native Telegram plan confirmation

The default `config.json` remains the twelve-tool read-only pilot. The explicit
`CRATE_HERMES_PROFILE=operator` profile adds reviewed prepare/apply tools and a
presentation request. It never supplies a human decision tool to the model.
Native Telegram buttons provide independent approval without a second Admin review.
The Admin plan detail/approve/reject pages remain available as a fallback.

## Operator workflow

1. Prepare the bounded operation using its existing MCP tool. Inspect the returned
   job until preparation completes, then read its complete immutable `get_plan`.
2. Call `request_plan_confirmation` with the exact `plan_id`, `plan_version` and
   `apply_after_approval: true` when the requested human decision should also admit
   the operation. This call only creates presentation bookkeeping.
3. The native presenter sends the entire exact plan as plain JSON pages, including
   every target, change, cost/impact, precondition, version/hash, policy and expiry.
   `Siguiente` presents the next page. The backend permits `Aprobar` only after all
   pages have durable delivery receipts. `Rechazar` is available on every page.
   Invisible formatting characters are escaped losslessly; titles cannot inject
   Telegram markup. Long strings can span pages, but no target is truncated.
4. The human presses the button from the bound private Telegram account. The same
   transaction consumes the native update/query identity, rechecks the linked
   user's current role/domain/review/approval permissions, records the decision,
   and admits the exact operation with `telegram:<confirmation-id>` as its stable
   idempotency key. The originating integration and credential cannot be replaced.
   No further free-text message or model invocation is needed.
5. The bot reports the decision and admitted job ID in the same chat. Use `get_job`
   and `get_plan` to inspect execution, verification and downstream completion.
   A queued job is not evidence of an applied or verified effect. Reconcile uncertain
   results; never create a new key to replay a possibly completed effect. Request
   cancellation through `preview_job_cancel`, review it, and apply that exact plan.

When `apply_after_approval` is false the human decision only authorizes the plan;
apply its exact version using the normal operation tool and a stable key. If the
originating credential is revoked or expired before the human button, approval can
be recorded as `approved_apply_unavailable`, with a reason and no admitted job.
Changed plan content, policy or human authority invalidates the decision. Worker
checkpoints also recheck the Telegram binding and linked human capabilities.

Acquisition transfer and library publication require separate plans and separate
human approvals. A transfer approval never authorizes publication or overwrite.
Plain text such as “yes” cannot approve anything. Old buttons, another user/chat,
service bearer credentials and forged callbacks cannot approve either.

## One-time identity and managed profile

Provision a binding from an authenticated Admin browser session using
`POST /api/admin/agent-telegram/bind`, a configured same-origin header, and JSON
`{"principal_id":"<integration UUID>","telegram_user_id":123456}`. The authenticated
human needs integration management, plan review and approval permissions. The
binding links that human account; it cannot name a different Crate user. Rebinding
revokes the previous binding, including its unused approvals. `CRATE_AGENT_INSTANCE_ID`
on the API must match the native instance identity.

The controlled native plugin reads `/run/crate-hermes-native/identity.json` with
`instance_id` and an `allowed_users` array of positive numeric Telegram IDs, plus
its separate `/run/crate-hermes-native/callback-key`. The API reads the same signing
key through `CRATE_TELEGRAM_KEY_FILE` (default
`/run/crate-telegram-secrets/callback-key`). Key contents must never be exported into
managed environment variables, model configuration, context, logs or MCP child
processes. Only trusted native code reads the dedicated secret file.

Install the versioned `deploy/hermes/plugins/crate_confirmation` directory in the
dedicated Hermes home plugin directory. The operator profile enables
`crate-confirmation` via the pinned public plugin API. The plugin registers a
narrow `ct:d:<nonce>:<action>` callback handler on the existing PTB application;
it does not create another Telegram poller, webhook or core patch.

The write profile validates `get_confirmation_policy`, current `require_approval`,
actions-enabled state, instance/principal/credential identity, grants and tool
annotations. Its optional startup uses a distinct `supervisor-token` in the
managed secret directory to verify that the supervisor's discovery remains purely
read-only. That token is never added to the model environment. The read-only pilot
startup is unchanged. If operator validation or API availability fails, the
operator config omits the domain MCP server, allowing independent native recovery
providers to remain available. Revalidate and restart to restore domain exposure.

Only the controlled Crate MCP server uses `trust: full`. The pinned Hermes v0.22.2
client otherwise adds a generic per-tool consent prompt for `trust: untrusted`.
The deliberate setting avoids an unrelated second prompt; server grants, exact
human approval, idempotency and worker checks remain authoritative. Other servers'
trust is unchanged. The explicit operator Telegram profile preserves queued
updates on cold boot; durable expiry/replay checks reject stale buttons.

## Transport, delivery and limits

The fixed native transport is
`http://crate-api:8585/api/internal/agent-telegram/events`; redirects and environment
HTTP proxies are refused. HMAC-SHA256 covers `POST`, the exact path, timestamp,
transport nonce and exact request bytes, separated by newlines. Requests require
a timestamp within 60 seconds, a fresh 32-character hex nonce and a body at most
16 KiB. Native callback identity comes only from PTB `Update` and `CallbackQuery`.
The backend persists consumed Telegram update and query IDs across restarts.

Confirmation validity is the earlier of plan expiry or 15 minutes. Each plan has
one immutable confirmation, originating credential and apply choice. The full
presentation is bounded to 180,000 UTF-8 bytes, split on character boundaries into
pages of at most 3,200 bytes. Oversized plans must be narrowed before confirmation.
Page and terminal-result delivery retry at most twenty times with a ten-second
backoff. A transport timeout can duplicate a page/result message, but cannot admit
a second job. Stable confirmation/job IDs identify duplicates. Exhausted delivery
requires inspecting the persisted confirmation or using the Admin fallback.

Integration policy is checked in the admission/effect transaction. For an
approval-required integration, legacy direct `run_health_check` without explicit
scope/check types, `retry_job` and `cancel_job` are denied. Legacy photo repair
already requires exact plan approval. Queuing a legacy job while approval is false
and enabling it before the worker effect cannot bypass review. Explicitly
non-approval legacy integrations retain their old behavior.

## Integration boundary

`NativePresenter(ctx, providers)` accepts fixed, trusted providers with separate
callback prefixes, patterns, allowlists and `async event(payload)` transports.
Each provider runs in its own supervised task. A replacement PTB application
cancels the previous generation, and plugin unload cancels all presenter tasks.
An independent infrastructure provider can use its own transport and approval
store without depending on the domain API. Release/context provenance binding,
independent supervisor delivery, deployment mounts and real pinned gateway smoke
belong to the integrated runtime acceptance; this component alone does not claim
those are wired or production-tested.

The model obtains this guide through the existing bounded release-context tools.
No arbitrary filesystem, shell, skill installation, signing or approval tool is
required. Local synthetic transaction and SDK-stub tests do not certify live
Telegram delivery, a model conversation or a production rollout.
