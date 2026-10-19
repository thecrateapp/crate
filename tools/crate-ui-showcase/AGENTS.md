# Crate UI showcase

Source-of-truth catalogue and live design-system docs. Stories/MDX stay outside shared production
entry folders. Root/shared AGENTS apply. Keep both5186historical preview and6006Storybook available.

The approved persistent mockup at5186 is the visual source of truth; the catalogue implements and
documents that reference. Compare computed styles rather than accepting story defaults. Flag
doubts, deviations and mobile sizing conflicts to Diego before choosing a different presentation.

- Import actual @crate/ui components, fonts and tokens. No replicated component markup or CSS
  selectors that compensate internals. Scene layout/context only; known defects stay explicit.
- Every review step has a small standalone page on 5186, limited to that step. Keep its scene
  in `reviews/` and reuse it in a CSF review story; standalone pages import the scene directly,
  never CSF or Storybook runtime. Do not append more cases to the large historical mockup.
  Match each view against the full approved checkpoint scope, including its families and states.
- Labelled samples use FormField kind="group" with a named group and its actual 8 px stacked
  gap; never loose MonoLabel plus space-y or caller margins. Use the same canonical component,
  size and variant for equivalent controls. Explicit size/compatibility galleries are separate.
  Test the rendered caption-to-sample gap and equivalent-control dimensions in both hosts.
- Every added/modified shared visual module updates its catalogue entry, docs/story and relevant
  checks in the same change. Run showcase:refresh for the specific documented id, then check.
  Never regenerate the pending baseline to hide source changes. Do not edit hashes alone.
- Pending means legacy coverage debt, not approval. Adoption and validation are separate statuses.
- Use one primary functional category per family; the story title and catalogue category must
  agree. Classify by purpose, not the source folder. Variants stay together; legacy adapters
  belong to Compatibility. Definitions live in the Maintenance docs.
- Give each CSF family an explicit stable meta.id matching catalogue.storyId. Category/title
  changes must preserve it so existing documentation links and open tabs keep working.
- Storybook deps are development-only. No runtime imports in app/shared, Admin or Listen.
- Focused Vitest maxWorkers1, Playwright workers1. Preserve canonical baselines; no full CI.
