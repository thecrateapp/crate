# Genre taxonomy: from the site's GenreWheel to a product feature

Status: analysis for `feat/crate_v3` (read-only pass, nothing implemented). Visual reference: the new
site only (`worktrees/website/app/web`). Companion doc: `site-language.md` (tokens, SVG recipes,
motion). Paths below are relative to the `crate-v3` worktree unless prefixed with `site:`.

## 1. TL;DR

- The taxonomy is real and rich enough for the wheel: 61 core genres, 14 families, 47 parent links,
  102 related pairs, 4 relation types, 40 genres with their own EQ and 21 that inherit. Admin can
  already edit relations, aliases, metadata and EQ through `/api/genres/*`.
- The site's wheel math (`site:src/scripts/viz/taxonomy-math.ts`) ports almost as is, but it
  assumes a clean static tree. Live data adds overlay nodes (MusicBrainz sync, AI proposals),
  possible multi-parent and cyclic parent edges, orphans, dangling relations and unmapped raw tags.
  The layout needs guards and level-of-detail rules (section 8).
- Counts must come from a worker-built snapshot. No endpoint needs `library_tracks`: track counts
  come from `library_albums.track_count`, and artist and album memberships come from `artist_genres`
  and `album_genres`. Today `/api/genres/taxonomy/tree` aggregates per request and double counts
  across aliases. The Listen global path already has a warmed snapshot
  (`ui_snapshots('global-catalog-genres','crate-core')`) with artist, album and track counts, but it
  covers core nodes only.
- Blocking backend gaps before the wheel can honestly offer "edit EQ / overrides" (section 3):
  1. On every boot (API, worker and projector all call `init_db()`), the seeder overwrites curator
     edits to core genres: EQ, name, description and top-level flag.
  2. "Clear (inherit)" does nothing for core genres that have a static preset.
  3. MusicBrainz edges are labelled `manual`.
  4. Two request paths aggregate `library_tracks`, or rebuild a snapshot-sized CTE, during HTTP
     requests.
  5. The Admin tree's "Generate playlist" action calls a route that does not exist.
- Renderer: hand-built SVG with refs and `classList` (the site pattern). Canvas is not needed below
  about 1.5K nodes or 4K edges. Do not use Nivo for the wheel; it is an instrument, not a chart
  (open question shared with `site-language.md`).

## 2. What exists today

### 2.1 Core definitions (`app/crate/genre_taxonomy.py`)

- `GenreDefinition(slug, name, description, top_level, aliases, parents, related, eq_gains)`
  (lines 21-34). There are 61 definitions in `_RAW_GENRE_DEFINITIONS` (178-611). They are
  normalised by `_normalize_genre_definition`, and descriptions are lower-cased from
  `_GENRE_DESCRIPTIONS`.
- 17 EQ templates `_EQ_*` (44-60), 10 bands (32 Hz to 16 kHz), mirrored by hand in
  `app/listen/src/lib/equalizer.ts::EQ_PRESETS` ("if you tune one side, sync the other").
- Shape (computed from the definitions):

| Family | Nodes (incl. family) | Own EQ | Inherit |
| --- | --- | --- | --- |
| metal | 18 | 14 | 4 (thrash, crossover-thrash, groove, speed) |
| punk | 14 | 6 | 8 (beatdown, powerviolence, skate, pop-punk, crust, d-beat, anarcho, art-punk) |
| alternative | 8 | 6 | 2 (post-punk, gothic-rock) |
| electronic | 6 | 2 | 4 (industrial, synthpop, techno, house) |
| rock | 5 | 3 | 2 (garage-rock, grunge) |
| soul | 2 | 1 | 1 (funk) |
| hip-hop, jazz, blues, folk, country, pop, classical, ambient | 1 each | 1 | 0 |

- Depth: 14 nodes at depth 0, 45 at depth 1, 2 at depth 2 (`beatdown-hardcore` and `powerviolence`,
  under `hardcore-punk`). Core has no multi-parent nodes and no orphans.
- Related: 162 declarations, which collapse to 102 unique undirected pairs between nodes. 42 of
  those pairs cross families. One related target dangles: `folk` declares `americana`, which is
  an alias of `country`, not a node. The runtime graph keeps it, so `get_genre_catalog()` reports
  `folk.related = ["americana", "country"]`. The seeder skips it because `americana` has no node id.
- Aliases: 42 declared. The runtime alias index has 135 keys, counting slug and name variants.
- Template usage: `hardcore` 6, `rock` 4, `doom` 4, `jazz` 3, `electronic` 3, `shoegaze` 3, the
  others 1-2 each. `thrash` is used only by `metal`, which is why thrash, groove and speed metal
  "inherit thrash".

### 2.2 Signed release

- `app/crate/data/taxonomy/crate-core-1.0.0.json` contains only `{schema, taxonomy_id, version,
  released_at, taxonomy_digest}`. The `.sig.json` file is an ed25519 signature by key
  `crate-taxonomy-root-2026-01`, and `trust-roots.json` holds one active root valid from 2026-01-01
  to 2031-01-01.
- The digest is `sha256` of the canonical JSON of `get_core_taxonomy_descriptor(include_release=False)`
  (`genre_taxonomy.py:630-666`). That descriptor is built from code: slug, uuid5
  `global_genre_uid`, name, top_level, sorted aliases, parents, related and eq_gains. The DB is
  not involved. `app/crate/federation/global_genres.py::verify_taxonomy_release_files` checks the
  schema, root validity window, signature, id/version and digest.
  `taxonomy_release_health()` returns `status: ok|degraded`.
- Migration `059` adds `genre_taxonomy_releases` (one active per id), `global_genre_uid`,
  `taxonomy_id` and `origin IN ('core','overlay')` on nodes.
