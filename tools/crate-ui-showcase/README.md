# Crate UI — Design System

Local Storybook: http://127.0.0.1:6006/?path=/docs/system-introduction--docs

Use Node 22 from the repository root:

```sh
npm run design-system:storybook
npm run design-system:showcase:check
npm run design-system:storybook:typecheck
npm run design-system:storybook:test -- --workers=1
npm run design-system:storybook:build
```

The historical preview remains at 5186. Preserve its checkpoints and canonical captures.

Each review step now has a small standalone page with only the components and states under
review. Cover the full approved checkpoint scope. Do not grow the historical main mockup.
Current: http://127.0.0.1:5186/review-1ax-layers.html and Storybook `Reviews/1AX/Layers`.
Both import `reviews/LayersReview.tsx`; earlier actions/forms/labels review URLs stay available. No copied
markup, local component repairs or Storybook runtime in the standalone page. Component entries
and their documentation still require updates in the same change.

## Mandatory entry maintenance

`catalogue.json` is the versioned registry. Every shared visual module, token, font and icon
belongs to an entry. Internal modules may share their family's entry. Stories and MDX import
actual components and live outside shared production entry folders.

When adding or changing a component:

1. Add or complete its `documented` entry, source anchors, story and MDX. Pending entries preserve
   only initial coverage debt; new components cannot be pending.
2. Update the contract or scenario demonstrating the change and its tests. No compensating CSS.
3. Run `npm run design-system:showcase:refresh -- ID`, then check the catalogue.
4. Include source, entry and affected docs/stories in the same change.

The local guard compares against HEAD. CI receives `--base REF` with the PR base SHA or previous
push SHA and fetches its history. A missing revision fails. Documented entries cannot revert to
pending. Schema checks validate rendered metadata, Storybook ids and `.stories.tsx`/`.mdx` paths.
The pre-commit hook reads the Git index: an unstaged repair cannot mask stale staged source.
The shared policy test and existing frontend workflow enforce the same rules; no separate full
pipeline is added. Semantic accuracy and visual approval still require human review.

Documented, adopted and validated are separate statuses. Inventory entries explicitly identify
pending coverage and known issues. HairlineRow's first reconciliation moves its inset/alignment
into the shared component and removes the historical mockup CSS that masked the defect.

## Identity and isolation

The approved persistent mockup at 5186, including Diego's later confirmed adjustments, is the
visual source of truth. Shared components and this catalogue implement that reference. Raise
doubts, visual deviations or mobile sizing conflicts with Diego before selecting a different
presentation. Keep the historical app/web@258bbaee pin; do not silently replace it.

The catalogue, examples and contracts are in English. Manager and docs use Storybook's supported
theme API, mapped from `CRATE_IDENTITY_VARIABLES`: the same Crate surfaces, borders, cyan accents,
Poppins and JetBrains Mono. Owned documentation headings use Bricolage Grotesque. Font files are
self-hosted. The native Storybook controls and navigation remain functional; there is no custom
skin selector or CSS targeting internal manager selectors.

The official `Unstyled` doc block isolates actual component markup from Storybook Markdown
styles. Scene CSS only handles layout and owned documentation content; it never repairs shared
component internals. Tailwind scans shared sources and stories, including future component classes.

Storybook 10.6.2, React/Vite, docs and a11y are root devDependencies. No shared exports, peers or
app runtime dependencies change. Static output: `.artifacts/crate-ui-storybook`.

## Focused validation

```sh
npm run --workspace=app/shared/ui test -- showcase-policy.test.ts showcase-staged.test.ts --maxWorkers=1
```

Playwright uses the scoped config above with one worker. Git-index and historical comparisons
use disposable temporary repositories; only the historical fixture creates commits there.
Tests never stage or commit files in the working checkout. No full suites/CI per entry; this
scope does not certify assistive technology, native runtimes or canonical visual comparison.

## Initial coverage and debt

Entries use a single primary functional category, independent of code folders. The same category
appears in the inventory and the component's Storybook title. Forms, Feedback, Data Display,
Navigation, Actions, Overlays, Media and Layout hold canonical components; Compatibility holds
legacy adapters. Foundations remains in System. Category definitions live in Maintenance.
Pending entries are categorized too; a category does not imply validated documentation.

