import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const SCRIPT_SRC = /<script\b[^>]*\bsrc="([^"]+)"/g;
const MODULEPRELOAD =
  /<link\b(?=[^>]*\brel="modulepreload")[^>]*\bhref="([^"]+)"/g;
const STATIC_IMPORT = /\b(?:import|from)\s*["']([^"']+\.m?js)["']/g;

function isLocal(url) {
  return !/^(?:[a-z]+:)?\/\//i.test(url);
}

function collect(file, seen) {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  for (const [, spec] of source.matchAll(STATIC_IMPORT)) {
    if (isLocal(spec)) collect(resolve(dirname(file), spec), seen);
  }
}

export function pageScriptBytes(html, distDir) {
  const seen = new Set();
  const urls = [
    ...[...html.matchAll(SCRIPT_SRC)].map((match) => match[1]),
    ...[...html.matchAll(MODULEPRELOAD)].map((match) => match[1]),
  ];
  for (const url of urls) {
    if (isLocal(url)) collect(join(distDir, url.split(/[?#]/)[0]), seen);
  }
  let total = 0;
  for (const file of seen) total += gzipSync(readFileSync(file)).length;
  return total;
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

export function checkBudget(distDir, limit) {
  const pages = [...htmlFiles(distDir)]
    .map((file) => {
      const bytes = pageScriptBytes(readFileSync(file, "utf8"), distDir);
      return { page: relative(distDir, file), bytes, over: bytes > limit };
    })
    .sort((a, b) => a.page.localeCompare(b.page));
  return { pages, ok: pages.every((page) => !page.over) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [distArg = "dist", limitArg = "122880"] = process.argv.slice(2);
  const limit = Number(limitArg);
  const { pages, ok } = checkBudget(resolve(distArg), limit);
  for (const { page, bytes, over } of pages) {
    console.log(
      `${over ? "FAIL" : "ok  "} ${page} ${bytes} B gzip (limit ${limit})`,
    );
  }
  if (!ok) process.exit(1);
}
