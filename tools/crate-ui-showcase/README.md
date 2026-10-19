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

91 entries link 118 sources: 10 documented entries and 81 pending by family. Adoption and visual
review remain explicitly pending; these are not counts of certified consumers. SegmentedControl
currently demonstrates radio mode and its textual contract; real-prop controls and the tabs
scenario remain pending expansion. HairlineRow now owns its inset/alignment and supports wrapping
unbroken titles. Its Listen consumer remains in place; Admin adoption and the other row families
are still pending.
