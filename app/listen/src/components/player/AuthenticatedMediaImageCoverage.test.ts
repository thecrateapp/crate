import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [path];
  });
}

describe("authenticated media image coverage", () => {
  it("keeps dynamic image URLs behind the credential-aware component", () => {
    const root = join(process.cwd(), "src");
    const violations: string[] = [];

    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
        const element = match[0];
        const isStaticAsset = /\bsrc\s*=\s*["']/.test(element);
        const isCredentialAware = /\bdata-authenticated-media\b/.test(element);
        const isExplicitlyPublic = /\bdata-public-media\b/.test(element);
        if (!isStaticAsset && !isCredentialAware && !isExplicitlyPublic) {
          violations.push(relative(root, file));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