- Consequence: any change to core definitions requires a new signed release. That includes the
  `folk -> americana` fix and any EQ retune in code. Local edits never touch the release: they live
  only in DB rows, and today the seeder overwrites them (gap G1).

### 2.3 Tables

| Table | Role | Notes |
| --- | --- | --- |
| `genres` (id, entity_uid, name, slug) | raw library tags | written by `index_genres` |
| `artist_genres` (artist_name, genre_id, weight, source) | artist membership | about 8 genres per artist max (`genre_indexer._normalize_weighted_genres`) |
| `album_genres` (album_id, genre_id, weight, source) | album membership | |
| `genre_taxonomy_nodes` | canonical nodes | `slug`, `name`, `description`, `external_description*`, `cover_path`, `musicbrainz_mbid`, `wikidata_*`, `is_top_level`, `eq_gains float8[]`, `eq_reasoning` (mig 007), `global_genre_uid`, `taxonomy_id` (default `crate-core`, mig 063), `origin core/overlay` |
| `genre_taxonomy_aliases` | raw tag -> node | `alias_slug` PK, `alias_name` unique, `origin core/manual/inferred/legacy`, `confidence` (mig 077) |
| `genre_taxonomy_edges` | relations | PK `(source, target, relation_type)`, `weight` (related 0.7), `source` (provenance string), `confidence`, `evidence_json`, `created_by`, `locked`, `updated_at` (mig 042) |
| `genre_taxonomy_releases` | active release | id, version, digest, signature, active |
| `global_catalog_genre_assertions` / `global_catalog_entity_genres` | federated memberships | per entity type `artist/album/track`, `direct_score`, `aggregate_score` (mig 060) |
| `user_genre_stats` | per-user listening by raw `genre_name` and `stat_window` | precomputed by `db/jobs/user_listening_projections.py` |
| `ui_snapshots` | warmed read models | `global-catalog-taxonomy` and `global-catalog-genres` (subject `crate-core`) for genres |

### 2.4 Runtime graph

`_get_runtime_taxonomy_graph()` (`genre_taxonomy.py:861-936`) clones the static graph built from
code, then overlays the DB node, alias and edge rows (`db/queries/genre_taxonomy.py`). It is cached
per process. A shared revision `genre_taxonomy:revision` is stored in Redis and settings and checked
at most every 30 s, so another API worker can serve stale structure for up to 30 s after an edit.
Edges are added from DB rows but never removed from the static copy, so a static core edge cannot
disappear at runtime.

### 2.5 Relation types: four, not five

`VALID_RELATION_TYPES = {"parent", "related", "influenced_by", "fusion_of"}`
(`db/repositories/genres_taxonomy_edges.py:10`). The site is right (`RELATION_TYPES` has four, and
`site:src/content/admin/en.ts:112` says "four relation types"). The website design doc
(`website/docs/plans/2026-10-13-website-design.md:109`) is wrong when it says "five".

| Type | Direction stored | Symmetric at runtime | Written by |
| --- | --- | --- | --- |
| `parent` | child -> parent | no (`children_by_slug` derived) | core seed (locked, `crate-core`), curator PUT, MusicBrainz "subgenre of / subgenres", AI proposal apply |
| `related` | declared side -> other | yes | core seed (locked, weight 0.7), curator, AI |
| `influenced_by` | genre -> influence | no (`influenced_genres_by_slug`) | MusicBrainz, curator, AI only |
| `fusion_of` | fusion -> component | no (`fusion_genres_by_slug`) | MusicBrainz, curator, AI only |

The core release seeds only `parent` and `related`. On a fresh install, the `influenced_by` and
`fusion_of` rings are empty until MusicBrainz sync or curation runs. The read-side "virtual"
relations, `child`, `sibling` and `influences`, exist only in the readplane's related-genre query
(`readplane/internal/catalog/genre.go:21-37`).

### 2.6 EQ presets and inheritance

- Per-genre preset: `resolve_genre_eq_preset(value)` (`genre_taxonomy.py:1043-1096`) returns the
  node's own gains as `direct`. Otherwise it runs a BFS up `parent` edges, visiting parents in
  sorted order, and returns the first ancestor with gains as `inherited` with that ancestor's `slug`
  and `name`. It returns `None` when nothing in the chain has a preset. It does not return the path.
- Track effective EQ (`app/crate/equalizer.py:126-201`) resolves in this order: user track preset,
  then instance track preset, then instance album preset, then the genre preset, then audio
  analysis, then flat. For the genre step, `_pick_track_primary_genre` takes the first canonical
  genre of the album (`album_genres` ordered by weight desc, then name), falling back to the
  artist's genres (`db/queries/browse_media_track_genres.py`). The payload carries `genre` and
  `inheritedFrom`, which Listen shows as "Inherited from X" in `EqualizerSmartReadout.tsx`.
- Second resolver: the Go readplane's `genrePresetSQL` (`readplane/internal/catalog/genre.go:447`)
  walks the DB only, with no static fallback, and orders ties by `depth, slug`. The Python BFS
  breaks ties by per-level sorted parents. The two agree on the current core tree but can diverge
  when a core node has DB `eq_gains = NULL` (gap G2) or with multi-parent overlays.
- Writing a preset: `PATCH /api/genres/{slug}/eq-preset` takes `{gains: number[10] | null}`, clamps
  values to +/-12 and writes `genre_taxonomy_nodes.eq_gains`. `POST /api/genres/{slug}/generate-eq`
  asks the LLM and can apply the result with `eq_reasoning`.

### 2.7 API surface used by genre UIs (`app/crate/api/genres.py`, router prefix `/api/genres`)

