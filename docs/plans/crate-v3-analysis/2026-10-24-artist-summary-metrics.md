# Artist Stats summary metrics

Diego approved adding the proposed eight readings on 2026-10-24.

## Scope and data

- Work in `crate-v3-1q`, `feat/crate_v3`; preserve pending work, Genres and production.
- Use shared StatNumber, MonoLabel and fine coverage rails: four columns on wide containers,
  two on narrow screens. No new cards, icons or shared foundation variants.
- Readings: local albums, tracks, available duration, publication range, predominant genre,
  per-track mean BPM, current Full Smart Mix coverage and stored Bliss vector coverage.
- Local albums come from the local timeline, excluding upcoming catalogue entries. Track totals
  use the stored artist total or consistent timeline counts. Keep unavailable distinct from zero.
- Mean BPM uses unique track observations with positive finite tempo, plus measured-track coverage.
  Never average the album means. Genre is the strongest editorial tag, not a listening share.
- Smart Mix current Full means Full quality, canonical schema/analyzer versions and unchanged
  source. Server-disabled capability is a disabled state, not zero coverage. Bliss counts only
  explicitly available stored vectors and makes no freshness claim.
- Reuse existing Stats, capabilities and analysis-data endpoints. Start independent reads on
  Stats mount; isolate analysis loading/errors from catalogue values and graph selection.
- No new SQL aggregate, endpoint, query, migration, library mutation or dependency.
- Add behavior tests and run focused suites during development, full Admin validation once stable.
- No commit or push is requested.

## Tasks

- [x] Backend: emit authoritative `smart_mix.is_current_full_profile` in the existing analysis
      SELECT and response schema; cover current, old/light/stale/missing and both identity routes.
- [x] UI: compose the summary, add safe per-track reductions and prop plumbing, preserve graph state.
- [x] Integration: test desktop/mobile geometry, error/unknown states and asynchronous selection;
      review the final diff and verify backend tests, Admin suite, lint, typecheck/build and browser.

Backend and UI implementations have disjoint ownership and an agreed boolean contract. Root owns
browser tests, policy registration, documentation and final review. No shared primitives change.

## Verification and outcome

- Backend: 7 focused behavior/API tests and 7 mounted-source boundary/version checks passed;
  Ruff passed. Ten extra version guard cases require root tools/docs not mounted in the worker,
  so their missing-file failures are not claimed as successful validation.
- UI: 87 focused tests, final 37 affected tests, then 11 summary-caption tests passed.
- Icon policy: 34 tests passed, with the new icon-free local summary included in the audit.
- Independent scoped review: spec and quality PASS, no findings.
- Final Admin production build (including typecheck) and lint pass. Full suite: 208 suites / 2122 tests passed. Both desktop/mobile browser cases passed.
- The API was restarted locally to load the scalar response flag; no production change.
- Actual Holywater data shows 6 local albums, 69 tracks, 5h34m, 2003–2019, alternative,
  114 mean BPM (61/69 measured), 20/69 current Full profiles and 69/69 stored Bliss vectors.

The summary is a sibling of the existing console. Independent reads begin only when Stats mounts;
analysis/capability arrival does not change the console key or reset the selected graph nodes.
Missing analysis/flags show unavailable, pending requests show loading, and disabled Smart Mix
shows disabled. Coverage rails retain their count/total alongside percentages. No full genre
profile, album selectors or decorative icons were reintroduced.

Actual local proof: `/tmp/crate-artist-summary-metrics-actual-oct24.png`. No commit or push performed.
