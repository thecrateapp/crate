# Listen web closure — review checkpoint

21 October 2026. Working tree: `crate-v3-1q/crate`, branch `feat/crate_v3`,
base `4085cd12179f1fd88c08faff479806463068a3e9`. Approved by Diego for commit and push.

- Listen: <http://127.0.0.1:5174/> against the existing production API.
- Focused preview: <http://127.0.0.1:5186/review-1be-web-closure.html>.
- Storybook: <http://127.0.0.1:6006/?path=/story/reviews-1be-web-closure--complete>.
- Coverage: the review's Coverage tab and System/Listen web closure in Storybook.

## Changes and review scope

Primary Button and hero accent actions retain Diego's approved transparent background,
accent foreground and 1 px accent border. Specialized round playback keeps its approved
appearance. Custom Tooltip owns legacy title hints without duplicate native titles,
extra layout nodes or lost accessible names/ref/handlers. Empty hints have no dangling
ARIA description; a drag-consumed Escape also closes its hint, allowing the next Escape
to close the editor.

Playback Settings follows actual EQ power changes and storage events without resetting
other settings. Off remains a bypass. The ten-band EQ keeps 12 px compact readings, exact
focus/touch values, preset pills and one accent mono information band. Manual presets
and genre taxonomy remain identifiable by their source label.

Home Radar/DNA use canonical components and preserve source quality. Track rows retain
Caspian's quality→BPM/key→duration→like→menu order and reserved columns. Sidebar captions
use MonoLabel and accent hover. Claude's PathCoverJourney and Stats instruments remain
preserved.

The focused scene reuses actual production views and primitives with local callbacks.
Playback, Actions, Feedback and Navigation exercise relevant ownership; Coverage makes
its limits explicit. These fixtures never call production APIs or persist preferences.

## Evidence distinction

`fixtures/web-closure-audit.ts` inventories 25 route groups and names their existing
consumer/fixture tests. `WEB_LIVE_CHECKS` records eleven groups additionally checked in
the authenticated desktop app on 21 October: Home, Explore, Collection, Caspian album,
Upcoming, Radio, Paths, Settings Offline, Bandcamp, Upload and the paused persistent player.

These live checks inspect loaded content, navigation and DOM geometry. Applicable loaded
pages had no horizontal overflow or native title nodes. The paused player's source
survived route reloads. No playback, queue, import, withdrawal or account mutation was
performed. The other fourteen groups are explicitly marked source/automated inspection,
not live route exercises. Narrow screens/reduced motion/interactions use isolated browser
fixtures; that is not native-device or screen-reader certification.

The catalogue remains 78 documented / 93 entries. Its 15 remaining contracts are classified,
with owners and follow-up milestones: Admin compatibility surfaces, unused alternatives,
and QRCodeImage behind disabled Jam. No pending fingerprint was refreshed to hide debt.

## Boundaries and follow-up

- Tauri/Capacitor outputs and physical-device/assistive-technology validation remain next.
- Production EQ exposes the effective curve; complete available-curve inventory needs
  the existing backend endpoint deployed. This review does not deploy it.
- Live imports, OAuth sign-in/out and disconnected production sessions need separate
  controlled integration tests; production account/library state was preserved.
- Jam remains disabled. Admin-only and unreferenced contracts keep their own checkpoints.
- Minor deferred: a disabled Apple sign-in action cannot expose its optional tooltip
  explanation. Its disabled state stays explicit; a later OAuth refinement should make
  the explanation available without focusing the disabled action.
- The review excluded unrelated `.codex` changes. Diego subsequently requested commit and
  push of everything, including the pending code-review graph configuration.

## Validation

Behavioral regressions were observed failing before fixes: EQ preference synchronization,
metadata alignment and source normalization, empty/drag-owned tooltip descriptions,
and per-route live-versus-inspected evidence. The final verification results follow.

Final full suites: Listen 3394 passed / 4 skipped (455 files), shared UI 998 passed
(116 files), Admin 661 passed (108 files), Desktop 54 passed (9 files).
All five TypeScript checks pass, as do scoped ESLint, catalogue validation and the
six-locale translation check. Storybook and preview production builds pass. Browser
review: 18 cases at 375/640/1200 px across both hosts, plus the final 6 coverage/hover cases.