| Route | Guard | Cost today |
| --- | --- | --- |
| `GET ""` | auth | `get_all_genres()`: COUNT DISTINCT over `artist_genres` and `album_genres` per request. Readplane serves the same SQL (`store.go genresSQL`) |
| `GET /unmapped` | auth | per-request COUNT DISTINCT joins |
| `GET /taxonomy/tree` | auth | `get_genre_catalog()` (memory) plus `get_all_genres()` (aggregate). Children, influences and fusions are found in O(n^2) Python loops (`genres.py:379-385`). Counts are summed across raw aliases, so an artist tagged both "hardcore" and "hardcore punk" counts twice |
| `GET /taxonomy/invalid`, `GET /sound-intelligence/health` | curator | health scans `library_tracks` (G4) |
| `PATCH /taxonomy/{slug}` | curator | name, description, top_level (reverted on boot for core, G1) |
| `PUT /taxonomy/{slug}/relations` | curator | replaces one relation-type set. Deletes only `locked IS NOT TRUE OR source = :source`, so core edges cannot be removed |
| `PUT /taxonomy/{slug}/aliases` | curator | assign raw aliases (`origin manual`) |
| `POST /taxonomy/{slug}/proposal`, `/proposal/apply` | curator | LLM proposal, then create node, aliases and edges (`source ai_proposal`) |
| `DELETE /taxonomy/{slug}`, `DELETE /{slug}` | curator | delete node / raw genre |
| `PATCH /{slug}/eq-preset`, `POST /{slug}/generate-eq` | curator | EQ |
| `POST /index`, `/infer`, `/descriptions/enrich`, `/musicbrainz/sync`, `/taxonomy/rebuild-proposal`, `/taxonomy/cleanup-invalid` | curator | queued tasks (deduplicated through `_get_or_create_task`) |
| `GET /{slug}`, `GET /{slug}/graph`, `GET /{slug}/cover` | auth | detail, neighbourhood graph (recursive CTE, 2 hops), cover |

Every mutation calls `invalidate_runtime_taxonomy_cache(broadcast=True)` and then
`broadcast_invalidation("library","home","curation","genre:<slug>")`. In the projector, that
refreshes the ops snapshot and recent-home snapshots, which is a broad side effect for a taxonomy
edit.

Catalog routes:

- `GET /api/catalog/genres` is served by the readplane from the `global-catalog-*` snapshots. The
  FastAPI fallback calls `list_global_catalog_genres()` live (G5).
- `GET /api/catalog/genres/{slug}` is the Listen genre page ("genre room").
- `/api/browse/explore-page` feeds Listen Explore. It falls back to live `list_global_catalog_genres()`
  when the snapshot is missing (G5).

### 2.8 Read plane (Go)

- `/api/genres` and `/api/genres/{slug}`: live SQL (`store.go:648-865`). The detail page uses
  membership thresholds: artist weight >= 0.70, album score >= 0.45, artist-derived album score =
  weight x 0.7. `track_count` is the sum of `library_albums.track_count` over member albums. This
  is the precomputed-column pattern AGENTS.md allows.
- `/api/catalog/genres`: relays the snapshot when the catalog serves global
  (`routes/global_catalog.go:33-68`). Detail stays on FastAPI.
- Taxonomy drift: `readplane/internal/catalog/taxonomy.go` hardcodes the family map and family
  metadata. It already diverges from Python: `alternative` is named "alternative rock" in Go but
  "alternative" in Python, and Go has an extra `noisecore -> punk` mapping that has no Python node.
  No test guards it.

### 2.9 Frontends

Admin (`app/ui`):

- `pages/Genres.tsx` (2266 lines):
  - The list view has stat tiles, a Sound Intelligence panel, and a grid/tree toggle.
  - `GenreView` has the detail page with `GenreNetworkGraph` and `GenreEqEditor`.
  - `TaxonomyNodeEditorialEditor` handles relations, aliases, AI proposals, cover and delete.
- `components/genres/GenreTaxonomyTree.tsx` (1138 lines): tree plus `NodeDetailPanel`, using
  `/api/genres/taxonomy/tree`. The relation editor config covers all four types.
- `components/genres/GenreNetworkGraph.tsx`: `react-force-graph-2d` on canvas. It shows the 2-hop
  neighbourhood of one genre, styled by relation type with cyan and dashes.
- `components/genres/GenreEqEditor.tsx`: already v3 (`MonoLabel`, `StatusDot`, shared `EqBands`).
  Its states are "Direct preset", "Inherits from X" and "No preset". It saves, clears or generates
  with AI.

Listen (`app/listen`):

- Explore has `GenreExplorer` (genre names from the explore-page filters) and a genre page via
  `?genre=slug` (`components/explore/use-genre-detail-model.ts` -> `/api/catalog/genres/{slug}`,
  with related genres carrying `relation_label`).
- Paths (`/paths`) uses `build_scene_genre_route` (`app/crate/db/paths_scene.py:112`), a Dijkstra
  search with these costs: parent, child and influence 1.0; fusion 1.6; related 2.5.
- The Jam lobby uses `/api/genres/taxonomy/tree` for genre filter suggestions.
- The EQ panel shows the genre and inheritance source.

## 3. Defects and gaps found

