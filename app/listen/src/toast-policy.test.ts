import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const TOASTER_MOUNT = "main.tsx";
const SONNER_IMPORT =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']sonner["']/g;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !/\.(?:ts|tsx)$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function sonnerImports(source: string): string[] {
  return Array.from(source.matchAll(SONNER_IMPORT)).flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

describe("Listen toast policy", () => {
  it("routes every toast through notify instead of importing sonner directly", () => {
    const offenders = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      const source = readFileSync(path, "utf8");
      const imports = sonnerImports(source);
      const allowed = file === TOASTER_MOUNT ? ["Toaster"] : [];
      const forbidden = imports.filter((name) => !allowed.includes(name));
      const namespaceImport =
        /import\s+\*\s+as\s+\w+\s+from\s+["']sonner["']/.test(source);
      return forbidden.length > 0 || namespaceImport
        ? [`${file}: ${forbidden.join(", ") || "*"}`]
        : [];
    });

    expect(offenders).toEqual([]);
  }, 15_000);

  it("keeps the Toaster mounted from the app entry point", () => {
    const entry = readFileSync(resolve(SOURCE_ROOT, TOASTER_MOUNT), "utf8");

    expect(sonnerImports(entry)).toContain("Toaster");
  });
});
