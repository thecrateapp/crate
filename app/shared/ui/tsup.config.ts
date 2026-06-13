import { defineConfig } from "tsup";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

function collectEntries(
  dirs: string[],
  extensions: string[],
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const dir of dirs) {
    try {
      walk(dir, extensions, entries);
    } catch {
      // directory may not exist yet
    }
  }
  return entries;
}

function walk(dir: string, extensions: string[], out: Record<string, string>) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, extensions, out);
    } else if (
      !entry.includes(".test.") &&
      extensions.some((ext) => entry.endsWith(ext))
    ) {
      const key = relative(".", full).replace(/\.(tsx?|ts)$/, "");
      out[key] = full;
    }
  }
}

export default defineConfig({
  entry: collectEntries(
    ["lib", "icons", "primitives", "shadcn", "composites", "domain", "charts"],
    [".ts", ".tsx"],
  ),
  format: ["esm"],
  dts: true,
  outDir: "dist",
  splitting: true,
  treeshake: true,
  external: [
    "@solar-icons/react-perf",
    "@solar-icons/react-perf/Outline",
    "@solar-icons/react-perf/Bold",
    "react",
    "react-dom",
    "react-router",
    "radix-ui",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "qrcode",
  ],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
