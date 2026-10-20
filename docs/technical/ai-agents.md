---
title: AI agents configuration
summary: Action routing, validated native model profiles, private credentials and bounded usage in Crate.
section: operations
audience: [developer, operator]
status: canonical
order: 95
verified: 2026-10-19
sources:
  - app/crate/ai/actions.py
  - app/crate/ai/capabilities.py
  - app/crate/ai/configuration.py
  - app/crate/ai/default_model.py
  - app/crate/ai/discovery.py
  - app/crate/ai/runtime.py
  - app/crate/ai/transport.py
  - app/crate/ai/operations.py
  - app/crate/music_paths_refinement.py
  - app/crate/credentials.py
  - app/crate/api/ai_agents.py
  - app/crate/db/repositories/ai_configuration.py
  - app/crate/db/repositories/ai_usage.py
  - app/crate/db/repositories/show_extraction_jobs.py
  - app/crate/db/migrations/versions/130_ai_default_model.py
  - app/crate/worker_handlers/ai_configuration.py
  - app/tests/test_ai_workflow.py
  - app/tests/test_ai_model_assignment.py
  - docker-compose.yaml
  - docker-compose.dev.yaml
  - docker-compose.home.yaml
---

# AI agents configuration

Crate routes its eleven registered language model actions through explicit provider
connections and immutable model profile versions. Admin exposes the configuration
at `/ai` (**AI models**), with Default model, Features, Providers, Advanced and
Activity panels; `/ai-agents` redirects to it. Domain buttons check their own action
availability and permission. A configured biography action does not imply that show
vision, OCR text or playlist descriptions are available.

A **connection** owns a supported provider, endpoint, credential reference and usage
limits. Its cached **model catalog** supplies validated capabilities. A **profile
version** selects one catalog model with native reasoning, image detail and request
bounds. An **action binding** selects that exact version. Saving a profile creates
no binding and sends no domain source to a provider.

The model and reasoning of an external MCP client are managed by that client.
Crate's [MCP integrations](11-crate-mcp.md) retain their own grants, approval and
finite dispatch contracts. Tesseract OCR, PANNs, Essentia/librosa, Bliss, deterministic
playlist generation, web research and enrichment services retain separate engines,
credentials and usage. Their presence in the related-engine inventory does not
establish live readiness or a known version.

## Configure and review

1. Create a connection, or inspect read-only metadata for an inherited environment
   connection. Stored cloud credentials require a configured encryption key.
2. On Providers, explicitly refresh its catalog. Crate queues `ai_catalog_refresh`;
   reading a page, snapshot, model list or availability never discovers models or
   runs inference.
3. On Default model, choose one validated model and its advertised native reasoning.
   Its first use computes every action's derived limits and activates the whole
   configuration in one reviewed transaction; an action whose derived limits are
   incompatible with that model keeps its existing binding, or its inherited legacy
   snapshot, instead of blocking the other ten. An image feature that can keep
   neither is turned off, and the review lists it with the reason.
4. On Features, give one feature its own model when it should diverge from the
   default. This creates or reuses a profile version scoped to that single feature
   and leaves every other feature's binding untouched.
5. On Advanced, create a profile by hand or append a new immutable version with
   the expected current version, then optionally acknowledge and queue one
   synthetic compatibility test. It uses the selected profile's exact bounds and
   may be billable. Compatibility does not certify quality, remaining credit or
   suitability for every action.
6. Inspect Activity and Usage for metadata, safe errors and unknown measurements.
   Domain results remain subject to their normal preview, validation and approval.

Configuration, credential writes, tests and usage have separate human capabilities:
`ai.config.read`, `ai.config.manage`, `ai.credentials.manage`, `ai.tests.run` and
`ai.usage.read`. A test also requires configuration read access. Mutations require
a current human cookie session and an allowed Origin. These capabilities do not
add grants to an MCP integration. Domain actions retain their existing permissions;
workers recheck the current actor and accepted configuration before sending data.

