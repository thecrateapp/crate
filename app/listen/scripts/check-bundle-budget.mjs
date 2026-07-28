import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DEFAULT_INITIAL_GZIP_BUDGET = 300 * 1024;

export async function checkBundleBudget(
  distDirectory,
  budgetBytes = DEFAULT_INITIAL_GZIP_BUDGET,
) {
  const html = await readFile(path.join(distDirectory, "index.html"), "utf8");
  const assetPaths = new Set();
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+\.js)["'][^>]*>/g,
  )) {
    if (
      match[0].includes('type="module"') ||
      match[0].includes('rel="modulepreload"')
    ) {
      assetPaths.add(match[1].replace(/^\/+/, ""));
    }
  }

  let gzipBytes = 0;
  for (const assetPath of assetPaths) {
    const source = await readFile(path.join(distDirectory, assetPath));
    gzipBytes += gzipSync(source).byteLength;
  }
  if (gzipBytes > budgetBytes) {
    throw new Error(
      `Initial JavaScript gzip budget exceeded: ${gzipBytes} > ${budgetBytes} bytes`,
    );
  }
  return { gzipBytes, budgetBytes, assets: [...assetPaths] };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file:"))
) {
  const distDirectory = path.resolve(process.argv[2] ?? "dist");
  const budgetBytes = Number(
    process.env.CRATE_LISTEN_INITIAL_GZIP_BUDGET ?? DEFAULT_INITIAL_GZIP_BUDGET,
  );
  const result = await checkBundleBudget(distDirectory, budgetBytes);
  process.stdout.write(
    `Initial JavaScript: ${result.gzipBytes} gzip bytes ` +
      `(${result.assets.length} assets, budget ${result.budgetBytes})\n`,
  );
}
