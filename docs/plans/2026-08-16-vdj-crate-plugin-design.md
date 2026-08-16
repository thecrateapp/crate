# Crate VirtualDJ Integration — Design A+B+C

Date: 2026-08-16

Status: Validated proposal

This document supersedes the implementation scope in the older VirtualDJ
documents. It keeps the useful architecture, adopts the accepted A+B+C scope,
removes Rekordbox completely, and defines independent versioning for Crate and
the plugin.

## 1. Decision summary

Crate will ship a native VirtualDJ integration in the existing monorepo.

- A — Online Source: browse and search the local Crate catalog and load tracks
  into VirtualDJ decks.
- B — Smart Mix Assistant: expose Crate profiles, compatible tracks, cues and
  transition plans.
- C — Smart Mix Automation: use a separate General plugin surface to preload a
  deck, synchronize tempo and phase, and execute a guarded automatic transition.

Crate owns identity, authentication, analysis, ranking, cue suggestions and
transition planning. VirtualDJ owns deck playback, audio processing, manual
controls and execution of commands.

Rekordbox is explicitly out of scope. There will be no Rekordbox exporter,
database writer, XML integration or Rekordbox adapter.

## 2. Repository decision

The implementation stays in the Crate monorepo.

### 2.1 Layout

~~~text
app/crate/                         API, auth, Smart Mix and extensions
app/readplane/                     Optional read-side acceleration
app/tests/                         Backend and contract tests
tools/vdj-plugin/                  C++20 VirtualDJ package
  include/crate_vdj/                SDK-independent interfaces
  src/core/                         HTTP, models, auth, cache and contracts
  src/online_source/                A+B adapter
  src/automation/                   C adapter
  src/sdk/                          Private SDK boundary
  tests/                            Mock SDK and fake-server tests
~~~

The Online Source and General Automation adapters are separate plugin targets
packaged together. They share an SDK-independent C++ core. The first version
does not introduce a local daemon or IPC layer.

### 2.2 Why the monorepo?

The plugin is coupled to:

- the versioned TrackMixProfile and TransitionPlan contracts;
- capabilities, local search, media access and playback;
- Smart Mix migrations and profile versions;
- scoped access tokens;
- cue and play-event semantics;
- backend, native and end-to-end contract tests;
- the same feature flags, rollout and rollback controls.

Keeping these changes together lets one change update the contract and all
consumers. A separate repository can be reconsidered only after the API is
stable and an independent release cadence or SDK licensing boundary justifies
it.

SDK headers are never vendored. Local builds use VIRTUALDJ_SDK_ROOT and public
source archives exclude the SDK.

## 3. Independent versioning

Crate and the VirtualDJ package have independent release streams.

### 3.1 Version identifiers

| Artifact | Version format | Example |
|---|---|---|
| Crate stack | Existing SemVer tags | v2.3.16 |
| VirtualDJ package | Independent SemVer tags | vdj-v1.0.0 |
| API contract | Additive contract version | 2026-08 |
| Smart Mix profile | Integer schema version | 1 |
| Transition planner | Stable planner identifier | smart-mix-v1 |

The plugin package manifest includes:

- plugin version;
- minimum supported Crate contract;
- maximum tested Crate contract;
- minimum Smart Mix profile schema;
- planner version;
- supported VirtualDJ versions and architectures.

### 3.2 Negotiation rules

The plugin calls the capabilities endpoint before exposing Crate features.
Capabilities include a VDJ section with:

- enabled/disabled state;
- minimum and maximum plugin versions;
- API contract version;
- profile schema and planner versions;
- source, assistant and automation feature flags;
- server-side kill-switch state.

Rules:

1. An incompatible major contract prevents connection with an actionable error.
2. An unsupported optional feature disappears without disabling the source.
3. A newer profile or planner version is never parsed optimistically.
4. The server can disable automation while keeping A and B available.
5. The plugin can connect to a supported older Crate stack within its declared
   compatibility range.