The API prefix is `/api/admin/ai`. Catalog refresh and profile test endpoints return
job identities; `/jobs/{id}` returns a closed outcome without generic task parameters.
Activity is bounded and cursor paginated; usage reads persisted daily aggregates.
The snapshot bounds large collections and reports truncation. Recent action results
on the Actions view cover the recent metadata page, rather than the whole history.

## Providers and native controls

| Provider | Model validation                                                                                                                    | Reasoning and image controls                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini   | Explicit catalog plus a reviewed finite manifest: `gemini-3.8-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite` | 3.8 Flash: `low`, `medium`, `high`; no `minimal`. Gemini 2.5 uses native thinking budgets within each model's range. Disable is offered only where supported. Image detail is model specific; `ultra_high` is exposed for 3.8 Flash. |
| DeepSeek | Provider metadata must establish text input/output, structured output and token/context limits; bare model IDs remain pending       | Native `thinking` enabled/disabled and `reasoning_effort` levels only when established by catalog metadata. No guessed aliases or image support.                                                                                     |
| Ollama   | `/api/tags` followed by bounded `/api/show` inspection establishes completion/vision and context metadata                           | Exact `/api/show` `thinking.values` establishes boolean controls or named levels. A generic thinking capability or model name cannot establish them.                                                                                 |

`provider_default`, `enabled`, `disabled`, `level` and `budget` are distinct modes.
Only advertised modes are accepted. Changing models requires a new review of native
options. The server checks structured output, input modality, model context/output
bounds and action limits. A manually registered model starts pending and cannot
become a selectable adapter through client-supplied capability JSON. Unknown Gemini
models likewise remain pending until trusted compatibility evidence exists.

Gemini and DeepSeek use fixed cloud origins. Ollama requires an explicit HTTP(S)
origin; private networks are allowed, credentials in URLs are rejected, and metadata,
link-local and unsafe resolved addresses are blocked. Discovery and inference pin a
validated address with the original Host/TLS name. Ambient proxies, redirects,
transport retries and provider fallback are disabled. Discovery has a 30 second total
budget, at most 500 catalog rows and 100 Ollama inspections; an uninspected model
remains pending. Failed refreshes keep the last good catalog and expose a safe error.
Catalog compatibility is distinct from live connectivity or available credit.

## Migration and execution identity

Before explicit activation, existing global selection continues to route domain
calls. The new ledger tracks these calls without introducing connection quotas.
Supported inherited calls with missing usage contribute to `unknown_calls`;
unsupported inherited providers produce minimal `legacy_usage_unknown` receipts.
They share the global invocation idempotency namespace, with unknown usage and cost.
Unsupported inherited state is visible but cannot be chosen as a new validated adapter.

Activation compares the reviewed configuration fingerprint and revision, then
atomically snapshots all eleven inherited actions into internal immutable profiles
and bindings. It preserves native omitted options and each action's inherited
behavior. It does not copy environment API keys into the database. Prepared bindings
remain pending before activation. Activation is explicit and one-time; creating a
connection or profile does not activate it.

