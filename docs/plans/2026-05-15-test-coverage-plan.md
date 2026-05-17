# Test Coverage Improvement Plan

## Goal

Increase test coverage across JS/TS, Rust, and Go codebases, starting
with the most critical infrastructure shared by all apps. Python backend
tests are deferred to a later iteration.

## Current State

| Ecosystem | Test files | Test functions | Coverage tooling | Key gaps |
|---|---|---|---|---|
| JS/TS | 106 files | ~200 | Vitest (no thresholds) | `shared/web/` (0 tests), listen pages (10%), listen components (15%) |
| Rust | 3 projects | 64 `#[test]` fns | None | `ml.rs`, `metadata.rs`, `http.rs` |
| Go | 14 files | 58 funcs | None | 27 helpers untested, 14+ route handlers untested |

### Pattern quality assessment

**JS/TS** — Good foundation. `renderWithListenProviders()` wraps components
with MemoryRouter + 5 mockable context providers. `renderHook()` used in 20
files. `getByRole` in 69 locations. Issues: listen uses legacy `fireEvent`
instead of `userEvent` (7 files); ui app lacks a shared `renderWithProviders`
wrapper; `@testing-library/user-event` not declared in workspace packages.

**Rust** — Correct but primitive. Tests use real data (synthetic WAV files
via `create_test_wav()`) with `tempfile::TempDir` for filesystem isolation.
Good helper factories in `tests/common/mod.rs`. Issues: no parametrized
testing (5 `scan_directory_accepts_*` are near-identical copies); media-worker
lacks `tempfile` as dev-dependency; no coverage tooling.

**Go** — Idiomatic "bare metal" style. `httptest.NewRequest()` +
`httptest.NewRecorder()` for HTTP handlers. Contract smoke tests
(`cmd/readplane-contract-smoke/`) compare FastAPI vs readplane responses.
Issues: no `t.Run()` subtests; no assertion library (manual `t.Fatalf`
throughout, despite testify being available transitively); 14+ route handlers
have zero HTTP tests; no coverage tooling.

---

## Phase 1: Unify Test Patterns (~2-3 days)

Do this first — write all new tests with the corrected patterns.

### JS/TS

| Task | Files | Effort |
|---|---|---|
| Migrate `fireEvent` → `userEvent` in listen tests | 7 test files, ~30 call sites | 1-2 hours |
| Create `renderWithAdminProviders()` for ui app | 1 new file + refactor ~12 existing tests | 2-3 hours |
| Declare `@testing-library/user-event` in `app/ui/package.json` and `app/listen/package.json` devDependencies | 2 package.json files | 10 min |

### Rust

| Task | Files | Effort |
|---|---|---|
| Add `rstest` to `tools/crate-cli/Cargo.toml` dev-deps; refactor parametrizable tests (`scan_tests.rs`, `analyze_tests.rs`) | 1 Cargo.toml + ~15 tests | 2 hours |
| Add `tempfile` to `app/media-worker/Cargo.toml` dev-deps; migrate `test_dir()` helper | 1 Cargo.toml + `package.rs`, `cache.rs`, `progress.rs` | 1 hour |

### Go

| Task | Files | Effort |
|---|---|---|
| Add `testify/assert` to `go.mod`; migrate manual assertions | 14 test files, ~100 assertion sites | 1-2 hours |
| Adopt `t.Run()` subtests in test files where multiple cases share setup | 14 test files | 1 hour |
| Add `go test -cover` to Makefile `readplane-test` target | Makefile | 10 min |

### Coverage tooling (all 3 ecosystems)

| Task | Effort |
|---|---|
| Add coverage thresholds to vitest configs (80% branches, 80% functions, per-package opt-out for gapless5) | 30 min |
| Add `cargo llvm-cov` step to `.github/workflows/test-native-tools.yml` CI | 1 hour |
| Add `go test -coverprofile=coverage.out` to Makefile and CI readplane step | 10 min |

---

## Phase 2: Core Infrastructure Tests (~10-14 days)

Priority ordered by criticality — infrastructure shared by all apps first.

### JS/TS (~1,430 LOC to cover, 5-7 days)

| # | Module | LOC | Why critical |
|---|---|---|---|
| 1 | `app/shared/web/api.ts` | 131 | HTTP client factory shared by listen AND admin. Both apps break if this fails. |
| 2 | `app/shared/web/use-api.ts` | 104 | SWR hook factory with cache, SSE invalidation, reconnection. Used everywhere. |
| 3 | `app/shared/web/utils.ts` | 51 | `formatDuration`, `encPath`, `formatSize`, `timeAgo` — used in dozens of components. |
| 4 | `app/listen/src/lib/api.ts` | 429 | Auth header injection, token refresh, SSE URLs, asset URLs, multi-server base URL. Single entry point to the API from listen. |
| 5 | `app/listen/src/lib/cache.ts` | 345 | Dual-layer cache (memory + localStorage) with SSE invalidation and LRU eviction. |
| 6 | `app/listen/src/lib/sse.ts` | ~40 | SSE channel state tracking. |
| 7 | `app/listen/src/lib/gapless-player.ts` | ~150 | Wrapper around gapless5.js. Test the wrapper, not gapless5 directly (excluded from coverage). |
| 8 | `app/listen/src/lib/playback-engine.ts` | ~50 | Playback engine interface — all engines implement this. |
| 9 | `app/listen/src/lib/playback-engine-factory.ts` | ~30 | Engine selection logic (web vs native). |
| 10 | `app/listen/src/lib/playback-delivery.ts` | ~100 | Pre-warming of transcoded streams. Queue change → POST prepare. |