| # | Severity | Finding | Where |
| --- | --- | --- | --- |
| G1 | High | `seed_genre_taxonomy_definitions` runs on every boot (`init_db` from API, worker and projector). It upserts core nodes with `name`, `description`, `is_top_level` and `eq_gains = EXCLUDED.*`, so curator edits to any of the 61 core genres are reverted on the next restart. This contradicts the site copy "Local overrides: change any genre on your server. Your overrides sit on top of the signed release" (`site:src/content/admin/en.ts`). Core edges are re-upserted locked, so a curator can add relations but never remove a core one. | `db/jobs/genre_taxonomy.py:219-252`, `348`, `374`; `db/init_db.py:141-144` |
| G2 | High | Clearing a core preset (`gains: null`) does nothing at runtime. The runtime graph starts from the static copy and only sets gains when the DB value is non-NULL ("NULL in DB -> keep whatever the static seed says"), so Python still reports `direct`. Go reads the DB and reports `inherited`. The two resolvers disagree until the next boot restores the gains. | `genre_taxonomy.py:910-919`; `readplane/internal/catalog/genre.go:447` |
| G3 | Medium | MusicBrainz-derived edges are stored with `source = 'manual'` (the default of `upsert_genre_taxonomy_edge`) and `locked = false`. Provenance is lost, and they cannot be told apart from curator edges. The health query counts AI edges as `source IN ('llm','ai')`, but AI proposals write `ai_proposal`, so `ai_edge_count` is always 0. | `genre_descriptions.py:773-777`; `db/queries/sound_intelligence.py:119` |
| G4 | High (perf rule) | `GET /api/genres/sound-intelligence/health` scans all `library_tracks` with 4 correlated `EXISTS` per row and a `COUNT` per request. This breaks "never COUNT over library_tracks in a request". Its genre bucket also ignores inheritance (`node.eq_gains IS NOT NULL` only). | `db/queries/sound_intelligence.py:21-79` |
| G5 | Medium (perf rule) | When the snapshot is missing, FastAPI `/api/catalog/genres` and `_explore_genres` run `list_global_catalog_genres()`, a recursive hierarchy CTE with window functions, inside the request. Per the rules, they should serve stale or empty data and enqueue a deduplicated refresh. | `api/catalog.py:221`, `api/browse.py:54` |
| G6 | Medium | `/api/genres/taxonomy/tree` aggregates per request and double counts artists and albums across raw aliases of the same node. The local catalog fallback (`list_local_catalog_genres`) sums the same way. `get_taxonomy_node_stats` already counts DISTINCT per node correctly. Admin tree counts (any weight) and Listen genre page counts (thresholds 0.70 / 0.45) use different definitions. | `api/genres.py:358-372`; `db/queries/catalog_local_browse.py:13-39`; `db/queries/genres_shared.py:198-226` |
| G7 | Medium | Nothing prevents `parent` cycles: `replace_genre_taxonomy_edges` accepts any target. The site layout's `weight()` recursion would overflow the stack on a cycle. Python BFS and Go `depth < 8` survive one. | `db/repositories/genres_taxonomy_edges.py:127-219`; `site:taxonomy-math.ts:139-145` |
| G8 | Low | Dangling related target `folk -> americana`, an alias rather than a node. It appears in the catalog and tree payloads. The fix in code changes the core digest and needs a re-signed release. | `genre_taxonomy.py:234-240` |
| G9 | Low | The Admin tree inspector's "Generate playlist" posts to `/api/genres/{slug}/playlist`, which does not exist on any router, so it always fails. | `ui/src/components/genres/GenreTaxonomyTree.tsx:950-952` |
| G10 | Low | Go static taxonomy drift (`alternative rock`, `noisecore`), with no drift test. | `readplane/internal/catalog/taxonomy.go` |
| G11 | Low | The runtime revision check TTL is 30 s per process. After an Admin edit, another API worker can return the old structure for up to 30 s, so mutation responses must carry the new state. | `genre_taxonomy.py:672` |
| G12 | Info | Listen global genre detail only shows `parent` and `related` edges where `edge.locked` (`db/queries/global_catalog.py:935`). Local or readplane detail shows child, sibling, related, influenced_by, influences and fusion. Influence and fusion edges, and unlocked MusicBrainz edges, are invisible in global mode. | |

## 4. The site's GenreWheel: what to port and what is demo-only

Source files:

- `site:src/components/viz/GenreWheel.astro`
- `site:src/scripts/viz/genre-view.ts`
- `site:src/scripts/viz/taxonomy-math.ts` and its `.test.ts`
- Drift test: `site:src/content/admin/viz.test.ts:97-151`. It parses `genre_taxonomy.py`,
  `VALID_RELATION_TYPES` and the release JSON from the main repo.

Port as is:

- `buildTaxonomy`.
- `resolveEq`: BFS to the nearest preset, returning `{preset, source, from, path}`.
- `radialLayout`:
  - Sectors are proportional to `weight + 2`, where weight = 1 + descendants.
  - Children are placed inside the parent's angular span, with ring = depth + 1.
  - Ring radii are 132, 212 and 256 in a 760 viewBox.
- Parent edges are cubic curves through the mid radius. Related edges are quadratic curves pulled
  to 18% of the midpoint offset.
- Node states: `preset` (filled .55), `is-path`, `is-from`, `is-start`, `is-on`.
- Mini EQ: bars driven by a `--g` CSS variable, spring 140/15, text rewritten only when the
  formatted value changes.
- Legend: Families, Parent links, Related links, Relation types.
- Mobile at 760 px or less: hide child labels and set family labels to 16 px.

Demo-only, or wrong for live data:

- Auto-walk over `EQ_WALK` (dwell 3.4 s, manual hold 9 s). The product should show real state;
  keep auto-walk only as an idle state, if at all (open question already in `site-language.md`).
- The EQ is identified by template name (`hardcore`, `thrash`). DB rows hold raw gains, and curator
  edits will not match a template. The product needs a server-side `template` key or `null` for
  custom gains.
- The layout assumes a single parent, acyclic edges, every node reachable from a top node, and
  family order taken from source order. None of these hold for overlay data.
