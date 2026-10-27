import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Listen rendering performance contract", () => {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf8");

  it("defers offscreen grid cards with a stable intrinsic size", () => {
    expect(css).toMatch(
      /[.]listen-deferred-grid-item\s*{[^}]*content-visibility:\s*auto;/s,
    );
    expect(css).toMatch(
      /[.]listen-deferred-grid-item\s*{[^}]*contain-intrinsic-size:/s,
    );
  });

  it("frosts the mobile dock with neutral chrome and no accent tint", () => {
    const dock = css.match(/^[.]listen-mobile-dock-glass\s*{([^}]*)}/m)?.[1];
    expect(dock).toBeDefined();
    expect(dock).toMatch(/background:\s*var\(--surface-chrome\);/);
    expect(dock).toMatch(/(?:^|\s)backdrop-filter:\s*blur\(24px\);/);
    expect(dock).toMatch(/-webkit-backdrop-filter:\s*blur\(24px\);/);
    expect(dock).not.toMatch(/accent|gradient|box-shadow/);
  });

  it("uses a cheaper mobile dock filter on narrow viewports", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*480px\)[\s\S]*?[.]listen-mobile-dock-glass\s*{[^}]*backdrop-filter:\s*blur\(18px\)\s+saturate\(1[.]18\);/,
    );
  });
});
