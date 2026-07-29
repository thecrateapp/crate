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

describe("Crate image pipeline coverage", () => {
  it("keeps dynamic image URLs behind the unified artwork component", () => {
    const root = join(process.cwd(), "src");
    const violations: string[] = [];

    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
        const element = match[0];
        const isStaticAsset = /\bsrc\s*=\s*["']/.test(element);
        const isManagedArtwork = /\bdata-artwork-managed\b/.test(element);
        if (!isStaticAsset && !isManagedArtwork) {
          violations.push(relative(root, file));
        }
      }
      if (source.includes("AuthenticatedMediaImage")) {
        violations.push(`${relative(root, file)}:legacy-renderer`);
      }
      if (
        relative(root, file) !== "components/actions/ItemActionMenu.tsx" &&
        (source.includes("ItemActionMenu") ||
          source.includes("<ContextMenu")) &&
        source.includes('from "@crate/ui/domain/actions"')
      ) {
        violations.push(`${relative(root, file)}:raw-item-action-menu`);
      }
    }

    expect(violations).toEqual([]);
  });
});
