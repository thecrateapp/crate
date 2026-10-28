import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.resolve("src/components/layout/listen-shell.css"),
  "utf8",
);

describe("Listen shell navigation recipe", () => {
  it("marks the active mobile dock tab by colour only, without an accent bar", () => {
    expect(css).not.toMatch(/\.listen-mobile-nav-item[^{]*::before/);
    expect(css).toMatch(
      /\.listen-mobile-nav-item:is\(\[aria-current="page"\], \[data-active="true"\]\)\s*\{\s*color:\s*var\(--accent-action-hi\);/,
    );
  });

  it("keeps the desktop navigation indicator", () => {
    expect(css).toMatch(/\.listen-nav-item::before/);
  });
});