### 3.3 Git and CI tags

- Existing stack releases continue to use tags such as v2.3.16.
- Plugin releases use tags such as vdj-v1.0.0.
- A stack release may run plugin compatibility tests, but it does not bump the
  plugin version.
- A plugin release builds only when a vdj-v* tag or an explicit release
  workflow is selected.

This prevents a backend patch release from forcing a plugin release while
still making compatibility visible before the stack release is published.

## 4. Product scope

### 4.1 A — Online Source

The user can:

- connect a Crate node;
- authenticate with a least-privilege VirtualDJ token;
- browse local artists, albums, playlists, genres and moods;
- search the local catalog;
- see artwork and basic metadata;
- load a Crate track into a deck;
- keep an already loaded track playable during a temporary outage.

Version one is local-catalog only. Federated remote streaming is not enabled
until startup latency, range requests, revocation and availability are proven
for professional deck use.

### 4.2 B — Smart Mix Assistant

The plugin consumes, but never recomputes:

- BPM and confidence;
- key, scale, Camelot key and confidence;
- energy, danceability, valence and loudness;
- intro and outro cues;
- compatible-track ranking and score breakdown;
- transition mode, duration, cues, tempo ratio, phase offset, gain and fallback
  reason.

Compatible tracks can be exposed as a temporary folder or context action.

### 4.3 C — Smart Mix Automation

C is a separate General Automation plugin surface. It uses VirtualDJ base
callbacks to:

1. identify the active and free decks;
2. request or resolve the next local Crate track;
3. load it into the free deck;
4. wait until it is ready;
5. validate the transition plan against current deck and profile revisions;
6. apply tempo, phase and crossfade commands;
7. observe completion or cancellation;
8. fall back to manual control on any unsafe condition.

The first executor guarantees high-level musical behavior through VirtualDJ's
engine. It does not claim arbitrary sample-accurate DSP control until the
measurement gate proves that the SDK and command scheduler provide it.

## 5. SDK feasibility and boundary

The official VirtualDJ SDK documents:

- Online Source search, folders, stream URL resolution and context menus;
- asynchronous search completion and cancellation;
- base plugin command execution and numeric/string queries;
- VDJScript verbs for deck selection, BPM, beat position, sync,
  auto_bpm_transition, auto_crossfade and automix.

References:

- https://virtualdj.com/wiki/Plugins_SDKv8_OnlineSource.html
- https://virtualdj.com/wiki/Plugins_SDKv8.html
- https://virtualdj.com/manuals/virtualdj/appendix/vdjscriptverbs.html

Therefore A+B are high-confidence and C is technically viable for high-level
automation. C still has an empirical gate because public documentation does
not promise sample-accurate scheduling, fixed command latency or identical
behavior across all versions and hardware.

The production choice is two native plugin targets:

- Online Source for A+B;
- General Automation for C.

Both use the shared core, but automation can be disabled independently.

VirtualDJ's official Network Control extension may be used as a short-lived
spike to validate commands. It is not a production dependency because it adds
installation, configuration, version and Pro-license constraints.

## 6. Runtime architecture

~~~text
                         +------------------------------+
                         |          VirtualDJ            |
                         |                              |
                         |  Online Source     General   |
                         |  plugin (A+B)      plugin (C) |
                         +---------------+--------------+
                                         |
                         +---------------v--------------+
                         |       crate_vdj_core          |
                         | HTTP, auth, cache, models    |
                         | Smart Mix, state, telemetry   |
                         +---------------+--------------+
                                         |
       +---------------------------------+-------------------------------+
       |                                 |                               |
 /api/search                    /api/tracks/...                  /api/playback/
 scope=local                    mix-profile                      transition-plans
       |                                 |                               |
       +---------------------------------v-------------------------------+
                                  Crate API
~~~

The core never exposes VirtualDJ SDK types. The SDK adapters translate between
VirtualDJ callbacks and core commands/events. No network, JSON parsing,
SQLite I/O or Smart Mix calculation runs on the VirtualDJ UI thread.

