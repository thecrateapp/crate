# Persistent V3 mockup

The approved visual reference and its historical checkpoints stay available on port 5186.
Do not add samples or sections to the large historical mockup. From Diego's 2026-10-19
amendment, every review step gets a small standalone page containing only its current scope,
named `review-<checkpoint>-<scope>.html`. Reuse a scene from
`tools/crate-ui-showcase/reviews` in both the page and Storybook; do not copy component markup
or import Storybook runtime/CSF into the standalone page. Keep older checkpoints available.
Component inventory/docs remain mandatory in Storybook. Match the view against the complete
approved checkpoint scope before sharing, including all component families and agreed states.
Current review: `review-1au-headers.html`. The approved forms review and its labels alias remain available.

Existing scenes import actual `@crate/ui` components. Auxiliary fixture controls also use
FormField/Input/Checkbox/Select/etc.; never add raw input/select/textarea copies. The shared
preview-component policy and scoped browser scene tests enforce this contract. FormField inline
owns checkbox/switch caption layout; its stacked layout owns real 8 px label gaps. Labelled samples use FormField kind="group" and its 8 px gap, with the supplied ID/ARIA
on the actual sample group. Equivalent controls use the same component/size/variant; separate
explicit compatibility or size galleries. Measure these relationships in both hosts. Scene CSS
places components; it does not repair their internal typography, focus or geometry.
Do not mark caption text as `form-field-value`: that slot is reserved for real values which
retain their case. Test the style of the visible text, including any inner spans.

Preserve fake data/state callbacks and existing routes; no backend calls or persisted user
preferences are introduced by a scene correction. Keep canonical baselines unchanged and run
only affected tests with one worker. Root/shared instructions also apply.
