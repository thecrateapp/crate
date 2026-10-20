# 1BD — Remaining Settings compositions

Base:5337b239. Continue the approved Listen-first plan and the five Settings tabs. The reference
is the approved mockup plus Diego's subsequent amendments. Leave Paths intact. No commit or push
until this cut is reviewed. Keep5186,6006 and5174 (existing production API) running.

## Scope / authority

Show location, OpenSubsonic credentials, Last.fm/ListenBrainz, Bandcamp, native servers, Offline
and quick links. Use actual shared fields, buttons, rows, status and feedback, in Listen-local
views reused by production, Storybook and the isolated review. Preserve controller ownership of
API writes, credential reveal/copy, OAuth/native linking, server sessions and offline storage.
No new shared foundation, fictitious Admin consumer, or production writes during QA. Do not
reintroduce the automatic timezone. Social/import/share remain later1BD batches.

## Implementation sequence

1. Location: canonical SelectRow and FormField/Input, keyboard-accessible city suggestions using
   AppPopover. Keep city lookup/debounce, radius and geolocation payloads. Loading/read failure
   must not render unknown settings as verified defaults; retry is a read only.
2. Connections: pure OpenSubsonicSettingsView, ScrobbleSettingsView and BandcampSettingsView.
   Replace local pill/control skins with StatusDot/EntityRow/FormField and ordinary Button.
   Preserve one-time secrets, confirmations, native pending/cancel and existing link authority.
   Distinguish unresolved/failed reads from disconnected state, with scoped read retry.
3. Offline, servers and quick links: actual Section, canonical meters/stat/readout roles, rows
   and actions. Preserve0/0, quota absence, unsupported/syncing gates, server removal ordering,
   navigation and sign-out callbacks. Native server view receives sanitized display data only.
4. Add a small review page and CSF scene for this complete batch, with local states/actions.
   Update Listen/Settings docs. Test both hosts375/1200px, actual8px labels, stable controls,
   keyboard city choice, hidden overlays, loading/error, long values and no overflow.

## Verification

RED→GREEN scoped Vitest per task. Existing adapter/auth/storage tests plus new view/error tests;
Listen/Desktop types and affected suites; changed-file lint, seven-locale checks, Storybook
types/build, standalone build, bundle and catalogue validation. One final fresh review followed
by a tested fix pass. No full CI, canonical baseline regeneration or native runtime certification.


## Implementation evidence

The actual views are now used by both production adapters and isolated hosts. The original
full Settings review replaces its deferred annotations with the same components. No shared
foundation or registry fingerprint is changed. Ready/loading/error, one-time keys, pending
native completion, provider busy state, native server display descriptors,0/0 offline and
quota absence are represented. The small review is `review-1bd-settings-remaining.html`.

## Final review fixes

A fresh read-only review found the manual location detection event/silent argument regression,
missing visual keyboard selection, inherited stale-city lookup behavior, partial-count failures
hiding a verified Bandcamp account, and cancellation/disconnect actions bypassing busy state.
The tested fix pass restores manual success/failure notices, canonical active-menu attributes,
query cancellation plus focus/Escape intent, separate Bandcamp totals error/retry, and pending
native/provider action protection with error feedback. Connected usernames retain their case
outside the uppercase StatusDot caption. The migrated controls also remove six raw buttons and
the obsolete server arbitrary font size; strict policy allowances decrease accordingly.

## Review checkpoint

Complete and uncommitted for Diego:162 scoped Listen tests/25files,52 Desktop tests/8files,
23 shared preview/catalogue policy tests/2files, and8 browser cases (both Settings scenes,
both hosts,375/1200px). Listen/Storybook/Desktop types, changed-file lint, seven-locale checks,
three builds and catalogue validation pass. Initial JS202703gzip bytes stays below307200.
Three services remain active. No real provider/credential/storage mutations during QA; actual
OAuth/native handoff and native certification remain later verification, with full CI at phase
close. No deferred review minors. Proof:`.artifacts/review/1bd-settings-remaining.png`.


## Account quick-link removal

Diego removes the redundant Quick links section before continuing. Drop it from Settings Account
and both review hosts, deleting the unused adapter/view/fixture and their obsolete navigation
specimens. Keep native server specimens and their existing story id (display name: Servers).
User-menu sign-out and app navigation retain their existing behavior. Regression: actual Account
shows profile, listening/security controls without Quick links, in production and both hosts.
No commit/push; the rest of this uncommitted cut remains for review.

## Approval

Diego approved this cut, including Account quick-link removal, on2026-10-20. Fresh commit
verification:114 Listen tests/21files and showcase catalogue green. Commit and push authorized;
continue with1BD Community and stop at its review checkpoint before committing that new cut.