- `genreRoute` costs only cover parent/child (1) and related (2.5). The backend
  `build_scene_genre_route` also uses influence (1.0) and fusion (1.6). Once influence or fusion
  edges exist, the product port must use the backend costs, or better, receive the route from the
  backend.
- The SVG is `aria-hidden` with a figure label. The product needs keyboard and screen-reader
  access (section 7.3).

## 5. Data contract for the product wheel

One payload per surface, built by a worker. Structure and counts travel together, versioned by
taxonomy revision. Field names follow the existing snake_case API style.

```ts
type RelationType = "parent" | "related" | "influenced_by" | "fusion_of";
type EdgeProvenance = "crate-core" | "manual" | "musicbrainz" | "ai_proposal";

interface GenreWheelPayload {
  taxonomy: {
    id: "crate-core";
    version: string;              // core release version
    digest: string;               // core descriptor digest
    release_status: "ok" | "degraded"; // taxonomy_release_health()
    revision: string;             // genre_taxonomy:revision the structure was built from
  };
  stats: { built_at: string; revision: string; scope: "local" | "global" };
  relation_types: RelationType[]; // from VALID_RELATION_TYPES, never hardcoded in the client
  eq_templates: Record<string, number[]>; // exported _EQ_* map + "flat"
  families: {
    slug: string; name: string; order: number;
    node_count: number;
    counts: GenreCounts;          // roll-up of the whole family, DISTINCT
  }[];
  nodes: GenreWheelNode[];
  edges: GenreWheelEdge[];
  unmapped: {
    total: number;                // raw tags with no alias
    top: { slug: string; name: string; artist_count: number; album_count: number }[]; // limit 50
  };
}

interface GenreCounts { artists: number; albums: number; tracks: number }

interface GenreWheelNode {
  slug: string;
  name: string;
  global_genre_uid: string | null;
  origin: "core" | "overlay";
  top_level: boolean;
  family: string | null;          // get_top_level_slug; null = unplaced
  primary_parent: string | null;  // parent on the chosen family path; drives layout
  parents: string[];              // all parents (multi-parent drawn as secondary arcs)
  depth: number;                  // along primary_parent chain
  alias_count: number;
  has_cover: boolean;
  counts: { direct: GenreCounts; rollup: GenreCounts };
  eq: {
    source: "direct" | "inherited" | "none";
    from: string | null;          // slug owning the preset
    path: string[];               // [slug, ..., from], BFS order identical to resolve_genre_eq_preset
    template: string | null;      // key in eq_templates, null = custom gains
    gains: number[] | null;       // only when template is null (keeps payload small)
    overridden: boolean;          // local value differs from core release (needs G1 fix)
    reach: { albums: number; tracks: number }; // albums whose effective genre EQ comes from this node
  };
  flags: { orphan: boolean; cycle: boolean; invalid: boolean; empty: boolean };
}

interface GenreWheelEdge {
  source: string;                 // parent: child -> parent; influenced_by: genre -> influence; fusion_of: fusion -> component
  target: string;
  type: RelationType;             // related edges deduplicated as unordered pairs
  provenance: EdgeProvenance;
  locked: boolean;
  confidence: number;
}
```

Notes:

- `eq.path` and `eq.from` come from the backend, so there is only one resolver. Extend
  `resolve_genre_eq_preset` to return the path. The client never re-resolves except as an
  optimistic preview while editing.
- `eq.reach` is the metric the curator needs before saving: "this preset drives N albums and M
  tracks". It is computed in the worker:
  1. Find each album's primary canonical genre, using the same ordering as
     `_pick_track_primary_genre`.
  2. Map it through the resolver to its `from` node.
  3. Sum `library_albums.track_count`.
- Size: 61 nodes and 149 edges come to about 35 KB raw, about 6 KB gzip. At 600 nodes and 1.5K
  edges it is about 350 KB raw and about 50 KB gzip. Keep gains out of nodes when a template
  matches, and use revision ETags.
- Mutation responses (relations, aliases, EQ, metadata) return the updated `GenreWheelNode` or
  edges plus the new `taxonomy.revision`, so Admin patches local state immediately (G11). Counts
  catch up when the snapshot is rebuilt.

## 6. Counts without COUNT over `library_tracks`

Precomputed sources already available:

| Source | Gives | Freshness |
| --- | --- | --- |
| `library_albums.track_count`, `library_artists.album_count/track_count` | track totals per album/artist | maintained by sync |
| `artist_genres`, `album_genres` (+ `genre_taxonomy_aliases`) | memberships with weights | rebuilt by `index_genres` |
| `ui_snapshots('global-catalog-genres','crate-core')` | per core genre `artist_count`, `album_count`, `track_count` (hierarchy-expanded through locked parent edges, `aggregate_score >= 0.7`), `top_artists` | warmed by `reconcile_*` global catalog tasks, `stale_after 300s`, relayed by Go |
| `user_genre_stats` | per user/window plays by raw genre name | listening projections |

Missing: a local (Admin) snapshot that covers overlay nodes, deduplicates across aliases, and has
both direct and roll-up counts. Proposal: a worker job, `db/jobs/genre_wheel.py::build_genre_wheel_snapshot`,
that writes `ui_snapshots('genre-wheel', 'local')`. All counting happens in one CTE over the small
membership tables (about 7K artist rows, about 20K album rows, 4.4K albums):

