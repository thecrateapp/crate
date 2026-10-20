# 1BC — Explore and current browse · first batch

Base: approved/published1BB728af01c. Continue inline under the approved Listen plan H2/R02.
Reference: approved5186mockup, canonical1ARforms/1ASactions/1ATsurfaces/1AUheaders and Diego's
later confirmed show composition, uppercase contextual metadata, V2 image sizes and genre
background100px offset/original gradient. No shared foundation change or new domain instrument.
Keep5186/6006/5174 active. Stop uncommitted for Diego before next1BC batch.

## Task 1: Browse navigation and read states

Preserve unrelated query parameters/hash while setting/clearing mutually exclusive genre,
decade/category selections and following related genres. Real Explore, decade/category and
genre routes distinguish loading, failed read with retry, successful empty, cached content
and not-found. No new backend requests, fabricated counts or playback changes.
Expected: failing route/consumer tests before changes; URL and read-state tests green afterward.

## Task 2: Actual Explore compositions

Landing feature cards use canonical solid Card and typography; decades use FilterChip action
rather than a local pill skin. Mood choices use canonical Button/MonoLabel and retain existing
play controller/pending semantics. Genre room/related tiles share a local presentation over
solid Card, EntityPrimaryAction and MonoLabel; managed cover fallback, menu/long press and
V2 tile image geometry remain in the runtime adapter. Content image gradients stay content;
no glass/lift/shadow chrome. Genre hero retains approved framing/image gradient and actual
HeroActionBar with no local button overrides; metrics use MonoLabel. Decade/category headers
share actual local BrowseDetailFrame using PageHeader/MonoLabel and unchanged card grids.
Expected: RED contextual typography/frame contracts, then actual consumer and menu tests pass.
No artist page, upcoming/show/release, Radio/Paths or new wheel/map implementation in this batch.

## Task 3: Storybook and shared isolated review

Listen/Explore and browse and Reviews/1BC/Explore and browse use actual pure views from Task2;
small review-1bc-explore.html mounts same scene directly. Include landing choices, room/related
variants with real/missing/failed images, genre hero, detail frames, states/pending, callbacks,
long text and zero counts. Scene layouts never repair internals, labelled groups use FormField
kind=group and real8px gaps. Data/API/player contexts stay in app adapters, fixture actions local.
Expected: English stories, scope inventory, both hosts375/1200 no overflow,44px actions,
font roles/8px gaps/unchanged hero positioning, no API/audio/preferences writes.

## Task 4: Focused validation and review

Scoped Vitest workers1 for Explore/genre/menu/read/nav/components and affected Desktop;
Listen/Desktop/Storybook types, changed lint, three builds/bundle and showcase policy. No full
CI/baseline regeneration. One fresh reviewer at end, one fix pass, no rereview loop. Record
real evidence and any remaining coverage limits; stop1BC for Diego without commit.

## Completed review amendment: Chrome context menus

User-reported Chrome desktop regression traced with temporary development-only diagnostics:
2560px/fine-hover pointer and10reported touch points. Minimal shared detector correction gives
primary fine-hover input precedence over reported touch capacity. Narrow/coarse/native policy,
positioning and mobile behavior remain. The legacy pending ContextMenu entry is now documented
with actual interactive stories, states and both-host `review-1bc-menus.html`.
Two RED rendering/controller assertions become GREEN; shared74, Listen26, policy23 and browser8
cases pass, with affected types/lint/builds/bundle/catalogue. Diagnostic plugin/config removed;
no production writes. This amendment stays in the same uncommitted1BC batch for review.