93 entries link 120 sources: 45 documented entries and 48 pending by family. Adoption and visual
review remain explicitly separate; these are not counts of certified consumers. SegmentedControl
demonstrates real-prop controls, radio mode and tabs with persistent linked panels. HairlineRow
owns its inset/alignment and supports wrapping
unbroken titles. Its Listen consumer remains in place; Admin adoption and the other row families
are still pending.

## Form family — local 1AR

All form primitives have live entries: FormField, Input, Textarea, SearchInput, Select, AdminSelect, Checkbox, Switch, RadioGroup, SegmentedControl, FilterChip and the general native Slider. `Patterns/Forms` composes the real components. New specimens belong only in Storybook; the persistent mockup stays a reference. Use FormField stacked for ordinary controls, inline for a checkbox/switch caption. Input retains native number/date/time/file variants. Page-wide adoption and player/EQ controls remain separate.

## Action family — local 1AS

Button is the text-action foundation; ActionGroup/ActionButton/ActionLink compose the approved header/row recipe. IconButton retains compact round/glow controls; ActionIconButton/ActionIconLink have explicit Compatibility entries. See each live contract and Reviews/1AS/Actions. Specialized play/AI/navigation semantics remain separate.

## Surface family — local 1AT

Card represents a solid standalone object; InstrumentPanel is an unfilled ruled section.
Separator supplies the horizontal/vertical rule. Card icon variants share the object surface.
Admin OpsPanel and Listen Settings Section delegate to InstrumentPanel; hero/stat/media families
remain separate. See the live contracts and Reviews/1AT/Surfaces.

Review captions use FormField kind="group", its named sample and real 8 px grid gap. Equivalent
controls use the same canonical component/size/variant. Explicit compatibility or size galleries
retain their separate contracts. Browser checks measure these relationships in both hosts;
passing intrinsic component checks alone does not validate composition.


## Header family — local 1AU

PageHeader and PageHeaderLayout own ordinary identity/metadata and container-aware artwork/action
positioning. SectionHeader owns rail headings/counts. PageHero preserves media/artist/editorial/card
roles, with compact titles and an explicit content-height mode for CrateHero. HeroActionBar keeps
playback/menu composition; BackLink preserves text and native router/button behavior with real
coarse targets. See five live entries and Reviews/1AU/Headers. Slot gaps live in shared components,
including action/metadata fragments. Native Album/safe-area overrides and broader page adoption
remain separate; this group does not certify them.

## Image and identity family — local 1AV

Avatar/EntityAvatar, MediaCover/PlaylistArtwork and CrateLogo/BandcampLogo now have six live
English contracts. Existing functional categories are preserved: Data Display, Media and
Foundations. One scene powers Reviews/1AV/Images and review-1av-images.html; captions use
FormField8px and equivalent artwork controls share their geometry. Listen AlbumCardArtwork
adopts the shared cover frame while ArtworkSurface/CrateImage retains authenticated recovery
and responsive assets. UserAvatar and PlaylistArtwork retain their real app adapters. This is
initial adoption; other image consumers/native/live/AT QA remain separate.

## Collection family — local 1AW

EntityRow/Card/PrimaryAction, TrackList, MediaGrid and MediaRail have live English contracts.
Listen uses its real local TrackRowView/Content/PlaybackControl in both hosts. Native actions,
active/selection, full titles,0/1/many, profiles and loaded/reserved grids remain distinct roles.
MediaCover owns the48px minimum; legacy managed/raw thumbnails use the same `crate-media-thumbnail`
recipe until their page adoption. Person avatars and internal collage tiles are separate roles.
V2 track identity stays white18px play glyph in a24px visual slot over artwork48px, active ring40px with effects/progress.


## Listen Shell, search and collection — local1AY

Reviews/1AY/Shell and review-1ay-shell.html share the actual Listen frame/navigation,
collection tabs/sort/liked presentation and search form/result/state views. No API/provider
writes are introduced by the fixture; live Listen5174 validates authenticated artwork separately.
Collection counts use InfoBadge beside each tab, including0. FilterBar has an end alignment for
stacked fields; Select owns a stable12rem default width. Tabs owns a single moving cyan indicator
with spring-snappy450ms and reduced-motion fallbacks. Their live entries document these amendments.
Player internals remain1AZ. Catalogue coverage and consumer adoption remain separate.

## Listen player — local 1AZ