**Default model.** Choosing a default model (`POST /api/admin/ai/default-model`) is
the normal way to reach activation. For each of the eleven actions, Crate derives a
profile from the chosen model and requested reasoning alone, with no read of prior
configuration: an image action requires an image-capable model with a known
per-image token bound (`AI_ACTION_NEEDS_IMAGE`, `AI_IMAGE_BOUND_UNKNOWN`); output and
input tokens are clamped to the model's own limits and the action's maxima, and an
action left with fewer than 4096 usable input tokens is incompatible
(`AI_CONTEXT_TOO_SMALL`); image detail prefers `ultra_high` for
`shows.extract.vision`, then `high`, then `default`. A requested reasoning token
budget outside the model's thinking-budget range is rejected
(`AI_PROFILE_INCOMPATIBLE`); within it, the budget is clamped to each action's output
allowance and falls back to the provider default when that leaves it below the
model's minimum. An action without a derivable profile keeps its
current binding when the configuration is already active, or its validated legacy
snapshot otherwise. Before activation, an image action that can keep neither, and
fails only the image checks, is turned off instead of blocking setup: its outcome is
`turned_off`, with the model's reason (for example `AI_ACTION_NEEDS_IMAGE`) and
`enabled: false`, and it is bound switched off to its own profile on the chosen
model, derived with the same limits but validated against the model alone. A
disabled binding is validated at profile level only (enabled connection, validated
model, native options); an enabled one is always validated for its action, image
input and image token bound included, so turning that feature on through
`/bindings` or the Features switch is rejected with the action's code until it is
given a model that reads images. The legacy activation path applies the same rule.
Only an action left with no such fallback, such as one without enough context on
the chosen model, still fails the whole assignment closed with `AI_SETUP_BLOCKED`,
and activation itself stays all-or-nothing across the eleven actions. After
activation nothing is turned off: incompatible features keep their current binding
(`kept_current`). Activating keeps each inherited on/off state: Music Paths
refinement stays off when the Settings switch is off, or when it runs on Ollama
without the explicit opt-in (`CRATE_ENABLE_PATH_LLM_REFINEMENT=1`, an
`ollama/` `LLM_PROVIDER` or a stored model setting). The snapshot reports this as
`legacy_actions[].legacy_enabled`, and each assignment outcome carries the
feature's resulting `enabled` state.

A profile is **owned** by an action only when it is referenced by exactly one
binding and labelled for that action. Assigning a model reuses or appends to an
owned profile in place, and otherwise creates a new one, so a profile an operator
created or shared across actions by hand is never renamed or rewritten by a later
default-model choice.

Assignment is idempotent: re-submitting the same connection, model and reasoning
reports every outcome as `unchanged`, writes no new profile version, advances no
binding revision and leaves the stored default untouched, since saving the default
is a compare-and-swap keyed on actually differing from the current value. A stale
`expected_revision` or `expected_review_fingerprint`, caught either in the pre-check
or under the row lock, is rejected without any write.

| Code                        | Status | When                                                                                                                |
| --------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------- |
| `AI_CONFIGURATION_CONFLICT` |    409 | the revision or review fingerprint differs, in the pre-check or under the lock                                      |
| `AI_CONNECTION_UNKNOWN`     |    404 | the UUID connection does not exist                                                                                  |
| `AI_ACTION_UNKNOWN`         |    404 | an unknown action on the single-feature route                                                                       |
| `AI_CONNECTION_UNAVAILABLE` |    422 | the connection is disabled                                                                                          |
| `AI_CREDENTIAL_REQUIRED`    |    422 | a cloud connection has no environment key or stored secret                                                          |
| `AI_MODEL_UNVALIDATED`      |    422 | the model is absent or pending, or an environment provider was never refreshed                                      |
| `AI_PROFILE_INCOMPATIBLE`   |    422 | the requested reasoning is not native to the model                                                                  |
| `AI_MODEL_INCOMPATIBLE`     |    422 | the model can run none of the target actions                                                                        |
| `AI_SETUP_BLOCKED`          |    422 | before activation, an action can keep neither the new model nor its legacy snapshot, nor be turned off on the model |
| `AI_CONFIGURATION_INVALID`  |    422 | a single-feature assignment is attempted before activation                                                          |

After activation, connection admission limits apply. Legacy snapshots remain scoped
to their original action and cannot be edited or reused as arbitrary profiles.
Applying a different profile is another explicit operation. A disabled action fails
closed; it does not fall back to the global model.

Queued consumers store a bounded server-owned acceptance reference. Configuration,
credential or binding changes invalidate pending contexts. Execution pins the exact
accepted model, endpoint, profile version and key; an in-flight call never switches
silently to a replacement. A stable job/action identity prevents redelivery from
paying twice. Show imports derive human attribution only from the currently validated
owned principal. Public job results remain compact; raw sources and private drafts
are readable only through their owned domain routes.

