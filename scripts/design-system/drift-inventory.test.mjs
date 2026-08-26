import assert from "node:assert/strict";
import test from "node:test";

import { analyzeContent } from "./drift-inventory.mjs";

test("counts raw colors, arbitrary utilities, inline styles and imports", () => {
  const metrics = analyzeContent(`
    <div className="bg-[#0a0a0f] text-white border-cyan-500" style={{ color: "#fff" }} />
    import { Button } from "@crate/ui/shadcn/button";
    background: rgba(0, 0, 0, 0.5);
  `);

  assert.deepEqual(metrics, {
    rawColors: 3,
    hardcodedUtilities: 3,
    inlineStyles: 1,
    directShadcnImports: 1,
  });
});