```sql
WITH RECURSIVE
node_alias AS (
  SELECT g.id AS genre_id, gta.genre_id AS node_id
  FROM genres g JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
),
artist_members AS (                      -- DISTINCT across aliases
  SELECT na.node_id, ag.artist_name, MAX(ag.weight) AS score
  FROM artist_genres ag JOIN node_alias na ON na.genre_id = ag.genre_id
  GROUP BY na.node_id, ag.artist_name
),
album_members AS (                       -- same thresholds as readplane GenreDetail
  SELECT node_id, album_id, MAX(score) AS score FROM (
    SELECT na.node_id, alg.album_id, alg.weight AS score
    FROM album_genres alg JOIN node_alias na ON na.genre_id = alg.genre_id
    UNION ALL
    SELECT am.node_id, a.id, am.score * 0.7
    FROM artist_members am JOIN library_albums a ON a.artist = am.artist_name
    WHERE am.score >= 0.70
  ) s GROUP BY node_id, album_id
),
closure AS (                             -- node -> self + ancestors, bounded for cycles
  SELECT id AS node_id, id AS ancestor_id, 0 AS depth FROM genre_taxonomy_nodes
  UNION
  SELECT c.node_id, e.target_genre_id, c.depth + 1
  FROM closure c
  JOIN genre_taxonomy_edges e
    ON e.source_genre_id = c.ancestor_id AND e.relation_type = 'parent'
  WHERE c.depth < 8
),
direct AS (...),                         -- COUNT DISTINCT artists >= .70, albums >= .45, SUM(a.track_count)
rollup AS (...)                          -- same over (SELECT DISTINCT c.ancestor_id, m.album_id ...)
SELECT ...
```

- Definitions match the Listen genre page (readplane thresholds), so Admin and Listen show the same
  numbers. This also fixes G6.
- Structure, EQ path, template key, flags and `eq.reach` are filled in Python inside the same
  worker job, using the in-memory runtime graph after a forced cache invalidation.
- Triggers, all through `create_task_dedup(..., dedup_key="genre-wheel:local")` on the `fast`
  queue (short, DB-only):
  - `index_genres` completion.
  - Any taxonomy mutation (enqueued with `register_after_commit` in the write path).
  - Completion of MusicBrainz sync, inference or cleanup tasks.
  - A projector action on `library` invalidation, which is coalesced by the projector's action set.
    Library syncs change album membership.
  - Do not add new `home`/`ops` invalidations for taxonomy edits; consider narrowing the current
    broadcast to `curation` plus `genre:<slug>`.
- Serving:
  - Admin: `GET /api/genres/taxonomy/wheel` (auth) reads the snapshot via `get_ui_snapshot` and
    never builds it. On a miss it enqueues the deduplicated task and returns
    `{status: "warming"}`. The client shows the empty state and retries on the task event.
  - Listen (phase 2): `ui_snapshots('genre-wheel','crate-core')`, built from the same job. Use
    global memberships when `catalog_serves_global`, otherwise local. Go relays it at
    `/api/catalog/genres/wheel` the same way as `globalCatalogGenresRoute` (taxonomy revision check
    included). FastAPI fallback is snapshot-or-503. Listen never needs overlay nodes from other
    servers, and core is what federates.
  - Personal overlay for Listen: add `genre_shares: {slug: share}` (canonical, mapped in the
    worker) to the existing per-user stats snapshot. Do not map raw `user_genre_stats.genre_name`
    per request.
- Replace the request-time counting in `/api/genres/taxonomy/tree` and in Sound Intelligence
  health with snapshot reads (G4, G6). The health EQ-source breakdown becomes part of the same
  worker job (it already needs per-album primary genre for `eq.reach`).

## 7. Interactions

### 7.1 Admin (Genres page, default view)

- Layout: wheel on the left (7fr), inspector panel on the right (4fr), collapsing at 1000 px, as
  on the site. The tree and grid stay as the list and accessible alternative. The neighbourhood
  `GenreNetworkGraph` can stay on the genre detail page or be retired later.
- Hover (preview, no state commit):
  - Light the inheritance walk: `is-path` nodes, `is-on` parent edges along `eq.path`, `is-from`
    on the preset owner.
  - Light the node's related edges.
  - The panel readout (aria-live polite) shows the path `powerviolence -> hardcore punk`, the
    preset name in large cyan-hi type, and "inherited from X". The mini EQ springs to the gains.
- Click: pin selection. The inspector shows:
  - Name with an origin badge (core/overlay, and "local override" when `overridden`).
  - Family, and counts with `StatNumber` (direct and roll-up artists, albums, tracks).
  - EQ block: mini curve, source and path, "Edit EQ" opening `GenreEqEditor`, and "Reset to core"
    once G1 is fixed.
  - Relations grouped by the 4 types, as chips with a provenance dot (core and locked shown with a
    `lucide-react` `Lock`, manual, musicbrainz, ai), plus aliases with origin and confidence.
- EQ edit preview: while dragging bands, the wheel highlights every descendant whose `eq.path`
  passes through the selected node and does not have its own preset. That is the inheritance
  blast radius. The panel shows "applies to N genres, M albums, K tracks" (sum of `eq.reach` over
  those nodes) before Save. Toast via `sonner`.
- Relation edit on the wheel ("link mode"):
  1. With a node pinned, pick a relation-type chip.
  2. Click target nodes to toggle them. A provisional edge draws with the site's dash draw.
  3. Save calls `PUT /taxonomy/{slug}/relations` with the new set.
  - Locked core edges render as non-removable.
  - Parent targets that would create a cycle are disabled. The client uses `eq.path` and
    ancestors; the server enforces it after the G7 fix.
- Unmapped tags: the "unmapped" readout shows `unmapped.total` and the top list in the panel.
  Selecting a raw tag highlights candidate nodes (from `/taxonomy/{slug}/proposal` when the LLM is
  available, otherwise a name match). Clicking a node calls `PUT /taxonomy/{slug}/aliases`. Raw
  tags are never drawn as wheel nodes.