## Limits and metering

| Action                           | Input           | Maximum seconds | Maximum output tokens |
| -------------------------------- | --------------- | --------------: | --------------------: |
| `shows.extract.vision`           | image           |              90 |                 16000 |
| `shows.extract.text`             | text            |              45 |                 16000 |
| `shows.extract.ocr_text`         | OCR text        |              45 |                 16000 |
| `artwork.hero.analyze`           | image           |              90 |                  4096 |
| `artists.bio.research`           | researched text |              90 |                  8192 |
| `genres.description.generate`    | text            |              60 |                  4096 |
| `genres.taxonomy.propose`        | text            |              90 |                  8192 |
| `genres.eq.propose`              | text            |              45 |                  2048 |
| `playlists.description.generate` | text            |              45 |                  2048 |
| `music_paths.refine`             | text            |               8 |                  4096 |
| `i18n.listen.draft`              | text            |              90 |                 16000 |

Profiles may lower these maxima; they cannot raise them. Input profiles are bounded
by the model context and 131072 tokens. Vision admission requires a conservative
image bound or a sufficient complete model-context reservation; unknown image bounds
fail closed. Binding an enabled image action to such a profile is rejected up front
with `AI_IMAGE_BOUND_UNKNOWN` (422), or with `AI_ACTION_NEEDS_IMAGE` (422) when its
model does not read images, and catalog models and snapshot profile versions
report `image_token_bound` so the UI offers only admissible models and profiles. Show image composition remains capped at 20 megapixels, 200 proposals
and 50 selected shows. Each assisted extraction makes one model call. Local OCR and
manual entry stay available independently, and extraction never publishes a show.

Connections default to two concurrent invocations, 1000 daily calls and 1000000 daily
tokens. Configurable ranges are 1–8 concurrent, 1–100000 calls and 1–1000000000 tokens.
UTC daily budgets reserve the full input plus output allowance before transmission.
Known usage settles the reservation; missing usage keeps the conservative charge.
Concurrency is released exactly once. Pruning activity or reconciling stale work does
not refund daily usage. Synthetic tests share these connection budgets as a separate
invocation kind with no domain action ID; they are not a twelfth action.

Activity contains actor/job, provider/model/profile identity, status, duration, safe
errors and input/output/thought/cache/total/reserved/charged tokens. Input includes
cached input as a subset, so cached input must not be added again. Output excludes
separately reported thought tokens; Ollama's aggregate output includes thoughts when
no separate counter exists. Missing counters stay null. The current implementation
has no pricing manifest: estimated cost is **unknown**, including when tokens are
known. A local provider does not imply a fabricated zero cost.

Music Paths caches retain profile/model/prompt/schema provenance with the route
content. A configuration change invalidates reuse under another identity. Existing
domain provenance, show source manifests and owned biography evidence remain private;
raw provider reasoning is discarded and never enters public activity or logs.

## Credential storage and rotation

New stored AI secrets require an explicit valid Fernet `CRATE_CREDENTIAL_KEY`.
An empty or malformed value blocks storage instead of falling back to JWT-derived
encryption. Keys are write-only in Admin, stored in the existing scoped vault, and
never returned in snapshots, catalog responses, jobs or audit metadata. Environment
connections expose metadata separately and do not make their keys editable in Admin.

Generate a key with the installed backend environment, store it in your secret
manager, and provide the same value to API and all inference workers:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

The production, development and home Compose files forward `CRATE_CREDENTIAL_KEY`
and `CRATE_CREDENTIAL_PREVIOUS_KEYS` to API, default/fast/maintenance workers and the
analysis worker. `.env.example` leaves both empty. No usable key is generated by
Compose. Projector, playback, read plane, media worker and frontends do not receive
this ring. Other custom stacks must explicitly forward the same two variables to
all processes that write or load AI credentials.

Encryption-key rotation and provider-key replacement are separate operations:

1. Back up the vault and retain the old encryption key securely. Distribute a new
   current key together with old keys in `CRATE_CREDENTIAL_PREVIOUS_KEYS` (comma or
   whitespace separated). Restart credential consumers consistently through the
   normal deployment process. Mixed key rings cannot read each other's new writes.
2. In a controlled backend maintenance context, use
   `crate.credentials.rewrap_secrets(limit=100, after_ref=...)` and follow its
   returned `next_cursor` until complete. Each batch is transactional, capped at
   500 rows, and makes no provider call. There is no dedicated rotation CLI or UI.
3. Verify all stored credentials can be read with the current key, then retire
   previous keys according to your backup recovery policy. Older backups still
   need the keys that encrypted them. Readers also retain compatibility with
   existing environment/DB JWT-derived vault secrets; this compatibility does not
   permit weak encryption for new AI writes.

To replace or revoke a **provider API key**, use the connection's credential write
with its expected revision. Replacement revokes the old vault reference atomically;
revocation makes pending contexts stale. It does not rewrite historical invocation
rows. Keep encryption keys recoverable separately from the database backup.

## Validation evidence and remaining limits

The deterministic integration suite `app/tests/test_ai_workflow.py` uses real
PostgreSQL, in-process HTTP acceptance, durable task rows, worker handlers, catalog
normalization, immutable profiles/bindings and the native runtime for Gemini,
DeepSeek and Ollama. Provider request boundaries return representative fixtures;
OCR uses fixed recognized text and task dispatch does not require a live broker. It
covers replay, atomic stale-batch rejection, credential and actor revocation,
connection quota rejection, native reasoning, usage and private human attribution
for all three assisted show modes. It does not measure provider quality or network
availability. Compose tests check the explicit key ring and its service scope.
The focused gate passed 21 cases: nine workflow cases, three Compose contracts and
nine existing extraction-job regressions, with no skips. The docs smoke passed
eight cases, integrity checked 45 canonical documents and the docs build passed.
Targeted Ruff and Pyright passed. The existing Testcontainers deprecation, Pyright
update notice and Vite/Node configuration/deprecation notices remain visible.

A separate isolated lab on 2026-10-19 exercised the actual Gemini catalog and one
new native profile probe: Gemini 3.8 Flash, native `low`, 45 second timeout,
4096 input/2048 output allowance. The one compatibility call succeeded in 3.523 s,
reporting 53 input/5 output/58 total tokens. The 6144 token reservation settled to
58; thought/cache/cost remained unknown. The lab remained unmigrated with zero
bindings. This proves the explicit synthetic API/worker/native path for that profile,
not the quality of every consumer.

The same day's latest real poster vision run returned **2021 instead of 2027**
(77.1 s, eleven candidates, festival date null). OCR→text returned eleven proposals
with null dates because its text lacked the year (33.17 s). The separate DICE source
correctly returned Coilguns, 2027-03-14, Wurlitzer Ballroom, Madrid, doors 21:00
(12.36 s). The prior successful vision run remains historical evidence in
[MCP acceptance](crate-mcp.md#real-poster-and-dice-acceptance--2026-10-19).
Old and integrated legacy payloads matched for the same image/prompt/options in a
deterministic comparison; no causal implementation regression was identified.
Those historical real show invocations recorded no human actor; the subsequent
attribution fix is verified by the deterministic PostgreSQL workflow tests and
does not rewrite old ledger rows. Model quality still requires manual review.
No year was hardcoded, no inferred
current year supplied, no automatic retry or real show application performed.

Functional browser checks exercised all four named tabs, catalog/native controls,
read-only related engines and unknown cost display. The user subsequently rejected
the usability and visual consistency of AI Agents, Agent Integrations and Agent Plans;
visual acceptance is pending their redesign. Branch-wide review and exact-HEAD CI
remain separate delivery gates. These focused results do not establish production
migration, capacity, public-network certification or quality for other providers.
