# 1BD — Community

Base:b78077aa. Approved Listen-first plan R17. No commit/push of this cut before Diego reviews.
Keep5186/6006/5174 active, Listen on its existing production API. Reference: approved mockup
and confirmed amendments; compose existing foundations without changing artwork roles.

## Tasks

1. People/connections: canonical PageHeader, FormField/SearchInput, person EntityRow/Avatar,
   StatNumber, loading/error/empty states. Search retains250ms debounce and aborts obsolete
   responses; failed reads offer scoped retry instead of claiming no matches/connections.
2. Public profile: one responsive identity, relationship/taste metrics, affinity and public
   library/network sections. Actual shared header, rows, badges and technical labels. Preserve
   follow/own-profile guards, profile/DNA routes, public-only API boundaries and existing
   collection controller authority. Pure Listen-local views also power fixtures.
3. Profile hover card: same identity/metrics/actions, canonical popover/body, busy/error and
   own-profile states. Preserve delayed desktop interaction, focus, cache and no mobile fetches.
4. English Storybook entries and standalone review-1bd-community.html using one actual scene.
   Ready/loading/error/empty, own/other, zero/long content and local follow/search/retry fixtures.
   Browser375/1200px both hosts: no overflow,8px search label gap, canonical input/avatar sizes,
   keyboard focus/navigation and fixture actions. No production mutations.

## Verification

RED→GREEN per task. Scoped Listen social/page/hooks and policy/i18n suites; Desktop tests/types;
Listen/Storybook types, changed-file lint, locale check, catalogue, builds and bundle budget.
One fresh final review of b78077aa..working tree, then one tested fix pass. FullCI/native device
certification remain phase-close gates; no canonical baseline regeneration.

## Fresh review and acceptance corrections

One read-only fresh review found no Critical issues. Fix the hover avatar slot, invalid RTL
ByRole options and the production contribution caption/fixture mismatch before handoff. The
caption gap is treated as an acceptance issue, even though it predates this cut: production
must use the same actual MonoLabel as the showcase. Preserve existing public API/controller
privacy boundaries and cached-read semantics. Native/device/assistive certification, fullCI
and broader phase closure remain later gates; no production relationship mutations during QA.

## Review checkpoint

Ready for Diego, uncommitted. Final fresh review corrections are complete in one tested pass:
loaded hover cards render their injected managed avatar, production contribution metadata uses
MonoLabel, and new RTL queries pass TypeScript checking. The production avatar and caption
regressions were observed RED, then the75-test Listen suite/14files passed GREEN. No deferred
review minors. Stronger metric-boundary checks pass without changing the approved numeral role.

- Listen75/75, Desktop52/52 across8files, shared preview/showcase23/23 across2files.
- Four browser cases: both hosts,375/1200px, real8px label gaps,40/44px input,56px hover avatar,
  bounded metrics, zero/long content, own/busy states and no fixture API/storage effects.
- Listen/Storybook/Desktop types; changed Listen lint36files; seven-locale check0errors/warnings;
  all three builds, catalogue58documented/93entries/120sources and diff check pass.
- Initial Listen JS202777gzip bytes vs307200 budget. Storybook retains its existing chunk-size
  warning; production bundle budget passes. No shared component source/registry hash changed.
- Real Listen People and own public profile verified read-only against the existing production
  API. Authenticated profile/contribution/crate imagery and public relationships render. No
  follows, provider/account changes, persisted preferences or audio actions during QA.
- Three services active; preview, Storybook and Listen tabs retained. Proof:
  `.artifacts/review/1bd-community.png`. Existing historical mockup not extended.

Validation boundaries: native/device/assistive certification and fullCI remain phase-close
checks (device-specific or broader integration issues can still surface there). Server-side
privacy enforcement and cached-error/invalidation contracts remain the existing public API/data
layer (pre-existing server policy or revocation/cache defects require separate data-layer work).
Settings/Paths history, deployment and H2/H3 certification are outside this review.

## Diego's profile and link amendments

Social and listening metrics now share ProfileMetricsGrid: two columns on mobile and three
from sm. Corresponding values align; Top sound and identity badges occupy a separate row.
Affinity moves into PageHeader's far-right actions slot and uses the next StatNumber tier,
md rather than sm. Actual views power both review hosts.

Shared links use foreground feedback without animated beams, generated hover underlines or
beam keyframes. Keyboard focus stays visible, including the static inset focus treatment for
clipped links. Tabs and player interaction contracts remain separate. StatNumber itself owns
high-accent caption feedback inside native links on hover and keyboard focus, for labels above
or below. Readonly labels stay gray; values/units retain their colors. Foundations and StatNumber
stories/docs/catalogue were updated together, with no consumer CSS repairs.

Amendments observed RED then GREEN: alignment/header/affinity tier, beam removal and linked
caption hover/focus. Final scoped checks: shared53/53, Profile7/7, Admin4/4, browser7/7 covering
both hosts375/1200, normal/reduced-motion links and actual linked StatNumber. Shared/Storybook
types and changed-file lint pass; preview/Storybook builds and catalogue pass. Listen/Admin/
Desktop types and Desktop52 tests passed earlier in this amendment pass. Authenticated live
profile renders with the same alignment and linked-caption keyboard feedback, verified read-only.
Three services remain active. Updated proof: `.artifacts/review/1bd-community.png`.

