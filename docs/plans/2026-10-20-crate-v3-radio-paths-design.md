# 1BC Radio and Paths

## Approved scope

Upcoming was approved and published as668a9a8a. The next cut covers Radio and Paths with the
approved mockup/component system as reference. Diego asked for better visual presentation,
clarified that new product workflows were not the goal, and finally preferred the original
coverflow over a spatial-camera experiment. The final cut implements that coverflow, which
advances automatically only on actual track changes. The spatial experiment is removed.

Existing search/start/session/create/play/regenerate/delete behavior remains. No preview/save
split, waypoint editor, planner mode, new endpoint or backend dependency is introduced.
The5–50 track-length UI and Radio300ms search debounce remain. Production QA is readonly.

## Radio

PageHeader owns title/intro/Discovery action. A canonical seed-search region precedes personalized
station rails. Session status uses StatusDot and MonoLabel; the player remains authoritative.
Station cards use the shared EntityCard/MediaCover, square artwork role, contextual MonoLabels,
real play counts including0, native disabled state and existing item menus. Managed artwork,
radio start, queue/source and transport stay in app adapters.

The Listen-local CatalogSearch view now accepts a genre category, alongside its existing
artist/album/track categories, a distinct placeholder and disabled selection. Radio exposes its
existing genre/artist/album seed kinds. Search failures show Retry rather than claiming an empty
response. Current debounce/stale-response tests remain in force.

## Paths builder and detail

The builder uses PageHeader, two endpoint Cards with shared domain search and real artwork,
FormField/Slider and Button. Selected endpoints retain their canonical IDs. Busy state blocks
endpoint/length edits. Saved rows use MonoLabel metadata and the established play/menu controls.
Missing reads show loading/error/retry; a verified empty collection has its own message.

PathDetail uses the same BackLink/PageHeader/ActionGroup recipe, preserves deletion confirmation,
regeneration, full TrackRow list, queue/source and managed artwork. The old linear strip is replaced
by a Listen-local PathCoverJourneyView presenting the approved coverflow:

- Current/inspected cover at the front; neighbours recede on each side. This is ordered sequence,
  not a sound-space or energy projection.
- Mount at most7 cover buttons. Visible covers remain at least48px; on narrow screens farther
  neighbours are hidden. Missing artwork uses the real MediaCover fallback.
- Actual current-track changes move the coverflow. Play/pause or unchanged track state never
  advances it. No automatic tour, persistent animation, RAF loop or progress subscription.
- Previous/next and arrow/Home/End inspect any step without playing. Click/Enter plays from that
  exact index. Current track and inspected focus are separate. The complete track list remains
  the accessible alternative.
- Transitions stop for hidden/reduced motion. Empty/single-track paths retain valid controls.

Use HTML/CSS transforms. This is a maintenance/design choice, not a claim that CSS always beats
WebGL. It preserves authenticated artwork and native controls without adding textures/context-loss
handling or a runtime library. Future full PathRouteMap/RadioSessionMap still needs H3/backend
contracts. See [MDN animation guidance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate)
and [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

## Ownership and review

All new domain views stay in Listen. Actual shared foundations remain unchanged. The same pure
views are reused by the isolated5186page and Storybook, with local fixture callbacks and artwork;
no API, audio or preference mutations. FormField owns8px caption gaps; actions reserve44px.
Storybook entries: Listen/Radio and Paths; Reviews/1BC/Radio and Paths. Historical mockup unchanged.

## Acceptance

Focused tests cover Radio start/search debounce/cancellation/error recovery, endpoint identity and
real create payload, path playback/confirmation, coverflow inspection/current-track changes,
keyboard bounds, reduced motion and sparse data. Browser375/1200 in bothhosts checks dimensions,
8px gaps, disabled/read states, no overflow/API calls and no continuous cover animation. Check
Listen/Desktop/Storybook types, changed lint, builds/bundle/catalogue and affected Home consumers.
One fresh final review, one fix pass. Keep5186/6006/5174(API https://api.lespedants.org) active;
stop before commit for Diego. Full CI/native certification and H3 instruments remain separate.

## Final integration corrections

Automatic advancement follows a stable current-player-track identity, including a replacement at
the same path position. List refreshes and play/pause preserve manual inspection. Passive playback
never scrolls the document. Coverflow focus follows advancement only when focus was already inside
the cover stage; keyboard boundaries leave no pending focus request. Actual PathDetail tests cover
production context updates, and both review hosts exercise the keyboard lifecycle.
