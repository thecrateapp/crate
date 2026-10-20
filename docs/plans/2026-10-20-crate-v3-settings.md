# 1BD — Listen settings, first cut

Reference: approved persistent mockup and confirmed amendments; H2 Settings in the approved
Listen-first plan. Base: `0e3640e7` (Radio and Paths published). Diego has approved this cut and the
completed Paths cover-transition amendment for a joint commit. Keep 5186, 6006 and Listen 5174 connected to the existing production API available.

## Scope and contracts

This cut covers the current Settings page frame, shared local settings field compositions,
Interface, Language, Playback, account profile/password/Pulse, linked OAuth accounts,
and Connect devices. Offline, servers, show location, OpenSubsonic credentials, scrobbling and
Bandcamp remain present with their existing behavior and have their own later 1BD cut. Social,
imports and sharing also remain later cuts. This is not completion of all 1BD or H2.

- InstrumentPanel is the approved settings surface; retain it through Section, with PageHeader
  for the page. The subsequently approved five-tab amendment below supersedes the original
  section ordering; retain the same approved control and surface recipes.
- Actual FormField owns uppercase MonoLabel captions and an 8 px stacked gap. Switch fields
  use its inline composition. Input/Select/Slider/Textarea/Button own typography and geometry;
  remove consumer font, radius, background and height overrides. Values and prose retain case.
- Scalar preferences use Select with stable width, including interface, language and delivery.
  Keep current option descriptions visible and preserve immediate persistence and seven locales.
- Preserve playback capabilities: no crossfade on mobile, EQ only on existing supported paths,
  suggestions cadence disabled when suggestions are off. No engine or remote transport change.
- Profile normalization, profile/password payloads, cancel clearing, OAuth completion ownership,
  native session binding and credential boundaries stay in existing controllers. Clear ambiguous
  domain actions retain text; native disabled/loading is preserved.
- Connect retains feature gates, visibility filtering, active/current identity, preference write,
  confirmation and revoke APIs. No invented presence or transfer feature. A failed list read
  must be distinguished from a verified empty response and expose existing-read retry.
- Pure Listen-local views feed production adapters and both review hosts. No fictitious Admin
  consumer and no new shared foundation. Fixture actions never persist preferences, start
  playback, send credentials, or write API data.

## Tasks and expected checks

1. Settings field compositions: RED tests for actual inline FormField, disabled state and Select
   value/callback/ARIA; implement canonical compositions. Expected: focused primitive tests green.
2. Preference views/adapters: RED scalar Select tests plus current storage/capability tests;
   migrate Interface, Language and Playback. Expected: persistence and mobile/native tests green.
3. Account/device views: RED canonical form anatomy and failed-read retry; remove overrides,
   extract real view contracts and promote devices. Expected: existing account/OAuth/revoke tests
   and new view/error tests green, with unchanged request payloads.
4. Review/inventory: one small standalone page plus Storybook family/review using the same scene.
   Cover preferences, account and devices with local state, disabled/loading/error/empty, long
   values and mobile/native capability variants. Test both hosts at375/1200 px: real 8 px caption
   gaps, canonical uppercase labels, equivalent controls and no page overflow or fixture writes.
   Expected: scoped Listen/Desktop tests/types, Storybook typecheck, lint, builds, bundle and
   catalogue checks green. Preserve canonical screenshot baselines and exact policy budgets.

## Review focus

Stable Select geometry and ARIA relationships; value case versus captions; password cancel and
OAuth owner/lifecycle; native playback gates; devices feature/current/active filtering; stale
and failed reads versus empty, retry/confirmation authority; pure fixture versus actual adapters.
One fresh final review and one tested fix pass. Full H3 device instruments/contracts, real
production writes, full CI and native device certification are outside this visual cut.

## Diego amendments during review preparation