## 7. Current Crate contracts

The implementation reuses current contracts rather than inventing a parallel
DJ API:

| Capability | Contract |
|---|---|
| Capabilities | GET /api/capabilities |
| Local search | GET /api/search?scope=local |
| Stream authorization | POST /api/auth/media-access |
| Playback resolution | GET /api/tracks/by-entity/{uid}/playback |
| Track stream | GET /api/tracks/by-entity/{uid}/stream |
| Mix profile | GET /api/tracks/by-entity/{uid}/mix-profile |
| Compatible tracks | GET /api/tracks/by-entity/{uid}/compatible |
| Transition plans | POST /api/playback/transition-plans |
| Play events | Existing /api/me/play-events and repository |

New VDJ capability fields, token scopes, automation status and cue operations
are additive. Existing Listen and Android consumers remain unchanged.

Smart Mix storage and migrations continue from the current validated head,
which is 090 in the Smart Mix worktree. Every implementation branch checks the
actual Alembic head and renumbers an unmerged migration tail before adding a
new migration.

## 8. Automation state and safety

The automation state machine exposes:

| State | Behavior |
|---|---|
| disabled | No automatic commands |
| armed | Candidate prepared; waits for confirmation |
| assisted | Plugin proposes and prepares; user starts |
| automatic | Eligible transitions execute automatically |
| cancelled | Current transition is stopped safely |
| fallback | Automation stops; VirtualDJ remains manual |

Automatic mode is opt-in, server-gated and revocable. Manual deck interaction
always wins. Any missing profile, low confidence, stale plan, unsupported
command, changed deck identity or failed readiness check causes fallback.

The executor validates:

- outgoing and incoming entity UIDs;
- profile revisions;
- plan version and supported mode;
- duration and tempo ratio bounds;
- current queue/deck revision;
- user automation mode.

It never retries indefinitely and never reclaims a deck after manual takeover.

## 9. Extensions

The extension roadmap remains in scope:

- scoped tokens, rotation and revocation;
- Windows Credential Manager and macOS Keychain;
- metadata cache;
- optional bounded encrypted audio cache;
- next-track prefetch;
- radio session reuse;
- private revision-safe cue overrides;
- now-playing heartbeat;
- idempotent play events;
- BPM/key/energy search filters and cursor pagination;
- metrics, diagnostics and abuse tests;
- signed Windows/macOS packaging.

Readplane is conditional only. It is implemented if measured FastAPI latency,
availability or catalog volume requires it; otherwise the FastAPI path remains
the supported implementation.

## 10. Testing and release gates

Automated tests cover:

- Python API, auth, migration and Smart Mix contracts;
- C++ fake-server mapping and error handling;
- mock SDK lifecycle and asynchronous completion;
- automation state transitions and cancellation races;
- command mapping with deterministic VirtualDJ state;
- token and URL redaction;
- sanitizers and thread-safety;
- compatibility fixtures across Crate and plugin versions.

Manual tests cover Windows x64, macOS Intel and Apple Silicon, supported
VirtualDJ versions, two decks, manual takeover, slow/offline networks and a
four-hour two-deck soak.

C is not production-ready until manual intervention during preload, sync and
crossfade leaves VirtualDJ in a safe manual state.

## 11. Explicit non-goals

- Rekordbox of any kind.
- Direct modification of VirtualDJ database XML.
- Federated remote streaming in the first release.
- Reimplementation of Smart Mix analysis or scoring in C++.
- Unbounded offline storage.
- Sample-accurate DSP claims without measurement evidence.

## 12. Final decision

Implement A+B+C in the Crate monorepo:

- A+B through an Online Source target;
- C through a General Automation target;
- one shared SDK-independent C++ core;
- independent Crate and plugin versions;
- all planned extensions retained;
- readplane conditional on measured need;
- Rekordbox removed permanently.
