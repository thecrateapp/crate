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

  const mounts = [
    ["Listen", resolve(SOURCE_ROOT, TOASTER_MOUNT)],
    ["Admin", resolve(process.cwd(), "../ui/src/App.tsx")],
  ] as const;

  it.each(mounts)("%s mounts Sonner with the shared config", (_app, path) => {
    const entry = readFileSync(path, "utf8");

    expect(entry).toMatch(
      /import\s*\{\s*toasterConfig\s*\}\s*from\s*["']@crate\/ui\/lib\/toaster-config["']/,
    );
    expect(entry).toMatch(/<Toaster\b[^>]*\{\.\.\.toasterConfig\}/);
  });

  it.each(mounts)(
    "%s does not opt back into rich colour toasts",
    (_app, path) => {
      const entry = readFileSync(path, "utf8");

      expect(entry).not.toMatch(/\brichColors\b/);
    },
  );

  it("shares the fixed identity while preserving placement and mobile offsets", () => {
    const listen = readFileSync(mounts[0][1], "utf8");
    const admin = readFileSync(mounts[1][1], "utf8");

    expect(listen).toMatch(/theme="dark"/);
    expect(listen).not.toContain("@crate/ui/lib/theme-skin");
    expect(listen).toMatch(/position="bottom-center"/);
    expect(listen).toMatch(/mobileOffset=\{/);
    expect(listen).toContain("var(--listen-mobile-bottom-chrome-height)");
    expect(admin).toMatch(/theme="dark"/);
    expect(admin).toMatch(/position="bottom-right"/);
  });
});