MonoLabel gains an explicit subtle/accent tone; InstrumentPanel forwards that existing role
through label.tone. Settings Section uses accent for its heading, while field captions remain
subtle. The native server heading adopts that same role without changing its remaining flow.
Update both shared catalogue entries and contracts. This adds a variant to an existing component
used in both apps, not a new shared component with a fictitious consumer.

Motion, Effects and Content density form a container-responsive grid: three columns with room,
two at medium widths, one on narrow containers. FormField continues owning the 8 px caption gap.

## Approved five-tab amendment

Diego approved the complete grouping in chat for this same uncommitted cut:

- Preferences: Interface, App language, show location.
- Playback: playback preferences and sleep timer.
- Account: profile, Pulse, sign-in providers, password, existing quick links/sign-out.
- Connections: Connect devices, OpenSubsonic, scrobbling/Last.fm, Bandcamp, native servers.
- Offline: downloads and storage.

Use the existing canonical Tabs (including cyan moving indicator and reduced-motion behavior),
not a new navigation skin. URL `?tab=` supports direct links and back/forward; unknown values
fall back to Preferences without rewriting other query/hash values. Keep inactive panels mounted
but hidden so local drafts, password visibility and in-flight operations survive tab switches.
Preserve existing mount-time data/capability behavior. Ensure selected tabs stay in view in the
single horizontally scrollable mobile strip without vertically jumping the page.

Both review hosts use this actual page frame/grouping. Playback/sleep and the existing Offline
presentation gain local fixture data/callbacks; quota/storage/network authority stays in adapters.
Location, external integrations and quick links retain production controls and have explicit
scope annotations in the isolated scene; their visual consolidation remains a later cut.
Regression coverage: actual section grouping, hidden panel semantics, profile/password drafts,
no new writes from tab switches, direct/invalid links, back/forward/query/hash, keyboard traversal,
44px targets and no page overflow at mobile widths. Continue the stop before commit.

## Account presentation amendments and user review

Diego requested Email first as a readonly input, clearer composition after the profile form,
and a cleaner Connected accounts list. AccountSettingsView now composes Profile, Listening
preferences, actual ConnectedAccounts, and Security sections. The real ProfileForm uses canonical
readonly Input and container-based two-column fields with full-width Bio/actions. Password fields
use the same responsive layout. Provider rows use shared existing brand glyphs, compact EntityRow,
StatusDot and ghost Button actions in a bounded list; labels use Google/Apple while callbacks
keep raw provider IDs. Profile, password, OAuth and immediate preference payloads are unchanged.
Both scenes consume these actual views; the Account story/deep link provides focused review.
Diego accepted the result and explicitly prohibited commit/push until he says so. Claude owns
subsequent Paths/coverflow changes: do not edit, restore, stage or commit those files.

A focused final review of the new navigation amendment found two important issues: hidden panels
did not hide portalled confirmations, and a selected tab could be clipped after resizing. Tests
reproduce each before its fix. Listen-local panel activity closes transient Select/sleep/credential/
device overlays without unmounting drafts/controllers. A ResizeObserver reveals the active tab
on strip and label geometry changes. No new shared module or caller tab styling is introduced.

## Automatic timezone amendment

Remove Listening timezone and its manual device-zone reset from Account, Storybook and the
isolated review. Drop the unused AccountTimezoneField/AccountTimezoneView and their obsolete
field tests. Preserve app-shell TimezoneAutodetect: detect/persist when the server reports no
stored timezone, without overriding a stored value. No timezone behavior/API migration is
requested. Keep Pulse and the approved remaining Account layout. Continue explicit no commit/
push and leave Claude's Paths work untouched.


## Joint commit authorized

Diego confirms Claude has finished the Paths work and authorizes committing all approved
Settings and Paths changes together. This supersedes the earlier hold on commits. Include the
actual Paths transition design and current Storybook/preview documentation. Preserve the three
running previews; no deployment, PR, merge or push was requested in this instruction.
