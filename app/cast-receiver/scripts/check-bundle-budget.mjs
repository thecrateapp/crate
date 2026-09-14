import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const [distPath = "dist"] = process.argv.slice(2);
const budgetBytes = 150 * 1024;

function assetPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? assetPaths(path) : [path];
  });
}

const compressedBytes = assetPaths(distPath)
  .filter((path) => [".css", ".js"].includes(extname(path)))
  .reduce((total, path) => {
    if (!statSync(path).isFile()) return total;
    return total + gzipSync(readFileSync(path)).byteLength;
  }, 0);

if (compressedBytes > budgetBytes) {
  throw new Error(
    `Cast receiver bundle is ${compressedBytes} bytes gzip; budget is ${budgetBytes}`,
  );
}

console.log(
  `Cast receiver bundle: ${compressedBytes} / ${budgetBytes} bytes gzip`,
);
