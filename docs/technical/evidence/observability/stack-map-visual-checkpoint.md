# Stack Map visual checkpoint

2026-11-01. Worktree `/Users/diego/Code/crate-stack-topology`, branch
`codex/stack-topology`, base main `6b1803c4506312b6550fb548cce8ffb333443e20`.
Diego requested an interactive instrument matching QueueLanes and Genre Wheel.
D1 deployment work remains preserved separately; the map now takes priority.

## Review

- [Standalone map](http://127.0.0.1:5186/review-stack-map.html) (temporary
  bridge; the PR1A preview stays on the same server).
- [Isolated map](http://127.0.0.1:5187/review-stack-map.html).
- [Storybook](http://127.0.0.1:6006/?path=/story/reviews-admin-stack-map--interactive).

All three render the actual Admin-local component and the same scene. Data is
labelled as samples: one host, 15 application services and eight observability
services. Counts, revisions and readings are not a production inventory report.
No server connection, runtime mutation, persisted preference or simulated live
traffic is introduced. The undecided external probe is not drawn as connected.

## Checkpoint 2: tiered orbits

Checkpoint 1 (single ring per stack) is kept under
`.artifacts/stack-map-checkpoint-0-before-redesign/`. In it, data stores sat
opposite their clients, so most dependencies crossed the whole field; every
connection was the same grey without direction; the default selection was hidden
by a "show all" mode; and a failing service was an 8 px red dot.

- Each stack draws its hub at the centre, services marked `tier: "data"` on an
  inner ring and the rest on an outer ring, with `tier: "entry"` services at the
  top. Each data store sits at the angular mean of the services that use it, so
  dependencies become short radial curves (Genre Wheel parent-edge geometry).
  `hubId` and `tier` are optional additive fields; without them the stack keeps a
  single ring around its first service. The hard-coded hub ids are gone.
- Direction is always visible: small muted arrowheads at rest, accent arrowheads
  on active links, trimmed so they end at the node edge.
- The selection's one-hop links stay accent at rest; hover/focus previews isolate
  one hop and dim the rest. Priority stays hover → focus → selection.
- Each deployment caption reads like QueueLanes/Genre Wheel: a Bricolage count
  with `running · passing · failing · unknown`. A failing healthcheck shows a
  danger halo, a state word under the label and a toolbar badge. Stale or
  unavailable snapshots show "Health unknown" and dashed unknown nodes; they never
  certify health.
- The inspector lists "Depends on" / "Used by" with the connection type and its
  line sample, so type is not carried by colour alone.
- Compact layouts (container under 880 px) use vertical ellipses, place data
  stores in the gaps between outer services and put every label above or below
  its node. At 320 px the closest pair of 44 px targets is 46.1 px apart. The
  compact stage is capped at 560 px so a narrow desktop does not draw a 900 px
  tall map. The breakpoint observes the visual column, not the capped stage.

## Checks

29 unit cases (18 previous, 11 new) and seven browser scenarios pass with one
worker. New cases cover hub/inner/outer placement, data stores moving toward
their clients, single-ring fallback without duplicate positions, compact label
sides, stack summaries for observed and stale/unavailable snapshots, declared hub
selection, failing state at rest, unknown health when stale and connection types
in the inspector. Admin typecheck, scoped ESLint and the story's scoped
TypeScript check pass. Storybook and both standalone pages render 23 nodes.

Screenshots: `.artifacts/stack-map-checkpoint-1-tiered/`
(`1440-observed`, `1440-degraded-hover`, `1440-stale`, `1180-compact-capped`,
`390-observed`, `320-observed`). Canonical baselines are unchanged. No full app
suite or production deployment occurred.

## Checkpoint 3: review follow-ups

Diego authorized the remaining repairs on 2026-11-01. The mobile reading order is
now the active field, a single service inspector, the map key and the service
index. DOM order matches the presentation; desktop keeps the same inspector in
the right column using grid areas. There is no duplicate inspector or responsive
remount that would discard keyboard focus.

Inventory order no longer determines the composition. Application stacks precede
observability; stacks and services use stable IDs as tie-breakers. Services may
declare an optional finite `order` hint, and the review fixtures declare their
existing order to preserve the approved geometry. Entry grouping, hub selection,
inner-ring placement, default selection and arrow navigation remain deterministic
when stacks, services and connections arrive in a different order. Connections
are sorted before angular accumulation to avoid floating-point layout movement.
The primary populated deployment keeps its own hub/fallback instead of selecting
a hub from another deployment. Caller snapshots are not mutated.

Cross-stack telemetry stays visible as declared topology, with lower rest opacity
than local dependencies; selection/focus still emphasizes its full one-hop path.
No traffic animation or new visual tokens are introduced.

Seven new unit regressions were observed failing before implementation and now
pass with the existing cases: **36 unit cases** across the two map files. The
seven scoped browser scenarios pass, including new actual mobile bounding-box
checks for field → inspector → legend → index order at 390/320 px. Target size,
label collision, keyboard, cross-stack focus, missing/zero values, reduced motion
and zero network-request coverage remain green. Admin typecheck, scoped ESLint,
the story's scoped TypeScript check and the showcase catalogue pass.
The direct React Doctor scan of the two production modules has zero diagnostics;
its two warnings about unchecked layout-map lookups were removed with explicit
fallbacks, without changing positions of the declared inventory.

Screenshots and browser inventory: `.artifacts/stack-map-checkpoint-2-followups/`
(`1440-observed`, `1180-observed`, `390-observed`, `320-observed`,
`browser-review.json`). Canonical preview and Storybook render 23 desktop nodes
without page errors. Earlier checkpoints and canonical baselines are unchanged.
No application-wide suite, dependency changes, API adoption or deployment occurred.

## Checkpoint 4: live activity

Branch `codex/stack-live` (stacked on PR1A). Preview: http://127.0.0.1:5188/review-stack-map.html
(the 5186/5187/6006 servers still serve checkpoint 3 from `crate-stack-topology`).

- The map accepts an optional `activity` frame from the projector sampler
  (`event: activity` on `stack-stream`). Without the prop nothing changes.
- Services declare what they originate or consume (`activity.clients`,
  `activity.queues`, `activity.measures`). A pulse is drawn only when exactly one
  service owns the signal and a declared connection backs it; queues served by
  two services (such as `fast`) stay as a reading on the queue store.
- Discrete pulses per frame (at most three per link and forty in total, log
  scale) travel the link once and stop; they are animated through refs with a
  single animation-frame loop per frame, never React state, and are skipped by
  the motion gate and reduced motion. Error shares render in the danger tone.
- Load arcs on nodes, a live caption line for the application stack
  (`req/min · listening · tasks`) and an inspector Live section. Status is Live,
  Live · partial, Warming up, Paused (frame older than 15 s, with its time) or
  Live data unavailable; missing values render as an em dash, never zero.
- The review scene replays three recorded frames every five seconds, labelled as
  a recorded sample, with Off, Warming, Paused and Unavailable cases.

Checks: 48 unit cases across the map, activity model and component files; ten
browser scenarios including recorded pulses, reduced motion without pulses and
paused/unavailable states; Admin typecheck, scoped ESLint, the story's scoped
TypeScript check and the showcase catalogue pass. Screenshots:
`.artifacts/stack-map-checkpoint-3-live/`.

## Next adoption

The production Stack route is unchanged pending visual review. The approved
broader plan still includes additive host/stack/service inventory, snapshot/SSE
integration, scoped controls, remote deploy/rollback and migration rehearsal,
followed by GitHub and documentation-website updates. PR1A and D1 remain in their
separate worktrees; this cut performs no commit/push/deployment.
