# Stack Map — visual checkpoint

Diego requested an expressive interactive instrument in the same visual language
as QueueLanes and Genre Wheel. This checkpoint precedes live API adoption. D1
deployment changes remain preserved in `crate-observability-deployments`; remote
deployment is pending while the map takes priority.

## Direction

- Real Admin-local `StackMap` component, reused in a standalone preview and CSF
  review. Reuse Crate tokens, Bricolage headings, Roboto copy and JetBrains Mono
  readings at its supplied weight. No new shared foundation, font or graph library.
- One host containing two orbital fields: application services and independent
  observability. Fine concentric rules, compact service nodes, restrained cyan
  focus, clear state words and dependency curves. No redundant service icons.
- Selection persists and drives an inspector and incoming/outgoing relations.
  Pointer hover and keyboard focus isolate one-hop connections; selecting a
  related service moves focus through the topology. Relationship types are
  differentiated by line treatment, not colour alone.
- Desktop has a wide instrument and inspector; mobile switches between deployments
  in place, keeping the inspector near the active field, and preserves readable labels, a service-list alternative and
  44px node targets. No whole-document horizontal overflow.
- Motion only responds to selection/hover; use the shared motion gate and reduced
  motion. Do not invent continuous network traffic from static topology.
- Runtime state, healthcheck and telemetry remain distinct. Stale/unavailable
  snapshots retain topology but do not certify healthy state or display old CPU
  readings as live. Missing metrics are n/a; an observed zero remains zero.
- Fixtures are visibly labelled as sample data with no backend connection.
  Only one sample host; the undecided external probe is not shown as connected.

## Scope and checks

Create `app/ui/src/components/admin/StackMap.tsx`, `stack-map-model.ts` and
`stack-map.css`; focused Testing Library/model cases. Create a shared review scene,
typed samples, CSF story and `review-stack-map.html` entry. Keep existing reviews
available. Capture desktop/mobile and check selection, keyboard, relation focus,
state changes, reduced motion and zero backend requests with one browser worker.

The current Stack page and its API are adopted after the visual checkpoint is
reviewed. Live data remains snapshot-backed and permission-scoped; these fixtures
do not add control of production containers. No full development test suites or
deployment in this visual cut.
