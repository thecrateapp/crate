# Artist: layout, graph, discography and biography persistence

The follow-up repairs the regressions shown in the user's captures and normalizes every Artist tab. Worktree: `crate-v3-1q`, branch `feat/crate_v3`.

## Layout and states

`ArtistDetailSection` is an Admin domain composition of shared MonoLabel and InfoBadge, rather than a new shared foundation variant. Overview, Top Tracks, Discography, Setlist, Shows, Similar, Stats and Artwork use the same first-section frame. First sections have no extra top padding or rule; subsequent sections retain their separators. The header reserves 44 px for controls and uses a 12 px gap to the body, including loading and empty states. Descriptions belong to the body. Discography's Sort control no longer adds a separate caption row above the common header.

All seven tabs visible for Holywater were measured in the actual local browser: header starts 16 px below the tab panel, is 44 px high, and precedes the body by 12 px. Previously, Biography's top-aligned 44 px action and panel margin left approximately 49 px between its caption and prose. Artist Hero no longer forces an extra border beneath its action row.

The missing-release error now stays inside the relevant tab after its existing content, instead of appearing between the hero and tab navigation. An empty album collection uses the shared EmptyState across the full grid width.

## Discography without local audio

The real local 404 came from requiring an audio directory even when the artist and albums existed in PostgreSQL. Indexed artists now use a single identity/inventory CTE in `crate.db.queries.missing_albums`; quarantined albums are excluded, and only release-group MBIDs participate in release-group matching. The existing MusicBrainz comparison is reused. Non-indexed searches retain filesystem fallback.

Only the local API container was reloaded. The same Holywater UID's `/missing` request subsequently returned 200 with the metadata-only development library. There are no migrations or library writes in this fix.

## Network interaction

Click once again selects, illuminates and expands the actual node and its incident links. The redundant visible list beneath the graph was removed. Arrow keys, Home/End and Enter/Space provide keyboard selection and expansion through the graph itself.

The browser check caught a second issue that component tests alone missed: focusing the canvas selected the first node and inserted actions above it before mouse-up, shifting the click target. Focus no longer inserts that selection. A real click on Sou Edipo selected Sou Edipo and added twelve new neighbours to the graph. Graph expansion does not add an artist to the music library.

## Biography editor

The nested AI dialog previously applied only to the editor draft, while reporting success; a same-artist refetch also reset every field. Apply now saves only the biography through the metadata worker and waits for completion, sharing the same Admin helper as Overview. Other dirty fields survive refetch and remain unsaved until Save metadata. Failure retains the proposal; pending saves cannot be dismissed.

The backend already writes the canonical manual biography, locks it against provider enrichment and invalidates its consumers. It was inspected, not changed by the biography fix. [Detailed trace and regression coverage](2026-10-24-artist-biography-apply-resolution.md).

## Validation

- Full Admin: **203 suites / 2,055 tests passed**, 284.57 s. Supervised process exited 0; log `/tmp/crate-artist-followup-tests-oct24.log`.
- Admin TypeScript, global ESLint and production build passed. The existing large-chunk notice remains.
- Shared showcase catalogue check passed; no shared production component was modified.
- API/service/inventory PostgreSQL tests: **31 passed**; additional DB/catalog boundary guards: **8 passed**. Ruff and formatting passed.
- The expanded backend run reported 75 passes and one environment failure because `Browse.tsx` is not mounted in the worker; that test file passed separately on the host. Existing OpenAPI duplicate-operation warnings concern unchanged Cast/Subsonic routes. The lingering teardown process was stopped without restarting workers.
- Browser geometry regression: **2/2 passed**, desktop 1440×900 and coarse-pointer mobile 390×844. All eight tab frames (including Shows with a fixture event) share header offset, height, body gap and caption typography; the empty album state spans the grid. Early fixture-only failures were corrected (sidebar summary response, artwork image URLs and a complete hero-profile contract); production checks were not weakened.

AI research, save responses and task completion are mocked in persistence tests; no real LLM call or artist-data mutation was used for verification. Local library reads and graph expansion were also checked in the actual browser. [Actual Overview capture](/tmp/crate-artist-layout-actual-oct24.png).

The additional [Admin recurrence review](2026-10-24-admin-followup-review.md) retains four separate findings in AI Models/Agents. Those are review results, not claims of completed fixes or a certification of every Admin state in a browser.
