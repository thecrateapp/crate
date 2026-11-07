# Sentry backlog triage — 2026-11

Error Inbox phase E0. On 2026-11-04 the Sentry organisation had 92 unresolved issues: 79 errors and 13
performance issues. This record keeps the labels and the criteria behind them. It leaves out event messages,
culprits and URLs, because they can carry library names and this repository is public.

## Decisions (gate EG1, 2026-11-04)

1. **The inbox only syncs errors** (`issue.category:error`). The 13 performance issues (N+1 Query, Slow DB
   Query) belong to a separate performance backlog. Six of them were only seen in release `crate-8ba478ac`
   and were resolved as obsolete on 2026-11-04: CRATE-API-3, API-5, API-6, WORKERS-2, WORKERS-3 and
   WORKERS-4. CRATE-API-2, API-4, WORKERS-1, WORKERS-5, WORKERS-6, WORKERS-7 and WORKERS-8 stay open there.
2. **Bulk resolution after the source fixes.** The 68 issues of groups G1, G2, G3, G4, G5 and G7, plus
   CRATE-READPLANE-3, READPLANE-4, DOCS-1 and LISTEN-Z, are resolved once the source changes below are
   deployed. Resolving them earlier would only reopen them.
3. **No inbound filters on the projects.** The noise comes from Crate's own clients, not from browser
   extensions or legacy browsers.
4. **No frame variables.** The Python SDK stops sending local variables (`include_local_variables=False`).
   Triage never used them.

## Criteria

| Classification        | Meaning                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `bug`                 | Crate's code does something wrong and a test can reproduce it                   |
| `infrastructure`      | The service was unavailable (deploy, proxy); the code did not fail              |
| `external_dependency` | An external provider limits or fails                                            |
| `client_environment`  | Depends on the client's network, browser or OS; the code behaves correctly      |
| `noise`               | Not a product failure: synthetic events, orderly shutdowns, expected rejections |

Severity is `high` when the failure loses data, breaks a session or crashes the app; `medium` when it degrades
a visible feature; `low` when users notice nothing. The decision is one of `fix` (a PR with
`Fixes <SHORT-ID>`), `filter` (stop capturing it at the source), `fingerprint` (merge it into one issue per
app), `reload` (recover in the client without reporting) or `resolve`.

## Groups

| Group                                                         | Issues                   | Classification     | Severity | Decision                                          |
| ------------------------------------------------------------- | ------------------------ | ------------------ | -------- | ------------------------------------------------- |
| G1 · Synthetic C0 diagnostics                                 | 4                        | noise              | low      | Resolve                                           |
| G2 · Network failure in the shared API client                 | 47 (35 Listen, 12 admin) | client_environment | low      | Filter at the source, then resolve                |
| G3 · 502 seen by clients during deploy windows                | 5                        | infrastructure     | medium   | One fingerprint per app, then resolve             |
| G4 · 500 on one artist enrichment request (2026-10-09)        | 2                        | bug                | medium   | Resolve (not repeated); check the API captured it |
| G5 · Chunk or module that fails to load after a deploy        | 4                        | client_environment | low      | Reload once without reporting, then resolve       |
| G6 · `play()` rejected in the gapless5 stub (WKWebView)       | 4                        | bug                | medium   | Fix in one PR                                     |
| G7 · Rejections without a stack (AbortError, View Transition) | 2                        | noise              | low      | Filter, then resolve                              |
| G8 · Backend                                                  | 7                        | mixed              | mixed    | See the tables                                    |
| G9 · Mobile app                                               | 4                        | mixed              | mixed    | See the tables                                    |
| G10 · Performance                                             | 13                       | outside the inbox  | —        | Performance backlog                               |

## Source changes (E0.3)

Ordered by impact:

1. **Network failures of the API client** (`app/shared/web/api.ts`, `api-auth-transport.ts`): a rejected
   `fetch` (`Failed to fetch`, `Load failed`, `NetworkError`) stays a breadcrumb instead of an error. This
   removes 47 of the 79 errors.
2. **5xx seen by clients** collapse into one `api-unavailable` fingerprint per app instead of one per endpoint.
3. **Fingerprints split by the build**: the same call showed up as different issues because of relative path
   prefixes, minified names and the host suffix in the title. Frame paths are normalised in the SDK.
4. **Chunks after a deploy**: a `vite:preloadError` handler reloads the page once and does not report.
5. **`service` tag overwritten**: `init_sentry` set the tag again when the SDK was already initialised, and
   importing `crate.broker` called it as `workers`, so API events carried `service=workers`.
6. **Read plane**: the `context deadline exceeded` of the HTTP shutdown is treated as benign, and captures
   point at the real call site instead of the capture helper.
7. **Rate-limited providers** (Setlist.fm) are no longer captured as an error on every retry.
8. **Local builds reporting as `production`**: a build served from a private-network origin over `http`
   reported with `environment=production`.

## Bugs to fix

One PR per root cause, each with `Fixes <SHORT-ID>`:

- CRATE-WORKERS-C and WORKERS-D: the album upsert in the library pipeline conflicts on `(artist, name)`
  while it only handles `ON CONFLICT (path)`. Same task and trace.