- View modes (legend chips, toggle style):
  - "EQ coverage" (default): direct filled, inherited ring, none dimmed. Use amber only for the
    "no preset" status.
  - "Content": node radius and label weight scale with `rollup.artists`; empty nodes dimmed like
    `GenreNetworkGraph.INACTIVE_*`.
  - "Provenance": edges coloured by opacity steps of cyan by source, not new hues.
  - Relation-type filters for the four types.
- Task-driven updates: MusicBrainz sync, inference and cleanup already run as tasks
  (`useTaskPoll`). On completion, refetch the wheel. New nodes fade in and new edges draw in.
  Positions move with a transform transition (spring-snappy). Path `d` is not transitioned (Safari
  cannot); old and new edges cross-fade instead.

### 7.2 Listen (browse only, no editing)

- Explore genres: the wheel replaces or augments `GenreExplorer` on desktop.
  - Tap a family to zoom into its sector (viewBox transform, spring-smooth). Tap a genre to open
    the existing `?genre=slug` page.
  - Size by `rollup.artists`. Optional personal glow from `genre_shares` (cyan-hi alpha by share).
- Genre page: a compact locator showing the family sector, the selected node, its parent path and
  related neighbours. It complements the current `related_genres` chips with their
  `relation_label`.
- Paths: draw the backend route (`build_scene_genre_route`) on the wheel, with a path draw and a
  travelling dot, as the site's InsideCrate route mini does.
- EQ panel: "Inherited from X" can link to the genre page locator.
- Mobile and Capacitor: child labels hidden under 760 px. Hit targets come from per-node invisible
  circles of r 14, or sector-level tap followed by a list, so that 2.7 px node spacing never needs
  precise taps. Use icons from `@crate/ui/icons` and `notify` only.

### 7.3 Motion and accessibility

- No `setState` per frame. Hover and selection toggle classes through refs (site
  `genre-view.ts` pattern).
- The mini EQ uses one `useVisibleLoop(ref, frame)` that writes `--g` and is gated off-screen. Its
  effect dependencies never include per-frame values (SSE/WebSocket rule).
