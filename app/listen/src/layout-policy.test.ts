import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Listen layout policy", () => {
  it("reserves the desktop scrollbar gutter so route changes do not shift the 1480px viewport", () => {
    const listenStyles = readFileSync(
      resolve(process.cwd(), "src/index.css"),
      "utf8",
    );

    expect(listenStyles).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{\s*html\s*\{[^}]*scrollbar-gutter:\s*stable;/s,
    );
  });
});
