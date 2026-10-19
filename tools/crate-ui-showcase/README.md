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
Current: http://127.0.0.1:5186/review-1au-headers.html and Storybook `Reviews/1AU/Headers`.
Both import `reviews/HeadersReview.tsx`; earlier actions/forms/labels review URLs stay available. No copied
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

93 entries link 120 sources: 33 documented entries and 60 pending by family. Adoption and visual
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