**Notes on gapless5.js (2,314 LOC, excluded from coverage):**

gapless5 is a vendored third-party library. It is explicitly excluded from
Vitest coverage (`coverage.exclude: ["gapless5/**"]`). Tests should target
the `gapless-player.ts` wrapper and PlayerContext integration tests, which
exercise gapless5 indirectly. If gapless5 has behavioral bugs, the wrapper
and integration tests will catch them.

### Rust (~997 LOC to cover, 3-4 days)

| # | Module | LOC | Why critical |
|---|---|---|---|
| 1 | `tools/crate-cli/src/ml.rs` | 427 | PANNs ONNX inference for audio analysis. If the model produces garbage, the entire fingerprinting/quality pipeline silently degrades. |
| 2 | `app/media-worker/src/metadata.rs` | 229 | Rich tag writing with lofty (cover art embedding, Crate identity tags). Writing bad tags corrupts music files on disk — maximum risk. |
| 3 | `app/media-worker/src/http.rs` | 191 | Internal TCP server (request parsing, routing). If it fails, download progress is not reported to the API. |
| 4 | `app/listen-desktop/src-tauri/src/macos_media_controls.rs` | ~100 | macOS native media controls. Zero tests. |
| 5 | `app/listen-desktop/src-tauri/src/macos_dock_menu.rs` | ~50 | macOS dock menu. Zero tests. |

**Test strategy for `ml.rs`:**

Uses existing `create_test_wav()` pattern from `tests/common/mod.rs`. Feed
synthetic WAV files through the ONNX model and verify output shape is correct
(embeddings not NaN, expected dimensions, known-frequency WAV produces
plausible embedding values within reasonable range).

### Go readplane (~1,580 LOC to cover, 4-5 days)

| # | Area | Est. LOC | Why critical |
|---|---|---|---|
| 1 | `catalog/helpers.go` — 27 untested functions | ~500 | Pure functions: `formatArtistTopTrack`, `playbackPayload`, `streamURL`, `inferFormat`, `isLossless`, `displayName`, etc. Core data transformation layer. Trivial to test. |
| 2 | `routes/server.go` — 14 untested route handlers | ~600 | Zero HTTP handlers have tests beyond `healthz`. `httptest` is already in use — just need to write the cases. |
| 3 | `routes/cache_events.go` — HTTP handler | ~50 | SSE cache invalidation handler. Parser IS tested, handler is not. |
| 4 | `routes/home_slices.go` — `snapshotsValue` | ~50 | Snapshot value extractor helper. |
| 5 | `routes/home_discovery_response.go` — 6 helpers | ~100 | `normalizeHomeCards`, `normalizeArtworkRefs`, `normalizeHomeTracks`, etc. |
| 6 | `snapshots/store.go` — `Fetch`, `cacheGet`, `cacheSet` | ~200 | DB-dependent. Requires mock or test DB container. |
| 7 | `auth/jwt.go` — middleware chain | ~80 | Auth middleware not tested at HTTP level. |

Items 1-5 (~1,300 LOC) are testable without external infrastructure
(`httptest` + inline data fixtures). Item 6 requires database mocking —
defer to a second iteration if too costly. Item 7 can use `httptest` with
signed test JWTs (the `signTestJWT` helper already exists in `jwt_test.go`).

---

## Out of Scope (second iteration)

These are large, complex modules that need their own focused plans:

- `gapless5/gapless5.js` (2,314 LOC) — vendored third-party, excluded from coverage
- `app/listen/src/pages/JamSession.tsx` (1,785 LOC) — real-time WebSocket, complex state machine
- `app/ui/src/pages/Settings.tsx` (1,810 LOC) — largest admin page, configuration surface
- `app/listen/src/components/player/FullscreenPlayer.tsx` (931 LOC) — full-screen player, gestures, visualizer
- `app/listen/src/components/player/visualizer/MusicVisualizer.ts` (907 LOC) — WebGL, needs canvas mocking strategy
- `snapshots/store.go` — requires test DB or testcontainers
- Python backend tests — third iteration

---

## Execution Order

1. Phase 1 complete: unify patterns first (don't write new tests with old patterns)
2. JS/TS `shared/web/*` — shared by ALL apps, weakest link
3. Go `catalog/helpers.go` — 27 pure functions, max bang for buck
4. JS/TS `listen/lib/api.ts` + `cache.ts` — core communication layer
5. Rust `metadata.rs` + `http.rs` — file corruption risk
6. Go route handlers — HTTP coverage
7. JS/TS `gapless-player.ts` + `playback-*.ts` — audio pipeline coverage
8. Rust `ml.rs` — most complex, requires understanding ONNX model
9. Go `snapshots/store.go` + `auth/jwt.go` middleware — requires DB mock
10. Rust `macos_media_controls.rs` + `macos_dock_menu.rs` — desktop-specific
