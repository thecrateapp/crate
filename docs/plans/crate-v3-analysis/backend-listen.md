# Crate v3 analysis: real data contracts for the Listen visuals

Status: analysis input for `feat/crate_v3` (read-only pass, no product code changed, no tests or
builds run). Visual reference: the new site only (`worktrees/website/app/web`, prefixed `site:`).
Paths without prefix are relative to the `crate-v3` worktree. Smart Mix code is quoted from
`/Users/diego/Code/Ninja/musicdock/worktrees/smart-mix-phase-1` (prefixed `sm:`), which is not
merged. Companion docs: `site-visuals.md` (inventory of the site visuals), `site-language.md`
(tokens, motion), `genres.md` (taxonomy wheel), `admin-audit.md`.

Status scale used below:

- **REAL**: the product already has the data, with a hot-path-safe source.
- **PARTIAL**: data exists but a field, shape or hot-path rule is missing.
- **MISSING**: no backend source; needs a new projection or field.
- **BRANCH**: exists only on `smart-mix-phase-1`.

---

## 1. Summary

| Site visual | What it needs | Status | Source today | Main gap | Realtime |
| --- | --- | --- | --- | --- | --- |
| EqViz | 10 gains, preset name, Smart EQ chain with the active link | PARTIAL | `GET /api/tracks/{id}/eq` (FastAPI), `eq-features` (readplane), client presets | Payload returns only the winning link; resolver opens up to 6 `read_scope`s per track change | `/api/cache/events` scope `track:eq:{id}` |
| MixViz | BPM, beat grid, downbeats, cues, Camelot, LUFS, plan, live A/B gains, waveform lanes | BRANCH (Android) / PARTIAL (web) | `sm:` `mix-profile`, `transition-plans`; main: client crossfade duration only | No envelope persisted for the lanes; plan never reaches web | Native `transitionStarted/Ended` (branch); Web Audio gain nodes |
| MoodMap | 8 thresholds, per-mood count and centroid, energy x valence density | PARTIAL | `MOOD_PRESETS` + `GET /api/browse/moods` | No density or centroids; counts and track picks run full-catalog SQL in the request | none (snapshot) |
| Heatmap | 7 x 24 minutes, peak, night share, hours, artists, top genre | REAL | `stats:dashboard` snapshot, readplane `GET /api/me/stats/dashboard` | none for the data | `/api/cache/events` scope `history`; `/api/me/stats/today` |
| Federation | Nodes, keys, pairing, grants, relay | PARTIAL (admin only) | `/api/admin/federation/*`; Listen only sees `track.remote.nodeName` | No listener-safe network read model | Domain events `federation.*` (projector) |
| Devices | Platforms, active device, shared queue position, Cast, Subsonic | REAL (scattered) | `/api/me/devices`, Connect WS `connected_instances`, `playback-state`, Cast sessions | No platform-family field; client must merge three sources | Connect WS `/api/me/connect/ws` |
| Setlist ticket | Show, probable setlist, source count, per-song in library / missing | PARTIAL | `GET /api/me/upcoming` (computed per request), `home:discovery` snapshot | `in_library` does not exist; context not exposed; endpoint is not a snapshot | `/api/cache/events` scopes `upcoming`, `shows` |
| Radio dive | Seed, neighbours, weights, scored queue, like shift | PARTIAL | `POST /api/radio/start|next|feedback` | No score breakdown, no target shift, no 3D map; site weights are the Paths weights | none (request/response) |
| Paths dive | Endpoints, planner, genre hops, route through bliss space | PARTIAL | `POST /api/paths` | Planner not returned; computed synchronously in the request; no 3D map | none today; propose task SSE |
| Bliss map (shared by Radio, Paths) | 3D projection of 20-d bliss vectors | MISSING in product | Only `site:../scripts/export_site_library.py` (offline PCA) | Needs a worker-built artefact + basis | none (versioned asset) |

---

## 2. What the player can render live vs what must come from the server

Runtimes differ more than the site suggests. A v3 visual must pick its data source per runtime.

| Runtime | Engine | Live spectrum | EQ | Crossfade | Source for visuals |
| --- | --- | --- | --- | --- | --- |
| Web browsers, Tauri desktop | Gapless-5 on Web Audio (`app/listen/src/lib/gapless-player.ts`, vendored `lib/gapless5/gapless5.js`) | Yes: one `AnalyserNode` per playing source | Web Audio `BiquadFilterNode` chain spliced after `masterOut` (`lib/gapless-player-equalizer.ts`) | Gapless-5 `CrossfadeShape.EqualPower`, duration from `contexts/player-smart-transition.ts` | Web Audio first, server data as fallback |
| iOS Capacitor, iPhone PWA, Android Capacitor web pipeline (default "stable" mode) | HTML5 audio (`lib/mobile-audio-mode.ts`: `canUseWebAudioEffects = !isMobileAudioRuntime || mobileEnhancedAudioEnabledAtStartup`) | No (unless the user turns on enhanced audio) | No | `getEffectiveCrossfadeSeconds` returns 0 on mobile | Server data only |
| Android native (Media3) | `lib/android-native-engine.ts` | No FFT exposed (`audiofx.Visualizer` not used) | Native `setEq` (main) | Smart Mix plans and native decks only on `sm:` | Server data + native events |
| Cast receiver | CAF | Precomputed `cast_spectrum` artefact (24 bands, 100 ms frames, `app/crate/cast_spectrum.py`) | n/a | n/a | Server artefact |
| Subsonic clients | external | none | none | none | n/a |

Web Audio facts that matter for the visuals (from `gapless5.js` lines 386-566 and 1519-1561):

- Graph: `source -> songAnalyser -> gainNode -> masterOut -> [EQ chain] -> destination`.
  The analyser is **per song**, **pre-EQ** and **pre-crossfade gain**. `getAnalyserNode()` only
  keeps the latest one (`currentAnalyser`), so during a crossfade the second deck's analyser and
  both `gainNode`s are invisible to the app.