Still stopped for review: no commit, push, production mutations, baseline regeneration or fullCI.

## Approved action-label amendment — 2026-10-20

Diego approved the two visual patterns while this Community cut remains uncommitted:

- All View All/See all section actions use the single localized View All copy and an actual
  accent MonoLabel. SectionActionLabel composes it with a static, decorative StatusDot using
  the shared glow, replacing the arrow. SectionHeader, profile relationship links and the
  search footer reuse this one composition. Search keeps its contextual accessible name.
- Domain ContextMenu action/disclosure/submenu options use actual uppercase MonoLabel,
  inheriting state colors. Names/details, two-line clamping/full-label titles, native actions,
  keyboard behavior and desktop/touch presentations stay intact.

The redundant userProfile.seeAll translation key is removed from all seven catalogs. Existing
non-English View All/results translations remain valid; their two source reviews are updated.
English Storybook entries/docs and the small shared ActionLabelsReview scene document the
approval; both catalogue entries were refreshed specifically. Shared AGENTS records the rule.
The historical mockup is unchanged.

Regressions observed RED then GREEN: canonical section caption, replacement dot, profile copy
and desktop/sheet MonoLabel options. Scoped final checks:94Listen/4files,92shared/8files,
7Admin/2files,52Desktop/8files and12browser cases across both hosts and input modes. Shared/
Listen/Admin/Storybook/Desktop types, changed-file lint, translations, both preview builds and
catalogue pass. Browser geometry waits for the existing overlay entrance animation to settle;
no component geometry was changed to satisfy that check.

Two obsolete guard expectations surfaced during validation and were corrected without product
changes: the Home hero test expected a retired local leading-none caption instead of its
existing canonical MonoLabel; the export allowlist still marked EntityPrimaryAction unused
despite real Explore imports. The allowlist shrank; no budgets or policy exemptions increased.

Proof: `.artifacts/review/1bd-action-labels.png`. Three services/tabs retained. Native fonts
were inspected read-only: Capacitor body text uses system fallback; display/mono ship on all
runtimes, and Tauri also loads Poppins. No font/runtime configuration changed. No commit/push.


### Review amendments — link feedback, biography actions and playback source

Enabled native/ARIA links containing MonoLabel use high-accent hover/focus foreground; readonly
and disabled captions retain their tone. ContextMenu MonoLabel options have foreground-only
feedback for hover/focus/highlight/open, preserving resting normal/danger/disabled semantics.
The actual player bar uses MonoLabel only for Playing from; source names retain their case,
truncation, responsive visibility and callback. Its source was previously missing from the saved
queue: save/restore now includes PlaySource and initializes its state/ref from that snapshot,
without autoplay or per-tick persistence. Legacy origins absent from storage remain unknown.
All six origin kinds, malformed/legacy snapshots, structural updates, checkpoints/unload and
provider remount are covered. CrossfadeTransition's unchanged type moved to player-types with
a compatibility re-export, so the pure player-copy view can be documented without importing
runtime-context types into Storybook.

SectionActionButton owns the zero-inset native button,44px target and SectionActionLabel/dot.
SectionHeader, artist Show more and shared ArtistBioProfile More/Less reuse it, preserving native
refs, disabled behavior, localization and modal/controlled expansion callbacks. This fixes the
conventional Button padding that displaced Show more. ArtistBioProfile is consumed in both
Listen and Admin. No caller typography/padding repairs; no new historical mockup sections.

RED evidence: Show more1/7; biography toggle2/10; missing source14/47; link/menu foreground
failures. Final GREEN:72 Listen/5files (57 current amendments +15 restore-on-mount),101 shared/
8files (90 foundations +10 biography +1 export policy),10 Admin/2files,52 Desktop/8files.
Twelve browser cases across both hosts,375/1200px verify label roles, dot/glow, alignment,
modal/More/Less callbacks, disabled feedback and no API mutations. An intermediate modal
geometry check sampled two animation frames; it now reads both edges atomically and waits
for the existing entrance transform to settle, without changing component geometry.

Shared/Listen/Admin/Storybook/Desktop types, changed Listen-file lint, preview/Storybook/Listen
builds and bundle budget pass. Catalogue remains58documented/93entries/120sources; targeted
refreshes only for changed documented entries. The refresh CLI accepts one ID per invocation;
the intermediate stale SectionHeader doc fingerprint was corrected with its own targeted call.
No allowance/baseline increases. Storybook/preview retain the existing large-chunk warning.
Proof: `.artifacts/review/1bd-bio-actions.png`. Live artist Show more measured at the same412px
left edge as its biography, zero padding,44px target; no production mutation. Three services
remain active. STOP for Diego's review; no commit/push, HEAD/origin remains b78077aa.


## Publication authorized — 2026-10-20

Diego approved the complete Community cut and review amendments, and explicitly authorized
commit/push. The next announced cut is1BD Sharing and imports: ShareSheet, Bandcamp,
Upload/Contributions and remote import presentation. That next cut stops before publication.
