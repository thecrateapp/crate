import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeContent,
  analyzeSemanticTokens,
  buildDriftInventory,
} from "./drift-inventory.mjs";

test("counts raw colors, arbitrary utilities, inline styles and imports", () => {
  const metrics = analyzeContent(`
    <div className="bg-[#0a0a0f] bg-[rgba(0,0,0,0.5)] text-white border-cyan-500 text-[10px] bg-[var(--surface-card)]" style={{ color: "#fff" }} />
    import { Button } from "@crate/ui/shadcn/button";
    background: rgba(0, 0, 0, 0.5);
  `);

  assert.deepEqual(metrics, {
    rawColors: 4,
    arbitraryUtilities: 4,
    hardcodedColorUtilities: 4,
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

test("detects surface tokens used in border and text declarations", () => {
  const metrics = analyzeSemanticTokens(`
    :root {
      --surface-quiet: color-mix(in srgb, white 10%, transparent);
    }
    .card {
      border: 1px solid var(--surface-quiet);
      color: var(--surface-quiet);
      background-color: var(--surface-quiet);
      background: var(--surface-quiet);
    }
  `);

  assert.deepEqual(metrics.roleViolations, [
    { property: "border", token: "--surface-quiet" },
    { property: "color", token: "--surface-quiet" },
  ]);
});

test("enforces the normalized semantic token budget", () => {
  const inventory = buildDriftInventory();
  assert.equal(inventory.version, 2);
  const metrics = inventory.semanticTokens;

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
  assert.deepEqual(
    metrics.roleViolations,
    [],
    `semantic role violations: ${JSON.stringify(metrics.roleViolations)}`,
  );
  assert.ok(
    inventory.totals.hardcodedColorUtilities <= 0,
    `hardcoded color utilities grew to ${inventory.totals.hardcodedColorUtilities}`,
  );
  assert.ok(
    metrics.duplicateDefinitions <= 1,
    `semantic token duplicates grew to ${metrics.duplicateDefinitions}`,
  );
  assert.deepEqual(metrics.duplicateTokenGroups, []);
});

test("keeps shared animation colors skin-aware", () => {
  const animations = readFileSync(
    new URL("../../app/shared/ui/tokens/animations.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(animations, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(animations, /var\(--accent-action\)/);
  assert.match(animations, /var\(--surface-glass-shadow\)/);
});