Listen/Player documents the actual app-local frame, transport/seek, volume, quality, panels,
identity, queue, static lyric rows/clock, resume and sleep form. Reviews/1AZ/Player and
review-1az-player.html compose the same sources. Fixture callbacks never contact production or
change saved player preferences; no synthetic analyser/loudness samples. Production controllers,
engines, authority, authenticated images and native effects stay in Listen. Shared catalogue
coverage is unchanged; this is not a fictitious second consumer or completion of pending PlayButton.

## Listen album/access — local 1BA

Listen/Album and access documents the actual app-local AlbumHeroFrame/AlbumActionsView,
AlbumSelectionToolbar, ReleaseCountdown, RemoteImportView, AuthFrame/CredentialsForm,
ServerSetupView/AuthCallbackView and OfflineLibraryView. Reviews/1BA/Album and access and
5186review-1ba-album-access.html share one scene. Shared catalogue entries remain authoritative
for forms, headers, actions, media, states and rows; no invented Admin consumers. Controllers
retain native artwork measurements, route helpers, auth, imports and verified offline storage.

1BA review amendments: Listen/QualityBadge documents the actual soundwave/tier adapter used by
hero, rows and player; TrackMetadata demonstrates reserved responsive columns and missing values.
ShowGenres uses the real expanded show view and UpcomingMonthGroupView with its canonical8px
caption-to-first-item gap. Supplied genre profiles retain percentages, including0%; names alone
never acquire synthetic percentages. The expanded show composition is Diego's reference for the
next Listen migrations. Production Top Tracks depth/rate requires the prepared backend change
to be deployed; the live preview still reads the existing production API.

ArtistAvatars compares real EntityAvatar xs24px/inline28px with a48px MediaCover. Album bylines
and player identity retain V2 geometry; standalone artist/album/track thumbnails retain48px.
The Avatar, EntityAvatar and MediaCover contracts document the exception. The expanded show
view imports its ticket CSS directly, so the isolated story uses production styling.

1BA TrackInteractions compares HairlineRow with actual TrackRowView/TrackRowContent selected,
current, idle and disabled states. Only enabled fine-pointer track hover illuminates the row.
CollectionNavigation mounts the real SidebarNavigationView: parent and child items both44px,
with the existing indent and current-route semantics. SuggestedTab in Listen now adopts the
actual TrackList/TrackRow controller, covered by its focused consumer tests; preview scenes do
not authenticate, fetch recommendations or start production playback.

Reviews/1BA/Player motion and navigation and5186review-1ba-player-motion.html reuse the actual
SpinningDiscFrame, play control, motion hook, mode actions and route-aware Collection navigation.
Listen/Player adds DiscMotion and DisplayModes entries. A local4Hz clock, coarse correction,
seek, buffering and deliberate120ms interface load exercise continuous compositor rotation;
pause/hidden/reduced motion retain the pose. The RAF fallback and jog continuity have focused
consumer tests. Mode actions use44px ActionButton radios without a frame: selected accent,
other glyphs white, keyboard/tooltip semantics and the existing mobile capability gate.
Expanded Collection is pinned open on Collection routes; collapsed/mobile dismissal remains.
These app-local entries do not create shared exports or change pending catalogue coverage.

Latest1BA amendment: Reviews/1BA/Artist and player refinements and5186review-1ba-artist-player.html
reuse ArtistAlbumGroupFrame with the V2 comfortable grid, AppModal/ArtistBioProfile at full body
width, the real ExtendedPlayerHeaderBar without an added caption and PlayerLyricsSurface without
a colored background. Listen/Album and access, Listen/Player, MediaGrid and AppModal expose the
same examples. EQ access is separate from the persisted enable preference; actual effects/panels
stay in Listen. Browser cases cover375/1200/1920px in both hosts, plus affected modal consumers.

### 1BB Home and Library — first batch

`Reviews/1BB/Home and Library` and `review-1bb-home-library.html` share HomeLibraryReview.
Listen/Home and Library documents actual app-local HomeGreeting/HeroActions, LibrarySection,
LibraryContributionRow/ContributionWithdrawDialog, LibraryBandcampHeader and CrateIndexGrid.
Read-state controls and local callbacks cover ready/loading/error/retry/empty, missing export
capability and confirmation/pending/cancel. Grid slots document geometry, not a replacement 3D
CrateCard. Details/editors/coverflow/collaborators remain next; see the scope matrix in the plan.
MonoLabel/ContextualMetrics documents Diego's counts/captions amendment. Only mono-label's
documented catalogue entry is refreshed; no pending baseline is regenerated.
