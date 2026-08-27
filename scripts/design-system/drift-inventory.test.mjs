import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeContent,
  analyzeSemanticTokens,
  buildDriftInventory,
} from "./drift-inventory.mjs";

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

test("normalizes CSS whitespace when grouping semantic values", () => {
  const metrics = analyzeSemanticTokens(`
    :root {
      --surface-alpha: color-mix( in srgb, var(--text-primary) 5%, transparent );
      --surface-beta: color-mix(in srgb, var(--text-primary) 5%, transparent);
    }
  `);

  assert.equal(metrics.duplicateDefinitions, 1);
  assert.deepEqual(metrics.duplicateTokenGroups, [
    ["--surface-alpha", "--surface-beta"],
  ]);
});

test("classifies token layers and counts external consumers", () => {
  const metrics = analyzeSemanticTokens(
    `
      :root {
        --surface-canvas: #000;
        --lyrics-glow: radial-gradient(var(--surface-canvas), transparent);
        --stats-hero: linear-gradient(var(--surface-canvas), transparent);
        --unused-recipe: #fff;
      }
      .lyrics { background: var(--lyrics-glow); }
      .stats { background: var(--stats-hero); }
      .canvas { background: var(--surface-canvas); }
    `,
    [
      `
        :root {
          --surface-canvas: #000;
          --lyrics-glow: radial-gradient(var(--surface-canvas), transparent);
          --stats-hero: linear-gradient(var(--surface-canvas), transparent);
          --unused-recipe: #fff;
        }
        .lyrics { background: var(--lyrics-glow); }
        .stats { background: var(--stats-hero); }
        .canvas { background: var(--surface-canvas); }
      `,
    ],
  );

  assert.equal(metrics.foundationDefinitions, 1);
  assert.equal(metrics.domainDefinitions, 2);
  assert.deepEqual(metrics.oneShotTokens, [
    { name: "--lyrics-glow", consumers: 1 },
    { name: "--stats-hero", consumers: 1 },
  ]);
  assert.deepEqual(metrics.unreferencedTokens, ["--unused-recipe"]);
});

test("enforces the normalized semantic token budget", () => {
  const metrics = buildDriftInventory().semanticTokens;

  assert.deepEqual(metrics.nonFoundationAliases, []);
  assert.ok(
    metrics.definitions <= 185,
    `semantic token definitions grew to ${metrics.definitions}`,
  );
  assert.ok(
    metrics.foundationDefinitions <= 95,
    `foundation token definitions grew to ${metrics.foundationDefinitions}`,
  );
  assert.ok(
    metrics.domainDefinitions <= 90,
    `domain token definitions grew to ${metrics.domainDefinitions}`,
  );
  assert.equal(
    metrics.unreferencedTokens.length,
    0,
    `unreferenced semantic tokens: ${metrics.unreferencedTokens.join(", ")}`,
  );
  assert.ok(
    metrics.duplicateDefinitions <= 1,
    `semantic token duplicates grew to ${metrics.duplicateDefinitions}`,
  );
  assert.deepEqual(metrics.duplicateTokenGroups, [
    ["--surface-placeholder", "--border-quiet"],
  ]);
});