- What can be live on web without the server:
  - EQ: the real composite response of the 10 peaking biquads via
    `BiquadFilterNode.getFrequencyResponse()` (more honest than the site's spline), plus a
    post-EQ spectrum if one `AnalyserNode` is added after the chain output.
  - Mix: per-deck spectra and per-deck gain (`gainNode.gain.value`) if the vendored patch exposes
    the active sources (`getActiveSources(): {trackPath, analyser, gain}[]`).
  - Progress: `AudioContext.currentTime` / `performance.now()` read inside rAF.
- What is live everywhere without Web Audio: anything derivable from known numbers plus a clock
  (equal-power gains from a transition start time, the EQ curve from gains using the RBJ peaking
  formula, device progress extrapolated from `position_ms + updated_at`).

Hard rule for every visual below: frame-rate values (spectrum, gains, progress, `currentTime`)
are read from refs inside one rAF loop and drawn imperatively (SVG attributes or canvas). They
never go into React state or effect dependency arrays. Two existing hooks already break this and
should not be the template (see section 13).

---

## 3. EqViz (10 bands, 21 presets, Smart EQ chain)

Site: `site:src/components/viz/EqViz.astro`, `site:src/scripts/viz/eq-{math,view}.ts`; data in
`site:src/content/listen/viz.ts` (`EQ_PRESETS` is a copy of the client presets, with a drift test).
v3 already ported the chart to `@crate/ui` `EqBands` and the chain to
`app/listen/src/components/player/EqualizerSmartReadout.tsx` (commit `d91d2c1a`).

### Data today

- Presets and bands are client constants: `app/listen/src/lib/equalizer.ts` (`EQ_BANDS` 32 Hz-16 kHz,
  `EQ_GAIN_MIN/MAX` +-12, `EQ_PRESETS` 21 entries, peaking filters Q 1.41, 80 ms ramps).
- User mode lives in localStorage: `lib/equalizer-prefs.ts` (`enabled`, `preset | "custom"`,
  `gains`, `smart`, `adaptive`, `genreAdaptive`).
- Smart EQ, server side: `app/crate/equalizer.py::resolve_effective_track_eq`. Chain, first hit wins:
  `user_track_preset -> instance_track_preset -> instance_album_preset -> genre_taxonomy_preset
  (with inheritance from parent genres) -> audio_analysis_preset (compute_audio_analysis_gains,
  clamped +-4 dB) -> flat`.
- Endpoints (`app/crate/api/browse_media.py`):
  - `GET /api/tracks/{id}/eq`, `GET /api/tracks/by-entity/{uid}/eq` -> `EffectiveEqualizerResult.to_payload()`:
    `{trackId, trackEntityUid, albumId, albumEntityUid, gains[10], source, label, reasoning, scope,
    targetType, targetEntityUid, userId, genre{slug,name,canonical}, inheritedFrom{slug,name}}`.
  - `GET /api/tracks/{id}/eq-features` (also by entity; **served by the Go readplane**):
    `{energy, loudness, dynamicRange, brightness(=spectral_complexity), danceability, valence,
    acousticness, instrumentalness}`.
  - `GET /api/tracks/{id}/genre` (readplane) for the client genre-adaptive mode.
  - Writes: `PUT|DELETE /api/tracks/{id}/eq-preset` (user), `.../eq-preset/instance` and
    `/api/albums/{id}/eq-preset/instance` (permission `curation.genres.write`). They broadcast
    `library`, `track:{id}`, `track:eq:{id}`, `album:{id}` on `/api/cache/events`.
- Client hooks: `hooks/use-effective-eq.ts`, `hooks/use-eq-features.ts`, `hooks/use-track-genre.ts`,
  `hooks/use-equalizer-runtime.ts` (resolves gains, applies them to Web Audio or
  `androidNativeEngine.setEq`).

### Gaps

1. **The chain is one value, the visual is six.** The payload only names the winner, so the UI
   cannot show which links exist but are shadowed (for example a curator album preset hidden by
   the user's track preset), nor preview them.
2. **Hot path consolidation.** One `GET .../eq` runs `get_track_equalizer_context`, up to three
   `get_equalizer_preset` calls, `get_track_album_genres` and `get_track_artist_genres`, each in its
   own `read_scope()` (no `session=` passed). Up to 6 transactions per track change, on every track
   change, for every listener in Smart mode. Violates "consolidate related reads into one CTE".
3. **Adaptive EQ is implemented twice**: `lib/adaptive-eq.ts::computeAdaptiveGains` and
   `crate/equalizer.py::compute_audio_analysis_gains` are line-for-line twins with no shared test.
   They will drift.
4. **"Your preset" in the site chain** maps to the per-track user preset. The client's global
   manual preset, adaptive and genre-adaptive modes sit outside the chain; the UI must say so
   rather than fake a link.

### Proposed contract (additive, backwards compatible)

```ts
interface EffectiveEqV2 extends EffectiveEq {
  chain: Array<{
    source: EffectiveEq["source"];
    status: "applied" | "shadowed" | "absent";
    label: string | null;
    gains?: number[];           // present for applied and shadowed links (preview on hover)
    genre?: { slug: string; name: string } | null;
    inheritedFrom?: { slug: string; name: string } | null;
  }>;
}
```

Backend: one query in `crate/db/repositories/equalizer_presets.py` that returns the track context,
all three preset candidates (`WHERE (scope, target_type, target_entity_uid, user_id) IN (...)`)
and the album/artist genre rows in a single CTE; `resolve_effective_track_eq` evaluates the whole
chain in memory. Cost goes from up to 6 transactions to 1, and the chain comes for free.

Client live layer (no server):

- Curve: compute the composite magnitude from the current gains with the RBJ peaking formula
  (pure TS function, works on Android native and mobile too), or, on web, call
  `getFrequencyResponse()` on the real chain.
- Spectrum overlay (web only): one post-EQ `AnalyserNode` appended to the chain in
  `gapless-player-equalizer.ts`; optional pre-EQ ghost from the per-song analyser.
- Preset morph: the site's spring per band (`site:eq-math.ts::stepSpring`) drives only the
  drawing; the audio keeps its 80 ms `linearRampToValueAtTime`. Do not couple them.

Tests: pytest for the consolidated resolver (each chain position, shadowing, inheritance, one
`read_scope` asserted); a shared JSON fixture of feature vectors -> gains run by both pytest and
Vitest to pin adaptive parity; Vitest for the RBJ curve function and `EqualizerSmartReadout` chain
states.

---

## 4. MixViz (Smart Mix transition)

Site: `site:src/components/viz/MixViz.astro`, `site:src/scripts/viz/mix-{math,view}.ts`. It draws two
waveform lanes, a beat ruler with downbeats, the fade zone, equal-power curves, A/B gain meters,
Camelot A -> B, LUFS per side, "Beat grid", "BS.1770", "Range 0-12 s".

### Data on main (this worktree)

- Client only: `app/listen/src/contexts/player-smart-transition.ts::getEffectiveCrossfadeSeconds`.
  Feature score = bliss cosine 0.40, BPM 0.20 (half/double aware), key 0.15, energy 0.15,
  danceability 0.05, valence 0.05; score >= 0.78 -> 6 s, >= 0.55 -> 4 s, else 2 s, capped by the
  user crossfade preference. Returns 0 on mobile, Android native and HTML5-only playback.
- Transition state: `CrossfadeTransition {outgoing, incoming, durationMs, startedAt,
  outgoingDurationSeconds}` (`contexts/player-context.ts`); progress via
  `hooks/use-crossfade-progress.ts` (rAF + `setState` every frame).
- Track audio fields available in the queue: `bpm`, `audioKey`, `audioScale`, `energy`,
  `danceability`, `valence`, `blissVector` (`contexts/player-types.ts`). No cues, beat grid or LUFS.

### Data on `smart-mix-phase-1` (BRANCH)

- Domain: `sm:app/crate/smart_mix/{analyzer,beat_grid,camelot,cue_detection,planner,compatible,models}.py`;
  table `track_mix_profiles` (migrations 109, 111, 112, 114).
- `GET /api/tracks/by-entity/{uid}/mix-profile?detail=summary|full` (`sm:app/crate/api/smart_mix.py`),
  summary also served by the readplane (`sm:app/readplane/internal/routes/smart_mix.go`). Fields:
  `bpm, bpmConfidence, tempoStability, beatAnchorMs, downbeatAnchorMs, timeSignature,
  beatGridFormat, beatGridMs (full only), key, scale, camelot, keyConfidence, introCueMs,
  outroCueMs, introLufs, outroLufs, integratedLufs, truePeakDbfs, measurementVersion,
  activeStartMs, activeEndMs, introEnergy, outroEnergy, introSpectralDensity,
  outroSpectralDensity, globalEnergy, danceability, valence, quality`.
- `POST /api/playback/transition-plans` (<= 32 edges, `plannerVersion: "smart-mix-v2"`, cached in
  `cache_store`) -> per edge `{mode: gapless|adaptive|beatmatch, durationMs 0-12000, outgoingCueMs,
  incomingCueMs, incomingTempoRatio 0.94-1.06, beatPhaseOffsetMs, handoffProgress,
  outgoingGainDb, incomingGainDb, curve: "equal-power", bassHandoff, confidence, fallbackReason}`.
- `GET /api/tracks/by-entity/{uid}/compatible` (score breakdown tempo, harmonic +
  relationship, energy, danceability, valence, bliss, genre).
- Auth: `_require_vdj_scope` lets session users through; access tokens need `vdj.smart_mix.read`.
- Listen: `sm:app/listen/src/lib/smart-mix.ts` (`SmartMixTransitionPlanner`, 1000 ms planning
  deadline), `EngineTransitionPlan`, native events `transitionStarted`, `transitionEnded`,
  `transitionCancelled`, `crossfadeChanged`, `eqChanged` with `{durationMs, startedAtNativeMs,
  progress, outgoingVolume, incomingVolume}` (`sm:app/listen/src/lib/playback-engine.ts`); the
  Android service does not emit `transitionProgress` even though the type exists.
  `sm:lib/native-transition-visual.ts` maps native events to `CrossfadeTransition`.

### Mapping site -> real field

| Site element | Source |
| --- | --- |
| `124 BPM` | outgoing `profile.bpm` |
| `4 bars`, `7.7 s` | `plan.durationMs` / (`60000 / bpm` x `timeSignature`) |
| Beat ruler, lit downbeats | `beatGridMs` (`detail=full`) + `downbeatAnchorMs` + `timeSignature`; scale B by `incomingTempoRatio` |
| Cue labels `outro cue 3:41.2` / `intro cue 0:00.4` | `plan.outgoingCueMs`, `plan.incomingCueMs` |
| `8A -> 9A` | `profile.camelot` both sides; relationship from `compatible` breakdown or `camelot.py` |
| `-9.1 LUFS` | `profile.integratedLufs` (`measurementVersion` names BS.1770) |
| Equal-power curves | `plan.curve` + `durationMs`; offsets `outgoingGainDb`, `incomingGainDb` |
| A/B meters | live: native `outgoingVolume/incomingVolume` at start/end, extrapolated `cos/sin(pi t / 2)` in between; web: deck `gainNode.gain.value` |
| Waveform lanes | **missing** |
| `fallbackReason` (not on site) | show as a mono status when the plan degrades |

### Gaps

1. **Smart Mix is not on main.** Until it merges, MixViz on web shows the client crossfade
   (duration, equal-power shape, A/B features from the queue) and must label itself as such.
2. **No envelope for the lanes.** `sm:cue_detection.py` computes 50 ms frame RMS and discards it.
   The only persisted audio envelope is the Cast spectrum artefact, generated lazily on the heavy
   queue (`generate_cast_spectrum`, 1200 s timeout) and only for Cast items.
3. **The plan never reaches web clients.** `CrossfadeTransition` has no plan; the web engine does
   not request plans.
4. **Web deck internals are private** to Gapless-5 (second analyser and both gain nodes).

### Proposed contract

- Persist a compact envelope in the Smart Mix analysis (same decode, zero extra I/O):
  `track_mix_profiles.rms_envelope BYTEA` (uint8 dBFS, -60..0 dB, 10 Hz; ~2.4 KB for 4 min),
  exposed only in `detail=full` as `envelope: {rateHz: 10, encoding: "u8-dbfs-60", data: base64}`.
  Clients fetch it for the current and next track only (the planner already knows the edge).
- Client composite, built in Listen without new endpoints:

```ts
interface MixVisualModel {
  source: "server-plan" | "client-smart" | "fixed";
  outgoing: MixSide;
  incoming: MixSide;
  plan: {
    mode: "gapless" | "adaptive" | "beatmatch" | "crossfade";
    durationMs: number;
    curve: "equal-power";
    outgoingGainDb: number;
    incomingGainDb: number;
    tempoRatio?: number;
    confidence?: number;
    fallbackReason?: string | null;
  };
  startedAt: number;          // performance.now() base; progress is read from a ref
}
interface MixSide {
  trackId: string;
  bpm?: number | null;
  camelot?: string | null;
  lufs?: number | null;
  cueMs?: number | null;
  beatGridMs?: number[];
  downbeatAnchorMs?: number | null;
  timeSignature?: number | null;
  envelope?: { rateHz: number; values: Uint8Array };
}
```

- Add `plan?: EngineTransitionPlan` to `CrossfadeTransition` (client-only field).
- Vendored Gapless-5 patch: `getActiveSources()` for per-deck analyser + gain (web live meters
  and per-deck spectra).

Tests: pytest for envelope quantisation and `detail=full` serialisation; Vitest for
`MixVisualModel` builders (server plan, client fallback, missing profile) and the equal-power
extrapolation; Android unit test that `transitionStarted` carries `startedAtNativeMs`.

---

## 5. MoodMap (8 moods on energy x valence)

Site: `site:src/components/viz/MoodMap.astro`, `site:src/scripts/viz/mood-{math,view}.ts`. Thresholds
are a drift-tested copy of the backend; the point cloud is synthetic Gaussian noise and four moods
(energetic, intense, groovy, acoustic) use hand-picked `lean` centres because their filters are not
on the energy/valence plane.

### Data today

- `MOOD_PRESETS` lives in `app/crate/api/browse_media.py:1643` (8 presets, identical to the site).
- `GET /api/browse/moods` -> `[{name, track_count, filters}]`, cache-aside `listen:browse_moods:v2`
  (600 s). On a miss, `count_mood_presets` runs `COUNT(*) FILTER (...)` for all 8 presets over
  `global_catalog_tracks` joined to `library_tracks`, `track_analysis_features` and remote sources
  (`app/crate/db/queries/browse_media_mood.py`) **inside the HTTP request**.
- `GET /api/browse/mood/{mood}?limit=50` -> random tracks: the same CTE plus `ORDER BY RANDOM()`,
  i.e. a full scan **on every request**.
- Bundled into `GET /api/browse/explore-page` (cache-aside per user, 600 s) consumed by
  `pages/Explore.tsx` -> `MoodBrowseSection` (`pages/ExploreLandingSections.tsx`).
- Per-track features: `track_analysis_features` (energy, valence, danceability, acousticness,
  instrumentalness, loudness, dynamic_range, spectral_complexity, bpm, key, `mood_json`), exposed via
  `eq-features` (readplane) and on queue tracks (`energy`, `valence`, `danceability`).
- Personal profile: stats dashboard `story.audio_profile {energy, danceability, valence, bpm}` and
  `tape.mood[] {bucket, energy, valence}` (section 6).

### Gaps

1. No density and no real centroids; the plane cannot be drawn from data today.
2. Hot-path violations: catalog-wide COUNT on a cache miss and `ORDER BY RANDOM()` per click.
3. `MOOD_PRESETS` sits in an API module, so a worker cannot import it without importing FastAPI
   routes.
4. `listen:browse_moods:v2` is not covered by any invalidation prefix in
   `db/cache_invalidation.py`; counts only expire by TTL.

### Proposed contract

Move `MOOD_PRESETS` to a domain module (`crate/moods.py`). A worker job builds a global snapshot
`ui_snapshots('explore:moods', 'global')`, debounced (300 s, like `stats:dashboard:instance`) after
analysis batches complete and on a nightly schedule; the readplane serves it.

```json
{
  "version": 1,
  "built_at": "2026-10-15T10:00:00Z",
  "axes": { "x": "valence", "y": "energy" },
  "bins": 24,
  "density": "<base64 uint16, 24 x 24, row-major from high energy>",
  "analysed_tracks": 39876,
  "moods": [
    {
      "id": "energetic",
      "filters": { "energy_min": 0.7, "danceability_min": 0.5 },
      "track_count": 3120,
      "centroid": { "energy": 0.81, "valence": 0.58 },
      "spread": { "energy": 0.07, "valence": 0.12 },
      "pool": ["<track_entity_uid>", "... up to 500"]
    }
  ]
}
```

- `GET /api/browse/moods` and `explore-page` read `moods[].track_count` from the snapshot.
- `GET /api/browse/mood/{mood}` samples `limit` ids from `pool` in memory and hydrates them with
  one `ANY(:ids)` query. No table scan in the request.
- Overlays, all client-side: "you" from `story.audio_profile`, a trail from `tape.mood`, and the
  now-playing dot from the current track's `energy`/`valence`.

Tests: pytest for the builder (bins, centroids, pools, a mood with zero tracks) and that the mood
endpoints do not touch `library_tracks` (query-count assertion); Vitest for density decoding and
overlay placement.

---

## 6. Heatmap (listening 7 x 24)

Site: `site:src/components/viz/Heatmap.astro`, `site:src/scripts/viz/heatmap-{math,view}.ts`
("synthetic listener").

### Data today: REAL

- `GET /api/me/stats/dashboard?window=7d|30d|90d|365d|all_time|year:YYYY|month=YYYY-MM` serves the
  persisted `ui_snapshots('stats:dashboard', <user>)`, stale-first, from the Go readplane
  (`app/readplane/internal/routes/stats_dashboard.go`); the worker prewarms 30d, 90d, current year
  and all time. Contract pinned by `app/tests/fixtures/stats_dashboard_contract.json` and documented
  in `docs/technical/listening-stats-projections.md`.
- `heatmap` is built in `app/crate/db/queries/user_library_stats_signal.py::_heatmap` from the
  `user_hourly_listening` projection, in the user's timezone:
  `{cells: number[7][24] (minutes, ISO weekday 0 = Monday), peak: {weekday, hour} | null,
  night_share}` with night hours 22-05. This is exactly the site's `Heatmap` interface.
- Site counters map 1:1: hours = `overview.minutes_listened / 60`, artists =
  `highlights.artist_count`, top genre = `top_genres.items[0]` (or `genre_trend[0]`), period =
  `window`.
- Variants: instance-wide `GET /api/stats/dashboard` (`stats:dashboard:instance`), other users
  `GET /api/users/{username}/stats/dashboard`.
- Live: `GET /api/me/stats/today` reads Redis `stats:today:{user}:{day}` (incremented after each
  play commit); `/api/cache/events` scope `history` invalidates the dashboard;
  `hooks/use-pending-stats-snapshot-refresh.ts` polls every 1.5 s (max 40 times) while the
  snapshot is pending.
- Listen: `components/stats/StatsHeatmapCard.tsx`, `components/stats/stats-model.ts`
  (`StatsHeatmap`), `pages/use-stats-page-controller.ts`.

### Gaps

None for the data. Optional, client-only: pulse the cell for "now" (weekday/hour in
`dashboard.timezone`) and add today's minutes from `stats/today` to that cell as a provisional
overlay. Per-cell top artist for the hover readout would need a new projection; not worth it.

Tests: Vitest for the cell scale, peak and night band against the contract fixture.

---

## 7. Federation (node to node, signed, relayed)

Site: `site:src/components/viz/Federation.astro`, `site:src/scripts/viz/federation-view.ts`
(descriptor -> signed -> approved -> grant -> relay, three peers with Ed25519 fingerprints, "your
listener never sees the peer URL"). `site-visuals.md` assigns this visual to Admin; the Listen part
is the relay moment and an optional network view.

### Data today

- Listen sees federation only per track: `Track.origin: "local" | "remote"` and
  `track.remote {nodeUid, nodeName, remoteEntityUid, availability}` (`contexts/player-types.ts`);
  global mood/search payloads carry `origin` and `node_uid`.
- Playback: `POST /api/federation/remote/nodes/{node}/tracks/{uid}/playback` ->
  `{stream_url (local relay), expires_at, delivery_policy, playback_session, content_origin}`
  (`lib/remote-track-playback.ts`); bytes flow through the readplane relay
  `/api/federation/remote/streams/{ticket}`.
- Admin only (`app/crate/api/admin_federation.py`, prefix `/api/admin/federation`): `status`,
  `nodes` (`SELECT * FROM federation_nodes`), `health`, `streams`, `streaming-stats`, `audit`,
  `risk`, pairing start/approve, presets (`off`, `discovery`, `catalog`, `listen`,
  `trusted_library` in `crate/federation/grants.py`), key rotation.
- Domain events `federation.catalog.peer.stale`, `federation.stream.ticket.created`,
  `federation.stream.proxy.completed|failed`, `federation.import.*` already reach the projector.

### Gaps

No listener-safe read model. Exposing `/api/admin/federation/nodes` is not an option: it returns
base URLs, pending peers and raw rows.

### Proposed contract

Projector-built `ui_snapshots('federation:network', 'global')`, refreshed on `federation.*` events
and after the health poll; readplane serves `GET /api/me/federation/network`.

```json
{
  "local": { "display_name": "lespedants", "key_fingerprint": "ed25519 4c1e...9a07" },
  "peers": [
    {
      "node_uid": "...",
      "display_name": "north.crate",
      "key_fingerprint": "ed25519 9f2c...a1d3",
      "capabilities": { "search": true, "stream": true, "import": false },
      "health": "ok",
      "last_sync_at": "2026-10-15T09:12:00Z",
      "catalog": { "artists": 212, "albums": 940, "tracks": 10210 }
    }
  ],
  "relay": { "streams_24h": 37, "active_streams": 1 }
}
```

Only approved peers; never base URLs, tickets or pending state. Catalog counts come from
`global_catalog_sources` grouped by node inside the snapshot builder, not per request. The relay
moment in the player needs no endpoint: when the current track is `origin === "remote"`, draw
`peer -> your node -> you` from `track.remote.nodeName` and the playback response
(`delivery_policy`, `expires_at`).

Tests: pytest for the builder (pending and disabled peers excluded, no URL fields in the payload);
Go table test for the readplane route; Vitest for the relay chip on remote tracks.

---

## 8. Devices (one library, one queue position)

Site: `site:src/components/viz/Devices.astro` (CSS-only animation: desktop, Android, PWA, Cast,
Subsonic, a shared progress bar).

### Data today: REAL, spread over four sources

- Registered devices: `GET /api/me/devices` -> `DeviceResponse {device_id, device_label,
  device_type, app_platform, app_version, capabilities {can_play, can_receive_commands,
  can_background_play, can_set_volume, supports_native_audio, supports_cast_sender}, last_seen_at,
  active}`; `PUT /api/me/devices/current` (+ `/presence`), `DELETE /api/me/devices/{id}`
  (`app/crate/api/playback_state.py`, `api/schemas/playback_state.py`).
- Queue position: `GET|PUT /api/me/playback-state/current` -> `PlaybackStateResponse {device_id,
  status, track_*, title, artist, album, position_ms, duration_ms, queue, play_source,
  updated_at, app_platform, device_type}`.
- Live: Crate Connect WebSocket `/api/me/connect/ws` (ticket from `/ws-ticket`), messages `hello`,
  `player_state`, `player_state_update`, `connected_instances {instances[], active_instance_id}`,
  `transfer_incoming|committed|failed`, `became_inactive` (`api/connect_ws.py`,
  `db/repositories/connect_ws_hub.py`); SSE fallback `/api/me/connect/events`; session
  `/api/me/connect/session`.
- Cast: `/api/me/cast/sessions` (+ receiver `/api/cast/sessions/{lease}/state|checkpoints`).
- Subsonic clients appear as one device (`QUEUE_DEVICE_ID`, `device_type: "subsonic"`, label = client
  name) via `crate/subsonic/services/queues.py`.
- Listen: `components/settings/ConnectDevicesSection.tsx`, `lib/crate-connect.ts`,
  `hooks/crate-connect-ws-message-handler.ts`, `lib/remote-playback-state.ts`,
  `lib/cast-session-client.ts`.

### Gaps

1. No normalised platform family; `app_platform` is free text (`"subsonic"` client names, web,
   desktop, android).
2. The visual needs a merge of devices + live presence + playback state; doing it in each component
   invites duplicate subscriptions.

### Proposed contract

- Additive server field `platform_family: "desktop" | "android" | "ios" | "web" | "pwa" | "cast" |
  "subsonic"` derived in `DeviceResponse` from `device_type`/`app_platform`.
- One client selector (`useDeviceConstellation`) that merges `/api/me/devices`,
  `connected_instances` and `player_state_update`, keyed by `device_id`. Progress per device is
  extrapolated in a rAF loop from `position_ms`, `updated_at` and `status`; the store holds only the
  last server values.

Tests: pytest for `platform_family` mapping; Vitest for the merge (offline device, active device
switch, Subsonic queue device).

---

## 9. Setlist ticket (upcoming show + probable setlist)

Site: `site:src/components/viz/Setlist.astro` ("12 recent shows · Setlist.fm", per-song "in library" /
"missing", "10 of 11 playable from your library"). v3 already renders the ticket
(`components/upcoming/UpcomingShowExpandedView.tsx`, commit `50854a6e`) without the status column.

### Data today

- Model: `app/crate/setlistfm.py`. Cached per artist in `cache_store`:
  `{model_version, context {mode: active_tour | recent_shows | historical_weighted,
  source_show_count, source_date_from, source_date_to, tour_name?}, songs [{title, frequency,
  play_count, last_played, position?, on_tour, tour_name?}]}`. TTL 24 h during an active tour.
  Refreshed by the worker task `refresh_probable_setlist` (fast queue), which broadcasts
  `upcoming` and `artist:{slug}`.
- Surfaces:
  - `GET /api/me/upcoming` (`app/crate/api/me.py:1437`): **computed per request** (followed
    artists, user row, releases, shows, attendance, genre map, one cache read per show artist,
    insights, plus IP geolocation in `near_me` mode). Returns `probable_setlist[:8]`, songs only,
    no context.
  - `home:discovery` snapshot, section `upcoming` (`db/home_builder_upcoming_feed.py`), full song
    list, no context.
  - Artist page `probable_setlist[:10]` (`api/browse_artist.py`).
  - `api_artist_setlist_playable` (`api/browse_artist.py:1919`): matches setlist titles against
    the artist's library tracks with `_match_setlist_track` **per request**.
- Listen types: `components/upcoming/upcoming-model.ts` `probable_setlist?: {title, position?,
  frequency?}[]`.

### Gaps

1. `in_library` does not exist on any upcoming surface.
2. `context` (show count, mode, tour) is computed and cached but not exposed.
3. `/api/me/upcoming` is not a snapshot; the Radar page pays the whole build on every visit.
4. `_load_probable_setlists` and `_probable_setlists_for_artists` read the cache once per artist.

### Proposed contract

Library status is an instance property of (artist, song), not a per-user one, so compute it where
the setlist is computed:

- Move `_match_setlist_track` and its title normalisation out of the API module into a domain
  module (`crate/setlist_matching.py`).
- In `refresh_probable_setlist`, after predicting: one `get_artist_setlist_tracks(name)` query,
  match, and store per song `library` plus `matched_at` in the same cache payload.
- Re-match without calling Setlist.fm when the artist's library changes: on `artist:{slug}`
  invalidation after sync or import, enqueue a deduplicated `rematch_probable_setlist(artist)`.
- Surfaces copy the stored result. `/api/me/upcoming` becomes snapshot-backed
  (`ui_snapshots('upcoming', <user>)`), warmed by the projector on `user.follows.changed`, the
  `shows`/`upcoming` scopes and attendance changes, and served by the readplane. Batch the setlist
  cache reads (`get_many`) in the builder.

```ts
interface ProbableSetlistSong {
  title: string;
  position?: number;
  frequency?: number;
  play_count?: number;
  on_tour?: boolean;
  library: {
    status: "local" | "remote" | "missing";
    track_entity_uid?: string;
    library_track_id?: number;
    global_track_uid?: string;
  };
}
interface ProbableSetlistContext {
  mode: "active_tour" | "recent_shows" | "historical_weighted";
  source_show_count: number;
  source_date_from?: string | null;
  source_date_to?: string | null;
  tour_name?: string | null;
  matched_at: string;
}
// on UpcomingItem (show):
//   probable_setlist?: ProbableSetlistSong[]        (cap 20, UI decides how many to show)
//   probable_setlist_context?: ProbableSetlistContext
//   probable_setlist_summary?: { total: number; local: number; remote: number; missing: number }
```

`remote` means a permitted federated copy exists in the global catalog; the ticket can show it as
playable through your node.

Tests: pytest for matching moved to the domain module (existing cases carried over), the rematch
task (no Setlist.fm call, dedup key), snapshot builder (context and summary present, one batched
cache read); Vitest for the ticket rows per status and the summary line.

---

## 10. Radio dive (seed, neighbours, score, queue, feedback)

Site: `site:src/components/listen/RadioDive.astro`, `site:src/scripts/listen/{radio,scene,dive}.ts`
over the WebGL field. The field loads a real cloud when `/data/library-cloud.{json,bin}` exists.

### Data today

- `POST /api/radio/start {mode, seed_type, seed_value}` -> `{session_id, mode, seed_label,
  tracks[]}`; `POST /api/radio/next`; `POST /api/radio/feedback` -> `{status, effect:
  target_shifted | exclusion_added | none, liked_count, disliked_count}`; `DELETE
  /api/radio/session/{id}`; `GET /api/radio/can-discover`; seeded GETs (`/api/radio/track`,
  `/album/{id}`, `/playlist/{id}`, `/api/artists/{id}/radio`) -> `RadioResponse {session {type,
  name, seed}, tracks: RadioTrack {score, bpm, audio_key, audio_scale, energy, danceability,
  valence, bliss_vector[20]}}` (`api/radio.py`, `api/schemas/radio.py`).
- Engine `app/crate/radio_engine.py`: session in Redis (24 h) with `initial_target`,
  `current_target`, liked/disliked vectors. Profiles: track radio (bliss 0.16, artist affinity 0.30,
  genre 0.20 + source penalties), contextual (0.01 / 0.44 / 0.26), discovery. Neighbours by pgvector
  cosine (`<=>` in `db/queries/bliss_similarity_candidates.py`). Dislike radius 0.10. Likes blend the
  target 8% per like, capped at 40% (`queue_engine.blend_target_towards`) - matches the site.

**Copy mismatch to fix on the site or in the visual:** the site's Radio weights (sound 0.34,
artists 0.22, genre 0.16, BPM 0.09, energy 0.08, Camelot 0.05, era 0.03) are the **Paths**
candidate weights (`app/crate/db/paths_candidates.py::_W_*`). Radio uses the profile weights above.

### Gaps

1. Picks carry one `score`; no breakdown and no candidate source.
2. The target and its shift are not returned, so "a like moves the target 8%" cannot be drawn.
3. No 3D map (section 12).

### Proposed contract (additive, no new queries)

```ts
interface RadioTrackV2 extends RadioTrack {
  source?: "seed" | "similar" | "genre" | "bliss";
  score_breakdown?: {
    bliss: number;
    artist_affinity: number;
    genre_overlap: number;
    source_penalty: number;
    variant_penalty: number;
  };
}
interface RadioTargetState {
  shift: number;            // 0..0.4, min(0.4, 0.08 x likes)
  liked_count: number;
  disliked_count: number;
  vector?: number[];        // 20-d current_target, projected client-side with the bliss map basis
  map_revision?: string;
}
// start/next/feedback responses gain: target: RadioTargetState; profile: { name, weights }
```

The values already exist inside `_select_radio_candidate_from_rows`; returning them is free.

Tests: pytest for the breakdown summing to the score and for the shift curve; Vitest for the
weights panel reading `profile.weights` instead of constants.

---

## 11. Paths dive (endpoints, planner, route)

Site: `site:src/components/listen/PathsDive.astro`, `site:src/scripts/listen/paths.ts` ("Music Paths
· 6 steps · 92 -> 128 BPM", "Saved · can be regenerated").

### Data today

- `POST /api/paths {origin, destination, waypoints, step_count 5..100}` (Listen UI caps at 50,
  `pages/Paths.tsx`), `GET /api/paths`, `GET|DELETE /api/paths/{id}`, `POST
  /api/paths/{id}/regenerate`, `POST /api/paths/preview` (`api/paths.py`).
- Planning (`db/paths_service_planning.py`): without waypoints, `compute_scene_path` first (genre
  graph shortest route with parent/child/influence 1.0, fusion 1.6, related 2.5 in
  `db/paths_scene.py`, plus artist scenes); otherwise or on failure, `compute_path` interpolates
  in bliss space with one pgvector KNN per step (`db/paths_path_builder.py`, weights in
  `paths_candidates.py`). Optional LLM review in `db/paths_llm_refinement.py`.
- Step payload: `{step, progress, track_id, entity_uid, title, artist, album*, bpm, audio_key,
  audio_scale, energy, danceability, valence, bliss_vector, distance, path_genre?}`.

### Gaps

1. The planner used is not recorded; only scene steps carry `path_genre`.
2. Planning runs synchronously in the HTTP request: up to `step_count` sequential KNN queries plus
   graph loads.
3. No 3D map (section 12).

### Proposed contract

- Path payload gains `planner: "genre_graph" | "artist_scene" | "bliss_line"` and, for the genre
  planner, `genre_route: [{slug, name, edge: "parent" | "child" | "influence" | "fusion" |
  "related", cost}]` (slugs compatible with `/api/genres/{slug}/graph`).
- Move create/regenerate to a deduplicated worker task (`compute_music_path`) that streams each
  planned step on `/api/events/task/{task_id}`. That stream is the live source for the dive
  animation (nodes appear as they are planned) and takes the KNN loop out of the request. Preview
  stays cached.

Tests: pytest for `planner` and `genre_route` per planner and for task progress events; Vitest for
the route view consuming streamed steps.

---

## 12. Shared foundation: bliss map (3D projection)

Needed by the Radio and Paths dives and by any "where am I in my library" view.

- Product: nothing. Bliss vectors are 20-d (`db/bliss_vectors.py`, `track_bliss_embeddings`,
  pgvector).
- Website precedent: `site:../scripts/export_site_library.py` projects up to 40K vectors to 3D with
  SVD/PCA and writes `library-cloud.bin` (int16 xyz) + `.json {count, radius, seed}`; the site's
  `loadLibraryCloud` decodes it. Its query module `crate.db.queries.site_library_sample` exists only
  in the website worktree.

Proposed: worker task `build_bliss_map` (heavy or maintenance queue, dedup key, debounced after
analysis batches, nightly). It writes a versioned artefact under the data root, like
`cast-spectrum/`, and a small snapshot:

```json
// ui_snapshots('bliss:map', 'global')
{
  "revision": "2026-10-15T03:00Z-9f1c",
  "count": 47812,
  "radius": 1.5,
  "basis": { "mean": [20 floats], "components": [[20], [20], [20]], "scale": 0.83 },
  "asset": "/api/bliss/map/2026-10-15T03:00Z-9f1c.bin",
  "sample_asset": "/api/bliss/map/2026-10-15T03:00Z-9f1c.12k.bin"
}
```

The asset is `int16 xyz` plus `uint32` track ids (about 290 KB + 190 KB before gzip for 48K
tracks; a 12K sample for mobile), served immutable by the readplane. Because Radio and Paths
payloads already carry `bliss_vector`, the client projects seeds, targets, picks and path steps
with the basis (pure function). No new per-request computation; the API never writes the file.

Tests: pytest for projection stability and artefact layout; Go test for the immutable asset route;
Vitest for client projection parity with the Python basis (shared fixture).

---

## 13. Realtime channels and performance risks

### Channels relevant to Listen visuals

| Channel | Transport | Carries | Visuals |
| --- | --- | --- | --- |
| `/api/cache/events` (FastAPI, relayed by readplane) | SSE | Invalidation scopes: `history`, `upcoming`, `shows`, `track:eq:{id}`, `album:{id}`, `artist:{slug}`, `library` | Heatmap, Setlist, EqViz |
| `/api/me/connect/ws` (+ `/api/me/connect/events` SSE) | WebSocket | `player_state_update`, `connected_instances`, transfers | Devices |
| `/api/me/home/discovery-stream` | SSE | Home snapshot updates (includes `upcoming`) | Setlist on Home |
| `/api/events/task/{task_id}` | SSE | Task progress | Paths (proposed), setlist refresh |
| Capacitor native events (Android) | in-process | `transitionStarted/Ended/Cancelled`, `crossfadeChanged`, `eqChanged` (branch) | MixViz, EqViz |
| `/api/me/stats/today` | polling | Redis today counter | Heatmap |

No new SSE channel is required. Proposed snapshots (`explore:moods`, `federation:network`,
`upcoming`, `bliss:map`) notify through the existing invalidation stream.

### Performance risks found (flag before merge)

1. `GET /api/browse/moods` and `explore-page` on a cache miss: `COUNT(*) FILTER` x 8 over the full
   global catalog join, in the request. `GET /api/browse/mood/{mood}`: `ORDER BY RANDOM()` full scan
   per click. (Section 5.)
2. `GET /api/me/upcoming` builds everything per request, including IP geolocation. (Section 9.)
3. `resolve_effective_track_eq`: up to 6 `read_scope`s per track change. (Section 3.)
4. `POST /api/paths`: up to 100 sequential KNN queries in the request. (Section 11.)
5. Client: `hooks/use-audio-visualizer.ts` copies the 1024-bin spectrum into a new array and calls
   `setState` about 20 times per second; it is used by `usePlayerBarController` (the whole bar
   controller re-renders) and by `Sidebar` during Discovery Radio. `hooks/use-crossfade-progress.ts`
   calls `setState` every frame during a crossfade. v3 visuals need one shared rAF sampler that
   writes into typed arrays held in refs, with subscribers that draw imperatively.
6. `api_artist_setlist_playable` matches titles per request (superseded by section 9).
7. Small bug seen on the way: `api/curation.py` follow/unfollow delete `listen:explore_page:v1:{user}`
   but the key is `v2` (`api/browse.py`), so the user's followed state on Explore can stay stale for
   up to 600 s.

---

## 14. Suggested order

1. Client live layer (no backend): shared rAF audio sampler with refs, RBJ EQ curve, post-EQ
   analyser, Gapless-5 `getActiveSources()`. Fixes risk 5 and unlocks EqViz and web MixViz.
2. Effective EQ consolidation + `chain` (section 3).
3. Setlist `library` status + context, then `/api/me/upcoming` as a snapshot (section 9).
4. `explore:moods` snapshot and MoodMap (section 5).
5. `bliss:map` artefact, then Radio and Paths additive fields, then Paths as a task (sections 10-12).
6. Devices selector and `platform_family` (section 8).
7. `federation:network` once the visibility question is decided (section 7).
8. MixViz server data and `rms_envelope` when Smart Mix merges (section 4).

## 15. Open questions for Diego

1. Federation in Listen: should every listener see the network view, only users with a permission,
   or only the relay chip on remote tracks?
2. Should the site's Radio weights panel show Radio's real profile weights (and the copy be
   corrected), or should it stay a Paths visual?
3. MixViz on web and desktop: show the client smart crossfade with an explicit "client" label until
   Smart Mix merges, or hide the visual outside Android?
4. `rms_envelope`: add it to the Smart Mix branch before merge (new migration there), or as a
   follow-up migration on main after the merge?
5. `/api/me/upcoming` in `near_me` mode depends on the request IP. Snapshot it per last detected
   location (stored on the user) or keep that mode computed per request?
6. Setlist status `remote` (playable through a federated peer): show it as playable on the ticket,
   or count only local copies as "in library"?
