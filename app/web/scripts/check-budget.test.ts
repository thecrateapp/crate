import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkBudget, pageScriptBytes } from "./check-budget.mjs";

function makeDist(files: Record<string, string>) {
  const dist = mkdtempSync(join(tmpdir(), "crate-web-budget-"));
  for (const [name, content] of Object.entries(files)) {
    const file = join(dist, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dist;
}

const gz = (source: string) => gzipSync(source).length;

describe("pageScriptBytes", () => {
  it("sums the gzip size of script src and modulepreload targets", () => {
    const a = "console.log('a');".repeat(20);
    const b = "console.log('b');".repeat(40);
    const dist = makeDist({ "_astro/a.js": a, "_astro/b.js": b });
    const html = [
      '<link rel="stylesheet" href="/_astro/site.css">',
      '<link rel="modulepreload" href="/_astro/b.js">',
      '<script type="module" src="/_astro/a.js"></script>',
      "<script>inline()</script>",
    ].join("\n");

    expect(pageScriptBytes(html, dist)).toBe(gz(a) + gz(b));
  });

  it("follows static imports once and ignores dynamic imports", () => {
    const shared = "export const shared = 1;".repeat(10);
    const lazy = "export const lazy = 1;".repeat(10);
    const entry =
      'import{shared}from"./shared.js";import"./shared.js";import("./lazy.js");';
    const other = 'import { shared } from "./shared.js";';
    const dist = makeDist({
      "_astro/entry.js": entry,
      "_astro/other.js": other,
      "_astro/shared.js": shared,
      "_astro/lazy.js": lazy,
    });
    const html = [
      '<script type="module" src="/_astro/entry.js"></script>',
      '<script type="module" src="/_astro/other.js"></script>',
      '<link rel="modulepreload" href="/_astro/entry.js">',
    ].join("\n");

    expect(pageScriptBytes(html, dist)).toBe(
      gz(entry) + gz(other) + gz(shared),
    );
  });

  it("returns 0 for a page without scripts", () => {
    expect(pageScriptBytes("<p>static</p>", makeDist({}))).toBe(0);
  });
});

describe("checkBudget", () => {
  it("reports every page with its size and flags the ones over the limit", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `v${i * 7919}`).join(
      ";",
    );
    const dist = makeDist({
      "_astro/big.js": big,
      "index.html": '<script type="module" src="/_astro/big.js"></script>',
      "docs/page.html": "<p>no js</p>",
    });

    const result = checkBudget(dist, 1024);

    expect(result.pages).toEqual([
      { page: "docs/page.html", bytes: 0, over: false },
      { page: "index.html", bytes: gz(big), over: true },
    ]);
    expect(result.ok).toBe(false);
    expect(checkBudget(dist, gz(big)).ok).toBe(true);
  });
});