- Reduced motion snaps the springs. The scramble on the preset name becomes a plain text swap.
- Keyboard: roving tabindex over nodes. Left and right move along the ring; up and down move to
  the parent or first child; Enter pins; Escape clears. A search combobox focuses a genre by name
  or alias. The SVG gets `role="group"` with node `aria-label`s ("thrash metal, metal family,
  inherits thrash from metal"). The panel readout is `aria-live="polite"`.

## 8. Layout at scale

Inputs:

- 61 core nodes.
- An unknown number of overlay nodes. MusicBrainz sync creates a node for every related MB genre it
  meets (`genre_descriptions.py:756-765`), and AI proposals add more.
- Unmapped raw tags, usually hundreds from Last.fm-style tagging.
- The Admin Sound Intelligence panel already shows `node_count`, `orphan_count` and
  `unmapped_raw_count`; read those on production to size this.

Changes to `radialLayout`:

1. Primary-parent tree:
   - The layout uses `primary_parent`, chosen server-side as the parent on the shortest path to
     the chosen family (same tie-break as `get_top_level_slug`: depth, then name).
   - Extra parents render as thin secondary arcs and do not affect placement.
   - The cycle guard is a visited set in `weight()` and `place()`; the server also flags `cycle`.
2. Unplaced nodes:
   - Orphans and overlay nodes without a path to a family go into an "unplaced" sector at the end
     of the circle, with a dashed hairline separator. Do not hide them; they are what a curator
     needs to fix.
   - `top_level` nodes that also have a parent are placed as families and flagged.
3. Stable angles:
   - Sector size stays proportional to node count, as in the site (`weight + 2`), so angles do not
     jump when the library changes. Content drives size and opacity, not angle.
   - Family order comes from `families[].order`: core definition order first, then overlay
     families by name.
4. Level of detail. At 600 nodes, ring 2 gets about 0.6 degrees per node, about 2.2 px at r 212 in
   the 760 box, so:
   - Labels are always on for ring 1. Rings 2 and 3 are labelled only for the hovered or pinned
     node, its walk and direct neighbours, plus the top-N by content in each sector.
   - Overlay nodes with `flags.empty` are hidden by default and collapsed into a "+N" tick on the
     family sector, with a "Show empty genres" toggle.
   - Related edges: draw all of them at .06 alpha only when there are 300 or fewer; above that,
     draw them only for the hovered or pinned node.
   - Sector zoom (click a family label) re-runs the layout for that family across 300 degrees.
5. Depth: core is 3 rings deep. Overlay chains can be deeper. Put rings 4 and up at
   256 + 34·(ring − 3) with smaller nodes, or cap the display at ring 4 and show deeper nodes in
   the panel list.

## 9. Rendering and performance

- SVG (recommended):
  - 61 nodes and 149 edges come to about 300 elements. A few hundred overlay nodes come to about
    2-3K elements. One React render per data revision (memoised on `taxonomy.revision` and
    `stats.revision`).
  - Hover is O(degree) `classList` work through a slug-to-element ref map, the same as the site.
  - Expected first render is 10 ms or less at 61 nodes and 30-50 ms at 600. No layout work per
    hover.
- Canvas is not needed:
  - The only case for it is more than about 1.5K visible nodes or 4K edges. Even then, a hybrid
    works: canvas for the related-edge layer, SVG for nodes and labels.
  - `react-force-graph-2d` (canvas) stays only where it is used today; `ArtistNetworkGraph` also
    depends on it.
- Bundle: no new dependency. The math port is about 200 lines.
  - Admin-only first: `app/ui/src/components/genres/GenreWheel.tsx` and
    `app/ui/src/lib/genre-wheel-math.ts`.
  - It moves to `@crate/ui/domain/genres/GenreWheel` (props and callbacks only, like `EqBands`)
    in the same change in which Listen adopts it, per the "both apps" rule and
    `export-usage-policy`.
- Data path: Admin reads the snapshot through FastAPI (local catalog boundary). Listen reads
  through the Go read plane. Neither runs a request-time aggregate.

## 10. Backend work (ordered; each with tests)

1. **Local overrides that survive boot (G1).** Add `core_eq_gains`, `eq_source`
   (`core|manual|ai`) and `metadata_overridden` to `genre_taxonomy_nodes` (migration 108). Change
   the seeder to:
   - always refresh the `core_*` columns;
   - only touch the live columns while their source is `core`;
   - leave core edges locked, but let curators hide one through a `suppressed` edge row instead of
     deleting it.

   Add "reset to core" to the EQ and metadata PATCH. Tests (pg_db):
   - seed, edit, re-seed: the edit is preserved;
   - reset restores core;
   - the core digest is unchanged.
2. **One EQ resolver (G2).**
   - The runtime graph treats DB rows as authoritative when present; the static copy is used only
     when the DB is unreachable.
   - `resolve_genre_eq_preset` returns `path` and `template`.
   - Export `EQ_TEMPLATES`.
   - Align Go `genrePresetSQL` tie-breaks.
   - Tests: Python unit tests for clear-to-inherit and path order; a Go table-driven parity test on
     a fixture graph.
3. **Edge provenance (G3).** MusicBrainz sync passes `source="musicbrainz"`, and a data migration
   relabels existing unlocked MusicBrainz edges where `evidence_json` allows it; otherwise leave
   them as is and document. Fix the health AI filter to `ai_proposal`. Tests for both.
4. **Parent-cycle guard (G7)** in `replace_genre_taxonomy_edges` and `upsert_genre_taxonomy_edge`,
   rejecting with HTTP 400 at the API. Tests.
5. **Wheel snapshot builder:**
   - `db/jobs/genre_wheel.py`, plus a task type `refresh_genre_wheel_snapshot` on the `fast` queue
     with an actor config entry, and a dedup key in `task_dedup_keys.py`.
   - Triggers (section 6) and a projector action.
   - Tests:
     - pg_db fixture counts: DISTINCT across aliases, thresholds, roll-up, cycle bound;
     - `eq.reach`;
     - a latency-contract assertion that the source never references `library_tracks`, as in
       `tests/test_listen_read_latency_contract.py`.
6. **Serve:**
   - `GET /api/genres/taxonomy/wheel`: snapshot only, warming response, schema in
     `api/schemas/genres.py`, OpenAPI contract test.
   - Mutation responses return node or edge patches plus the revision.
   - Phase 2: a readplane route relaying `genre-wheel/crate-core`, with Go tests and a contract
     smoke test.
7. **Remove request-time aggregates:**
   - `/taxonomy/tree` counts and Sound Intelligence health move to the snapshot (G4, G6).
   - The catalog and explore fallbacks serve stale data and enqueue a refresh (G5).
   - Update the tests that assert the old behaviour.
8. **Hygiene:**
   - Resolve the `folk -> americana` dangle at runtime (alias to node, drop duplicates) now; fix
     the code in the next signed core release (G8).
   - Generate the Go family map from the Python descriptor, or add a drift test (G10).
   - Remove or implement the Admin "Generate playlist" action (G9).

## 11. Frontend work

1. Math module, ported from `taxonomy-math.ts` with the section 8 changes:
   - Vitest cases copied from the site (rings, sectors, no overlaps, 61 nodes).
   - New cases: cycle, multi-parent, orphan, unplaced sector, LOD label selection.
   - An `eq.path` test that asserts the same expectations as the Python test
     (`powerviolence -> hardcore-punk`, `funk -> soul`, `thrash-metal -> metal`).
2. `GenreWheel` component: SVG, refs, mini EQ via `useVisibleLoop`, keyboard model. Testing
   Library tests: hover adds `is-path` on the walk; Enter pins; reduced motion; no state update per
   frame (spy on renders).
3. Admin page integration:
   - The wheel is the default view, with the inspector, link mode, EQ blast-radius preview,
     unmapped panel and view-mode chips.
   - Reuse `GenreEqEditor` and the relation field.
   - Tests for the save flows with the API mocked.
4. Listen (phase 2): Explore wheel, genre page locator, Paths route. Move the component to
   `@crate/ui/domain/genres` in that change and run both apps' suites. Listen visual snapshots are
   re-baselined on purpose.

## 12. Open questions for Diego

1. Overrides model (G1): should local edits to core genres persist with a "reset to core" action,
   as the site copy promises? Or should core stay read-only, with curators only adding overlay
   nodes and edges? The site copy currently overpromises.
2. Can curators hide core relations (a suppressed row), or are core edges immutable?
3. Should the wheel be the default Admin Genres view (with tree and grid kept as lists), and should
   the neighbourhood `GenreNetworkGraph` on the genre page be retired?
4. Auto-walk: drop it in the product, or keep it only as an idle state with no selection?
5. Count definitions: adopt the readplane thresholds (artist weight 0.70, album score 0.45)
   everywhere, so Admin and Listen show the same numbers?
6. Listen scope: should the wheel reach Explore, genre pages and Paths in v3, or Admin only first?
   This decides whether the component starts in `@crate/ui`.
7. Nivo rule: confirm that bespoke SVG is allowed for instrument visuals like this one.
8. Next core release: bundle the `folk -> americana` fix with any EQ retunes into a signed 1.0.1?
9. Should taxonomy edits keep broadcasting `library` and `home` (which refresh ops and home
   snapshots in the projector), or narrow to `curation` plus `genre:<slug>`?
