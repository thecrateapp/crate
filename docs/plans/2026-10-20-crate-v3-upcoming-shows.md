# 1BC — Upcoming and shows · third batch

Base: approved/published Artist `5f511815`. Execute inline with executing-plans/TDD.
Source: approved5186 mockup, the approved expanded show ticket and subsequent user amendments:
solid surfaces, real genre percentages including0, MonoLabel context,8px caption gaps,
same month/day/weekday date stamp, matching compact show/release artwork, canonical44px actions.
Preserve V2 show portrait88px, ticket typography/perforation/setlist animation and actions.
Keep5186/6006/5174 active, Listen API https://api.lespedants.org, stop uncommitted for review.

## Task 1: Radar reading, filters and frame

Tests RED→GREEN for failed personal/genre reads with retry, cached data retained, authoritative
genre404, actual0 summary, filters/search/featured exclusion and no-results. Controller retains
URLs/data authority, exposes selected read error/retry; no extra requests. Extract pure
ShowsPageView composed by real ShowsContent and reviews. Canonical FormField/SearchInput/
SegmentedControl and solid Card, no typography/geometry overrides. Preserve summary visibility
and current section order. Expected: scoped Shows/model tests green,7catalogs if copy added.

## Task 2: Common event presentation and ticket actions

Tests RED→GREEN for show/release same local date/artwork frame, real dates (invalid omitted),
metadata below identity, menu/link/attendance authority, pending/disabled controls, ticket
missing URL disabled and real genre0/frequency0 retained. Pure app-local event/date/artwork/
release/show views reused by adapters and scenes; managed CrateImage stays in app adapters.
Use ActionGroup/ActionButton/ActionLink for conventional actions and existing specialized play
control. Preserve collapse/expand/feature/preview and content resize without clipping.
No invented quality/genre/metrics, collapsed-row fetches, new API or instruments.
User amendment: Radar sends names only; lazily read the existing artist profile for an open
ticket lacking percentages, cache per resource and validate identity. No request for closed rows
or percentage-bearing profiles. Failed/missing data retains names without invented values. Shared components
unchanged unless real adoption in both apps requires it (not anticipated).
Expected: affected event/model/action/artist/home consumer tests green.

## Task 3: Storybook and isolated review

English Listen/Upcoming inventory and stable Reviews/1BC/Upcoming and shows story share one
scene with review-1bc-upcoming-shows.html. Render actual production pure views, no component
replicas/internal CSS repairs. Cover ready/empty/no-follow/genre/not-found/error/loading/cached,
filters/search, show expansion, attendance/pending, More, release accessible/unavailable,
long names/missing images/long setlist,0/missing percentages, local callbacks only.
Expected: both hosts375/1200 no overflow/API/audio/preference writes,8px gaps,44px actions,
matching date/artwork geometry, keyboard/menu/expand callbacks and dynamic ticket sizing.

## Task 4: Focused verification and final review

Run affected Listen/event/action/home/artist/policy Vitest with workers1; Desktop tests/types,
Listen/Storybook types, changed lint,3builds and bundle/catalogue checks. No fullCI, snapshot or
budget regeneration. One fresh final reviewer (most capable model), one fix pass with RED→GREEN.
Record evidence and decisions, preserve3services and stop for review before commit/push.

## Review focus

Check cached versus authoritative errors, genre filter behavior, actual summary authority,
row keys/attendance/feature transitions, managed artwork fallback and resolved data URLs,
button/link semantics and long-press menus, mobile action geometry, expanded ticket resizing,
real0/missing profile data, and review reuse without runtime side effects. Do not redesign
maps/wheels/setlist instruments or include Radio/Paths; those remain later1BC/H3 work.

## Evidence and decisions at review stop

Artist published5f511815; this third1BC cut stays uncommitted. Final scoped Listen86/17files,
Desktop52/8, i18n31/2, showcase policies25/3; browser4/4 on375/1200px and both hosts, including
collapsible ticket content/viewport resizing. Listen/Desktop/Storybook types and changed lint
pass. Three final builds complete; initial JS202410gzip bytes /24assets (budget307200).
Catalogue58documented/93entries/120sources unchanged. Logs .artifacts/review/1bc-upcoming-*.
Preview1bc-upcoming-shows-review.png and readonly Fontaines proof1bc-fontaines-genres.png.

One fresh gpt-6-astra source review; one fix pass, no rereview. Real cached-hook/page integration
reproduced all3findings RED and passed GREEN: cached genre404 authority (including stale summary),
attendance refresh/promote/remove and cached profile reopening without another request. Final
86tests include the hook and actual page, rather than relying only on fabricated hook states.
No findings deferred. No production writes, baseline/budget regeneration or new shared exports.

Decisions carried from the ledger (exhaustive):

- User's stop-before-commit and focused repository checks supersede generic per-task commits,
  fullCI and workspace cleanup. Cost if wrong: phase/native certification remains outstanding;
  this is a local reviewed cut, not a release.
- The working-tree review package includes tracked and untracked source because committing
  before user review is forbidden. Cost if wrong: the reviewer must inspect its full manifest
  instead of relying on a committed range. The fresh reviewer did inspect that scope.
- User's Fontaines Radar report expands the original no-extra-reads assumption: lazily read the
  existing artist resource only for an open ticket missing percentages, validate identity and
  reuse the cache on reopen. Cost if wrong: one initial read per uncached artist; failed/missing
  data retains names without inventing values. Closed rows and complete profiles skip it.
- Opt-in reportCachedErrors exposes cached HTTP failures only for Radar's genre read. Default
  useApi behavior remains unchanged; transient cached content remains visible in Radar too.
  Cost if wrong: that explicit consumer must interpret authoritative errors correctly; actual
  cached404 integration now covers it.
- The reviewer's declined map/wheel/new setlist instruments, Radio/Paths and fullCI/native
  certification remain later-phase scope. Author supplies scoped both-host browser and readonly
  live checks. Cost if wrong: excluded features/platforms are not certified by this review.

The reviewer labelled repeated cached reads Minor; this was regraded Important because the
promised cache behavior and full artist-resource cost affect real repeated ticket use, and was
fixed in the same pass. The plan's ledger stays available until this review is approved.

### Review amendment — icon-only hover and timing

Neutral shared icon-only actions use accent foreground without hover background fill. Both
show and release compact rows use the same unboxed days/hours countdown and real date stamp.
Remove pre-release/released chips. Published releases show only grey uppercase MonoLabel RELEASED
(Diego removed RELEASED ON + date as redundant). Preserve unknown dates without inventing data;
short and expanded show countdowns share the same calculation. Storybook and isolated page use
actual components. Keep all three servers active and stop before commit.

Amendment validation: shared81/7, Listen73/13, Admin24/3; browser4/4 at375/1200
in both hosts, including computed foreground-only hover and unclipped compact rows. Five
typechecks, changed Listen lint, three builds, bundle and catalogue passed. Diego approved
this cut on2026-10-20; next cut is Radio and Paths.