- CRATE-WORKERS-B: the retry with `sleep` in `sync_shows` exhausts the task time limit.
- CRATE-LISTEN-10: native session migration fails (6 users).
- CRATE-LISTEN-1C: `ForegroundServiceStartNotAllowedException` when Android starts the playback service.
- CRATE-LISTEN-16: render loop on the album page.
- CRATE-LISTEN-G, V, H and 1M: `play()` rejected with `NotSupportedError` in the gapless5 stub on WKWebView.

CRATE-LISTEN-1P (a `NullPointerException` in the Android native playback plugin) appeared after the
inventory. It is not part of the reference set and goes through the inbox like any new issue.

## Reference set

`app/tests/fixtures/error_inbox/reference_labels.json` keeps the 79 labels below: short id, group,
classification, severity, root of the duplicate group and decision. Phase E2 measures the AI triage against
them with synthetic or sanitised digests. Event content never enters the repository.

### Backend (11)

| Short id             | Group | Classification      | Severity | Duplicate of    | Decision |
| -------------------- | ----- | ------------------- | -------- | --------------- | -------- |
| CRATE-API-7          | G1    | noise               | low      |                 | resolve  |
| CRATE-MEDIA-WORKER-1 | G1    | noise               | low      | CRATE-API-7     | resolve  |
| CRATE-READPLANE-5    | G1    | noise               | low      | CRATE-API-7     | resolve  |
| CRATE-WORKERS-9      | G1    | noise               | low      | CRATE-API-7     | resolve  |
| CRATE-DOCS-1         | G8    | client_environment  | low      |                 | resolve  |
| CRATE-READPLANE-3    | G8    | infrastructure      | medium   |                 | resolve  |
| CRATE-READPLANE-4    | G8    | noise               | low      |                 | filter   |
| CRATE-WORKERS-A      | G8    | external_dependency | medium   |                 | filter   |
| CRATE-WORKERS-B      | G8    | bug                 | low      |                 | fix      |
| CRATE-WORKERS-C      | G8    | bug                 | high     |                 | fix      |
| CRATE-WORKERS-D      | G8    | bug                 | high     | CRATE-WORKERS-C | fix      |

### Listen (48)

| Short id        | Group | Classification     | Severity | Duplicate of    | Decision    |
| --------------- | ----- | ------------------ | -------- | --------------- | ----------- |
| CRATE-LISTEN-8  | G2    | client_environment | low      |                 | filter      |
| CRATE-LISTEN-12 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-13 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-14 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-15 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-17 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-18 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-19 | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1A | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1B | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1D | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1E | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1G | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1H | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1J | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1K | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-1N | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-9  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-A  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-B  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-C  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-D  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-F  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-J  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-K  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-M  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-N  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-P  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-Q  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-R  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-S  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-T  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-W  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-X  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-Y  | G2    | client_environment | low      | CRATE-LISTEN-8  | filter      |
| CRATE-LISTEN-7  | G3    | infrastructure     | medium   |                 | fingerprint |
| CRATE-LISTEN-11 | G5    | client_environment | low      |                 | reload      |
| CRATE-LISTEN-5  | G5    | client_environment | low      | CRATE-LISTEN-11 | reload      |
| CRATE-LISTEN-G  | G6    | bug                | medium   |                 | fix         |
| CRATE-LISTEN-1M | G6    | bug                | medium   | CRATE-LISTEN-G  | fix         |
| CRATE-LISTEN-H  | G6    | bug                | medium   | CRATE-LISTEN-G  | fix         |
| CRATE-LISTEN-V  | G6    | bug                | medium   | CRATE-LISTEN-G  | fix         |
| CRATE-LISTEN-1F | G7    | noise              | low      |                 | filter      |
| CRATE-LISTEN-6  | G7    | noise              | low      |                 | filter      |
| CRATE-LISTEN-10 | G9    | bug                | high     |                 | fix         |
| CRATE-LISTEN-16 | G9    | bug                | medium   |                 | fix         |
| CRATE-LISTEN-1C | G9    | bug                | high     |                 | fix         |
| CRATE-LISTEN-Z  | G9    | client_environment | low      |                 | resolve     |

### Admin (20)

| Short id      | Group | Classification     | Severity | Duplicate of    | Decision    |
| ------------- | ----- | ------------------ | -------- | --------------- | ----------- |
| CRATE-ADMIN-R | G2    | client_environment | low      |                 | filter      |
| CRATE-ADMIN-5 | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-B | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-C | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-D | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-G | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-J | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-P | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-Q | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-S | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-T | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-V | G2    | client_environment | low      | CRATE-ADMIN-R   | filter      |
| CRATE-ADMIN-8 | G3    | infrastructure     | medium   | CRATE-LISTEN-7  | fingerprint |
| CRATE-ADMIN-E | G3    | infrastructure     | medium   | CRATE-LISTEN-7  | fingerprint |
| CRATE-ADMIN-M | G3    | infrastructure     | medium   | CRATE-LISTEN-7  | fingerprint |
| CRATE-ADMIN-N | G3    | infrastructure     | medium   | CRATE-LISTEN-7  | fingerprint |
| CRATE-ADMIN-A | G4    | bug                | medium   |                 | resolve     |
| CRATE-ADMIN-K | G4    | bug                | medium   | CRATE-ADMIN-A   | resolve     |
| CRATE-ADMIN-4 | G5    | client_environment | low      | CRATE-LISTEN-11 | resolve     |
| CRATE-ADMIN-H | G5    | client_environment | low      | CRATE-LISTEN-11 | reload      |
