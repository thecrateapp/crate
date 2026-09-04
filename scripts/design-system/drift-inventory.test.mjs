import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeContent,
  analyzeRawColorDrift,
  analyzeSemanticTokens,
  buildDriftInventory,
} from "./drift-inventory.mjs";

test("counts raw colors, arbitrary utilities, inline styles and imports", () => {
  const metrics = analyzeContent(`
    <div className="bg-[#0a0a0f] bg-[rgba(0,0,0,0.5)] text-white border-cyan-500 text-[10px] bg-[var(--surface-card)]" style={{ color: "#fff" }} />
    import { Button } from "@crate/ui/shadcn/button";
    background: rgba(0, 0, 0, 0.5);
    function rgbToHsl() {}
    function hslToRgb() {}
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

test("counts quoted token references used by runtime readers", () => {
  const metrics = analyzeSemanticTokens(
    `
      :root {
        --visualizer-waveform-peak-idle: #000;
      }
    `,
    ['const token = "--visualizer-waveform-peak-idle";'],
  );

  assert.deepEqual(metrics.unreferencedTokens, []);
  assert.deepEqual(metrics.oneShotTokens, [
    { name: "--visualizer-waveform-peak-idle", consumers: 1 },
  ]);
});

test("separates foundation and intentional raw colors from product drift", () => {
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/shared/ui/tokens/colors.css",
      "--color-primary: #06b6d4;",
    ),
    { foundationRawColors: 1, allowlistedRawColors: 0, actionableRawColors: 0 },
  );
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/shared/ui/domain/auth/OAuthButtons.tsx",
      'fill="#4285F4" fill="#34A853" fill="#FBBC05" fill="#EA4335"',
    ),
    { foundationRawColors: 0, allowlistedRawColors: 4, actionableRawColors: 0 },
  );
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/listen/src/components/Example.tsx",
      'style={{ color: "#123456" }}',
    ),
    { foundationRawColors: 0, allowlistedRawColors: 0, actionableRawColors: 1 },
  );
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
    metrics.definitions <= 226,
    `semantic token definitions grew to ${metrics.definitions}`,
  );
  assert.ok(
    metrics.foundationDefinitions <= 95,
    `foundation token definitions grew to ${metrics.foundationDefinitions}`,
  );
  assert.ok(
    metrics.domainDefinitions <= 121,
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
  assert.equal(inventory.totals.actionableRawColors, 0);
  assert.ok(
    metrics.duplicateDefinitions <= 8,
    `semantic token duplicates grew to ${metrics.duplicateDefinitions}`,
  );
  assert.deepEqual(metrics.duplicateTokenGroups, [
    [
      "--surface-contrast",
      "--state-danger-foreground",
      "--visualizer-ribbon-fade",
    ],
    ["--surface-accent-shadow", "--visualizer-waveform-gradient-idle-bottom"],
    ["--surface-accent-subtle", "--visualizer-waveform-gradient-active-bottom"],
    ["--genre-tone-default", "--visualizer-sphere-color-1"],
    ["--visualizer-ribbon-stop-1", "--visualizer-waveform-gradient-active-top"],
    ["--visualizer-waveform-gradient-idle-top", "--border-accent"],
    ["--visualizer-waveform-peak-idle", "--jam-focus-border"],
  ]);
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
