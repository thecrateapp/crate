import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP_DIRS = new Set([
  ".astro",
  ".git",
  ".gradle",
  ".venv",
  "__pycache__",
  "android",
  "build",
  "dist",
  "ios",
  "node_modules",
  "Pods",
  "target",
  "venv",
]);

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

export function countPytest(source) {
  return countMatches(source, /^\s*(?:async\s+)?def\s+test_\w*\s*\(/gm);
}

export function countVitest(source) {
  return countMatches(
    source,
    /(?<![\w.$])(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))?\s*\(\s*["'`]/g,
  );
}

export function countGoTests(source) {
  return countMatches(source, /^func\s+Test\w*\s*\(/gm);
}

export function countRustTests(source) {
  return countMatches(source, /#\[(?:\w+::)?test(?:\]|\()/g);
}

export function countTaskTypes(source) {
  const block = source.match(/^TASK_POOL_CONFIG\b[^\n]*=\s*\{\n([\s\S]*?)^\}/m);
  return block ? countMatches(block[1], /"\w+"\s*:\s*TaskPoolConfig\(/g) : 0;
}

export function listTaskQueues(source) {
  const block = source.match(/^TASK_POOL_CONFIG\b[^\n]*=\s*\{\n([\s\S]*?)^\}/m);
  const queues = {};
  if (!block) return queues;
  for (const [, name, queue] of block[1].matchAll(
    /"(\w+)"\s*:\s*TaskPoolConfig\(\s*"(\w+)"/g,
  )) {
    (queues[queue] ??= []).push(name);
  }
  return queues;
}

export function countMigrations(fileNames) {
  return fileNames.filter((name) => /^\d+[a-z]?_\w+\.py$/.test(name)).length;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

function sumFiles(roots, filePattern, counter) {
  let total = 0;
  for (const root of roots) {
    for (const file of walk(root)) {
      if (filePattern.test(file)) total += counter(readFileSync(file, "utf8"));
    }
  }
  return total;
}

export function updateScale({ appDir, repoDir, out }) {
  const actors = join(appDir, "crate/actors.py");
  const migrations = join(appDir, "crate/db/migrations/versions");
  if (!existsSync(actors) || !existsSync(migrations)) return null;

  const existing = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  const scale = {
    tracks: existing.tracks,
    albums: existing.albums,
    pytest: sumFiles(
      [join(appDir, "tests")],
      /(?:^|\/)test_[^/]*\.py$/,
      countPytest,
    ),
    vitest: sumFiles([appDir], /\.test\.(?:ts|tsx|js|jsx|mjs)$/, countVitest),
    goTests: sumFiles([appDir], /_test\.go$/, countGoTests),
    rustTests: sumFiles(
      [appDir, join(repoDir, "tools")],
      /\.rs$/,
      countRustTests,
    ),
    taskTypes: countTaskTypes(readFileSync(actors, "utf8")),
    migrations: countMigrations(readdirSync(migrations)),
    taskQueues: listTaskQueues(readFileSync(actors, "utf8")),
  };
  writeFileSync(out, `${JSON.stringify(scale, null, 2)}\n`);
  return scale;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const appDir = resolve(webDir, "..");
  const out = join(webDir, "src/data/scale.json");
  const scale = updateScale({ appDir, repoDir: resolve(appDir, ".."), out });
  console.log(
    scale
      ? `scale-numbers: wrote ${out}`
      : "scale-numbers: repository sources not found, keeping the existing scale.json",
  );
}
