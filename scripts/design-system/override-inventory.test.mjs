import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSource,
  buildOverrideInventory,
  evaluateOverrideBudget,
  loadOverrideBudget,
  overrideCategory,
} from "./override-inventory.mjs";

test("classifies component-owned utilities and ignores caller layout", () => {
  assert.equal(overrideCategory("min-h-11"), "height");
  assert.equal(overrideCategory("pointer-coarse:min-h-11"), "height");
  assert.equal(overrideCategory("sm:max-w-xl"), null);
  assert.equal(overrideCategory("w-full"), null);
  assert.equal(overrideCategory("min-w-0"), null);
  assert.equal(overrideCategory("mt-1"), "margin");
  assert.equal(overrideCategory("pl-9"), "padding");
  assert.equal(overrideCategory("rounded-lg"), "radius");
  assert.equal(overrideCategory("bg-accent-action/10"), "background");
  assert.equal(overrideCategory("text-accent-action-hi"), "textColor");
  assert.equal(overrideCategory("text-[10px]"), "textSize");
  assert.equal(overrideCategory("text-center"), null);
  assert.equal(overrideCategory("tracking-caps"), "typography");
  assert.equal(overrideCategory("[&_svg]:size-4"), "height");
  assert.equal(overrideCategory("jam-chip"), null);
});

test("counts overrides only on shared components, per category", () => {
  const sites = analyzeSource(
    "Example.tsx",
    `
      import { Button } from "@crate/ui/shadcn/button";
      import { MonoLabel as Label } from "@crate/ui/primitives/MonoLabel";
      import { Search } from "@crate/ui/icons";
      import { Local } from "./Local";

      export function Example({ active }) {
        return (
          <>
            <Button className="w-full min-h-11" />
            <Button className={cn("flex", active && "mt-2 text-text-muted")} />
            <Label panelClassName={\`mb-3 \${active ? "px-2" : ""}\`} />
            <Search className="size-4 text-text-muted" />
            <Local className="min-h-11" />
            <Button className="w-full" />
          </>
        );
      }
    `,
  );

  assert.deepEqual(
    sites.map(({ component, categories }) => ({ component, categories })),
    [
      { component: "Button", categories: ["height"] },
      { component: "Button", categories: ["margin", "textColor"] },
      { component: "MonoLabel", categories: ["margin", "padding"] },
    ],
  );
});

test("flags metrics above budget, including categories absent from it", () => {
  const results = evaluateOverrideBudget(
    { Button: { height: 3, margin: 1 } },
    { Button: { height: 4 }, Card: { padding: 2 } },
  );
  assert.deepEqual(results, [
    { metric: "Button.height", actual: 3, limit: 4 },
    { metric: "Button.margin", actual: 1, limit: 0 },
    { metric: "Card.padding", actual: 0, limit: 2 },
  ]);
});

test("keeps shared component overrides within the committed budget", () => {
  const exceeded = evaluateOverrideBudget(
    buildOverrideInventory(),
    loadOverrideBudget(),
  ).filter(({ actual, limit }) => actual > limit);
  assert.deepEqual(exceeded, []);
});
