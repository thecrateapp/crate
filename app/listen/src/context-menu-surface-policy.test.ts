import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory()
      ? productionFiles(path)
      : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
  });
}

it("keeps every Listen menu owner on the shared solid surface", () => {
  const overrides = productionFiles(import.meta.dirname)
    .filter((path) => !path.endsWith("/actions/ItemActionMenu.tsx"))
    .filter((path) =>
      /\bsurfaceClassName\s*[:=]/.test(readFileSync(path, "utf8")),
    );
  expect(overrides).toEqual([]);
});
